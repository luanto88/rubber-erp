// Nối tài xế (dispatch_drivers) với hồ sơ Nhân sự (maintenance_staff.staff_id) theo tên.
// So khớp không dấu, không phân biệt hoa thường, gộp khoảng trắng. Chỉ nối khi khớp ĐÚNG 1 hồ sơ và hồ sơ đó
// chưa gắn tài xế khác. Tài xế đã có staff_id thì bỏ qua. Mặc định CHỈ XEM; --apply mới ghi.
//   node --env-file=.env.local scripts/link-drivers-to-staff.mjs [--factory=phuochoa_kt] [--apply]
import { createClient } from "@supabase/supabase-js"

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const factoryCode = (args.find((a) => a.startsWith("--factory=")) || "--factory=phuochoa_kt").split("=")[1]
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const norm = (v) =>
  String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()

const { data: factory, error: fErr } = await sb.from("factories").select("id, name").eq("code", factoryCode).single()
if (fErr || !factory) throw new Error(`Không tìm thấy nhà máy ${factoryCode}`)

const [{ data: drivers, error: dErr }, { data: staff, error: sErr }] = await Promise.all([
  sb.from("dispatch_drivers").select("id, code, name, is_active, staff_id").eq("factory_id", factory.id).order("name"),
  sb.from("maintenance_staff").select("id, ten, active").eq("factory_id", factory.id),
])
if (dErr) throw new Error(`Đọc dispatch_drivers lỗi (đã chạy migration 20261201?): ${dErr.message}`)
if (sErr) throw new Error(sErr.message)

const staffByName = new Map()
for (const s of staff) staffByName.set(norm(s.ten), [...(staffByName.get(norm(s.ten)) || []), s])
const taken = new Set(drivers.filter((d) => d.staff_id).map((d) => d.staff_id))

const links = []
const multi = []
const none = []
for (const d of drivers) {
  if (d.staff_id) continue
  const m = staffByName.get(norm(d.name)) || []
  if (m.length === 1 && !taken.has(m[0].id)) {
    links.push({ driver: d, staff: m[0] })
    taken.add(m[0].id)
  } else if (m.length > 1) multi.push(d)
  else none.push(d)
}

console.log(`Nhà máy: ${factory.name} — ${APPLY ? "GHI THẬT" : "CHỈ XEM"}`)
console.log(`Tài xế: ${drivers.length}, đã liên kết sẵn ${drivers.filter((d) => d.staff_id).length}`)
console.log(`\nNối được: ${links.length}`)
for (const l of links) console.log(`  = ${l.driver.code ? `${l.driver.code} ` : ""}${l.driver.name} → ${l.staff.ten}`)
console.log(`\nTrùng nhiều hồ sơ (chọn tay ở Cài đặt): ${multi.length}`)
for (const d of multi) console.log(`  ? ${d.name}`)
console.log(`\nChưa có hồ sơ Nhân sự cùng tên: ${none.length}`)
for (const d of none) console.log(`  - ${d.code ? `${d.code} ` : ""}${d.name}${d.is_active ? "" : " (ngừng)"}`)

if (!APPLY) {
  console.log("\nCHỈ XEM — chạy lại với --apply để ghi.")
  process.exit(0)
}
for (const l of links) {
  const { error } = await sb.from("dispatch_drivers").update({ staff_id: l.staff.id }).eq("id", l.driver.id).eq("factory_id", factory.id)
  if (error) throw new Error(`Nối ${l.driver.name} lỗi: ${error.message}`)
}
console.log(`\nĐÃ GHI: nối ${links.length} tài xế.`)
