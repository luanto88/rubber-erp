import { NextRequest, NextResponse } from "next/server"
import { isoActorHasPermission, isoAuthErrorStatus, resolveIsoActor } from "@/app/api/iso/_lib/iso-actor"
import { loadEquipmentMaterials, resolveEquipmentToken } from "@/lib/equipment-lookup"
import type { EquipmentMaterialsResponse } from "@/lib/equipment-qr"

// Mirror HANG_MUC_LIST (maintenance-data.ts kéo supabase browser client, không import vào route).
const HANG_MUC_LIST = ["Sửa chữa", "Bảo dưỡng"] as const
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const dynamic = "force-dynamic"

const NOT_FOUND = { error: "Không tìm thấy thiết bị" }
const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }

// GĐ2 — vật tư đã thay của thiết bị mở từ QR. Cùng điều kiện với /history: đăng nhập +
// `maintenance.qr_lookup` + cùng nhà máy; giá chỉ trả cho admin / `maintenance.view_cost` (lọc ở server).
// Query: q, from, to (YYYY-MM-DD), hang_muc, min_count (≥1), sort = count | latest.
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
    const [canSeeCost, canOpenModule] = await Promise.all([
      isoActorHasPermission(actor, ["maintenance.view_cost"]),
      isoActorHasPermission(actor, ["maintenance.view"]),
    ])

    const sp = req.nextUrl.searchParams
    const date = (v: string | null) => (v && ISO_DATE.test(v) ? v : null)
    const hm = sp.get("hang_muc")
    const result = await loadEquipmentMaterials(target, {
      canSeeCost,
      q: (sp.get("q") || "").slice(0, 100),
      from: date(sp.get("from")),
      to: date(sp.get("to")),
      hangMuc: hm && (HANG_MUC_LIST as readonly string[]).includes(hm) ? hm : null,
      minCount: Math.min(100, Math.max(1, Number.parseInt(sp.get("min_count") || "1", 10) || 1)),
      sort: sp.get("sort") === "latest" ? "latest" : "count",
    })
    if (!result) return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE })
    const body: EquipmentMaterialsResponse = { ...result, canSeeCost, canOpenModule }
    return NextResponse.json(body, { headers: NO_STORE })
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    console.error("[equipment/materials]", err)
    const msg = status === 500 ? "Không tải được vật tư của thiết bị" : err instanceof Error ? err.message : "Lỗi"
    return NextResponse.json({ error: msg }, { status, headers: NO_STORE })
  }
}
