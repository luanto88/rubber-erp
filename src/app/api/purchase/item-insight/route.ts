import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { loadPurchaseItemInsight } from "@/lib/purchase/server"

export const dynamic = "force-dynamic"

// GET ?itemId=&categoryId=&excludeRequestId=
// Thông tin hỗ trợ khi chọn 1 vật tư trong phiếu đề nghị mua: tồn theo kho, 5 lần đề nghị đã
// duyệt gần nhất, nhập/xuất gần nhất, tiêu hao 90 ngày, giá mẫu cùng nhóm, phiếu khác còn mở.
// Logic nằm ở loadPurchaseItemInsight (src/lib/purchase/server.ts) — dùng chung với bước chụp
// số liệu lúc gửi ký. Chỉ categoryId (vật tư mới) → chỉ trả giá mẫu cùng nhóm.

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const sp = req.nextUrl.searchParams
    const result = await loadPurchaseItemInsight(actor.factoryId, {
      itemId: sp.get("itemId"),
      categoryId: sp.get("categoryId"),
      excludeRequestId: sp.get("excludeRequestId"),
    })
    if (!result) return NextResponse.json({ error: "Không tìm thấy vật tư" }, { status: 404 })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
