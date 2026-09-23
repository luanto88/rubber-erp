/**
 * Xuất 1 file GeoJSON gộp cho đúng 26 lô đã được khôi phục hình học (Việc 1, GĐ 2 — xem
 * `cung_cap_dl/danh_sach_lo_can_chay_lai_whisp_impact.xlsx`, sinh bởi
 * `list-plots-needing-whisp-reanalysis.mjs`) để đội tuân thủ chạy lại phân tích rủi ro mất
 * rừng trên Whisp/IMPACT.
 *
 * Dùng ĐÚNG pipeline dựng FeatureCollection mà app thật sẽ dùng khi khách hàng tải file
 * (`buildEudrFeatureCollection()` — cùng hàm `eudr-trace.ts`/`EudrClient.tsx` gọi), không tự
 * viết logic dựng GeoJSON riêng — để file test này phản ánh đúng thứ sẽ thực sự được nộp cho
 * khách hàng sau khi khảo sát xong (mỗi lô nhiều mảnh nở thành N Feature Polygon dùng chung mã
 * lô, diện tích khai báo chia đúng theo tỷ lệ hình học của từng mảnh).
 *
 * Nguồn danh sách 26 mã lô: query trực tiếp `forest_plots.geometry.type = 'MultiPolygon'`
 * (tiêu chí y hệt `list-plots-needing-whisp-reanalysis.mjs`) — không đọc lại từ xlsx, để luôn
 * phản ánh đúng trạng thái DB hiện tại. Script tự đối chiếu với danh sách mã trong file xlsx và
 * cảnh báo nếu lệch (không chặn, chỉ để biết có gì đổi từ lúc giao file Excel).
 *
 * Chạy:  node --env-file=.env.local scripts/export-geojson-whisp-recheck.mjs
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { register } from "node:module"
import { createClient } from "@supabase/supabase-js"
import XLSX from "xlsx"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, "..")

register(pathToFileURL(path.join(__dirname, "_ts-resolve-hook.mjs")))

const { buildForestPlotAliasMap, buildStaticPlotFeatureMap } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-plot-merge.ts")).href
)
const { buildEudrFeatureCollection } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-feature-collection.ts")).href
)
const { serializeEudrGeoJson } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-export-gate.ts")).href
)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "❌ Thiếu biến môi trường Supabase — chạy với: node --env-file=.env.local scripts/export-geojson-whisp-recheck.mjs",
  )
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
      .select("ten, ma_lo_full, geometry, nong_truong, doi, giong, dien_tich_ha, nam_trong, nam_cao_up, factory_id, is_active")
      .order("ten", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

async function loadStaticPlotFeatureCollection() {
  try {
    const filePath = path.join(rootDir, "public", "geojson", "Lo cao su - 2026_Full.geojson")
    const raw = await fs.promises.readFile(filePath, "utf-8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

console.log("Đang tải toàn bộ forest_plots...")
const allPlots = await fetchAllForestPlots()
console.log(`Tổng ${allPlots.length} lô trong cơ sở dữ liệu.`)

const multiPolygonPlots = allPlots.filter((p) => p.geometry?.type === "MultiPolygon" && p.is_active !== false)
const tenList = multiPolygonPlots.map((p) => p.ten)
console.log(`Tìm thấy ${tenList.length} lô đã bị chia mảnh (MultiPolygon) cần chạy lại Whisp/IMPACT.\n`)

// Đối chiếu với danh sách đã giao trong file Excel — chỉ cảnh báo, không chặn.
const xlsxPath = path.join(rootDir, "cung_cap_dl", "danh_sach_lo_can_chay_lai_whisp_impact.xlsx")
if (fs.existsSync(xlsxPath)) {
  const wb = XLSX.readFile(xlsxPath)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
  const xlsxTens = new Set(rows.map((r) => String(r["Mã ngắn (Ten)"] || "").trim()).filter(Boolean))
  const dbTens = new Set(tenList)
  const onlyInXlsx = [...xlsxTens].filter((t) => !dbTens.has(t))
  const onlyInDb = [...dbTens].filter((t) => !xlsxTens.has(t))
  if (onlyInXlsx.length === 0 && onlyInDb.length === 0) {
    console.log(`✅ Khớp đúng ${xlsxTens.size} mã lô với file Excel đã giao trước đó.\n`)
  } else {
    console.log("⚠️  Danh sách lệch so với file Excel đã giao trước đó:")
    if (onlyInXlsx.length) console.log(`   Có trong Excel nhưng không còn là MultiPolygon: ${onlyInXlsx.join(", ")}`)
    if (onlyInDb.length) console.log(`   Có trong DB nhưng chưa có trong Excel: ${onlyInDb.join(", ")}`)
    console.log("")
  }
} else {
  console.log("⚠️  Không tìm thấy file Excel đối chiếu — bỏ qua bước so khớp.\n")
}

if (tenList.length === 0) {
  console.log("Không có lô nào cần xuất — dừng.")
  process.exit(0)
}

// factory_id: lấy trực tiếp từ chính các dòng đã query (đây là dữ liệu 1 nhà máy duy nhất
// trong toàn bộ tập forest_plots hiện có — không hard-code).
const factoryIds = [...new Set(multiPolygonPlots.map((p) => p.factory_id).filter(Boolean))]
if (factoryIds.length > 1) {
  console.log(`⚠️  Các lô trải trên ${factoryIds.length} nhà máy khác nhau (${factoryIds.join(", ")}) — file alias sẽ query từng nhà máy riêng.`)
}

const dbPlotMap = new Map(multiPolygonPlots.map((p) => [p.ten, p]))

let aliasRows = []
for (const fid of factoryIds) {
  const { data } = await sb
    .from("forest_plot_code_aliases")
    .select("alias_ten, canonical_ten")
    .eq("factory_id", fid)
    .eq("is_active", true)
    .in("alias_ten", tenList)
  aliasRows.push(...(data || []))
}
const aliasMap = buildForestPlotAliasMap(aliasRows)

const full = await loadStaticPlotFeatureCollection()
const staticPlotMap = buildStaticPlotFeatureMap(full)

const exportDate = new Date().toISOString().split("T")[0]

const { collection, cleanLog, lostPlots } = buildEudrFeatureCollection({
  plotCodes: tenList,
  dbPlots: dbPlotMap,
  staticPlots: staticPlotMap,
  exportDate,
  aliasMap,
})

console.log(`Dựng xong FeatureCollection: ${collection.features.length} feature từ ${tenList.length} mã lô.`)
if (lostPlots.length > 0) {
  console.log(`⚠️  ${lostPlots.length} mã lô MẤT SẠCH hình học sau khi làm sạch: ${lostPlots.join(", ")}`)
}

// Chạy qua đúng cổng serialize dùng chung (shadow mode, block:false) để có validation quan sát
// — KHÔNG chặn xuất file test này (đây không phải file giao khách hàng qua cổng thật).
const { json, validation } = serializeEudrGeoJson(collection, { cleanLog, block: false })

console.log(
  `\nKiểm tra chất lượng dữ liệu (không chặn): ${validation.blocking.length} lỗi Mức 3, ` +
    `${validation.warnings.length} cảnh báo Mức 2, ${validation.fixed.length} lỗi Mức 1 (đã tự sửa).`,
)
if (validation.blocking.length > 0) {
  console.log("  Lỗi Mức 3 (sẽ bị CHẶN nếu xuất qua cổng khách hàng thật):")
  for (const i of validation.blocking) console.log(`    ❌ [${i.plotCode}] ${i.message}`)
}
if (validation.warnings.length > 0) {
  console.log("  Cảnh báo Mức 2 (đã loại khỏi file / ghi rõ, không chặn):")
  for (const i of validation.warnings) console.log(`    ⚠️  [${i.plotCode}] ${i.message}`)
}

const outPath = path.join(rootDir, "cung_cap_dl", "danh_sach_lo_can_chay_lai_whisp_impact.geojson")
fs.writeFileSync(outPath, json, "utf-8")

console.log(`\n✅ Đã xuất file GeoJSON:`)
console.log(`   ${outPath}`)
console.log(`   ${collection.features.length} feature, ${tenList.length} mã lô, export_date=${exportDate}.`)
console.log("\nGiao file này cho đội Whisp/IMPACT để chạy lại phân tích rủi ro mất rừng trên đúng")
console.log("hình học ĐÃ KHÔI PHỤC (101,39 ha) — cùng định dạng sẽ dùng khi xuất thật cho khách hàng.")
