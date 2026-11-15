// Định mức KTKT GĐ4 — kiểu dữ liệu + hằng số báo cáo kỳ (module THUẦN, client lẫn server). Rule 30.
// Chỉ 2 mẫu: Mẫu 8A-NMCB (kết quả sản xuất tháng) và Mẫu 09-NMCB (điện nước). Báo cáo theo ngày VT HC / dầu
// (mẫu 55, 46) thuộc tab Báo cáo của Kho vật tư — xem .claude/plans/kho-vat-tu-bao-cao-ngay.md.
//
// Mỗi "bộ báo cáo kỳ" (tech_norm_report_batches) giữ 1 SNAPSHOT JSON dùng chung cho mọi mẫu tick ⇒ số liệu
// giữa các mẫu luôn khớp (vd tổng dầu Mẫu 12B = mục 6 Mẫu 8A). Snapshot chỉ giữ số đã gom (không giữ từng
// giao dịch) để nhỏ gọn; hash snapshot (`du_lieu_hash`) dùng báo "Đã ký — dữ liệu đã đổi".

import type { OutsideKind, ReconcileBreakdown } from "./compute"
import type { NormBasis, NormGroup, NormMeterLoai, NormUnit } from "./types"

export type NormReportKieu = "thang_8a" | "dong_ho"
export type NormReportStatus = "nhap" | "cho_ky" | "da_ky" | "tra_ve" | "huy"

export const NORMS_MODUN = "norms"
/** yeu_cau_ky.loai_tai_lieu theo kiểu mẫu. */
export const NORM_REPORT_LOAI_TAI_LIEU: Record<NormReportKieu, string> = {
  thang_8a: "norm_report_8a",
  dong_ho: "norm_report_09",
}

export const NORM_REPORT_STATUS_LABEL: Record<NormReportStatus, string> = {
  nhap: "Nháp",
  cho_ky: "Chờ ký",
  da_ky: "Đã ký",
  tra_ve: "Bị trả về",
  huy: "Đã huỷ",
}

/** Thứ tự ký: Người lập (10, ky) → Ban giám đốc (20, phe_duyet). */
export type NormReportSignRole = "nguoi_lap" | "bgd"
export const NORM_REPORT_SIGN_ORDER: Record<NormReportSignRole, { thuTu: number; vaiTro: "ky" | "phe_duyet"; label: string }> = {
  nguoi_lap: { thuTu: 10, vaiTro: "ky", label: "Lập biểu" },
  bgd: { thuTu: 20, vaiTro: "phe_duyet", label: "Giám đốc nhà máy" },
}

/** Cấu hình Mẫu 8A: thành phần nhà máy (mỗi dòng 1 người) + mã chỉ tiêu in ở mục 7 (xử lý nước thải). */
// Thành phần nhà máy in đầu 8A: chọn từ nhân sự thật (maintenance_staff) — lưu SNAPSHOT tên + chức vụ lúc lưu mẫu.
export type ThanhPhanMember = { staffId: string | null; danhXung: string; ten: string; chucVu: string }
export type Thang8aConfig = { thanhPhan?: string; thanhPhanList?: ThanhPhanMember[]; xlntItemCodes?: string[] }

// Dòng thành phần để in: ưu tiên danh sách chọn; không có ⇒ tách text cũ ("Ông: X — Chức vụ: Y" / "Ông: X  Chức vụ: Y").
export function thanhPhanRows(cfg: Thang8aConfig): Array<{ left: string; chucVu: string }> {
  const list = (cfg.thanhPhanList || []).filter((m) => (m.ten || "").trim())
  if (list.length) return list.map((m) => ({ left: `${(m.danhXung || "Ông").trim()}: ${m.ten.trim()}`, chucVu: (m.chucVu || "").trim() }))
  return String(cfg.thanhPhan || "")
    .split(/\r?\n/)
    .map((x) => x.trim().replace(/^-\s*/, ""))
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)\s*(?:[—–-]\s*|\s{2,}|,\s*)?chức\s*vụ\s*:?\s*(.*)$/iu)
      return m ? { left: m[1].trim().replace(/[—–,-]\s*$/, "").trim(), chucVu: m[2].trim() } : { left: line, chucVu: "" }
    })
}

export type NormReportTemplate = {
  id: string
  factory_id: string
  code: string
  name: string
  kieu: NormReportKieu
  config: Record<string, unknown>
  phong_ban: string
  loai_van_ban: string
  khoa_ngay: boolean
  phien_ban: number
  is_active: boolean
  sort_order: number
}

export type NormReportBatch = {
  id: string
  factory_id: string
  tu_ngay: string
  den_ngay: string
  materials: string[]
  notes: string[]
  meter_from: string | null
  meter_to: string | null
  snapshot: NormReportSnapshot
  du_lieu_hash: string | null
  created_by: string | null
  created_at: string
}

export type NormReport = {
  id: string
  factory_id: string
  batch_id: string
  template_id: string | null
  template_code: string
  template_name: string
  template_kieu: NormReportKieu
  template_phien_ban: number
  config: Record<string, unknown>
  khoa_ngay: boolean
  phong_ban: string
  loai_van_ban: string
  nam: number | null
  so: number | null
  ma_bao_cao: string | null
  trang_thai: NormReportStatus
  giai_trinh: Record<string, string>
  kien_nghi: string | null
  nguoi_lap_id: string | null
  bgd_id: string | null
  yeu_cau_ky_id: string | null
  van_ban_document_id: string | null
  du_lieu_hash: string | null
  khoa_tu: string | null
  khoa_den: string | null
  gui_ky_luc: string | null
  da_ky_luc: string | null
  ly_do_huy: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export type SnapLine = {
  key: string
  itemCode: string
  itemName: string
  group: NormGroup
  basis: NormBasis
  unit: NormUnit
  dayChuyen: string | null
  driver: number
  allowed: number
  actual: number | null
  avgNorm: number | null
  avgActual: number | null
  diff: number | null
  diffPct: number | null
  breakdown: ReconcileBreakdown[]
  notes: string[]
  warnings: string[]
}

export type SnapOutside = { key: string; kind: OutsideKind; group: string; code: string; name: string; unit: string; qty: number | null; note: string }

/** NL tiếp nhận theo đơn vị (Đội N / Thu mua …) × loại mủ — kg, KHÔNG theo bộ lọc ký hiệu KT (mục 1 Mẫu 8A). */
export type SnapNlUnit = { label: string; order: number; tuoi: Record<string, number>; kho: Record<string, number> }

/** Thành phẩm theo CSR × nguồn — kg. Khoá nguồn: cong_ty | gia_cong | thu_mua | khac. */
export type SnapTpRow = { csr: string; kg: Record<string, number> }

export type SnapMeter = {
  id: string
  code: string
  name: string
  khuVuc: string
  loai: NormMeterLoai
  heSo: number
  chiSoCu: number | null
  chiSoMoi: number | null
  raw: number | null
  value: number | null
  sortOrder: number
  note: string
}

export type SnapExportExtra = { ngay: string; csr: string; nguon: string; kg: number; ghiChu: string | null }

export type NormReportSnapshot = {
  v: 1
  from: string
  to: string
  materials: string[]
  notes: string[]
  meterFrom: string | null
  meterTo: string | null
  draftUsed: boolean
  versions: Array<{ id: string; name: string; effective_from: string; effective_to: string | null; status: string }>
  totals: {
    tpTons: number
    tpTonsNoNorm: number
    nlKhoTons: number
    nlTuoiTons: number
    kmByType: Array<{ vehicleType: string; km: number }>
    thayBocTons: number
  }
  lines: SnapLine[]
  outside: SnapOutside[]
  warnings: string[]
  nlUnits: SnapNlUnit[]
  tpByCsr: SnapTpRow[]
  tpExport: SnapTpRow[]
  tpExportWarnings: string[]
  /** Xuất kho bù (lô ngoài hệ thống, bảng tech_norm_export_extra) — ĐÃ cộng vào tpExport. Chỉ có khi kỳ có dòng bù
   *  (vắng ⇒ snapshot cũ / không có bù, giữ nguyên hash các báo cáo đã ký). */
  tpExportExtra?: SnapExportExtra[]
  meters: SnapMeter[]
}

export const TP_NGUON_KEYS = ["cong_ty", "gia_cong", "thu_mua", "khac"] as const
export const TP_NGUON_LABEL: Record<(typeof TP_NGUON_KEYS)[number], string> = {
  cong_ty: "Công ty",
  gia_cong: "Gia công",
  thu_mua: "Thu mua",
  khac: "Khác",
}

// ─── Hash ổn định ────────────────────────────────────────────────────────────

/** JSON ổn định: khoá object sắp xếp, số làm tròn 6 chữ số (tránh lệch dấu phẩy động khi tính lại). */
export function canonicalSnapshotJson(value: unknown): string {
  if (value === undefined || value === null) return "null"
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(Math.round(value * 1e6) / 1e6) : "null"
  if (typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => canonicalSnapshotJson(v)).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalSnapshotJson(obj[k])}`).join(",")}}`
}

/** sha256 hex của snapshot (Web Crypto — chạy được ở trình duyệt và Node ≥ 20). */
export async function hashNormSnapshot(snapshot: NormReportSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSnapshotJson(snapshot))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** Khoảng ngày khoá nhập liệu khi báo cáo đang ký / đã ký (null = mẫu không khoá). */
export function reportLockRange(kieu: NormReportKieu, khoaNgay: boolean, snap: Pick<NormReportSnapshot, "from" | "to" | "meterFrom" | "meterTo">, addDays: (iso: string, n: number) => string): { tu: string; den: string } | null {
  if (!khoaNgay) return null
  if (kieu === "dong_ho") return snap.meterFrom && snap.meterTo ? { tu: snap.meterFrom, den: snap.meterTo } : null
  // 8A: gồm kiểm kê đầu kỳ (F−1) và mọi dòng xuất trong [F, T].
  return { tu: addDays(snap.from, -1), den: snap.to }
}

export function fmtDateVN(iso: string | null | undefined): string {
  if (!iso) return ""
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : iso
}

export const NORM_REPORT_PATH = (id: string) => `/dashboard/norms/report/${id}`
