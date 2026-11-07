import { NextRequest, NextResponse } from "next/server"
import { isoActorHasPermission, isoAuthErrorStatus, resolveIsoActor } from "@/app/api/iso/_lib/iso-actor"
import { loadEquipmentStats } from "@/lib/equipment-lookup"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GĐ3b — thống kê chu kỳ cho trang Lý lịch (`maintenance.view`). Query: asset_id HOẶC vehicle_id.
// Nhà máy lấy từ phiên; thiết bị/xe khác nhà máy ⇒ 404.
export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    if (!(await isoActorHasPermission(actor, ["maintenance.view"]))) {
      return NextResponse.json({ error: "Bạn chưa có quyền xem bảo trì" }, { status: 403 })
    }
    const sp = req.nextUrl.searchParams
    const assetId = sp.get("asset_id") || ""
    const vehicleId = sp.get("vehicle_id") || ""
    if (!UUID_RE.test(assetId) && !UUID_RE.test(vehicleId)) {
      return NextResponse.json({ error: "Thiếu thiết bị hoặc xe" }, { status: 400 })
    }
    const canSeeCost = await isoActorHasPermission(actor, ["maintenance.view_cost"])
    const result = await loadEquipmentStats(
      UUID_RE.test(vehicleId) ? { factoryId: actor.factoryId, vehicleId } : { factoryId: actor.factoryId, assetId },
      { canSeeCost },
    )
    if (!result) return NextResponse.json({ error: "Không tìm thấy thiết bị" }, { status: 404 })
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    console.error("[equipment/stats lý lịch]", err)
    const msg = status === 500 ? "Không tải được thống kê" : err instanceof Error ? err.message : "Lỗi"
    return NextResponse.json({ error: msg }, { status })
  }
}
