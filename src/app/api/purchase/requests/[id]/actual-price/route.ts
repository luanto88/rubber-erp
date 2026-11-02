import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { insertPurchaseLog, syncMaintenanceExtPricesForRequest } from "@/lib/purchase/server"
import { formatMoney } from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// POST — GĐ4 A5: sửa GIÁ THỰC TẾ của 1 dòng phiếu nhập kho (kind = "receipt", targetId = id dòng
// inventory_document_lines) hoặc 1 lần xác nhận gia công (kind = "service", targetId = id
// purchase_service_completions). Lệch ≤ 10% so với giá duyệt hiệu lực (kiểm trong RPC
// purchase_update_actual_price); lệch hơn ⇒ lập phiếu điều chỉnh giá. Không đổi SL / tồn kho.
// Quyền: người đề nghị hoặc admin. Biên bản gắn dòng (chưa gửi ký) tự đồng bộ giá.

type Body = { kind: "receipt" | "service"; targetId: string; donGia: number; lyDo: string }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const body = (await req.json()) as Body
    const lyDo = String(body.lyDo || "").trim()
    const donGia = Number(body.donGia)
    if (body.kind !== "receipt" && body.kind !== "service") return NextResponse.json({ error: "Loại không hợp lệ" }, { status: 400 })
    if (!body.targetId) return NextResponse.json({ error: "Thiếu dòng cần sửa giá" }, { status: 400 })
    if (!lyDo) return NextResponse.json({ error: "Bắt buộc nhập lý do sửa giá" }, { status: 400 })
    if (!(donGia > 0)) return NextResponse.json({ error: "Đơn giá mới phải lớn hơn 0" }, { status: 400 })

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, nguoi_de_nghi_id, loai_tien")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!request) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })
    if (request.nguoi_de_nghi_id !== actor.userId && !actor.isAdmin) {
      return NextResponse.json({ error: "Chỉ người đề nghị hoặc admin được sửa giá" }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin.rpc("purchase_update_actual_price", {
      p_factory_id: actor.factoryId,
      p_request_id: id,
      p_kind: body.kind,
      p_target_id: body.targetId,
      p_new_price: donGia,
      p_check_limit: true,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const row = (Array.isArray(data) ? data[0] : data) as { out_old_price: number | null; out_item_name: string; out_label: string } | null
    if (!row) return NextResponse.json({ error: "Không sửa được giá" }, { status: 400 })

    const tien = request.loai_tien as string
    const noi = body.kind === "receipt" ? `phiếu nhập ${row.out_label}` : `xác nhận gia công ngày ${row.out_label}`
    await insertPurchaseLog({
      requestId: id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "sua_gia",
      noiDung: `${row.out_item_name} (${noi}): ${formatMoney(Number(row.out_old_price) || 0, tien)} → ${formatMoney(donGia, tien)} ${tien}. Lý do: ${lyDo}`,
    })
    await syncMaintenanceExtPricesForRequest(actor.factoryId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
