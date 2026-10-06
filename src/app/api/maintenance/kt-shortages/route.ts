import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { computeKtStatuses } from "@/lib/maintenance-kt"

export const dynamic = "force-dynamic"

// GET — Biên bản bảo trì CHƯA xuất kho còn thiếu vật tư mua ngoài ở kho tạm KT (banner ở module
// Bảo trì và Đề nghị mua). `needsRequest` = phần thiếu chưa có phiếu đề nghị nào đang chờ nhập.
export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const allowed =
      actor.isAdmin || (await isoActorHasPermission(actor, ["maintenance.view", "purchase.view", "purchase.create"]))
    if (!allowed) return NextResponse.json({ records: [] })
    const statuses = await computeKtStatuses(actor.factoryId)
    const records = statuses
      .filter((s) => s.totalShortage > 0)
      .map((s) => ({
        recordId: s.recordId,
        maBb: s.maBb,
        boPhan: s.boPhan,
        needsRequest: s.needsRequest,
        items: s.items
          .filter((it) => it.shortage > 0)
          .map((it) => ({ name: it.name, unit: it.unit, shortage: it.shortage, pendingRequested: it.pendingRequested })),
      }))
    return NextResponse.json({ records })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
