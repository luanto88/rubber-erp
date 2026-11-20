// Nhập danh sách công nhân từ cung_cap_dl/danh sách công nhân.xlsx vào Nhân sự (maintenance_staff).
// Cột B = Ca sx ("Ca 1" → Ca A, "Ca 2" → Ca B), cột C = Tên. Thứ tự điểm danh = thứ tự dòng trong ca.
// Mặc định CHỈ XEM; --apply mới ghi.
// - Tên chưa có trong Nhân sự ⇒ tạo mới: loại Công nhân, ca, thứ tự, nguon_tao = 'nhap_excel', đang làm việc.
// - Tên đã có (so khớp không dấu, không phân biệt hoa thường, gộp khoảng trắng) ⇒ chỉ điền ca / thứ tự còn trống;
//   người đã có tài khoản giữ loại "Nhân viên", người chưa có tài khoản đổi sang "Công nhân".
// - Không xoá, không đổi tên ai.
//   node --env-file=.env.local scripts/import-attendance-workers.mjs [--factory=phuochoa_kt] [--file="..."] [--apply]
import XLSX from "xlsx"
import { createClient } from "@supabase/supabase-js"

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const factoryCode = (args.find((a) => a.startsWith("--factory=")) || "--factory=phuochoa_kt").split("=")[1]
const filePath = (args.find((a) => a.startsWith("--file=")) || "--file=cung_cap_dl/danh sách công nhân.xlsx").slice("--file=".length)
const CA_MAP = { "ca 1": "A", "ca 2": "B", "ca 3": "C", "ca a": "A", "ca b": "B", "ca c": "C" }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const norm = (v) =>
  String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim()

const { data: factory, error: fErr } = await sb.from("factories").select("id, code, name").eq("code", factoryCode).single()
if (fErr || !factory) throw new Error(`Không tìm thấy nhà máy ${factoryCode}: ${fErr?.message}`)

const wb = XLSX.readFile(filePath)
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" })
const people = []
const problems = []
const orderByCa = {}
for (let i = 1; i < rows.length; i++) {
  const r = rows[i]
  const caRaw = String(r[1] || "").trim()
  const ten = String(r[2] || "").trim().replace(/\s+/g, " ")
  if (!caRaw && !ten) continue
  if (/^yêu c[âầ]u/i.test(String(r[0] || "")) || typeof r[0] === "number") break // phần ghi chú cuối file
  const ca = CA_MAP[caRaw.toLowerCase()]
  if (!ten) continue
  if (!ca) { problems.push(`Dòng ${i + 1}: "${ten}" — không đọc được ca "${caRaw}"`); continue }
  orderByCa[ca] = (orderByCa[ca] || 0) + 1
  people.push({ dong: i + 1, ten, ca, thu_tu: orderByCa[ca] })
}

const dupInFile = new Map()
for (const p of people) dupInFile.set(norm(p.ten), [...(dupInFile.get(norm(p.ten)) || []), p])
for (const [, list] of dupInFile) if (list.length > 1) problems.push(`Trùng tên trong file: ${list.map((p) => `${p.ten} (dòng ${p.dong})`).join(", ")}`)

const { data: staff, error: sErr } = await sb
  .from("maintenance_staff")
  .select("id, ten, profile_id, loai_nhan_su, ca_mac_dinh, thu_tu_diem_danh, active")
  .eq("factory_id", factory.id)
if (sErr) throw new Error(`Đọc maintenance_staff lỗi (đã chạy migration 20261201?): ${sErr.message}`)
const staffByName = new Map()
for (const s of staff) staffByName.set(norm(s.ten), [...(staffByName.get(norm(s.ten)) || []), s])

const inserts = []
const updates = []
for (const p of people) {
  const match = staffByName.get(norm(p.ten)) || []
  if (match.length > 1) { problems.push(`"${p.ten}" khớp ${match.length} hồ sơ Nhân sự — bỏ qua, xử lý tay`); continue }
  if (match.length === 0) {
    inserts.push({
      factory_id: factory.id,
      ten: p.ten,
      loai_nhan_su: "cong_nhan",
      ca_mac_dinh: p.ca,
      thu_tu_diem_danh: p.thu_tu,
      nguon_tao: "nhap_excel",
      active: true,
    })
    continue
  }
  const s = match[0]
  const patch = {}
  if (!s.ca_mac_dinh) patch.ca_mac_dinh = p.ca
  if (s.thu_tu_diem_danh == null) patch.thu_tu_diem_danh = p.thu_tu
  if (!s.profile_id && s.loai_nhan_su !== "cong_nhan") patch.loai_nhan_su = "cong_nhan"
  if (s.ca_mac_dinh && s.ca_mac_dinh !== p.ca) problems.push(`"${p.ten}" đang ở Ca ${s.ca_mac_dinh}, file ghi Ca ${p.ca} — giữ Ca ${s.ca_mac_dinh}`)
  if (Object.keys(patch).length) updates.push({ id: s.id, ten: s.ten, co_tai_khoan: !!s.profile_id, patch })
}

console.log(`Nhà máy: ${factory.name} — ${APPLY ? "GHI THẬT" : "CHỈ XEM"}`)
console.log(`File: ${people.length} người (Ca A ${orderByCa.A || 0}, Ca B ${orderByCa.B || 0}${orderByCa.C ? `, Ca C ${orderByCa.C}` : ""})`)
console.log(`\nTạo mới (Công nhân): ${inserts.length}`)
for (const r of inserts) console.log(`  + Ca ${r.ca_mac_dinh} #${r.thu_tu_diem_danh} ${r.ten}`)
console.log(`\nĐã có trong Nhân sự, bổ sung: ${updates.length}`)
for (const u of updates) console.log(`  ~ ${u.ten}${u.co_tai_khoan ? " (có tài khoản)" : ""}: ${JSON.stringify(u.patch)}`)
const unchanged = people.length - inserts.length - updates.length - problems.filter((x) => x.startsWith('"')).length
console.log(`\nĐã có, không cần đổi: ${Math.max(0, unchanged)}`)
if (problems.length) {
  console.log(`\nCần xem:`)
  for (const x of problems) console.log(`  ! ${x}`)
}

if (!APPLY) {
  console.log("\nCHỈ XEM — chạy lại với --apply để ghi.")
  process.exit(0)
}
if (inserts.length) {
  const { error } = await sb.from("maintenance_staff").insert(inserts)
  if (error) throw new Error(`Tạo công nhân lỗi: ${error.message}`)
}
for (const u of updates) {
  const { error } = await sb.from("maintenance_staff").update(u.patch).eq("id", u.id).eq("factory_id", factory.id)
  if (error) throw new Error(`Cập nhật ${u.ten} lỗi: ${error.message}`)
}
console.log(`\nĐÃ GHI: tạo ${inserts.length}, cập nhật ${updates.length}.`)
