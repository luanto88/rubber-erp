// Ghép giới tính + tổ trưởng ca cho công nhân từ cung_cap_dl/DS_CN.pdf (danh sách đã chép dưới đây).
// Mặc định CHỈ XEM; --apply mới ghi. Chỉ ghi khi tên khớp ĐÚNG 1 nhân sự (không dấu, không phân biệt hoa thường,
// bỏ khoảng trắng thừa). Tên không khớp / khớp nhiều được in ra để xử lý tay ở Cài đặt → Nhân sự.
// Cần migration 20261206 (cột to_vai_tro, to_pham_vi).
//   node --env-file=.env.local scripts/import-worker-gender.mjs [--factory=phuochoa_kt] [--apply]
import { createClient } from "@supabase/supabase-js"

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const factoryCode = (args.find((a) => a.startsWith("--factory=")) || "--factory=phuochoa_kt").split("=")[1]

// [họ tên, giới tính, ca (1 → A, 2 → B), chức vụ]
const DS = [
  ["Khean Sok Khoeun", "Nam", 1, "Ca trưởng"], ["Orn Srey La", "Nữ", 1], ["Choun Socheat", "Nam", 1], ["Prak nav", "Nữ", 1],
  ["Khoem Yun", "Nam", 1], ["Yun Lun", "Nữ", 1], ["So Rossith", "Nam", 1], ["Muong Nao", "Nam", 1], ["Chheng Kung", "Nam", 1],
  ["Khorn Vuthea", "Nam", 1], ["Sokh Konthea", "Nam", 1], ["Teng Chanda", "Nam", 1], ["Khorn Vuthy", "Nam", 1],
  ["Ang Kolab", "Nữ", 1], ["Mech Sok Ngim", "Nữ", 1], ["Sea Kim San", "Nam", 1], ["Voeurn Vy", "Nam", 1], ["Thet Phally", "Nữ", 1],
  ["Khean Soros", "Nam", 1], ["Eng Yuthdy", "Nam", 1], ["Ry Dany", "Nữ", 1], ["Khiev Chantha", "Nam", 1],
  ["Chea Eng", "Nữ", 2], ["Thon Tha", "Nam", 2], ["Thon Thai", "Nam", 2], ["Binh Ban", "Nam", 2, "Ca trưởng"],
  ["San Chheng Han", "Nam", 2], ["San Cham Reun", "Nữ", 2], ["San Sreyon", "Nữ", 2], ["Ban Butty", "Nam", 2],
  ["Lon Kim Heang", "Nữ", 2], ["Yun Sok Ny", "Nữ", 2], ["Ban Vuthy", "Nam", 2], ["Thun Thuy", "Nam", 2], ["Hon Rasa", "Nữ", 2],
  ["Ol Sam Ath", "Nam", 2], ["On Kimchheng", "Nam", 2], ["Som Si Doung", "Nam", 2], ["San Sok Ly", "Nam", 2],
  ["Neth Vannak", "Nam", 2], ["Beav Vit", "Nam", 2], ["Sen Malai", "Nữ", 2], ["Mich Seng Leab", "Nữ", 2], ["Pheap Phin", "Nam", 2],
]

const norm = (v) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, "")

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: factory, error: fErr } = await sb.from("factories").select("id, code, name").eq("code", factoryCode).single()
if (fErr || !factory) throw new Error(`Không tìm thấy nhà máy ${factoryCode}: ${fErr?.message}`)
const { data: staff, error: sErr } = await sb
  .from("maintenance_staff")
  .select("id, ten, gioi_tinh, ca_mac_dinh, loai_nhan_su, to_vai_tro, to_pham_vi")
  .eq("factory_id", factory.id)
if (sErr) throw new Error(`Đọc nhân sự lỗi (đã chạy migration 20261206?): ${sErr.message}`)
console.log(`Nhà máy: ${factory.name} — ${APPLY ? "GHI THẬT" : "CHỈ XEM"}\n`)

const byName = new Map()
for (const s of staff) {
  const k = norm(s.ten)
  byName.set(k, [...(byName.get(k) || []), s])
}

const updates = []
const problems = []
for (const [ten, gt, caNum, chucVu] of DS) {
  const hits = byName.get(norm(ten)) || []
  if (hits.length !== 1) {
    problems.push(`${ten}: ${hits.length === 0 ? "không có trong Nhân sự" : `khớp ${hits.length} người`}`)
    continue
  }
  const s = hits[0]
  const ca = caNum === 1 ? "A" : "B"
  const patch = {}
  if (s.gioi_tinh !== gt) patch.gioi_tinh = gt
  if (chucVu === "Ca trưởng" && (s.to_vai_tro !== "to_truong" || s.to_pham_vi !== "ca_san_xuat")) {
    patch.to_vai_tro = "to_truong"
    patch.to_pham_vi = "ca_san_xuat"
  }
  if (s.ca_mac_dinh && s.ca_mac_dinh !== ca) problems.push(`${ten}: DS ghi Ca ${caNum} (${ca}) nhưng Nhân sự đang ca ${s.ca_mac_dinh} — KHÔNG đổi ca`)
  if (s.loai_nhan_su !== "cong_nhan") problems.push(`${ten}: đang là "${s.loai_nhan_su}" — KHÔNG đổi loại`)
  if (Object.keys(patch).length) updates.push({ id: s.id, ten: s.ten, patch })
}

console.log(`Cập nhật ${updates.length} người:`)
for (const u of updates) console.log(`  ~ ${u.ten}: ${Object.entries(u.patch).map(([k, v]) => `${k}=${v}`).join(", ")}`)
console.log(`\nCần xem tay (${problems.length}):`)
for (const p of problems) console.log(`  ! ${p}`)

if (!APPLY) {
  console.log("\nCHỈ XEM — chạy lại với --apply để ghi.")
  process.exit(0)
}
for (const u of updates) {
  const { error } = await sb.from("maintenance_staff").update(u.patch).eq("id", u.id).eq("factory_id", factory.id)
  if (error) throw new Error(`Cập nhật ${u.ten} lỗi: ${error.message}`)
}
console.log(`\nĐÃ GHI ${updates.length} người.`)
