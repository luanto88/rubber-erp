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
    // Biên bản dùng dòng này: biên bản gắn từ lúc lập + biên bản được phân bổ sau khi duyệt.
    const { data: allocRows } = await supabaseAdmin
      .from("purchase_line_record_allocations").select("maintenance_record_id").eq("line_id", sc.line_id)
    const recordIds = Array.from(new Set([
      (line?.maintenance_record_id as string | null) || null,
      ...((allocRows || []) as { maintenance_record_id: string }[]).map((a) => a.maintenance_record_id),
    ].filter((v): v is string => !!v)))
    if (recordIds.length) {
      const [{ data: recs }, { data: ycs }] = await Promise.all([
        supabaseAdmin.from("maintenance_records").select("id, ma_bb, trang_thai").in("id", recordIds),
        supabaseAdmin.from("yeu_cau_ky").select("ban_ghi_id").eq("factory_id", actor.factoryId).eq("modun", "maintenance")
          .in("ban_ghi_id", recordIds).in("trang_thai", ["dang_luan_chuyen", "hoan_tat"]),
      ])
      const signing = new Set(((ycs || []) as { ban_ghi_id: string }[]).map((y) => y.ban_ghi_id))
      const blocked = ((recs || []) as { id: string; ma_bb: string | null; trang_thai: string | null }[])
        .filter((r) => r.trang_thai === "da_duyet" || signing.has(r.id))
      if (blocked.length) {
        return NextResponse.json(
          { error: `Biên bản ${blocked.map((r) => r.ma_bb || "").join(", ")} đã gửi ký / đã duyệt với dịch vụ này — không huỷ xác nhận được` },
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
