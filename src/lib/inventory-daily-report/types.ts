// Kho vật tư — Báo cáo sử dụng theo ngày (55-BC VT HC, 46-BC Mẫu 12B dầu). Module THUẦN (client & server). Rule 13.

export type DailyReportKieu = "vt_hc" | "dau_12b"
export type DailyReportStatus = "nhap" | "cho_ky" | "da_ky" | "tra_ve" | "huy"
export type DailyReportSignRole = "nguoi_lap" | "bgd"

export const INVENTORY_REPORT_MODUN = "inventory_report"
export const DAILY_REPORT_LOAI_TAI_LIEU: Record<DailyReportKieu, string> = {
  vt_hc: "inventory_daily_vt_hc",
  dau_12b: "inventory_daily_dau_12b",
}
export const DAILY_REPORT_KIEU_LABEL: Record<DailyReportKieu, string> = {
  vt_hc: "Sử dụng vật tư hóa chất theo ngày (mẫu 55-BC)",
  dau_12b: "Sử dụng dầu theo ngày (Mẫu 12B, mẫu 46-BC)",
}
/** Mã mẫu in trên QR khi mẫu báo cáo để trống (người dùng chốt 2026-11-15: VT HC = Mẫu 12C-NMCB). */
export const DAILY_REPORT_DEFAULT_MA_MAU: Record<DailyReportKieu, string> = {
  vt_hc: "Mẫu 12C-NMCB",
  dau_12b: "Mẫu 12B-NMCB",
}
export const maMauOf = (kieu: DailyReportKieu, cfg: DailyReportConfig | null | undefined): string =>
  (cfg?.maMau || "").trim() || DAILY_REPORT_DEFAULT_MA_MAU[kieu] || ""
export const DAILY_REPORT_STATUS_LABEL: Record<DailyReportStatus, string> = {
  nhap: "Nháp",
  cho_ky: "Chờ ký",
  da_ky: "Đã ký",
  tra_ve: "Bị trả về",
  huy: "Đã huỷ",
}
export const DAILY_REPORT_SIGN_ORDER: Record<DailyReportSignRole, { thuTu: number; vaiTro: "ky" | "phe_duyet"; label: string }> = {
  nguoi_lap: { thuTu: 10, vaiTro: "ky", label: "Lập bảng" },
  bgd: { thuTu: 20, vaiTro: "phe_duyet", label: "Giám đốc nhà máy" },
}
export const DAILY_REPORT_PATH = (id: string) => `/dashboard/inventory/daily-reports/${id}`

export type DailyReportColumn = { label: string; subLabel?: string; itemIds: string[] }
export type DailyReportConfig = {
  tieuDe?: string
  maMau?: string
  nhanLap?: string
  chucVuLap?: string
  hideZero?: boolean
  columns?: DailyReportColumn[]
}

export type DailyReportTemplate = {
  id: string
  factory_id: string
  code: string
  name: string
  kieu: DailyReportKieu
  config: DailyReportConfig
  phien_ban: number
  is_active: boolean
  sort_order: number
}

/** Vật tư trong cột (snapshot lúc lập — đổi danh mục sau không đổi báo cáo). */
export type SnapItem = { id: string; code: string; name: string; unit: string }
export type SnapColumn = { label: string; subLabel: string; items: SnapItem[]; unit: string; total: number }
export type DailyReportSnapshot = {
  from: string
  to: string
  kieu: DailyReportKieu
  days: string[]
  columns: SnapColumn[]
  /** values[i][j] = ngày i × cột j. */
  values: number[][]
  grandTotal: number
  /** Số ngày × vật tư lấy từ dữ liệu lịch sử (file NXT cũ). */
  legacyCells: number
  warnings: string[]
}

export type DailyReport = {
  id: string
  factory_id: string
  template_id: string | null
  template_code: string
  template_name: string
  template_kieu: DailyReportKieu
  template_phien_ban: number
  config: DailyReportConfig
  tu_ngay: string
  den_ngay: string
  snapshot: DailyReportSnapshot
  du_lieu_hash: string | null
  phong_ban: string
  loai_van_ban: string
  nam: number | null
  so: number | null
  ma_bao_cao: string | null
  trang_thai: DailyReportStatus
  nguoi_lap_id: string | null
  bgd_id: string | null
  yeu_cau_ky_id: string | null
  gui_ky_luc: string | null
  da_ky_luc: string | null
  ly_do_huy: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const fmtDateVN = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "")
/** dd/mm/yy như mẫu giấy. */
export const fmtDayShort = (iso: string) => {
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y.slice(2)}`
}

export function periodLabel(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-")
  const [ty, tm, td] = to.split("-")
  const lastDay = new Date(Date.UTC(Number(ty), Number(tm), 0)).getUTCDate()
  if (fy === ty && fm === tm && fd === "01" && Number(td) === lastDay) return `THÁNG ${Number(tm)} NĂM ${ty}`
  return `TỪ NGÀY ${fmtDateVN(from)} ĐẾN NGÀY ${fmtDateVN(to)}`
}

export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null"
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(Math.round(value * 1e6) / 1e6) : "null"
  if (typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`
}

/** sha256 hex của phần SỐ LIỆU snapshot (bỏ cảnh báo) — dùng phát hiện "Đã ký — dữ liệu đã đổi". */
export async function hashDailySnapshot(s: DailyReportSnapshot): Promise<string> {
  const core = { from: s.from, to: s.to, days: s.days, columns: s.columns.map((c) => ({ label: c.label, items: c.items.map((i) => i.id) })), values: s.values }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(core)))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
