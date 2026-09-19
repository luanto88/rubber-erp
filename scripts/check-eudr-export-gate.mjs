/**
 * Chốt kiến trúc: "chỉ `eudr-export-gate.ts` được phép `JSON.stringify()` một FeatureCollection
 * EUDR, và diện tích khai báo (`Area`/`Dtich2026_ha`) không bao giờ được tính lại trực tiếp từ
 * hình học tại chỗ gán".
 *
 * Đây KHÔNG phải type-checker thật — chỉ quét văn bản theo quy ước đặt tên đã dùng nhất quán
 * trong repo (biến FeatureCollection luôn tên `geoData`/`collection`/`geojson`/`fc`...). Mục
 * đích là bắt SỚM một thay đổi vô tình đi vòng qua `serializeEudrGeoJson()` (bỏ lỡ bước gộp
 * lỗi `lostAllGeometry`/hash) — không phải chứng minh tuyệt đối không có đường vòng nào khác.
 *
 * Chạy:  node scripts/check-eudr-export-gate.mjs
 * Thoát mã 1 nếu bất kỳ bất biến nào bị vi phạm.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, "..")
const srcDir = path.join(rootDir, "src")

/** File DUY NHẤT được phép JSON.stringify() cả FeatureCollection EUDR. */
const GATE_FILE = "lib/eudr-export-gate.ts"
/** File DUY NHẤT được phép import @turf/area. */
const AREA_CALC_FILE = "lib/eudr-geometry-cleaner.ts"
const FEATURE_COLLECTION_FILE = "lib/eudr-feature-collection.ts"

const TARGET_MODULE_RE = /from\s*["']@\/lib\/(eudr-export-gate|eudr-feature-collection|eudr-trace)["']/
const TURF_AREA_IMPORT_RE = /from\s*["']@turf\/area["']/
/** Property assignment cần canh giữ Area/Dtich2026_ha luôn kế thừa splitAreas[i]/baseProperties. */
const AREA_ASSIGN_RE = /\b(Area|Dtich2026_ha)\s*:/
const DIRECT_AREA_CALL_RE = /\b(calculateGeometryAreaHa|calculateRingAreaHa|turfArea)\s*\(/
/** Biến FeatureCollection theo đúng quy ước đặt tên đã dùng nhất quán trong repo. */
const GEO_ROOT_RE = /^(geoData|collection|geojson|geoJson|featurecollection|featureCollection|fc)$/i
/** Đuôi `.map(`/`.filter(`... nghĩa là đang stringify một GIÁ TRỊ SUY RA (mảng...), không phải
 *  chính đối tượng FeatureCollection — ví dụ React `key={JSON.stringify(geoData.features.map(...))}`. */
const DERIVED_TAIL_METHODS = new Set(["map", "filter", "slice", "flatMap", "reduce", "forEach", "sort", "find"])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function toRel(absPath) {
  return path.relative(srcDir, absPath).split(path.sep).join("/")
}

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

const allFiles = walk(srcDir)
const filesByRel = new Map(allFiles.map((f) => [toRel(f), fs.readFileSync(f, "utf8")]))

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n══ BẤT BIẾN 1 — Chỉ eudr-export-gate.ts được JSON.stringify() FeatureCollection ══\n")

const invariant1Violations = []
for (const [rel, content] of filesByRel) {
  if (rel === GATE_FILE) continue // file DUY NHẤT được phép — không quét
  const nameMatches = /eudr/i.test(rel)
  const importsTarget = TARGET_MODULE_RE.test(content)
  if (!nameMatches && !importsTarget) continue

  const lines = content.split("\n")
  lines.forEach((line, idx) => {
    const m = line.match(/JSON\.stringify\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/)
    if (!m) return
    const chain = m[1]
    const parts = chain.split(".")
    const root = parts[0]
    const tail = parts[parts.length - 1]
    if (!GEO_ROOT_RE.test(root)) return
    if (parts.length > 1 && DERIVED_TAIL_METHODS.has(tail)) return // giá trị suy ra, không phải cả collection
    invariant1Violations.push(`${rel}:${idx + 1} — JSON.stringify(${chain}...)`)
  })
}

check(
  "Không có JSON.stringify() trực tiếp trên biến FeatureCollection ngoài eudr-export-gate.ts",
  invariant1Violations.length === 0,
  invariant1Violations.length ? `${invariant1Violations.length} vi phạm` : "sạch",
)
for (const v of invariant1Violations) console.log(`      ❌ ${v}`)

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n══ BẤT BIẾN 2 — @turf/area chỉ import ở eudr-geometry-cleaner.ts ══\n")

const turfImporters = []
for (const [rel, content] of filesByRel) {
  if (TURF_AREA_IMPORT_RE.test(content)) turfImporters.push(rel)
}
check(
  "@turf/area chỉ được import đúng 1 nơi",
  turfImporters.length === 1 && turfImporters[0] === AREA_CALC_FILE,
  turfImporters.join(", ") || "không có import nào",
)

console.log("\n  Trong eudr-feature-collection.ts, Area:/Dtich2026_ha: không được gọi trực tiếp hàm tính diện tích\n")

const fcContent = filesByRel.get(FEATURE_COLLECTION_FILE)
if (fcContent == null) {
  check(`Tìm thấy ${FEATURE_COLLECTION_FILE}`, false, "không tìm thấy file — kiểm tra lại đường dẫn")
} else {
  const directCallViolations = []
  fcContent.split("\n").forEach((line, idx) => {
    if (AREA_ASSIGN_RE.test(line) && DIRECT_AREA_CALL_RE.test(line)) {
      directCallViolations.push(`${FEATURE_COLLECTION_FILE}:${idx + 1} — ${line.trim()}`)
    }
  })
  check(
    "Area:/Dtich2026_ha: không gọi trực tiếp calculateGeometryAreaHa/calculateRingAreaHa/turfArea",
    directCallViolations.length === 0,
    directCallViolations.length ? `${directCallViolations.length} vi phạm` : "sạch",
  )
  for (const v of directCallViolations) console.log(`      ❌ ${v}`)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n══ KẾT QUẢ: ${pass} đạt / ${fail} trượt ══\n`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  ❌ ${f}`))
  process.exit(1)
}
