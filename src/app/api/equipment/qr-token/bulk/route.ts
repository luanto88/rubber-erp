import { NextRequest, NextResponse } from "next/server"
import { isoActorHasPermission, isoAuthErrorStatus, resolveIsoActor } from "@/app/api/iso/_lib/iso-actor"
import { getOrCreateAssetTokensBulk } from "@/lib/equipment-lookup"

export const dynamic = "force-dynamic"

const MAX_ASSETS = 500
const UUID_RE = /^[0-9a-f-]{36}$/i

// GĐ3 — lấy/tạo token QR cho nhiều máy móc để in tem hàng loạt (Cài đặt → Bảo trì → Thiết bị).
// Cùng quyền với nút QR từng dòng. Nhà máy lấy từ phiên, không tin client.
export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const allowed = await isoActorHasPermission(actor, [
      "maintenance.view",
      "settings.maintenance_config",
      "settings.manage_config",
    ])
    if (!allowed) return NextResponse.json({ error: "Bạn chưa có quyền in tem QR thiết bị" }, { status: 403 })

    const body = (await req.json().catch(() => ({}))) as { assetIds?: unknown }
    const assetIds = Array.isArray(body.assetIds)
      ? body.assetIds.filter((v): v is string => typeof v === "string" && UUID_RE.test(v))
      : []
    if (assetIds.length === 0) return NextResponse.json({ error: "Chưa chọn thiết bị nào" }, { status: 400 })
    if (assetIds.length > MAX_ASSETS) {
      return NextResponse.json({ error: `Mỗi lần in tối đa ${MAX_ASSETS} thiết bị` }, { status: 400 })
    }

    const labels = await getOrCreateAssetTokensBulk(actor.factoryId, assetIds, actor.userId)
    return NextResponse.json({ labels }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    console.error("[equipment/qr-token/bulk]", err)
    const msg = status === 500 ? "Không lấy được QR thiết bị" : err instanceof Error ? err.message : "Lỗi"
    return NextResponse.json({ error: msg }, { status })
  }
}
