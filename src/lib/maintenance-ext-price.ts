// SERVER-ONLY (service role). Giá vật tư mua ngoài / gia công trên biên bản bảo trì (GĐ4):
// xác định giá theo đề nghị mua / giá tham chiếu và đồng bộ ngược vào biên bản CHƯA gửi ký.
// Chi tiết quy tắc: rule 14 mục "GĐ4 — giá vật tư mua ngoài".
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { buildUsdRates, convertWithRates } from "@/lib/currency"
import { pickReferencePrice } from "@/lib/purchase/types"
import { classifyRepairByUsd, normalizeRepairThreshold } from "@/lib/maintenance-threshold"
import type { ResolvedExtPrice } from "@/lib/maintenance-ext-price-shared"

const EXT_NGUON = ["ben_ngoai", "gia_cong"]
/** Trạng thái phiếu được coi là "đã mua/đã duyệt" cho giá tham chiếu — khớp loadPurchaseItemInsight. */
const APPROVED = ["da_duyet", "dang_mua", "hoan_tat"]
const CHUNK = 200

function chunk<T>(arr: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK))
  return out
}

type ReqJoin = { so: number; nam: number; ngay: string; loai: string; trang_thai: string; loai_tien: string | null; created_at: string }
type LineJoin = { item_id: string; don_gia: number | null; created_at: string; purchase_requests: ReqJoin | ReqJoin[] | null }
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] || null : v)

// select("*"): cột nguong_sua_chua_lon có thể chưa có (migration 20261104 chưa chạy) ⇒ không lỗi, dùng mặc định.
async function loadFactoryPricingConfig(factoryId: string): Promise<{ rates: Record<string, number>; thresholdUsd: number }> {
  const { data: fac } = await getSupabaseAdmin().from("factories").select("*").eq("id", factoryId).maybeSingle()
  const row = (fac || {}) as Record<string, unknown>
  return {
    rates: buildUsdRates({ vnd: Number(row.ty_gia_usd_vnd) || null, khr: Number(row.ty_gia_usd_khr) || null }),
    thresholdUsd: normalizeRepairThreshold(row.nguong_sua_chua_lon),
  }
}

async function loadFactoryRates(factoryId: string): Promise<Record<string, number>> {
  return (await loadFactoryPricingConfig(factoryId)).rates
}

/**
 * Giá cho từng vật tư: giá nhập thực tế (bình quân SL) của dòng gắn `recordId` → đề nghị GẦN NHẤT gắn
 * `recordId` → lần mua đã duyệt gần nhất → giá danh mục.
 * Vật tư không có giá nào ⇒ không có trong Map (nhập tay).
 */
export async function resolveExtPrices(
  factoryId: string,
  recordId: string | null,
  itemIds: string[],
): Promise<Map<string, ResolvedExtPrice>> {
  const supabase = getSupabaseAdmin()
  const ids = Array.from(new Set(itemIds.filter(Boolean)))
  const result = new Map<string, ResolvedExtPrice>()
  if (!ids.length) return result

  if (recordId) {
    const { data, error } = await supabase
      .from("purchase_request_lines")
      .select("id, item_id, don_gia, created_at, purchase_requests!inner(so, nam, ngay, loai, trang_thai, loai_tien, created_at)")
      .eq("factory_id", factoryId)
      .eq("maintenance_record_id", recordId)
      .in("item_id", ids)
    if (error) throw new Error(error.message)
    const linked = ((data || []) as unknown as (LineJoin & { id: string })[])
      .map((l) => ({ ...l, req: one(l.purchase_requests) }))
      .filter((l) => l.req && l.req.trang_thai !== "huy")

    // 0) Giá thực tế (A4): bình quân theo SL các lần nhập kho ĐÃ GHI SỔ + xác nhận gia công của dòng gốc
    //    gắn biên bản. Khác loại tiền ⇒ quy về tiền của lần gần nhất theo tỷ giá nhà máy.
    const rootLines = linked.filter((l) => l.req!.loai === "goc")
    const reqByLine = new Map(rootLines.map((l) => [l.id, l.req!]))
    if (rootLines.length) {
      type Actual = { itemId: string; qty: number; price: number; tien: string; at: string; lineId: string }
      const actual: Actual[] = []
      const lineIds = rootLines.map((l) => l.id)
      const [rc, sc] = await Promise.all([
        supabase
          .from("inventory_document_lines")
          .select("item_id, quantity, don_gia, loai_tien, purchase_request_line_id, created_at, inventory_documents!inner(status)")
          .in("purchase_request_line_id", lineIds)
          .eq("inventory_documents.status", "posted"),
        supabase
          .from("purchase_service_completions")
          .select("item_id, so_luong, don_gia, loai_tien, line_id, created_at")
          .in("line_id", lineIds),
      ])
      if (rc.error) throw new Error(rc.error.message)
      if (sc.error) throw new Error(sc.error.message)
      for (const r of (rc.data || []) as { item_id: string; quantity: number; don_gia: number | null; loai_tien: string | null; purchase_request_line_id: string; created_at: string }[]) {
        actual.push({ itemId: r.item_id, qty: Number(r.quantity) || 0, price: Number(r.don_gia) || 0, tien: r.loai_tien || "USD", at: r.created_at, lineId: r.purchase_request_line_id })
      }
      for (const r of (sc.data || []) as { item_id: string; so_luong: number; don_gia: number | null; loai_tien: string | null; line_id: string; created_at: string }[]) {
        actual.push({ itemId: r.item_id, qty: Number(r.so_luong) || 0, price: Number(r.don_gia) || 0, tien: r.loai_tien || "USD", at: r.created_at, lineId: r.line_id })
      }
      const valid = actual.filter((a) => ids.includes(a.itemId) && a.qty > 0 && a.price > 0)
      if (valid.length) {
        const rates = await loadFactoryRates(factoryId)
        const byItem = new Map<string, Actual[]>()
        for (const a of valid) byItem.set(a.itemId, [...(byItem.get(a.itemId) || []), a])
        for (const [itemId, rows] of byItem) {
          const latest = [...rows].sort((a, b) => b.at.localeCompare(a.at))[0]
          const qty = rows.reduce((s, a) => s + a.qty, 0)
          const amount = rows.reduce((s, a) => s + convertWithRates(a.qty * a.price, a.tien, latest.tien, rates), 0)
          const req = reqByLine.get(latest.lineId)
          result.set(itemId, {
            value: Math.round((amount / qty) * 10000) / 10000,
            loaiTien: latest.tien,
            source: "thuc_te",
            so: req?.so, nam: req?.nam, ngay: req?.ngay,
            soLan: rows.length,
          })
        }
      }
    }

    // 1) Đề nghị gắn biên bản: mọi trạng thái trừ Huỷ; phiếu điều chỉnh chỉ khi đã duyệt xong.
    const best = new Map<string, { key: string; price: ResolvedExtPrice }>()
    for (const l of linked) {
      const r = l.req!
      if (result.has(l.item_id) || !(Number(l.don_gia) > 0)) continue
      if (r.loai === "dieu_chinh" && r.trang_thai !== "hoan_tat") continue
      const key = `${r.created_at}|${l.created_at}`
      const cur = best.get(l.item_id)
      if (cur && cur.key >= key) continue
      best.set(l.item_id, {
        key,
        price: { value: Number(l.don_gia), loaiTien: r.loai_tien || "USD", source: "de_nghi", so: r.so, nam: r.nam, ngay: r.ngay },
      })
    }
    for (const [itemId, b] of best) result.set(itemId, b.price)
  }

  const rest = ids.filter((id) => !result.has(id))
  if (!rest.length) return result

  // 2) + 3) Giá tham chiếu: lần mua đã duyệt gần nhất → giá danh mục (cùng quy tắc form đề nghị).
  const recentByItem = new Map<string, { ngay: string; so: number; nam: number; donGia: number; loaiTien: string }[]>()
  const catalog = new Map<string, { don_gia: number | null; loai_tien: string | null }>()
  for (const part of chunk(rest)) {
    const lines = await fetchAllPaginated<LineJoin>((from, to) =>
      supabase
        .from("purchase_request_lines")
        .select("item_id, don_gia, created_at, purchase_requests!inner(so, nam, ngay, loai, trang_thai, loai_tien, created_at)")
        .eq("factory_id", factoryId)
        .in("item_id", part)
        .in("purchase_requests.trang_thai", APPROVED)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: LineJoin[] | null; error: unknown }>,
    )
    for (const l of lines) {
      const r = one(l.purchase_requests)
      if (!r) continue
      const arr = recentByItem.get(l.item_id) || []
      arr.push({ ngay: r.ngay, so: r.so, nam: r.nam, donGia: Number(l.don_gia), loaiTien: r.loai_tien || "USD" })
      recentByItem.set(l.item_id, arr)
    }
    const { data: items, error } = await supabase
      .from("inventory_items")
      .select("id, don_gia, loai_tien")
      .eq("factory_id", factoryId)
      .in("id", part)
    if (error) throw new Error(error.message)
    for (const it of (items || []) as { id: string; don_gia: number | null; loai_tien: string | null }[]) catalog.set(it.id, it)
  }
  for (const itemId of rest) {
    const recent = (recentByItem.get(itemId) || []).sort((a, b) => b.ngay.localeCompare(a.ngay))
    const ref = pickReferencePrice(recent, catalog.get(itemId))
    if (ref) result.set(itemId, { value: ref.value, loaiTien: ref.loaiTien, source: ref.source, so: ref.so, nam: ref.nam, ngay: ref.ngay })
  }
  return result
}

export type ExtPriceChange = { recordId: string; itemId: string; tenVatTu: string; from: number; fromTien: string; to: number; toTien: string }

/**
 * Đồng bộ giá vật tư mua ngoài / gia công vào các biên bản "Chờ duyệt" CHƯA gửi ký (không có yêu cầu ký
 * đang luân chuyển / hoàn tất): cập nhật đơn giá, rồi tính lại Chi phí ước tính + Lớn/Nhỏ của dòng thiết
 * bị y hệt công thức trang biên bản. Biên bản đã gửi ký / đã duyệt KHÔNG bao giờ bị đụng (PDF bất biến).
 */
export async function syncMaintenanceExtPrices(factoryId: string, recordIds: (string | null | undefined)[]): Promise<ExtPriceChange[]> {
  const supabase = getSupabaseAdmin()
  const ids = Array.from(new Set(recordIds.filter((v): v is string => !!v)))
  if (!ids.length) return []

  const { data: recs, error: recErr } = await supabase
    .from("maintenance_records")
    .select("id, trang_thai, hang_muc")
    .eq("factory_id", factoryId)
    .in("id", ids)
  if (recErr) throw new Error(recErr.message)
  const open = ((recs || []) as { id: string; trang_thai: string; hang_muc: string }[]).filter((r) => r.trang_thai === "cho_duyet")
  if (!open.length) return []

  const { data: locks, error: lockErr } = await supabase
    .from("yeu_cau_ky")
    .select("ban_ghi_id")
    .eq("factory_id", factoryId)
    .eq("modun", "maintenance")
    .in("ban_ghi_id", open.map((r) => r.id))
    .in("trang_thai", ["dang_luan_chuyen", "hoan_tat"])
  if (lockErr) throw new Error(lockErr.message)
  const locked = new Set(((locks || []) as { ban_ghi_id: string | null }[]).map((l) => l.ban_ghi_id))
  const eligible = open.filter((r) => !locked.has(r.id))
  if (!eligible.length) return []

  const { rates, thresholdUsd } = await loadFactoryPricingConfig(factoryId)

  const changes: ExtPriceChange[] = []
  for (const rec of eligible) {
    const isRepair = rec.hang_muc === "Sửa chữa"
    const { data: mats, error: matErr } = await supabase
      .from("maintenance_materials")
      .select("id, line_id, nguon, inventory_item_id, ten_vat_tu, so_luong, don_gia, loai_tien")
      .eq("record_id", rec.id)
    if (matErr) throw new Error(matErr.message)
    type Mat = { id: string; line_id: string; nguon: string; inventory_item_id: string | null; ten_vat_tu: string | null; so_luong: number | null; don_gia: number | null; loai_tien: string | null }
    const rows = (mats || []) as Mat[]
    const ext = rows.filter((m) => EXT_NGUON.includes(m.nguon) && m.inventory_item_id)
    if (!ext.length && !isRepair) continue
    const prices = ext.length
      ? await resolveExtPrices(factoryId, rec.id, ext.map((m) => m.inventory_item_id as string))
      : new Map<string, ResolvedExtPrice>()

    const changedLines = new Set<string>()
    for (const m of ext) {
      const p = prices.get(m.inventory_item_id as string)
      if (!p) continue
      const curTien = m.loai_tien || "USD"
      if (Number(m.don_gia) === p.value && curTien === p.loaiTien) continue
      const { error } = await supabase.from("maintenance_materials").update({ don_gia: p.value, loai_tien: p.loaiTien }).eq("id", m.id)
      if (error) throw new Error(error.message)
      changes.push({ recordId: rec.id, itemId: m.inventory_item_id as string, tenVatTu: m.ten_vat_tu || "", from: Number(m.don_gia) || 0, fromTien: curTien, to: p.value, toTien: p.loaiTien })
      m.don_gia = p.value
      m.loai_tien = p.loaiTien
      changedLines.add(m.line_id)
    }

    // Dòng cần xét: dòng vừa đổi giá (tính lại chi phí) + mọi dòng của biên bản Sửa chữa (Lớn/Nhỏ luôn theo
    // ngưỡng nhà máy, không ai chọn tay — kể cả khi giá không đổi, để sửa dữ liệu chọn tay cũ trước khi ký).
    let lineIds = Array.from(changedLines)
    if (isRepair) {
      const { data: allLines, error: lineErr } = await supabase.from("maintenance_record_lines").select("id").eq("record_id", rec.id)
      if (lineErr) throw new Error(lineErr.message)
      lineIds = Array.from(new Set([...lineIds, ...((allLines || []) as { id: string }[]).map((l) => l.id)]))
    }

    for (const lineId of lineIds) {
      const { data: line } = await supabase.from("maintenance_record_lines").select("loai_tien, chi_phi_dk, loai_sua_chua").eq("id", lineId).maybeSingle()
      if (!line) continue
      const lineTien = (line.loai_tien as string) || "USD"
      // Mirror computeLineChiPhiFromMaterials (records/[id]/page.tsx): bỏ dòng SL/giá ≤ 0, quy USD rồi về tiền dòng.
      let totalUsd = 0
      for (const m of rows.filter((x) => x.line_id === lineId)) {
        const sl = Number(m.so_luong) || 0
        const dg = Number(m.don_gia) || 0
        if (sl <= 0 || dg <= 0) continue
        totalUsd += convertWithRates(sl * dg, m.loai_tien || "USD", "USD", rates)
      }
      const patch: Record<string, unknown> = {}
      if (changedLines.has(lineId)) patch.chi_phi_dk = convertWithRates(totalUsd, "USD", lineTien, rates)
      if (isRepair) {
        // Mirror suggestLoaiSuaChua: theo chi phí đã lưu của dòng (= tổng vật tư) khi giá không đổi.
        const usd = changedLines.has(lineId) ? totalUsd : convertWithRates(Number(line.chi_phi_dk) || 0, lineTien, "USD", rates)
        const loai = classifyRepairByUsd(usd, thresholdUsd)
        if (line.loai_sua_chua !== loai) patch.loai_sua_chua = loai
      }
      if (!Object.keys(patch).length) continue
      const { error } = await supabase.from("maintenance_record_lines").update(patch).eq("id", lineId)
      if (error) throw new Error(error.message)
    }
  }
  return changes
}

/** Bản "không chặn": dùng sau thao tác của module Đề nghị mua — lỗi chỉ ghi log, lần gửi ký biên bản sẽ đồng bộ lại. */
export async function syncMaintenanceExtPricesSafe(factoryId: string, recordIds: (string | null | undefined)[]): Promise<void> {
  try {
    await syncMaintenanceExtPrices(factoryId, recordIds)
  } catch (err) {
    console.warn("[syncMaintenanceExtPrices]", err instanceof Error ? err.message : err)
  }
}
