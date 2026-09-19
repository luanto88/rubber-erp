/**
 * Kiểm chứng bộ làm sạch & dò lỗi hình học EUDR.
 *
 * Chạy:  node scripts/verify-eudr-geometry.mjs
 *
 * Bốn tầng kiểm chứng:
 *   Tầng A — Hồi quy: tái tạo đúng 3 lỗi khách hàng Hàn Quốc đã báo, cộng các điểm mù đã biết.
 *   Tầng B — Dữ liệu thật: chạy trên toàn bộ file GeoJSON nguồn và file đơn hàng mẫu.
 *   Tầng C — Trọng tài JTS: đối chiếu kernel tự viết với JTS/GEOS trên từng vòng.
 *   Tầng D — Bảo toàn diện tích: chứng minh việc làm sạch không dịch chuyển ranh giới.
 *
 * Thoát với mã 1 nếu bất kỳ phép kiểm nào trượt.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { register } from "node:module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, "..")

// Cho phép import trực tiếp file .ts của dự án mà không cần bước biên dịch riêng
register(pathToFileURL(path.join(__dirname, "_ts-resolve-hook.mjs")))

const { analyzeRingTopology } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-ring-topology.ts")).href
)
const { sanitizeEudrGeometryDetailed, calculateRingAreaHa } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-geometry-cleaner.ts")).href
)
const { validateEudrCollection } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-validator.ts")).href
)

let pass = 0
let fail = 0
const failures = []

function check(label, ok, detail = "") {
  if (ok) {
    pass++
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const poly = (rings) => ({ type: "Polygon", coordinates: rings })
// Cạnh ~0,011° ≈ 1,2 km ở vĩ độ 12,6 → mỗi mảnh đủ lớn để vượt ngưỡng 0,01 ha
const S = 0.011
const X = 105.5
const Y = 12.6

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n══ TẦNG A — Hồi quy 3 lỗi khách hàng đã báo + các điểm mù ══\n")

// Lỗi (1): thiếu producerCountry → phải CHẶN (Mức 3)
{
  const fc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { Ma_lo_2026: "TEST.001", Dtich2026_ha: 146, ProducerName: "PHK" },
        geometry: poly([[[X, Y], [X + S, Y], [X + S, Y + S], [X, Y + S], [X, Y]]]),
      },
    ],
  }
  const r = validateEudrCollection(fc)
  check(
    "Lỗi (1) thiếu producerCountry → Mức 3 chặn",
    !r.isValid && r.blocking.some((i) => i.code === "MISSING_PRODUCER_COUNTRY"),
    r.blocking.map((i) => i.code).join(",") || "không có lỗi chặn",
  )
}

// Lỗi (2): đa giác có lỗ → Mức 1 tự sửa, giữ đủ 1 mảnh
{
  const geom = poly([
    [[X, Y], [X + S, Y], [X + S, Y + S], [X, Y + S], [X, Y]],
    [[X + 0.003, Y + 0.003], [X + 0.007, Y + 0.003], [X + 0.007, Y + 0.007], [X + 0.003, Y + 0.007], [X + 0.003, Y + 0.003]],
  ])
  const r = sanitizeEudrGeometryDetailed(geom)
  check(
    "Lỗi (2) đa giác có lỗ → Mức 1 tự bỏ vòng trong",
    r.pieces.length === 1 && r.fixes.some((f) => f.kind === "removed_holes"),
    `${r.pieces.length} mảnh, ${r.fixes.map((f) => f.kind).join(",")}`,
  )
}

// Lỗi (3): Ring Self-intersection dạng pinch point — đúng toạ độ khách gửi
{
  const ring = [
    [105.5, 12.6],
    [105.51, 12.6],
    [105.506955, 12.607731],
    [105.52, 12.62],
    [105.5, 12.62],
    [105.506955, 12.607731],
    [105.5, 12.6],
  ]
  const topo = analyzeRingTopology(ring)
  const pinch = topo.defects.find((d) => d.kind === "Pinch")
  check(
    "Lỗi (3) pinch point được phát hiện",
    !topo.isSimple && !!pinch,
    topo.defects.map((d) => d.kind).join(",") || "không thấy lỗi",
  )
  check(
    "Lỗi (3) báo ĐÚNG toạ độ khách gửi (105.506955, 12.607731)",
    !!pinch && pinch.at[0] === 105.506955 && pinch.at[1] === 12.607731,
    pinch ? `(${pinch.at[0]}, ${pinch.at[1]})` : "-",
  )
  const r = sanitizeEudrGeometryDetailed(poly([ring]))
  check(
    "Lỗi (3) được make_valid sửa, GIỮ MỌI MẢNH",
    r.pieces.length === 2 && r.pieces.every((p) => analyzeRingTopology(p).isSimple),
    `${r.pieces.length} mảnh, tổng ${r.areaHa.toFixed(3)} ha`,
  )
}

// Bowtie — phải giữ cả hai thuỳ, tuyệt đối không chỉ giữ mảnh lớn nhất
{
  const r = sanitizeEudrGeometryDetailed(
    poly([[[X, Y], [X + S, Y + S], [X + S, Y], [X, Y + S], [X, Y]]]),
  )
  const areas = r.pieces.map((p) => calculateRingAreaHa(p))
  check(
    "Bowtie → GIỮ CẢ HAI thuỳ (không chỉ mảnh lớn nhất)",
    r.pieces.length === 2,
    `${r.pieces.length} mảnh: ${areas.map((a) => a.toFixed(2)).join(" + ")} ha`,
  )
}

// Spike ngay tại đỉnh đóng vòng — điểm mù của bản cũ
{
  const ring = [[X, Y], [X + S, Y], [X + S, Y + S], [X + S / 2, Y], [X, Y]]
  const topo = analyzeRingTopology(ring)
  check(
    "Spike tại đỉnh đóng vòng được phát hiện (điểm mù cũ)",
    !topo.isSimple,
    topo.defects.map((d) => d.kind).join(",") || "không thấy lỗi",
  )
  const r = sanitizeEudrGeometryDetailed(poly([ring]))
  check(
    "Spike tại đỉnh đóng vòng được tự sửa",
    r.pieces.length >= 1 && r.pieces.every((p) => analyzeRingTopology(p).isSimple),
    `${r.pieces.length} mảnh`,
  )
}

// Mảnh vụn dưới ngưỡng → Mức 2 loại, có ghi nhật ký
{
  const tiny = [[X, Y], [X + 0.00002, Y], [X + 0.00002, Y + 0.00002], [X, Y + 0.00002], [X, Y]]
  const r = sanitizeEudrGeometryDetailed(poly([tiny]))
  check(
    "Mảnh vụn < 0,01 ha → Mức 2 loại KÈM nhật ký (không âm thầm)",
    r.pieces.length === 0 && r.droppedPieces.length === 1 && r.fixes.some((f) => f.kind === "dropped_tiny_piece"),
    `giữ ${r.pieces.length}, bỏ ${r.droppedPieces.length}`,
  )
}

// Lô thuộc đơn mà mất sạch hình học → Mức 3 CHẶN
{
  const fc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { Ma_lo_2026: "TEST.TINY", Dtich2026_ha: 5, Area: 5, ProducerCountry: "KH", ProducerName: "PHK" },
        geometry: poly([[[X, Y], [X + 0.00002, Y], [X + 0.00002, Y + 0.00002], [X, Y + 0.00002], [X, Y]]]),
      },
    ],
  }
  const r = validateEudrCollection(fc)
  check(
    "Lô thuộc đơn mất sạch hình học → Mức 3 CHẶN (không loại âm thầm)",
    !r.isValid && r.blocking.some((i) => i.code === "PLOT_AREA_TOO_SMALL"),
    r.blocking.map((i) => i.code).join(",") || "không chặn",
  )
}

// Chống dương tính giả
{
  const square = [[X, Y], [X + S, Y], [X + S, Y + S], [X, Y + S], [X, Y]]
  const concave = [[X, Y], [X + S, Y], [X + S, Y + S / 2], [X + S / 2, Y + S / 2], [X + S / 2, Y + S], [X, Y + S], [X, Y]]
  const dup = [[X, Y], [X + S, Y], [X + S, Y], [X + S, Y + S], [X, Y + S], [X, Y]]
  check("Hình vuông hợp lệ → không báo lỗi", analyzeRingTopology(square).isSimple)
  check("Hình lõm hợp lệ → không báo lỗi", analyzeRingTopology(concave).isSimple)
  check("Đỉnh trùng liên tiếp → KHÔNG phải lỗi (chỉ chuẩn hoá)", analyzeRingTopology(dup).isSimple)
}

// Nhiều mảnh cùng mã lô KHÔNG bị coi là trùng lặp
{
  const mk = (ox) => ({
    type: "Feature",
    properties: {
      Ma_lo_2026: "TEST.MULTI",
      Dtich2026_ha: 292,
      Area: 146,
      ProducerCountry: "KH",
      ProducerName: "PHK",
    },
    geometry: poly([[[X + ox, Y], [X + ox + S, Y], [X + ox + S, Y + S], [X + ox, Y + S], [X + ox, Y]]]),
  })
  const r = validateEudrCollection({ type: "FeatureCollection", features: [mk(0), mk(0.05)] })
  check(
    "Một lô tách nhiều mảnh KHÔNG bị coi là trùng mã lô",
    r.isValid,
    r.blocking.map((i) => i.code).join(",") || "không có lỗi chặn",
  )
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n══ TẦNG B + C + D — Dữ liệu thật, trọng tài JTS, bảo toàn diện tích ══\n")

let GeoJSONReader = null
try {
  await import(pathToFileURL(path.join(rootDir, "node_modules/jsts/org/locationtech/jts/monkey.js")).href)
  const io = await import(pathToFileURL(path.join(rootDir, "node_modules/jsts/org/locationtech/jts/io.js")).href)
  GeoJSONReader = io.GeoJSONReader
} catch {
  console.log("  ⚠️  Không nạp được jsts — bỏ qua Tầng C (trọng tài).")
}

const targets = [
  ["GeoJSON nguồn", path.join(rootDir, "public/geojson/Lo cao su - 2026_Full.geojson")],
  ["Mốc đơn hàng đã chốt", path.join(rootDir, "src/lib/__fixtures__/eudr/golden-export-2026-09-18.geojson")],
]

for (const [label, file] of targets) {
  if (!fs.existsSync(file)) {
    console.log(`  ⚠️  Bỏ qua "${label}" — không tìm thấy ${file}`)
    continue
  }
  const g = JSON.parse(fs.readFileSync(file, "utf8"))
  const reader = GeoJSONReader ? new GeoJSONReader() : null

  let notSimpleAfter = 0
  let jtsDisagree = 0
  let areaBefore = 0
  let areaAfter = 0
  let droppedHa = 0
  let maxShiftPct = 0
  let maxShiftCode = ""

  for (const f of g.features) {
    const p = f.properties || {}
    const code = String(p.Ma_lo_2026 || p.Ten || "?")
    const before = calculateRingAreaHa(f.geometry.coordinates[0])
    const r = sanitizeEudrGeometryDetailed(f.geometry)
    areaBefore += before
    areaAfter += r.areaHa
    droppedHa += r.droppedPieces.reduce((s, d) => s + d.areaHa, 0)

    for (const piece of r.pieces) {
      if (!analyzeRingTopology(piece).isSimple) notSimpleAfter++
      if (reader) {
        let jtsOk = false
        try {
          const geom = reader.read({ type: "Polygon", coordinates: [piece] })
          jtsOk = geom.isValid() && geom.isSimple()
        } catch {
          jtsOk = false
        }
        if (!jtsOk) jtsDisagree++
      }
    }

    // Diện tích chỉ được phép giảm đúng bằng phần mảnh vụn đã ghi nhật ký
    if (before > 0.01) {
      const expected = before - r.droppedPieces.reduce((s, d) => s + d.areaHa, 0)
      const shift = Math.abs(r.areaHa - expected) / before * 100
      if (shift > maxShiftPct) {
        maxShiftPct = shift
        maxShiftCode = code
      }
    }
  }

  console.log(`\n  ▸ ${label} (${g.features.length} feature)`)
  check(`   [B] Mọi mảnh đầu ra hợp lệ`, notSimpleAfter === 0, `${notSimpleAfter} mảnh lỗi`)
  if (reader) {
    check(`   [C] JTS xác nhận toàn bộ mảnh đầu ra`, jtsDisagree === 0, `${jtsDisagree} mảnh JTS không đồng ý`)
  }
  check(
    `   [D] Diện tích chỉ mất đúng phần mảnh vụn đã ghi nhật ký`,
    maxShiftPct < 0.5,
    `lệch lớn nhất ${maxShiftPct.toFixed(4)}% (${maxShiftCode || "-"})`,
  )
  console.log(
    `      trước ${areaBefore.toFixed(2)} ha → sau ${areaAfter.toFixed(2)} ha | mảnh vụn đã bỏ ${droppedHa.toFixed(6)} ha`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n══ KẾT QUẢ: ${pass} đạt / ${fail} trượt ══\n`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  ❌ ${f}`))
  process.exit(1)
}
