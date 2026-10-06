import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { computeKtStatuses } from "@/lib/maintenance-kt"

export const dynamic = "force-dynamic"

// GET — Vật tư mua ngoài của 1 biên bản: cần / khả dụng ở kho tạm KT / thiếu / đang đề nghị
// + các phiếu Đề nghị mua liên kết (GĐ2g). Service role vì cần đọc tồn kho + phiếu đề nghị của người khác.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    if (!actor.isAdmin && !(await isoActorHasPermission(actor, ["maintenance.view"]))) {
      return NextResponse.json({ error: "Bạn không có quyền xem biên bản bảo trì" }, { status: 403 })
    }
    const { id } = await params
    const [status] = await computeKtStatuses(actor.factoryId, id)
    return NextResponse.json({ status: status || null })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
