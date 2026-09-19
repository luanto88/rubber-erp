/**
 * Khôi phục diện tích vùng trồng bị cắt mất trong bảng `forest_plots`.
 *
 * Bối cảnh: quy tắc cũ của script seed ("dedupe theo Ten, giữ dòng đầu tiên") đã vứt bỏ các
 * mảnh còn lại của 29 lô bị đường/suối cắt ngang, làm mất ~101,4 ha diện tích vùng trồng khỏi
 * hồ sơ khai báo EUDR. Script này đọc lại file GeoJSON nguồn, gộp đủ mảnh cho từng lô, rồi
 * cập nhật `forest_plots.geometry`.
 *
 * Chạy thử (KHÔNG ghi gì):
 *   node --env-file=.env.local scripts/merge-forest-plot-pieces.mjs
 *
 * Ghi thật:
 *   node --env-file=.env.local scripts/merge-forest-plot-pieces.mjs --apply
 *
 * ⚠️ Ghi đè `forest_plots.geometry` là thao tác một chiều trên dữ liệu sản xuất.
 * Script luôn in bảng đối chiếu đầy đủ trước khi ghi, và chỉ ghi khi có cờ `--apply`.
 */

import { createClient } from "@supabase/supabase-js"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { register } from "node:module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, "..")

register(pathToFileURL(path.join(__dirname, "_ts-resolve-hook.mjs")))
const { mergeGeometryPieces } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-write-gate.ts")).href
)
const { calculateGeometryAreaHa } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-geometry-cleaner.ts")).href
)

const APPLY = process.argv.includes("--apply")
const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57" // Phước Hòa Kampong Thom
const GEOJSON_PATH = path.join(rootDir, "public/geojson/Lo cao su - 2026_Full.geojson")

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local")
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

console.log(`\n══ KHÔI PHỤC MẢNH LÔ VƯỜN ${APPLY ? "— CHẾ ĐỘ GHI THẬT" : "— CHẠY THỬ (không ghi gì)"} ══\n`)

// ── Gom mảnh từ file nguồn ──────────────────────────────────────────────────────
const geojson = JSON.parse(fs.readFileSync(GEOJSON_PATH, "utf8"))
const byTen = new Map()
for (const f of geojson.features) {
  const ten = String((f.properties || {}).Ten || "").trim()
  if (!ten) continue
  if (!byTen.has(ten)) byTen.set(ten, [])
  byTen.get(ten).push(f)
}

// ── Đọc trạng thái hiện tại trong CSDL ──────────────────────────────────────────
const { data: plots, error } = await sb
  .from("forest_plots")
  .select("id, ten, ma_lo_full, dien_tich_ha, geometry")
  .eq("factory_id", FACTORY_ID)
if (error) {
  console.error("❌ Không đọc được forest_plots:", error.message)
  process.exit(1)
}
console.log(`  Đọc được ${plots.length} lô trong cơ sở dữ liệu\n`)

const changes = []
let unchanged = 0
let missingInSource = 0

for (const plot of plots) {
  const group = byTen.get(plot.ten)
  if (!group) {
    missingInSource++
    continue
  }
  const currentHa = calculateGeometryAreaHa(plot.geometry)
  const { geometry, report } = mergeGeometryPieces(
    group.map((f) => f.geometry),
    { plotCode: plot.ten, declaredAreaHa: plot.dien_tich_ha },
  )
  if (!geometry) {
    console.error(`  ❌ [${plot.ten}] không gộp được: ${report.problems.join(" ")}`)
    continue
  }
  const newHa = calculateGeometryAreaHa(geometry)
  // Chỉ cập nhật khi thật sự tăng diện tích đáng kể (tránh ghi đè vô ích vì sai số tính toán)
  if (newHa - currentHa <= 0.01) {
    unchanged++
    continue
  }
  changes.push({
    id: plot.id,
    ten: plot.ten,
    maLo: plot.ma_lo_full,
    pieces: group.length,
    keptPieces: report.pieceCount,
    currentHa,
    newHa,
    declared: Number(plot.dien_tich_ha) || 0,
    geometry,
  })
}

changes.sort((a, b) => b.newHa - b.currentHa - (a.newHa - a.currentHa))

console.log("  Lô sẽ được cập nhật:\n")
console.log(
  `    ${"Ten".padEnd(8)}${"Mã lô".padEnd(20)}${"Mảnh".padEnd(7)}${"Hiện".padStart(9)}${"Sau".padStart(10)}${"Tăng".padStart(9)}${"Khai báo".padStart(11)}`,
)
let totalGain = 0
for (const c of changes) {
  const gain = c.newHa - c.currentHa
  totalGain += gain
  console.log(
    `    ${c.ten.padEnd(8)}${String(c.maLo || "").padEnd(20)}${String(`${c.pieces}→${c.keptPieces}`).padEnd(7)}` +
      `${c.currentHa.toFixed(2).padStart(9)}${c.newHa.toFixed(2).padStart(10)}${`+${gain.toFixed(2)}`.padStart(9)}${c.declared.toFixed(2).padStart(11)}`,
  )
}

console.log(`\n  Tổng: ${changes.length} lô cần cập nhật, khôi phục ${totalGain.toFixed(2)} ha`)
console.log(`  Không đổi: ${unchanged} lô | Không có trong file nguồn: ${missingInSource} lô`)

if (!APPLY) {
  console.log("\n  ℹ️  Đây là lần chạy thử — chưa ghi gì vào cơ sở dữ liệu.")
  console.log("     Chạy lại với cờ --apply để ghi thật.\n")
  process.exit(0)
}

if (changes.length === 0) {
  console.log("\n  ✅ Không có gì phải cập nhật.\n")
  process.exit(0)
}

console.log("\n  Đang ghi...\n")
let done = 0
let failed = 0
for (const c of changes) {
  const { error: upErr } = await sb
    .from("forest_plots")
    .update({ geometry: c.geometry, updated_at: new Date().toISOString() })
    .eq("id", c.id)
  if (upErr) {
    failed++
    console.error(`  ❌ [${c.ten}] ${upErr.message}`)
  } else {
    done++
  }
}
console.log(`\n  ✅ Đã cập nhật ${done} lô${failed ? `, ${failed} lô lỗi` : ""}. Khôi phục ${totalGain.toFixed(2)} ha.\n`)
if (failed > 0) process.exit(1)
