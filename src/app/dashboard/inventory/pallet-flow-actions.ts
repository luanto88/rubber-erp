"use server"

// Luồng pallet theo kiện thành phẩm (2026-10-27) — CHỈ TÍNH, không ghi phiếu kho.
//  - Xuất lưu: mỗi kiện sản xuất lấy 1 bộ pallet trống ra chứa thành phẩm (ngày giao dịch đầu của kiện).
//  - Kiện rời kho thành phẩm khi tổng bành đã gán đơn xuất ≥ bành sản xuất; đơn hoàn tất kiện quyết định
//    hình thức theo export_pallet_types: rời ⇒ pallet trả về; kiện ⇒ mất pallet; bọc màng ⇒ pallet trả
//    về + mất các thành phần khai báo (mỗi kiện 1 cái).
//  - Đang lưu = kiện còn tồn (kể cả đã xuất một phần bành).
//  - Pallet dùng theo TỔNG, không theo kho (người dùng chốt 2026-10-27): Tổng sở hữu = sổ sách mọi kho −
//    mất do xuất khẩu từ mốc (phiếu nhập đầu tiên); Trống = Tổng sở hữu − Đang lưu.
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { assertProductAccess } from "@/app/dashboard/product/confirm/report-access"
import { applyTxToKienPallet, KIEN_KEYS, kienPalletOf, type KienKey, type KienPallet } from "@/lib/lot-kien-boc"
import {
  DEFAULT_EXPORT_PALLET_TYPES,
  normalizePalletTypeName,
  PALLET_COMPONENT_CODES,
  PALLET_COMPONENT_ITEMS,
  palletComponents,
  type ExportPalletForm,
  type PalletComponent,
} from "@/lib/pallet-usage"

export type PalletFlowCounts = {
  dangLuu: number
  xuatLuu: number
  traVe: number
  matXuatKhau: number
  /** Tồn sổ sách: tổng on_hand của mọi mã thuộc nhóm, MỌI kho (pallet dùng theo tổng, không theo kho). */
  soSach: number
  /** Ngày phiếu nhập đầu tiên của nhóm — coi là mốc kiểm kê. */
  mocNgay: string | null
  /** Pallet mất do xuất khẩu kể từ mốc (không phụ thuộc kỳ đang xem). */
  matTuMoc: number
}

export type PalletFlowResult =
  | {
      success: true
      byGroup: Record<string, PalletFlowCounts>
      /** Kiện còn tồn nhưng loại pallet chưa quy đổi được (hoặc chưa ghi). */
      unknownKien: number
      unknownLabels: string[]
      /** Loại pallet xuất trên đơn không có trong Cài đặt (tạm tính như xuất khẩu dạng kiện). */
      unknownExportTypes: string[]
    }
  | { success: false; error: string }

const emptyCounts = (): PalletFlowCounts => ({
  dangLuu: 0,
  xuatLuu: 0,
  traVe: 0,
  matXuatKhau: 0,
  soSach: 0,
  mocNgay: null,
  matTuMoc: 0,
})

export async function loadPalletFlow(
  factoryId: string,
  accessToken: string | null,
  fromDate: string,
  toDate: string,
): Promise<PalletFlowResult> {
  try {
    await assertProductAccess(accessToken, factoryId, ["inventory.view"], "xem tồn pallet")
    const supabase = getSupabaseAdmin()
    const inPeriod = (d: string | null) => {
      if (!d || (!fromDate && !toDate)) return false
      const day = d.slice(0, 10)
      return (!fromDate || day >= fromDate) && (!toDate || day <= toDate)
    }

    // 1. Loại pallet xuất (bảng chưa có ⇒ danh sách mặc định)
    const typeMap = new Map<string, { form: ExportPalletForm; lose: PalletComponent[] }>()
    {
      const { data, error } = await supabase
        .from("export_pallet_types")
        .select("ten, hinh_thuc, mat_thanh_phan")
        .eq("factory_id", factoryId)
      const rows = error ? DEFAULT_EXPORT_PALLET_TYPES : (data || [])
      for (const r of rows as { ten: string; hinh_thuc: ExportPalletForm; mat_thanh_phan: string[] | null }[]) {
        typeMap.set(normalizePalletTypeName(r.ten), {
          form: r.hinh_thuc,
          lose: (r.mat_thanh_phan || []).filter((c): c is PalletComponent => PALLET_COMPONENT_CODES.has(c)),
        })
      }
    }

    // 2. Lô + giao dịch theo kiện
    type LotRow = { id: string; ma_lo: string | null; pallet: string[] | null }
    const lots: LotRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("lots")
        .select("id, ma_lo, pallet")
        .eq("factory_id", factoryId)
        .order("id", { ascending: true })
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      lots.push(...((data || []) as LotRow[]))
      if (!data || data.length < 1000) break
    }
    const lotSnap = new Map(lots.map((l) => [l.id, l.pallet]))
    const maToId = new Map<string, string>()
    for (const l of lots) if (l.ma_lo) maToId.set(l.ma_lo.trim().toLowerCase(), l.id)

    const produced = new Map<string, number>() // `${lotId}:${k}`
    const firstDay = new Map<string, string>()
    const kienPallet = new Map<string, KienPallet>()
    const ids = lots.map((l) => l.id)
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("lot_transactions")
          .select("id, lot_id, kien_a, kien_b, kien_c, kien_d, pallet, ngay_nhap, created_at")
          .in("lot_id", chunk)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + 999)
        if (error) throw new Error(error.message)
        for (const t of data || []) {
          for (const k of KIEN_KEYS) {
            const qty = Number(t[`kien_${k}`]) || 0
            if (qty <= 0) continue
            const key = `${t.lot_id}:${k}`
            produced.set(key, (produced.get(key) || 0) + qty)
            const day = String(t.ngay_nhap || t.created_at || "").slice(0, 10)
            const prev = firstDay.get(key)
            if (day && (!prev || day < prev)) firstDay.set(key, day)
          }
          applyTxToKienPallet(kienPallet, t, lotSnap.get(t.lot_id))
        }
        if (!data || data.length < 1000) break
      }
    }

    // 3. Đơn xuất theo ngày tăng dần — đơn làm tổng gán đạt bành sản xuất là đơn "đưa kiện đi"
    type OrderRow = { id: string; ngay: string | null; loai_pallet: string | null; assignments: unknown }
    const orders: OrderRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("export_orders")
        .select("id, ngay, loai_pallet, assignments")
        .eq("factory_id", factoryId)
        .order("id", { ascending: true })
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      orders.push(...((data || []) as OrderRow[]))
      if (!data || data.length < 1000) break
    }
    orders.sort((a, b) => String(a.ngay || "").localeCompare(String(b.ngay || "")))

    const assigned = new Map<string, number>()
    const exitOf = new Map<string, { day: string | null; loaiPallet: string }>()
    for (const o of orders) {
      const list = Array.isArray(o.assignments) ? (o.assignments as Record<string, unknown>[]) : []
      for (const a of list) {
        const byId = typeof a.lot_id === "string" && lotSnap.has(a.lot_id) ? (a.lot_id as string) : null
        const byMa = typeof a.ma_lo === "string" ? maToId.get(a.ma_lo.trim().toLowerCase()) : undefined
        const lotId = byId || byMa
        if (!lotId) continue
        for (const k of KIEN_KEYS) {
          const qty = Number(a[`kien_${k}`]) || 0
          if (qty <= 0) continue
          const key = `${lotId}:${k}`
          const total = (assigned.get(key) || 0) + qty
          assigned.set(key, total)
          const prod = produced.get(key) || 0
          if (prod > 0 && total >= prod && !exitOf.has(key)) {
            exitOf.set(key, { day: o.ngay, loaiPallet: String(o.loai_pallet || "").trim() })
          }
        }
      }
    }

    // 4. Tồn sổ sách (mọi kho) + mốc kiểm kê (phiếu nhập đầu tiên) theo nhóm mã pallet
    const byGroup: Record<string, PalletFlowCounts> = {}
    const groupOf = (g: string) => (byGroup[g] = byGroup[g] || emptyCounts())
    {
      const codeToGroup = new Map<string, string>()
      for (const { groupCode, itemCodes } of Object.values(PALLET_COMPONENT_ITEMS)) {
        for (const code of itemCodes) codeToGroup.set(code.trim().toUpperCase(), groupCode)
      }
      const { data: itemRows, error: itemErr } = await supabase
        .from("inventory_items")
        .select("id, code")
        .eq("factory_id", factoryId)
      if (itemErr) throw new Error(itemErr.message)
      const itemGroup = new Map<string, string>()
      for (const it of (itemRows || []) as { id: string; code: string | null }[]) {
        const g = codeToGroup.get(String(it.code || "").trim().toUpperCase())
        if (g) itemGroup.set(it.id, g)
      }
      const itemIds = [...itemGroup.keys()]
      if (itemIds.length > 0) {
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from("inventory_stock_balances")
            .select("id, item_id, on_hand")
            .eq("factory_id", factoryId)
            .in("item_id", itemIds)
            .order("id", { ascending: true })
            .range(from, from + 999)
          if (error) throw new Error(error.message)
          for (const b of (data || []) as { item_id: string; on_hand: number | null }[]) {
            const g = itemGroup.get(b.item_id)
            if (g) groupOf(g).soSach += Number(b.on_hand) || 0
          }
          if (!data || data.length < 1000) break
        }
        for (const id of itemIds) {
          const { data, error } = await supabase
            .from("inventory_stock_movements")
            .select("movement_date")
            .eq("factory_id", factoryId)
            .eq("item_id", id)
            .eq("movement_type", "import")
            .gt("quantity_in", 0)
            .order("movement_date", { ascending: true })
            .limit(1)
          if (error) throw new Error(error.message)
          const day = data?.[0]?.movement_date ? String(data[0].movement_date).slice(0, 10) : null
          const c = groupOf(itemGroup.get(id)!)
          if (day && (!c.mocNgay || day < c.mocNgay)) c.mocNgay = day
        }
      }
    }

    // 5. Cộng theo nhóm mã pallet
    type CountField = "dangLuu" | "xuatLuu" | "traVe" | "matXuatKhau" | "matTuMoc"
    const bump = (c: PalletComponent, field: CountField, n = 1) => {
      groupOf(PALLET_COMPONENT_ITEMS[c].groupCode)[field] += n
    }
    const lose = (c: PalletComponent, exitDay: string | null, counted: boolean) => {
      if (counted) bump(c, "matXuatKhau")
      const moc = byGroup[PALLET_COMPONENT_ITEMS[c].groupCode]?.mocNgay
      if (moc && exitDay && exitDay.slice(0, 10) >= moc) bump(c, "matTuMoc")
    }
    let unknownKien = 0
    const unknownLabels = new Set<string>()
    const unknownExportTypes = new Set<string>()

    for (const [key, prod] of produced) {
      if (prod <= 0) continue
      const [lotId, k] = key.split(":") as [string, KienKey]
      const pallet = kienPalletOf(kienPallet, lotId, k, lotSnap.get(lotId))
      const comps: PalletComponent[] = []
      let unknown = pallet.length === 0
      for (const p of pallet) {
        const c = palletComponents(p)
        if (c) comps.push(...c)
        else {
          unknown = true
          unknownLabels.add(p)
        }
      }
      if (pallet.length === 0) unknownLabels.add("Chưa ghi pallet")

      const exit = exitOf.get(key)
      if (!exit) {
        if (unknown) unknownKien += 1
        for (const c of comps) bump(c, "dangLuu")
      }
      if (inPeriod(firstDay.get(key) || null)) for (const c of comps) bump(c, "xuatLuu")
      if (exit) {
        const counted = inPeriod(exit.day)
        const type = typeMap.get(normalizePalletTypeName(exit.loaiPallet))
        if (!type && exit.loaiPallet) unknownExportTypes.add(exit.loaiPallet)
        const form: ExportPalletForm = type?.form || "kien"
        if (form === "kien") for (const c of comps) lose(c, exit.day, counted)
        else {
          if (counted) for (const c of comps) bump(c, "traVe")
          if (form === "boc_mang") for (const c of type?.lose || []) lose(c, exit.day, counted)
        }
      }
    }

    return {
      success: true,
      byGroup,
      unknownKien,
      unknownLabels: [...unknownLabels],
      unknownExportTypes: [...unknownExportTypes],
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
