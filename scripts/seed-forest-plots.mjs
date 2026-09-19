/**
 * Seed dữ liệu lô vườn cao su vào bảng forest_plots từ file GeoJSON tĩnh.
 *
 * Chạy: node --env-file=.env.local scripts/seed-forest-plots.mjs
 *
 * Script idempotent — chạy nhiều lần không bị trùng (dùng upsert theo factory_id + ten).
 *
 * Yêu cầu: bảng forest_plots đã được tạo bằng migration 20260520_forest_plots.sql
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { fileURLToPath, pathToFileURL } from "url"
import { dirname, join } from "path"
import { register } from "node:module"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Dùng chung đúng bộ làm sạch của ứng dụng, không viết lại logic hình học ở đây
register(pathToFileURL(join(__dirname, "_ts-resolve-hook.mjs")))
const { mergeGeometryPieces } = await import(
  pathToFileURL(join(__dirname, "../src/lib/eudr-write-gate.ts")).href
)

const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57" // Phước Hòa Kampong Thom
const GEOJSON_PATH = join(__dirname, "../public/geojson/Lo cao su - 2026_Full.geojson")

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌  Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function ok(msg)   { console.log(`  ✅ ${msg}`) }
function info(msg) { console.log(`  ℹ️  ${msg}`) }
function fail(msg) { console.error(`  ❌ ${msg}`); process.exit(1) }

// ─── Đọc GeoJSON ─────────────────────────────────────────────────────────────

let geojson
try {
  geojson = JSON.parse(readFileSync(GEOJSON_PATH, "utf-8"))
} catch (e) {
  fail(`Không đọc được file GeoJSON: ${GEOJSON_PATH}\n${e.message}`)
}

const features = geojson?.features
if (!Array.isArray(features) || features.length === 0) {
  fail("GeoJSON không có features hoặc rỗng.")
}
info(`Đọc được ${features.length} features từ GeoJSON`)

// ─── Chuyển feature → row ─────────────────────────────────────────────────────

function toRow(feature) {
  const p = feature?.properties || {}
  const ten = String(p.Ten || "").trim()
  if (!ten) return null

  return {
    factory_id:   FACTORY_ID,
    ten,
    ma_lo_full:   p.Ma_lo_2026 ? String(p.Ma_lo_2026).trim() : null,
    nong_truong:  p.Nong_truong ? String(p.Nong_truong).trim() : null,
    doi:          p.Doi_2026 != null ? (parseInt(p.Doi_2026) || null) : null,
    giong:        p.Giong ? String(p.Giong).trim() : null,
    dien_tich_ha: p.Dtich2026_ha != null ? (parseFloat(p.Dtich2026_ha) || null) : null,
    nam_trong:    p.Nam_trong != null ? (parseInt(p.Nam_trong) || null) : null,
    nam_cao_up:   p.Nam_cao_up != null ? (parseInt(p.Nam_cao_up) || null) : null,
    geometry:     feature.geometry || null,
    is_active:    true,
  }
}

// ─── Gộp mảnh theo Ten ────────────────────────────────────────────────────────
//
// ⚠️ TUYỆT ĐỐI KHÔNG quay lại quy tắc cũ "dedupe theo Ten, giữ dòng đầu tiên".
// File GeoJSON nguồn có 29 lô bị đường/suối cắt thành nhiều mảnh, mỗi mảnh là một feature
// riêng nhưng dùng chung `Ten`. Quy tắc cũ vứt bỏ các mảnh còn lại, làm mất 101,62 ha diện
// tích vùng trồng khỏi hồ sơ khai báo EUDR — khai thiếu diện tích sản xuất là rủi ro tuân thủ.
//
// Bảng forest_plots có UNIQUE(factory_id, ten) nên không lưu được nhiều dòng cùng `ten`;
// các mảnh vì vậy được gộp thành một MultiPolygon trong cùng một dòng, rồi tách trở lại
// thành nhiều feature Polygon ở thời điểm xuất file EUDR.

const BATCH = 50

const rawRows = features.map(toRow).filter(Boolean)

const grouped = new Map()
for (const row of rawRows) {
  const existing = grouped.get(row.ten)
  if (existing) existing.push(row)
  else grouped.set(row.ten, [row])
}

const rows = []
const rejected = []
let mergedPlots = 0
let mergedPieces = 0
let droppedHa = 0

for (const [ten, group] of grouped) {
  const base = group[0]
  const { geometry, report } = mergeGeometryPieces(
    group.map((r) => r.geometry),
    { plotCode: ten, declaredAreaHa: base.dien_tich_ha },
  )
  droppedHa += report.droppedHa

  if (!geometry) {
    rejected.push({ ten, problems: report.problems })
    rows.push({ ...base, geometry: null })
    continue
  }

  if (group.length > 1) {
    mergedPlots++
    mergedPieces += report.pieceCount
    info(
      `Gộp lô [${ten}] ${base.ma_lo_full || ""}: ${group.length} feature → ${report.pieceCount} mảnh, ` +
        `${report.areaHa.toFixed(2)} ha (khai báo ${base.dien_tich_ha ?? "—"} ha)`,
    )
  }

  rows.push({ ...base, geometry })
}

if (mergedPlots > 0) {
  ok(`Đã gộp ${mergedPlots} lô bị chia mảnh thành ${mergedPieces} mảnh (thay vì vứt bỏ như trước)`)
}
if (droppedHa > 0) info(`Đã bỏ các mảnh vụn dưới ngưỡng, tổng ${droppedHa.toFixed(6)} ha`)
if (rejected.length > 0) {
  console.error(`  ❌ ${rejected.length} lô có hình học không dùng được (ghi geometry = null):`)
  rejected.forEach((r) => console.error(`     - ${r.ten}: ${r.problems.join(" ")}`))
}
info(`Chuẩn bị upsert ${rows.length} lô vườn duy nhất (bỏ qua ${features.length - rawRows.length} feature thiếu Ten)`)

let inserted = 0
let failed   = 0

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH)
  const { error } = await sb
    .from("forest_plots")
    .upsert(batch, { onConflict: "factory_id,ten", ignoreDuplicates: false })

  if (error) {
    console.error(`  ⚠️  Lỗi batch ${i / BATCH + 1}: ${error.message}`)
    failed += batch.length
  } else {
    inserted += batch.length
    info(`Batch ${i / BATCH + 1}/${Math.ceil(rows.length / BATCH)}: ${batch.length} dòng`)
  }
}

// ─── Kiểm tra kết quả ─────────────────────────────────────────────────────────

const { count, error: countErr } = await sb
  .from("forest_plots")
  .select("*", { count: "exact", head: true })
  .eq("factory_id", FACTORY_ID)

if (countErr) {
  console.warn(`  ⚠️  Không kiểm tra được COUNT: ${countErr.message}`)
} else {
  ok(`Tổng forest_plots trong DB cho factory này: ${count}`)
}

if (failed > 0) {
  console.error(`\n❌  Có ${failed} dòng lỗi. Kiểm tra log bên trên.`)
  process.exit(1)
} else {
  ok(`Seed thành công ${inserted} lô vườn vào bảng forest_plots`)
}
