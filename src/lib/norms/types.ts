// Định mức KTKT — kiểu dữ liệu + nhãn dùng chung (module THUẦN, client lẫn server). Rule 30.

export type NormGroup = "hoa_chat" | "vat_tu" | "dau_nhot_mo" | "dien_nuoc" | "van_chuyen" | "khac"
export type NormActualSource = "kho" | "dong_ho"
export type NormBasis = "tan_tp" | "tan_nl_kho" | "tan_nl_tuoi" | "km100"
export type NormUnit = "kg" | "lit" | "kwh" | "m3"
export type NormVersionStatus = "draft" | "active" | "locked"
export type NguonCode = "cong_ty" | "thu_mua" | "gia_cong" | "thanh_ly"

export type NormItem = {
  id: string
  factory_id: string
  code: string
  name: string
  norm_group: NormGroup
  actual_source: NormActualSource
  inventory_item_ids: string[]
  vehicle_types: string[]
  ghi_chu: string | null
  sort_order: number
  is_active: boolean
}

export type NormVersion = {
  id: string
  factory_id: string
  nam: number
  code: string
  name: string
  decision_no: string | null
  decision_date: string | null
  effective_from: string
  effective_to: string | null
  status: NormVersionStatus
  ghi_chu: string | null
  applied_at: string | null
  created_at: string
}

export type NormVersionItem = {
  id: string
  version_id: string
  item_id: string
  basis: NormBasis
  unit: NormUnit
  sort_order: number
}

export type NormRow = {
  id: string
  version_id: string
  day_chuyen: string
  csr_codes: string[]
  nguon_codes: NguonCode[]
  label: string | null
  sort_order: number
}

export type NormValue = {
  id: string
  version_id: string
  item_id: string
  row_id: string | null
  value: number
  merge_key: string | null
  note: string | null
}

export const NORM_GROUPS: NormGroup[] = ["hoa_chat", "vat_tu", "dau_nhot_mo", "dien_nuoc", "van_chuyen", "khac"]

export const NORM_GROUP_LABEL: Record<NormGroup, string> = {
  hoa_chat: "Hóa chất",
  vat_tu: "Vật tư",
  dau_nhot_mo: "Dầu nhớt mỡ",
  dien_nuoc: "Điện nước",
  van_chuyen: "Vận chuyển",
  khac: "Khác",
}

export const NORM_BASIS_LABEL: Record<NormBasis, string> = {
  tan_tp: "tấn thành phẩm",
  tan_nl_kho: "tấn nguyên liệu quy khô",
  tan_nl_tuoi: "tấn nguyên liệu tươi",
  km100: "100 km",
}

export const NORM_BASIS_SHORT: Record<NormBasis, string> = {
  tan_tp: "tấn TP",
  tan_nl_kho: "tấn NL khô",
  tan_nl_tuoi: "tấn NL tươi",
  km100: "100 km",
}

export const NORM_UNIT_LABEL: Record<NormUnit, string> = { kg: "kg", lit: "lít", kwh: "kWh", m3: "m³" }

export const NORM_ACTUAL_SOURCE_LABEL: Record<NormActualSource, string> = {
  kho: "Xuất kho vật tư",
  dong_ho: "Chỉ số đồng hồ",
}

/** "kg/tấn TP", "lít/100 km"… */
export function normUnitText(unit: NormUnit, basis: NormBasis): string {
  return `${NORM_UNIT_LABEL[unit]}/${NORM_BASIS_SHORT[basis]}`
}

export const NGUON_CODES: NguonCode[] = ["cong_ty", "thu_mua", "gia_cong", "thanh_ly"]

export const NGUON_LABEL: Record<NguonCode, string> = {
  cong_ty: "Nông trường (NT)",
  thu_mua: "Thu mua (TM)",
  gia_cong: "Gia công",
  thanh_ly: "Thanh lý",
}

export const NGUON_SHORT: Record<NguonCode, string> = {
  cong_ty: "NT",
  thu_mua: "TM",
  gia_cong: "GC",
  thanh_ly: "TL",
}

/** Nhãn của makeNguonResolver (src/lib/lot-source.ts) → mã nguồn định mức. Nhãn lạ ⇒ null. */
export function nguonCodeFromLabel(label: string | null | undefined): NguonCode | null {
  switch ((label || "").trim()) {
    case "Công ty":
      return "cong_ty"
    case "Thu mua":
      return "thu_mua"
    case "Gia công":
      return "gia_cong"
    case "Thanh lý":
      return "thanh_ly"
    default:
      return null
  }
}

/** "NT + GC" / "Mọi nguồn". */
export function nguonListText(codes: NguonCode[]): string {
  if (!codes.length) return "Mọi nguồn"
  return NGUON_CODES.filter((c) => codes.includes(c)).map((c) => NGUON_SHORT[c]).join(" + ")
}

/** Bỏ tiền tố CSR/SVR cho gọn: CSRCV50 → CV50. */
export function shortCsr(code: string): string {
  return code.replace(/^(CSR|SVR)/i, "") || code
}

export function fmtNormValue(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return ""
  return v.toLocaleString("vi-VN", { maximumFractionDigits: 4 })
}

/** "1,9" / "1.9" → 1.9; rỗng ⇒ null; sai ⇒ NaN. */
export function parseNormInput(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "")
  if (!s) return null
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s
  const n = Number(normalized)
  return Number.isFinite(n) ? n : Number.NaN
}

/** Thông báo lỗi DB dễ hiểu (bỏ mã kỹ thuật trước dấu ":"). */
export function normDbErrorText(message: string): string {
  const m = message.match(/(NORM_[A-Z_]+):\s*([\s\S]*)$/)
  if (m) return m[2]
  if (message.includes("duplicate key") && message.includes("tech_norm_versions")) return "Mã khung đã tồn tại."
  if (message.includes("duplicate key") && message.includes("tech_norm_items")) return "Mã chỉ tiêu đã tồn tại."
  return message
}
