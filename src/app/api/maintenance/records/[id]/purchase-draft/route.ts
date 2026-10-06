import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { computeKtStatuses } from "@/lib/maintenance-kt"
import { insertPurchaseLog } from "@/lib/purchase/server"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { isBoPhan } from "@/lib/bo-phan"

export const dynamic = "force-dynamic"

// POST — "Lập đề nghị mua" từ biên bản bảo trì (GĐ2g): tạo phiếu Đề nghị mua NHÁP cho phần vật tư
// mua ngoài còn thiếu ở kho tạm KT (đã trừ phần đang đề nghị). Người tạo biên bản (hoặc admin) lập,
// kể cả khi không có purchase.create; người có purchase.create bấm "Nhận xử lý" (Lưu) rồi gửi ký.
// Đã có phiếu nháp/bị trả về liên kết → trả lại phiếu đó, không tạo trùng.

const DEFAULT_USD_RATE: Record<string, number> = { USD: 1, KHR: 4100, VND: 25000 }

type MatWithLine = {
  inventory_item_id: string | null
  maintenance_record_lines: { ten_tb: string | null } | { ten_tb: string | null }[] | null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const factoryId = actor.factoryId

    const { data: rec } = await supabaseAdmin
      .from("maintenance_records")
      .select("id, ma_bb, bo_phan, trang_thai, created_by, nguoi_tao")
      .eq("id", id)
      .eq("factory_id", factoryId)
      .maybeSingle()
    if (!rec) return NextResponse.json({ error: "Không tìm thấy biên bản" }, { status: 404 })

    const { data: me } = await supabaseAdmin.from("profiles").select("full_name, username").eq("id", actor.userId).single()
    const myName = (me?.full_name || me?.username || "") as string
    const isCreator =
      rec.created_by === actor.userId ||
      (!!rec.nguoi_tao && (rec.nguoi_tao === me?.full_name || rec.nguoi_tao === me?.username))
    if (!actor.isAdmin && !(isCreator && (await isoActorHasPermission(actor, ["maintenance.create"])))) {
      return NextResponse.json({ error: "Chỉ người tạo biên bản hoặc admin được lập đề nghị mua" }, { status: 403 })
    }
    if (rec.trang_thai === "da_duyet" || rec.trang_thai === "huy") {
      return NextResponse.json({ error: "Biên bản đã duyệt/huỷ — không cần lập đề nghị" }, { status: 409 })
    }

    const { data: existingDraft } = await supabaseAdmin
      .from("purchase_requests")
      .select("id")
      .eq("factory_id", factoryId)
      .eq("maintenance_record_id", id)
      .in("trang_thai", ["nhap", "tra_ve"])
      .limit(1)
      .maybeSingle()
    if (existingDraft) return NextResponse.json({ id: existingDraft.id, existed: true })

    const [status] = await computeKtStatuses(factoryId, id)
    const needs = (status?.items || [])
      .map((it) => ({ ...it, qty: Math.max(0, it.shortage - it.pendingRequested) }))
      .filter((it) => it.qty > 0)
    if (!needs.length) {
      return NextResponse.json({ error: "Kho tạm đã đủ (hoặc đã có đề nghị đang chờ nhập) — không cần lập thêm" }, { status: 409 })
    }

    // Mục đích: tên thiết bị của dòng biên bản chứa vật tư.
    const { data: mats } = await supabaseAdmin
      .from("maintenance_materials")
      .select("inventory_item_id, maintenance_record_lines(ten_tb)")
      .eq("record_id", id)
      .eq("nguon", "ben_ngoai")
    const tenTbByItem = new Map<string, string>()
    for (const m of (mats || []) as MatWithLine[]) {
      const l = Array.isArray(m.maintenance_record_lines) ? m.maintenance_record_lines[0] : m.maintenance_record_lines
      if (m.inventory_item_id && l?.ten_tb && !tenTbByItem.has(m.inventory_item_id)) tenTbByItem.set(m.inventory_item_id, l.ten_tb)
    }

    // Một loại tiền cho cả phiếu: theo vật tư đầu tiên, dòng khác quy đổi theo tỷ giá nhà máy.
    const { data: fac } = await supabaseAdmin.from("factories").select("ty_gia_usd_vnd, ty_gia_usd_khr").eq("id", factoryId).maybeSingle()
    const rate: Record<string, number> = { ...DEFAULT_USD_RATE }
    if (Number(fac?.ty_gia_usd_vnd) > 0) rate.VND = Number(fac?.ty_gia_usd_vnd)
    if (Number(fac?.ty_gia_usd_khr) > 0) rate.KHR = Number(fac?.ty_gia_usd_khr)
    const loaiTien = ["USD", "VND", "KHR"].includes(needs[0].loaiTien) ? needs[0].loaiTien : "USD"
    const convert = (amount: number, from: string) =>
      from === loaiTien ? amount : (amount / (rate[from] || 1)) * (rate[loaiTien] || 1)

    const today = getFactoryTodayISO()
    const nam = Number(today.slice(0, 4))
    const lineRows = needs.map((it, i) => {
      const donGia = Math.round(convert(it.donGia, it.loaiTien) * 100) / 100
      const tenTb = tenTbByItem.get(it.itemId)
      return {
        factory_id: factoryId,
        sort_order: i,
        item_id: it.itemId,
        item_code: it.itemCode,
        item_name: it.name,
        unit: it.unit,
        so_luong: it.qty,
        don_gia: donGia,
        thanh_tien: Math.round(it.qty * donGia * 100) / 100,
        muc_dich: `Biên bản ${rec.ma_bb || ""}${tenTb ? ` — ${tenTb}` : ""}`.trim(),
        ngay_can_hang: today,
      }
    })

    const { data: so, error: soErr } = await supabaseAdmin.rpc("get_next_purchase_so", { p_factory_id: factoryId, p_nam: nam })
    if (soErr || !so) return NextResponse.json({ error: soErr?.message || "Không cấp được số phiếu" }, { status: 500 })
    const { data: created, error: insErr } = await supabaseAdmin
      .from("purchase_requests")
      .insert({
        factory_id: factoryId,
        nam,
        so,
        ngay: today,
        nguoi_de_nghi_id: actor.userId,
        nguoi_de_nghi_ten: myName,
        loai_tien: loaiTien,
        tong_tien: lineRows.reduce((s, l) => s + l.thanh_tien, 0),
        ghi_chu: `Vật tư mua ngoài cho biên bản bảo trì ${rec.ma_bb || ""} (nhập kho tạm KT)`,
        bo_phan: isBoPhan(rec.bo_phan) ? rec.bo_phan : null,
        ngay_can_hang: today,
        trang_thai: "nhap",
        created_by: actor.userId,
        lap_boi_id: actor.userId,
        maintenance_record_id: id,
      })
      .select("id")
      .single()
    if (insErr || !created) return NextResponse.json({ error: insErr?.message || "Không tạo được phiếu" }, { status: 400 })
    const requestId = created.id as string
    const { error: lineErr } = await supabaseAdmin
      .from("purchase_request_lines")
      .insert(lineRows.map((l) => ({ ...l, request_id: requestId })))
    if (lineErr) {
      await supabaseAdmin
        .from("purchase_requests")
        .update({ trang_thai: "huy", ly_do_huy: "Lỗi tạo dòng vật tư", huy_luc: new Date().toISOString() })
        .eq("id", requestId)
      return NextResponse.json({ error: lineErr.message }, { status: 400 })
    }
    await insertPurchaseLog({
      requestId, factoryId, userId: actor.userId, hanhDong: "tao_tu_bao_tri",
      noiDung: `Lập từ biên bản ${rec.ma_bb || ""} — số ${so}/${nam}`,
    })
    return NextResponse.json({ id: requestId, existed: false })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
