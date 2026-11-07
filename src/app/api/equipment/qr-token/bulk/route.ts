import { NextRequest, NextResponse } from "next/server"
import { isoActorHasPermission, isoAuthErrorStatus, resolveIsoActor } from "@/app/api/iso/_lib/iso-actor"
import { getOrCreateEquipmentTokensBulk } from "@/lib/equipment-lookup"
import { parseEquipmentRefList } from "../_lib/parse-ref"

export const dynamic = "force-dynamic"

const MAX_ITEMS = 500

// GĐ3/GĐ4a — lấy/tạo token QR cho nhiều máy móc (`assetIds`) HOẶC nhiều xe (`vehicleIds`) để in tem
// hàng loạt. Cùng quyền với nút QR từng dòng. Nhà máy lấy từ phiên, không tin client.
export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const allowed = await isoActorHasPermission(actor, [
      "maintenance.view",
      "settings.maintenance_config",
      "settings.manage_config",
    ])
    if (!allowed) return NextResponse.json({ error: "Bạn chưa có quyền in tem QR thiết bị" }, { status: 403 })

    const { kind, ids } = parseEquipmentRefList(await req.json().catch(() => ({})))
    if (ids.length === 0) return NextResponse.json({ error: "Chưa chọn thiết bị nào" }, { status: 400 })
    if (ids.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Mỗi lần in tối đa ${MAX_ITEMS} thiết bị` }, { status: 400 })
    }

    const labels = await getOrCreateEquipmentTokensBulk(actor.factoryId, kind, ids, actor.userId)
    return NextResponse.json({ labels }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    console.error("[equipment/qr-token/bulk]", err)
    const msg = status === 500 ? "Không lấy được QR thiết bị" : err instanceof Error ? err.message : "Lỗi"
    return NextResponse.json({ error: msg }, { status })
  }
}
