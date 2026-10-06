import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { cancelSigningRequest } from "@/lib/signing/requests"
import { scheduleModuleBroadcast } from "@/lib/signing/notify"
import { insertPurchaseLog } from "@/lib/purchase/server"
import { formatSoPhieuFull, type PurchaseStatus } from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// POST { lyDo } — Huỷ phiếu đề nghị. KHÔNG xoá: số phiếu giữ nguyên, dãy số không bị hở.
//  - Người đề nghị: chỉ khi Nháp / Bị trả về (chưa ai ký).
//  - Admin: mọi trạng thái trừ Đã huỷ / Hoàn tất, kể cả phiếu ĐÃ DUYỆT nhưng không mua
//    (yêu cầu ký giữ 'hoan_tat', PDF đã ký giữ nguyên làm bằng chứng).
// Lý do bắt buộc ở mọi trường hợp.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const { lyDo } = (await req.json().catch(() => ({}))) as { lyDo?: string }
    const reason = String(lyDo || "").trim()
    if (!reason) return NextResponse.json({ error: "Bắt buộc nhập lý do huỷ" }, { status: 400 })

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, factory_id, nam, so, nguoi_de_nghi_id, giam_doc_user_id, ke_toan_user_id, trang_thai, yeu_cau_ky_id")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!request) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })

    const status = request.trang_thai as PurchaseStatus
    if (status === "huy") return NextResponse.json({ error: "Phiếu đã huỷ" }, { status: 409 })
    if (status === "hoan_tat") return NextResponse.json({ error: "Phiếu đã hoàn tất, không huỷ được" }, { status: 409 })
    if (status === "dang_mua" || status === "dong") {
      return NextResponse.json({ error: "Phiếu đã nhập kho một phần — dùng \"Đóng phiếu\" thay vì huỷ" }, { status: 409 })
    }

    const isOwner = request.nguoi_de_nghi_id === actor.userId
    const ownerAllowed = isOwner && (status === "nhap" || status === "tra_ve")
    if (!actor.isAdmin && !ownerAllowed) {
      return NextResponse.json({ error: "Chỉ admin được huỷ phiếu đã gửi ký / đã duyệt" }, { status: 403 })
    }

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
          if (error) return NextResponse.json({ error: error.message }, { status: 400 })
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
      .eq("id", id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })

    await insertPurchaseLog({ requestId: id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "huy", noiDung: reason })

    if (status !== "nhap") {
      scheduleModuleBroadcast({
        modun: "purchase",
        factoryId: actor.factoryId,
        title: "Phiếu đề nghị mua bị huỷ",
        docLabel: `Phiếu đề nghị mua VTHH ${formatSoPhieuFull(request.so, request.nam)}`,
        actorUserId: actor.userId,
        recipientUserIds: [request.nguoi_de_nghi_id, request.giam_doc_user_id, request.ke_toan_user_id].filter(Boolean) as string[],
        lines: [`Lý do huỷ: ${reason}`, "Số phiếu vẫn được giữ, không cấp lại."],
        link: `/dashboard/purchase/${id}`,
        notifType: "purchase_huy",
        docId: id,
        docType: "purchase_request",
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
