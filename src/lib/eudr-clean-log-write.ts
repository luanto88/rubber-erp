import type { SupabaseClient } from "@supabase/supabase-js"
import type { FeatureCollection } from "geojson"
import { buildEudrCleanLogUpdatePayload } from "./eudr-export-gate"
import type { PlotCleanEntry } from "./eudr-feature-collection"

/**
 * Ghi `export_orders.eudr_clean_log`/`eudr_geometry_hash` mỗi khi trace được tính lại (view
 * time), KHÔNG phải lúc tải file — dùng chung cho 2 route API (service-role client) và trang
 * admin `EudrClient.tsx` (browser client, RLS `export_orders_update` đã cho phép user cùng
 * `factory_id` ghi trực tiếp).
 *
 * ⚠️ Cố ý KHÔNG dùng `after()` (`next/server`) trong CHÍNH file này — `next/server` là API chỉ
 * dành cho Server Component/Route Handler/Server Action, import nó vào một module có thể bị
 * `EudrClient.tsx` ("use client") kéo vào cây import sẽ làm hỏng bundle phía trình duyệt. 2 route
 * API (server) tự bọc `after()` xung quanh lời gọi hàm này ở chính route.ts; `EudrClient.tsx`
 * (client) gọi thẳng không cần `after()` — không có vòng đời request/response cần giữ sống.
 *
 * Best-effort, fire-and-forget: KHÔNG được làm chậm/crash trang nếu ghi lỗi — hàm tự nuốt mọi
 * lỗi, không bao giờ throw.
 *
 * Idempotent BẮT BUỘC: trang public (`/api/eudr/public-order`) không xác thực — ai đó F5 liên
 * tục sẽ gọi hàm này nhiều lần dù hình học không đổi gì. Kiểm hash hiện có trước, chỉ UPDATE
 * khi thực sự khác, tránh ghi DB thừa từ lưu lượng xem trang lặp lại.
 */
export async function writeEudrCleanLogIfChanged(
  client: SupabaseClient,
  orderId: string,
  geoData: FeatureCollection,
  cleanLog: PlotCleanEntry[],
): Promise<void> {
  try {
    const payload = await buildEudrCleanLogUpdatePayload(geoData, cleanLog)
    const { data: existing } = await client
      .from("export_orders")
      .select("eudr_geometry_hash")
      .eq("id", orderId)
      .maybeSingle()
    if (existing?.eudr_geometry_hash === payload.eudr_geometry_hash) return
    const { error } = await client.from("export_orders").update(payload).eq("id", orderId)
    if (error) console.error(`[eudr-clean-log-write] ${orderId}:`, error.message)
  } catch (e) {
    console.error(`[eudr-clean-log-write] ${orderId}:`, e instanceof Error ? e.message : e)
  }
}
