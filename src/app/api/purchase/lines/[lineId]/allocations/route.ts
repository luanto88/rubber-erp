import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { isMaintenanceRecordTeam } from "@/lib/purchase/server"
import { syncMaintenanceExtPricesSafe } from "@/lib/maintenance-ext-price"

export const dynamic = "force-dynamic"

// POST — gắn / đổi / gỡ phân bổ 1 dòng đề nghị ĐÃ DUYỆT (lập riêng, không thuộc biên bản nào) cho 1 biên bản
// bảo trì theo SL. Body { recordId, soLuong } — soLuong = 0 ⇒ gỡ. Mọi kiểm tra nghiệp vụ (trạng thái phiếu /
// biên bản, đúng vật tư + nguồn, vượt SL dòng / nhu cầu biên bản, biên bản đã gửi ký) nằm trong RPC
// purchase_allocate_line. Quyền: admin, người đề nghị của phiếu, hoặc nhóm phụ trách biên bản (người tạo /
// NV phụ trách) có maintenance.create hoặc purchase.create.
export async function POST(req: NextRequest, { params }: { params: Promise<{ lineId: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { lineId } = await params
    const body = (await req.json().catch(() => ({}))) as { recordId?: string; soLuong?: number }
    const recordId = String(body.recordId || "")
    const soLuong = Number(body.soLuong)
    if (!recordId) return NextResponse.json({ error: "Chưa chọn biên bản" }, { status: 400 })
    if (!Number.isFinite(soLuong) || soLuong < 0) return NextResponse.json({ error: "Số lượng không hợp lệ" }, { status: 400 })

    const { data: line } = await supabaseAdmin
      .from("purchase_request_lines")
      .select("id, request_id, purchase_requests!inner(nguoi_de_nghi_id, factory_id)")
      .eq("id", lineId)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!line) return NextResponse.json({ error: "Không tìm thấy dòng đề nghị" }, { status: 404 })
    const reqRow = (Array.isArray(line.purchase_requests) ? line.purchase_requests[0] : line.purchase_requests) as
      | { nguoi_de_nghi_id: string | null }
      | null

    let allowed = actor.isAdmin || reqRow?.nguoi_de_nghi_id === actor.userId
    if (!allowed) {
      allowed =
        (await isMaintenanceRecordTeam(recordId, actor.userId)) &&
        (await isoActorHasPermission(actor, ["maintenance.create", "purchase.create"]))
    }
    if (!allowed) {
      return NextResponse.json(
        { error: "Chỉ người đề nghị của phiếu, người lập / phụ trách biên bản hoặc admin được gắn biên bản" },
        { status: 403 },
      )
    }

    const { data, error } = await supabaseAdmin.rpc("purchase_allocate_line", {
      p_factory_id: actor.factoryId,
      p_line_id: lineId,
      p_record_id: recordId,
      p_qty: soLuong,
      p_actor: actor.userId,
    })
    if (error) {
      const missing = /purchase_allocate_line|purchase_line_record_allocations/.test(error.message) && /exist|find/i.test(error.message)
      return NextResponse.json(
        { error: missing ? "Chưa chạy migration 20261129_purchase_line_record_allocations.sql" : error.message },
        { status: missing ? 500 : 400 },
      )
    }
    await syncMaintenanceExtPricesSafe(actor.factoryId, [recordId])
    return NextResponse.json({ ok: true, result: data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi không xác định" }, { status: isoAuthErrorStatus(err) })
  }
}
