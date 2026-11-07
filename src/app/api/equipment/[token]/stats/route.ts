import { NextRequest, NextResponse } from "next/server"
import { isoActorHasPermission, isoAuthErrorStatus, resolveIsoActor } from "@/app/api/iso/_lib/iso-actor"
import { loadEquipmentStats, resolveEquipmentToken } from "@/lib/equipment-lookup"

export const dynamic = "force-dynamic"

const NOT_FOUND = { error: "Không tìm thấy thiết bị" }
const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }

// GĐ3b — thống kê chu kỳ sửa chữa / bảo dưỡng + sản lượng giữa 2 lần sửa của thiết bị mở từ QR.
// Cùng điều kiện /history: đăng nhập + `maintenance.qr_lookup` + cùng nhà máy (người dùng chốt 2026-11-07).
// Chi phí chỉ trả khi admin / `maintenance.view_cost`.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const actor = await resolveIsoActor(req)
    if (!(await isoActorHasPermission(actor, ["maintenance.qr_lookup"]))) {
      return NextResponse.json(
        { error: "Bạn chưa được cấp quyền tra cứu lý lịch thiết bị bằng QR. Liên hệ quản trị viên." },
        { status: 403, headers: NO_STORE },
      )
    }
    const target = await resolveEquipmentToken(token)
    if (!target || target.factoryId !== actor.factoryId) {
      return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE })
    }
    const canSeeCost = await isoActorHasPermission(actor, ["maintenance.view_cost"])
    const result = await loadEquipmentStats({ factoryId: target.factoryId, assetId: target.assetId }, { canSeeCost })
    if (!result) return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE })
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    console.error("[equipment/stats]", err)
    const msg = status === 500 ? "Không tải được thống kê của thiết bị" : err instanceof Error ? err.message : "Lỗi"
    return NextResponse.json({ error: msg }, { status, headers: NO_STORE })
  }
}
