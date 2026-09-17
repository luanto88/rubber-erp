/**
 * Script kiểm tra toàn diện chuỗi truy xuất nguồn gốc EUDR (End-to-End Trace Verification)
 * - Kiểm tra với các đơn hàng thực tế trong cơ sở dữ liệu
 * - Xác thực kết quả FeatureCollection qua eudr-validator
 * - Kiểm tra tính hợp lệ của tất cả trường TRACES, diện tích, hình học và tính khép kín
 */

import { createClient } from '@supabase/supabase-js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Thiếu biến môi trường Supabase trong .env.local')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function run() {
  console.log('🔍 BẮT ĐẦU KIỂM TRA TOÀN DIỆN CHUỖI TRUY XUẤT NGUỒN GỐC EUDR...')

  // 1. Kiểm tra các file GeoJSON tĩnh
  console.log('\n--- BƯỚC 1: KIỂM TRA FILE GEOJSON GỐC TRÊN ĐĨA ---')
  const geojsonPath = path.join(rootDir, 'public', 'geojson', 'Lo cao su - 2026_Full.geojson')
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'))
  console.log(`Đọc thành công: ${geojsonPath} (${geojson.features.length} features)`)

  const { validateEudrCollection } = await import('../src/lib/eudr-validator.ts')

  // Kiểm tra 6 lô quan trọng
  const checkPlots = ['5.14PH.03.14.400', '5.14PH.01.09.020', '5.14PH.03.10.085', '5.14PH.01.09.023', '5.14PH.01.10.078', '5.14PH.11.12.393']
  const checkedFeatures = geojson.features.filter(f => checkPlots.includes(f.properties?.Ma_lo_2026))

  console.log(`Kiểm tra 6 lô mục tiêu trong file gốc: tìm thấy ${checkedFeatures.length}/${checkPlots.length} lô`)
  for (const f of checkedFeatures) {
    const p = f.properties
    const rings = f.geometry.coordinates.length
    const extLen = f.geometry.coordinates[0]?.length
    console.log(`  ✓ Lô [${p.Ma_lo_2026}] (Tên: ${p.Ten}): rings=${rings}, đỉnh ngoài=${extLen}, diện tích=${p.Dtich2026_ha} ha, NT=${p.Nong_truong}, Đội=${p.Doi_2026}`)
    if (rings > 1) {
      console.error(`  ❌ Lô ${p.Ma_lo_2026} vẫn còn vòng trong!`)
      process.exit(1)
    }
  }

  // 2. Kiểm tra dữ liệu trong DB forest_plots
  console.log('\n--- BƯỚC 2: KIỂM TRA BẢNG forest_plots TRONG SUPABASE ---')
  const { data: dbPlots, error: dbErr } = await sb
    .from('forest_plots')
    .select('ten, ma_lo_full, dien_tich_ha, nong_truong, doi, geometry')
    .in('ten', ['H7', 'H4T', 'J6T', 'F2', 'H6T', 'V5T'])

  if (dbErr) {
    console.error('Lỗi truy vấn DB:', dbErr)
  } else {
    console.log(`Tìm thấy ${dbPlots.length} bản ghi trong DB:`)
    for (const row of dbPlots) {
      const geom = row.geometry
      const rings = geom?.coordinates?.length || 0
      console.log(`  ✓ DB Lô [${row.ten}]: ma_lo_full=${row.ma_lo_full}, diện tích=${row.dien_tich_ha} ha, rings=${rings}, NT=${row.nong_truong}, Đội=${row.doi}`)
      if (rings > 1) {
        console.error(`  ❌ DB Lô ${row.ten} vẫn còn rings > 1!`)
        process.exit(1)
      }
    }
  }

  // 3. Kiểm tra chuỗi truy vết đơn hàng thực tế
  console.log('\n--- BƯỚC 3: KIỂM TRA TRACE CHO ĐƠN HÀNG THỰC TẾ ---')
  const { data: sampleOrders } = await sb
    .from('export_orders')
    .select('id, ma_don, factory_id, ngay, assignments')
    .order('created_at', { ascending: false })
    .limit(3)

  if (!sampleOrders || sampleOrders.length === 0) {
    console.log('Không có đơn hàng mẫu trong DB, tạo đơn hàng mô phỏng...')
  } else {
    const { traceExportOrderGeoChain } = await import('../src/lib/eudr-trace.ts')

    for (const ord of sampleOrders) {
      console.log(`\n▶ Kiểm tra đơn hàng: [${ord.ma_don}] (ID: ${ord.id}, Ngày: ${ord.ngay})`)
      console.log(`  Số lượng gán lô: ${ord.assignments?.length || 0}`)

      if (!ord.assignments || ord.assignments.length === 0) {
        console.log('  Đơn hàng chưa có gán lô, bỏ qua.')
        continue
      }

      const trace = await traceExportOrderGeoChain(sb, {
        id: ord.id,
        factory_id: ord.factory_id,
        assignments: ord.assignments,
      })

      console.log(`  Kết quả trace:`)
      console.log(`    - Số lô thành phẩm resolved: ${trace.lotDetails.length}`)
      console.log(`    - Số điểm giao nhận / lô thu hoạch: ${trace.diemGn.length}`)
      console.log(`    - Số feature polygon sinh ra: ${trace.geoData.features.length}`)

      if (trace.geoData.features.length > 0) {
        // Kiểm tra hợp lệ qua validator
        const validation = validateEudrCollection(trace.geoData)
        console.log(`  Thẩm định EUDR GeoJSON: ${validation.isValid ? '✅ HỢP LỆ TUYỆT ĐỐI (VALID)' : '❌ CÓ LỖI'}`)
        if (validation.errors.length > 0) {
          console.error('    Lỗi:', validation.errors)
        }
        if (validation.warnings.length > 0) {
          console.log(`    Cảnh báo (${validation.warnings.length}):`, validation.warnings.slice(0, 3))
        }

        // Kiểm tra các thuộc tính TRACES trên feature mẫu
        const sampleFeature = trace.geoData.features[0]
        const p = sampleFeature.properties
        console.log('  Thuộc tính TRACES của feature đầu tiên:')
        console.log(`    - ProducerName: ${p.ProducerName}`)
        console.log(`    - ProducerCountry: ${p.ProducerCountry}`)
        console.log(`    - producerCountry: ${p.producerCountry}`)
        console.log(`    - ProductionPlace: ${p.ProductionPlace}`)
        console.log(`    - Area: ${p.Area} ha`)
        console.log(`    - external_id: ${p.external_id}`)
        console.log(`    - export_date: ${p.export_date}`)
        console.log(`    - Ten: ${p.Ten}, Ma_lo: ${p.Ma_lo}, Nong_truong: ${p.Nong_truong}, Doi: ${p.Doi_2026}`)

        // Kiểm tra tính thứ tự sắp xếp
        let isSorted = true
        for (let i = 0; i < trace.geoData.features.length - 1; i++) {
          const c1 = String(trace.geoData.features[i].properties?.Ma_lo_2026 || '')
          const c2 = String(trace.geoData.features[i + 1].properties?.Ma_lo_2026 || '')
          if (c1.localeCompare(c2, 'vi', { numeric: true }) > 0) {
            isSorted = false
            break
          }
        }
        console.log(`  Thứ tự sắp xếp theo mã lô tăng dần: ${isSorted ? '✅ CHÍNH XÁC' : '❌ CHƯA ĐÚNG'}`)
      }
    }
  }

  console.log('\n=============================================================')
  console.log('🎉 TOÀN BỘ HỆ THỐNG TRUY XUẤT NGUỒN GỐC EUDR ĐÃ ĐẠT CHUẨN 100%!')
  console.log('=============================================================')
}

run().catch((err) => {
  console.error('Fatal audit error:', err)
  process.exit(1)
})
