import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { computeKtStatuses, PURCHASE_ACTIVE_FOR_KT } from "@/lib/maintenance-kt"
import { insertPurchaseLog, isRecordTeamMember } from "@/lib/purchase/server"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { isBoPhan } from "@/lib/bo-phan"

export const dynamic = "force-dynamic"

// POST — "Lập đề nghị mua" từ biên bản bảo trì (GĐ2g): tạo phiếu Đề nghị mua NHÁP cho phần vật tư
// mua ngoài còn thiếu ở kho mặc định của từng vật tư (đã trừ phần đang đề nghị). Người lập: người tạo
// biên bản, NV phụ trách, người có purchase.create, hoặc admin; người không có purchase.create lập nháp
// xong thì người có quyền bấm "Nhận xử lý" (Lưu) rồi gửi ký.
// Đã có phiếu gốc NHÁP liên kết → đồng bộ theo biên bản (chỉ tăng SL dòng cùng vật tư / thêm dòng vật tư
// mới, không giảm, không xoá dòng — giữ phần mua dư và dòng người mua tự thêm). Chỉ có phiếu BỊ TRẢ VỀ →
// trả lại phiếu đó, không đụng. Không bao giờ tạo trùng.

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
      .select("id, ma_bb, bo_phan, trang_thai, created_by, nguoi_tao, nv_phu_trach, phu_trach_bao_tri")
      .eq("id", id)
      .eq("factory_id", factoryId)
      .maybeSingle()
    if (!rec) return NextResponse.json({ error: "Không tìm thấy biên bản" }, { status: 404 })

    const { data: me } = await supabaseAdmin.from("profiles").select("full_name, username").eq("id", actor.userId).single()
    const myName = (me?.full_name || me?.username || "") as string
    const myNames = [me?.full_name, me?.username].filter((v): v is string => !!v)
    // Người tạo / NV phụ trách so theo tên profile (cột tên là snapshot) — dùng chung với phiếu đề nghị.
    const canDraft =
      actor.isAdmin || isRecordTeamMember(rec, actor.userId, myNames) ||
      (await isoActorHasPermission(actor, ["purchase.create"]))
    if (!canDraft) {
      return NextResponse.json(
        { error: "Chỉ người tạo biên bản, NV phụ trách, người có quyền mua hàng hoặc admin được lập đề nghị mua" },
        { status: 403 },
      )
    }
    if (rec.trang_thai === "da_duyet" || rec.trang_thai === "huy") {
      return NextResponse.json({ error: "Biên bản đã duyệt/huỷ — không cần lập đề nghị" }, { status: 409 })
    }

    const { data: openReqs } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, so, loai, trang_thai, loai_tien")
      .eq("factory_id", factoryId)
      .eq("maintenance_record_id", id)
      .in("trang_thai", ["nhap", "tra_ve"])
      .order("created_at")
    const openRows = (openReqs || []) as { id: string; so: number; loai: string; trang_thai: string; loai_tien: string | null }[]
    // Phiếu NHÁP gốc: đồng bộ theo biên bản (bên dưới). Chỉ có phiếu BỊ TRẢ VỀ (đã có chữ ký) thì
    // không đụng — mở lại để người đề nghị tự sửa SL trên phiếu.
    const draft = openRows.find((r) => r.loai === "goc" && r.trang_thai === "nhap") || null
    if (!draft && openRows.length) return NextResponse.json({ id: openRows[0].id, existed: true })

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
      // Dịch vụ gia công tính riêng ở khối bên dưới (cũng có trong status.items từ 2026-10-26).
      .filter((it) => it.kind === "vat_tu")
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

    // `needs` là phần CÒN THIẾU sau khi đã trừ mọi phiếu đang đề nghị (kể cả chính phiếu nháp) ⇒ đồng bộ
    // nháp = cộng thêm đúng phần này. Nháp đã đủ/dư thì chỉ mở lại (không bao giờ giảm SL, không xoá dòng).
    if (!needs.length && draft) return NextResponse.json({ id: draft.id, existed: true, updated: false })
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
    const isCurrency = (c: string | null | undefined): c is string => !!c && ["USD", "VND", "KHR"].includes(c)
    const loaiTien = isCurrency(draft?.loai_tien) ? draft.loai_tien : isCurrency(needs[0].loaiTien) ? needs[0].loaiTien : "USD"
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

    if (draft) {
      const { data: dLines, error: dErr } = await supabaseAdmin
        .from("purchase_request_lines")
        .select("id, item_id, so_luong, don_gia, sort_order")
        .eq("request_id", draft.id)
      if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
      const existing = (dLines || []) as { id: string; item_id: string | null; so_luong: number | null; don_gia: number | null; sort_order: number | null }[]
      let nextSort = existing.reduce((m, l) => Math.max(m, Number(l.sort_order) || 0), -1) + 1
      const changes: string[] = []
      for (const row of lineRows) {
        const cur = existing.find((l) => l.item_id === row.item_id)
        if (cur) {
          const soLuong = (Number(cur.so_luong) || 0) + row.so_luong
          const donGia = Number(cur.don_gia) || 0
          // Bản chụp bằng chứng của dòng đổi SL không còn khớp ⇒ xoá, gửi ký sẽ chụp lại.
          const { error } = await supabaseAdmin
            .from("purchase_request_lines")
            .update({ so_luong: soLuong, thanh_tien: Math.round(soLuong * donGia * 100) / 100, insight_snapshot: null })
            .eq("id", cur.id)
          if (error) return NextResponse.json({ error: error.message }, { status: 400 })
          changes.push(`${row.item_name}: ${Number(cur.so_luong) || 0} → ${soLuong}`)
        } else {
          const { error } = await supabaseAdmin
            .from("purchase_request_lines")
            .insert({ ...row, sort_order: nextSort++, request_id: draft.id })
          if (error) return NextResponse.json({ error: error.message }, { status: 400 })
          changes.push(`thêm ${row.item_name} (${row.so_luong})`)
        }
      }
      const { data: allLines } = await supabaseAdmin
        .from("purchase_request_lines")
        .select("thanh_tien")
        .eq("request_id", draft.id)
      const tong = ((allLines || []) as { thanh_tien: number | null }[]).reduce((s, l) => s + (Number(l.thanh_tien) || 0), 0)
      await supabaseAdmin
        .from("purchase_requests")
        .update({ tong_tien: Math.round(tong * 100) / 100 })
        .eq("id", draft.id)
        .eq("trang_thai", "nhap")
      await insertPurchaseLog({
        requestId: draft.id, factoryId, userId: actor.userId, hanhDong: "cap_nhat_tu_bao_tri",
        noiDung: `Cập nhật theo biên bản ${rec.ma_bb || ""}: ${changes.join("; ")}`,
      })
      return NextResponse.json({ id: draft.id, existed: true, updated: true })
    }

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
