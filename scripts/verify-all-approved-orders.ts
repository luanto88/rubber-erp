import { createClient } from "@supabase/supabase-js"
import { traceExportOrderGeoChain } from "@/lib/eudr-trace"
import { validateEudrCollection } from "@/lib/eudr-validator"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error("Missing Supabase credentials in environment")
  process.exit(1)
}

const sb = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function run() {
  console.log("==================================================================")
  console.log("KIỂM TRA TOÀN DIỆN MỌI ĐƠN HÀNG XUẤT KHẨU ĐÃ PHÊ DUYỆT")
  console.log("==================================================================")

  const { data: orders, error } = await sb
    .from("export_orders")
    .select("id, factory_id, ma_don, ngay, assignments, approved_at, trang_thai")
    .order("ngay", { ascending: false })

  if (error) {
    console.error("Lỗi lấy danh sách đơn:", error)
    process.exit(1)
  }

  const approvedOrders = orders.filter((o) => o.approved_at || o.trang_thai === "da_phe_duyet")
  console.log(`Tìm thấy ${orders.length} đơn hàng tổng cộng, trong đó có ${approvedOrders.length} đơn đã phê duyệt.\n`)

  let successCount = 0
  let emptyCount = 0
  let errorCount = 0
  const issueReports: Array<{ order: string; date: string; errors: string[] }> = []

  for (let i = 0; i < approvedOrders.length; i++) {
    const ord = approvedOrders[i]
    const assignments = ord.assignments || []

    if (!assignments.length) {
      emptyCount++
      console.log(`[${i + 1}/${approvedOrders.length}] ⚠️ Đơn ${ord.ma_don} (${ord.ngay}): 0 gán lô (bỏ qua)`)
      continue
    }

    try {
      const trace = await traceExportOrderGeoChain(sb, {
        id: ord.id,
        factory_id: ord.factory_id,
        assignments,
      })

      if (!trace.geoData.features.length) {
        console.log(`[${i + 1}/${approvedOrders.length}] ⚠️ Đơn ${ord.ma_don} (${ord.ngay}): 0 features sinh ra`)
        continue
      }

      const val = validateEudrCollection(trace.geoData)
      if (!val.isValid) {
        errorCount++
        issueReports.push({ order: ord.ma_don, date: ord.ngay, errors: val.errors })
        console.log(`[${i + 1}/${approvedOrders.length}] ❌ Đơn ${ord.ma_don} (${ord.ngay}): ${val.errors.length} lỗi EUDR!`)
      } else {
        successCount++
        console.log(`[${i + 1}/${approvedOrders.length}] ✅ Đơn ${ord.ma_don} (${ord.ngay}): ${trace.geoData.features.length} features, 0 lỗi, ${val.warnings.length} cảnh báo lệch diện tích`)
      }
    } catch (err: unknown) {
      errorCount++
      const msg = err instanceof Error ? err.message : String(err)
      issueReports.push({ order: ord.ma_don, date: ord.ngay, errors: [msg] })
      console.error(`[${i + 1}/${approvedOrders.length}] ❌ Đơn ${ord.ma_don} ném exception:`, msg)
    }
  }

  console.log("\n==================================================================")
  console.log("KẾT QUẢ TỔNG QUAN:")
  console.log(`- Tổng số đơn đã kiểm tra: ${approvedOrders.length}`)
  console.log(`- Đơn đạt chuẩn EUDR 100% hợp lệ: ${successCount}`)
  console.log(`- Đơn rỗng (chưa gán lô): ${emptyCount}`)
  console.log(`- Đơn không hợp lệ: ${errorCount}`)
  console.log("==================================================================")

  if (issueReports.length > 0) {
    console.log("\nCHI TIẾT ĐƠN LỖI:")
    console.log(JSON.stringify(issueReports, null, 2))
    process.exit(1)
  } else {
    console.log("\n🎉 TẤT CẢ ĐƠN HÀNG ĐÃ PHÊ DUYỆT ĐỀU ĐẠT CHUẨN EUDR 100% KHÔNG CÓ LỖI HÌNH HỌC!")
  }
}

run()
