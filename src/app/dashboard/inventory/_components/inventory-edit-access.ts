import { hasPermission, type SessionUser } from "@/lib/auth"

/**
 * Quy tắc sửa phiếu Nhập / Xuất / Chuyển kho (người dùng chốt 2026-11-03):
 * - Tạo phiếu mới: admin hoặc `inventory.create`.
 * - Sửa / Lưu / Ghi sổ phiếu NHÁP: chỉ người lập (`created_by`) hoặc admin. Phiếu cũ không có `created_by` ⇒ chỉ admin.
 * - Phiếu đã ghi sổ / đã hủy: không sửa được, xem ở trang chi tiết.
 * Dùng chung cho trang chi tiết phiếu và 3 form để 2 nơi không lệch nhau.
 */

export type InventoryDocStatus = "draft" | "posted" | "cancelled"

export function canCreateInventoryDocument(user: SessionUser | null) {
  return !!user && (user.role === "admin" || hasPermission(user, "inventory.create"))
}

export function canEditInventoryDraft(
  user: SessionUser | null,
  doc: { status: InventoryDocStatus | null; created_by: string | null },
) {
  if (!user || doc.status !== "draft") return false
  return user.role === "admin" || (!!doc.created_by && doc.created_by === user.id)
}

/** Trả lý do khoá form (null = được sửa). */
export function resolveInventoryFormLock(
  user: SessionUser | null,
  doc: {
    documentId: string | null
    status: InventoryDocStatus | null
    createdBy: string | null
    requesterName?: string | null
  },
): string | null {
  if (!user) return "Không xác định được người dùng đang đăng nhập — tải lại trang."
  if (doc.status === "posted") return "Phiếu đã ghi sổ — không sửa được nữa. Xem, in, duyệt hoặc hủy ở trang chi tiết phiếu."
  if (doc.status === "cancelled") return "Phiếu đã hủy — chỉ xem."
  if (doc.documentId) {
    if (canEditInventoryDraft(user, { status: "draft", created_by: doc.createdBy })) return null
    const owner = doc.requesterName?.trim()
    return `Phiếu nháp${owner ? ` của ${owner}` : ""} — chỉ người lập phiếu hoặc admin được sửa, lưu, ghi sổ.`
  }
  if (!canCreateInventoryDocument(user)) return "Bạn chưa được cấp quyền tạo phiếu kho (inventory.create)."
  return null
}
