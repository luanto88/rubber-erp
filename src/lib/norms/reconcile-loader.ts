// Định mức KTKT GĐ3 — gom số liệu nguồn cho đối soát kỳ (trình duyệt, supabase anon theo RLS). Rule 30.
// Mọi bảng lớn phân trang .range() + .order() ổn định; .in() chia lô 200 id.

import { supabase } from "@/lib/supabase"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { addDaysISO } from "@/lib/date-utils"
import { loadDispatchEntriesWithResolvedRows, toISODate } from "@/lib/dispatch-entry-rows"
import { makeNguonResolver, type LotSuffixRow } from "@/lib/lot-source"
import { dayChuyenForCsr } from "@/lib/product-lot-config"
import { loadGradeConfig } from "@/lib/product-grade-client"
import { loadNormItems, loadNormMeterReadings, loadNormMeters, loadNormVersionDetail, loadNormVersions } from "./client"
import { loadMovementDocumentInfo, movementNoteText } from "@/app/dashboard/inventory/_components/inventory-data"
import {
  computeReconciliation,
  type ExportMovement,
  type KmDriver,
  type NlDriver,
  type OtherExport,
  type ReconcileInput,
  type ReconcileResult,
  type ThayBocDriver,
  type TpDriver,
} from "./compute"
import type { NormDataset } from "./resolve"
import { nguonCodeFromLabel, type NormItem, type NormMeter, type NormMeterReading } from "./types"

/** 5 loại mủ của Sản lượng (mirror OUTPUT_MATERIALS ở output-types.ts). Mủ nước ⇒ dây chuyền Mủ nước. */
export const NL_MATERIALS = [
  { key: "mn", label: "Mủ nước", tuoi: "mn_tuoi", kho: "mn_kho", dayChuyen: "Mủ nước" },
  { key: "ct", label: "Mủ chén", tuoi: "ct_tuoi", kho: "ct_kho", dayChuyen: "Mủ tạp" },
  { key: "dct", label: "Mủ đông chén", tuoi: "dct_tuoi", kho: "dct_kho", dayChuyen: "Mủ tạp" },
  { key: "dkt", label: "Mủ đông khối", tuoi: "dkt_tuoi", kho: "dkt_kho", dayChuyen: "Mủ tạp" },
  { key: "dt", label: "Mủ dây", tuoi: "dt_tuoi", kho: "dt_kho", dayChuyen: "Mủ tạp" },
] as const

/** Giá trị lọc "không có ký hiệu KT". */
export const NO_NOTE_KEY = "__none__"

export type ReconcileFilters = {
  from: string
  to: string
  /** key của NL_MATERIALS; rỗng = mọi loại. */
  materials: string[]
  /** Ký hiệu KT (ghi_chu Sản lượng); rỗng = mọi ký hiệu; NO_NOTE_KEY = dòng không ký hiệu. */
  notes: string[]
  meterFrom: string | null
  meterTo: string | null
  /** Dùng cả khung Nháp (xem thử khi chưa áp dụng). */
  useDraft: boolean
}

export type MovementDisplay = { documentId: string; documentCode: string; note: string }

export type ReconcileBundle = {
  input: ReconcileInput
  result: ReconcileResult
  /** Số phiếu + ghi chú của từng dòng xuất (theo movement id). */
  movementInfo: Record<string, MovementDisplay>
  draftUsed: boolean
  /** Đã cấu hình nhóm vật tư báo cáo chưa (chưa ⇒ dùng nhóm của mã đã gắn). */
  categoriesConfigured: boolean
}

function isMissingTable(e: unknown): boolean {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e)
  return /does not exist|schema cache|tech_norm_(export_exclusions|report_categories)/i.test(msg) && !/permission/i.test(msg)
}

async function chunked<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 200) out.push(...(await fn(ids.slice(i, i + 200))))
  return out
}

async function loadDataset(factoryId: string, from: string, to: string, useDraft: boolean): Promise<{ data: NormDataset; draftUsed: boolean }> {
  const all = await loadNormVersions(factoryId)
  const overlap = (v: { effective_from: string; effective_to: string | null }) => v.effective_from <= to && (v.effective_to === null || v.effective_to >= from)
  const real = all.filter((v) => v.status !== "draft" && overlap(v))
  let chosen = real
  let draftUsed = false
  if (useDraft && !real.length) {
    chosen = all.filter((v) => v.status === "draft" && overlap(v)).slice(0, 1).map((v) => ({ ...v, status: "active" as const }))
    draftUsed = chosen.length > 0
  }
  const details = await Promise.all(chosen.map((v) => loadNormVersionDetail(factoryId, v.id)))
  return {
    data: {
      versions: chosen,
      versionItems: details.flatMap((d) => d.versionItems),
      rows: details.flatMap((d) => d.rows),
      values: details.flatMap((d) => d.values),
    },
    draftUsed,
  }
}

type LotLite = { id: string; ma_lo: string | null; loai_csr: string | null; suffix: string | null; loai_banh: number | null; tong_kg: number | null; ngay_ht: string | null; ngay_sx: string | null }

export async function loadReconcile(factoryId: string, f: ReconcileFilters): Promise<ReconcileBundle> {
  const [{ data, draftUsed }, items, grade, suffixRes, meters, readings] = await Promise.all([
    loadDataset(factoryId, f.from, f.to, f.useDraft),
    loadNormItems(factoryId),
    loadGradeConfig(factoryId),
    supabase.from("suffixes").select("code,nguon,name").eq("factory_id", factoryId),
    loadNormMeters(factoryId),
    loadNormMeterReadings(factoryId),
  ])
  if (suffixRes.error) throw suffixRes.error
  const resolveNguon = makeNguonResolver((suffixRes.data || []) as LotSuffixRow[])
  const nguonOf = (suffix: string | null | undefined) => nguonCodeFromLabel(resolveNguon(suffix))

  // ── Thành phẩm nhập trong kỳ (giao dịch) ──
  type TxLot = { loai_csr: string | null; suffix: string | null }
  type TxRow = { id: string; lot_id: string; ngay_nhap: string; so_kg: number | null; lots: TxLot | TxLot[] | null }
  type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>
  const txRows = await fetchAllPaginated<TxRow>((a, b) =>
    supabase
      .from("lot_transactions")
      .select("id,lot_id,ngay_nhap,so_kg,lots!inner(loai_csr,suffix,factory_id)")
      .eq("lots.factory_id", factoryId)
      .gte("ngay_nhap", f.from)
      .lte("ngay_nhap", f.to)
      .order("ngay_nhap")
      .order("id")
      .range(a, b) as unknown as Page<TxRow>,
  )
  const tp: TpDriver[] = []
  for (const r of txRows) {
    const lot = Array.isArray(r.lots) ? r.lots[0] : r.lots
    const csr = (lot?.loai_csr || "").trim()
    const kg = Number(r.so_kg) || 0
    if (!csr || kg <= 0) continue
    tp.push({ ngay: r.ngay_nhap.slice(0, 10), dayChuyen: dayChuyenForCsr(csr, grade), csr, nguon: nguonOf(lot?.suffix), kg })
  }
  // Lô mồ côi (không giao dịch): lots.tong_kg tại ngày hoàn thành / ngày SX (mirror F12 + loadStorageLots).
  const candLots = await fetchAllPaginated<LotLite>((a, b) =>
    supabase
      .from("lots")
      .select("id,ma_lo,loai_csr,suffix,loai_banh,tong_kg,ngay_ht,ngay_sx")
      .eq("factory_id", factoryId)
      .or(`and(ngay_ht.gte.${f.from},ngay_ht.lte.${f.to}),and(ngay_ht.is.null,ngay_sx.gte.${f.from},ngay_sx.lte.${f.to})`)
      .gt("tong_kg", 0)
      .order("id")
      .range(a, b),
  )
  if (candLots.length) {
    const withTx = new Set(
      (
        await chunked(candLots.map((l) => l.id), async (ids) => {
          const { data: rows, error } = await supabase.from("lot_transactions").select("lot_id").in("lot_id", ids)
          if (error) throw error
          return (rows || []) as { lot_id: string }[]
        })
      ).map((r) => r.lot_id),
    )
    for (const l of candLots) {
      if (withTx.has(l.id)) continue
      const csr = (l.loai_csr || "").trim()
      const d = (l.ngay_ht || l.ngay_sx || "").slice(0, 10)
      if (!csr || !d) continue
      tp.push({ ngay: d, dayChuyen: dayChuyenForCsr(csr, grade), csr, nguon: nguonOf(l.suffix), kg: Number(l.tong_kg) || 0 })
    }
  }

  // ── Thay bọc trong kỳ ──
  type SkRow = { id: string; ngay: string | null; lots: Array<{ id?: string; converted?: Record<string, number> | null }> | null; kien_changes?: Array<{ lot_id?: string; so_banh?: number | string | null }> | null }
  let skRows: SkRow[] = []
  try {
    skRows = await fetchAllPaginated<SkRow>((a, b) =>
      supabase
        .from("sk_history")
        .select("id,ngay,lots,kien_changes")
        .eq("factory_id", factoryId)
        .eq("loai", "Thay bọc")
        .gte("ngay", f.from)
        .lte("ngay", f.to)
        .order("id")
        .range(a, b),
    )
  } catch {
    skRows = []
  }
  const balesByLotDay = new Map<string, { ngay: string; lotId: string; bales: number }>()
  for (const s of skRows) {
    const ngay = (s.ngay || "").slice(0, 10)
    if (!ngay) continue
    const add = (lotId: string | undefined, bales: number) => {
      if (!lotId || !(bales > 0)) return
      const k = `${lotId}|${ngay}`
      const cur = balesByLotDay.get(k) || { ngay, lotId, bales: 0 }
      cur.bales += bales
      balesByLotDay.set(k, cur)
    }
    if (Array.isArray(s.kien_changes) && s.kien_changes.length) for (const c of s.kien_changes) add(c.lot_id, Number(c.so_banh) || 0)
    else for (const l of s.lots || []) add(l.id, Object.values(l.converted || {}).reduce((x, y) => x + (Number(y) || 0), 0))
  }
  const thayBoc: ThayBocDriver[] = []
  const skLotIds = [...new Set([...balesByLotDay.values()].map((x) => x.lotId))]
  if (skLotIds.length) {
    const lots = await chunked(skLotIds, async (ids) => {
      const { data: rows, error } = await supabase.from("lots").select("id,loai_csr,suffix,loai_banh").eq("factory_id", factoryId).in("id", ids)
      if (error) throw error
      return (rows || []) as Pick<LotLite, "id" | "loai_csr" | "suffix" | "loai_banh">[]
    })
    const lotById = new Map(lots.map((l) => [l.id, l]))
    for (const x of balesByLotDay.values()) {
      const l = lotById.get(x.lotId)
      const csr = (l?.loai_csr || "").trim()
      if (!l || !csr) continue
      thayBoc.push({ ngay: x.ngay, dayChuyen: dayChuyenForCsr(csr, grade), csr, nguon: nguonOf(l.suffix), kg: x.bales * (Number(l.loai_banh) || 0) })
    }
  }

  // ── Nguyên liệu (Sản lượng) ──
  type PrRow = Record<string, unknown> & { id: string; ngay: string; ma_nguon: string | null; ghi_chu: string | null }
  const prCols = ["id", "ngay", "ma_nguon", "ghi_chu", ...NL_MATERIALS.flatMap((m) => [m.tuoi, m.kho])].join(",")
  const prRows = await fetchAllPaginated<PrRow>((a, b) =>
    supabase.from("production_records").select(prCols).eq("factory_id", factoryId).gte("ngay", f.from).lte("ngay", f.to).order("ngay").order("id").range(a, b) as unknown as Page<PrRow>,
  )
  const mats = NL_MATERIALS.filter((m) => !f.materials.length || f.materials.includes(m.key))
  const noteSet = new Set(f.notes.map((n) => n.trim().toLowerCase()))
  const nl: NlDriver[] = []
  for (const r of prRows) {
    const note = (r.ghi_chu || "").trim()
    if (noteSet.size) {
      const key = note ? note.toLowerCase() : NO_NOTE_KEY
      if (!noteSet.has(key)) continue
    }
    const nguon = nguonOf(r.ma_nguon)
    for (const m of mats) {
      const kgTuoi = Number(r[m.tuoi]) || 0
      const kgKho = Number(r[m.kho]) || 0
      if (!kgTuoi && !kgKho) continue
      nl.push({ ngay: String(r.ngay).slice(0, 10), dayChuyen: m.dayChuyen, nguon, kgKho, kgTuoi })
    }
  }

  // ── Km (Điều xe, nguồn thật = dispatch_entries.rows) ──
  const [{ data: vehicles, error: vErr }, entries] = await Promise.all([
    supabase.from("dispatch_vehicles").select("code,vehicle_type").eq("factory_id", factoryId),
    loadDispatchEntriesWithResolvedRows(supabase, { factoryId, fromDate: f.from, toDate: f.to }),
  ])
  if (vErr) throw vErr
  const typeOf = new Map(((vehicles || []) as { code: string; vehicle_type: string | null }[]).map((v) => [v.code.trim().toUpperCase(), (v.vehicle_type || "").trim()]))
  const km: KmDriver[] = []
  for (const e of entries) {
    const ngay = toISODate(e.ngay)
    for (const row of e.rows) {
      const k = Number((row as { so_km?: unknown }).so_km) || 0
      const soXe = String((row as { so_xe?: unknown }).so_xe || "").trim().toUpperCase()
      if (k <= 0 || !soXe) continue
      km.push({ ngay, vehicleType: typeOf.get(soXe) || "(chưa phân loại)", km: k })
    }
  }

  // ── Xuất kho trong kỳ (+ dòng bị bỏ tick định mức) ──
  type MvRow = { id: string; item_id: string; quantity_out: number | null; movement_date: string; document_id: string; document_line_id: string }
  const [mvRows, exclRows] = await Promise.all([
    fetchAllPaginated<MvRow>((a, b) =>
      supabase
        .from("inventory_stock_movements")
        .select("id,item_id,quantity_out,movement_date,document_id,document_line_id")
        .eq("factory_id", factoryId)
        .eq("movement_type", "export")
        .gte("movement_date", f.from)
        .lte("movement_date", f.to)
        .order("movement_date")
        .order("id")
        .range(a, b),
    ),
    fetchAllPaginated<{ id: string; movement_id: string; ly_do: string }>((a, b) =>
      supabase
        .from("tech_norm_export_exclusions")
        .select("id,movement_id,ly_do")
        .eq("factory_id", factoryId)
        .gte("ngay", f.from)
        .lte("ngay", f.to)
        .order("id")
        .range(a, b),
    ).catch((e: unknown) => {
      // Migration 20261123 chưa chạy ⇒ chưa có dòng loại trừ nào.
      if (isMissingTable(e)) return [] as { id: string; movement_id: string; ly_do: string }[]
      throw e
    }),
  ])
  const exclByMv = new Map(exclRows.map((x) => [x.movement_id, x.ly_do]))
  const exports: ExportMovement[] = mvRows.map((m) => ({
    id: m.id,
    ngay: m.movement_date,
    inventoryItemId: m.item_id,
    qty: Number(m.quantity_out) || 0,
    excludedReason: exclByMv.get(m.id) ?? null,
  }))

  // Số phiếu + ghi chú cho các dòng xuất của mã đã gắn chỉ tiêu (để người lập tick / bỏ tick).
  const mapped = new Set(items.flatMap((i) => i.inventory_item_ids))
  const mappedMv = mvRows.filter((m) => mapped.has(m.item_id))
  const docInfo = mappedMv.length ? await loadMovementDocumentInfo(factoryId, mappedMv) : { lineNotes: {}, documents: {} }
  const movementInfo: Record<string, MovementDisplay> = {}
  for (const m of mappedMv) {
    const doc = docInfo.documents[m.document_id]
    movementInfo[m.id] = {
      documentId: m.document_id,
      documentCode: doc?.documentCode || "",
      note: movementNoteText({ document_id: m.document_id, document_line_id: m.document_line_id, movement_type: "export" }, docInfo),
    }
  }

  // ── Kiểm kê tồn xưởng ngày F−1 và T ──
  const floorDates = [addDaysISO(f.from, -1), f.to]
  type FcRow = { id: string; ngay: string; norm_item_id: string; so_luong: number }
  const fc = await fetchAllPaginated<FcRow>((a, b) =>
    supabase.from("tech_norm_floor_counts").select("id,ngay,norm_item_id,so_luong").eq("factory_id", factoryId).in("ngay", floorDates).order("id").range(a, b),
  )
  const floorStart = new Map<string, number>()
  const floorEnd = new Map<string, number>()
  for (const c of fc) {
    const target = c.ngay === floorDates[0] ? floorStart : floorEnd
    target.set(c.norm_item_id, (target.get(c.norm_item_id) || 0) + Number(c.so_luong))
  }

  // Mọi đồng hồ đang dùng: tick định mức ⇒ so sánh, còn lại ⇒ mục ngoài định mức.
  const readingsByMeter = new Map<string, NormMeterReading[]>()
  for (const r of readings) readingsByMeter.set(r.meter_id, [...(readingsByMeter.get(r.meter_id) || []), r])
  const meterInputs = meters
    .filter((m: NormMeter) => m.is_active)
    .map((meter) => ({ meter, readings: readingsByMeter.get(meter.id) || [] }))

  // ── Xuất kho chưa gắn chỉ tiêu: mã thuộc nhóm vật tư báo cáo (chưa cấu hình ⇒ nhóm của mã đã gắn) ──
  type InvRow = { id: string; code: string; name: string; unit: string | null; category_id: string | null }
  const fetchInv = (ids: string[]) =>
    chunked(ids, async (chunk) => {
      const { data: rows, error } = await supabase.from("inventory_items").select("id,code,name,unit,category_id").eq("factory_id", factoryId).in("id", chunk)
      if (error) throw error
      return (rows || []) as InvRow[]
    })
  const { data: catRows, error: catErr } = await supabase.from("tech_norm_report_categories").select("category_id").eq("factory_id", factoryId)
  if (catErr && !isMissingTable(catErr)) throw catErr
  let cats = new Set(((catRows || []) as { category_id: string }[]).map((r) => r.category_id))
  const categoriesConfigured = cats.size > 0
  if (!categoriesConfigured && mapped.size) cats = new Set((await fetchInv([...mapped])).map((i) => i.category_id).filter((c): c is string => !!c))
  const qtyByInv = new Map<string, number>()
  for (const e of exports) if (!mapped.has(e.inventoryItemId)) qtyByInv.set(e.inventoryItemId, (qtyByInv.get(e.inventoryItemId) || 0) + e.qty)
  let otherExports: OtherExport[] = []
  if (qtyByInv.size && cats.size) {
    otherExports = (await fetchInv([...qtyByInv.keys()]))
      .filter((i) => i.category_id && cats.has(i.category_id))
      .map((i) => ({ inventoryItemId: i.id, code: i.code, name: i.name, unit: i.unit, qty: qtyByInv.get(i.id) || 0 }))
      .filter((u) => u.qty > 0)
  }

  const input: ReconcileInput = {
    from: f.from,
    to: f.to,
    data,
    items: items.filter((i: NormItem) => i.is_active),
    tp,
    nl,
    km,
    thayBoc,
    exports,
    floorStart,
    floorEnd,
    meters: meterInputs,
    meterPeriod: { fromDate: f.meterFrom, toDate: f.meterTo },
    otherExports,
  }
  return { input, result: computeReconciliation(input), movementInfo, draftUsed, categoriesConfigured }
}

/** Tính lại sau khi tick / bỏ tick 1 dòng xuất (không tải lại số liệu). */
export function recomputeWithExclusion(bundle: ReconcileBundle, movementId: string, reason: string | null): ReconcileBundle {
  const exports = bundle.input.exports.map((e) => (e.id === movementId ? { ...e, excludedReason: reason } : e))
  const input = { ...bundle.input, exports }
  return { ...bundle, input, result: computeReconciliation(input) }
}
