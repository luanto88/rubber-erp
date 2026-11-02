import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { insertPurchaseLog, syncMaintenanceExtPricesForRequest } from "@/lib/purchase/server"
import { formatMoney, formatQty } from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// POST { lyDo } — GĐ4 A5: huỷ 1 lần "Xác nhận hoàn thành" dịch vụ gia công (bấm nhầm / sai SL / sai giá).
// Người đề nghị hoặc admin, lý do bắt buộc. Chặn khi biên bản bảo trì gắn dòng đã duyệt hoặc đang/đã ký
// (biên bản đó đã tính dịch vụ là "đã hoàn thành"). Xoá bản ghi rồi tính lại trạng thái phiếu.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; cid: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id, cid } = await params
    const body = (await req.json().catch(() => ({}))) as { lyDo?: string }
    const lyDo = String(body.lyDo || "").trim()
    if (!lyDo) return NextResponse.json({ error: "Bắt buộc nhập lý do huỷ" }, { status: 400 })

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, nguoi_de_nghi_id, loai, trang_thai, loai_tien")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!request) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })
    if (request.nguoi_de_nghi_id !== actor.userId && !actor.isAdmin) {
      return NextResponse.json({ error: "Chỉ người đề nghị hoặc admin được huỷ xác nhận" }, { status: 403 })
    }
    if (request.trang_thai === "huy") return NextResponse.json({ error: "Phiếu đã huỷ" }, { status: 409 })

    const { data: sc } = await supabaseAdmin
      .from("purchase_service_completions")
      .select("id, line_id, item_name, unit, so_luong, don_gia, ngay")
      .eq("id", cid)
      .eq("request_id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!sc) return NextResponse.json({ error: "Không tìm thấy lần xác nhận này" }, { status: 404 })

    const { data: line } = await supabaseAdmin
      .from("purchase_request_lines")
      .select("maintenance_record_id")
      .eq("id", sc.line_id)
      .maybeSingle()
    const recordId = (line?.maintenance_record_id as string | null) || null
    if (recordId) {
      const [{ data: rec }, { data: yc }] = await Promise.all([
        supabaseAdmin.from("maintenance_records").select("ma_bb, trang_thai").eq("id", recordId).maybeSingle(),
        supabaseAdmin.from("yeu_cau_ky").select("id").eq("factory_id", actor.factoryId).eq("modun", "maintenance")
          .eq("ban_ghi_id", recordId).in("trang_thai", ["dang_luan_chuyen", "hoan_tat"]).limit(1),
      ])
      if (rec?.trang_thai === "da_duyet" || (yc || []).length) {
        return NextResponse.json(
          { error: `Biên bản ${rec?.ma_bb || ""} đã gửi ký / đã duyệt với dịch vụ này — không huỷ xác nhận được` },
          { status: 409 },
        )
      }
    }

    const { error: delErr } = await supabaseAdmin.from("purchase_service_completions").delete().eq("id", cid)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 })
    const { error: rcErr } = await supabaseAdmin.rpc("purchase_recompute_request", { p_request_id: id })
    if (rcErr) console.warn("[purchase] Không tính lại được phiếu sau khi huỷ xác nhận:", rcErr.message)

    const tien = request.loai_tien as string
    await insertPurchaseLog({
      requestId: id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "huy_hoan_thanh_dich_vu",
      noiDung: `${sc.item_name}: ${formatQty(Number(sc.so_luong))} ${sc.unit || ""} × ${formatMoney(Number(sc.don_gia), tien)} ${tien} (ngày ${sc.ngay}). Lý do: ${lyDo}`,
    })
    await syncMaintenanceExtPricesForRequest(actor.factoryId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
