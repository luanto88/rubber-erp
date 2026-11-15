// Định mức KTKT GĐ4 — dựng SNAPSHOT bộ báo cáo kỳ từ kết quả đối soát (trình duyệt, supabase anon theo RLS).
// Không đổi logic computeReconciliation; chỉ gom thêm số liệu riêng của các mẫu:
//   - Mục 1 Mẫu 8A: NL tiếp nhận theo Đội × loại mủ — production_records, KHÔNG theo bộ lọc ký hiệu KT (đã chốt).
//   - Mục 2: thành phẩm theo CSR × nguồn — từ chính driver tấn TP của đối soát (mọi nguồn).
//   - Mục 3: thành phẩm xuất kho — đơn xuất đã duyệt theo export_orders.ngay (cùng quy tắc F12).
//   - Mẫu 09: chỉ số cũ / mới từng đồng hồ của kỳ đồng hồ.
// Rule 30.

import { supabase } from "@/lib/supabase"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { makeNguonResolver, type LotSuffixRow } from "@/lib/lot-source"
import { consumptionBetween, sortReadings } from "./meters"
import type { ReconcileBundle, ReconcileFilters } from "./reconcile-loader"
import { NL_MATERIALS, nguonCodeFromLabel } from "./types"
import type { NormReportSnapshot, SnapMeter, SnapNlUnit, SnapTpRow } from "./report-types"

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>

async function chunked<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 200) out.push(...(await fn(ids.slice(i, i + 200))))
  return out
}

const tpKey = (nguonLabel: string | null | undefined): string => {
  const c = nguonCodeFromLabel(nguonLabel)
  return c === "cong_ty" || c === "gia_cong" || c === "thu_mua" ? c : "khac"
}

function addTp(map: Map<string, Record<string, number>>, csr: string, key: string, kg: number) {
  const cur = map.get(csr) || {}
  cur[key] = (cur[key] || 0) + kg
  map.set(csr, cur)
}

const sortTp = (map: Map<string, Record<string, number>>): SnapTpRow[] =>
  [...map.entries()].map(([csr, kg]) => ({ csr, kg })).sort((a, b) => a.csr.localeCompare(b.csr, "vi", { numeric: true }))

export async function buildReportSnapshot(factoryId: string, f: ReconcileFilters, bundle: ReconcileBundle): Promise<NormReportSnapshot> {
  const { input, result } = bundle
  const { data: sufRows, error: sufErr } = await supabase.from("suffixes").select("code,nguon,name").eq("factory_id", factoryId)
  if (sufErr) throw sufErr
  const resolveNguon = makeNguonResolver((sufRows || []) as LotSuffixRow[])

  // ── Mục 1: NL tiếp nhận theo đơn vị (mọi ký hiệu KT, mọi loại mủ) ──
  type PrRow = Record<string, unknown> & { id: string; doi: number | null; ma_nguon: string | null }
  const prCols = ["id", "doi", "ma_nguon", ...NL_MATERIALS.flatMap((m) => [m.tuoi, m.kho])].join(",")
  const prRows = await fetchAllPaginated<PrRow>((a, b) =>
    supabase.from("production_records").select(prCols).eq("factory_id", factoryId).gte("ngay", f.from).lte("ngay", f.to).order("ngay").order("id").range(a, b) as unknown as Page<PrRow>,
  )
  const units = new Map<string, SnapNlUnit>()
  for (const r of prRows) {
    const doi = Number(r.doi) || 0
    let label: string
    let order: number
    if (doi > 0) {
      label = `Đội ${doi}`
      order = doi
    } else {
      const nl = (resolveNguon(r.ma_nguon) || "").trim()
      label = nl && nl !== "Công ty" ? nl : r.doi === 0 || !nl ? "Thu mua" : "Khác"
      order = label === "Thu mua" ? 100 : 200
    }
    const u = units.get(label) || { label, order, tuoi: {}, kho: {} }
    for (const m of NL_MATERIALS) {
      const t = Number(r[m.tuoi]) || 0
      const k = Number(r[m.kho]) || 0
      if (t) u.tuoi[m.key] = (u.tuoi[m.key] || 0) + t
      if (k) u.kho[m.key] = (u.kho[m.key] || 0) + k
    }
    units.set(label, u)
  }
  const nlUnits = [...units.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "vi"))

  // ── Mục 2: TP chế biến (driver tấn TP của đối soát, mọi nguồn) ──
  const tpMap = new Map<string, Record<string, number>>()
  const nguonLabelByCode: Record<string, string> = { cong_ty: "Công ty", gia_cong: "Gia công", thu_mua: "Thu mua", thanh_ly: "Thanh lý" }
  for (const d of input.tp) addTp(tpMap, d.csr, tpKey(d.nguon ? nguonLabelByCode[d.nguon] : null), d.kg)

  // ── Mục 3: TP xuất kho — đơn xuất đã duyệt trong kỳ (theo ngày đơn), kg = bành gán × loại bành ──
  type Assign = { lot_id?: string | null; ma_lo?: string | null; kien_a?: number; kien_b?: number; kien_c?: number; kien_d?: number }
  type OrderRow = { id: string; ngay: string; assignments: Assign[] | null }
  const orders = await fetchAllPaginated<OrderRow>((a, b) =>
    supabase
      .from("export_orders")
      .select("id,ngay,assignments")
      .eq("factory_id", factoryId)
      .gte("ngay", f.from)
      .lte("ngay", f.to)
      .or("trang_thai.is.null,trang_thai.eq.da_phe_duyet")
      .order("id")
      .range(a, b) as unknown as Page<OrderRow>,
  )
  type LotRow = { id: string; ma_lo: string | null; loai_csr: string | null; suffix: string | null; loai_banh: number | null }
  const assigns = orders.flatMap((o) => (Array.isArray(o.assignments) ? o.assignments : []))
  const lotIds = [...new Set(assigns.map((a) => a.lot_id).filter((x): x is string => !!x))]
  const maLos = [...new Set(assigns.filter((a) => !a.lot_id && a.ma_lo).map((a) => String(a.ma_lo)))]
  const lotRows: LotRow[] = []
  if (lotIds.length)
    lotRows.push(
      ...(await chunked(lotIds, async (ids) => {
        const { data, error } = await supabase.from("lots").select("id,ma_lo,loai_csr,suffix,loai_banh").eq("factory_id", factoryId).in("id", ids)
        if (error) throw error
        return (data || []) as LotRow[]
      })),
    )
  if (maLos.length)
    lotRows.push(
      ...(await chunked(maLos, async (ids) => {
        const { data, error } = await supabase.from("lots").select("id,ma_lo,loai_csr,suffix,loai_banh").eq("factory_id", factoryId).in("ma_lo", ids)
        if (error) throw error
        return (data || []) as LotRow[]
      })),
    )
  const lotById = new Map(lotRows.map((l) => [l.id, l]))
  const lotsByMa = new Map<string, LotRow[]>()
  for (const l of lotRows) if (l.ma_lo) lotsByMa.set(l.ma_lo, [...(lotsByMa.get(l.ma_lo) || []), l])
  const expMap = new Map<string, Record<string, number>>()
  let missingBales = 0
  for (const a of assigns) {
    const bales = (Number(a.kien_a) || 0) + (Number(a.kien_b) || 0) + (Number(a.kien_c) || 0) + (Number(a.kien_d) || 0)
    if (!bales) continue
    let lot = a.lot_id ? lotById.get(a.lot_id) : undefined
    if (!lot && a.ma_lo) {
      const cands = lotsByMa.get(String(a.ma_lo)) || []
      if (cands.length === 1) lot = cands[0]
    }
    const csr = (lot?.loai_csr || "").trim()
    if (!lot || !csr) {
      missingBales += bales
      continue
    }
    addTp(expMap, csr, tpKey(resolveNguon(lot.suffix)), bales * (Number(lot.loai_banh) || 0))
  }
  const tpExportWarnings = missingBales ? [`${missingBales} bành trong đơn xuất trỏ tới lô không còn tồn tại — không tính vào mục 3.`] : []

  // ── Đồng hồ (Mẫu 09) ──
  const meters: SnapMeter[] = input.meters.map(({ meter, readings }) => {
    const sorted = sortReadings(readings)
    const rFrom = f.meterFrom ? sorted.find((r) => r.ngay === f.meterFrom) : undefined
    const rTo = f.meterTo ? sorted.find((r) => r.ngay === f.meterTo) : undefined
    const res = f.meterFrom && f.meterTo ? consumptionBetween(readings, f.meterFrom, f.meterTo) : null
    const notes: string[] = []
    if (!f.meterFrom || !f.meterTo) notes.push("Chưa chọn kỳ đồng hồ")
    else if (!rFrom || !rTo) notes.push("Thiếu lần ghi")
    if (res?.hasReplacement) notes.push("Có thay đồng hồ trong kỳ")
    if (res?.warnings.length && rFrom && rTo) notes.push(...res.warnings)
    return {
      id: meter.id,
      code: meter.code,
      name: meter.name,
      khuVuc: meter.khu_vuc || "Khác",
      loai: meter.loai,
      heSo: rTo ? Number(rTo.he_so) : meter.he_so,
      chiSoCu: rFrom ? Number(rFrom.chi_so) : null,
      chiSoMoi: rTo ? Number(rTo.thay_dong_ho ? rTo.chi_so_chot_cu ?? rTo.chi_so : rTo.chi_so) : null,
      raw: res?.raw ?? null,
      value: res?.value ?? null,
      sortOrder: meter.sort_order,
      note: notes.join("; "),
    }
  })
  meters.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))

  return {
    v: 1,
    from: f.from,
    to: f.to,
    materials: [...f.materials].sort(),
    notes: [...f.notes].sort(),
    meterFrom: f.meterFrom,
    meterTo: f.meterTo,
    draftUsed: bundle.draftUsed,
    versions: input.data.versions.map((v) => ({ id: v.id, name: v.name, effective_from: v.effective_from, effective_to: v.effective_to, status: bundle.draftUsed ? "draft" : v.status })),
    totals: result.totals,
    lines: result.lines.map((l) => ({
      key: l.key,
      itemCode: l.itemCode,
      itemName: l.itemName,
      group: l.group,
      basis: l.basis,
      unit: l.unit,
      dayChuyen: l.dayChuyen,
      driver: l.driver,
      allowed: l.allowed,
      actual: l.actual,
      avgNorm: l.avgNorm,
      avgActual: l.avgActual,
      diff: l.diff,
      diffPct: l.diffPct,
      breakdown: l.breakdown,
      notes: l.notes,
      warnings: l.warnings,
    })),
    outside: result.outside.map((o) => ({ key: o.key, kind: o.kind, group: o.group, code: o.code, name: o.name, unit: o.unit, qty: o.qty, note: o.note })),
    warnings: result.warnings,
    nlUnits,
    tpByCsr: sortTp(tpMap),
    tpExport: sortTp(expMap),
    tpExportWarnings,
    meters,
  }
}
