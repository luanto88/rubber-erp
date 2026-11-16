import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { reverseMaintenanceStockIssuance } from "@/lib/maintenance-stock-issuance"

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
}): Promise<{ maBb: string | null; cancelledDocs: number }> {
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

  // 1. Đóng yêu cầu ký trước để không ai ký tiếp trong lúc đang huỷ.
  const label = params.mode === "cancel" ? "Huỷ biên bản" : "Xoá biên bản"
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
  return { maBb: (record.ma_bb as string | null) || null, cancelledDocs: postedIds.length }
}
