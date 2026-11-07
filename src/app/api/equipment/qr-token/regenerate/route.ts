import { NextRequest, NextResponse } from "next/server"
import { isoActorHasPermission, isoAuthErrorStatus, resolveIsoActor } from "@/app/api/iso/_lib/iso-actor"
import { regenerateEquipmentToken } from "@/lib/equipment-lookup"
import { parseEquipmentRef } from "../_lib/parse-ref"

export const dynamic = "force-dynamic"

// GĐ3 — "Tạo lại QR": thu hồi token cũ (tem đã dán chết ngay) + tạo token mới.
// Chỉ admin / settings.maintenance_config (admin luôn qua trong isoActorHasPermission).
export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const allowed = await isoActorHasPermission(actor, ["settings.maintenance_config"])
    if (!allowed) return NextResponse.json({ error: "Chỉ quản trị viên cấu hình bảo trì được tạo lại QR" }, { status: 403 })

    const ref = parseEquipmentRef(await req.json().catch(() => ({})))
    if (!ref) return NextResponse.json({ error: "Thiếu mã thiết bị hoặc xe" }, { status: 400 })
    const token = await regenerateEquipmentToken(actor.factoryId, ref.kind, ref.id, actor.userId)
    if (!token) return NextResponse.json({ error: "Không tìm thấy thiết bị" }, { status: 404 })
    return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    console.error("[equipment/qr-token/regenerate]", err)
    const msg = status === 500 ? "Không tạo lại được QR, tem cũ vẫn giữ nguyên" : err instanceof Error ? err.message : "Lỗi"
    return NextResponse.json({ error: msg }, { status })
  }
}
