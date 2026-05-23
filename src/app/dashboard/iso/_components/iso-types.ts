// Types và constants cho module Quản lý ISO

export type IsoTrangThai =
  | "draft"
  | "cho_xem_xet"
  | "cho_phe_duyet"
  | "co_hieu_luc"
  | "het_hieu_luc"
  | "tra_ve"

export type IsoDocument = {
  id: string
  factory_id: string
  ma_tai_lieu: string | null
  ten_tai_lieu: string
  loai_tai_lieu: string | null
  phong_ban: string | null
  cap_tl: string | null        // "Cấp 1" | "Cấp 2"
  chon_quy_trinh: string | null // "Soạn thảo" | "Soát xét"
  loai_vb: string
  lan_ban_hanh: number
  trang_thai: IsoTrangThai
  soan_thao: string | null
  xem_xet: string | null
  phe_duyet: string | null
  soan_thao_user_id: string | null
  xem_xet_user_id: string | null
  phe_duyet_user_id: string | null
  file_goc_url: string | null
  file_soat_xet_url: string | null
  file_signed_pdf_url: string | null
  ky_soan_thao_at: string | null
  ky_xem_xet_at: string | null
  ky_phe_duyet_at: string | null
  ma_tai_lieu_moi: string | null
  ngay_hieu_luc: string | null
  ngay_het_hieu_luc: string | null
  qr_url: string | null
  ghi_chu: string | null
  phan_loai_tl: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type IsoDocumentForm = {
  ma_tai_lieu: string
  so_hieu: string            // 2 chữ số, dùng để auto-generate ma_tai_lieu
  ten_tai_lieu: string
  loai_tai_lieu: string
  phong_ban: string
  cap_tl: string
  chon_quy_trinh: string
  lan_ban_hanh: string
  soan_thao: string
  soan_thao_user_id: string
  xem_xet: string
  xem_xet_user_id: string
  phe_duyet: string
  phe_duyet_user_id: string
  ghi_chu: string
  ma_tai_lieu_moi: string
  phan_loai_tl: string
}

// Danh sách loại tài liệu theo bảng chuẩn ISO của công ty
export const LOAI_TAI_LIEU_OPTIONS = [
  "CS", "OB", "ST", "QC", "TC", "QT", "HD", "MT", "QĐ", "PL", "F",
] as const

export const LOAI_TAI_LIEU_LABEL: Record<string, string> = {
  CS: "Chính sách",
  OB: "Mục tiêu",
  ST: "Sổ tay",
  QC: "Quy chế",
  TC: "Tiêu chuẩn",
  QT: "Quy trình",
  HD: "Hướng dẫn",
  MT: "Mô tả",
  "QĐ": "Quy định",
  PL: "Phụ lục",
  F: "Biểu mẫu",
}

export const PHONG_BAN_OPTIONS = [
  "PHK", "KTNN", "QLCL", "KHXD", "TCKT", "TCHC", "TTBV", "NMCB", "CS"
] as const

export const TRANG_THAI_LABEL: Record<IsoTrangThai, string> = {
  draft: "Nháp",
  cho_xem_xet: "Chờ xem xét",
  cho_phe_duyet: "Chờ phê duyệt",
  co_hieu_luc: "Có hiệu lực",
  het_hieu_luc: "Hết hiệu lực",
  tra_ve: "Trả về",
}

export const TRANG_THAI_COLOR: Record<IsoTrangThai, string> = {
  draft: "bg-slate-100 text-slate-600",
  cho_xem_xet: "bg-amber-100 text-amber-700",
  cho_phe_duyet: "bg-orange-100 text-orange-700",
  co_hieu_luc: "bg-emerald-100 text-emerald-700",
  het_hieu_luc: "bg-red-100 text-red-600",
  tra_ve: "bg-rose-100 text-rose-700",
}

// Auto-generate mã tài liệu từ phòng ban + loại + số hiệu
export function buildMaTaiLieu(pb: string, loai: string, so: string): string {
  if (!pb || !loai || !so) return ""
  const num = parseInt(so)
  if (isNaN(num) || num < 1) return ""
  return `${pb}-${loai}-${String(num).padStart(2, "0")}`
}

export function emptyIsoForm(): IsoDocumentForm {
  return {
    ma_tai_lieu: "",
    so_hieu: "",
    ten_tai_lieu: "",
    loai_tai_lieu: "QT",
    phong_ban: "",
    cap_tl: "Cấp 1",
    chon_quy_trinh: "Soạn thảo",
    lan_ban_hanh: "0",
    soan_thao: "",
    soan_thao_user_id: "",
    xem_xet: "",
    xem_xet_user_id: "",
    phe_duyet: "",
    phe_duyet_user_id: "",
    ghi_chu: "",
    ma_tai_lieu_moi: "",
    phan_loai_tl: "cha",
  }
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return ""
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  const day = String(dt.getDate()).padStart(2, "0")
  const month = String(dt.getMonth() + 1).padStart(2, "0")
  const year = dt.getFullYear()
  return `${day}/${month}/${year}`
}
