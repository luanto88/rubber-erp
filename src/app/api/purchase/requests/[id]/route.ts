import { NextRequest, NextResponse } from "next/server"
import { findKtWarehouse, KT_WAREHOUSE_CODE } from "@/lib/maintenance-kt"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { isMaintenanceRecordTeam, isPurchaseParticipant, loadEffectiveLines, loadPurchaseLines, loadPurchaseSigners, syncPurchaseFromSigning } from "@/lib/purchase/server"
import {
  isPurchaseBuying, isPurchaseEditable, remainingQty,
  type PurchaseAdjustmentSummary, type PurchaseEffectiveLine, type PurchaseReceiptRow, type PurchaseServiceCompletionRow, type PurchaseRequestRow, type PurchaseStatus, type PurchaseMaintenanceSource,
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
    // Phiếu lập từ biên bản bảo trì còn Nháp/Bị trả về:
    //  - nhóm phụ trách biên bản (người tạo + NV phụ trách) có purchase.create → thao tác ngang người đề
    //    nghị; ai gửi ký thì thành người đề nghị (claimOnSubmit);
    //  - người ngoài có purchase.create → "Nhận xử lý" (lưu phiếu ⇒ thành người đề nghị) rồi mới gửi ký.
    const linkedRecordId = (row as { maintenance_record_id?: string | null }).maintenance_record_id || null
    const hasCreatePerm = await isoActorHasPermission(actor, ["purchase.create"])
    const isRecordTeam = await isMaintenanceRecordTeam(linkedRecordId, actor.userId)
    const openLinked =
      !!linkedRecordId &&
      isPurchaseEditable(request.trang_thai as PurchaseStatus) &&
      request.loai !== "dieu_chinh" &&
      hasCreatePerm
    const canTakeOver = openLinked && !isRecordTeam
    if (!canAll && !canTakeOver && !isRecordTeam && !isPurchaseParticipant(request, actor.userId)) {
      return NextResponse.json({ error: "Bạn không có quyền xem phiếu này" }, { status: 403 })
    }

    const [lines, signers, logsRes] = await Promise.all([
      loadPurchaseLines(id),
      loadPurchaseSigners(request.yeu_cau_ky_id),
      supabaseAdmin.from("purchase_request_logs").select("hanh_dong, noi_dung, user_id, created_at").eq("request_id", id).order("created_at"),
    ])

    const ids = new Set<string>()
    const lapBoiId = (row as { lap_boi_id?: string | null }).lap_boi_id || null
    ;[request.nguoi_de_nghi_id, request.giam_doc_user_id, request.ke_toan_user_id, request.huy_boi, lapBoiId].forEach((v) => v && ids.add(v))
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
        .select("trang_thai, file_hien_tai, tra_ve_ly_do")
        .eq("id", request.yeu_cau_ky_id)
        .maybeSingle()
      fileHienTai = (yc?.file_hien_tai as string) || null
      traVeLyDo = (yc?.tra_ve_ly_do as string) || null

      // Yêu cầu ký đã hoàn tất mà phiếu vẫn 'cho_ky'/'tra_ve' (lượt ký trước lỡ đồng bộ hỏng) →
      // đồng bộ qua hàm chuẩn (ghi nhật ký + tính lại phiếu gốc của phiếu điều chỉnh), rồi đọc lại.
      if (yc?.trang_thai === "hoan_tat" && (request.trang_thai === "cho_ky" || request.trang_thai === "tra_ve")) {
        await syncPurchaseFromSigning(request.yeu_cau_ky_id)
        const { data: fresh } = await supabaseAdmin.from("purchase_requests").select("trang_thai, ngay_duyet").eq("id", id).maybeSingle()
        if (fresh) {
          request.trang_thai = fresh.trang_thai as PurchaseStatus
          request.ngay_duyet = fresh.ngay_duyet as string | null
        }
      }
    }

    const status = request.trang_thai as PurchaseStatus
    const isOwner = request.nguoi_de_nghi_id === actor.userId
    const anySigned = signers.some((s) => s.trangThai === "da_ky")
    const isAdjustment = request.loai === "dieu_chinh"
    // Người trong nhóm phụ trách biên bản (không phải người đề nghị) — chỉ khi Nháp/Bị trả về.
    const teamActsAsOwner = openLinked && isRecordTeam && !isOwner

    // ── GĐ2: tình hình mua thực tế (chỉ phiếu gốc đã duyệt trở đi) ──
    let effectiveLines: PurchaseEffectiveLine[] = []
    let receipts: PurchaseReceiptRow[] = []
    let serviceCompletions: PurchaseServiceCompletionRow[] = []
    let adjustments: PurchaseAdjustmentSummary[] = []
    let pendingAdjustmentId: string | null = null
    let parent: { id: string; so: number; nam: number } | null = null
    if (!isAdjustment && ["da_duyet", "dang_mua", "hoan_tat", "dong", "huy"].includes(status)) {
      const [eff, recRes, adjRes, svcRes] = await Promise.all([
        loadEffectiveLines(id).catch(() => [] as PurchaseEffectiveLine[]),
        supabaseAdmin.from("purchase_receipts").select("*").eq("request_id", id).order("created_at", { ascending: false }),
        supabaseAdmin.from("purchase_requests")
          .select("id, so, nam, trang_thai, ly_do_dieu_chinh, created_at")
          .eq("parent_request_id", id).eq("loai", "dieu_chinh").order("created_at", { ascending: false }),
        // Bảng chưa tồn tại (migration 20261023 chưa chạy) → coi như chưa có lần xác nhận nào.
        supabaseAdmin.from("purchase_service_completions").select("*").eq("request_id", id).order("created_at", { ascending: false }),
      ])
      serviceCompletions = ((svcRes.error ? [] : svcRes.data) || []).map((r) => {
        const c = r as PurchaseServiceCompletionRow
        return { ...c, so_luong: Number(c.so_luong), don_gia: Number(c.don_gia), image_urls: c.image_urls || [] }
      })
      for (const c of serviceCompletions) if (c.created_by) ids.add(c.created_by)
      effectiveLines = eff
      adjustments = (adjRes.data || []) as PurchaseAdjustmentSummary[]
      pendingAdjustmentId = adjustments.find((a) => ["nhap", "cho_ky", "tra_ve"].includes(a.trang_thai))?.id || null

      const recRows = (recRes.data || []) as (Omit<PurchaseReceiptRow, "warehouse_label" | "lines" | "cancelled">)[]
      const docIds = recRows.map((r) => r.inventory_document_id).filter(Boolean) as string[]
      const whIds = [...new Set(recRows.map((r) => r.warehouse_id).filter(Boolean) as string[])]
      const [docRes, lineRes, whRes] = await Promise.all([
        docIds.length ? supabaseAdmin.from("inventory_documents").select("id, status").in("id", docIds) : Promise.resolve({ data: [] }),
        docIds.length
          ? supabaseAdmin.from("inventory_document_lines").select("id, purchase_request_line_id, document_id, item_name, unit, quantity, don_gia, lot_no").in("document_id", docIds)
          : Promise.resolve({ data: [] }),
        whIds.length ? supabaseAdmin.from("inventory_warehouses").select("id, code, name").in("id", whIds) : Promise.resolve({ data: [] }),
      ])
      const docStatus = new Map(((docRes.data || []) as { id: string; status: string }[]).map((d) => [d.id, d.status]))
      const whLabel = new Map(((whRes.data || []) as { id: string; code: string; name: string }[]).map((w) => [w.id, `${w.code} — ${w.name}`]))
      const linesByDoc = new Map<string, PurchaseReceiptRow["lines"]>()
      for (const l of (lineRes.data || []) as (PurchaseReceiptRow["lines"][number] & { document_id: string; purchase_request_line_id: string | null })[]) {
        const arr = linesByDoc.get(l.document_id) || []
        arr.push({
          id: l.id, line_id: l.purchase_request_line_id,
          item_name: l.item_name, unit: l.unit, quantity: Number(l.quantity), don_gia: l.don_gia === null ? null : Number(l.don_gia), lot_no: l.lot_no,
        })
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

    // Dịch vụ gia công ngoài (la_dich_vu): không nhập kho, chỉ "Xác nhận hoàn thành".
    const serviceItemIds = await loadServiceItemIds([
      ...lines.map((l) => (l as { item_id?: string | null }).item_id),
      ...effectiveLines.map((e) => e.item_id),
    ])
    effectiveLines = effectiveLines.map((e) => ({ ...e, la_dich_vu: !!e.item_id && serviceItemIds.has(e.item_id) }))

    const buying = !isAdjustment && isPurchaseBuying(status)
    const hasRemaining = effectiveLines.some((e) => !e.la_dich_vu && remainingQty(e) > 0 && !e.pending_adjust)
    const hasServiceRemaining = effectiveLines.some((e) => e.la_dich_vu && remainingQty(e) > 0 && !e.pending_adjust)
    const hasAdjustable = effectiveLines.some((e) => remainingQty(e) > 0)

    let maintenanceSource: PurchaseMaintenanceSource | null = null
    if (linkedRecordId) {
      const [{ data: rec }, kt] = await Promise.all([
        supabaseAdmin.from("maintenance_records").select("ma_bb").eq("id", linkedRecordId).maybeSingle(),
        findKtWarehouse(actor.factoryId),
      ])
      maintenanceSource = { id: linkedRecordId, maBb: (rec?.ma_bb as string) || null, ktWarehouseId: kt?.id || null, ktCode: KT_WAREHOUSE_CODE }
    }
    // GĐ3: mã biên bản của các dòng gắn biên bản (hiển thị "Cho biên bản …").
    const lineRecordIds = [...new Set(lines.map((l) => l.maintenance_record_id).filter((v): v is string => !!v))]
    const lineRecords: Record<string, string | null> = {}
    if (lineRecordIds.length) {
      const { data } = await supabaseAdmin
        .from("maintenance_records")
        .select("id, ma_bb")
        .eq("factory_id", actor.factoryId)
        .in("id", lineRecordIds)
      for (const r of (data || []) as { id: string; ma_bb: string | null }[]) lineRecords[r.id] = r.ma_bb
    }

    return NextResponse.json({
      maintenanceSource,
      lineRecords,
      request,
      lines,
      signers,
      logs: logsRes.data || [],
      names,
      fileHienTai,
      traVeLyDo,
      effectiveLines,
      receipts,
      serviceCompletions,
      serviceItemIds: [...serviceItemIds],
      adjustments,
      pendingAdjustmentId,
      parent,
      perms: {
        // Phiếu điều chỉnh không sửa bằng form thường (form ghi lại toàn bộ dòng → mất liên kết dòng gốc).
        // Sửa / gửi ký cần quyền purchase.create — người tạo biên bản lập nháp hộ (chỉ có quyền bảo
        // trì) đứng tên người đề nghị nhưng không được tự gửi phiếu đi ký.
        canEdit: ((isOwner && hasCreatePerm) || teamActsAsOwner || canTakeOver) && isPurchaseEditable(status) && !isAdjustment,
        // Người ngoài nhóm phụ trách biên bản: phải bấm "Nhận xử lý" (Lưu) trước, rồi mới gửi ký.
        canTakeOver: canTakeOver && !isOwner,
        canSubmit: ((isOwner && hasCreatePerm) || teamActsAsOwner) && isPurchaseEditable(status),
        // Nhóm phụ trách biên bản gửi ký phiếu người khác đang đứng tên ⇒ qua panel chọn người ký, ở đó
        // người gửi thành người đề nghị (ký bước 1, ghi nhận mua).
        claimOnSubmit: teamActsAsOwner,
        // Người đề nghị hiện tại không có quyền mua hàng → chờ người có quyền "Nhận xử lý".
        needsBuyer: isOwner && !hasCreatePerm && isPurchaseEditable(status) && !isAdjustment,
        isRecordTeam,
        // Huỷ: người đề nghị / nhóm phụ trách biên bản khi Nháp/Bị trả về (chưa ai ký); ADMIN mọi trạng thái
        // chưa huỷ/hoàn tất, kể cả Đã duyệt mà chưa nhập kho lần nào; trừ phiếu đã nhập kho một phần.
        canCancel:
          ((isOwner || teamActsAsOwner) && (status === "nhap" || (status === "tra_ve" && !anySigned))) ||
          (actor.isAdmin && status !== "huy" && status !== "hoan_tat" && status !== "dang_mua" && status !== "dong"),
        // Ghi nhận mua / nhập kho: CHỈ người đề nghị + admin (GĐ2f — bỏ quyền inventory.create).
        canReceive: buying && hasRemaining && (isOwner || actor.isAdmin),
        // "Xác nhận hoàn thành" dịch vụ gia công: cùng quy tắc với Ghi nhận mua.
        canCompleteService: buying && hasServiceRemaining && (isOwner || actor.isAdmin),
        // GĐ4 A5: phiếu Hoàn tất vẫn lập được điều chỉnh CHỈ ĐỔI GIÁ (dòng đã nhập đủ).
        canAdjust: ((buying && hasAdjustable) || (!isAdjustment && status === "hoan_tat" && effectiveLines.length > 0)) && isOwner && !pendingAdjustmentId,
        // Sửa giá thực tế (≤ 10%) từng lần nhập / gia công, huỷ xác nhận gia công: người đề nghị + admin.
        canEditActualPrice: !isAdjustment && status !== "huy" && (isOwner || actor.isAdmin),
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

/** Tập item_id là dịch vụ gia công. Cột la_dich_vu chưa có (migration chưa chạy) → tập rỗng. */
async function loadServiceItemIds(itemIds: (string | null | undefined)[]): Promise<Set<string>> {
  const uniq = [...new Set(itemIds.filter(Boolean) as string[])]
  if (!uniq.length) return new Set()
  const { data, error } = await supabaseAdmin.from("inventory_items").select("id").in("id", uniq).eq("la_dich_vu", true)
  if (error) return new Set()
  return new Set(((data || []) as { id: string }[]).map((r) => r.id))
}
