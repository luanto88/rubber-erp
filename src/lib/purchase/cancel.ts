import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { isoActorHasPermission, type IsoActor } from "@/app/api/iso/_lib/iso-actor"
import { cancelSigningRequest } from "@/lib/signing/requests"
import { scheduleModuleBroadcast } from "@/lib/signing/notify"
import {
  findPendingAdjustment,
  insertPurchaseLog,
  isMaintenanceRecordTeam,
  loadEffectiveLines,
  syncMaintenanceExtPricesForRequest,
} from "@/lib/purchase/server"
import { formatQty, formatSoPhieuFull, remainingQty, type PurchaseStatus } from "@/lib/purchase/types"

// Huỷ phiếu đề nghị mua — logic DUY NHẤT, dùng chung cho:
//  - route POST /api/purchase/requests/[id]/cancel;
//  - huỷ / xoá biên bản bảo trì kèm "huỷ luôn các phiếu đề nghị lập từ biên bản" (maintenance-record-close);
//  - script rà soát scripts/apply-audit-decisions.mjs (gọi route qua logic tương đương).
// KHÔNG xoá: số phiếu giữ nguyên, dãy số không bị hở.
//  - Người đề nghị (và nhóm phụ trách biên bản với phiếu lập từ biên bản): chỉ khi Nháp / Bị trả về (chưa ai ký).
//  - Admin: mọi trạng thái trừ Đã huỷ / Hoàn tất / Đang mua / Đóng (yêu cầu ký đã hoàn tất giữ nguyên làm bằng chứng).

export class PurchaseCancelError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export type PurchaseCancelTarget = {
  id: string
  factory_id: string
  nam: number
  so: number
  nguoi_de_nghi_id: string | null
  giam_doc_user_id: string | null
  ke_toan_user_id: string | null
  trang_thai: PurchaseStatus
  yeu_cau_ky_id: string | null
  loai: string | null
  maintenance_record_id: string | null
}

export const PURCHASE_CANCEL_SELECT =
  "id, factory_id, nam, so, nguoi_de_nghi_id, giam_doc_user_id, ke_toan_user_id, trang_thai, yeu_cau_ky_id, loai, maintenance_record_id"

/** Kiểm quyền + trạng thái. Trả `null` = được huỷ; ngược lại là lỗi (thông báo + mã HTTP). */
export async function checkPurchaseCancel(
  actor: IsoActor,
  request: PurchaseCancelTarget,
): Promise<{ message: string; status: number } | null> {
  const status = request.trang_thai
  if (status === "huy") return { message: "Phiếu đã huỷ", status: 409 }
  if (status === "hoan_tat") return { message: "Phiếu đã hoàn tất, không huỷ được", status: 409 }
  if (status === "dang_mua" || status === "dong") {
    return { message: "Phiếu đã nhập kho một phần — dùng \"Đóng phiếu\" thay vì huỷ", status: 409 }
  }
  if (actor.isAdmin) return null

  const isOwner = request.nguoi_de_nghi_id === actor.userId
  const editable = status === "nhap" || status === "tra_ve"
  // Nhóm phụ trách biên bản (người tạo + NV phụ trách, có purchase.create) được huỷ như người đề nghị
  // khi phiếu lập từ biên bản còn Nháp / Bị trả về.
  const isTeam =
    !isOwner && editable && request.loai !== "dieu_chinh" &&
    (await isMaintenanceRecordTeam(request.maintenance_record_id, actor.userId)) &&
    (await isoActorHasPermission(actor, ["purchase.create"]))
  let ownerAllowed = (isOwner || isTeam) && editable
  // Bị trả về nhưng đã có người ký trước đó → chỉ admin huỷ (cùng quy tắc với nút trên giao diện).
  if (ownerAllowed && status === "tra_ve" && request.yeu_cau_ky_id) {
    const { count } = await supabaseAdmin
      .from("nguoi_ky")
      .select("id", { count: "exact", head: true })
      .eq("yeu_cau_id", request.yeu_cau_ky_id)
      .eq("trang_thai", "da_ky")
    if ((count || 0) > 0) ownerAllowed = false
  }
  if (!ownerAllowed) return { message: "Chỉ admin được huỷ phiếu đã gửi ký / đã duyệt", status: 403 }
  return null
}

export async function loadPurchaseCancelTarget(factoryId: string, requestId: string): Promise<PurchaseCancelTarget | null> {
  const { data, error } = await supabaseAdmin
    .from("purchase_requests")
    .select(PURCHASE_CANCEL_SELECT)
    .eq("id", requestId)
    .eq("factory_id", factoryId)
    .maybeSingle()
  if (error) throw new PurchaseCancelError(error.message)
  return (data as PurchaseCancelTarget | null) || null
}

/**
 * Đóng phiếu ĐANG MUA khi mua thiếu và không mua tiếp (phần còn lại không nhập kho nữa).
 * Người đề nghị hoặc admin; lý do bắt buộc. Dùng chung route POST /api/purchase/requests/[id]/close + script.
 */
export async function closePurchaseRequest(params: {
  actor: IsoActor
  requestId: string
  reason: string
  notify?: boolean
}): Promise<void> {
  const { actor, requestId: id } = params
  const reason = params.reason.trim()
  if (!reason) throw new PurchaseCancelError("Bắt buộc nhập lý do đóng phiếu")

  const { data: request } = await supabaseAdmin
    .from("purchase_requests")
    .select("id, so, nam, loai, trang_thai, nguoi_de_nghi_id, giam_doc_user_id, ke_toan_user_id")
    .eq("id", id)
    .eq("factory_id", actor.factoryId)
    .maybeSingle()
  if (!request) throw new PurchaseCancelError("Không tìm thấy phiếu", 404)
  if (request.loai !== "goc") throw new PurchaseCancelError("Chỉ đóng được phiếu đề nghị gốc")
  if (request.nguoi_de_nghi_id !== actor.userId && !actor.isAdmin) {
    throw new PurchaseCancelError("Chỉ người đề nghị hoặc admin được đóng phiếu", 403)
  }
  if (request.trang_thai !== "dang_mua") {
    throw new PurchaseCancelError(
      request.trang_thai === "da_duyet"
        ? "Phiếu chưa nhập kho lần nào — nếu không mua nữa, nhờ admin huỷ phiếu"
        : "Chỉ đóng được phiếu đang mua",
      409,
    )
  }
  const pending = await findPendingAdjustment(id)
  if (pending) {
    throw new PurchaseCancelError(
      `Đang có phiếu điều chỉnh ${formatSoPhieuFull(pending.so, pending.nam)} chưa duyệt — huỷ hoặc chờ duyệt trước khi đóng`,
      409,
    )
  }

  const eff = await loadEffectiveLines(id)
  const remainLines = eff.filter((e) => remainingQty(e) > 0)
    .map((e) => `• ${e.item_name}: còn ${formatQty(remainingQty(e))} ${e.unit || ""} chưa mua`.trim())

  const { data: updated, error } = await supabaseAdmin
    .from("purchase_requests")
    .update({
      trang_thai: "dong",
      ly_do_dong: reason,
      dong_boi: actor.userId,
      dong_luc: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("trang_thai", "dang_mua")
    .select("id")
  if (error) throw new PurchaseCancelError(error.message)
  if (!updated?.length) throw new PurchaseCancelError("Trạng thái phiếu vừa thay đổi — tải lại trang", 409)

  await insertPurchaseLog({ requestId: id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "dong", noiDung: reason })

  if (params.notify !== false) {
    scheduleModuleBroadcast({
      modun: "purchase",
      factoryId: actor.factoryId,
      title: "Phiếu đề nghị mua đã đóng (mua thiếu)",
      docLabel: `Phiếu đề nghị mua VTHH ${formatSoPhieuFull(request.so, request.nam)}`,
      actorUserId: actor.userId,
      recipientUserIds: [request.nguoi_de_nghi_id, request.giam_doc_user_id, request.ke_toan_user_id].filter(Boolean) as string[],
      lines: [`Lý do: ${reason}`, ...remainLines.slice(0, 8)],
      link: `/dashboard/purchase/${id}`,
      notifType: "purchase_dong",
      docId: id,
      docType: "purchase_request",
    })
  }
}

/** Huỷ 1 phiếu đề nghị (đã kiểm quyền bên trong). `notify=false` ⇒ không gửi thông báo (script). */
export async function cancelPurchaseRequest(params: {
  actor: IsoActor
  requestId: string
  reason: string
  notify?: boolean
}): Promise<void> {
  const { actor } = params
  const reason = params.reason.trim()
  if (!reason) throw new PurchaseCancelError("Bắt buộc nhập lý do huỷ")
  const request = await loadPurchaseCancelTarget(actor.factoryId, params.requestId)
  if (!request) throw new PurchaseCancelError("Không tìm thấy phiếu", 404)
  const denied = await checkPurchaseCancel(actor, request)
  if (denied) throw new PurchaseCancelError(denied.message, denied.status)
  const status = request.trang_thai

  // Đóng yêu cầu ký còn đang luân chuyển (phiếu đã duyệt thì giữ nguyên 'hoan_tat').
  if (request.yeu_cau_ky_id) {
    const { data: yc } = await supabaseAdmin
      .from("yeu_cau_ky").select("trang_thai").eq("id", request.yeu_cau_ky_id).maybeSingle()
    if (yc?.trang_thai === "dang_luan_chuyen") {
      try {
        await cancelSigningRequest({ yeuCauId: request.yeu_cau_ky_id, userId: actor.userId, isAdmin: actor.isAdmin })
      } catch (err) {
        // Đã có người ký → lõi không cho huỷ; admin được đóng thẳng (giữ nguyên nhật ký ký).
        if (!actor.isAdmin) throw err
        const { error } = await supabaseAdmin.from("yeu_cau_ky").update({ trang_thai: "huy" }).eq("id", request.yeu_cau_ky_id)
        if (error) throw new PurchaseCancelError(error.message)
      }
    }
  }

  const { error: upErr } = await supabaseAdmin
    .from("purchase_requests")
    .update({
      trang_thai: "huy",
      ly_do_huy: reason,
      huy_boi: actor.userId,
      huy_luc: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.id)
  if (upErr) throw new PurchaseCancelError(upErr.message)

  await insertPurchaseLog({ requestId: request.id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "huy", noiDung: reason })
  // GĐ4: phiếu huỷ không còn là nguồn giá ⇒ biên bản gắn dòng quay về phiếu khác / giá tham chiếu.
  await syncMaintenanceExtPricesForRequest(actor.factoryId, request.id)

  if (params.notify !== false && status !== "nhap") {
    scheduleModuleBroadcast({
      modun: "purchase",
      factoryId: actor.factoryId,
      title: "Phiếu đề nghị mua bị huỷ",
      docLabel: `Phiếu đề nghị mua VTHH ${formatSoPhieuFull(request.so, request.nam)}`,
      actorUserId: actor.userId,
      recipientUserIds: [request.nguoi_de_nghi_id, request.giam_doc_user_id, request.ke_toan_user_id].filter(Boolean) as string[],
      lines: [`Lý do huỷ: ${reason}`, "Số phiếu vẫn được giữ, không cấp lại."],
      link: `/dashboard/purchase/${request.id}`,
      notifType: "purchase_huy",
      docId: request.id,
      docType: "purchase_request",
    })
  }
}
