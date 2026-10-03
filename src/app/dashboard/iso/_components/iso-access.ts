// GĐ3 chuẩn hoá phân quyền ISO (2026-10-03) — điều kiện ẩn/hiện tab, nút, trang theo bộ quyền mới.
// File thuần (không import supabase/server) để dùng được ở mọi component client.
import { hasPermission, type SessionUser } from "@/lib/auth"
import { stepSignerUserId, type ThuTuKyStep } from "@/app/dashboard/iso/_components/iso-types"

type PermUser = Pick<SessionUser, "role" | "permissions"> | null | undefined

/** Quyền trong cache session. Quyền vừa đổi chỉ có hiệu lực sau khi tải lại trang (F5). */
export function readCachedIsoUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem("erp_user")
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionUser | null
    if (!parsed) return null
    return { ...parsed, permissions: Array.isArray(parsed.permissions) ? parsed.permissions : [] }
  } catch {
    return null
  }
}

function safeHas(user: PermUser, code: string) {
  if (!user) return false
  return hasPermission({ role: user.role, permissions: Array.isArray(user.permissions) ? user.permissions : [] }, code)
}

/** Tab Tổng quan: chỉ người duyệt (xem xét / phê duyệt tài liệu / phê duyệt hồ sơ) và admin. */
export function canSeeIsoOverview(user: PermUser) {
  return safeHas(user, "iso.xem_xet") || safeHas(user, "iso.phe_duyet") || safeHas(user, "iso.forms.approve")
}

/** Tab Tài liệu ISO (kho tài liệu toàn nhà máy). */
export function canViewIsoLibrary(user: PermUser) {
  return safeHas(user, "iso.view_library")
}

export function canCreateIsoDocument(user: PermUser) {
  return safeHas(user, "iso.create")
}

export function canCreateIsoForm(user: PermUser) {
  return safeHas(user, "iso.forms.create")
}

/** Xem toàn bộ hồ sơ thực hiện của nhà máy — không có thì chỉ thấy hồ sơ mình liên quan. */
export function canSeeAllIsoForms(user: PermUser) {
  return safeHas(user, "iso.forms.view_all")
}

type FormInstanceLike = {
  nguoi_tao?: string | null
  xem_xet_user_id?: string | null
  phe_duyet_user_id?: string | null
  thu_tu_ky_json?: ThuTuKyStep[] | null
}

/** Người lập, người xem xét / phê duyệt, hoặc có tên ở bất kỳ bước ký nào. */
export function isFormInstanceRelated(inst: FormInstanceLike, uid: string | null | undefined) {
  if (!uid) return false
  if (inst.nguoi_tao === uid || inst.xem_xet_user_id === uid || inst.phe_duyet_user_id === uid) return true
  const steps = Array.isArray(inst.thu_tu_ky_json) ? inst.thu_tu_ky_json : []
  return steps.some((step) => step && typeof step === "object" && stepSignerUserId(step) === uid)
}

type DocParticipantLike = {
  id?: string
  parent_doc_id?: string | null
  trang_thai?: string | null
  created_by?: string | null
  soan_thao_user_id?: string | null
  xem_xet_user_id?: string | null
  phe_duyet_user_id?: string | null
}

/** Người tạo / soạn thảo / xem xét / phê duyệt của chính bản ghi tài liệu. */
export function isIsoDocParticipant(doc: DocParticipantLike, uid: string | null | undefined) {
  if (!uid) return false
  return [doc.created_by, doc.soan_thao_user_id, doc.xem_xet_user_id, doc.phe_duyet_user_id].includes(uid)
}

/**
 * Hiện trong tab Tài liệu ISO hay không (GĐ3, sau test 2026-10-03):
 * - Có hiệu lực → mọi người có quyền kho.
 * - Hết hiệu lực → có `iso.view_het_hieu_luc` hoặc đã tham gia.
 * - Nháp / đang luân chuyển → chỉ người tham gia.
 * "Tham gia" tính cả khi tài liệu cha nằm trong `participantDocIds` (hồ sơ con đi cùng bộ cha).
 * Admin luôn thấy.
 */
export function canSeeIsoDocInLibrary(
  doc: DocParticipantLike,
  user: PermUser,
  uid: string | null | undefined,
  participantDocIds?: Set<string>,
) {
  if (user?.role === "admin") return true
  if (doc.trang_thai === "co_hieu_luc") return true
  const participant =
    isIsoDocParticipant(doc, uid) ||
    (!!doc.parent_doc_id && !!participantDocIds?.has(doc.parent_doc_id))
  if (participant) return true
  if (doc.trang_thai === "het_hieu_luc") return safeHas(user, "iso.view_het_hieu_luc")
  return false
}
