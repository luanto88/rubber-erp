import { NextRequest, NextResponse } from "next/server"
import { isoActorHasPermission, isoAuthErrorStatus, resolveIsoActor } from "@/app/api/iso/_lib/iso-actor"
import { getOrCreateAssetToken } from "@/lib/equipment-lookup"

export const dynamic = "force-dynamic"

// Lấy (hoặc tạo nếu chưa có) token QR còn hiệu lực của 1 máy móc — dùng cho nút "QR" ở
// Cài đặt → Bảo trì → Thiết bị. Nhà máy lấy từ phiên, không tin client.
export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const allowed = await isoActorHasPermission(actor, [
      "maintenance.view",
      "settings.maintenance_config",
      "settings.manage_config",
    ])
    if (!allowed) return NextResponse.json({ error: "Bạn chưa có quyền xem QR thiết bị" }, { status: 403 })

    const body = (await req.json().catch(() => ({}))) as { assetId?: unknown }
    const assetId = typeof body.assetId === "string" ? body.assetId : ""
    if (!/^[0-9a-f-]{36}$/i.test(assetId)) {
      return NextResponse.json({ error: "Thiếu mã thiết bị" }, { status: 400 })
    }
    const token = await getOrCreateAssetToken(actor.factoryId, assetId, actor.userId)
    if (!token) return NextResponse.json({ error: "Không tìm thấy thiết bị" }, { status: 404 })
    return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    console.error("[equipment/qr-token]", err)
    const msg = status === 500 ? "Không lấy được QR thiết bị (đã chạy migration 20261111 chưa?)" : err instanceof Error ? err.message : "Lỗi"
    return NextResponse.json({ error: msg }, { status })
  }
}
