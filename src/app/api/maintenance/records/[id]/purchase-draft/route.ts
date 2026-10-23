import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { computeKtStatuses, PURCHASE_ACTIVE_FOR_KT } from "@/lib/maintenance-kt"
import { insertPurchaseLog } from "@/lib/purchase/server"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { isBoPhan } from "@/lib/bo-phan"

export const dynamic = "force-dynamic"

// POST — "Lập đề nghị mua" từ biên bản bảo trì (GĐ2g): tạo phiếu Đề nghị mua NHÁP cho phần vật tư
// mua ngoài còn thiếu ở kho tạm KT (đã trừ phần đang đề nghị). Người tạo biên bản (hoặc admin) lập,
// kể cả khi không có purchase.create; người có purchase.create bấm "Nhận xử lý" (Lưu) rồi gửi ký.
// Đã có phiếu nháp/bị trả về liên kết → trả lại phiếu đó, không tạo trùng.

const DEFAULT_USD_RATE: Record<string, number> = { USD: 1, KHR: 4100, VND: 25000 }

type Need = {
  itemId: string
  itemCode: string | null
  name: string
  unit: string | null
  donGia: number
  loaiTien: string
  qty: number
}

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

    // Chặn sớm — TRƯỚC khi cấp số/tạo phiếu: mọi vật tư mua ngoài phải có mã trong danh mục kho.
    // Trước đây id vật tư nằm ở bảng cũ maintenance_external_materials ⇒ insert dòng phiếu lỗi khoá
    // ngoại item_id và để lại 1 phiếu "Đã hủy" vô nghĩa.
    const { data: extMats } = await supabaseAdmin
      .from("maintenance_materials")
      .select("inventory_item_id, ten_vat_tu, nguon, dvt, so_luong, don_gia, loai_tien")
      .eq("record_id", id)
      .in("nguon", ["ben_ngoai", "gia_cong"])
    const extRows = (extMats || []) as {
      inventory_item_id: string | null
      ten_vat_tu: string | null
      nguon: string
      dvt: string | null
      so_luong: number | null
      don_gia: number | null
      loai_tien: string | null
    }[]
    const extIds = Array.from(new Set(extRows.map((m) => m.inventory_item_id).filter((v): v is string => !!v)))
    const knownIds = new Set<string>()
    const knownItems = new Map<string, { code: string | null; name: string; unit: string | null; laDichVu: boolean }>()
    if (extIds.length) {
      const { data: known } = await supabaseAdmin
        .from("inventory_items")
        .select("id, code, name, unit, la_dich_vu")
        .eq("factory_id", factoryId)
        .in("id", extIds)
      for (const k of (known || []) as { id: string; code: string | null; name: string; unit: string | null; la_dich_vu: boolean | null }[]) {
        knownIds.add(k.id)
        knownItems.set(k.id, { code: k.code, name: k.name, unit: k.unit, laDichVu: !!k.la_dich_vu })
      }
    }
    const noCode = Array.from(
      new Set(
        extRows
          .filter((m) => (m.ten_vat_tu || "").trim() && (!m.inventory_item_id || !knownIds.has(m.inventory_item_id)))
          .map((m) => (m.ten_vat_tu || "").trim()),
      ),
    )
    if (noCode.length) {
      return NextResponse.json(
        {
          error: `Vật tư ${noCode.join(", ")} chưa có mã trong danh mục kho — sửa biên bản, chọn hoặc tạo mã vật tư ("+ Thêm mã vật tư ngoài") rồi lưu lại.`,
        },
        { status: 400 },
      )
    }

    const [status] = await computeKtStatuses(factoryId, id)
    const needs: Need[] = (status?.items || [])
      .map((it) => ({
        itemId: it.itemId, itemCode: it.itemCode, name: it.name, unit: it.unit,
        donGia: it.donGia, loaiTien: it.loaiTien, qty: Math.max(0, it.shortage - it.pendingRequested),
      }))
      .filter((it) => it.qty > 0)

    // Bước 3 — Gia công ngoài (dịch vụ, không qua kho): cần = tổng SL dòng gia_cong của biên bản
    // − phần đã nằm trong phiếu đề nghị liên kết còn hiệu lực (phiếu đóng chỉ tính phần đã xong).
    const serviceNeed = new Map<string, Need>()
    for (const m of extRows) {
      if (m.nguon !== "gia_cong" || !m.inventory_item_id) continue
      const meta = knownItems.get(m.inventory_item_id)
      if (!meta) continue
      const cur = serviceNeed.get(m.inventory_item_id)
      if (cur) cur.qty += Number(m.so_luong) || 0
      else serviceNeed.set(m.inventory_item_id, {
        itemId: m.inventory_item_id, itemCode: meta.code, name: meta.name, unit: meta.unit || m.dvt,
        donGia: Number(m.don_gia) || 0, loaiTien: m.loai_tien || "USD", qty: Number(m.so_luong) || 0,
      })
    }
    if (serviceNeed.size) {
      const { data: linked } = await supabaseAdmin
        .from("purchase_requests")
        .select("id, trang_thai")
        .eq("factory_id", factoryId)
        .eq("maintenance_record_id", id)
        .eq("loai", "goc")
        .in("trang_thai", [...PURCHASE_ACTIVE_FOR_KT, "hoan_tat", "dong"])
      const linkedRows = (linked || []) as { id: string; trang_thai: string }[]
      if (linkedRows.length) {
        const closed = new Set(linkedRows.filter((r) => r.trang_thai === "dong").map((r) => r.id))
        const { data: lines } = await supabaseAdmin
          .from("purchase_request_lines")
          .select("request_id, item_id, so_luong, sl_da_mua")
          .in("request_id", linkedRows.map((r) => r.id))
          .in("item_id", Array.from(serviceNeed.keys()))
        for (const l of (lines || []) as { request_id: string; item_id: string; so_luong: number | null; sl_da_mua: number | null }[]) {
          const n = serviceNeed.get(l.item_id)
          if (n) n.qty -= closed.has(l.request_id) ? Number(l.sl_da_mua) || 0 : Number(l.so_luong) || 0
        }
      }
      for (const n of serviceNeed.values()) if (n.qty > 0) needs.push(n)
    }

    if (!needs.length) {
      return NextResponse.json({ error: "Kho đã đủ và dịch vụ gia công đã có đề nghị — không cần lập thêm" }, { status: 409 })
    }

    // Mục đích: tên thiết bị của dòng biên bản chứa vật tư.
    const { data: mats } = await supabaseAdmin
      .from("maintenance_materials")
      .select("inventory_item_id, maintenance_record_lines(ten_tb)")
      .eq("record_id", id)
      .in("nguon", ["ben_ngoai", "gia_cong"])
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
        ghi_chu: `Vật tư mua ngoài cho biên bản bảo trì ${rec.ma_bb || ""}`,
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
