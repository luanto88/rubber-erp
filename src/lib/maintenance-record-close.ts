import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { reverseMaintenanceStockIssuance } from "@/lib/maintenance-stock-issuance"
import type { IsoActor } from "@/app/api/iso/_lib/iso-actor"
import {
  cancelPurchaseRequest,
  checkPurchaseCancel,
  PURCHASE_CANCEL_SELECT,
  type PurchaseCancelTarget,
} from "@/lib/purchase/cancel"
import { formatSoPhieuFull, PURCHASE_STATUS_LABEL, type PurchaseStatus } from "@/lib/purchase/types"

// ── Phiếu đề nghị mua liên quan biên bản ────────────────────────────────────────────────
// "Huỷ được" = phiếu LẬP TỪ biên bản này (purchase_requests.maintenance_record_id) còn Nháp / Bị trả
// về / Đang ký. Phiếu đã duyệt / đang mua / đóng, hoặc phiếu lập riêng chỉ có DÒNG gắn biên bản ⇒ chỉ
// cảnh báo (hàng có thể đã mua; phiếu có thể phục vụ biên bản khác).
export type RecordLinkedPurchase = {
  id: string
  soPhieu: string
  trangThai: PurchaseStatus
  trangThaiLabel: string
  loai: string | null
  /** true = phiếu lập từ biên bản; false = chỉ có dòng gắn biên bản. */
  fromRecord: boolean
  /** Thuộc nhóm "huỷ kèm" (đúng trạng thái + lập từ biên bản). */
  cancellable: boolean
  /** Người đang thao tác có quyền huỷ (chỉ có nghĩa khi cancellable). */
  canCancel: boolean
  blockReason: string | null
}

const CANCELLABLE_STATUSES: PurchaseStatus[] = ["nhap", "tra_ve", "cho_ky"]

export async function listRecordLinkedPurchases(actor: IsoActor, recordId: string): Promise<RecordLinkedPurchase[]> {
  const sb = getSupabaseAdmin()
  const { data: origin, error: oErr } = await sb
    .from("purchase_requests")
    .select(PURCHASE_CANCEL_SELECT)
    .eq("factory_id", actor.factoryId)
    .eq("maintenance_record_id", recordId)
    .neq("trang_thai", "huy")
    .order("created_at", { ascending: true })
  if (oErr) throw new MaintenanceCloseError(oErr.message)

  const { data: lineRows, error: lErr } = await sb
    .from("purchase_request_lines")
    .select("request_id")
    .eq("maintenance_record_id", recordId)
  if (lErr) throw new MaintenanceCloseError(lErr.message)
  const originIds = new Set(((origin || []) as PurchaseCancelTarget[]).map((r) => r.id))
  const otherIds = Array.from(
    new Set(((lineRows || []) as { request_id: string }[]).map((l) => l.request_id).filter((rid) => !originIds.has(rid))),
  )
  let others: PurchaseCancelTarget[] = []
  for (let i = 0; i < otherIds.length; i += 200) {
    const { data, error } = await sb
      .from("purchase_requests")
      .select(PURCHASE_CANCEL_SELECT)
      .eq("factory_id", actor.factoryId)
      .in("id", otherIds.slice(i, i + 200))
      .neq("trang_thai", "huy")
    if (error) throw new MaintenanceCloseError(error.message)
    others = others.concat((data || []) as PurchaseCancelTarget[])
  }

  const out: RecordLinkedPurchase[] = []
  for (const [list, fromRecord] of [[(origin || []) as PurchaseCancelTarget[], true], [others, false]] as const) {
    for (const r of list) {
      const cancellable = fromRecord && CANCELLABLE_STATUSES.includes(r.trang_thai)
      const denied = cancellable ? await checkPurchaseCancel(actor, r) : null
      out.push({
        id: r.id,
        soPhieu: formatSoPhieuFull(r.so, r.nam),
        trangThai: r.trang_thai,
        trangThaiLabel: PURCHASE_STATUS_LABEL[r.trang_thai] || r.trang_thai,
        loai: r.loai,
        fromRecord,
        cancellable,
        canCancel: cancellable && !denied,
        blockReason: denied?.message || null,
      })
    }
  }
  return out
}

// Huỷ / Xoá biên bản bảo trì — chạy ở SERVER (service role) để mọi bước đi cùng nhau:
//   1. đóng yêu cầu ký đang luân chuyển (trước đây vẫn ký tiếp được ⇒ ký xong tự xuất kho và đổi biên bản
//      "Đã hủy" thành "Đã duyệt");
//   2. huỷ các phiếu xuất kho X-BT-<mã> đã ghi sổ (hoàn tồn) — từ 20261130 phiếu X-BT chỉ huỷ được ở đây
//      (và "Hủy sau khi hoàn tất" / "Thử xuất kho lại"), không huỷ ở module Kho;
//   3. gỡ phân bổ dòng đề nghị mua cho biên bản (trả lại SL cho dòng);
//   4. cập nhật / xoá biên bản.
// Trước đây các bước chạy rời ở trình duyệt: lỗi giữa chừng ⇒ hàng đã hoàn kho mà biên bản vẫn "Đã duyệt".

export class MaintenanceCloseError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export async function closeMaintenanceRecord(params: {
  factoryId: string
  recordId: string
  actorId: string
  isAdmin: boolean
  mode: "cancel" | "delete"
  reason: string
  /** Huỷ kèm các phiếu đề nghị lập từ biên bản (phải thuộc nhóm "huỷ được" + người gọi có quyền). */
  cancelPurchaseIds?: string[]
  /** Bắt buộc khi có cancelPurchaseIds (kiểm quyền huỷ phiếu đề nghị). */
  actor?: IsoActor
  /** false ⇒ không gửi thông báo huỷ phiếu đề nghị (script). */
  notify?: boolean
}): Promise<{ maBb: string | null; cancelledDocs: number; cancelledPurchases: string[] }> {
  const sb = getSupabaseAdmin()
  const reason = params.reason.trim()
  if (!reason) throw new MaintenanceCloseError("Bắt buộc nhập lý do")

  const { data: record, error: recErr } = await sb
    .from("maintenance_records")
    .select("id, ma_bb, trang_thai, created_by, inventory_issue_doc_id, inventory_issue_doc_ids")
    .eq("id", params.recordId)
    .eq("factory_id", params.factoryId)
    .maybeSingle()
  if (recErr) throw new MaintenanceCloseError(recErr.message)
  if (!record) throw new MaintenanceCloseError("Không tìm thấy biên bản", 404)

  const { data: ycRows, error: ycErr } = await sb
    .from("yeu_cau_ky")
    .select("id, trang_thai")
    .eq("factory_id", params.factoryId)
    .eq("modun", "maintenance")
    .eq("ban_ghi_id", params.recordId)
    .in("trang_thai", ["dang_luan_chuyen", "hoan_tat"])
  if (ycErr) throw new MaintenanceCloseError(ycErr.message)
  const signing = (ycRows || []).find((y) => y.trang_thai === "dang_luan_chuyen")
  const signed = (ycRows || []).find((y) => y.trang_thai === "hoan_tat")

  const isCreator = record.created_by === params.actorId
  const status = record.trang_thai as string | null
  if (params.mode === "cancel") {
    if (status === "huy") throw new MaintenanceCloseError("Biên bản đã huỷ", 409)
    // Đã duyệt hoặc đã ký xong (kẹt xuất kho) ⇒ chỉ admin. Chờ duyệt ⇒ người tạo hoặc admin.
    if ((status === "da_duyet" || signed) && !params.isAdmin) {
      throw new MaintenanceCloseError("Chỉ admin được huỷ biên bản đã duyệt / đã ký xong", 403)
    }
    if (!params.isAdmin && !isCreator) throw new MaintenanceCloseError("Chỉ người tạo biên bản hoặc admin được huỷ", 403)
  } else {
    if (!params.isAdmin && !(isCreator && status === "cho_duyet" && !signing && !signed)) {
      throw new MaintenanceCloseError("Chỉ admin, hoặc người tạo khi biên bản chờ duyệt chưa gửi ký, được xoá", 403)
    }
  }

  // Phiếu xuất kho đã ghi sổ: id lưu trên biên bản + phiếu mồ côi theo mã X-BT-<mã biên bản>.
  const ids = new Set<string>(
    ((record.inventory_issue_doc_ids as string[] | null) || [record.inventory_issue_doc_id as string | null]).filter(
      (v): v is string => !!v,
    ),
  )
  if (record.ma_bb) {
    const { data: byCode, error } = await sb
      .from("inventory_documents")
      .select("id")
      .eq("factory_id", params.factoryId)
      .like("document_code", `X-BT-${record.ma_bb}%`)
    if (error) throw new MaintenanceCloseError(error.message)
    for (const d of (byCode || []) as { id: string }[]) ids.add(d.id)
  }
  let postedIds: string[] = []
  if (ids.size) {
    const { data: docs, error } = await sb.from("inventory_documents").select("id, status").in("id", Array.from(ids))
    if (error) throw new MaintenanceCloseError(error.message)
    postedIds = ((docs || []) as { id: string; status: string }[]).filter((d) => d.status === "posted").map((d) => d.id)
  }

  const label = params.mode === "cancel" ? "Huỷ biên bản" : "Xoá biên bản"

  // 0. Phiếu đề nghị huỷ kèm — kiểm TOÀN BỘ trước khi ghi bất cứ thứ gì, rồi huỷ TRƯỚC biên bản (xoá
  //    biên bản ⇒ FK ON DELETE SET NULL làm mất liên kết phiếu ↔ biên bản).
  const cancelPurchaseIds = Array.from(new Set((params.cancelPurchaseIds || []).filter(Boolean)))
  const cancelledPurchases: string[] = []
  if (cancelPurchaseIds.length) {
    if (!params.actor) throw new MaintenanceCloseError("Thiếu thông tin người thao tác để huỷ phiếu đề nghị")
    const linked = await listRecordLinkedPurchases(params.actor, params.recordId)
    const byId = new Map(linked.map((p) => [p.id, p]))
    for (const pid of cancelPurchaseIds) {
      const p = byId.get(pid)
      if (!p || !p.cancellable) throw new MaintenanceCloseError("Có phiếu đề nghị không thuộc nhóm được huỷ kèm biên bản này", 409)
      if (!p.canCancel) throw new MaintenanceCloseError(`Phiếu ${p.soPhieu}: ${p.blockReason || "không có quyền huỷ"}`, 403)
    }
    for (const pid of cancelPurchaseIds) {
      await cancelPurchaseRequest({
        actor: params.actor,
        requestId: pid,
        reason: `${label} ${record.ma_bb || ""}: ${reason}`,
        notify: params.notify,
      })
      cancelledPurchases.push(byId.get(pid)?.soPhieu || pid)
    }
  }

  // 1. Đóng yêu cầu ký trước để không ai ký tiếp trong lúc đang huỷ.
  for (const y of [signing, signed].filter((v): v is { id: string; trang_thai: string } => !!v)) {
    const { error } = await sb.from("yeu_cau_ky").update({ trang_thai: "huy" }).eq("id", y.id)
    if (error) throw new MaintenanceCloseError(error.message)
    await sb.from("nhat_ky_ky").insert({
      factory_id: params.factoryId,
      yeu_cau_id: y.id,
      hanh_dong: params.mode === "cancel" ? "huy_bien_ban" : "xoa_bien_ban",
      user_id: params.actorId,
      chi_tiet: { ma_bb: record.ma_bb, ly_do: reason, trang_thai_truoc: y.trang_thai },
    })
  }

  // 2. Hoàn tồn (lỗi ⇒ dừng, biên bản giữ nguyên trạng thái — báo cho người dùng).
  if (postedIds.length) {
    await reverseMaintenanceStockIssuance({
      factoryId: params.factoryId,
      issueDocIds: postedIds,
      cancelledByUserId: params.actorId,
      reason: `${label} ${record.ma_bb || ""}: ${reason}`,
    })
  }

  // 3. Gỡ phân bổ dòng đề nghị mua (bảng chưa có ⇒ bỏ qua).
  await sb.from("purchase_line_record_allocations").delete().eq("maintenance_record_id", params.recordId)

  // 4. Biên bản.
  if (params.mode === "cancel") {
    const { error } = await sb
      .from("maintenance_records")
      .update({
        trang_thai: "huy",
        inventory_issue_doc_id: null,
        inventory_issue_doc_ids: null,
        ly_do_huy: reason,
        huy_boi: params.actorId,
        huy_luc: new Date().toISOString(),
      })
      .eq("id", params.recordId)
      .eq("factory_id", params.factoryId)
    if (error) throw new MaintenanceCloseError(error.message)
  } else {
    const { error } = await sb.from("maintenance_records").delete().eq("id", params.recordId).eq("factory_id", params.factoryId)
    if (error) throw new MaintenanceCloseError(error.message)
  }
  return { maBb: (record.ma_bb as string | null) || null, cancelledDocs: postedIds.length, cancelledPurchases }
}
