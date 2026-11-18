import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { closePurchaseRequest, PurchaseCancelError } from "@/lib/purchase/cancel"

export const dynamic = "force-dynamic"

// POST { lyDo } — Đóng phiếu ĐANG MUA khi mua thiếu và không mua tiếp. Phần còn lại không được
// nhập kho nữa. Người đề nghị hoặc admin; lý do bắt buộc. (Chưa mua gì → admin "Huỷ phiếu".)
// Logic: closePurchaseRequest (src/lib/purchase/cancel.ts), dùng chung với script rà soát.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const { lyDo } = (await req.json().catch(() => ({}))) as { lyDo?: string }
    await closePurchaseRequest({ actor, requestId: id, reason: String(lyDo || "") })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const status = err instanceof PurchaseCancelError ? err.status : isoAuthErrorStatus(err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: status === 500 ? 400 : status })
  }
}
