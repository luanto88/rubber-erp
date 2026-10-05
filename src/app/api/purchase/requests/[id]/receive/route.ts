import { NextRequest, NextResponse } from "next/server"
import { findKtWarehouse, KT_WAREHOUSE_CODE } from "@/lib/maintenance-kt"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { scheduleModuleBroadcast } from "@/lib/signing/notify"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { insertPurchaseLog } from "@/lib/purchase/server"
import { formatMoney, formatSoPhieuFull, PURCHASE_STATUS_LABEL, type PurchaseStatus } from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// POST — Ghi nhận mua thực tế + nhập kho cho phiếu ĐÃ DUYỆT / ĐANG MUA.
// Toàn bộ kiểm tra (vượt SL duyệt, lệch giá > 10%, đổi mã, số lô) và việc tạo + ghi sổ phiếu nhập
// kho chạy trong MỘT giao dịch ở RPC purchase_receive — không kiểm ở đây để khỏi lệch 2 nơi.
// Quyền: CHỈ người đề nghị hoặc admin (GĐ2f — không còn cho người có inventory.create).

type Body = {
  warehouseId: string
  ngay?: string | null
  nhaCungCap?: string | null
  ghiChu?: string | null
  imageUrls?: string[]
  lines: { lineId: string; soLuong: number; donGia: number; lotNo?: string | null; expiryDate?: string | null; ghiChu?: string | null }[]
}

const MAX_IMAGES = 10

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const body = (await req.json()) as Body

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, so, nam, nguoi_de_nghi_id, giam_doc_user_id, ke_toan_user_id, loai_tien, maintenance_record_id")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!request) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })

    const isOwner = request.nguoi_de_nghi_id === actor.userId
    if (!isOwner && !actor.isAdmin) {
      return NextResponse.json({ error: "Chỉ người đề nghị hoặc admin được ghi nhận mua" }, { status: 403 })
    }

    // GĐ2g: phiếu lập từ biên bản bảo trì nhập cứng vào Kho tạm KT.
    if (request.maintenance_record_id) {
      const kt = await findKtWarehouse(actor.factoryId)
      if (!kt) return NextResponse.json({ error: `Chưa có kho tạm mã ${KT_WAREHOUSE_CODE}` }, { status: 400 })
      if (body.warehouseId !== kt.id) {
        return NextResponse.json({ error: `Phiếu lập từ biên bản bảo trì phải nhập vào kho tạm ${KT_WAREHOUSE_CODE}` }, { status: 400 })
      }
    }

    const ngay = /^\d{4}-\d{2}-\d{2}$/.test(String(body.ngay || "")) ? String(body.ngay) : getFactoryTodayISO()
    if (ngay > getFactoryTodayISO()) return NextResponse.json({ error: "Ngày nhập không được sau hôm nay" }, { status: 400 })
    const imageUrls = (Array.isArray(body.imageUrls) ? body.imageUrls : [])
      .filter((u) => typeof u === "string" && /^https?:\/\//.test(u))
      .slice(0, MAX_IMAGES)
    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => ({
      line_id: l.lineId,
      quantity: Number(l.soLuong),
      don_gia: Number(l.donGia),
      lot_no: l.lotNo?.trim() || null,
      expiry_date: /^\d{4}-\d{2}-\d{2}$/.test(String(l.expiryDate || "")) ? l.expiryDate : null,
      note: l.ghiChu?.trim() || null,
    }))
    if (!lines.length) return NextResponse.json({ error: "Chưa chọn dòng vật tư nào để nhập" }, { status: 400 })
    if (lines.some((l) => !Number.isFinite(l.quantity) || !Number.isFinite(l.don_gia))) {
      return NextResponse.json({ error: "Số lượng / đơn giá không hợp lệ" }, { status: 400 })
    }

    const { data: me } = await supabaseAdmin.from("profiles").select("full_name, username").eq("id", actor.userId).single()
    const actorName = (me?.full_name || me?.username || "") as string

    const { data, error } = await supabaseAdmin.rpc("purchase_receive", {
      p_factory_id: actor.factoryId,
      p_request_id: id,
      p_actor_id: actor.userId,
      p_actor_name: actorName,
      p_warehouse_id: body.warehouseId,
      p_document_date: ngay,
      p_source_name: body.nhaCungCap?.trim() || null,
      p_note: body.ghiChu?.trim() || null,
      p_image_urls: imageUrls,
      p_lines: lines,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const row = (Array.isArray(data) ? data[0] : data) as { out_document_id: string; out_document_code: string; out_status: PurchaseStatus } | null
    if (!row) return NextResponse.json({ error: "Không ghi nhận được" }, { status: 400 })

    const total = lines.reduce((s, l) => s + l.quantity * l.don_gia, 0)
    await insertPurchaseLog({
      requestId: id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "nhap_kho",
      noiDung: `Phiếu nhập ${row.out_document_code} — ${lines.length} dòng, ${formatMoney(total, request.loai_tien)} ${request.loai_tien}`,
    })

    scheduleModuleBroadcast({
      modun: "purchase",
      factoryId: actor.factoryId,
      title: row.out_status === "hoan_tat" ? "Đã mua đủ — phiếu đề nghị hoàn tất" : "Đã ghi nhận mua / nhập kho",
      docLabel: `Phiếu đề nghị mua VTHH ${formatSoPhieuFull(request.so, request.nam)}`,
      actorUserId: actor.userId,
      recipientUserIds: [request.nguoi_de_nghi_id, request.ke_toan_user_id].filter(Boolean) as string[],
      lines: [
        `Phiếu nhập kho: ${row.out_document_code}`,
        `Giá trị đợt này: ${formatMoney(total, request.loai_tien)} ${request.loai_tien}`,
        `Trạng thái phiếu: ${PURCHASE_STATUS_LABEL[row.out_status] || row.out_status}`,
      ],
      link: `/dashboard/purchase/${id}`,
      notifType: "purchase_nhap_kho",
      docId: id,
      docType: "purchase_request",
    })

    return NextResponse.json({ documentId: row.out_document_id, documentCode: row.out_document_code, status: row.out_status })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
