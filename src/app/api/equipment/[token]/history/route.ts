import { NextRequest, NextResponse } from "next/server"
import { isoActorHasPermission, isoAuthErrorStatus, resolveIsoActor } from "@/app/api/iso/_lib/iso-actor"
import { loadEquipmentHistory, loadEquipmentViewer, resolveEquipmentToken } from "@/lib/equipment-lookup"
import type { EquipmentHistoryResponse } from "@/lib/equipment-qr"

// Mirror HANG_MUC_LIST (maintenance-data.ts — file đó kéo supabase browser client, không import vào route).
const HANG_MUC_LIST = ["Sửa chữa", "Bảo dưỡng"] as const

export const dynamic = "force-dynamic"

const NOT_FOUND = { error: "Không tìm thấy thiết bị" }
const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }

// Lịch sử sửa chữa/bảo dưỡng của thiết bị mở từ QR — BẮT BUỘC đăng nhập + `maintenance.qr_lookup`
// (quyền riêng, migration 20261112) + cùng nhà máy với thiết bị. Giá/chi phí chỉ trả cho admin /
// `maintenance.view_cost` (migration 20261113) (lọc ở server). `canOpenModule` = `maintenance.view` (mở trang Lý lịch / biên bản).
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const actor = await resolveIsoActor(req)
    // Thông tin người xem (góc phải trang) trả kèm MỌI phản hồi sau khi đã đăng nhập, kể cả 403/404.
    const viewer = await loadEquipmentViewer(actor.userId).catch(() => null)
    if (!(await isoActorHasPermission(actor, ["maintenance.qr_lookup"]))) {
      return NextResponse.json(
        { error: "Bạn chưa được cấp quyền tra cứu lý lịch thiết bị bằng QR. Liên hệ quản trị viên.", viewer },
        { status: 403, headers: NO_STORE },
      )
    }
    const target = await resolveEquipmentToken(token)
    // Khác nhà máy ⇒ trả 404 giống token sai, không xác nhận thiết bị tồn tại.
    if (!target || target.factoryId !== actor.factoryId) {
      return NextResponse.json({ ...NOT_FOUND, viewer }, { status: 404, headers: NO_STORE })
    }
    const [canSeeCost, canOpenModule, canCreate] = await Promise.all([
      isoActorHasPermission(actor, ["maintenance.view_cost"]),
      isoActorHasPermission(actor, ["maintenance.view"]),
      isoActorHasPermission(actor, ["maintenance.create"]),
    ])

    const sp = req.nextUrl.searchParams
    const offset = Math.max(0, Number.parseInt(sp.get("offset") || "0", 10) || 0)
    const limit = Math.min(50, Math.max(1, Number.parseInt(sp.get("limit") || "20", 10) || 20))
    const hm = sp.get("hang_muc")
    const hangMuc = hm && (HANG_MUC_LIST as readonly string[]).includes(hm) ? hm : null

    const result = await loadEquipmentHistory(target, { canSeeCost, offset, limit, hangMuc })
    if (!result) return NextResponse.json({ ...NOT_FOUND, viewer }, { status: 404, headers: NO_STORE })
    // Trang biên bản cần maintenance.view để mở; form chỉ chọn được thiết bị đang dùng ⇒ ẩn khi "Ngừng dùng".
    const createRecordHref =
      canCreate && canOpenModule && !result.inactive
        ? `/dashboard/maintenance/records/new?asset_id=${encodeURIComponent(target.assetId)}`
        : null
    const body: EquipmentHistoryResponse = { ...result, canSeeCost, canOpenModule, createRecordHref, viewer }
    return NextResponse.json(body, { headers: NO_STORE })
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    console.error("[equipment/history]", err)
    const msg = status === 500 ? "Không tải được lịch sử thiết bị" : err instanceof Error ? err.message : "Lỗi"
    return NextResponse.json({ error: msg }, { status, headers: NO_STORE })
  }
}
