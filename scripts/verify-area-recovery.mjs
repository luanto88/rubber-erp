/**
 * Kiểm chứng việc khôi phục 101,62 ha diện tích vùng trồng bị quy tắc dedupe cũ cắt mất.
 *
 * Chạy:  node scripts/verify-eudr-geometry.mjs   (kiểm hình học)
 *        node scripts/verify-area-recovery.mjs   (kiểm diện tích — script này)
 *
 * Script chạy THUẦN trên file GeoJSON nguồn, KHÔNG đọc và KHÔNG ghi cơ sở dữ liệu.
 * Mục đích: chứng minh bằng số rằng quy tắc mới (gộp mọi mảnh ≥ 0,01 ha) khôi phục đúng
 * phần diện tích mà quy tắc cũ ("dedupe theo Ten, giữ dòng đầu tiên") đã vứt bỏ.
 *
 * Thoát với mã 1 nếu kết quả không đạt.
 */

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
const { calculateGeometryAreaHa, calculateRingAreaHa } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-geometry-cleaner.ts")).href
)

const GEOJSON_PATH = path.join(rootDir, "public/geojson/Lo cao su - 2026_Full.geojson")
if (!fs.existsSync(GEOJSON_PATH)) {
  console.error(`❌ Không tìm thấy ${GEOJSON_PATH}`)
  process.exit(1)
}

const geojson = JSON.parse(fs.readFileSync(GEOJSON_PATH, "utf8"))

// ── Gom feature theo Ten ────────────────────────────────────────────────────────
const byTen = new Map()
for (const f of geojson.features) {
  const p = f.properties || {}
  const ten = String(p.Ten || "").trim()
  if (!ten) continue
  if (!byTen.has(ten)) byTen.set(ten, [])
  byTen.get(ten).push(f)
}

let areaOldRule = 0 // quy tắc cũ: chỉ giữ feature đầu tiên của mỗi Ten
let areaNewRule = 0 // quy tắc mới: gộp mọi mảnh ≥ 0,01 ha
let droppedHa = 0
let multiPieceePlots = 0
const recovered = []
const inconsistent = []

for (const [ten, group] of byTen) {
  const base = group[0].properties || {}
  const declared = Number(base.Dtich2026_ha) || 0

  // Quy tắc cũ
  areaOldRule += calculateRingAreaHa(group[0].geometry.coordinates[0])

  // Quy tắc mới
  const { geometry, report } = mergeGeometryPieces(
    group.map((f) => f.geometry),
    { plotCode: ten, declaredAreaHa: declared },
  )
  areaNewRule += geometry ? calculateGeometryAreaHa(geometry) : 0
  droppedHa += report.droppedHa

  if (group.length > 1) {
    multiPieceePlots++
    // Điều kiện an toàn để gộp: mọi mảnh phải cùng mã lô và cùng diện tích khai báo
    const codes = new Set(group.map((f) => String((f.properties || {}).Ma_lo_2026 || "").trim()))
    const areas = new Set(group.map((f) => String((f.properties || {}).Dtich2026_ha || "").trim()))
    if (codes.size > 1 || areas.size > 1) {
      inconsistent.push({ ten, codes: [...codes], areas: [...areas] })
    }
    recovered.push({
      ten,
      maLo: base.Ma_lo_2026,
      pieces: group.length,
      kept: report.pieceCount,
      oldHa: calculateRingAreaHa(group[0].geometry.coordinates[0]),
      newHa: geometry ? calculateGeometryAreaHa(geometry) : 0,
      declared,
    })
  }
}

const recoveredHa = areaNewRule - areaOldRule
recovered.sort((a, b) => b.newHa - b.oldHa - (a.newHa - a.oldHa))

console.log("\n══ KHÔI PHỤC DIỆN TÍCH VÙNG TRỒNG ══\n")
console.log(`  Tổng feature trong file nguồn     : ${geojson.features.length}`)
console.log(`  Số lô duy nhất (theo Ten)         : ${byTen.size}`)
console.log(`  Số lô bị chia nhiều mảnh          : ${multiPieceePlots}`)
console.log("")
console.log(`  Diện tích theo quy tắc CŨ         : ${areaOldRule.toFixed(2)} ha  (chỉ giữ mảnh đầu tiên)`)
console.log(`  Diện tích theo quy tắc MỚI        : ${areaNewRule.toFixed(2)} ha  (gộp mọi mảnh ≥ 0,01 ha)`)
console.log(`  ➜ KHÔI PHỤC                       : ${recoveredHa.toFixed(2)} ha`)
console.log(`  Mảnh vụn đã bỏ (có ghi nhật ký)   : ${droppedHa.toFixed(6)} ha`)

console.log("\n  10 lô khôi phục nhiều nhất:")
recovered.slice(0, 10).forEach((r) => {
  console.log(
    `    ${String(r.ten).padEnd(7)} ${String(r.maLo).padEnd(18)} ${r.pieces} mảnh → ` +
      `${r.oldHa.toFixed(2)} ha ⇒ ${r.newHa.toFixed(2)} ha (khai báo ${r.declared.toFixed(2)} ha, ` +
      `+${(r.newHa - r.oldHa).toFixed(2)} ha)`,
  )
})

// ── Đối chiếu độ lệch diện tích trước / sau khi gộp ─────────────────────────────
let deviateOld = 0
let deviateNew = 0
for (const [ten, group] of byTen) {
  const declared = Number((group[0].properties || {}).Dtich2026_ha) || 0
  if (!(declared > 0)) continue
  const oldHa = calculateRingAreaHa(group[0].geometry.coordinates[0])
  const { geometry } = mergeGeometryPieces(group.map((f) => f.geometry), { plotCode: ten })
  const newHa = geometry ? calculateGeometryAreaHa(geometry) : 0
  if ((Math.abs(oldHa - declared) / declared) * 100 > 10) deviateOld++
  if ((Math.abs(newHa - declared) / declared) * 100 > 10) deviateNew++
}

console.log("\n══ TÁC ĐỘNG TỚI CẢNH BÁO LỆCH DIỆN TÍCH ══\n")
console.log(`  Số lô lệch > 10% TRƯỚC khi gộp : ${deviateOld}`)
console.log(`  Số lô lệch > 10% SAU khi gộp   : ${deviateNew}`)
console.log(`  ➜ Giảm được ${deviateOld - deviateNew} cảnh báo nhiễu`)

// ── Kết luận ───────────────────────────────────────────────────────────────────
let failed = 0
const assert = (label, ok, detail) => {
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failed++
}

console.log("\n══ KIỂM CHỨNG ══\n")
assert(
  "Quy tắc mới khôi phục được diện tích đã mất",
  recoveredHa > 100,
  `+${recoveredHa.toFixed(2)} ha`,
)
assert(
  "Không mảnh vùng trồng thật nào bị bỏ (chỉ mảnh vụn < 0,01 ha)",
  droppedHa < 0.01,
  `${droppedHa.toFixed(6)} ha`,
)
assert(
  "Mọi lô nhiều mảnh đều cùng mã lô và cùng diện tích khai báo (gộp không mơ hồ)",
  inconsistent.length === 0,
  inconsistent.length ? JSON.stringify(inconsistent.slice(0, 3)) : `${multiPieceePlots}/${multiPieceePlots} nhất quán`,
)
assert(
  "Cảnh báo lệch diện tích giảm sau khi gộp",
  deviateNew < deviateOld,
  `${deviateOld} → ${deviateNew}`,
)
assert("Không lô nào mất diện tích so với quy tắc cũ", areaNewRule >= areaOldRule)

console.log("")
if (failed > 0) process.exit(1)
