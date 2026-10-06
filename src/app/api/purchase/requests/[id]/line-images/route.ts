import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { insertPurchaseLog } from "@/lib/purchase/server"
import { PURCHASE_MAX_IMAGES, sanitizeImageUrls } from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// POST — Cập nhật ảnh đính kèm của 1 dòng vật tư. Được làm cả SAU KHI ký/duyệt vì ảnh không in
// lên PDF (không chạm chữ ký số). Chỉ người đề nghị hoặc admin, phiếu chưa huỷ.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const body = (await req.json()) as { lineId?: string; imageUrls?: unknown }
    const lineId = String(body.lineId || "")
    if (!lineId) return NextResponse.json({ error: "Thiếu dòng vật tư" }, { status: 400 })
    if (Array.isArray(body.imageUrls) && body.imageUrls.length > PURCHASE_MAX_IMAGES) {
      return NextResponse.json({ error: `Tối đa ${PURCHASE_MAX_IMAGES} ảnh mỗi dòng` }, { status: 400 })
    }
    const imageUrls = sanitizeImageUrls(body.imageUrls)

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, nguoi_de_nghi_id, trang_thai")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!request) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })
    if (request.nguoi_de_nghi_id !== actor.userId && !actor.isAdmin) {
      return NextResponse.json({ error: "Chỉ người đề nghị hoặc admin được cập nhật ảnh" }, { status: 403 })
    }
    if (request.trang_thai === "huy") {
      return NextResponse.json({ error: "Phiếu đã huỷ, không cập nhật ảnh được" }, { status: 409 })
    }

    const { data: line } = await supabaseAdmin
      .from("purchase_request_lines")
      .select("id, sort_order, item_name, image_urls")
      .eq("id", lineId)
      .eq("request_id", id)
      .maybeSingle()
    if (!line) return NextResponse.json({ error: "Dòng vật tư không thuộc phiếu này" }, { status: 404 })

    const { error } = await supabaseAdmin.from("purchase_request_lines").update({ image_urls: imageUrls }).eq("id", lineId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const before = ((line.image_urls as string[] | null) || []).length
    await insertPurchaseLog({
      requestId: id,
      factoryId: actor.factoryId,
      userId: actor.userId,
      hanhDong: "cap_nhat_anh",
      noiDung: `Dòng ${Number(line.sort_order) + 1} (${line.item_name}): ${before} → ${imageUrls.length} ảnh`,
    })
    return NextResponse.json({ ok: true, imageUrls })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
