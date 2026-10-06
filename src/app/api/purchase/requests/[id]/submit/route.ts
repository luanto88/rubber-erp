import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { cancelSigningRequest, createSigningRequest, type SigningFieldInput } from "@/lib/signing/requests"
import { scheduleSigningNotify } from "@/lib/signing/notify"
import { insertPurchaseLog } from "@/lib/purchase/server"
import {
  formatSoPhieuFull, isPurchaseEditable, PURCHASE_LOAI_TAI_LIEU, PURCHASE_MODUN, PURCHASE_SIGN_ORDER,
  PURCHASE_SNAPSHOT_MAX_AGE_MIN,
  type PurchaseSignRole, type PurchaseStatus,
} from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// POST — Gửi ký: tạo yêu cầu ký số dùng chung với PDF A5 do client dựng (bố cục cố định, toạ
// độ khung ký tính sẵn). Thứ tự cứng: Người đề nghị (10) → Giám đốc (20) → Kế toán (30).
// Gửi lại sau khi bị trả về: huỷ yêu cầu ký cũ rồi tạo yêu cầu MỚI với PDF dựng lại — lõi ký
// không tự dựng lại nội dung phiếu đã sửa.

type Body = {
  fileBase64: string
  fieldsByRole: Record<PurchaseSignRole, SigningFieldInput[]>
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const body = (await req.json()) as Body

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, factory_id, nam, so, nguoi_de_nghi_id, giam_doc_user_id, ke_toan_user_id, trang_thai, yeu_cau_ky_id")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!request) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })
    if (request.nguoi_de_nghi_id !== actor.userId) {
      return NextResponse.json({ error: "Chỉ người đề nghị được gửi ký" }, { status: 403 })
    }
    if (!isPurchaseEditable(request.trang_thai as PurchaseStatus)) {
      return NextResponse.json({ error: "Phiếu đã được gửi ký" }, { status: 409 })
    }
    if (!request.giam_doc_user_id || !request.ke_toan_user_id) {
      return NextResponse.json({ error: "Chưa chọn Giám đốc hoặc Kế toán" }, { status: 400 })
    }
    const ids = [request.nguoi_de_nghi_id, request.giam_doc_user_id, request.ke_toan_user_id]
    if (new Set(ids).size !== 3) {
      return NextResponse.json({ error: "Người đề nghị, Giám đốc và Kế toán phải là 3 người khác nhau" }, { status: 400 })
    }
    const { data: lineRows, error: lineErr } = await supabaseAdmin
      .from("purchase_request_lines")
      .select("id, item_id, insight_snapshot")
      .eq("request_id", id)
    if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 400 })
    if (!lineRows?.length) return NextResponse.json({ error: "Phiếu chưa có dòng vật tư" }, { status: 400 })
    // Bằng chứng cho người duyệt phải được chụp ngay trước khi dựng PDF (bước insight-snapshot).
    const minCaptured = Date.now() - PURCHASE_SNAPSHOT_MAX_AGE_MIN * 60000
    const stale = (lineRows as { item_id: string | null; insight_snapshot: { capturedAt?: string } | null }[]).some((l) => {
      if (!l.item_id) return false
      const t = Date.parse(l.insight_snapshot?.capturedAt || "")
      return !Number.isFinite(t) || t < minCaptured
    })
    if (stale) {
      return NextResponse.json({ error: "Số liệu tồn kho dùng làm bằng chứng đã cũ hoặc chưa được chụp — bấm gửi ký lại." }, { status: 409 })
    }

    const fileBytes = Buffer.from(String(body.fileBase64 || ""), "base64")
    if (!fileBytes.length) return NextResponse.json({ error: "File PDF rỗng" }, { status: 400 })
    for (const role of Object.keys(PURCHASE_SIGN_ORDER) as PurchaseSignRole[]) {
      if (!body.fieldsByRole?.[role]?.length) {
        return NextResponse.json({ error: "Thiếu khung ký trên phiếu" }, { status: 400 })
      }
    }

    // Gửi lại sau khi bị trả về → huỷ yêu cầu ký cũ (lúc này không còn ai ở trạng thái đã ký).
    if (request.yeu_cau_ky_id) {
      const { data: oldYc } = await supabaseAdmin
        .from("yeu_cau_ky").select("trang_thai").eq("id", request.yeu_cau_ky_id).maybeSingle()
      if (oldYc?.trang_thai === "dang_luan_chuyen") {
        await cancelSigningRequest({ yeuCauId: request.yeu_cau_ky_id, userId: actor.userId, isAdmin: actor.isAdmin })
      }
    }

    const userByRole: Record<PurchaseSignRole, string> = {
      nguoi_de_nghi: request.nguoi_de_nghi_id,
      giam_doc: request.giam_doc_user_id,
      ke_toan: request.ke_toan_user_id,
    }
    const signers = (Object.keys(PURCHASE_SIGN_ORDER) as PurchaseSignRole[]).map((role) => ({
      userId: userByRole[role],
      thuTu: PURCHASE_SIGN_ORDER[role].thuTu,
      vaiTro: PURCHASE_SIGN_ORDER[role].vaiTro,
      fields: body.fieldsByRole[role],
    }))

    const { yeuCauId, notifyPlan } = await createSigningRequest({
      factoryId: actor.factoryId,
      modun: PURCHASE_MODUN,
      loaiTaiLieu: PURCHASE_LOAI_TAI_LIEU,
      banGhiId: id,
      maHoSo: formatSoPhieuFull(request.so, request.nam),
      nguoiTaoId: actor.userId,
      fileBytes,
      fileExt: "pdf",
      signers,
    })

    const { error: upErr } = await supabaseAdmin
      .from("purchase_requests")
      .update({ trang_thai: "cho_ky", yeu_cau_ky_id: yeuCauId, updated_at: new Date().toISOString() })
      .eq("id", id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })

    await insertPurchaseLog({
      requestId: id, factoryId: actor.factoryId, userId: actor.userId,
      hanhDong: request.trang_thai === "tra_ve" ? "gui_lai" : "gui_ky",
    })
    scheduleSigningNotify(notifyPlan)

    return NextResponse.json({ yeuCauId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
