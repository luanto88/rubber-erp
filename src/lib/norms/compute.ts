// Định mức KTKT GĐ3 — đối soát động kỳ [from, to] (module THUẦN, không import supabase). Rule 30.
//
// Định mức cho phép tính THEO NGÀY rồi cộng kỳ: mỗi dòng cơ sở (driver) mang ngày của nó, tra khung hiệu lực
// đúng ngày đó (`resolveNormValue` / `resolveLineValue`) ⇒ kỳ cắt qua 2 khung vẫn đúng.
//   tấn TP     : thành phẩm nhập theo ngày × (dây chuyền, CSR, nguồn) → đúng dòng của khung.
//   tấn NL     : Sản lượng theo ngày × (dây chuyền theo loại mủ, nguồn) → dòng cùng dây chuyền + nguồn (mọi CSR).
//   100 km     : km chuyến Điều xe theo loại xe của chỉ tiêu → ô 100 km của khung.
//   Thay bọc   : khối lượng TP thay bọc × định mức bọc 0,04 (tiêu hao thêm 1 lần, đã chốt).
// Thực tế:
//   kho        : Σ xuất kho (movement export) các mã gắn chỉ tiêu; tick kiểm kê ⇒ + tồn xưởng ngày F−1 − tồn ngày T.
//   đồng hồ    : Σ tiêu thụ các đồng hồ tick "Dùng báo cáo định mức" gắn chỉ tiêu, theo KỲ ĐỒNG HỒ người lập chọn.
// Dòng không có số (định mức = 0 và thực tế = 0) bị bỏ (đã chốt: chỉ hiện dòng > 0).

import { addDaysISO } from "@/lib/date-utils"
import { consumptionBetween, meterCountsForNormAt, type MeterReadingLike } from "./meters"
import { resolveNormValue, versionForDate, type NormDataset } from "./resolve"
import {
  NGUON_SHORT,
  shortCsr,
  type NguonCode,
  type NormBasis,
  type NormGroup,
  type NormItem,
  type NormMeter,
  type NormUnit,
} from "./types"

/** Chỉ tiêu được cộng thêm định mức khi Thay bọc (bọc 0,04 bọc từng bành). */
export const THAY_BOC_ITEM_CODES = ["BOC_004"]

export type TpDriver = { ngay: string; dayChuyen: string; csr: string; nguon: NguonCode | null; kg: number }
export type NlDriver = { ngay: string; dayChuyen: string; nguon: NguonCode | null; kgKho: number; kgTuoi: number }
export type KmDriver = { ngay: string; vehicleType: string; km: number }
export type ThayBocDriver = { ngay: string; dayChuyen: string; csr: string; nguon: NguonCode | null; kg: number }
export type ExportMovement = {
  id: string
  ngay: string
  inventoryItemId: string
  qty: number
  /** Dòng xuất được người lập báo cáo bỏ tick "Tính định mức" (tech_norm_export_exclusions). */
  excludedReason?: string | null
  /** Xuất kho CŨ (inventory_legacy_movements, trước 31/07/2026) — id "legacy:<uuid>", không bỏ tick được. */
  legacy?: boolean
}
/** Mã kho có xuất trong kỳ, thuộc nhóm vật tư báo cáo, nhưng chưa gắn chỉ tiêu định mức nào. */
export type OtherExport = { inventoryItemId: string; code: string; name: string; unit: string | null; qty: number }

export type ReconcileInput = {
  from: string
  to: string
  data: NormDataset
  items: NormItem[]
  tp: TpDriver[]
  nl: NlDriver[]
  km: KmDriver[]
  thayBoc: ThayBocDriver[]
  exports: ExportMovement[]
  /** Tổng kiểm kê theo chỉ tiêu ngày F−1 / ngày T; thiếu chỉ tiêu ⇒ chưa kiểm kê. */
  floorStart: Map<string, number>
  floorEnd: Map<string, number>
  /** MỌI đồng hồ đang dùng — đồng hồ không tick định mức hiện ở mục ngoài định mức. */
  meters: Array<{ meter: NormMeter; readings: MeterReadingLike[] }>
  meterPeriod: { fromDate: string | null; toDate: string | null }
  otherExports?: OtherExport[]
}

export type ReconcileBreakdown = { label: string; driver: number; norm: number | null; allowed: number }

export type ReconcileLine = {
  key: string
  itemId: string
  itemCode: string
  itemName: string
  group: NormGroup
  basis: NormBasis
  unit: NormUnit
  dayChuyen: string | null
  /** Cơ sở tính có định mức (tấn hoặc km). */
  driver: number
  /** Cơ sở tính KHÔNG tìm được định mức (không có dòng / ô trống). */
  driverNoNorm: number
  allowed: number
  actual: number | null
  /** Định mức bình quân = allowed / driver. */
  avgNorm: number | null
  avgActual: number | null
  diff: number | null
  diffPct: number | null
  breakdown: ReconcileBreakdown[]
  notes: string[]
  warnings: string[]
  /** Dòng xuất kho của các mã gắn chỉ tiêu (để tick / bỏ tick "Tính định mức"). */
  exportLines: ExportMovement[]
}

export type OutsideKind = "khong_dinh_muc" | "loai_tru" | "chua_gan" | "dong_ho"

export const OUTSIDE_KIND_LABEL: Record<OutsideKind, string> = {
  khong_dinh_muc: "Chỉ tiêu không có định mức trong kỳ",
  loai_tru: "Xuất kho bỏ tick định mức",
  chua_gan: "Xuất kho chưa gắn chỉ tiêu định mức",
  dong_ho: "Đồng hồ không tính định mức",
}

/** Phát sinh trong kỳ nhưng KHÔNG so sánh định mức — vẫn phải hiện trong báo cáo. */
export type OutsideRow = {
  key: string
  kind: OutsideKind
  group: string
  code: string
  name: string
  unit: string
  qty: number | null
  note: string
  exportLines: ExportMovement[]
}

export type ReconcileResult = {
  /** Chỉ dòng CÓ định mức cho phép > 0 — được so sánh. */
  lines: ReconcileLine[]
  outside: OutsideRow[]
  totals: {
    tpTons: number
    tpTonsNoNorm: number
    nlKhoTons: number
    nlTuoiTons: number
    kmByType: Array<{ vehicleType: string; km: number }>
    thayBocTons: number
  }
  versionsUsed: string[]
  warnings: string[]
}

type Acc = {
  driver: number
  driverNoNorm: number
  allowed: number
  breakdown: Map<string, ReconcileBreakdown>
  notes: string[]
}

const newAcc = (): Acc => ({ driver: 0, driverNoNorm: 0, allowed: 0, breakdown: new Map(), notes: [] })

function addBreakdown(acc: Acc, label: string, driver: number, norm: number | null) {
  const key = `${label}|${norm ?? "x"}`
  const cur = acc.breakdown.get(key) || { label, driver: 0, norm, allowed: 0 }
  cur.driver += driver
  cur.allowed += norm === null ? 0 : driver * norm
  acc.breakdown.set(key, cur)
}

/**
 * Định mức của chỉ tiêu cho (ngày, dây chuyền, nguồn) KHÔNG theo CSR — dùng cho cơ sở tấn NL.
 * Lấy giá trị đầu tiên của các dòng cùng dây chuyền + phủ nguồn; các dòng khác giá trị ⇒ cờ `mixed`.
 */
export function resolveLineValue(
  data: NormDataset,
  isoDate: string,
  itemId: string,
  dayChuyen: string,
  nguon: NguonCode | null,
): { value: number; mixed: boolean; versionName: string } | null {
  const version = versionForDate(data.versions, isoDate)
  if (!version) return null
  const rows = data.rows
    .filter(
      (r) =>
        r.version_id === version.id &&
        r.day_chuyen === dayChuyen &&
        (r.nguon_codes.length === 0 || (!!nguon && r.nguon_codes.includes(nguon))),
    )
    .sort((a, b) => a.sort_order - b.sort_order)
  const vals: number[] = []
  for (const r of rows) {
    const v = data.values.find((x) => x.row_id === r.id && x.item_id === itemId)
    if (v) vals.push(Number(v.value))
  }
  if (!vals.length) return null
  return { value: vals[0], mixed: new Set(vals).size > 1, versionName: version.name }
}

function versionItemFor(data: NormDataset, itemId: string, isoDate: string) {
  const v = versionForDate(data.versions, isoDate)
  if (!v) return null
  return data.versionItems.find((vi) => vi.version_id === v.id && vi.item_id === itemId) || null
}

const tons = (kg: number) => kg / 1000
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

export function computeReconciliation(input: ReconcileInput): ReconcileResult {
  const { data, items, from, to } = input
  const itemById = new Map(items.map((i) => [i.id, i]))
  const versionsUsed = new Set<string>()
  const globalWarnings: string[] = []

  // Cột (chỉ tiêu) có trong ít nhất 1 khung hiệu lực trong kỳ, kèm cơ sở tính + đơn vị (khung đầu tiên gặp).
  const colInfo = new Map<string, { basis: NormBasis; unit: NormUnit }>()
  const versionsInPeriod = data.versions.filter(
    (v) => v.status !== "draft" && v.effective_from <= to && (v.effective_to === null || v.effective_to >= from),
  )
  if (!versionsInPeriod.length) globalWarnings.push("Không có khung định mức đang áp dụng phủ kỳ này — mọi định mức = trống.")
  for (const v of [...versionsInPeriod].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) {
    for (const vi of data.versionItems.filter((x) => x.version_id === v.id)) {
      const prev = colInfo.get(vi.item_id)
      if (!prev) colInfo.set(vi.item_id, { basis: vi.basis, unit: vi.unit })
      else if (prev.basis !== vi.basis) {
        const it = itemById.get(vi.item_id)
        globalWarnings.push(`Chỉ tiêu ${it?.name || vi.item_id} đổi cơ sở tính giữa các khung trong kỳ — kiểm tra lại.`)
      }
    }
  }

  // acc theo (itemId | dayChuyen) — dây chuyền chỉ tách cho chỉ tiêu đồng hồ.
  const accs = new Map<string, Acc>()
  const accFor = (itemId: string, dc: string | null) => {
    const k = `${itemId}|${dc ?? ""}`
    let a = accs.get(k)
    if (!a) {
      a = newAcc()
      accs.set(k, a)
    }
    return a
  }
  // Chỉ tiêu đồng hồ tách theo dây chuyền — trừ khi có đồng hồ gắn chỉ tiêu đó mà không chọn dây chuyền
  // (khi đó gộp cả chỉ tiêu thành 1 dòng để định mức và thực tế cùng phạm vi).
  const meterNoLine = new Set(input.meters.filter((m) => m.meter.dung_dinh_muc && m.meter.norm_item_id && !m.meter.day_chuyen).map((m) => m.meter.norm_item_id as string))
  const splitByLine = (itemId: string) => itemById.get(itemId)?.actual_source === "dong_ho" && !meterNoLine.has(itemId)

  let tpTons = 0
  let tpTonsNoNorm = 0
  // ── tấn TP ──
  for (const d of input.tp) {
    const t = tons(d.kg)
    tpTons += t
    let anyNorm = false
    for (const [itemId, info] of colInfo) {
      if (info.basis !== "tan_tp") continue
      const vi = versionItemFor(data, itemId, d.ngay)
      if (!vi || vi.basis !== "tan_tp") continue
      const res = resolveNormValue(data, d.ngay, itemId, { dayChuyen: d.dayChuyen, csr: d.csr, nguon: d.nguon })
      const acc = accFor(itemId, splitByLine(itemId) ? d.dayChuyen : null)
      const label = `${d.dayChuyen} · ${shortCsr(d.csr)} · ${d.nguon ? NGUON_SHORT[d.nguon] : "?"}`
      if (res) {
        anyNorm = true
        versionsUsed.add(res.version.name)
        acc.driver += t
        acc.allowed += t * res.value
        addBreakdown(acc, label, t, res.value)
      } else {
        acc.driverNoNorm += t
      }
    }
    if (!anyNorm) tpTonsNoNorm += t
  }

  // ── Thay bọc (cộng thêm cho bọc 0,04) ──
  let thayBocTons = 0
  const thayBocItems = items.filter((i) => THAY_BOC_ITEM_CODES.includes(i.code))
  for (const d of input.thayBoc) {
    const t = tons(d.kg)
    thayBocTons += t
    for (const it of thayBocItems) {
      const res = resolveNormValue(data, d.ngay, it.id, { dayChuyen: d.dayChuyen, csr: d.csr, nguon: d.nguon })
      if (!res) continue
      const acc = accFor(it.id, null)
      acc.allowed += t * res.value
      addBreakdown(acc, `Thay bọc · ${shortCsr(d.csr)} · ${d.nguon ? NGUON_SHORT[d.nguon] : "?"}`, t, res.value)
    }
  }

  // ── tấn NL khô / tươi ──
  let nlKhoTons = 0
  let nlTuoiTons = 0
  const mixedWarned = new Set<string>()
  for (const d of input.nl) {
    nlKhoTons += tons(d.kgKho)
    nlTuoiTons += tons(d.kgTuoi)
    for (const [itemId, info] of colInfo) {
      if (info.basis !== "tan_nl_kho" && info.basis !== "tan_nl_tuoi") continue
      const vi = versionItemFor(data, itemId, d.ngay)
      if (!vi || (vi.basis !== "tan_nl_kho" && vi.basis !== "tan_nl_tuoi")) continue
      const t = tons(vi.basis === "tan_nl_kho" ? d.kgKho : d.kgTuoi)
      if (t === 0) continue
      const res = resolveLineValue(data, d.ngay, itemId, d.dayChuyen, d.nguon)
      const acc = accFor(itemId, splitByLine(itemId) ? d.dayChuyen : null)
      if (res) {
        versionsUsed.add(res.versionName)
        acc.driver += t
        acc.allowed += t * res.value
        addBreakdown(acc, `${d.dayChuyen} · ${d.nguon ? NGUON_SHORT[d.nguon] : "?"}`, t, res.value)
        if (res.mixed && !mixedWarned.has(itemId)) {
          mixedWarned.add(itemId)
          acc.notes.push("Các dòng CSR cùng dây chuyền có định mức khác nhau — đang lấy dòng đầu tiên (nên gộp ô).")
        }
      } else {
        acc.driverNoNorm += t
      }
    }
  }

  // ── 100 km ──
  const kmByType = new Map<string, number>()
  for (const d of input.km) kmByType.set(d.vehicleType, (kmByType.get(d.vehicleType) || 0) + d.km)
  for (const [itemId, info] of colInfo) {
    if (info.basis !== "km100") continue
    const it = itemById.get(itemId)
    if (!it) continue
    const types = new Set(it.vehicle_types)
    for (const d of input.km) {
      if (!types.has(d.vehicleType)) continue
      const res = resolveNormValue(data, d.ngay, itemId)
      const acc = accFor(itemId, null)
      const h = d.km / 100
      if (res) {
        versionsUsed.add(res.version.name)
        acc.driver += d.km
        acc.allowed += h * res.value
        addBreakdown(acc, d.vehicleType, d.km, res.value / 100)
      } else acc.driverNoNorm += d.km
    }
  }

  // ── Thực tế: xuất kho ──
  const exportByInv = new Map<string, number>()
  const exportLinesByInv = new Map<string, ExportMovement[]>()
  for (const e of input.exports) {
    exportLinesByInv.set(e.inventoryItemId, [...(exportLinesByInv.get(e.inventoryItemId) || []), e])
    if (!e.excludedReason) exportByInv.set(e.inventoryItemId, (exportByInv.get(e.inventoryItemId) || 0) + e.qty)
  }
  const outside: OutsideRow[] = []

  // ── Thực tế: đồng hồ ──
  const meterActual = new Map<string, { value: number; warnings: string[]; meters: string[] }>()
  const { fromDate: mFrom, toDate: mTo } = input.meterPeriod
  for (const { meter, readings } of input.meters) {
    // Tick định mức + còn hiệu lực ở cuối kỳ đồng hồ (chưa chọn kỳ ⇒ xét theo ngày cuối kỳ báo cáo).
    const counted = !!meter.norm_item_id && meterCountsForNormAt(meter, mTo || to)
    if (!counted) {
      const res = mFrom && mTo ? consumptionBetween(readings, mFrom, mTo) : null
      outside.push({
        key: `dh|${meter.id}`,
        kind: "dong_ho",
        group: meter.khu_vuc || "Khác",
        code: meter.code,
        name: meter.name,
        unit: meter.loai === "dien" ? "kWh" : "m³",
        qty: res?.value ?? null,
        note: !mFrom || !mTo ? "Chưa chọn kỳ đồng hồ" : res?.value === null || res?.value === undefined ? `Thiếu lần ghi ${mFrom} / ${mTo}` : (res.warnings[0] ?? ""),
        exportLines: [],
      })
      continue
    }
    if (!meter.norm_item_id) continue
    const k = `${meter.norm_item_id}|${splitByLine(meter.norm_item_id) ? meter.day_chuyen ?? "" : ""}`
    const cur = meterActual.get(k) || { value: 0, warnings: [], meters: [] }
    if (!mFrom || !mTo) {
      cur.warnings.push(`${meter.code}: chưa chọn kỳ đồng hồ (lần ghi cũ / mới).`)
    } else {
      const res = consumptionBetween(readings, mFrom, mTo)
      if (res.value === null) cur.warnings.push(`${meter.code}: thiếu lần ghi ngày ${mFrom} hoặc ${mTo}.`)
      else {
        cur.value += res.value
        cur.meters.push(meter.code)
        for (const w of res.warnings) cur.warnings.push(`${meter.code}: ${w}`)
      }
    }
    meterActual.set(k, cur)
    // đảm bảo có acc để hiện dòng thực tế dù kỳ không có thành phẩm
    accFor(meter.norm_item_id, splitByLine(meter.norm_item_id) ? meter.day_chuyen ?? null : null)
  }

  // Chỉ tiêu kho có xuất trong kỳ mà chưa có acc (không thuộc khung / không có cơ sở) — vẫn phải hiện.
  for (const it of items) {
    if (it.actual_source !== "kho") continue
    if (it.inventory_item_ids.some((id) => (exportByInv.get(id) || 0) > 0)) accFor(it.id, null)
  }

  const floorStartDate = addDaysISO(from, -1)
  const lines: ReconcileLine[] = []
  for (const [k, acc] of accs) {
    const [itemId, dcRaw] = k.split("|")
    const it = itemById.get(itemId)
    if (!it) continue
    const inVersion = colInfo.has(itemId)
    const info = colInfo.get(itemId) ?? { basis: "tan_tp" as NormBasis, unit: "" as NormUnit }
    const dc = dcRaw || null
    const warnings: string[] = []
    const exportLines = it.actual_source === "kho" ? it.inventory_item_ids.flatMap((id) => exportLinesByInv.get(id) || []) : []
    const notes = [...acc.notes]
    let actual: number | null = null
    if (it.actual_source === "kho") {
      if (!it.inventory_item_ids.length) warnings.push("Chưa gắn mã vật tư kho — không có số thực tế.")
      else {
        actual = it.inventory_item_ids.reduce((s, id) => s + (exportByInv.get(id) || 0), 0)
        if (it.kiem_ke_ton_xuong) {
          const s = input.floorStart.get(itemId)
          const e = input.floorEnd.get(itemId)
          if (s === undefined) warnings.push(`Chưa kiểm kê tồn xưởng ngày ${floorStartDate} (đầu kỳ) — tính 0.`)
          if (e === undefined) warnings.push(`Chưa kiểm kê tồn xưởng ngày ${to} (cuối kỳ) — tính 0.`)
          notes.push(`Xuất kho ${r6(actual)} + tồn đầu ${s ?? 0} − tồn cuối ${e ?? 0}`)
          actual = actual + (s ?? 0) - (e ?? 0)
        }
      }
    } else {
      const m = meterActual.get(k)
      if (!m || !m.meters.length) {
        warnings.push(dc ? `Không có đồng hồ tick định mức cho ${it.name} · ${dc} có đủ số trong kỳ đồng hồ.` : "Không có số đồng hồ trong kỳ.")
      } else {
        actual = m.value
        notes.push(`Đồng hồ: ${m.meters.join(", ")} (kỳ ${mFrom} → ${mTo})`)
      }
      if (m) warnings.push(...m.warnings)
    }
    if (acc.driverNoNorm > 0) {
      const unitText = info.basis === "km100" ? "km" : "tấn"
      warnings.push(`${r6(acc.driverNoNorm)} ${unitText} không có định mức (thiếu dòng / ô trống).`)
    }
    const allowed = acc.allowed
    if (allowed <= 0 && (actual ?? 0) <= 0) continue
    if (allowed <= 0) {
      // Có phát sinh nhưng kỳ này không có định mức cho chỉ tiêu (vd Formic khi chỉ sản xuất mủ tạp) ⇒ không so sánh.
      outside.push({
        key: `kdm|${k}`,
        kind: "khong_dinh_muc",
        group: it.name,
        code: it.code,
        name: dc ? `${it.name} · ${dc}` : it.name,
        unit: info.unit === "lit" ? "lít" : info.unit === "kwh" ? "kWh" : info.unit === "m3" ? "m³" : info.unit,
        qty: actual,
        note: !inVersion
          ? "Chỉ tiêu chưa có trong khung định mức áp dụng"
          : acc.driverNoNorm > 0
            ? "Thành phẩm / cơ sở trong kỳ không có dòng định mức cho chỉ tiêu này"
            : "Không có cơ sở tính trong kỳ",
        exportLines: exportLines.filter((e) => !e.excludedReason),
      })
      continue
    }
    const driver = acc.driver
    const perUnit = info.basis === "km100" ? 100 : 1
    const avgNorm = driver > 0 ? (allowed / driver) * perUnit : null
    const avgActual = driver > 0 && actual !== null ? (actual / driver) * perUnit : null
    const diff = actual !== null ? actual - allowed : null
    const diffPct = diff !== null && allowed > 0 ? (diff / allowed) * 100 : null
    lines.push({
      key: k,
      itemId,
      itemCode: it.code,
      itemName: it.name,
      group: it.norm_group,
      basis: info.basis,
      unit: info.unit,
      dayChuyen: dc,
      driver,
      driverNoNorm: acc.driverNoNorm,
      allowed,
      actual,
      avgNorm,
      avgActual,
      diff,
      diffPct,
      breakdown: [...acc.breakdown.values()].sort((a, b) => b.allowed - a.allowed),
      notes,
      warnings,
      exportLines,
    })
  }
  lines.sort((a, b) => {
    const ia = items.findIndex((i) => i.id === a.itemId)
    const ib = items.findIndex((i) => i.id === b.itemId)
    return ia - ib || (a.dayChuyen || "").localeCompare(b.dayChuyen || "")
  })

  // Dòng xuất bị bỏ tick — gom theo mã chỉ tiêu.
  for (const it of items) {
    if (it.actual_source !== "kho") continue
    const ex = it.inventory_item_ids.flatMap((id) => exportLinesByInv.get(id) || []).filter((e) => e.excludedReason)
    if (!ex.length) continue
    const unitInfo = colInfo.get(it.id)?.unit
    outside.push({
      key: `lt|${it.id}`,
      kind: "loai_tru",
      group: it.name,
      code: it.code,
      name: it.name,
      unit: unitInfo === "lit" ? "lít" : unitInfo || "",
      qty: ex.reduce((s2, e) => s2 + e.qty, 0),
      note: [...new Set(ex.map((e) => e.excludedReason as string))].join("; "),
      exportLines: ex,
    })
  }
  for (const o of input.otherExports || []) {
    outside.push({
      key: `cg|${o.inventoryItemId}`,
      kind: "chua_gan",
      group: "Xuất kho",
      code: o.code,
      name: o.name,
      unit: o.unit || "",
      qty: o.qty,
      note: "",
      exportLines: [],
    })
  }
  const kindOrder: OutsideKind[] = ["khong_dinh_muc", "loai_tru", "chua_gan", "dong_ho"]
  outside.sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.group.localeCompare(b.group) || a.code.localeCompare(b.code))

  return {
    lines,
    outside,
    totals: {
      tpTons,
      tpTonsNoNorm,
      nlKhoTons,
      nlTuoiTons,
      kmByType: [...kmByType.entries()].map(([vehicleType, km]) => ({ vehicleType, km })).sort((a, b) => b.km - a.km),
      thayBocTons,
    },
    versionsUsed: [...versionsUsed],
    warnings: globalWarnings,
  }
}

/** Dòng vượt định mức (thực tế > cho phép). */
export function isOverNorm(line: ReconcileLine): boolean {
  return line.diff !== null && line.diff > 1e-9 && line.allowed > 0
}
