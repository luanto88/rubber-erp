/**
 * Script sửa triệt để 5 lỗi hình học và bản ghi ID 393 trong các file GeoJSON gốc
 * - 3 lô tự cắt: 5.14PH.03.14.400, 5.14PH.01.09.020, 5.14PH.03.10.085
 * - 2 lô có vòng trong (lỗ): 5.14PH.01.09.023, 5.14PH.01.10.078
 * - Bản ghi ID 393 (V5T): Ma_lo_2026 = 5.14PH.11.12.393, Dtich2026_ha = 27.29, Nong_truong = NT 3, Doi_2026 = 11, Dtich_ko_tai_canh = 0.00
 *
 * Chạy: node scripts/fix-root-geojson-files.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

function fixFeatureGeometryAndProps(f) {
  const p = f.properties || {}
  const maLo2026 = p.Ma_lo_2026
  const ten = p.Ten
  const id = String(p.ID ?? '')

  // 1. Lô 5.14PH.03.14.400 (H7, ID 400) - Sửa tự cắt mép trên
  if (maLo2026 === '5.14PH.03.14.400' || ten === 'H7' || id === '400') {
    const ring = f.geometry.coordinates[0]
    // Bỏ vòng lặp ziczac các đỉnh [1, 2, 3]
    f.geometry.coordinates = [[ring[0], ...ring.slice(4)]]
    console.log('  -> Fixed self-intersection for 5.14PH.03.14.400 (H7)')
  }

  // 2. Lô 5.14PH.01.09.020 (H4T, ID 20) - Sửa đỉnh lùi spike
  if (maLo2026 === '5.14PH.01.09.020' || ten === 'H4T' || id === '20') {
    const ring = f.geometry.coordinates[0]
    // Bỏ đỉnh trùng [1] và đỉnh lùi spike [2]
    f.geometry.coordinates = [[ring[0], ...ring.slice(3)]]
    console.log('  -> Fixed self-intersection for 5.14PH.01.09.020 (H4T)')
  }

  // 3. Lô 5.14PH.03.10.085 (J6T, ID 85) - Sửa giao cắt chéo đỉnh 1
  if (maLo2026 === '5.14PH.03.10.085' || ten === 'J6T' || id === '85') {
    const ring = f.geometry.coordinates[0]
    // Bỏ đỉnh chuyển tiếp [1] gây cắt chéo
    f.geometry.coordinates = [[ring[0], ...ring.slice(2)]]
    console.log('  -> Fixed self-intersection for 5.14PH.03.10.085 (J6T)')
  }

  // 4. Lô 5.14PH.01.09.023 (F2, ID 23) - Xóa vòng trong (lỗ 0.904 ha)
  if ((maLo2026 === '5.14PH.01.09.023' || ten === 'F2') && f.geometry.coordinates.length > 1) {
    f.geometry.coordinates = [f.geometry.coordinates[0]]
    console.log('  -> Removed interior ring (hole) for 5.14PH.01.09.023 (F2)')
  }

  // 5. Lô 5.14PH.01.10.078 (H6T, ID 78) - Xóa vòng trong (lỗ 1.206 ha)
  if ((maLo2026 === '5.14PH.01.10.078' || ten === 'H6T') && f.geometry.coordinates.length > 1) {
    f.geometry.coordinates = [f.geometry.coordinates[0]]
    console.log('  -> Removed interior ring (hole) for 5.14PH.01.10.078 (H6T)')
  }

  // 6. Bản ghi ID 393 (V5T) - Sửa mã lô, diện tích, nông trường, đội
  if (id === '393' && (ten === 'V5T' || !p.Ma_lo_2026)) {
    p.Ma_lo_2026 = '5.14PH.11.12.393'
    p.Dtich2026_ha = '27.29'
    p.Nong_truong = 'NT 3'
    p.Doi_2026 = '11'
    p.Dtich_ko_tai_canh = '0.00'
    console.log('  -> Updated properties for ID 393 (V5T -> 5.14PH.11.12.393)')
  }

  // 7. Lô 5.14PH.06.11.243 (K12B, ID 243) - Sửa đỉnh lùi spike [3]
  if (maLo2026 === '5.14PH.06.11.243' || ten === 'K12B' || id === '243') {
    const ring = f.geometry.coordinates[0]
    if (ring && ring.length > 5) {
      f.geometry.coordinates = [[...ring.slice(0, 3), ...ring.slice(4)]]
      console.log('  -> Fixed fold-back spike for 5.14PH.06.11.243 (K12B)')
    }
  }

  // 8. Lô 5.14PH.11.12.362 (T11D, ID 362) - Sửa đỉnh lùi spike [4]
  if (maLo2026 === '5.14PH.11.12.362' || ten === 'T11D' || id === '362') {
    const ring = f.geometry.coordinates[0]
    if (ring && ring.length > 5) {
      f.geometry.coordinates = [[...ring.slice(0, 4), ...ring.slice(5)]]
      console.log('  -> Fixed fold-back spike for 5.14PH.11.12.362 (T11D)')
    }
  }
}

function processGeoJsonFile(relPath) {
  const fullPath = path.join(rootDir, relPath)
  if (!fs.existsSync(fullPath)) {
    console.log(`File not found: ${relPath}`)
    return
  }
  console.log(`\nProcessing ${relPath}...`)
  const content = fs.readFileSync(fullPath, 'utf-8')
  const geojson = JSON.parse(content)

  if (Array.isArray(geojson.features)) {
    geojson.features.forEach(fixFeatureGeometryAndProps)
  }

  fs.writeFileSync(fullPath, JSON.stringify(geojson, null, 2), 'utf-8')
  console.log(`Saved ${relPath} successfully.`)
}

// Thực hiện trên tất cả các file liên quan
processGeoJsonFile('public/geojson/Lo cao su - 2026_Full.geojson')
processGeoJsonFile('GEOSJSON_2026/Lo cao su - 2026_Full.geojson')
processGeoJsonFile('public/geojson/Doi 1.geojson')
processGeoJsonFile('public/geojson/Doi 3.geojson')
processGeoJsonFile('public/geojson/Doi 6.geojson')
processGeoJsonFile('public/geojson/Doi 11.geojson')

console.log('\nAll root GeoJSON files have been fixed!')
