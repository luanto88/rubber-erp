import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { BO_PHAN_LIST, isBoPhan } from "@/lib/bo-phan"
import { insertPurchaseLog, isMaintenanceRecordTeam, loadEffectiveLines, syncPurchaseFromSigning } from "@/lib/purchase/server"
import { syncMaintenanceExtPricesSafe } from "@/lib/maintenance-ext-price"
import {
  isPriceDeviationExceeded, isPurchaseEditable, minIsoDate, normalizeIsoDate, priceDeviationPct, sanitizeImageUrls,
  type PurchaseEffectiveLine, type PurchaseLineInput, type PurchaseRequestRow, type PurchaseStatus,
} from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

const REQUEST_COLS =
  "id, factory_id, nam, so, ngay, loai, nguoi_de_nghi_id, nguoi_de_nghi_ten, giam_doc_user_id, ke_toan_user_id, trang_thai, loai_tien, tong_tien, ghi_chu, bo_phan, ngay_can_hang, yeu_cau_ky_id, ngay_duyet, ly_do_huy, huy_luc, created_at, created_by"

// ── GET: danh sách ──────────────────────────────────────────
// ?scope=mine|todo|all&from=&to=&status=
//  mine — phiếu tôi đề nghị hoặc tôi là người ký; all — toàn nhà máy (purchase.view_all/admin);
//  todo — phiếu đang chờ CHÍNH TÔI ký (đã tới lượt) + phiếu bị trả về của tôi + phiếu đã duyệt của tôi
//         còn phải ghi nhận mua / xác nhận gia công.
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

    // File PDF hiện tại (đã ký 1 phần / đã duyệt) để tải ngay ở danh sách + trạng thái yêu cầu ký.
    const allYcIds = rows.map((r) => r.yeu_cau_ky_id).filter(Boolean) as string[]
    const fileByYc = new Map<string, string | null>()
    const ycStatusByYc = new Map<string, string>()
    for (let i = 0; i < allYcIds.length; i += 100) {
      const { data } = await supabaseAdmin
        .from("yeu_cau_ky")
        .select("id, file_hien_tai, trang_thai")
        .in("id", allYcIds.slice(i, i + 100))
      for (const y of (data || []) as { id: string; file_hien_tai: string | null; trang_thai: string }[]) {
        fileByYc.set(y.id, y.file_hien_tai)
        ycStatusByYc.set(y.id, y.trang_thai)
      }
    }

    // Yêu cầu ký đã hoàn tất mà phiếu vẫn 'cho_ky'/'tra_ve' (lượt ký trước lỡ đồng bộ hỏng) →
    // đồng bộ qua hàm chuẩn (ghi nhật ký + tính lại phiếu gốc của phiếu điều chỉnh).
    const lagging = rows.filter(
      (r) => r.yeu_cau_ky_id && (r.trang_thai === "cho_ky" || r.trang_thai === "tra_ve") && ycStatusByYc.get(r.yeu_cau_ky_id) === "hoan_tat",
    )
    for (const r of lagging) {
      await syncPurchaseFromSigning(r.yeu_cau_ky_id as string)
      r.trang_thai = r.loai === "dieu_chinh" ? "hoan_tat" : "da_duyet"
      r.ngay_duyet = r.ngay_duyet || new Date().toISOString()
    }

    // Dòng vật tư rút gọn — cho dòng xổ ở danh sách (rule 29 mục A.3).
    type ListLine = {
      id: string; request_id: string; sort_order: number; item_id: string | null; item_code: string | null; item_name: string
      unit: string | null; so_luong: number; don_gia: number; thanh_tien: number; sl_da_mua: number
      muc_dich: string | null; ngay_can_hang: string | null
    }
    const linesByReq = new Map<string, ListLine[]>()
    const reqIds = rows.map((r) => r.id)
    for (let i = 0; i < reqIds.length; i += 100) {
      const { data } = await supabaseAdmin
        .from("purchase_request_lines")
        .select("id, request_id, sort_order, item_id, item_code, item_name, unit, so_luong, don_gia, thanh_tien, sl_da_mua, muc_dich, ngay_can_hang")
        .in("request_id", reqIds.slice(i, i + 100))
        .order("sort_order", { ascending: true })
        .range(0, 9999)
      for (const l of (data || []) as ListLine[]) {
        const arr = linesByReq.get(l.request_id) || []
        arr.push(l)
        linesByReq.set(l.request_id, arr)
      }
    }

    // Bước tiếp theo của phiếu ĐÃ DUYỆT theo SL HIỆU LỰC (sau phiếu điều chỉnh đã duyệt) − đã nhận.
    const isBuying = (r: { loai: string; trang_thai: string }) =>
      r.loai !== "dieu_chinh" && (r.trang_thai === "da_duyet" || r.trang_thai === "dang_mua")
    const buyingIds = rows.filter(isBuying).map((r) => r.id)
    const effByReq = new Map<string, PurchaseEffectiveLine[]>()
    for (let i = 0; i < buyingIds.length; i += 10) {
      const chunk = buyingIds.slice(i, i + 10)
      const res = await Promise.all(chunk.map((id) => loadEffectiveLines(id).catch(() => null)))
      chunk.forEach((id, k) => { if (res[k]) effByReq.set(id, res[k]!) })
    }

    // Dịch vụ gia công (không nhập kho) — để biết bước tiếp theo của phiếu đã duyệt.
    const serviceIds = new Set<string>()
    const allItemIds = [...new Set([
      ...[...linesByReq.values()].flat().map((l) => l.item_id),
      ...[...effByReq.values()].flat().map((e) => e.item_id),
    ].filter((v): v is string => !!v))]
    for (let i = 0; i < allItemIds.length; i += 200) {
      const { data, error } = await supabaseAdmin.from("inventory_items").select("id").in("id", allItemIds.slice(i, i + 200)).eq("la_dich_vu", true)
      if (error) break
      for (const it of (data || []) as { id: string }[]) serviceIds.add(it.id)
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
      // Bước tiếp theo của phiếu ĐÃ DUYỆT: nhập kho / xác nhận gia công. SL hiệu lực; RPC lỗi thì
      // rơi về bản chụp sl_da_mua của dòng.
      const eff = effByReq.get(r.id)
      const remaining: { itemId: string | null; left: boolean }[] = eff
        ? eff.map((e) => ({ itemId: e.item_id, left: (Number(e.so_luong) || 0) - (Number(e.received) || 0) > 0 }))
        : (linesByReq.get(r.id) || []).map((l) => ({ itemId: l.item_id, left: (Number(l.so_luong) || 0) - (Number(l.sl_da_mua) || 0) > 0 }))
      const buying = isBuying(r)
      const needGoods = buying && remaining.some((x) => x.left && !(x.itemId && serviceIds.has(x.itemId)))
      const needService = buying && remaining.some((x) => x.left && !!x.itemId && serviceIds.has(x.itemId))
      const nextStep: "nhap_kho" | "gia_cong" | "ca_hai" | null = needGoods && needService ? "ca_hai" : needGoods ? "nhap_kho" : needService ? "gia_cong" : null
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
        nextStep,
        // Người đề nghị (hoặc admin) là người phải ghi nhận mua / xác nhận hoàn thành.
        myFulfillTurn: !!nextStep && (r.nguoi_de_nghi_id === actor.userId || actor.isAdmin),
        file_hien_tai: r.yeu_cau_ky_id ? fileByYc.get(r.yeu_cau_ky_id) || null : null,
        lines: (linesByReq.get(r.id) || []).sort((a, b) => a.sort_order - b.sort_order),
      }
    })

    // "Chờ tôi xử lý": phiếu cần hàng sớm nhất lên trước (phiếu cũ không có ngày cần → cuối).
    const filtered = scope === "todo"
      ? result
          .filter((r) => r.myTurn || (r.trang_thai === "tra_ve" && r.nguoi_de_nghi_id === actor.userId) || (!!r.nextStep && r.nguoi_de_nghi_id === actor.userId))
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
    // GĐ3: biên bản của từng dòng — thuộc nhà máy, chưa duyệt/huỷ. Liên kết đã lưu sẵn trên phiếu
    // (biên bản đã duyệt sau đó) được giữ nguyên.
    const keptRecordIds = new Set<string>()
    if (body.id) {
      const { data: oldLines } = await supabaseAdmin
        .from("purchase_request_lines")
        .select("maintenance_record_id")
        .eq("request_id", body.id)
      for (const l of (oldLines || []) as { maintenance_record_id: string | null }[]) {
        if (l.maintenance_record_id) keptRecordIds.add(l.maintenance_record_id)
      }
    }
    const newRecordIds = [...new Set(lines.map((l) => l.maintenance_record_id).filter((v): v is string => !!v && !keptRecordIds.has(v)))]
    if (newRecordIds.length) {
      const { data: recs } = await supabaseAdmin
        .from("maintenance_records")
        .select("id, trang_thai")
        .eq("factory_id", factoryId)
        .in("id", newRecordIds)
      const okRecs = new Set(
        ((recs || []) as { id: string; trang_thai: string | null }[])
          .filter((r) => r.trang_thai !== "da_duyet" && r.trang_thai !== "huy")
          .map((r) => r.id),
      )
      if (newRecordIds.some((id) => !okRecs.has(id))) errors.push("Có dòng gắn biên bản không hợp lệ (khác nhà máy hoặc đã duyệt/huỷ)")
    }
    const seen = new Set<string>()
    const today = getFactoryTodayISO()
    lines.forEach((l, i) => {
      const n = i + 1
      if (!l.item_id) errors.push(`Dòng ${n}: chưa chọn vật tư trong danh mục`)
      // Cùng vật tư được tách dòng khi mua cho các biên bản khác nhau (hoặc 1 dòng dự trữ).
      const dupKey = l.item_id ? `${l.item_id}:${l.maintenance_record_id || ""}` : null
      if (dupKey && seen.has(dupKey)) errors.push(`Dòng ${n}: vật tư bị lặp cho cùng biên bản — gộp số lượng vào 1 dòng`)
      if (dupKey) seen.add(dupKey)
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
        maintenance_record_id: l.maintenance_record_id || null,
        id: l.id || null,
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
      // Phiếu lập từ biên bản bảo trì (có purchase.create — đã kiểm ở trên):
      //  - nhóm phụ trách biên bản (người tạo + NV phụ trách) sửa nháp KHÔNG đổi người đề nghị — ai gửi ký
      //    mới thành người đề nghị (PATCH approvers);
      //  - người ngoài nhóm lưu = "Nhận xử lý" ⇒ thành người đề nghị.
      // Phiếu thường: chỉ người đề nghị.
      const notOwner = existing.nguoi_de_nghi_id !== actor.userId
      const isTeam = notOwner && (await isMaintenanceRecordTeam(existing.maintenance_record_id, actor.userId))
      const takeOver = notOwner && !isTeam && !!existing.maintenance_record_id
      if (notOwner && !isTeam && !takeOver) {
        return NextResponse.json({ error: "Chỉ người đề nghị được sửa phiếu" }, { status: 403 })
      }
      if (existing.loai === "dieu_chinh") {
        return NextResponse.json({ error: "Phiếu điều chỉnh không sửa được — huỷ rồi lập phiếu điều chỉnh mới" }, { status: 409 })
      }
      if (!isPurchaseEditable(existing.trang_thai as PurchaseStatus)) {
        return NextResponse.json({ error: "Phiếu đã gửi ký/đã duyệt, không sửa được" }, { status: 409 })
      }
      // Biên bản đang gắn TRƯỚC khi lưu (dòng bị bỏ/đổi biên bản ⇒ biên bản cũ rơi về giá tham chiếu).
      const { data: oldLinks } = await supabaseAdmin
        .from("purchase_request_lines")
        .select("maintenance_record_id")
        .eq("request_id", requestId)
        .not("maintenance_record_id", "is", null)
      // Header + dòng trong 1 giao dịch (RPC purchase_save_lines): giữ dòng theo id, lỗi thì không mất gì.
      const { error: saveErr } = await supabaseAdmin.rpc("purchase_save_lines", {
        p_factory_id: factoryId,
        p_request_id: requestId,
        p_header: {
          loai_tien: loaiTien,
          giam_doc_user_id: body.giamDocUserId || null,
          ke_toan_user_id: body.keToanUserId || null,
          ghi_chu: body.ghiChu?.trim() || null,
          bo_phan: boPhan,
          ngay_can_hang: ngayCanHang,
          tong_tien: tongTien,
          ...(takeOver ? { nguoi_de_nghi_id: actor.userId, nguoi_de_nghi_ten: myName } : {}),
        },
        p_lines: lineRows,
      })
      if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 400 })
      if (takeOver) {
        await insertPurchaseLog({ requestId, factoryId, userId: actor.userId, hanhDong: "nhan_xu_ly", noiDung: "Nhận xử lý phiếu lập từ biên bản bảo trì" })
      }
      // GĐ4: giá trên đề nghị là nguồn giá của biên bản gắn dòng ⇒ đồng bộ ngay (biên bản chưa gửi ký).
      await syncMaintenanceExtPricesSafe(factoryId, [
        ...((oldLinks || []) as { maintenance_record_id: string | null }[]).map((l) => l.maintenance_record_id),
        ...lineRows.map((l) => l.maintenance_record_id),
      ])
      return NextResponse.json({ id: requestId })
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

    const { error: lineErr } = await supabaseAdmin.rpc("purchase_save_lines", {
      p_factory_id: factoryId,
      p_request_id: requestId,
      p_header: null,
      p_lines: lineRows.map((l) => ({ ...l, id: null })),
    })
    if (lineErr) {
      // Số phiếu đã cấp — không xoá, chỉ huỷ để không còn phiếu rỗng.
      await supabaseAdmin
        .from("purchase_requests")
        .update({ trang_thai: "huy", ly_do_huy: "Lỗi lưu dòng vật tư", huy_luc: new Date().toISOString() })
        .eq("id", requestId)
      return NextResponse.json({ error: lineErr.message }, { status: 400 })
    }

    await syncMaintenanceExtPricesSafe(factoryId, lineRows.map((l) => l.maintenance_record_id))
    return NextResponse.json({ id: requestId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
