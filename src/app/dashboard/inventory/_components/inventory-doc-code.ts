import { supabase } from "@/lib/supabase"

/**
 * Số thứ tự tiếp theo của mã phiếu kho = số LỚN NHẤT đang có cùng tiền tố + 1, bỏ qua chính phiếu đang sửa.
 * Trước đây đếm số phiếu cùng kho + ngày rồi +1 ⇒ đếm cả phiếu đang sửa (đổi kho rồi đổi lại là nhảy +1)
 * và cấp trùng mã khi dãy có lỗ.
 * `codePrefix` dạng "X-KA-031126" (không có dấu "/").
 */
export async function fetchNextInventoryDocSeq(params: {
  factoryId: string
  documentType: "import" | "export" | "transfer"
  codePrefix: string
  excludeId?: string | null
}): Promise<number> {
  const prefix = `${params.codePrefix}/`
  let query = supabase
    .from("inventory_documents")
    .select("id, document_code")
    .eq("factory_id", params.factoryId)
    .eq("document_type", params.documentType)
    .like("document_code", `${prefix}%`)
  if (params.excludeId) query = query.neq("id", params.excludeId)
  const { data, error } = await query
  if (error) throw error
  let max = 0
  for (const row of (data as { document_code: string | null }[]) || []) {
    const n = parseInt((row.document_code || "").slice(prefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

/**
 * Mã đã lưu của phiếu nếu kho + ngày hiện tại trùng bản đã lưu (đổi kho/ngày rồi đổi lại ⇒ giữ mã gốc), ngược lại "".
 * `savedSnapshot` là JSON bản nháp đã lưu/đã nạp mà các form đang giữ để so "có thay đổi chưa lưu".
 */
export function savedCodeFor(
  savedSnapshot: string,
  documentId: string | null,
  warehouseId: string | null | undefined,
  documentDate: string,
  /** Trường kho quyết định mã: "warehouseIds" (Xuất, mảng 1 phần tử), "warehouseId" (Nhập), "sourceWarehouseId" (Chuyển). */
  warehouseKey: "warehouseIds" | "warehouseId" | "sourceWarehouseId",
): string {
  if (!documentId || !warehouseId) return ""
  try {
    const saved = JSON.parse(savedSnapshot) as Record<string, unknown>
    if (saved.documentId !== documentId || saved.documentDate !== documentDate) return ""
    const raw = saved[warehouseKey]
    const savedWarehouse = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : null) : raw
    return savedWarehouse === warehouseId && typeof saved.documentCode === "string" ? saved.documentCode : ""
  } catch {
    return ""
  }
}
