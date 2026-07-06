// Types và constants cho module Văn bản Nội bộ

export type VanBanTrangThai =
  | "draft"
  | "cho_ky_phong_ban"
  | "cho_phe_duyet"
  | "da_phe_duyet"
  | "tra_ve"

export type VanBanDocumentType = {
  id: string
  code: string
  name: string
  ky_hieu: string
  sort_order: number
  is_active: boolean
}

// Chữ viết tắt ký thay, chọn ngay lúc ký (SignPlacementModal) — áp dụng cho cả bước
// ký phòng ban (nguoi_ky[step].sign_as) và Phê duyệt cuối (phe_duyet_sign_as).
export type SignAsType = "none" | "KT" | "TM" | "TL" | "TUQ"

export const SIGN_AS_OPTIONS: Exclude<SignAsType, "none">[] = ["KT", "TM", "TL", "TUQ"]

export const SIGN_AS_LABEL: Record<Exclude<SignAsType, "none">, string> = {
  KT: "KT. (Ký thay)",
  TM: "TM. (Thay mặt)",
  TL: "TL. (Thừa lệnh)",
  TUQ: "TUQ. (Thừa ủy quyền)",
}

export type ThuTuKyStep = {
  step: number
  type: "phong_ban" | "ca_nhan"
  phong_ban_code?: string
  phong_ban_name?: string
  user_id?: string
  ten?: string
  chuc_vu?: string
  // Dùng khi phan_loai = 'Mat': đích danh 1 người nhận thông báo cho bước này
  mat_recipient_user_id?: string
}

export type VanBanDocument = {
  id: string
  factory_id: string
  ma_van_ban: string | null
  ten_van_ban: string
  cap_tl: string | null
  phong_ban: string | null
  loai_van_ban: string | null
  so_van_ban: string | null
  nam: number | null
  phan_loai: string       // 'Thuong' | 'Mat'
  trang_thai: VanBanTrangThai
  thu_tu_ky_json: ThuTuKyStep[]
  buoc_hien_tai: number
  so_buoc_tong: number
  nguoi_ky: Record<string, { ten: string; chuc_vu: string; ky_at: string; is_kt?: boolean; sign_as?: SignAsType }>
  placement_ky: Record<string, unknown>
  tra_ve_step: number | null
  tra_ve_ly_do: string | null
  tra_ve_nguoi: string | null
  tra_ve_at: string | null
  ngay_phe_duyet: string | null
  file_goc_url: string | null
  file_signed_pdf_url: string | null
  file_signed_office_url: string | null
  file_signed_office_type: string | null
  auto_convert_pdf: boolean
  is_uploaded: boolean
  phong_ban_ky_display: string[] | null
  nguoi_soan_thao_display: string | null
  mo_ta_tim_kiem: string | null
  soan_thao_user_id: string | null
  phe_duyet_user_id: string | null
  phe_duyet: string | null
  pham_vi: string | null            // 'Cong_ty' | 'Don_vi'
  phe_duyet_is_kt: boolean | null   // LEGACY — set lúc soạn thảo cho văn bản cũ trước 2026-07-06, chỉ đọc để hiển thị
  phe_duyet_sign_as: SignAsType | null   // chọn lúc ký (SignPlacementModal) — thay thế phe_duyet_is_kt cho văn bản mới
  ghi_chu: string | null
  created_at: string
  updated_at: string
}

export const PHAN_LOAI_OPTIONS = ["Thuong", "Mat"] as const
export type PhanLoaiCode = (typeof PHAN_LOAI_OPTIONS)[number]

export const PHAN_LOAI_LABEL: Record<string, string> = {
  Thuong: "Thường",
  Mat: "Mật",
}

export const PHAN_LOAI_COLOR: Record<string, string> = {
  Thuong: "bg-slate-100 text-slate-600",
  Mat: "bg-red-100 text-red-700 border border-red-200",
}

export const LOAI_VAN_BAN_OPTIONS = ["DN", "TTR", "BC", "KH", "BB"] as const
export type LoaiVanBanCode = (typeof LOAI_VAN_BAN_OPTIONS)[number]

export const LOAI_VAN_BAN_LABEL: Record<string, string> = {
  DN: "Đề nghị",
  TTR: "Tờ trình",
  BC: "Báo cáo",
  KH: "Kế hoạch",
  BB: "Biên bản",
}

export const LOAI_VAN_BAN_KY_HIEU: Record<string, string> = {
  DN: "ĐN",
  TTR: "Ttr",
  BC: "BC",
  KH: "KH",
  BB: "BB",
}

export const PHONG_BAN_VAN_BAN_OPTIONS = [
  "PHK", "KTNN", "QLCL", "KHXD", "TCKT", "TCHC", "TTBV", "NMCB", "CS",
] as const

export const TRANG_THAI_LABEL: Record<VanBanTrangThai, string> = {
  draft: "Nháp",
  cho_ky_phong_ban: "Chờ ký phòng ban",
  cho_phe_duyet: "Chờ phê duyệt",
  da_phe_duyet: "Đã phê duyệt",
  tra_ve: "Trả về",
}

export const TRANG_THAI_COLOR: Record<VanBanTrangThai, string> = {
  draft: "bg-slate-100 text-slate-600",
  cho_ky_phong_ban: "bg-amber-100 text-amber-700",
  cho_phe_duyet: "bg-orange-100 text-orange-700",
  da_phe_duyet: "bg-emerald-100 text-emerald-700",
  tra_ve: "bg-rose-100 text-rose-700",
}

// Xây dựng mã văn bản: 01/ĐN-KTNN
export function buildMaVanBan(so: number | string, kyHieu: string, phongBan: string): string {
  if (!so || !kyHieu || !phongBan) return ""
  const num = typeof so === "string" ? parseInt(so) : so
  if (isNaN(num) || num < 1) return ""
  return `${String(num).padStart(2, "0")}/${kyHieu}-${phongBan}`
}

// Chuẩn hóa tên file lưu vào Supabase Storage — bỏ dấu tiếng Việt, chỉ giữ ký tự an toàn.
// Mirror sanitizeStorageFileName() của module ISO (iso/documents/[id]/page.tsx).
export function sanitizeStorageFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".")
  const rawBase = lastDot > 0 ? fileName.slice(0, lastDot) : fileName
  const rawExt = lastDot > 0 ? fileName.slice(lastDot + 1) : ""
  const base = rawBase
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120)
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  return `${base || "file"}${ext ? `.${ext}` : ""}`
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return ""
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
}
