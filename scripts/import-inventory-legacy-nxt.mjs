/**
 * Nhập file NXT cũ (AppSheet, 01/01–31/07/2026) vào bảng `inventory_legacy_movements` — dữ liệu LỊCH SỬ chỉ phục vụ
 * báo cáo sử dụng theo ngày (55-BC / 46-BC). KHÔNG ghi inventory_stock_movements / tồn / thẻ kho. Rule 13.
 *
 * Chạy (cwd = gốc repo, SAU migration 20261125_inventory_daily_reports.sql):
 *   node --env-file=.env.local scripts/import-inventory-legacy-nxt.mjs --dry-run   # chỉ đọc, in thống kê + trùng
 *   node --env-file=.env.local scripts/import-inventory-legacy-nxt.mjs --apply     # ghi (upsert theo legacy_id)
 * Tuỳ chọn: --file "<đường dẫn xlsx>"  --factory phuochoa_kt
 *
 * Trùng với dữ liệu thật: loader báo cáo gộp theo (ngày, vật tư) — có phát sinh thật thì dùng thật, không cộng lịch sử
 * (người dùng chốt 2026-11-15, kể cả ngày 24/07). Script vẫn nhập đủ để tra cứu; dry-run liệt kê các ô sẽ bị bỏ qua.
 */
import { createClient } from "@supabase/supabase-js"
import XLSX from "xlsx"
import path from "node:path"

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const argVal = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const FILE = argVal("--file", "cung_cap_dl/du_lieu_cu/NXT từ tháng 1 đến tháng 7 (1).xlsx")
const FACTORY = argVal("--factory", "phuochoa_kt")
if (!APPLY && !args.includes("--dry-run")) {
  console.error("Thiếu --dry-run hoặc --apply")
  process.exit(1)
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const excelDate = (v) => {
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10)
  const s = String(v || "").trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

async function fetchAll(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

const { data: fac, error: fErr } = await sb.from("factories").select("id,code").eq("code", FACTORY).maybeSingle()
if (fErr || !fac) throw new Error(`Không thấy nhà máy ${FACTORY}`)

const wb = XLSX.readFile(FILE)
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
const items = await fetchAll(() => sb.from("inventory_items").select("id,code").eq("factory_id", fac.id).order("id"))
const itemByCode = new Map(items.map((i) => [String(i.code).trim(), i.id]))

const records = []
const unknown = new Map()
const bad = []
for (const r of rows) {
  const ma = String(r["Mã NX"] || "").trim()
  if (!ma) continue
  const ngay = excelDate(r["Ngày NX"])
  const code = String(r["Mã vật tư"] || "").trim()
  const qty = Number(r["Số lượng"])
  const itemId = itemByCode.get(code)
  if (!ngay || !Number.isFinite(qty) || !r["ID"]) {
    bad.push(r["ID"] || ma)
    continue
  }
  if (!itemId) {
    unknown.set(code, (unknown.get(code) || 0) + 1)
    continue
  }
  records.push({
    factory_id: fac.id,
    legacy_id: String(r["ID"]),
    ngay,
    item_id: itemId,
    item_code: code,
    movement_type: ma.startsWith("N") ? "import" : "export",
    quantity: qty,
    ma_nx: ma,
    warehouse_name: r["Tên kho"] || null,
    nguoi_nx: r["Người NX"] || null,
    ghi_chu: r["Ghi chú"] ? String(r["Ghi chú"]) : null,
    source_file: path.basename(FILE),
  })
}

// Thống kê theo tháng
const byMonth = {}
for (const x of records) {
  const k = x.ngay.slice(0, 7)
  byMonth[k] = byMonth[k] || { import: 0, export: 0 }
  byMonth[k][x.movement_type]++
}
console.log(`File: ${FILE}`)
console.log(`Dòng hợp lệ: ${records.length} · mã không có trong danh mục: ${[...unknown].map(([c, n]) => `${c}(${n})`).join(", ") || "không"} · dòng lỗi: ${bad.length}`)
console.table(byMonth)

// Ô (ngày, vật tư) xuất kho đã có dữ liệu thật ⇒ báo cáo sẽ dùng số thật, bỏ lịch sử.
const days = records.filter((x) => x.movement_type === "export").map((x) => x.ngay).sort()
const real = await fetchAll(() =>
  sb.from("inventory_stock_movements").select("id,item_id,movement_date,quantity_out").eq("factory_id", fac.id).eq("movement_type", "export").gte("movement_date", days[0]).lte("movement_date", days.at(-1)).order("id"),
)
const realAgg = new Map()
for (const r of real) {
  const k = `${String(r.movement_date).slice(0, 10)}|${r.item_id}`
  realAgg.set(k, (realAgg.get(k) || 0) + Number(r.quantity_out || 0))
}
const legAgg = new Map()
for (const x of records.filter((x) => x.movement_type === "export")) {
  const k = `${x.ngay}|${x.item_id}`
  legAgg.set(k, { code: x.item_code, q: (legAgg.get(k)?.q || 0) + x.quantity })
}
const overlap = [...legAgg].filter(([k]) => realAgg.has(k)).map(([k, v]) => ({ ngay: k.split("|")[0], ma: v.code, lich_su: v.q, that: realAgg.get(k), lech: realAgg.get(k) !== v.q ? "LỆCH" : "" }))
console.log(`Ô trùng với dữ liệu thật (báo cáo dùng số thật): ${overlap.length}`)
if (overlap.length) console.table(overlap)

if (!APPLY) {
  console.log("DRY-RUN — không ghi gì. Chạy lại với --apply để nhập.")
  process.exit(0)
}
let done = 0
for (let i = 0; i < records.length; i += 200) {
  const part = records.slice(i, i + 200)
  const { error } = await sb.from("inventory_legacy_movements").upsert(part, { onConflict: "factory_id,legacy_id" })
  if (error) throw error
  done += part.length
}
console.log(`Đã nhập / cập nhật ${done} dòng vào inventory_legacy_movements.`)
