import { NextRequest, NextResponse } from "next/server"
import { isoActorHasPermission, isoAuthErrorStatus, resolveIsoActor } from "@/app/api/iso/_lib/iso-actor"
import { resolveEquipmentToken } from "@/lib/equipment-lookup"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

// GĐ3 — tra token tem QR thiết bị → thiết bị, để ô tìm trang Lý lịch / Biên bản lọc đúng thiết bị.
// Cần maintenance.view; token sai / thu hồi / khác nhà máy ⇒ cùng 404 trung tính.
export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const allowed = await isoActorHasPermission(actor, ["maintenance.view"])
    if (!allowed) return NextResponse.json({ error: "Bạn chưa có quyền xem bảo trì" }, { status: 403 })

    const token = req.nextUrl.searchParams.get("token") || ""
    const target = await resolveEquipmentToken(token)
    const notFound = NextResponse.json(
      { error: "Tem không hợp lệ, đã bị thay hoặc không thuộc nhà máy hiện tại" },
      { status: 404 },
    )
    if (!target || target.factoryId !== actor.factoryId) return notFound

    const { data, error } = await getSupabaseAdmin()
      .from("maintenance_assets")
      .select("id, ma_tb, ten_tb, bo_phan")
      .eq("id", target.assetId)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return notFound

    return NextResponse.json(
      { assetId: data.id, ma_tb: data.ma_tb, ten_tb: data.ten_tb, bo_phan: data.bo_phan },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    console.error("[equipment/resolve]", err)
    const msg = status === 500 ? "Không tra được tem QR" : err instanceof Error ? err.message : "Lỗi"
    return NextResponse.json({ error: msg }, { status })
  }
}
