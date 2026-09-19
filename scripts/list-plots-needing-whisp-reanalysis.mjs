/**
 * ⚠️ VIỆC BẮT BUỘC NGOÀI PHẠM VI CODE — xem CLAUDE.md / kế hoạch phiên GĐ4-6 EUDR.
 *
 * GĐ2 đã khôi phục 101,39 ha diện tích vùng trồng bị mất do quy tắc dedupe cũ (29 lô bị
 * đường/suối cắt thành nhiều mảnh, mỗi mảnh trước đây bị vứt bỏ trừ mảnh đầu tiên). Bộ hồ sơ
 * tuân thủ EUDR (Whisp + IMPACT — phân tích rủi ro mất rừng) đang chạy trên hình học CŨ, thiếu
 * đúng phần diện tích này — 101,39 ha đó hiện CHƯA CÓ bằng chứng phân tích rủi ro theo đúng
 * nghĩa EUDR.
 *
 * Script này CHỈ ĐỌC — xuất danh sách các lô đã được gộp mảnh (nhận diện qua
 * `forest_plots.geometry.type === 'MultiPolygon'`, vì mọi lô 1-mảnh luôn là `Polygon`, chỉ lô
 * nhiều mảnh mới thành `MultiPolygon` sau khi qua `mergeGeometryPieces()`) để đội tuân
 * thủ/Whisp-IMPACT dùng trực tiếp — không tự chạy lại Whisp/IMPACT (việc đó ngoài phạm vi code).
 *
 * Chạy: node --env-file=.env.local scripts/list-plots-needing-whisp-reanalysis.mjs
 */

import XLSX from "xlsx"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, "..")

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Thiếu biến môi trường Supabase — chạy với: node --env-file=.env.local scripts/list-plots-needing-whisp-reanalysis.mjs")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function fetchAllForestPlots() {
  const PAGE_SIZE = 500
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await sb
      .from("forest_plots")
      .select("ten, ma_lo_full, dien_tich_ha, nong_truong, doi, geometry, factory_id")
      .order("ten", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

console.log("Đang tải toàn bộ forest_plots...")
const plots = await fetchAllForestPlots()
console.log(`Tổng ${plots.length} lô trong cơ sở dữ liệu.`)

const multiPolygonPlots = plots.filter((p) => p.geometry?.type === "MultiPolygon")

console.log(`Tìm thấy ${multiPolygonPlots.length} lô đã bị chia mảnh (MultiPolygon) — cần chạy lại Whisp/IMPACT.\n`)

const rows = multiPolygonPlots.map((p, idx) => ({
  STT: idx + 1,
  "Mã ngắn (Ten)": p.ten,
  "Mã lô đầy đủ": p.ma_lo_full || "",
  "Diện tích khai báo (ha)": p.dien_tich_ha ?? "",
  "Nông trường": p.nong_truong || "",
  "Đội": p.doi ?? "",
  "Số mảnh": Array.isArray(p.geometry?.coordinates) ? p.geometry.coordinates.length : "",
}))

const wb = XLSX.utils.book_new()
const ws = XLSX.utils.json_to_sheet(rows)
ws["!cols"] = [
  { wch: 6 },  // STT
  { wch: 16 }, // Ten
  { wch: 22 }, // Ma lo full
  { wch: 20 }, // Dien tich
  { wch: 14 }, // Nong truong
  { wch: 8 },  // Doi
  { wch: 10 }, // So manh
]
XLSX.utils.book_append_sheet(wb, ws, "Lo_can_chay_lai_Whisp_IMPACT")

const outPath = path.join(rootDir, "cung_cap_dl", "danh_sach_lo_can_chay_lai_whisp_impact.xlsx")
XLSX.writeFile(wb, outPath)

console.log(`✅ Đã xuất ${rows.length} lô ra file Excel:`)
console.log(`   ${outPath}`)
console.log("\nGiao file này cho đội tuân thủ/Whisp-IMPACT để chạy lại phân tích rủi ro mất rừng")
console.log("trên đúng hình học ĐÃ KHÔI PHỤC (101,39 ha) — trước khi gửi bộ hồ sơ tiếp theo cho bất kỳ khách hàng nào.")
