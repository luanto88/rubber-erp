// Sửa lịch sử tài xế chính theo xe (dispatch_vehicle_driver_assignments) bị HỞ 1 NGÀY.
//
// Nguyên nhân: Cài đặt → Xe & Tài xế trước 2026-11-07 dùng `addDays` tính theo giờ địa phương
// rồi cắt ISO (UTC) ⇒ khi đổi tài xế, dòng cũ được đóng `effective_to = from_mới − 2 ngày`
// thay vì `from_mới − 1 ngày` ⇒ giữa 2 dòng có 1 ngày không có tài xế chính.
//
// Quy tắc sửa (tự động): với từng xe, sắp dòng theo effective_from; cặp liền kề (cur, next)
// mà cur.effective_to = next.effective_from − 2 ngày ⇒ đặt cur.effective_to = next.effective_from − 1.
// Không tự sửa (chỉ liệt kê để xem tay): dòng có effective_to < effective_from (X03, 5B),
// khoảng hở > 1 ngày, chồng lấn, dòng cũ không có effective_to.
//
// Chạy:
//   node --env-file=.env.local scripts/fix-driver-assignment-gaps.mjs            # xem trước
//   node --env-file=.env.local scripts/fix-driver-assignment-gaps.mjs --apply    # ghi DB

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const APPLY = process.argv.includes("--apply")

// Ngày dạng YYYY-MM-DD, tính thuần UTC (không phụ thuộc múi giờ máy chạy).
function shiftDay(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + delta))
  return t.toISOString().slice(0, 10)
}
function diffDays(a, b) {
  const pa = a.split("-").map(Number)
  const pb = b.split("-").map(Number)
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000)
}
const day = (v) => (v ? String(v).slice(0, 10) : null)
function fmt(iso) {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

async function fetchAll(table, cols, orderCol) {
  const PAGE = 1000
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .order(orderCol, { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return out
}

const [rows, vehicles, drivers] = await Promise.all([
  fetchAll(
    "dispatch_vehicle_driver_assignments",
    "id, factory_id, vehicle_id, driver_id, effective_from, effective_to, is_current, created_at",
    "effective_from",
  ),
  fetchAll("dispatch_vehicles", "id, code, name", "code"),
  fetchAll("dispatch_drivers", "id, name", "name"),
])
const vehicleCode = new Map(vehicles.map((v) => [v.id, v.code || v.name || v.id]))
const driverName = new Map(drivers.map((d) => [d.id, d.name || d.id]))

const byVehicle = new Map()
for (const r of rows) {
  const key = `${r.factory_id}|${r.vehicle_id}`
  if (!byVehicle.has(key)) byVehicle.set(key, [])
  byVehicle.get(key).push(r)
}

const fixes = []
const manual = []
const label = (r) =>
  `${driverName.get(r.driver_id) ?? r.driver_id} ${fmt(day(r.effective_from))} → ${fmt(day(r.effective_to))}${r.is_current ? " (hiện hành)" : ""}`

for (const list of byVehicle.values()) {
  list.sort((a, b) =>
    day(a.effective_from) === day(b.effective_from)
      ? String(a.created_at).localeCompare(String(b.created_at))
      : day(a.effective_from) < day(b.effective_from) ? -1 : 1,
  )
  const code = vehicleCode.get(list[0].vehicle_id) ?? list[0].vehicle_id

  for (const r of list) {
    if (r.effective_to && day(r.effective_to) < day(r.effective_from)) {
      manual.push({ code, reason: "Đến ngày < Từ ngày", detail: label(r), id: r.id })
    }
  }

  for (let i = 0; i < list.length - 1; i++) {
    const cur = list[i]
    const next = list[i + 1]
    const curFrom = day(cur.effective_from)
    const curTo = day(cur.effective_to)
    const nextFrom = day(next.effective_from)
    const want = shiftDay(nextFrom, -1)
    if (curTo === want) continue
    if (curTo && curTo < curFrom) continue // đã liệt kê ở trên
    if (!curTo) {
      manual.push({ code, reason: "Dòng cũ chưa đóng (không có Đến ngày)", detail: `${label(cur)} | kế tiếp ${label(next)}`, id: cur.id })
      continue
    }
    const gap = diffDays(curTo, nextFrom) - 1 // số ngày trống giữa 2 dòng
    if (gap === 1 && want >= curFrom) {
      fixes.push({ code, id: cur.id, from: curTo, to: want, detail: `${label(cur)} | kế tiếp ${label(next)}` })
    } else if (gap > 1) {
      manual.push({ code, reason: `Hở ${gap} ngày`, detail: `${label(cur)} | kế tiếp ${label(next)}`, id: cur.id })
    } else if (gap < 0) {
      manual.push({ code, reason: `Chồng lấn ${-gap} ngày`, detail: `${label(cur)} | kế tiếp ${label(next)}`, id: cur.id })
    }
  }
}

console.log(`Đọc ${rows.length} dòng lịch sử / ${byVehicle.size} xe.`)
console.log(`\n== Sẽ sửa tự động (hở đúng 1 ngày): ${fixes.length} dòng ==`)
for (const f of fixes) console.log(`  [${f.code}] Đến ngày ${fmt(f.from)} → ${fmt(f.to)}   (${f.detail})`)
console.log(`\n== Cần xem tay (KHÔNG sửa): ${manual.length} dòng ==`)
for (const m of manual) console.log(`  [${m.code}] ${m.reason}: ${m.detail}   id=${m.id}`)

if (!APPLY) {
  console.log("\nChế độ XEM TRƯỚC — chưa ghi gì. Thêm --apply để ghi.")
  process.exit(0)
}

let ok = 0
for (const f of fixes) {
  const { data, error } = await supabase
    .from("dispatch_vehicle_driver_assignments")
    .update({ effective_to: f.to, updated_at: new Date().toISOString() })
    .eq("id", f.id)
    .eq("effective_to", f.from) // chống ghi đè nếu dữ liệu đã đổi từ lúc đọc
    .select("id")
  if (error) {
    console.error(`  Lỗi [${f.code}] id=${f.id}: ${error.message}`)
  } else if (!data?.length) {
    console.error(`  Bỏ qua [${f.code}] id=${f.id}: dữ liệu đã thay đổi từ lúc đọc`)
  } else ok++
}
console.log(`\nĐã sửa ${ok}/${fixes.length} dòng.`)
