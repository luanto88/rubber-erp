import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { findPendingAdjustment, insertPurchaseLog, loadEffectiveLines } from "@/lib/purchase/server"
import {
  formatSoPhieuFull, isPriceDeviationExceeded, isPurchaseBuying, minIsoDate, priceDeviationPct, type PurchaseStatus,
} from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// POST — Lập PHIẾU ĐIỀU CHỈNH cho phiếu gốc đã duyệt (đổi mã vật tư / đơn giá lệch > 10% / giảm SL).
// Phiếu gốc KHÔNG bao giờ bị sửa: phiếu điều chỉnh là 1 phiếu mới (số mới, loai = 'dieu_chinh'),
// mỗi dòng trỏ dòng gốc qua parent_line_id và chụp lại thông số "trước điều chỉnh". Ký lại đủ 3 bước
// (gửi ký bằng route submit chung); duyệt xong mới được nhập kho theo thông số mới.
// Không cho TĂNG số lượng — mua thêm phải lập phiếu đề nghị mới.

type Body = {
  lyDo: string
  lines: { parentLineId: string; itemId: string; soLuong: number; donGia: number; ghiChu?: string | null }[]
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const body = (await req.json()) as Body
    const lyDo = String(body.lyDo || "").trim()
    if (!lyDo) return NextResponse.json({ error: "Bắt buộc nhập lý do điều chỉnh" }, { status: 400 })
    if (!(await isoActorHasPermission(actor, ["purchase.create"]))) {
      return NextResponse.json({ error: "Bạn không có quyền lập đề nghị mua vật tư" }, { status: 403 })
    }

    const { data: parent } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, factory_id, so, nam, loai, nguoi_de_nghi_id, nguoi_de_nghi_ten, giam_doc_user_id, ke_toan_user_id, trang_thai, loai_tien, bo_phan")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!parent) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })
    if (parent.loai !== "goc") return NextResponse.json({ error: "Chỉ điều chỉnh được phiếu đề nghị gốc" }, { status: 400 })
    if (parent.nguoi_de_nghi_id !== actor.userId) {
      return NextResponse.json({ error: "Chỉ người đề nghị được lập phiếu điều chỉnh" }, { status: 403 })
    }
    if (!isPurchaseBuying(parent.trang_thai as PurchaseStatus)) {
      return NextResponse.json({ error: "Chỉ điều chỉnh được phiếu đã duyệt / đang mua" }, { status: 409 })
    }
    const pending = await findPendingAdjustment(id)
    if (pending) {
      return NextResponse.json({ error: `Đang có phiếu điều chỉnh ${formatSoPhieuFull(pending.so, pending.nam)} chưa duyệt — xử lý xong phiếu đó trước` }, { status: 409 })
    }

    const input = Array.isArray(body.lines) ? body.lines : []
    if (!input.length) return NextResponse.json({ error: "Chọn ít nhất 1 dòng cần điều chỉnh" }, { status: 400 })

    const effective = await loadEffectiveLines(id)
    const effById = new Map(effective.map((e) => [e.root_line_id, e]))
    // Mục đích + ảnh lấy từ dòng GỐC (parent_line_id = root_line_id) — điều chỉnh không có mục đích riêng.
    const { data: rootLines } = await supabaseAdmin
      .from("purchase_request_lines")
      .select("id, muc_dich, image_urls, mua_tai, ngay_co_hang, ngay_can_hang")
      .eq("request_id", id)
    type RootLine = {
      id: string; muc_dich: string | null; image_urls: string[] | null
      mua_tai: string | null; ngay_co_hang: string | null; ngay_can_hang: string | null
    }
    const rootById = new Map(((rootLines || []) as RootLine[]).map((r) => [r.id, r]))
    const itemIds = [...new Set(input.map((l) => l.itemId).filter(Boolean))]
    const { data: itemRows } = await supabaseAdmin
      .from("inventory_items").select("id, code, name, unit").eq("factory_id", actor.factoryId).in("id", itemIds.length ? itemIds : ["00000000-0000-0000-0000-000000000000"])
    const itemById = new Map(((itemRows || []) as { id: string; code: string; name: string; unit: string | null }[]).map((i) => [i.id, i]))

    const errors: string[] = []
    const seen = new Set<string>()
    const rows = input.map((l, i) => {
      const n = i + 1
      const eff = effById.get(l.parentLineId)
      const item = itemById.get(l.itemId)
      const soLuong = Number(l.soLuong)
      const donGia = Number(l.donGia)
      if (!eff) { errors.push(`Dòng ${n}: không thuộc phiếu gốc`); return null }
      if (seen.has(l.parentLineId)) errors.push(`Dòng ${n}: bị lặp`)
      seen.add(l.parentLineId)
      if (!item) { errors.push(`Dòng ${n}: vật tư không có trong danh mục kho`); return null }
      if (!(soLuong > 0)) errors.push(`Dòng ${n}: số lượng phải > 0`)
      if (soLuong < eff.received) errors.push(`Dòng ${n}: số lượng duyệt mới (${soLuong}) không được nhỏ hơn số đã nhập (${eff.received})`)
      if (soLuong > eff.so_luong) errors.push(`Dòng ${n}: không được tăng số lượng (đang duyệt ${eff.so_luong}) — mua thêm phải lập phiếu đề nghị mới`)
      if (eff.received >= eff.so_luong) errors.push(`Dòng ${n}: đã nhập đủ, không điều chỉnh được`)
      if (!(donGia >= 0)) errors.push(`Dòng ${n}: đơn giá không hợp lệ`)
      if (item.id === eff.item_id && soLuong === eff.so_luong && donGia === eff.don_gia) {
        errors.push(`Dòng ${n}: không có gì thay đổi`)
      }
      if (item.id !== eff.item_id && eff.received > 0) {
        errors.push(`Dòng ${n}: đã nhập ${eff.received} theo mã cũ — không đổi mã được, chỉ chỉnh giá/giảm SL hoặc lập đề nghị mới cho mã khác`)
      }
      const pct = priceDeviationPct(donGia, eff.don_gia)
      return {
        factory_id: actor.factoryId,
        sort_order: i,
        item_id: item.id,
        item_code: item.code,
        item_name: item.name,
        unit: item.unit,
        so_luong: soLuong,
        don_gia: donGia,
        thanh_tien: Math.round(soLuong * donGia * 100) / 100,
        muc_dich: rootById.get(l.parentLineId)?.muc_dich ?? null,
        image_urls: rootById.get(l.parentLineId)?.image_urls ?? [],
        mua_tai: rootById.get(l.parentLineId)?.mua_tai ?? null,
        ngay_co_hang: rootById.get(l.parentLineId)?.ngay_co_hang ?? null,
        ngay_can_hang: rootById.get(l.parentLineId)?.ngay_can_hang ?? null,
        ghi_chu: l.ghiChu?.trim() || null,
        gia_goi_y: eff.don_gia,
        nguon_gia_goi_y: "gia_duyet_truoc",
        lech_gia_pct: pct === null ? null : Math.round(pct * 10) / 10,
        ly_do_lech_gia: isPriceDeviationExceeded(pct) ? lyDo : null,
        la_vat_tu_moi: false,
        parent_line_id: l.parentLineId,
        truoc_item_id: eff.item_id,
        truoc_item_code: eff.item_code,
        truoc_item_name: eff.item_name,
        truoc_so_luong: eff.so_luong,
        truoc_don_gia: eff.don_gia,
      }
    })
    if (errors.length) return NextResponse.json({ error: errors.join("\n") }, { status: 400 })

    const ngay = getFactoryTodayISO()
    const nam = Number(ngay.slice(0, 4))
    const { data: so, error: soErr } = await supabaseAdmin.rpc("get_next_purchase_so", { p_factory_id: actor.factoryId, p_nam: nam })
    if (soErr || !so) return NextResponse.json({ error: soErr?.message || "Không cấp được số phiếu" }, { status: 500 })

    const lineRows = rows.filter(Boolean) as NonNullable<(typeof rows)[number]>[]
    const { data: created, error: insErr } = await supabaseAdmin
      .from("purchase_requests")
      .insert({
        factory_id: actor.factoryId,
        nam,
        so,
        ngay,
        loai: "dieu_chinh",
        parent_request_id: id,
        ly_do_dieu_chinh: lyDo,
        nguoi_de_nghi_id: actor.userId,
        nguoi_de_nghi_ten: parent.nguoi_de_nghi_ten,
        giam_doc_user_id: parent.giam_doc_user_id,
        ke_toan_user_id: parent.ke_toan_user_id,
        loai_tien: parent.loai_tien,
        bo_phan: parent.bo_phan ?? null,
        ngay_can_hang: minIsoDate(lineRows.map((l) => l.ngay_can_hang)),
        tong_tien: lineRows.reduce((s, l) => s + l.thanh_tien, 0),
        ghi_chu: `Điều chỉnh phiếu ${formatSoPhieuFull(parent.so, parent.nam)}`,
        trang_thai: "nhap",
        created_by: actor.userId,
      })
      .select("id")
      .single()
    if (insErr || !created) return NextResponse.json({ error: insErr?.message || "Không tạo được phiếu điều chỉnh" }, { status: 400 })
    const adjId = created.id as string

    const { error: lineErr } = await supabaseAdmin
      .from("purchase_request_lines")
      .insert(lineRows.map((l) => ({ ...l, request_id: adjId })))
    if (lineErr) {
      // Không để phiếu điều chỉnh rỗng chặn các lần điều chỉnh sau — huỷ luôn (số vẫn giữ).
      await supabaseAdmin.from("purchase_requests").update({ trang_thai: "huy", ly_do_huy: `Lỗi tạo dòng: ${lineErr.message}` }).eq("id", adjId)
      return NextResponse.json({ error: lineErr.message }, { status: 400 })
    }

    await insertPurchaseLog({ requestId: adjId, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "tao_dieu_chinh", noiDung: lyDo })
    await insertPurchaseLog({
      requestId: id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "lap_dieu_chinh",
      noiDung: `Phiếu điều chỉnh ${formatSoPhieuFull(so as number, nam)}: ${lyDo}`,
    })

    return NextResponse.json({ id: adjId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
