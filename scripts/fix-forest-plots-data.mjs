/**
 * Script cập nhật trực tiếp bảng forest_plots trong Supabase từ dữ liệu đã sửa:
 * - 3 lô tự cắt đã sửa: H7 (5.14PH.03.14.400), H4T (5.14PH.01.09.020), J6T (5.14PH.03.10.085)
 * - 2 lô có lỗ đã sửa: F2 (5.14PH.01.09.023), H6T (5.14PH.01.10.078)
 * - Lô ID 393: V5T (ma_lo_full = '5.14PH.11.12.393', nong_truong = 'NT 3', doi = 11, dien_tich_ha = 27.29, nam_trong = 2012)
 *
 * Chạy: node --env-file=.env.local scripts/fix-forest-plots-data.mjs
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const FACTORY_ID = '0268ab41-a564-4538-acf1-6297ac372f57' // Phước Hòa Kampong Thom

async function run() {
  console.log('🔄 Đọc file GeoJSON chuẩn đã sửa...')
  const geojsonPath = path.join(rootDir, 'public/geojson/Lo cao su - 2026_Full.geojson')
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'))

  const targetPlots = ['H7', 'H4T', 'J6T', 'F2', 'H6T', 'V5T', 'K12B', 'T11D']
  const featureMap = new Map()

  for (const f of geojson.features) {
    const p = f.properties || {}
    const ten = String(p.Ten || '').trim()
    if (targetPlots.includes(ten) && !featureMap.has(ten)) {
      featureMap.set(ten, f)
    }
  }

  console.log(`Tìm thấy ${featureMap.size}/${targetPlots.length} lô mục tiêu trong GeoJSON đã sửa.`)

  for (const ten of targetPlots) {
    const f = featureMap.get(ten)
    if (!f) {
      console.warn(`⚠️ Không tìm thấy feature cho tên ${ten}`)
      continue
    }

    const p = f.properties || {}
    const updatePayload = {
      ma_lo_full: p.Ma_lo_2026 ? String(p.Ma_lo_2026).trim() : null,
      nong_truong: p.Nong_truong ? String(p.Nong_truong).trim() : null,
      doi: p.Doi_2026 != null ? (parseInt(p.Doi_2026) || null) : null,
      giong: p.Giong ? String(p.Giong).trim() : null,
      dien_tich_ha: p.Dtich2026_ha != null ? (parseFloat(p.Dtich2026_ha) || null) : null,
      nam_trong: p.Nam_trong != null ? (parseInt(p.Nam_trong) || null) : null,
      geometry: f.geometry,
    }

    console.log(`Cập nhật lô [${ten}] -> ma_lo_full: ${updatePayload.ma_lo_full}, diện tích: ${updatePayload.dien_tich_ha} ha, rings: ${f.geometry.coordinates.length}...`)

    const { data, error } = await sb
      .from('forest_plots')
      .update(updatePayload)
      .eq('factory_id', FACTORY_ID)
      .eq('ten', ten)
      .select('id, ten, ma_lo_full, dien_tich_ha, nong_truong, doi')

    if (error) {
      console.error(`❌ Lỗi cập nhật lô ${ten}:`, error.message)
    } else {
      console.log(`✅ Đã cập nhật lô ${ten}:`, data)
    }
  }

  console.log('\n🎉 Hoàn thành cập nhật bảng forest_plots!')
}

run().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
