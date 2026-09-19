/**
 * Chạy CHÍNH pipeline xuất EUDR thật (traceExportOrderGeoChain + serializeEudrGeoJson) trên
 * TOÀN BỘ đơn hàng đã duyệt trong cơ sở dữ liệu, với `block: true` cưỡng bức — bất kể
 * `EUDR_EXPORT_BLOCK_ENABLED` thật đang bật hay tắt. Đây là báo cáo cần xem TRƯỚC KHI set
 * `NEXT_PUBLIC_EUDR_EXPORT_BLOCK=false` (tắt shadow, bật chặn thật) trên Vercel — nếu có đơn
 * fail ở đây, đơn đó sẽ bị chặn tải file thật ngay khi bật chặn.
 *
 * "Đã duyệt" dùng đúng công thức của `isExportOrderLocked()`
 * (`src/app/api/eudr/_lib/eudr-file-permissions.ts`): `(trang_thai || "da_phe_duyet") !==
 * "cho_phe_duyet"` — chỉ lấy dòng công thức, KHÔNG import/gọi cả hàm đó (hàm gốc còn kiểm tra
 * cả `export_order_customer_grants`, một khái niệm khác — "đơn đã khoá tệp đính kèm", không
 * liên quan tới "đơn có nên chạy được qua cổng xuất EUDR").
 *
 * Chạy:  node --env-file=.env.local scripts/verify-eudr-export-chain.mjs
 * Thoát mã 1 nếu có bất kỳ đơn nào sẽ bị chặn.
 */

import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { register } from "node:module"
import { createClient } from "@supabase/supabase-js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, "..")

register(pathToFileURL(path.join(__dirname, "_ts-resolve-hook.mjs")))

const { traceExportOrderGeoChain } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-trace.ts")).href
)
const { serializeEudrGeoJson, EudrExportBlockedError } = await import(
  pathToFileURL(path.join(rootDir, "src/lib/eudr-export-gate.ts")).href
)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Thiếu biến môi trường Supabase — chạy với: node --env-file=.env.local scripts/verify-eudr-export-chain.mjs")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function fetchAllOrders() {
  const PAGE_SIZE = 500
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await sb
      .from("export_orders")
      .select("id, ma_don, factory_id, ngay, assignments, trang_thai")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

console.log("Đang tải danh sách đơn xuất hàng...")
const orders = await fetchAllOrders()

// Mirror công thức isExportOrderLocked() — KHÔNG import cả hàm (hàm gốc còn kiểm tra
// export_order_customer_grants, thuộc phạm vi "khoá tệp đính kèm", không phải "đã duyệt").
const approvedOrders = orders.filter((o) => (o.trang_thai || "da_phe_duyet") !== "cho_phe_duyet")

console.log(`Tổng ${orders.length} đơn, ${approvedOrders.length} đơn đã duyệt cần kiểm chứng.\n`)

let pass = 0
let fail = 0
const failures = []

for (const order of approvedOrders) {
  const label = order.ma_don || order.id
  try {
    const trace = await traceExportOrderGeoChain(sb, {
      id: order.id,
      factory_id: order.factory_id,
      assignments: Array.isArray(order.assignments) ? order.assignments : [],
      ngay: order.ngay || undefined,
    })
    // block: true cưỡng bức — đúng như khi NEXT_PUBLIC_EUDR_EXPORT_BLOCK thật được bật.
    serializeEudrGeoJson(trace.geoData, { cleanLog: trace.cleanLog, block: true })
    pass++
  } catch (err) {
    fail++
    const message = err instanceof EudrExportBlockedError ? err.message : (err instanceof Error ? err.message : String(err))
    failures.push({ label, id: order.id, message })
    console.log(`  ❌ [${label}] ${message}`)
  }
}

console.log(`\n══ KẾT QUẢ: ${pass} đơn xuất được / ${fail} đơn sẽ bị chặn (trên tổng ${approvedOrders.length} đơn đã duyệt) ══\n`)

if (fail > 0) {
  console.log("Các đơn dưới đây sẽ KHÔNG tải được file GeoJSON/ZIP nếu bật NEXT_PUBLIC_EUDR_EXPORT_BLOCK — sửa lô vườn tương ứng trước khi bật chặn thật:\n")
  for (const f of failures) console.log(`  • ${f.label} (${f.id}): ${f.message}`)
  process.exit(1)
}

console.log(
  "Tất cả đơn đã duyệt đều xuất được sạch — an toàn để bỏ NEXT_PUBLIC_EUDR_EXPORT_BLOCK=false " +
  "trên Vercel (mặc định fail-closed sẽ tự bật chặn thật) rồi Redeploy.",
)
