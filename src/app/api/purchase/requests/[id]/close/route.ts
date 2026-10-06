import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { scheduleModuleBroadcast } from "@/lib/signing/notify"
import { findPendingAdjustment, insertPurchaseLog, loadEffectiveLines } from "@/lib/purchase/server"
import { formatQty, formatSoPhieuFull, remainingQty } from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// POST { lyDo } — Đóng phiếu ĐANG MUA khi mua thiếu và không mua tiếp. Phần còn lại không được
// nhập kho nữa. Người đề nghị hoặc admin; lý do bắt buộc. (Chưa mua gì → admin "Huỷ phiếu".)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const { lyDo } = (await req.json().catch(() => ({}))) as { lyDo?: string }
    const reason = String(lyDo || "").trim()
    if (!reason) return NextResponse.json({ error: "Bắt buộc nhập lý do đóng phiếu" }, { status: 400 })

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, so, nam, loai, trang_thai, nguoi_de_nghi_id, giam_doc_user_id, ke_toan_user_id")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!request) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })
    if (request.loai !== "goc") return NextResponse.json({ error: "Chỉ đóng được phiếu đề nghị gốc" }, { status: 400 })
    if (request.nguoi_de_nghi_id !== actor.userId && !actor.isAdmin) {
      return NextResponse.json({ error: "Chỉ người đề nghị hoặc admin được đóng phiếu" }, { status: 403 })
    }
    if (request.trang_thai !== "dang_mua") {
      return NextResponse.json({
        error: request.trang_thai === "da_duyet"
          ? "Phiếu chưa nhập kho lần nào — nếu không mua nữa, nhờ admin huỷ phiếu"
          : "Chỉ đóng được phiếu đang mua",
      }, { status: 409 })
    }
    const pending = await findPendingAdjustment(id)
    if (pending) {
      return NextResponse.json({ error: `Đang có phiếu điều chỉnh ${formatSoPhieuFull(pending.so, pending.nam)} chưa duyệt — huỷ hoặc chờ duyệt trước khi đóng` }, { status: 409 })
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
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!updated?.length) return NextResponse.json({ error: "Trạng thái phiếu vừa thay đổi — tải lại trang" }, { status: 409 })

    await insertPurchaseLog({ requestId: id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "dong", noiDung: reason })

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

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
