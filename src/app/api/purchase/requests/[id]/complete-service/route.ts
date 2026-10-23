import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { scheduleModuleBroadcast } from "@/lib/signing/notify"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { insertPurchaseLog } from "@/lib/purchase/server"
import { formatMoney, formatSoPhieuFull, PURCHASE_STATUS_LABEL, type PurchaseStatus } from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// POST — "Xác nhận hoàn thành" dịch vụ gia công ngoài (thay cho nhập kho — dịch vụ không có tồn).
// Kiểm tra (đúng dịch vụ, vượt SL duyệt, lệch giá > 10%, đang điều chỉnh) chạy trong RPC
// purchase_complete_service — không kiểm lặp ở đây.
// Quyền: CHỈ người đề nghị hoặc admin (giống "Ghi nhận mua").

type Body = {
  ngay?: string | null
  nhaCungCap?: string | null
  ghiChu?: string | null
  imageUrls?: string[]
  lines: { lineId: string; soLuong: number; donGia: number; ghiChu?: string | null }[]
}

const MAX_IMAGES = 10

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const body = (await req.json()) as Body

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, so, nam, nguoi_de_nghi_id, ke_toan_user_id, loai_tien")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!request) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })
    if (request.nguoi_de_nghi_id !== actor.userId && !actor.isAdmin) {
      return NextResponse.json({ error: "Chỉ người đề nghị hoặc admin được xác nhận hoàn thành" }, { status: 403 })
    }

    const today = getFactoryTodayISO()
    const ngay = /^\d{4}-\d{2}-\d{2}$/.test(String(body.ngay || "")) ? String(body.ngay) : today
    if (ngay > today) return NextResponse.json({ error: "Ngày hoàn thành không được sau hôm nay" }, { status: 400 })
    const imageUrls = (Array.isArray(body.imageUrls) ? body.imageUrls : [])
      .filter((u) => typeof u === "string" && /^https?:\/\//.test(u))
      .slice(0, MAX_IMAGES)
    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => ({
      line_id: l.lineId,
      quantity: Number(l.soLuong),
      don_gia: Number(l.donGia),
      note: l.ghiChu?.trim() || null,
    }))
    if (!lines.length) return NextResponse.json({ error: "Chưa chọn dòng dịch vụ nào" }, { status: 400 })
    if (lines.some((l) => !Number.isFinite(l.quantity) || !Number.isFinite(l.don_gia))) {
      return NextResponse.json({ error: "Số lượng / đơn giá không hợp lệ" }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin.rpc("purchase_complete_service", {
      p_factory_id: actor.factoryId,
      p_request_id: id,
      p_actor_id: actor.userId,
      p_ngay: ngay,
      p_source_name: body.nhaCungCap?.trim() || null,
      p_note: body.ghiChu?.trim() || null,
      p_image_urls: imageUrls,
      p_lines: lines,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const row = (Array.isArray(data) ? data[0] : data) as { out_count: number; out_total: number; out_status: PurchaseStatus } | null
    if (!row) return NextResponse.json({ error: "Không xác nhận được" }, { status: 400 })

    const total = Number(row.out_total) || 0
    await insertPurchaseLog({
      requestId: id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "hoan_thanh_dich_vu",
      noiDung: `Xác nhận hoàn thành ${row.out_count} dịch vụ — ${formatMoney(total, request.loai_tien)} ${request.loai_tien}`,
    })

    scheduleModuleBroadcast({
      modun: "purchase",
      factoryId: actor.factoryId,
      title: row.out_status === "hoan_tat" ? "Đã hoàn tất — phiếu đề nghị hoàn tất" : "Đã xác nhận hoàn thành dịch vụ gia công",
      docLabel: `Phiếu đề nghị mua VTHH ${formatSoPhieuFull(request.so, request.nam)}`,
      actorUserId: actor.userId,
      recipientUserIds: [request.nguoi_de_nghi_id, request.ke_toan_user_id].filter(Boolean) as string[],
      lines: [
        `Số dịch vụ: ${row.out_count}`,
        `Giá trị đợt này: ${formatMoney(total, request.loai_tien)} ${request.loai_tien}`,
        `Trạng thái phiếu: ${PURCHASE_STATUS_LABEL[row.out_status] || row.out_status}`,
      ],
      link: `/dashboard/purchase/${id}`,
      notifType: "purchase_hoan_thanh_dich_vu",
      docId: id,
      docType: "purchase_request",
    })

    return NextResponse.json({ count: row.out_count, total, status: row.out_status })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
