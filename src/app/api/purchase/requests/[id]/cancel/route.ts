import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { cancelPurchaseRequest, PurchaseCancelError } from "@/lib/purchase/cancel"

export const dynamic = "force-dynamic"

// POST { lyDo } — Huỷ phiếu đề nghị. KHÔNG xoá: số phiếu giữ nguyên, dãy số không bị hở.
// Quy tắc quyền + các bước: src/lib/purchase/cancel.ts (dùng chung với huỷ biên bản bảo trì).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const { lyDo } = (await req.json().catch(() => ({}))) as { lyDo?: string }
    await cancelPurchaseRequest({ actor, requestId: id, reason: String(lyDo || "") })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const status = err instanceof PurchaseCancelError ? err.status : isoAuthErrorStatus(err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: status === 500 ? 400 : status })
  }
}
