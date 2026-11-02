import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { resolveExtPrices, syncMaintenanceExtPrices } from "@/lib/maintenance-ext-price"

export const dynamic = "force-dynamic"

// POST { recordId?, itemIds?, sync? } — giá vật tư mua ngoài / gia công cho trang biên bản bảo trì (GĐ4).
//  - Trả `prices` { itemId → giá đã xác định } (đề nghị gắn biên bản → lần mua gần nhất → danh mục).
//    Vật tư không có trong `prices` = chưa có giá ⇒ nhập tay.
//  - `sync: true` + `recordId`: đồng bộ giá vào biên bản (chỉ khi Chờ duyệt + chưa gửi ký) TRƯỚC khi trả,
//    `changes` = các dòng vừa đổi giá. Gọi khi mở biên bản và ngay trước khi dựng PDF gửi ký.
export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const factoryId = actor.factoryId
    if (!(await isoActorHasPermission(actor, ["maintenance.view"]))) {
      return NextResponse.json({ error: "Không có quyền xem biên bản bảo trì" }, { status: 403 })
    }
    const body = (await req.json().catch(() => ({}))) as { recordId?: string | null; itemIds?: string[]; sync?: boolean }
    const recordId = body.recordId || null
    let itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((v) => typeof v === "string" && v) : []

    if (recordId) {
      const { data: rec } = await supabaseAdmin
        .from("maintenance_records")
        .select("id")
        .eq("id", recordId)
        .eq("factory_id", factoryId)
        .maybeSingle()
      if (!rec) return NextResponse.json({ error: "Không tìm thấy biên bản" }, { status: 404 })
    }

    const changes = recordId && body.sync ? await syncMaintenanceExtPrices(factoryId, [recordId]) : []

    if (recordId) {
      const { data: mats } = await supabaseAdmin
        .from("maintenance_materials")
        .select("inventory_item_id")
        .eq("record_id", recordId)
        .in("nguon", ["ben_ngoai", "gia_cong"])
      for (const m of (mats || []) as { inventory_item_id: string | null }[]) if (m.inventory_item_id) itemIds.push(m.inventory_item_id)
    }
    itemIds = Array.from(new Set(itemIds)).slice(0, 500)

    const prices = await resolveExtPrices(factoryId, recordId, itemIds)
    return NextResponse.json({ prices: Object.fromEntries(prices), changes })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
