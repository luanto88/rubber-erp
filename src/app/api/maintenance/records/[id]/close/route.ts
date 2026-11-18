import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { closeMaintenanceRecord, listRecordLinkedPurchases, MaintenanceCloseError } from "@/lib/maintenance-record-close"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

// GET — danh sách phiếu đề nghị mua liên quan biên bản (để hộp xác nhận Huỷ / Xoá biên bản hiện
// "Huỷ luôn các phiếu đề nghị này" + cảnh báo phiếu đã duyệt).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const { data: rec } = await getSupabaseAdmin()
      .from("maintenance_records")
      .select("id")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!rec) return NextResponse.json({ error: "Không tìm thấy biên bản" }, { status: 404 })
    const purchases = await listRecordLinkedPurchases(actor, id)
    return NextResponse.json({ purchases })
  } catch (err) {
    const status = err instanceof MaintenanceCloseError ? err.status : isoAuthErrorStatus(err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: status === 500 ? 400 : status })
  }
}

// POST { mode: "cancel" | "delete", lyDo, cancelPurchaseIds? } — Huỷ / Xoá biên bản bảo trì ở server (huỷ kèm
// phiếu đề nghị đã chọn, đóng yêu cầu ký, hoàn tồn phiếu X-BT, gỡ phân bổ đề nghị mua, cập nhật/xoá biên bản).
// Quyền chi tiết: closeMaintenanceRecord + checkPurchaseCancel.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { mode?: string; lyDo?: string; cancelPurchaseIds?: unknown }
    const mode = body.mode === "delete" ? "delete" : body.mode === "cancel" ? "cancel" : null
    if (!mode) return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 })
    if (!actor.isAdmin) {
      const perm = mode === "delete" ? ["maintenance.delete", "maintenance.create"] : ["maintenance.create", "maintenance.edit"]
      if (!(await isoActorHasPermission(actor, perm))) {
        return NextResponse.json({ error: "Không có quyền" }, { status: 403 })
      }
    }
    const cancelPurchaseIds = Array.isArray(body.cancelPurchaseIds)
      ? body.cancelPurchaseIds.filter((v): v is string => typeof v === "string" && v.length > 0)
      : []
    const result = await closeMaintenanceRecord({
      factoryId: actor.factoryId,
      recordId: id,
      actorId: actor.userId,
      isAdmin: actor.isAdmin,
      mode,
      reason: String(body.lyDo || ""),
      cancelPurchaseIds,
      actor,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const status = err instanceof MaintenanceCloseError ? err.status : isoAuthErrorStatus(err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: status === 500 ? 400 : status })
  }
}
