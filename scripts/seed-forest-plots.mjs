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
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))

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

// ─── Seed theo batch ──────────────────────────────────────────────────────────

const BATCH = 50

const rawRows = features.map(toRow).filter(Boolean)

// Dedup theo ten — GeoJSON có thể chứa nhiều feature trùng Ten.
// PostgreSQL báo lỗi nếu cùng conflict key xuất hiện > 1 lần trong 1 upsert.
// Giữ lại feature đầu tiên của mỗi Ten (thường có diện tích lớn hơn).
const seenTen = new Set()
const rows = rawRows.filter(r => {
  if (seenTen.has(r.ten)) return false
  seenTen.add(r.ten)
  return true
})

const dupCount = rawRows.length - rows.length
if (dupCount > 0) info(`Bỏ qua ${dupCount} feature trùng Ten (giữ lại dòng đầu tiên)`)
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
