import { hasPermission, type SessionUser } from "@/lib/auth"

/**
 * Quy tắc sửa phiếu Nhập / Xuất / Chuyển kho (người dùng chốt 2026-11-03):
 * - Tạo phiếu mới: admin hoặc `inventory.create`.
 * - Sửa / Lưu phiếu NHÁP: chỉ người lập (`created_by`) hoặc admin. Phiếu cũ không có `created_by` ⇒ chỉ admin.
 * - Ghi sổ (2026-11-04, migration 20261110): cần admin hoặc `inventory.post`. Trên form: người lập có quyền ghi sổ.
 *   Phiếu nháp người khác lập: người có quyền ghi sổ bấm "Ghi sổ" ở trang chi tiết phiếu.
 * - Phiếu đã ghi sổ / đã hủy: không sửa được, xem ở trang chi tiết.
 * Dùng chung cho trang chi tiết phiếu và 3 form để 2 nơi không lệch nhau.
 */

export type InventoryDocStatus = "draft" | "posted" | "cancelled"

export const INVENTORY_POST_DENIED_HINT =
  "Bạn chưa có quyền ghi sổ (Kho vật tư · ghi sổ) — hãy Lưu nháp, người có quyền ghi sổ sẽ mở phiếu ở trang chi tiết để ghi sổ."

export function canCreateInventoryDocument(user: SessionUser | null) {
  return !!user && (user.role === "admin" || hasPermission(user, "inventory.create"))
}

export function canPostInventoryDocument(user: SessionUser | null) {
  return !!user && (user.role === "admin" || hasPermission(user, "inventory.post"))
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
    return `Phiếu nháp${owner ? ` của ${owner}` : ""} — chỉ người lập phiếu hoặc admin được sửa, lưu. Người có quyền ghi sổ ghi sổ phiếu này ở trang chi tiết phiếu.`
  }
  if (!canCreateInventoryDocument(user)) return "Bạn chưa được cấp quyền tạo phiếu kho (inventory.create)."
  return null
}
