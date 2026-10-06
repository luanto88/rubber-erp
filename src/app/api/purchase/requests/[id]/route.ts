import { NextRequest, NextResponse } from "next/server"
import { findKtWarehouse, KT_WAREHOUSE_CODE } from "@/lib/maintenance-kt"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { isPurchaseParticipant, loadEffectiveLines, loadPurchaseLines, loadPurchaseSigners } from "@/lib/purchase/server"
import {
  isPurchaseBuying, isPurchaseEditable, remainingQty,
  type PurchaseAdjustmentSummary, type PurchaseEffectiveLine, type PurchaseReceiptRow, type PurchaseRequestRow, type PurchaseStatus, type PurchaseMaintenanceSource,
} from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// GET — chi tiết 1 phiếu (đích đến của QR in trên phiếu). Chỉ người liên quan, purchase.view_all
// hoặc admin được xem; người khác nhận 403 "Không có quyền xem".
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params

    const { data: row } = await supabaseAdmin
      .from("purchase_requests")
      .select("*")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: "Không tìm thấy phiếu đề nghị" }, { status: 404 })
    const request = row as PurchaseRequestRow & { created_by: string | null; huy_boi: string | null }

    const canAll = actor.isAdmin || (await isoActorHasPermission(actor, ["purchase.view_all"]))
    // GĐ2g: phiếu lập từ biên bản bảo trì còn nháp/bị trả về → người có purchase.create được mở để nhận xử lý.
    const linkedRecordId = (row as { maintenance_record_id?: string | null }).maintenance_record_id || null
    const canTakeOver =
      !!linkedRecordId &&
      isPurchaseEditable(request.trang_thai as PurchaseStatus) &&
      request.loai !== "dieu_chinh" &&
      (await isoActorHasPermission(actor, ["purchase.create"]))
    if (!canAll && !canTakeOver && !isPurchaseParticipant(request, actor.userId)) {
      return NextResponse.json({ error: "Bạn không có quyền xem phiếu này" }, { status: 403 })
    }

    const [lines, signers, logsRes] = await Promise.all([
      loadPurchaseLines(id),
      loadPurchaseSigners(request.yeu_cau_ky_id),
      supabaseAdmin.from("purchase_request_logs").select("hanh_dong, noi_dung, user_id, created_at").eq("request_id", id).order("created_at"),
    ])

    const ids = new Set<string>()
    ;[request.nguoi_de_nghi_id, request.giam_doc_user_id, request.ke_toan_user_id, request.huy_boi].forEach((v) => v && ids.add(v))
    for (const l of (logsRes.data || []) as { user_id: string | null }[]) if (l.user_id) ids.add(l.user_id)
    const names: Record<string, string> = {}
    if (ids.size) {
      const { data } = await supabaseAdmin.from("profiles").select("id, full_name, username").in("id", [...ids])
      for (const p of (data || []) as { id: string; full_name: string | null; username: string | null }[]) {
        names[p.id] = p.full_name || p.username || ""
      }
    }

    let fileHienTai: string | null = null
    let traVeLyDo: string | null = null
    if (request.yeu_cau_ky_id) {
      const { data: yc } = await supabaseAdmin
        .from("yeu_cau_ky")
        .select("file_hien_tai, tra_ve_ly_do")
        .eq("id", request.yeu_cau_ky_id)
        .maybeSingle()
      fileHienTai = (yc?.file_hien_tai as string) || null
      traVeLyDo = (yc?.tra_ve_ly_do as string) || null
    }

    const status = request.trang_thai as PurchaseStatus
    const isOwner = request.nguoi_de_nghi_id === actor.userId
    const anySigned = signers.some((s) => s.trangThai === "da_ky")
    const isAdjustment = request.loai === "dieu_chinh"

    // ── GĐ2: tình hình mua thực tế (chỉ phiếu gốc đã duyệt trở đi) ──
    let effectiveLines: PurchaseEffectiveLine[] = []
    let receipts: PurchaseReceiptRow[] = []
    let adjustments: PurchaseAdjustmentSummary[] = []
    let pendingAdjustmentId: string | null = null
    let parent: { id: string; so: number; nam: number } | null = null
    if (!isAdjustment && ["da_duyet", "dang_mua", "hoan_tat", "dong", "huy"].includes(status)) {
      const [eff, recRes, adjRes] = await Promise.all([
        loadEffectiveLines(id).catch(() => [] as PurchaseEffectiveLine[]),
        supabaseAdmin.from("purchase_receipts").select("*").eq("request_id", id).order("created_at", { ascending: false }),
        supabaseAdmin.from("purchase_requests")
          .select("id, so, nam, trang_thai, ly_do_dieu_chinh, created_at")
          .eq("parent_request_id", id).eq("loai", "dieu_chinh").order("created_at", { ascending: false }),
      ])
      effectiveLines = eff
      adjustments = (adjRes.data || []) as PurchaseAdjustmentSummary[]
      pendingAdjustmentId = adjustments.find((a) => ["nhap", "cho_ky", "tra_ve"].includes(a.trang_thai))?.id || null

      const recRows = (recRes.data || []) as (Omit<PurchaseReceiptRow, "warehouse_label" | "lines" | "cancelled">)[]
      const docIds = recRows.map((r) => r.inventory_document_id).filter(Boolean) as string[]
      const whIds = [...new Set(recRows.map((r) => r.warehouse_id).filter(Boolean) as string[])]
      const [docRes, lineRes, whRes] = await Promise.all([
        docIds.length ? supabaseAdmin.from("inventory_documents").select("id, status").in("id", docIds) : Promise.resolve({ data: [] }),
        docIds.length
          ? supabaseAdmin.from("inventory_document_lines").select("document_id, item_name, unit, quantity, don_gia, lot_no").in("document_id", docIds)
          : Promise.resolve({ data: [] }),
        whIds.length ? supabaseAdmin.from("inventory_warehouses").select("id, code, name").in("id", whIds) : Promise.resolve({ data: [] }),
      ])
      const docStatus = new Map(((docRes.data || []) as { id: string; status: string }[]).map((d) => [d.id, d.status]))
      const whLabel = new Map(((whRes.data || []) as { id: string; code: string; name: string }[]).map((w) => [w.id, `${w.code} — ${w.name}`]))
      const linesByDoc = new Map<string, PurchaseReceiptRow["lines"]>()
      for (const l of (lineRes.data || []) as (PurchaseReceiptRow["lines"][number] & { document_id: string })[]) {
        const arr = linesByDoc.get(l.document_id) || []
        arr.push({ item_name: l.item_name, unit: l.unit, quantity: Number(l.quantity), don_gia: l.don_gia === null ? null : Number(l.don_gia), lot_no: l.lot_no })
        linesByDoc.set(l.document_id, arr)
      }
      receipts = recRows.map((r) => ({
        ...r,
        warehouse_label: (r.warehouse_id && whLabel.get(r.warehouse_id)) || "",
        lines: (r.inventory_document_id && linesByDoc.get(r.inventory_document_id)) || [],
        cancelled: !!r.inventory_document_id && docStatus.get(r.inventory_document_id) === "cancelled",
      }))
      for (const r of receipts) if (r.created_by) ids.add(r.created_by)
    }
    if (isAdjustment && request.parent_request_id) {
      const { data: p } = await supabaseAdmin.from("purchase_requests").select("id, so, nam").eq("id", request.parent_request_id).maybeSingle()
      parent = (p as typeof parent) || null
    }
    // Tên người ghi nhận mua (thêm sau khi đã tra tên ở trên).
    const missing = [...ids].filter((uid) => !(uid in names))
    if (missing.length) {
      const { data } = await supabaseAdmin.from("profiles").select("id, full_name, username").in("id", missing)
      for (const p of (data || []) as { id: string; full_name: string | null; username: string | null }[]) {
        names[p.id] = p.full_name || p.username || ""
      }
    }

    const buying = !isAdjustment && isPurchaseBuying(status)
    const hasRemaining = effectiveLines.some((e) => remainingQty(e) > 0 && !e.pending_adjust)
    const hasAdjustable = effectiveLines.some((e) => remainingQty(e) > 0)

    let maintenanceSource: PurchaseMaintenanceSource | null = null
    if (linkedRecordId) {
      const [{ data: rec }, kt] = await Promise.all([
        supabaseAdmin.from("maintenance_records").select("ma_bb").eq("id", linkedRecordId).maybeSingle(),
        findKtWarehouse(actor.factoryId),
      ])
      maintenanceSource = { id: linkedRecordId, maBb: (rec?.ma_bb as string) || null, ktWarehouseId: kt?.id || null, ktCode: KT_WAREHOUSE_CODE }
    }

    return NextResponse.json({
      maintenanceSource,
      request,
      lines,
      signers,
      logs: logsRes.data || [],
      names,
      fileHienTai,
      traVeLyDo,
      effectiveLines,
      receipts,
      adjustments,
      pendingAdjustmentId,
      parent,
      perms: {
        // Phiếu điều chỉnh không sửa bằng form thường (form ghi lại toàn bộ dòng → mất liên kết dòng gốc).
        canEdit: (isOwner || canTakeOver) && isPurchaseEditable(status) && !isAdjustment,
        // Phiếu từ biên bản, người xem chưa phải người đề nghị: phải bấm Lưu ("Nhận xử lý") trước khi gửi ký.
        canTakeOver: canTakeOver && !isOwner,
        canSubmit: isOwner && isPurchaseEditable(status),
        // Huỷ: người đề nghị khi Nháp/Bị trả về; ADMIN ở mọi trạng thái chưa huỷ/hoàn tất, trừ phiếu
        // đã nhập kho một phần (dùng "Đóng phiếu").
        canCancel:
          (isOwner && (status === "nhap" || (status === "tra_ve" && !anySigned))) ||
          (actor.isAdmin && status !== "huy" && status !== "hoan_tat" && status !== "dang_mua" && status !== "dong"),
        // Ghi nhận mua / nhập kho: CHỈ người đề nghị + admin (GĐ2f — bỏ quyền inventory.create).
        canReceive: buying && hasRemaining && (isOwner || actor.isAdmin),
        canAdjust: buying && hasAdjustable && isOwner && !pendingAdjustmentId,
        canClose: !isAdjustment && status === "dang_mua" && (isOwner || actor.isAdmin) && !pendingAdjustmentId,
        // Ảnh theo dòng: người đề nghị + admin, kể cả sau khi ký (ảnh không in lên PDF), trừ phiếu đã huỷ.
        canEditImages: (isOwner || actor.isAdmin) && status !== "huy",
        isAdmin: actor.isAdmin,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
