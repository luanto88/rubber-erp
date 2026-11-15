// Phiếu kho "điều chỉnh tồn" (inventory_documents.la_dieu_chinh, migration 20261126) — tồn/thẻ kho vẫn tính, nhưng
// KHÔNG phải sử dụng thật ⇒ báo cáo sử dụng theo ngày (55-BC / 46-BC) và đối soát định mức bỏ các dòng xuất của phiếu này.
// Rule 13. Nhận client Supabase làm tham số (trình duyệt: anon + RLS; script: service role).

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllPaginated } from "@/lib/supabase-helpers"

/** Chưa chạy migration 20261126 (cột chưa có) ⇒ coi như không có phiếu điều chỉnh. */
function isMissingColumn(e: unknown): boolean {
  const err = e as { code?: string; message?: string }
  return err?.code === "42703" || err?.code === "PGRST204" || /la_dieu_chinh/i.test(String(err?.message || ""))
}

/** Id các phiếu điều chỉnh tồn của nhà máy (ít phiếu ⇒ tải hết, không lọc ngày để không lệch movement_date/document_date). */
export async function loadAdjustmentDocumentIds(sb: SupabaseClient, factoryId: string): Promise<Set<string>> {
  try {
    const rows = await fetchAllPaginated<{ id: string }>((a, b) =>
      sb.from("inventory_documents").select("id").eq("factory_id", factoryId).eq("la_dieu_chinh", true).order("id").range(a, b),
    )
    return new Set(rows.map((r) => r.id))
  } catch (e) {
    if (isMissingColumn(e)) return new Set()
    throw e
  }
}

export const ADJUSTMENT_LABEL = "Điều chỉnh tồn"
