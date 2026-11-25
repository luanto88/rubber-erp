// Kiểm C3 "Có mặt tự động" (CHỈ ĐỌC, service role). Chạy SAU migration 20261214.
//   node --env-file=.env.local scripts/check-attendance-auto.mjs [--factory=phuochoa_kt] [--month=2026-11]
// 1. Gọi attendance_collect_activity cho tháng → số ngày có hoạt động từng nhân viên + nguồn.
// 2. Đếm lại độc lập bằng JS cho 4 nguồn lớn (điều xe, sản lượng, thành phẩm, kiểm nghiệm) — phải khớp tập ngày của RPC.
// 3. Liệt kê ô dự kiến mâu thuẫn (đang chấm Nghỉ mà có hoạt động) và ô tự động sẽ bị bỏ (không còn hoạt động).
import { createClient } from "@supabase/supabase-js"

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d
const FACTORY_CODE = arg("factory", "phuochoa_kt")
const MONTH = arg("month", new Date().toISOString().slice(0, 7))
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const [y, m] = MONTH.split("-").map(Number)
const from = `${MONTH}-01`
const to = `${MONTH}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`
const vnDay = (ts) => new Date(new Date(ts).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
const t0 = new Date(`${from}T00:00:00+07:00`).toISOString()
const t1 = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400000).toISOString()

async function fetchAll(build) {
  const out = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await build().range(off, off + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

const { data: fac, error: fErr } = await sb.from("factories").select("id, name").eq("code", FACTORY_CODE).single()
if (fErr) throw fErr
console.log(`Nhà máy ${fac.name} · tháng ${MONTH} (${from} → ${to})\n`)

const { data: acts, error: aErr } = await sb.rpc("attendance_collect_activity", { p_factory_id: fac.id, p_from: from, p_to: to })
if (aErr) throw new Error(`RPC lỗi (đã chạy migration 20261214 chưa?): ${aErr.message}`)

const staff = await fetchAll(() =>
  sb.from("maintenance_staff").select("id, ten, profile_id, loai_nhan_su, ngay_vao_lam, ngay_nghi_viec").eq("factory_id", fac.id).order("id"),
)
const staffByProfile = new Map(staff.filter((s) => s.profile_id && (s.loai_nhan_su || "nhan_vien") === "nhan_vien").map((s) => [s.profile_id, s]))

// 1. Tổng hợp theo nhân viên
const byStaff = new Map()
for (const a of acts) {
  const s = staffByProfile.get(a.profile_id)
  if (!s) continue
  if ((s.ngay_vao_lam && a.ngay < s.ngay_vao_lam) || (s.ngay_nghi_viec && a.ngay > s.ngay_nghi_viec)) continue
  const e = byStaff.get(s.id) || { ten: s.ten, days: new Set(), d: new Set(), nguon: new Map() }
  e.days.add(a.ngay)
  if (a.nguon === "cham_diem_d") e.d.add(a.ngay)
  e.nguon.set(a.nguon, (e.nguon.get(a.nguon) || 0) + 1)
  byStaff.set(s.id, e)
}
console.log("Nhân viên | ngày có hoạt động | trong đó chấm D | nguồn (số ngày)")
for (const e of [...byStaff.values()].sort((a, b) => b.days.size - a.days.size)) {
  console.log(`${e.ten.padEnd(28)} ${String(e.days.size).padStart(3)}  ${String(e.d.size).padStart(3)}   ${[...e.nguon].map(([k, v]) => `${k}:${v}`).join(", ")}`)
}
const noAccountRows = acts.filter((a) => !staffByProfile.has(a.profile_id)).length
console.log(`\nDòng hoạt động của tài khoản KHÔNG phải nhân viên có hồ sơ (bỏ qua): ${noAccountRows}`)

// 2. Đếm độc lập 4 nguồn
const rpcKey = new Set(acts.map((a) => `${a.profile_id}|${a.ngay}|${a.nguon}`))
const jsKey = new Set()
const add = (uid, ts, nguon) => uid && ts && jsKey.add(`${uid}|${vnDay(ts)}|${nguon}`)
for (const r of await fetchAll(() => sb.from("dispatch_entries").select("created_by, created_at").eq("factory_id", fac.id).gte("created_at", t0).lt("created_at", t1).order("id")))
  add(r.created_by, r.created_at, "dieu_xe")
for (const r of await fetchAll(() => sb.from("production_records").select("created_by, created_at").eq("factory_id", fac.id).gte("created_at", t0).lt("created_at", t1).order("id")))
  add(r.created_by, r.created_at, "san_luong")
for (const r of await fetchAll(() => sb.from("qc_results").select("created_by, created_at").eq("factory_id", fac.id).gte("created_at", t0).lt("created_at", t1).order("id")))
  add(r.created_by, r.created_at, "kiem_nghiem")
for (const r of await fetchAll(() =>
  sb.from("lot_transactions").select("created_by, created_at, quet_luc, lots!inner(factory_id)").eq("lots.factory_id", fac.id)
    .gte("created_at", t0).lt("created_at", new Date(new Date(t1).getTime() + 86400000).toISOString()).order("id"),
)) {
  const ts = r.quet_luc || r.created_at
  if (ts >= t0 && ts < t1) add(r.created_by, ts, "thanh_pham")
}
const checked = ["dieu_xe", "san_luong", "kiem_nghiem", "thanh_pham"]
const rpcSub = [...rpcKey].filter((k) => checked.includes(k.split("|")[2]))
const thieu = [...jsKey].filter((k) => !rpcKey.has(k))
// thanh_pham của RPC còn gồm nháp + admin sửa ⇒ chỉ báo phần thừa ở 3 nguồn còn lại.
const thua = rpcSub.filter((k) => !jsKey.has(k) && k.split("|")[2] !== "thanh_pham")
console.log(`\nĐối chiếu 4 nguồn: JS ${jsKey.size} · RPC ${rpcSub.length} · RPC thiếu ${thieu.length} · RPC thừa ${thua.length}`)
for (const k of [...thieu, ...thua].slice(0, 20)) console.log("  lệch:", k)

// 3. Mâu thuẫn dự kiến / dòng tự động sẽ bị bỏ
const recs = await fetchAll(() =>
  sb.from("attendance_records").select("staff_id, ngay, trang_thai, nguon").eq("factory_id", fac.id).gte("ngay", from).lte("ngay", to).order("id"),
)
const actDays = new Set()
for (const [sid, e] of byStaff) for (const d of e.days) actDays.add(`${sid}|${d}`)
const tenOf = new Map(staff.map((s) => [s.id, s.ten]))
const conflicts = recs.filter((r) => r.trang_thai !== "co_mat" && actDays.has(`${r.staff_id}|${r.ngay}`))
const orphans = recs.filter((r) => ["auto_app", "cham_diem_d"].includes(r.nguon) && !actDays.has(`${r.staff_id}|${r.ngay}`))
console.log(`\nÔ mâu thuẫn dự kiến: ${conflicts.length}`)
for (const r of conflicts.slice(0, 30)) console.log(`  ${tenOf.get(r.staff_id)} ${r.ngay} ${r.trang_thai} (${r.nguon})`)
console.log(`Ô tự động sẽ bị bỏ (không còn hoạt động): ${orphans.length}`)
