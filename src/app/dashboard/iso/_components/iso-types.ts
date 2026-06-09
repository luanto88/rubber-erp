// Types và constants cho module Quản lý ISO

export type IsoTrangThai =
  | "draft"
  | "cho_xem_xet"
  | "cho_phe_duyet"
  | "co_hieu_luc"
  | "het_hieu_luc"
  | "tra_ve"
  | "bi_tu_choi_phe_duyet"

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
  lan_ban_hanh: string
  trang_thai: IsoTrangThai
  soan_thao: string | null
  xem_xet: string | null
  phe_duyet: string | null
  soan_thao_user_id: string | null
  xem_xet_user_id: string | null
  phe_duyet_user_id: string | null
  file_goc_url: string | null
  file_template_url?: string | null
  file_soat_xet_url: string | null
  file_phieu_yeu_cau_thay_doi_url: string | null
  file_de_nghi_soat_xet_url: string | null
  file_signed_pdf_url: string | null
  file_signed_office_url?: string | null
  file_signed_office_type?: string | null
  file_phieu_yeu_cau_thay_doi_signed_url?: string | null
  file_de_nghi_soat_xet_signed_url?: string | null
  soan_thao_placement: Record<string, number> | null
  xem_xet_placement: Record<string, number> | null
  phe_duyet_placement: Record<string, number> | null
  ky_soan_thao_at: string | null
  ky_xem_xet_at: string | null
  ky_phe_duyet_at: string | null
  doi_ma_tai_lieu: boolean | null
  ma_tai_lieu_cu: string | null
  ly_do_soat_xet: string | null
  noi_dung_soat_xet: string | null
  ma_tai_lieu_moi: string | null
  ngay_hieu_luc: string | null
  ngay_het_hieu_luc: string | null
  qr_url: string | null
  ghi_chu: string | null
  mo_ta_tim_kiem: string | null
  phan_loai_tl: string | null
  parent_doc_id?: string | null
  standards?: IsoStandard[]
  auto_convert_pdf?: boolean | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type IsoStandard = {
  id: number
  tieu_chuan: string
  ten_tieu_chuan: string
  is_active?: boolean
  sort_order?: number
}

export type IsoDocumentTypeMaster = {
  code: string
  name: string
  can_parent: boolean
  can_child: boolean
  force_child: boolean
  allowed_departments: string[]
  is_active?: boolean
  sort_order?: number
}

export type IsoDocumentForm = {
  ma_tai_lieu: string          // auto-generated (readonly)
  ma_tai_lieu_cu: string       // review source code
  // Tài liệu Cha: phong_ban + loai_tai_lieu + so_hieu → ma_tai_lieu
  so_hieu: string              // số hiệu của TL (Cha: serial của TL; Con: serial con)
  // Hồ sơ Con: phong_ban + loai_tai_lieu_cha + so_hieu_cha → ma_tai_lieu_cha
  loai_tai_lieu_cha: string    // loại TL của tài liệu cha (Con mode, e.g. "QT")
  so_hieu_cha: string          // số hiệu cha (Con mode, e.g. "02")
  ma_tai_lieu_cha: string      // mã cha auto-derived (e.g. "NMCB-QT01")
  ten_tai_lieu: string
  ten_tai_lieu_cu: string      // review source title
  loai_tai_lieu: string        // loại TL của chính tài liệu này
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
  mo_ta_tim_kiem: string
  standard_ids: number[]
  doi_ma_tai_lieu: boolean
  ly_do_soat_xet: string
  noi_dung_soat_xet: string
  ma_tai_lieu_moi: string
  phan_loai_tl: string         // "cha" | "con"
}

export const ISO_STANDARD_FALLBACK: IsoStandard[] = [
  { id: 1, tieu_chuan: "ISO 9001:2015", ten_tieu_chuan: "He thong quan ly chat luong", sort_order: 1 },
  { id: 2, tieu_chuan: "ISO 14001:2015", ten_tieu_chuan: "He thong quan ly moi truong", sort_order: 2 },
  { id: 3, tieu_chuan: "PEFC ST 2002-1:2024", ten_tieu_chuan: "Cac yeu cau doi voi viec trien khai He thong tham dinh chi tiet PEFC EUDR (PEFC EUDR DDS)", sort_order: 3 },
  { id: 4, tieu_chuan: "ISO/IEC 17025:2017", ten_tieu_chuan: "Tieu chuan phong thi nghiem", sort_order: 4 },
  { id: 5, tieu_chuan: "ISO 14067:2018", ten_tieu_chuan: "Truy van dau vet cacbon", sort_order: 5 },
]

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

// Loại tài liệu Cha (không bao gồm F là luôn Con)
export const LOAI_CHA_OPTIONS = ["CS", "OB", "ST", "QC", "TC", "QT", "HD", "MT", "QĐ", "PL"] as const

// Loại hồ sơ Con (PL, HD có thể Cha hoặc Con; F luôn Con)
export const LOAI_CON_OPTIONS = ["PL", "HD", "F"] as const

// Mapping loai_tai_lieu → phòng ban được phép
export const LOAI_PHONG_BAN_MAP: Record<string, string[]> = {
  CS:   ["PHK"],
  OB:   ["PHK"],
  ST:   ["PHK"],
  QC:   ["PHK"],
  TC:   ["PHK", "KHXD", "NMCB", "QLCL", "KTNN", "TCKT", "TCHC", "TTBV"],
  QT:   ["PHK", "KHXD", "NMCB", "QLCL", "KTNN", "TCKT", "TCHC", "TTBV"],
  HD:   ["PHK", "KHXD", "NMCB", "QLCL", "KTNN", "TCKT", "TCHC", "TTBV"],
  MT:   ["PHK", "KHXD", "NMCB", "QLCL", "KTNN", "TCKT", "TCHC", "TTBV"],
  PL:   ["PHK", "KHXD", "NMCB", "QLCL", "KTNN", "TCKT", "TCHC", "TTBV"],
  "QĐ": ["PHK", "KHXD", "NMCB", "QLCL", "KTNN", "TCKT", "TCHC", "TTBV"],
  F:    ["PHK", "KHXD", "NMCB", "QLCL", "KTNN", "TCKT", "TCHC", "TTBV"],
}

export const PHONG_BAN_OPTIONS = [
  "PHK", "KTNN", "QLCL", "KHXD", "TCKT", "TCHC", "TTBV", "NMCB", "CS"
] as const

export function isoDocumentTypeFallback(): IsoDocumentTypeMaster[] {
  return LOAI_TAI_LIEU_OPTIONS.map((code, index) => ({
    code,
    name: LOAI_TAI_LIEU_LABEL[code],
    can_parent: (LOAI_CHA_OPTIONS as readonly string[]).includes(code),
    can_child: (LOAI_CON_OPTIONS as readonly string[]).includes(code),
    force_child: code === "F",
    allowed_departments: LOAI_PHONG_BAN_MAP[code] || [...PHONG_BAN_OPTIONS],
    sort_order: index + 1,
  }))
}

export const TRANG_THAI_LABEL: Record<IsoTrangThai, string> = {
  draft: "Nháp",
  cho_xem_xet: "Chờ xem xét",
  cho_phe_duyet: "Chờ phê duyệt",
  co_hieu_luc: "Có hiệu lực",
  het_hieu_luc: "Hết hiệu lực",
  tra_ve: "Trả về",
  bi_tu_choi_phe_duyet: "Phê duyệt từ chối",
}

export const TRANG_THAI_COLOR: Record<IsoTrangThai, string> = {
  draft: "bg-slate-100 text-slate-600",
  cho_xem_xet: "bg-amber-100 text-amber-700",
  cho_phe_duyet: "bg-orange-100 text-orange-700",
  co_hieu_luc: "bg-emerald-100 text-emerald-700",
  het_hieu_luc: "bg-red-100 text-red-600",
  tra_ve: "bg-rose-100 text-rose-700",
  bi_tu_choi_phe_duyet: "bg-red-100 text-red-700",
}

// Auto-generate mã tài liệu Cha: PB-LOAISOSO (VD: NMCB-QT01)
export function buildMaTaiLieu(pb: string, loai: string, so: string): string {
  if (!pb || !loai || !so) return ""
  const num = parseInt(so)
  if (isNaN(num) || num < 1) return ""
  return `${pb}-${loai}${String(num).padStart(2, "0")}`
}

// Auto-generate mã tài liệu Con: MACHA-LOAICON+SOSOCON (VD: NMCB-QT01-PL01)
export function buildMaTaiLieuCon(maCha: string, loai: string, so: string): string {
  if (!maCha || !loai || !so) return ""
  const num = parseInt(so)
  if (isNaN(num) || num < 1) return ""
  return `${maCha}-${loai}${String(num).padStart(2, "0")}`
}

// Parse mã tài liệu Con để lấy maCha và soHieu con
// VD: "NMCB-QT01-PL01" với loai="PL" → { maCha: "NMCB-QT01", soHieu: "1" }
export function parseMaTaiLieuCon(ma: string, loai: string): { maCha: string; soHieu: string } {
  if (!ma || !loai) return { maCha: "", soHieu: "" }
  const re = new RegExp(`-${loai}(\\d+)$`, "i")
  const m = ma.match(re)
  if (!m) return { maCha: "", soHieu: "" }
  return { maCha: ma.slice(0, ma.length - m[0].length), soHieu: String(parseInt(m[1])) }
}

// Parse mã cha để lấy pb, loai, so
// VD: "NMCB-QT01" → { pb: "NMCB", loai: "QT", so: "1" }
// VD: "PHK-QĐ02" → { pb: "PHK", loai: "QĐ", so: "2" }
export function parseParentCode(code: string): { pb: string; loai: string; so: string } | null {
  if (!code) return null
  // Match: LETTERS-LETTERS+DIGITS (supports QĐ with unicode Đ)
  const m = code.match(/^([A-Z]+)-([A-ZĐđ]+)(\d+)$/i)
  if (!m) return null
  return { pb: m[1].toUpperCase(), loai: m[2].toUpperCase(), so: String(parseInt(m[3])) }
}

export function emptyIsoForm(): IsoDocumentForm {
  return {
    ma_tai_lieu: "",
    ma_tai_lieu_cu: "",
    so_hieu: "",
    loai_tai_lieu_cha: "QT",
    so_hieu_cha: "",
    ma_tai_lieu_cha: "",
    ten_tai_lieu: "",
    ten_tai_lieu_cu: "",
    loai_tai_lieu: "QT",
    phong_ban: "",
    cap_tl: "Cấp 1",
    chon_quy_trinh: "Soạn thảo",
    lan_ban_hanh: "00",
    soan_thao: "",
    soan_thao_user_id: "",
    xem_xet: "",
    xem_xet_user_id: "",
    phe_duyet: "",
    phe_duyet_user_id: "",
    ghi_chu: "",
    mo_ta_tim_kiem: "",
    standard_ids: [],
    doi_ma_tai_lieu: false,
    ly_do_soat_xet: "",
    noi_dung_soat_xet: "",
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

// ─── Module Thực hiện hồ sơ ISO ───────────────────────────────────────────

export type IsoFormInstanceStatus =
  | "draft"
  | "cho_xem_xet"
  | "cho_phe_duyet"
  | "da_phe_duyet"
  | "tra_ve"
  | "tu_choi"

export type IsoFormAction =
  | "gui_xem_xet"
  | "gui_phe_duyet"
  | "xem_xet_ky"
  | "phe_duyet"
  | "tra_ve"
  | "tu_choi"

export interface IsoFormInstance {
  id: string
  factory_id: string
  template_doc_id: string
  tieu_de: string
  nguoi_tao: string
  trang_thai: IsoFormInstanceStatus
  cap_tl: string
  draft_file_url: string | null
  draft_file_type: string | null
  final_office_url: string | null
  final_pdf_url: string | null
  xem_xet_user_id: string | null
  xem_xet: string | null
  phe_duyet_user_id: string | null
  phe_duyet: string | null
  ky_xem_xet_at: string | null
  ky_phe_duyet_at: string | null
  soan_thao: string | null
  soan_thao_placement: Record<string, unknown> | null
  soan_thao_signed_url: string | null
  ky_soan_thao_at: string | null
  xem_xet_placement: Record<string, number> | null
  phe_duyet_placement: Record<string, number> | null
  auto_convert_pdf: boolean
  ghi_chu: string | null
  ly_do_tra_ve: string | null
  created_at: string
  updated_at: string
}

export const FORM_INSTANCE_STATUS_LABEL: Record<IsoFormInstanceStatus, string> = {
  draft: "Nháp",
  cho_xem_xet: "Chờ xem xét",
  cho_phe_duyet: "Chờ phê duyệt",
  da_phe_duyet: "Đã phê duyệt",
  tra_ve: "Trả về",
  tu_choi: "Từ chối",
}

export const FORM_INSTANCE_STATUS_COLOR: Record<IsoFormInstanceStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  cho_xem_xet: "bg-amber-100 text-amber-700",
  cho_phe_duyet: "bg-orange-100 text-orange-700",
  da_phe_duyet: "bg-emerald-100 text-emerald-700",
  tra_ve: "bg-rose-100 text-rose-700",
  tu_choi: "bg-red-100 text-red-700",
}

export interface TemplateSearchResult {
  id: string
  ten_tai_lieu: string
  ma_tai_lieu: string | null
  loai_tai_lieu: string | null
  phong_ban: string | null
  lan_ban_hanh: string | null
  phan_loai_tl: string | null
  file_signed_office_url: string | null
  file_signed_office_type: string | null
  file_goc_url: string | null
  file_signed_pdf_url: string | null
  mo_ta_tim_kiem: string | null
  similarity: number
}

// ─── Module Phân phối tài liệu ISO ────────────────────────────────────────

export type IsoDistributionBatch = {
  id: string
  factory_id: string
  distributed_by: string
  distributed_at: string
  ghi_chu: string | null
  created_at: string
}

export type IsoDistributionRecipient = {
  id: string
  batch_id: string
  iso_document_id: string
  factory_id: string
  recipient_user_id: string
  first_viewed_at: string | null
  first_downloaded_at: string | null
  created_at: string
  // Joined fields
  recipient_profile?: {
    id: string
    full_name: string | null
    username: string | null
    department: string | null
  }
  iso_document?: {
    id: string
    ma_tai_lieu: string | null
    ten_tai_lieu: string
    loai_tai_lieu: string | null
    trang_thai: IsoTrangThai
    ngay_hieu_luc: string | null
    lan_ban_hanh: string | null
    file_signed_pdf_url: string | null
    file_signed_office_url: string | null
    file_goc_url: string | null
  }
}

// Recipient profile với display name đầy đủ
export type RecipientProfile = {
  id: string
  full_name: string | null
  username: string | null
  department: string | null
  displayName: string // "{full_name} — {department}" đã format
}
