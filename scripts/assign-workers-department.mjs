// Gán phòng ban cho công nhân (maintenance_staff.loai_nhan_su = 'cong_nhan') chưa có phòng ban — để trưởng phòng
// (quyền attendance.mark) chấm công được người cùng phòng. Mặc định phòng ban NMCB (Nhà máy chế biến).
// Chỉ đụng người CHƯA có phòng ban; mặc định CHỈ XEM, --apply mới ghi.
//   node --env-file=.env.local scripts/assign-workers-department.mjs [--factory=phuochoa_kt] [--dept=NMCB] [--apply]
import { createClient } from "@supabase/supabase-js"

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const factoryCode = (args.find((a) => a.startsWith("--factory=")) || "--factory=phuochoa_kt").split("=")[1]
const deptCode = (args.find((a) => a.startsWith("--dept=")) || "--dept=NMCB").split("=")[1]
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: factory, error: fErr } = await sb.from("factories").select("id, name").eq("code", factoryCode).single()
if (fErr || !factory) throw new Error(`Không tìm thấy nhà máy ${factoryCode}`)
const { data: dept, error: dErr } = await sb.from("departments").select("id, code, name").eq("code", deptCode).single()
if (dErr || !dept) throw new Error(`Không tìm thấy phòng ban ${deptCode}`)

const { data: staff, error } = await sb
  .from("maintenance_staff")
  .select("id, ten, ca_mac_dinh, department_id, phong_ban")
  .eq("factory_id", factory.id)
  .eq("loai_nhan_su", "cong_nhan")
  .order("ca_mac_dinh")
  .order("thu_tu_diem_danh")
if (error) throw new Error(error.message)

const targets = staff.filter((s) => !s.department_id)
console.log(`Nhà máy: ${factory.name} — ${APPLY ? "GHI THẬT" : "CHỈ XEM"}`)
console.log(`Phòng ban gán: ${dept.name} (${dept.code})`)
console.log(`Công nhân: ${staff.length}, chưa có phòng ban: ${targets.length}, đã có (giữ nguyên): ${staff.length - targets.length}`)
for (const s of targets) console.log(`  + Ca ${s.ca_mac_dinh || "?"} ${s.ten}`)

if (!APPLY) {
  console.log("\nCHỈ XEM — chạy lại với --apply để ghi.")
  process.exit(0)
}
const ids = targets.map((s) => s.id)
for (let i = 0; i < ids.length; i += 200) {
  const { error: uErr } = await sb
    .from("maintenance_staff")
    .update({ department_id: dept.id, phong_ban: dept.name })
    .in("id", ids.slice(i, i + 200))
    .eq("factory_id", factory.id)
    .is("department_id", null)
  if (uErr) throw new Error(uErr.message)
}
console.log(`\nĐÃ GHI: gán ${ids.length} công nhân vào ${dept.name}.`)
