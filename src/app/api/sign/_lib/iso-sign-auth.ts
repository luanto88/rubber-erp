import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Xác thực uỷ quyền cho 2 route ký ISO (`generate-pdf`, `generate-office`).
 *
 * Vá lỗ hổng 2026-09-08 (Giai đoạn 1 kế hoạch ký số ISO). Trước bản vá này:
 *
 *  1. `generate-pdf` KHÔNG hề đối chiếu `payload.docId`/`payload.docType` của token với
 *     `docId`/`docType` trong body — token ký hợp lệ của tài liệu A dùng được để đóng dấu
 *     lên tài liệu B bất kỳ trong cùng nhà máy (token do chính người dùng lấy được bằng
 *     PIN của họ, nên đây là đường tấn công có thật, không cần đánh cắp gì).
 *  2. CẢ HAI route đều suy bước ký từ `action` mà KHÔNG kiểm tra người gọi có đúng là
 *     người được giao bước đó hay không — bất kỳ ai cùng nhà máy có PIN của chính mình
 *     đều đóng dấu được ở bước "phê duyệt" của tài liệu người khác.
 *
 * Không có bản vá này thì chữ ký số PAdES (Giai đoạn 2) mất phần lớn giá trị: nó chứng
 * minh được "hệ thống đã ký" nhưng không chứng minh được "ĐÚNG người đó đã ký".
 */

export type IsoSignStep = "soan_thao" | "xem_xet" | "phe_duyet"

export type IsoSignAuthResult =
  | { ok: true; step: IsoSignStep }
  | { ok: false; error: string; status: number }

/** Cột lưu user id được giao cho từng bước ký trên `iso_documents`. */
const STEP_USER_COLUMN: Record<IsoSignStep, string> = {
  soan_thao: "soan_thao_user_id",
  xem_xet: "xem_xet_user_id",
  phe_duyet: "phe_duyet_user_id",
}

/**
 * Suy bước ký từ `action` của workflow. Giữ nguyên bảng ánh xạ đang chạy thật ở cả 2
 * route (kể cả nhánh `gui_phe_duyet` phụ thuộc `cap_tl`/có người xem xét hay không) —
 * không đổi hành vi, chỉ gom về một chỗ.
 */
export function isoStepFromAction(
  doc: Record<string, unknown>,
  action?: string,
): IsoSignStep | null {
  if (action === "gui_xem_xet") return "soan_thao"
  if (action === "gui_lai_phe_duyet") return "xem_xet"
  if (action === "gui_phe_duyet") {
    const capTl = String(doc.cap_tl || "")
    const hasReviewer = !!doc.xem_xet_user_id
    return capTl === "Cấp 2" || !hasReviewer ? "soan_thao" : "xem_xet"
  }
  if (action === "phe_duyet") return "phe_duyet"
  return null
}

/** Suy bước ký từ chính danh tính người gọi (dùng khi request không kèm `action`). */
export function isoStepFromUser(
  doc: Record<string, unknown>,
  userId: string,
): IsoSignStep | null {
  if (userId && userId === doc.soan_thao_user_id) return "soan_thao"
  if (userId && userId === doc.xem_xet_user_id) return "xem_xet"
  if (userId && userId === doc.phe_duyet_user_id) return "phe_duyet"
  return null
}

export function resolveIsoSignStep(
  doc: Record<string, unknown>,
  userId: string,
  action?: string,
): IsoSignStep | null {
  return isoStepFromAction(doc, action) ?? isoStepFromUser(doc, userId)
}

/**
 * Token ký được cấp cho MỘT `docId`, nhưng một lượt ký ISO hợp lệ có thể chạm nhiều
 * tài liệu trong cùng một bộ (tài liệu cha + các hồ sơ con `parent_doc_id`, hoặc nhiều
 * hồ sơ con anh em của cùng một cha). Hàm này chấp nhận đúng 3 quan hệ đó và từ chối
 * mọi tài liệu ngoài bộ.
 *
 * Mirror đúng logic đã chạy thật ở `generate-office/route.ts` — không nới lỏng thêm.
 */
export async function tokenCoversDoc(
  admin: SupabaseClient,
  params: { tokenDocId: string; docId: string; factoryId: string; doc: Record<string, unknown> },
): Promise<boolean> {
  const { tokenDocId, docId, factoryId, doc } = params

  // Token cấp cho chính tài liệu này, hoặc cấp cho tài liệu cha của nó.
  if (tokenDocId === docId) return true
  if (doc.parent_doc_id && doc.parent_doc_id === tokenDocId) return true

  // Token cấp cho một hồ sơ con anh em trong cùng bộ (cùng `parent_doc_id`).
  const { data: tokenDoc } = await admin
    .from("iso_documents")
    .select("id, parent_doc_id")
    .eq("id", tokenDocId)
    .eq("factory_id", factoryId)
    .maybeSingle()

  return !!tokenDoc?.parent_doc_id && tokenDoc.parent_doc_id === doc.parent_doc_id
}

/**
 * Kiểm tra đầy đủ một request ký ISO. Trả về bước ký đã xác thực, hoặc lỗi kèm HTTP status.
 *
 * Quy tắc "người được giao bước đó" cố ý KHÔNG có ngoại lệ cho admin: giao diện
 * (`iso/documents/[id]/page.tsx`) cũng gate `canApprove`/`canXemXet` theo đúng
 * `userId === doc.*_user_id` bất kể vai trò, nên cho admin ký thay ở tầng API sẽ tạo ra
 * một năng lực mới không có trong UI và làm hỏng tính chống chối bỏ của chữ ký số.
 */
export async function authorizeIsoSignRequest(params: {
  admin: SupabaseClient
  tokenPayload: Record<string, unknown>
  docId: string
  docType: string
  factoryId: string
  doc: Record<string, unknown>
  action?: string
}): Promise<IsoSignAuthResult> {
  const { admin, tokenPayload, docId, docType, factoryId, doc, action } = params

  const userId = String(tokenPayload.userId || "")
  const tokenDocId = String(tokenPayload.docId || "")
  const tokenDocType = String(tokenPayload.docType || "")

  if (!userId || !tokenDocId || tokenDocType !== docType) {
    return { ok: false, error: "Token không hợp lệ", status: 401 }
  }

  if (!(await tokenCoversDoc(admin, { tokenDocId, docId, factoryId, doc }))) {
    return { ok: false, error: "Token không hợp lệ cho tài liệu này", status: 401 }
  }

  const step = resolveIsoSignStep(doc, userId, action)
  if (!step) {
    return { ok: false, error: "Người dùng không thuộc luồng ký tài liệu này", status: 403 }
  }

  const assignedUserId = doc[STEP_USER_COLUMN[step]]
  if (assignedUserId && assignedUserId !== userId) {
    return {
      ok: false,
      error: "Bạn không phải người được giao bước ký này của tài liệu",
      status: 403,
    }
  }

  if (!assignedUserId) {
    // Dữ liệu cũ (tạo trước khi các cột *_user_id được điền đủ) có thể để trống người ký
    // của bước này. CỐ Ý cho đi tiếp thay vì chặn: chặn sẽ làm kẹt vĩnh viễn các tài liệu
    // đang luân chuyển dở, trong khi giao diện vốn đã không cho ai bấm ký ở trường hợp này
    // (`canApprove`/`canXemXet` so với `doc.*_user_id` nên luôn false khi cột rỗng).
    console.warn(
      `[iso-sign-auth] doc ${docId} thiếu ${STEP_USER_COLUMN[step]} — cho qua theo diện dữ liệu cũ (user ${userId}, action ${action || "-"})`,
    )
  }

  return { ok: true, step }
}
