import { supabase } from "@/lib/supabase"
import { normalizeDateInput } from "@/lib/date-utils"

// ─── Types ──────────────────────────────────────────────────────────────────

export type ChiTieuKey =
  | "tap_chat" | "tro" | "bay_hoi" | "nito" | "po" | "pri" | "mooney" | "mau_sac"
  | "tccs_tong"

export type ChiTieuBound = "max" | "min" | "range" | "rate"

export type QcResultRow = {
  id: string
  factory_id: string
  lot_id: string | null
  ma_lo: string
  ngay_kn: string
  ngay_sx: string
  loai_csr: string
  chung_loai: string
  tieu_chuan: string
  samples: Record<string, (string | number)[]>
  dat_hang: string
  trang_thai: string
}

export type LotWeightRow = { id: string; ma_lo: string; tong_kg: number }

export type QualityTargetRow = {
  id: string
  factory_id: string
  nam: number
  chi_tieu: ChiTieuKey
  san_pham: string
  nguong_min: number | null
  nguong_max: number | null
  tieu_chuan: string | null
  ty_le_muc_tieu: number
  noi_dung_muc_tieu: string | null
  target_value: number | null
  sort_order: number
  is_active: boolean
}

export type QualityTargetForm = {
  chi_tieu: ChiTieuKey
  san_pham: string
  nguong_min: number | null
  nguong_max: number | null
  tieu_chuan: string | null
  ty_le_muc_tieu: number
  target_value: number | null
}

type LimitRow = {
  tap_chat: number; tro: number
  bay_hoi: number; bay_hoi_dr: number | null
  nito: number; nito_dr: number | null
  po_min: number | null; po_dr: number | null
  pri_min: number; pri_tb: number; pri_dr: number | null
  mooney_min: number | null; mooney_max: number | null
  mau_max: number | null; mau_dr: number | null
}

type CriterionThreshold = {
  min?: number | null
  max?: number | null
  dr?: number | null
  meanMin?: number | null
}

// ─── Hằng số dùng chung ─────────────────────────────────────────────────────

export const CHUNG_LOAI = ["10", "20", "L", "3L", "CV50", "CV60", "5"] as const

export const CHI_TIEU_META: Record<ChiTieuKey, { label: string; bound: ChiTieuBound; unit: string }> = {
  tap_chat: { label: "Tạp chất", bound: "max", unit: "%" },
  tro: { label: "Tro", bound: "max", unit: "%" },
  bay_hoi: { label: "Bay hơi", bound: "max", unit: "%" },
  nito: { label: "Nitơ", bound: "max", unit: "%" },
  po: { label: "Po", bound: "min", unit: "" },
  pri: { label: "PRI", bound: "min", unit: "" },
  mooney: { label: "Mooney", bound: "range", unit: "" },
  mau_sac: { label: "Màu sắc", bound: "max", unit: "" },
  tccs_tong: { label: "Tỷ lệ đạt tổng hợp", bound: "rate", unit: "%" },
}

export const SAN_PHAM_GROUP: Record<string, "mu_tap" | "mu_nuoc_cv" | "mu_nuoc_khac"> = {
  "10": "mu_tap", "20": "mu_tap",
  CV50: "mu_nuoc_cv", CV60: "mu_nuoc_cv",
  L: "mu_nuoc_khac", "3L": "mu_nuoc_khac", "5": "mu_nuoc_khac",
}

export const NHOM_LABEL: Record<"mu_tap" | "mu_nuoc_cv" | "mu_nuoc_khac", string> = {
  mu_tap: "Từ nguyên liệu mủ tạp",
  mu_nuoc_cv: "Từ nguyên liệu mủ nước (CSR CV50/60)",
  mu_nuoc_khac: "Từ nguyên liệu mủ nước (CSR L, 3L, 5)",
}

// Bản sao TCCS/TCVN từ quality/page.tsx (bảng dữ liệu chuẩn — cố ý giữ 1 bản riêng cho
// module thống kê để không đụng vào engine chấm điểm gốc đang chạy, theo kế hoạch đã duyệt)
const TCCS_LIMITS: Record<string, LimitRow> = {
  CSRL: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: 35, po_dr: 8, pri_min: 60, pri_tb: 70, pri_dr: 10, mooney_min: null, mooney_max: null, mau_max: 4, mau_dr: 1 },
  CSR3L: { tap_chat: 0.03, tro: 0.4, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: 35, po_dr: 8, pri_min: 60, pri_tb: 70, pri_dr: 10, mooney_min: 73, mooney_max: 93, mau_max: 6, mau_dr: 1 },
  CSR5: { tap_chat: 0.04, tro: 0.5, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: 30, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: 10, mooney_min: null, mooney_max: null, mau_max: null, mau_dr: null },
  CSRCV50: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: null, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: 10, mooney_min: 45, mooney_max: 55, mau_max: null, mau_dr: null },
  CSRCV60: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: null, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: 10, mooney_min: 55, mooney_max: 65, mau_max: null, mau_dr: null },
  CSR10: { tap_chat: 0.07, tro: 0.6, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: 30, po_dr: 8, pri_min: 50, pri_tb: 60, pri_dr: 10, mooney_min: 73, mooney_max: 93, mau_max: null, mau_dr: null },
  CSR20: { tap_chat: 0.15, tro: 0.7, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: 30, po_dr: 8, pri_min: 40, pri_tb: 50, pri_dr: 10, mooney_min: null, mooney_max: null, mau_max: null, mau_dr: null },
}

const TCVN_LIMITS: Record<string, LimitRow> = {
  CSRL: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: 35, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: null, mooney_min: null, mooney_max: null, mau_max: 4, mau_dr: null },
  CSR3L: { tap_chat: 0.03, tro: 0.5, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: 35, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: null, mooney_min: 73, mooney_max: 93, mau_max: 6, mau_dr: null },
  CSR5: { tap_chat: 0.05, tro: 0.6, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: 30, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: null, mooney_min: null, mooney_max: null, mau_max: null, mau_dr: null },
  CSRCV50: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: null, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: null, mooney_min: 45, mooney_max: 55, mau_max: null, mau_dr: null },
  CSRCV60: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: null, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: null, mooney_min: 55, mooney_max: 65, mau_max: null, mau_dr: null },
  CSR10: { tap_chat: 0.08, tro: 0.6, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: 30, po_dr: null, pri_min: 50, pri_tb: 60, pri_dr: null, mooney_min: 73, mooney_max: 93, mau_max: null, mau_dr: null },
  CSR20: { tap_chat: 0.16, tro: 0.8, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: 30, po_dr: null, pri_min: 40, pri_tb: 50, pri_dr: null, mooney_min: null, mooney_max: null, mau_max: null, mau_dr: null },
}

export const TIEU_CHUAN_OPTIONS = ["TCCS 112:2022", "TCVN 3769:2016"]

function getLimitsForStandard(sanPham: string, tieuChuan: string): LimitRow {
  const key = "CSR" + sanPham
  const table = tieuChuan === "TCVN 3769:2016" ? TCVN_LIMITS : TCCS_LIMITS
  return table[key] || TCCS_LIMITS.CSR10
}

function thresholdFromStandard(limits: LimitRow, chiTieu: ChiTieuKey): CriterionThreshold {
  switch (chiTieu) {
    case "tap_chat": return { max: limits.tap_chat }
    case "tro": return { max: limits.tro }
    case "bay_hoi": return { max: limits.bay_hoi, dr: limits.bay_hoi_dr }
    case "nito": return { max: limits.nito, dr: limits.nito_dr }
    case "po": return { min: limits.po_min, dr: limits.po_dr }
    case "pri": return { min: limits.pri_min, meanMin: limits.pri_tb, dr: limits.pri_dr }
    case "mooney": return { min: limits.mooney_min, max: limits.mooney_max }
    case "mau_sac": return { max: limits.mau_max, dr: limits.mau_dr }
    default: return {}
  }
}

// ─── Helpers thống kê cơ bản ────────────────────────────────────────────────

export function toNums(raw: (string | number)[] | undefined): number[] {
  return (raw || []).map(Number).filter((v) => !Number.isNaN(v) && v > 0)
}

export function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0
}

// Population SD (÷N) — đồng nhất với calcGrade/quality-analytics hiện có
export function populationSd(a: number[]): number {
  if (!a.length) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
}

export function matchesSanPham(loaiCsr: string, sanPham: string): boolean {
  return loaiCsr.replace(/^(CSR|SVR)/, "") === sanPham
}

export function chiTieuDisplayLabel(chiTieu: ChiTieuKey, sanPham?: string): string {
  if (chiTieu === "mooney") {
    return sanPham && (sanPham === "10" || sanPham === "20") ? "Độ nhớt" : "Mooney"
  }
  return CHI_TIEU_META[chiTieu].label
}

export function getVisibleChiTieu(sanPham: string): ChiTieuKey[] {
  const base: ChiTieuKey[] = ["tap_chat", "tro", "bay_hoi", "nito", "po", "pri"]
  if (sanPham === "10" || sanPham === "20" || sanPham === "CV50" || sanPham === "CV60") base.push("mooney")
  if (sanPham === "L" || sanPham === "3L") base.push("mau_sac")
  return base
}

/**
 * Đánh giá đạt/không đạt cho MỘT chỉ tiêu, độc lập với các chỉ tiêu khác của cùng lô
 * (business rule: lô rớt hạng do 1 chỉ tiêu vẫn tính đạt cho chỉ tiêu khác nó đạt).
 * Trả về null nếu không có dữ liệu hoặc ngưỡng không áp dụng (loại khỏi mẫu số).
 */
export function evalCriterion(
  rawValues: (string | number)[] | undefined,
  chiTieu: ChiTieuKey,
  th: CriterionThreshold,
): boolean | null {
  const nums = toNums(rawValues)
  if (!nums.length) return null
  const avg = mean(nums)
  const s = populationSd(nums)
  const mx = Math.max(...nums)
  const mn = Math.min(...nums)

  switch (chiTieu) {
    case "tap_chat":
    case "tro": {
      if (th.max == null) return null
      return +(avg + 3 * s).toFixed(6) <= th.max
    }
    case "bay_hoi":
    case "nito": {
      if (th.max == null) return null
      const dr = +(mx - mn).toFixed(6)
      return mx <= th.max && (th.dr == null || dr <= th.dr)
    }
    case "po": {
      if (th.min == null) return true // giống calcGrade: Po không giới hạn -> luôn đạt
      const dr = +(mx - mn).toFixed(6)
      return mn >= th.min && (th.dr == null || dr <= th.dr)
    }
    case "pri": {
      if (th.min == null) return null
      const dr = +(mx - mn).toFixed(6)
      const meanOk = th.meanMin == null || avg >= th.meanMin
      return mn >= th.min && meanOk && (th.dr == null || dr <= th.dr)
    }
    case "mooney": {
      if (th.min == null || th.max == null) return null
      return mn >= th.min && mx <= th.max
    }
    case "mau_sac": {
      if (th.max == null) return null
      const meanOk = th.dr == null || avg <= th.dr
      return nums.every((v) => v <= th.max!) && meanOk
    }
    default:
      return null
  }
}

// ─── Tự sinh câu mô tả Mục tiêu ─────────────────────────────────────────────

export function buildMucTieuText(t: QualityTargetForm): string {
  const sp = "CSR" + t.san_pham
  const pct = t.ty_le_muc_tieu
  if (t.chi_tieu === "tccs_tong") {
    return `Phấn đấu trên ${pct}% sản phẩm ${sp} đạt ${t.tieu_chuan || "tiêu chuẩn"} trên tổng sản phẩm sản xuất.`
  }
  const meta = CHI_TIEU_META[t.chi_tieu]
  const label = chiTieuDisplayLabel(t.chi_tieu, t.san_pham)
  let dieuKien = ""
  if (meta.bound === "max" && t.nguong_max != null) dieuKien = `${label} ≤ ${t.nguong_max}${meta.unit}`
  else if (meta.bound === "min" && t.nguong_min != null) dieuKien = `${label} ≥ ${t.nguong_min}${meta.unit}`
  else if (meta.bound === "range" && t.nguong_min != null && t.nguong_max != null) {
    dieuKien = `${label} đạt ${t.nguong_min}-${t.nguong_max}${meta.unit}`
  }
  return `Phấn đấu trên ${pct}% sản phẩm cao su mủ ${sp} có chỉ tiêu ${dieuKien} trên tổng khối lượng sản xuất.`
}

// ─── Fetch dữ liệu (có phân trang theo rule 04-code-patterns.md) ───────────

const PAGE_SIZE = 1000

export async function fetchAllQcResults(
  factoryId: string,
  tuNgay: string,
  denNgay: string,
): Promise<QcResultRow[]> {
  const all: QcResultRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from("qc_results")
      .select("id,factory_id,lot_id,ma_lo,ngay_kn,ngay_sx,loai_csr,chung_loai,tieu_chuan,samples,dat_hang,trang_thai")
      .eq("factory_id", factoryId)
      .gte("ngay_sx", tuNgay)
      .lte("ngay_sx", denNgay)
      .order("ngay_sx", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    all.push(...((data as QcResultRow[]) || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

export async function fetchLotWeights(lotIds: string[]): Promise<Map<string, LotWeightRow>> {
  const map = new Map<string, LotWeightRow>()
  const ids = Array.from(new Set(lotIds.filter(Boolean)))
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await supabase.from("lots").select("id,ma_lo,tong_kg").in("id", chunk)
    if (error) throw error
    for (const row of (data as LotWeightRow[]) || []) map.set(row.id, row)
  }
  return map
}

export async function fetchQualityTargets(factoryId: string, nam: number): Promise<QualityTargetRow[]> {
  const { data, error } = await supabase
    .from("quality_targets")
    .select("*")
    .eq("factory_id", factoryId)
    .in("nam", [nam, nam - 1])
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
  if (error) throw error
  return (data as QualityTargetRow[]) || []
}

/** Trả về resolver: ưu tiên mục tiêu của `nam`, fallback `nam-1` nếu năm hiện tại chưa nhập. */
export function buildTargetResolver(rows: QualityTargetRow[], nam: number) {
  const currentMap = new Map<string, QualityTargetRow>()
  const prevMap = new Map<string, QualityTargetRow>()
  for (const r of rows) {
    const key = `${r.chi_tieu}|${r.san_pham}`
    if (r.nam === nam) currentMap.set(key, r)
    else if (r.nam === nam - 1) prevMap.set(key, r)
  }
  return (chiTieu: ChiTieuKey, sanPham: string): QualityTargetRow | null => {
    const key = `${chiTieu}|${sanPham}`
    return currentMap.get(key) || prevMap.get(key) || null
  }
}

// ─── Ngày tháng ─────────────────────────────────────────────────────────────

export function monthRange(nam: number, thang: number) {
  const tuThang = `${nam}-${String(thang).padStart(2, "0")}-01`
  const lastDay = new Date(nam, thang, 0).getDate()
  const denThang = `${nam}-${String(thang).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  const tuNam = `${nam}-01-01`
  return { tuThang, denThang, tuNam, denThang_luyKe: denThang }
}

// ─── Báo cáo 1: Bảng thống kê chất lượng tháng ─────────────────────────────

export type QualityReportCell = { kl: number; tyLe: number | null }

export type QualityReportRow = {
  chiTieu: ChiTieuKey
  nhom: "mu_tap" | "mu_nuoc_cv" | "mu_nuoc_khac"
  label: string
  coMucTieu: boolean
  tyLeMucTieu: number | null
  bySanPham: Record<string, { thang: QualityReportCell; luyKe: QualityReportCell }>
}

export type MonthlyQualityReportData = {
  nam: number
  thang: number
  sanPhamList: string[]
  tieuChuan: string
  rows: QualityReportRow[]
  tongTheoNhom: Record<"mu_tap" | "mu_nuoc_cv" | "mu_nuoc_khac", { thang: number; luyKe: number }>
  tongToanNhaMay: { thang: number; luyKe: number }
  tyLeDatToanNhaMay: { thang: number | null; luyKe: number | null }
}

function periodOf(row: QcResultRow, tuThang: string, denThang: string): "thang" | "luyKe_only" {
  const iso = normalizeDateInput(row.ngay_sx)
  return iso >= tuThang && iso <= denThang ? "thang" : "luyKe_only"
}

export async function buildMonthlyQualityReport(params: {
  factoryId: string
  nam: number
  thang: number
  sanPhamList: string[]
  tieuChuan: string
  chiTieuList: ChiTieuKey[]
}): Promise<MonthlyQualityReportData> {
  const { factoryId, nam, thang, sanPhamList, tieuChuan } = params
  const chiTieuList = Array.from(new Set([...params.chiTieuList, "tccs_tong" as ChiTieuKey]))
  const { tuThang, denThang, tuNam } = monthRange(nam, thang)

  const allRows = await fetchAllQcResults(factoryId, tuNam, denThang)
  const lotIds = allRows.map((r) => r.lot_id).filter((v): v is string => !!v)
  const lotWeights = await fetchLotWeights(lotIds)
  const targetRows = await fetchQualityTargets(factoryId, nam)
  const resolveTarget = buildTargetResolver(targetRows, nam)

  const weightOf = (row: QcResultRow): number => {
    if (row.lot_id) return lotWeights.get(row.lot_id)?.tong_kg || 0
    // fallback đơn giản theo ma_lo nếu lot_id lệch — không áp dụng đầy đủ rule canonical lot
    for (const lw of lotWeights.values()) if (lw.ma_lo === row.ma_lo) return lw.tong_kg
    return 0
  }

  const rows: QualityReportRow[] = []

  for (const chiTieu of chiTieuList) {
    for (const sanPham of sanPhamList) {
      const nhom = SAN_PHAM_GROUP[sanPham]
      if (!nhom) continue
      if (chiTieu !== "tccs_tong" && !getVisibleChiTieu(sanPham).includes(chiTieu)) continue

      const target = resolveTarget(chiTieu, sanPham)
      const rowsForSp = allRows.filter((r) => matchesSanPham(r.loai_csr, sanPham))

      const calcCell = (periodRows: QcResultRow[]): QualityReportCell => {
        let tu = 0
        let mau = 0
        if (chiTieu === "tccs_tong") {
          const chuanLoc = target?.tieu_chuan || tieuChuan
          for (const r of periodRows) {
            if (r.tieu_chuan !== chuanLoc) continue
            const w = weightOf(r)
            mau += w
            if (r.trang_thai === "dat") tu += w
          }
        } else {
          const threshold: CriterionThreshold = target
            ? { min: target.nguong_min, max: target.nguong_max }
            : thresholdFromStandard(getLimitsForStandard(sanPham, tieuChuan), chiTieu)
          for (const r of periodRows) {
            const pass = evalCriterion(r.samples?.[chiTieu], chiTieu, threshold)
            if (pass === null) continue
            const w = weightOf(r)
            mau += w
            if (pass) tu += w
          }
        }
        return { kl: +(tu / 1000).toFixed(3), tyLe: mau > 0 ? +((tu / mau) * 100).toFixed(2) : null }
      }

      const thangRows = rowsForSp.filter((r) => periodOf(r, tuThang, denThang) === "thang")
      const luyKeRows = rowsForSp // toàn bộ đã fetch trong khoảng tuNam..denThang

      const thangCell = calcCell(thangRows)
      const luyKeCell = calcCell(luyKeRows)
      if (thangCell.tyLe === null && luyKeCell.tyLe === null && !target) continue // không có dữ liệu lẫn mục tiêu -> bỏ dòng trống

      let existing = rows.find((r) => r.chiTieu === chiTieu && r.nhom === nhom)
      if (!existing) {
        const label = chiTieu === "tccs_tong"
          ? `Tỷ lệ đạt ${target?.tieu_chuan || tieuChuan} trên tổng sản phẩm sản xuất`
          : `Tỉ lệ ${chiTieuDisplayLabel(chiTieu, sanPham)}${target ? "" : ` theo ${tieuChuan}`}`
        existing = {
          chiTieu, nhom, label,
          coMucTieu: !!target,
          tyLeMucTieu: target?.ty_le_muc_tieu ?? null,
          bySanPham: {},
        }
        rows.push(existing)
      }
      existing.bySanPham[sanPham] = { thang: thangCell, luyKe: luyKeCell }
    }
  }

  const tongTheoNhom: MonthlyQualityReportData["tongTheoNhom"] = {
    mu_tap: { thang: 0, luyKe: 0 },
    mu_nuoc_cv: { thang: 0, luyKe: 0 },
    mu_nuoc_khac: { thang: 0, luyKe: 0 },
  }
  let tuDatThang = 0, mauThang = 0, tuDatLuyKe = 0, mauLuyKe = 0
  for (const r of allRows) {
    const sp = r.loai_csr.replace(/^(CSR|SVR)/, "")
    const nhom = SAN_PHAM_GROUP[sp]
    const w = weightOf(r)
    const isThang = periodOf(r, tuThang, denThang) === "thang"
    if (nhom) {
      if (isThang) tongTheoNhom[nhom].thang += w
      tongTheoNhom[nhom].luyKe += w
    }
    if (isThang) { mauThang += w; if (r.trang_thai === "dat") tuDatThang += w }
    mauLuyKe += w
    if (r.trang_thai === "dat") tuDatLuyKe += w
  }

  return {
    nam, thang, sanPhamList, tieuChuan, rows,
    tongTheoNhom: {
      mu_tap: { thang: +(tongTheoNhom.mu_tap.thang / 1000).toFixed(3), luyKe: +(tongTheoNhom.mu_tap.luyKe / 1000).toFixed(3) },
      mu_nuoc_cv: { thang: +(tongTheoNhom.mu_nuoc_cv.thang / 1000).toFixed(3), luyKe: +(tongTheoNhom.mu_nuoc_cv.luyKe / 1000).toFixed(3) },
      mu_nuoc_khac: { thang: +(tongTheoNhom.mu_nuoc_khac.thang / 1000).toFixed(3), luyKe: +(tongTheoNhom.mu_nuoc_khac.luyKe / 1000).toFixed(3) },
    },
    tongToanNhaMay: {
      thang: +(mauThang / 1000).toFixed(3),
      luyKe: +(mauLuyKe / 1000).toFixed(3),
    },
    tyLeDatToanNhaMay: {
      thang: mauThang > 0 ? +((tuDatThang / mauThang) * 100).toFixed(2) : null,
      luyKe: mauLuyKe > 0 ? +((tuDatLuyKe / mauLuyKe) * 100).toFixed(2) : null,
    },
  }
}

// ─── Báo cáo 2: Phân tích SPC theo (sản phẩm × chỉ tiêu) ───────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

export type ProcessCapability = {
  mean: number
  sd: number
  ucl: number
  lcl: number
  cp: number | null
  cpu: number | null
  cpl: number | null
  cpk: number | null
}

/**
 * Cp/Cpk theo mean±3×SD (population), đã verify khớp số liệu file mẫu tc_10/po_10.
 * Chỉ tính phía có giới hạn thật (không bịa biên giả định cho phía còn lại).
 */
export function calcProcessCapability(values: number[], usl: number | null, lsl: number | null): ProcessCapability {
  const m = mean(values)
  const s = populationSd(values)
  const ucl = m + 3 * s
  const lcl = m - 3 * s
  const cpu = usl != null && s > 0 ? (usl - m) / (3 * s) : null
  const cpl = lsl != null && s > 0 ? (m - lsl) / (3 * s) : null
  const cp = usl != null && lsl != null && s > 0 ? (usl - lsl) / (6 * s) : null
  const cpk = cpu != null && cpl != null ? Math.min(cpu, cpl) : cpu ?? cpl ?? null
  return { mean: m, sd: s, ucl, lcl, cp, cpu, cpl, cpk }
}

export type HistogramBin = { rangeLabel: string; from: number; to: number; count: number }

/** Bin histogram thật từ mảng giá trị thô (không dùng đường cong Gauss giả lập). */
export function buildHistogramBins(values: number[], binCount = 6): HistogramBin[] {
  if (!values.length) return []
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const width = span / binCount
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => {
    const from = lo + i * width
    const to = i === binCount - 1 ? hi : from + width
    return { from, to, rangeLabel: `${from.toFixed(3)}-${to.toFixed(3)}`, count: 0 }
  })
  for (const v of values) {
    let idx = width > 0 ? Math.floor((v - lo) / width) : 0
    if (idx >= binCount) idx = binCount - 1
    if (idx < 0) idx = 0
    bins[idx].count += 1
  }
  return bins
}

/**
 * Đánh giá Cpk theo thang phổ biến trong SPC/Six Sigma (tham chiếu AIAG SPC Manual và các
 * ngưỡng Cpk tiêu chuẩn ngành ô tô/Six Sigma: <1.0 không đạt, 1.0-1.33 tối thiểu,
 * 1.33-1.67 đạt yêu cầu (mốc AIAG khuyến nghị ≥1.33), 1.67-2.0 rất tốt, ≥2.0 mức Six Sigma).
 * Gắn ngữ cảnh chỉ tiêu + sản phẩm vào câu để tránh lặp nguyên văn khi in nhiều chỉ tiêu cùng đợt.
 */
function buildCpkNhanXet(cpk: number | null, chiTieuLabel: string, sanPham: string): string {
  if (cpk == null) return ""
  const spLabel = `CSR${sanPham}`
  const cpkStr = cpk.toFixed(2)
  if (cpk >= 2.0) {
    return `Chỉ số Cpk = ${cpkStr} — năng lực quy trình đối với chỉ tiêu ${chiTieuLabel} của ${spLabel} đạt mức Six Sigma, biến động thực tế rất nhỏ so với giới hạn kỹ thuật, gần như không phát sinh sản phẩm ngoài tiêu chuẩn. Tiếp tục duy trì phương pháp kiểm soát hiện tại.`
  }
  if (cpk >= 1.67) {
    return `Chỉ số Cpk = ${cpkStr} — quy trình kiểm soát chỉ tiêu ${chiTieuLabel} của ${spLabel} đạt năng lực rất tốt, dư địa an toàn lớn so với giới hạn kỹ thuật. Duy trì tần suất giám sát hiện hành.`
  }
  if (cpk >= 1.33) {
    return `Chỉ số Cpk = ${cpkStr} — quy trình đạt yêu cầu năng lực tối thiểu theo khuyến nghị phổ biến trong ngành (Cpk ≥ 1,33) đối với chỉ tiêu ${chiTieuLabel} của ${spLabel}. Nên tiếp tục theo dõi xu hướng để phòng ngừa trôi dạt.`
  }
  if (cpk >= 1.0) {
    return `Chỉ số Cpk = ${cpkStr} — năng lực quy trình chỉ tiêu ${chiTieuLabel} của ${spLabel} ở mức tối thiểu, biến động thực tế gần chạm giới hạn kỹ thuật. Cần rà soát nguyên nhân biến động và siết chặt kiểm soát để nâng dư địa an toàn.`
  }
  return `Chỉ số Cpk = ${cpkStr} — quy trình chưa đủ năng lực đáp ứng ổn định giới hạn kỹ thuật của chỉ tiêu ${chiTieuLabel} trên ${spLabel}, nguy cơ phát sinh sản phẩm ngoài tiêu chuẩn cao. Cần xác định nguyên nhân gốc và có hành động khắc phục ngay.`
}

export type SpcDailyRow = {
  ngayIso: string
  ngayLabel: string
  values: (number | null)[]
  xBar: number | null
  range: number | null
  soLo: number
}

export type CriterionSpcReportData = {
  nam: number
  thang: number
  sanPham: string
  chiTieu: ChiTieuKey
  tieuChuan: string
  maxSamplesInDay: number
  dailyRows: SpcDailyRow[]
  xBarOverall: number
  rOverall: number
  overall: ProcessCapability & { min: number; max: number; range: number; usl: number | null; lsl: number | null }
  rControl: { center: number; ucl: number; lcl: number }
  histogram: HistogramBin[]
  allValues: number[]
  targetValue: number | null
  nhanXet: string
}

/**
 * Nhóm theo ngày. Khi 1 ngày có nhiều lô (nhiều phiếu KN), mỗi "cột mẫu N" là TRUNG BÌNH
 * của vị trí mẫu thứ N qua tất cả các lô ngày đó — tránh bảng bị tràn cột khi ngày có
 * nhiều lô (vd 10 lô × 6 mẫu sẽ không hiện 60 cột mà vẫn chỉ 6 cột, mỗi cột là trung bình).
 * Số cột tối đa lấy theo so_mau lớn nhất của MỘT phiếu trong tháng (thường 6, có thể 14).
 */
export async function buildCriterionSpcReport(params: {
  factoryId: string
  nam: number
  thang: number
  sanPham: string
  chiTieu: ChiTieuKey
  tieuChuan: string
}): Promise<CriterionSpcReportData> {
  const { factoryId, nam, thang, sanPham, chiTieu, tieuChuan } = params
  const { tuThang, denThang } = monthRange(nam, thang)
  const [allRows, targetRows] = await Promise.all([
    fetchAllQcResults(factoryId, tuThang, denThang),
    fetchQualityTargets(factoryId, nam),
  ])
  const rowsForSp = allRows.filter((r) => matchesSanPham(r.loai_csr, sanPham))
  const targetValue = buildTargetResolver(targetRows, nam)(chiTieu, sanPham)?.target_value ?? null

  const byDay = new Map<string, QcResultRow[]>()
  let maxCols = 0
  for (const r of rowsForSp) {
    const iso = normalizeDateInput(r.ngay_sx)
    if (!iso) continue
    const vals = toNums(r.samples?.[chiTieu])
    if (!vals.length) continue
    maxCols = Math.max(maxCols, vals.length)
    if (!byDay.has(iso)) byDay.set(iso, [])
    byDay.get(iso)!.push(r)
  }

  const lastDay = new Date(nam, thang, 0).getDate()
  const dailyRows: SpcDailyRow[] = []
  const allValues: number[] = []
  const rangeValues: number[] = []

  for (let d = 1; d <= lastDay; d++) {
    const iso = `${nam}-${pad2(thang)}-${pad2(d)}`
    const rowsThatDay = byDay.get(iso) || []
    const lotSet = new Set(rowsThatDay.map((r) => r.ma_lo))

    const columnValues: (number | null)[] = []
    for (let i = 0; i < maxCols; i++) {
      const valsAtPos = rowsThatDay
        .map((r) => toNums(r.samples?.[chiTieu])[i])
        .filter((v): v is number => v != null && !Number.isNaN(v))
      columnValues.push(valsAtPos.length ? mean(valsAtPos) : null)
    }
    const validCols = columnValues.filter((v): v is number => v != null)
    const xBar = validCols.length ? mean(validCols) : null
    const range = validCols.length ? Math.max(...validCols) - Math.min(...validCols) : null
    if (validCols.length) {
      allValues.push(...validCols)
      rangeValues.push(range as number)
    }

    dailyRows.push({
      ngayIso: iso,
      ngayLabel: `${d}/${thang}/${String(nam).slice(2)}`,
      values: columnValues, xBar, range,
      soLo: lotSet.size,
    })
  }

  const limits = getLimitsForStandard(sanPham, tieuChuan)
  const th = thresholdFromStandard(limits, chiTieu)
  const meta = CHI_TIEU_META[chiTieu]
  const usl = meta.bound === "max" || meta.bound === "range" ? th.max ?? null : null
  const lsl = meta.bound === "min" || meta.bound === "range" ? th.min ?? null : null

  const cap = calcProcessCapability(allValues, usl, lsl)
  const overall = {
    ...cap,
    min: allValues.length ? Math.min(...allValues) : 0,
    max: allValues.length ? Math.max(...allValues) : 0,
    range: allValues.length ? Math.max(...allValues) - Math.min(...allValues) : 0,
    usl, lsl,
  }

  const rMean = mean(rangeValues)
  const rSd = populationSd(rangeValues)
  const rControl = { center: rMean, ucl: rMean + 3 * rSd, lcl: Math.max(0, rMean - 3 * rSd) }

  const histogram = buildHistogramBins(allValues, 12)

  const nhanXet = buildCpkNhanXet(cap.cpk, chiTieuDisplayLabel(chiTieu, sanPham), sanPham)

  return {
    nam, thang, sanPham, chiTieu, tieuChuan,
    maxSamplesInDay: maxCols,
    dailyRows,
    xBarOverall: mean(allValues),
    rOverall: rMean,
    overall,
    rControl,
    histogram,
    allValues,
    targetValue,
    nhanXet,
  }
}
