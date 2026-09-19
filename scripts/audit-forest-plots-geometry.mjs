/**
 * Kiểm kê CHỈ ĐỌC 4 loại vấn đề còn lại trong dữ liệu Lô vườn — KHÔNG sửa gì, chỉ xuất Excel để
 * đội trắc địa xác minh thực địa trước khi ai đó quyết định sửa. Việc sửa dữ liệu diện tích/mã
 * lô/hình học sau khi có kết quả trắc địa là việc CỦA NGƯỜI DÙNG, không phải của script này.
 *
 * 4 sheet:
 *   Lech_Dien_Tich     — forest_plots.dien_tich_ha lệch >10% so với diện tích tính từ hình học
 *                         đã lưu trong DB, kèm toạ độ trọng tâm để nhập GPS, sắp theo % giảm dần.
 *   ID_Trung           — nhiều lô (ten khác nhau) cùng dùng chung 1 ma_lo_full.
 *   Ky_Tu_Hong         — ten/ma_lo_full/nong_truong/giong chứa ký tự lỗi encoding (U+FFFD).
 *   Sinh_Doi_Thoai_Hoa — ⚠️ heuristic suy luận, KHÔNG phải định nghĩa chính thức (xem chú thích
 *                         trong code): đọc file GeoJSON NGUỒN (không phải forest_plots DB — DB
 *                         đã được GĐ2 gộp/lọc sạch), nhóm feature theo Ten, gắn cờ nhóm ≥2 mảnh
 *                         mà mảnh nhỏ nhất <0,001 ha (nhỏ hơn 10 lần ngưỡng lọc chuẩn
 *                         MIN_PIECE_AREA_HA=0,01 ha) — dựa trên 3 ví dụ đã biết từ khôi phục dữ
 *                         liệu GĐ2, không phải xác nhận chính thức.
 *
 * Chạy: node --env-file=.env.local scripts/audit-forest-plots-geometry.mjs
 */

import XLSX from "xlsx"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { register } from "node:module"
import { createClient } from "@supabase/supabase-js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, "..")

register(pathToFileURL(path.join(__dirname, "_ts-resolve-hook.mjs")))
const { calculateGeometryAreaHa, MIN_PIECE_AREA_HA } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-geometry-cleaner.ts")).href
)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Thiếu biến môi trường Supabase — chạy với: node --env-file=.env.local scripts/audit-forest-plots-geometry.mjs")
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
      .select("id, factory_id, ten, ma_lo_full, dien_tich_ha, nong_truong, doi, giong, geometry")
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
console.log(`Tổng ${plots.length} lô trong cơ sở dữ liệu.\n`)

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 1 — Lech_Dien_Tich

function computeCentroid(geometry) {
  if (!geometry) return { lon: null, lat: null }
  const exteriorRings =
    geometry.type === "Polygon"
      ? [geometry.coordinates?.[0]]
      : geometry.type === "MultiPolygon"
        ? (geometry.coordinates || []).map((poly) => poly?.[0])
        : []
  let sumLon = 0
  let sumLat = 0
  let count = 0
  for (const ring of exteriorRings) {
    if (!Array.isArray(ring)) continue
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) continue
      sumLon += pt[0]
      sumLat += pt[1]
      count++
    }
  }
  if (count === 0) return { lon: null, lat: null }
  return { lon: sumLon / count, lat: sumLat / count }
}

const areaDiffRows = []
for (const p of plots) {
  const declared = p.dien_tich_ha
  const geomHa = calculateGeometryAreaHa(p.geometry)
  const declaredNum = typeof declared === "number" ? declared : Number(declared)
  const hasDeclared = Number.isFinite(declaredNum) && declaredNum > 0
  const diffHa = geomHa - (hasDeclared ? declaredNum : 0)
  const diffPct = hasDeclared ? (Math.abs(diffHa) / declaredNum) * 100 : (geomHa > 0 ? 100 : 0)
  if (diffPct <= 10) continue
  const { lon, lat } = computeCentroid(p.geometry)
  areaDiffRows.push({
    ten: p.ten,
    ma_lo_full: p.ma_lo_full || "",
    nong_truong: p.nong_truong || "",
    doi: p.doi ?? "",
    declared_ha: hasDeclared ? declaredNum : "",
    geom_ha: Number(geomHa.toFixed(4)),
    diff_ha: Number(diffHa.toFixed(4)),
    diff_pct: Number(diffPct.toFixed(1)),
    centroid_lon: lon != null ? Number(lon.toFixed(6)) : "",
    centroid_lat: lat != null ? Number(lat.toFixed(6)) : "",
    note: hasDeclared ? "" : "Chưa có diện tích khai báo trong forest_plots.dien_tich_ha",
  })
}
areaDiffRows.sort((a, b) => Math.abs(b.diff_pct) - Math.abs(a.diff_pct))
console.log(`[Lech_Dien_Tich] ${areaDiffRows.length} lô lệch >10% so với diện tích khai báo.`)

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 2 — ID_Trung

const byMaLoFull = new Map()
for (const p of plots) {
  const code = (p.ma_lo_full || "").trim()
  if (!code) continue
  const list = byMaLoFull.get(code)
  if (list) list.push(p)
  else byMaLoFull.set(code, [p])
}
const duplicateGroups = [...byMaLoFull.entries()].filter(([, list]) => list.length > 1)
const idTrungRows = []
duplicateGroups.forEach(([code, list], groupIdx) => {
  for (const p of list) {
    idTrungRows.push({
      nhom: groupIdx + 1,
      ma_lo_full: code,
      ten: p.ten,
      nong_truong: p.nong_truong || "",
      doi: p.doi ?? "",
      dien_tich_ha: p.dien_tich_ha ?? "",
    })
  }
})
console.log(`[ID_Trung] ${duplicateGroups.length} mã lô đầy đủ (ma_lo_full) bị dùng chung bởi ≥2 lô (${idTrungRows.length} dòng).`)

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 3 — Ky_Tu_Hong

const REPLACEMENT_CHAR = "�"
const brokenCharRows = []
for (const p of plots) {
  const fields = { ten: p.ten, ma_lo_full: p.ma_lo_full, nong_truong: p.nong_truong, giong: p.giong }
  const brokenFields = Object.entries(fields)
    .filter(([, v]) => typeof v === "string" && v.includes(REPLACEMENT_CHAR))
    .map(([k]) => k)
  if (brokenFields.length === 0) continue
  brokenCharRows.push({
    ten: p.ten,
    ma_lo_full: p.ma_lo_full || "",
    nong_truong: p.nong_truong || "",
    giong: p.giong || "",
    truong_loi: brokenFields.join(", "),
  })
}
console.log(`[Ky_Tu_Hong] ${brokenCharRows.length} lô có ký tự lỗi encoding (U+FFFD).`)

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 4 — Sinh_Doi_Thoai_Hoa (heuristic — xem chú thích đầu file)

const SLIVER_THRESHOLD_HA = MIN_PIECE_AREA_HA / 10 // 0,001 ha — 10 lần nhỏ hơn ngưỡng lọc chuẩn

const geojsonPath = path.join(rootDir, "public", "geojson", "Lo cao su - 2026_Full.geojson")
const twinRows = []
if (!fs.existsSync(geojsonPath)) {
  console.log(`[Sinh_Doi_Thoai_Hoa] ⚠️  Không tìm thấy file nguồn ${geojsonPath} — bỏ qua sheet này.`)
} else {
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, "utf8"))
  const byTen = new Map()
  for (const f of geojson.features || []) {
    const ten = String(f.properties?.Ten || "").trim()
    if (!ten) continue
    const list = byTen.get(ten)
    if (list) list.push(f)
    else byTen.set(ten, [f])
  }
  for (const [ten, features] of byTen) {
    if (features.length < 2) continue
    const areas = features.map((f) => calculateGeometryAreaHa(f.geometry))
    const minArea = Math.min(...areas)
    if (minArea >= SLIVER_THRESHOLD_HA) continue
    twinRows.push({
      ten,
      ma_lo_2026: features[0]?.properties?.Ma_lo_2026 || "",
      so_manh: features.length,
      dien_tich_manh_nho_nhat_ha: Number(minArea.toFixed(6)),
      dien_tich_manh_lon_nhat_ha: Number(Math.max(...areas).toFixed(6)),
      tong_dien_tich_ha: Number(areas.reduce((s, a) => s + a, 0).toFixed(6)),
    })
  }
  twinRows.sort((a, b) => a.dien_tich_manh_nho_nhat_ha - b.dien_tich_manh_nho_nhat_ha)
  console.log(`[Sinh_Doi_Thoai_Hoa] ${twinRows.length} lô nghi ngờ có mảnh thoái hoá (heuristic, cần trắc địa xác minh).`)
}

// ─────────────────────────────────────────────────────────────────────────────

const wb = XLSX.utils.book_new()

function addSheet(name, rows, colWidths) {
  const ws = XLSX.utils.json_to_sheet(rows)
  if (colWidths) ws["!cols"] = colWidths.map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, name)
}

addSheet("Lech_Dien_Tich", areaDiffRows, [16, 22, 14, 8, 16, 14, 14, 12, 14, 14, 45])
addSheet("ID_Trung", idTrungRows, [8, 22, 16, 14, 8, 16])
addSheet("Ky_Tu_Hong", brokenCharRows, [16, 22, 14, 14, 24])
addSheet("Sinh_Doi_Thoai_Hoa", twinRows, [16, 22, 10, 22, 22, 18])

const outPath = path.join(rootDir, "cung_cap_dl", "kiem_ke_du_lieu_lo_vuon_con_lai.xlsx")
XLSX.writeFile(wb, outPath)

console.log(`\n✅ Đã xuất file kiểm kê 4 sheet: ${outPath}`)
console.log("Đây là báo cáo CHỈ ĐỌC — không sửa gì. Cần đội trắc địa xác minh thực địa trước khi quyết định sửa dữ liệu.")
