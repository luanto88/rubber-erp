/**
 * Script xuất danh sách 35 lô có diện tích hình học lệch trên 10% so với Dtich2026_ha ra file Excel
 *
 * Chạy: node scripts/export-35-area-diff-plots.mjs
 */

import XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

function calculateRingAreaHa(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0
  const R = 6378137 // WGS84
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i]
    const p2 = ring[(i + 1) % ring.length]
    if (!p1 || !p2) continue
    const x1 = (p1[0] * Math.PI) / 180
    const y1 = (p1[1] * Math.PI) / 180
    const x2 = (p2[0] * Math.PI) / 180
    const y2 = (p2[1] * Math.PI) / 180
    area += (x2 - x1) * (2 + Math.sin(y1) + Math.sin(y2))
  }
  area = Math.abs((area * R * R) / 2.0)
  return area / 10000
}

function calculateGeometryAreaHa(geometry) {
  if (!geometry) return 0
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates
    if (!coords || !coords.length) return 0
    let total = calculateRingAreaHa(coords[0])
    for (let i = 1; i < coords.length; i++) {
      total -= calculateRingAreaHa(coords[i])
    }
    return Math.max(0, total)
  }
  if (geometry.type === 'MultiPolygon') {
    const coords = geometry.coordinates
    let total = 0
    for (const poly of coords) {
      if (!poly || !poly.length) continue
      let polyArea = calculateRingAreaHa(poly[0])
      for (let i = 1; i < poly.length; i++) {
        polyArea -= calculateRingAreaHa(poly[i])
      }
      total += Math.max(0, polyArea)
    }
    return total
  }
  return 0
}

async function run() {
  const geojsonPath = path.join(rootDir, 'public/geojson/Lo cao su - 2026_Full.geojson')
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'))

  // Gom các feature theo Ma_lo_2026 (hoặc Ten)
  const plotMap = new Map()

  geojson.features.forEach((f, idx) => {
    const p = f.properties || {}
    const code = String(p.Ma_lo_2026 || p.Ma_lo || p.Ten || `feature_${idx}`).trim()
    const area = calculateGeometryAreaHa(f.geometry)

    if (!plotMap.has(code)) {
      plotMap.set(code, {
        ma_lo_2026: p.Ma_lo_2026 || p.Ma_lo || '',
        ten: p.Ten || '',
        nong_truong: p.Nong_truong || '',
        doi: p.Doi_2026 || '',
        nam_trong: p.Nam_trong || '',
        declared_ha: parseFloat(p.Dtich2026_ha) || 0,
        geom_total_ha: 0,
        part_count: 0,
        feature_indices: [],
      })
    }

    const entry = plotMap.get(code)
    entry.geom_total_ha += area
    entry.part_count += 1
    entry.feature_indices.push(idx + 1)
  })

  // Tìm các lô có tỷ lệ lệch > 10%
  const diffPlots = []
  for (const entry of plotMap.values()) {
    const declared = entry.declared_ha
    const geom = entry.geom_total_ha
    const diff = geom - declared
    const pct = declared > 0 ? (Math.abs(diff) / declared) * 100 : (geom > 0 ? 100 : 0)

    if (pct > 10) {
      let note = 'Ranh giới bản đồ lệch so với sổ sách thực địa'
      if (entry.part_count > 1) {
        note = `Lô gồm ${entry.part_count} mảnh đa giác (Features #${entry.feature_indices.join(', #')})`
      }
      if (declared === 0) {
        note = 'Chưa điền diện tích khai báo trong thuộc tính'
      }

      diffPlots.push({
        ma_lo_2026: entry.ma_lo_2026,
        ten: entry.ten,
        nong_truong: entry.nong_truong,
        doi: entry.doi,
        nam_trong: entry.nam_trong,
        declared_ha: declared,
        geom_ha: Number(geom.toFixed(2)),
        diff_ha: Number(diff.toFixed(2)),
        diff_pct: Number(pct.toFixed(1)),
        part_count: entry.part_count,
        note,
      })
    }
  }

  // Sắp xếp theo độ lớn chênh lệch giảm dần
  diffPlots.sort((a, b) => Math.abs(b.diff_ha) - Math.abs(a.diff_ha))

  console.log(`Tìm thấy ${diffPlots.length} lô có diện tích lệch > 10%.`)

  // Chuẩn bị Sheet 1: Gom theo mã lô
  const excelRowsGrouped = diffPlots.map((plot, idx) => ({
    'STT': idx + 1,
    'Mã Lô 2026': plot.ma_lo_2026,
    'Tên Lô': plot.ten,
    'Nông Trường': plot.nong_truong,
    'Đội': plot.doi,
    'Năm Trồng': plot.nam_trong,
    'Diện Tích Khai Báo (ha)': plot.declared_ha,
    'Diện Tích Hình Học Tổng (ha)': plot.geom_ha,
    'Chênh Lệch (ha)': plot.diff_ha,
    'Tỷ Lệ Lệch (%)': `${plot.diff_pct}%`,
    'Số Mảnh Đa Giác': plot.part_count,
    'Ghi Chú Phân Loại Rà Soát': plot.note,
  }))

  // Chuẩn bị Sheet 2: Chi tiết theo từng Feature trong file GeoJSON (Khớp danh sách 35 lô của prompt)
  const seenFeatureCodes = new Set()
  const featureLevelDiffs = []
  geojson.features.forEach((f, idx) => {
    const p = f.properties || {}
    const code = p.Ma_lo_2026 || p.Ma_lo || p.Ten
    if (!code || seenFeatureCodes.has(code)) return
    seenFeatureCodes.add(code)

    const declared = parseFloat(p.Dtich2026_ha) || 0
    const geom = calculateGeometryAreaHa(f.geometry)
    const diff = geom - declared
    const pct = declared > 0 ? (Math.abs(diff) / declared) * 100 : (geom > 0 ? 100 : 0)

    if (pct > 10) {
      featureLevelDiffs.push({
        stt: 0,
        feature_index: idx + 1,
        ma_lo_2026: code,
        ten: p.Ten || '',
        nong_truong: p.Nong_truong || '',
        doi: p.Doi_2026 || '',
        nam_trong: p.Nam_trong || '',
        declared_ha: declared,
        geom_ha: Number(geom.toFixed(2)),
        diff_ha: Number(diff.toFixed(2)),
        diff_pct: Number(pct.toFixed(1)),
      })
    }
  })

  featureLevelDiffs.sort((a, b) => Math.abs(b.diff_ha) - Math.abs(a.diff_ha))
  const excelRowsFeatures = featureLevelDiffs.slice(0, 35).map((f, i) => ({
    'STT': i + 1,
    'Thứ Tự Feature (1-based)': f.feature_index,
    'Mã Lô 2026': f.ma_lo_2026,
    'Tên Lô': f.ten,
    'Nông Trường': f.nong_truong,
    'Đội': f.doi,
    'Năm Trồng': f.nam_trong,
    'Diện Tích Khai Báo (ha)': f.declared_ha,
    'Diện Tích Hình Học Mảnh Này (ha)': f.geom_ha,
    'Chênh Lệch (ha)': f.diff_ha,
    'Tỷ Lệ Lệch (%)': `${f.diff_pct}%`,
  }))

  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.json_to_sheet(excelRowsGrouped)
  const ws2 = XLSX.utils.json_to_sheet(excelRowsFeatures)

  const colsConfig1 = [
    { wch: 6 },  // STT
    { wch: 20 }, // Mã lô
    { wch: 10 }, // Tên lô
    { wch: 12 }, // Nông trường
    { wch: 8 },  // Đội
    { wch: 10 }, // Năm trồng
    { wch: 22 }, // Khai báo
    { wch: 25 }, // Hình học tổng
    { wch: 16 }, // Chênh lệch
    { wch: 14 }, // Tỷ lệ lệch
    { wch: 16 }, // Số mảnh
    { wch: 45 }, // Ghi chú
  ]

  const colsConfig2 = [
    { wch: 6 },  // STT
    { wch: 25 }, // Thứ tự feature
    { wch: 20 }, // Mã lô
    { wch: 10 }, // Tên lô
    { wch: 12 }, // Nông trường
    { wch: 8 },  // Đội
    { wch: 10 }, // Năm trồng
    { wch: 22 }, // Khai báo
    { wch: 28 }, // Hình học mảnh này
    { wch: 16 }, // Chênh lệch
    { wch: 14 }, // Tỷ lệ lệch
  ]

  ws1['!cols'] = colsConfig1
  ws2['!cols'] = colsConfig2

  XLSX.utils.book_append_sheet(wb, ws1, 'Tong_Hop_Theo_Lo')
  XLSX.utils.book_append_sheet(wb, ws2, 'Chi_Tiet_35_Lo_Prompt')

  const outPath1 = path.join(rootDir, 'cung_cap_dl', 'danh_sach_35_lo_lech_dien_tich_EUDR.xlsx')
  const outPath2 = path.join(rootDir, 'danh_sach_35_lo_lech_dien_tich_EUDR.xlsx')

  XLSX.writeFile(wb, outPath1)
  XLSX.writeFile(wb, outPath2)

  console.log(`✅ Đã xuất file Excel (2 sheet) thành công:`)
  console.log(`   - Sheet 1: Tong_Hop_Theo_Lo (${excelRowsGrouped.length} lô)`)
  console.log(`   - Sheet 2: Chi_Tiet_35_Lo_Prompt (${excelRowsFeatures.length} lô khớp danh mục prompt)`)
  console.log(`   - Lưu tại: ${outPath1}`)
  console.log(`   - Lưu tại: ${outPath2}`)

  console.log('\nTop 10 lô lệch nặng nhất:')
  console.table(
    diffPlots.slice(0, 10).map((p) => ({
      Ma_lo: p.ma_lo_2026,
      Ten: p.ten,
      NT: p.nong_truong,
      KhaiBao: p.declared_ha,
      HinhHoc: p.geom_ha,
      ChenhLech: p.diff_ha,
      TyLeLech: `${p.diff_pct}%`,
    }))
  )
}

run().catch(console.error)
