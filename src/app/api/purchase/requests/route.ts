import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { BO_PHAN_LIST, isBoPhan } from "@/lib/bo-phan"
import { insertPurchaseLog } from "@/lib/purchase/server"
import {
  isPriceDeviationExceeded, isPurchaseEditable, minIsoDate, normalizeIsoDate, priceDeviationPct, sanitizeImageUrls,
  type PurchaseLineInput, type PurchaseRequestRow, type PurchaseStatus,
} from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

const REQUEST_COLS =
  "id, factory_id, nam, so, ngay, loai, nguoi_de_nghi_id, nguoi_de_nghi_ten, giam_doc_user_id, ke_toan_user_id, trang_thai, loai_tien, tong_tien, ghi_chu, bo_phan, ngay_can_hang, yeu_cau_ky_id, ngay_duyet, ly_do_huy, huy_luc, created_at, created_by"

// ── GET: danh sách ──────────────────────────────────────────
// ?scope=mine|todo|all&from=&to=&status=
//  mine — phiếu tôi đề nghị hoặc tôi là người ký; all — toàn nhà máy (purchase.view_all/admin);
//  todo — phiếu đang chờ CHÍNH TÔI ký (đã tới lượt) + phiếu bị trả về của tôi.
export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const sp = req.nextUrl.searchParams
    const scope = sp.get("scope") || "mine"
    const from = sp.get("from")
    const to = sp.get("to")
    const status = sp.get("status")
    const boPhanFilter = (sp.get("bo_phan") || "").split(",").map((v) => v.trim()).filter(isBoPhan)

    const canAll = actor.isAdmin || (await isoActorHasPermission(actor, ["purchase.view_all"]))
    if (scope === "all" && !canAll) {
      return NextResponse.json({ error: "Bạn không có quyền xem toàn bộ phiếu" }, { status: 403 })
    }

    const rows: (PurchaseRequestRow & { created_by: string | null })[] = []
    for (let offset = 0; ; offset += 1000) {
      let q = supabaseAdmin
        .from("purchase_requests")
        .select(REQUEST_COLS)
        .eq("factory_id", actor.factoryId)
        .order("ngay", { ascending: false })
        .order("so", { ascending: false })
        .range(offset, offset + 999)
      if (from) q = q.gte("ngay", from)
      if (to) q = q.lte("ngay", to)
      if (status) q = q.eq("trang_thai", status)
      if (boPhanFilter.length) q = q.in("bo_phan", boPhanFilter)
      if (scope !== "all") {
        const u = actor.userId
        q = q.or(`nguoi_de_nghi_id.eq.${u},giam_doc_user_id.eq.${u},ke_toan_user_id.eq.${u},created_by.eq.${u}`)
      }
      const { data, error } = await q
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      rows.push(...((data || []) as typeof rows))
      if (!data || data.length < 1000) break
    }

    // Tiến độ ký cho phiếu đang ký (để biết "tới lượt ai").
    const ycIds = rows.filter((r) => r.yeu_cau_ky_id && (r.trang_thai === "cho_ky" || r.trang_thai === "tra_ve")).map((r) => r.yeu_cau_ky_id as string)
    const signersByYc = new Map<string, { user_id: string; thu_tu: number; trang_thai: string }[]>()
    for (let i = 0; i < ycIds.length; i += 100) {
      const { data } = await supabaseAdmin
        .from("nguoi_ky")
        .select("yeu_cau_id, user_id, thu_tu, trang_thai")
        .in("yeu_cau_id", ycIds.slice(i, i + 100))
      for (const s of (data || []) as { yeu_cau_id: string; user_id: string; thu_tu: number; trang_thai: string }[]) {
        const arr = signersByYc.get(s.yeu_cau_id) || []
        arr.push(s)
        signersByYc.set(s.yeu_cau_id, arr)
      }
    }

    // File PDF hiện tại (đã ký 1 phần / đã duyệt) để tải ngay ở danh sách.
    const allYcIds = rows.map((r) => r.yeu_cau_ky_id).filter(Boolean) as string[]
    const fileByYc = new Map<string, string | null>()
    for (let i = 0; i < allYcIds.length; i += 100) {
      const { data } = await supabaseAdmin
        .from("yeu_cau_ky")
        .select("id, file_hien_tai")
        .in("id", allYcIds.slice(i, i + 100))
      for (const y of (data || []) as { id: string; file_hien_tai: string | null }[]) fileByYc.set(y.id, y.file_hien_tai)
    }

    const userIds = new Set<string>()
    for (const r of rows) {
      ;[r.nguoi_de_nghi_id, r.giam_doc_user_id, r.ke_toan_user_id].forEach((id) => id && userIds.add(id))
    }
    const names = new Map<string, string>()
    const ids = [...userIds]
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabaseAdmin.from("profiles").select("id, full_name, username").in("id", ids.slice(i, i + 100))
      for (const p of (data || []) as { id: string; full_name: string | null; username: string | null }[]) {
        names.set(p.id, p.full_name || p.username || "")
      }
    }

    const result = rows.map((r) => {
      const signers = r.yeu_cau_ky_id ? signersByYc.get(r.yeu_cau_ky_id) || [] : []
      const pending = signers.filter((s) => s.trang_thai !== "da_ky").sort((a, b) => a.thu_tu - b.thu_tu)
      const minThuTu = pending[0]?.thu_tu
      const turnUserIds = r.trang_thai === "cho_ky" ? pending.filter((s) => s.thu_tu === minThuTu).map((s) => s.user_id) : []
      return {
        ...r,
        nguoi_de_nghi_ten: r.nguoi_de_nghi_ten || names.get(r.nguoi_de_nghi_id) || "",
        giam_doc_ten: r.giam_doc_user_id ? names.get(r.giam_doc_user_id) || "" : "",
        ke_toan_ten: r.ke_toan_user_id ? names.get(r.ke_toan_user_id) || "" : "",
        signedCount: signers.filter((s) => s.trang_thai === "da_ky").length,
        signerCount: signers.length,
        turnUserIds,
        myTurn: turnUserIds.includes(actor.userId),
        file_hien_tai: r.yeu_cau_ky_id ? fileByYc.get(r.yeu_cau_ky_id) || null : null,
      }
    })

    // "Chờ tôi xử lý": phiếu cần hàng sớm nhất lên trước (phiếu cũ không có ngày cần → cuối).
    const filtered = scope === "todo"
      ? result
          .filter((r) => r.myTurn || (r.trang_thai === "tra_ve" && r.nguoi_de_nghi_id === actor.userId))
          .sort((a, b) => (a.ngay_can_hang || "9999-12-31").localeCompare(b.ngay_can_hang || "9999-12-31"))
      : result
    return NextResponse.json({ rows: filtered, canAll })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}

// ── POST: lưu phiếu (tạo mới hoặc sửa khi Nháp / Bị trả về) ──
type SaveBody = {
  id?: string | null
  loaiTien: string
  giamDocUserId: string | null
  keToanUserId: string | null
  ghiChu?: string | null
  boPhan?: string | null
  lines: PurchaseLineInput[]
}

export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    if (!(await isoActorHasPermission(actor, ["purchase.create"]))) {
      return NextResponse.json({ error: "Bạn không có quyền tạo đề nghị mua vật tư" }, { status: 403 })
    }
    const body = (await req.json()) as SaveBody
    const factoryId = actor.factoryId
    const loaiTien = ["USD", "VND", "KHR"].includes(body.loaiTien) ? body.loaiTien : "USD"
    if (!isBoPhan(body.boPhan)) {
      return NextResponse.json({ error: `Chưa chọn Bộ phận (một trong: ${BO_PHAN_LIST.join(", ")})` }, { status: 400 })
    }
    const boPhan = body.boPhan

    // ── Kiểm tra dòng ──
    const lines = Array.isArray(body.lines) ? body.lines : []
    if (!lines.length) return NextResponse.json({ error: "Phiếu cần ít nhất 1 dòng vật tư" }, { status: 400 })
    const errors: string[] = []
    const itemIds = [...new Set(lines.map((l) => l.item_id).filter(Boolean) as string[])]
    if (itemIds.length) {
      const { data: found } = await supabaseAdmin.from("inventory_items").select("id").eq("factory_id", factoryId).in("id", itemIds)
      const okIds = new Set(((found || []) as { id: string }[]).map((r) => r.id))
      if (itemIds.some((id) => !okIds.has(id))) errors.push("Có vật tư không thuộc danh mục của nhà máy")
    }
    const seen = new Set<string>()
    const today = getFactoryTodayISO()
    lines.forEach((l, i) => {
      const n = i + 1
      if (!l.item_id) errors.push(`Dòng ${n}: chưa chọn vật tư trong danh mục`)
      if (l.item_id && seen.has(l.item_id)) errors.push(`Dòng ${n}: vật tư bị lặp — gộp số lượng vào 1 dòng`)
      if (l.item_id) seen.add(l.item_id)
      if (!String(l.muc_dich || "").trim()) errors.push(`Dòng ${n}: chưa nhập mục đích sử dụng`)
      const canHang = normalizeIsoDate(l.ngay_can_hang)
      if (!canHang) errors.push(`Dòng ${n}: chưa chọn thời gian cần hàng`)
      else if (canHang < today) errors.push(`Dòng ${n}: thời gian cần hàng không được trước hôm nay`)
      if (l.ngay_co_hang && !normalizeIsoDate(l.ngay_co_hang)) errors.push(`Dòng ${n}: thời gian có hàng không hợp lệ`)
      if (!(Number(l.so_luong) > 0)) errors.push(`Dòng ${n}: số lượng phải > 0`)
      if (!(Number(l.don_gia) >= 0)) errors.push(`Dòng ${n}: đơn giá không hợp lệ`)
      const pct = priceDeviationPct(Number(l.don_gia), l.gia_goi_y)
      if (isPriceDeviationExceeded(pct) && !String(l.ly_do_lech_gia || "").trim()) {
        errors.push(`Dòng ${n}: đơn giá lệch ${pct!.toFixed(0)}% so với giá gợi ý — cần nhập lý do`)
      }
    })
    const signerIds = [actor.userId, body.giamDocUserId, body.keToanUserId].filter(Boolean)
    if (new Set(signerIds).size !== signerIds.length) {
      errors.push("Người đề nghị, Giám đốc và Kế toán phải là 3 người khác nhau")
    }
    if (errors.length) return NextResponse.json({ error: errors.join("\n") }, { status: 400 })

    const lineRows = lines.map((l, i) => {
      const soLuong = Number(l.so_luong)
      const donGia = Number(l.don_gia)
      const pct = priceDeviationPct(donGia, l.gia_goi_y)
      return {
        factory_id: factoryId,
        sort_order: i,
        item_id: l.item_id,
        item_code: l.item_code,
        item_name: String(l.item_name || "").trim(),
        unit: l.unit,
        so_luong: soLuong,
        don_gia: donGia,
        thanh_tien: Math.round(soLuong * donGia * 100) / 100,
        muc_dich: String(l.muc_dich || "").trim(),
        ghi_chu: l.ghi_chu?.trim() || null,
        gia_goi_y: l.gia_goi_y ?? null,
        nguon_gia_goi_y: l.nguon_gia_goi_y ?? null,
        lech_gia_pct: pct === null ? null : Math.round(pct * 10) / 10,
        ly_do_lech_gia: isPriceDeviationExceeded(pct) ? String(l.ly_do_lech_gia || "").trim() : null,
        la_vat_tu_moi: !!l.la_vat_tu_moi,
        image_urls: sanitizeImageUrls(l.image_urls),
        mua_tai: String(l.mua_tai || "").trim() || null,
        ngay_co_hang: normalizeIsoDate(l.ngay_co_hang),
        ngay_can_hang: normalizeIsoDate(l.ngay_can_hang),
      }
    })
    const tongTien = lineRows.reduce((s, l) => s + l.thanh_tien, 0)
    const ngayCanHang = minIsoDate(lineRows.map((l) => l.ngay_can_hang))

    const { data: me } = await supabaseAdmin.from("profiles").select("full_name, username").eq("id", actor.userId).single()
    const myName = (me?.full_name || me?.username || "") as string

    let requestId = body.id || null
    if (requestId) {
      const { data: existing } = await supabaseAdmin
        .from("purchase_requests")
        .select("id, nguoi_de_nghi_id, trang_thai, loai, maintenance_record_id")
        .eq("id", requestId)
        .eq("factory_id", factoryId)
        .maybeSingle()
      if (!existing) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })
      // GĐ2g: phiếu lập từ biên bản bảo trì — ai có purchase.create cũng được sửa; người lưu
      // trở thành người đề nghị (ký bước 1, sau đó ghi nhận mua). Phiếu thường: chỉ người đề nghị.
      const takeOver = !!existing.maintenance_record_id && existing.nguoi_de_nghi_id !== actor.userId
      if (existing.nguoi_de_nghi_id !== actor.userId && !takeOver) {
        return NextResponse.json({ error: "Chỉ người đề nghị được sửa phiếu" }, { status: 403 })
      }
      if (existing.loai === "dieu_chinh") {
        return NextResponse.json({ error: "Phiếu điều chỉnh không sửa được — huỷ rồi lập phiếu điều chỉnh mới" }, { status: 409 })
      }
      if (!isPurchaseEditable(existing.trang_thai as PurchaseStatus)) {
        return NextResponse.json({ error: "Phiếu đã gửi ký/đã duyệt, không sửa được" }, { status: 409 })
      }
      const { error: upErr } = await supabaseAdmin
        .from("purchase_requests")
        .update({
          loai_tien: loaiTien,
          giam_doc_user_id: body.giamDocUserId || null,
          ke_toan_user_id: body.keToanUserId || null,
          ghi_chu: body.ghiChu?.trim() || null,
          bo_phan: boPhan,
          ngay_can_hang: ngayCanHang,
          tong_tien: tongTien,
          updated_at: new Date().toISOString(),
          ...(takeOver ? { nguoi_de_nghi_id: actor.userId, nguoi_de_nghi_ten: myName } : {}),
        })
        .eq("id", requestId)
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })
      if (takeOver) {
        await insertPurchaseLog({ requestId, factoryId, userId: actor.userId, hanhDong: "nhan_xu_ly", noiDung: "Nhận xử lý phiếu lập từ biên bản bảo trì" })
      }
      const { error: delErr } = await supabaseAdmin.from("purchase_request_lines").delete().eq("request_id", requestId)
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 })
    } else {
      const ngay = getFactoryTodayISO()
      const nam = Number(ngay.slice(0, 4))
      const { data: so, error: soErr } = await supabaseAdmin.rpc("get_next_purchase_so", { p_factory_id: factoryId, p_nam: nam })
      if (soErr || !so) return NextResponse.json({ error: soErr?.message || "Không cấp được số phiếu" }, { status: 500 })
      const { data: created, error: insErr } = await supabaseAdmin
        .from("purchase_requests")
        .insert({
          factory_id: factoryId,
          nam,
          so,
          ngay,
          nguoi_de_nghi_id: actor.userId,
          nguoi_de_nghi_ten: myName,
          giam_doc_user_id: body.giamDocUserId || null,
          ke_toan_user_id: body.keToanUserId || null,
          loai_tien: loaiTien,
          tong_tien: tongTien,
          ghi_chu: body.ghiChu?.trim() || null,
          bo_phan: boPhan,
          ngay_can_hang: ngayCanHang,
          trang_thai: "nhap",
          created_by: actor.userId,
        })
        .select("id")
        .single()
      if (insErr || !created) return NextResponse.json({ error: insErr?.message || "Không tạo được phiếu" }, { status: 400 })
      requestId = created.id as string
      await insertPurchaseLog({ requestId, factoryId, userId: actor.userId, hanhDong: "tao", noiDung: `Số ${so}/${nam}` })
    }

    const { error: lineErr } = await supabaseAdmin
      .from("purchase_request_lines")
      .insert(lineRows.map((l) => ({ ...l, request_id: requestId })))
    if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 400 })

    return NextResponse.json({ id: requestId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
