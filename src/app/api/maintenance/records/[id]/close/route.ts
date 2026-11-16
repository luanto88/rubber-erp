import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { closeMaintenanceRecord, MaintenanceCloseError } from "@/lib/maintenance-record-close"

export const dynamic = "force-dynamic"

// POST { mode: "cancel" | "delete", lyDo } — Huỷ / Xoá biên bản bảo trì ở server (đóng yêu cầu ký, hoàn tồn
// phiếu X-BT, gỡ phân bổ đề nghị mua, cập nhật/xoá biên bản). Quyền chi tiết: closeMaintenanceRecord.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { mode?: string; lyDo?: string }
    const mode = body.mode === "delete" ? "delete" : body.mode === "cancel" ? "cancel" : null
    if (!mode) return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 })
    if (!actor.isAdmin) {
      const perm = mode === "delete" ? ["maintenance.delete", "maintenance.create"] : ["maintenance.create", "maintenance.edit"]
      if (!(await isoActorHasPermission(actor, perm))) {
        return NextResponse.json({ error: "Không có quyền" }, { status: 403 })
      }
    }
    const result = await closeMaintenanceRecord({
      factoryId: actor.factoryId,
      recordId: id,
      actorId: actor.userId,
      isAdmin: actor.isAdmin,
      mode,
      reason: String(body.lyDo || ""),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const status = err instanceof MaintenanceCloseError ? err.status : isoAuthErrorStatus(err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: status === 500 ? 400 : status })
  }
}
