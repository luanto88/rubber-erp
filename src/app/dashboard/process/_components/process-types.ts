// Types và helpers cho module Kiểm soát quá trình

export type ProcessParam = {
  id: string
  factory_id: string
  ngay: string
  day_chuyen: string
  loai_csr: string | null
  nhiet_do_dau_1: number | null
  nhiet_do_dau_2: number | null
  thoi_gian_say: number | null
  ghi_chu: string | null
  logged_by: string | null
  created_at: string
}

export type QuickMeasurementSheet = {
  id: string
  factory_id: string
  ma_phieu: string | null
  ngay: string
  day_chuyen: string | null
  chung_loai: string | null
  loai_csr: string | null
  created_by: string | null
  created_at: string
  rows?: QuickMeasurementRow[]
}

export type QuickMeasurementRow = {
  id: string
  sheet_id: string
  factory_id: string
  so_mau: number | null
  chi_tieu: string[]
  thung: string | null
  lo: string | null
  mau: string | null
  che_do_say: string | null
  ca_sx: string | null
  ngan_id: string | null
  so_ngay_luu: number | null
  ket_qua: Record<string, number | null>
  image_urls: string[]
  nguoi_do: string | null
  ghi_chu: string | null
  sort_order: number
  created_at: string
}

// Chỉ tiêu có sẵn theo chủng loại (cố định, mirror quality module)
export const CHI_TIEU_BY_CSR: Record<string, string[]> = {
  "10":   ["Po", "Mo"],
  "20":   ["Po", "Mo"],
  "L":    ["Po", "Màu sắc"],
  "3L":   ["Po", "Màu sắc"],
  "CV50": ["Po", "Mo"],
  "CV60": ["Po", "Mo"],
}

export const ALL_CSR_TYPES = ["10", "20", "L", "3L", "CV50", "CV60"]

export const CSR_BY_DAY_CHUYEN: Record<string, string[]> = {
  "Mủ tạp":  ["10", "20"],
  "Mủ nước": ["L", "3L", "CV50", "CV60"],
}

export const CA_SX_OPTIONS = ["Ca 1", "Ca 2 (Ban)", "Ca 2", "Ca 3", "Ban ngày"]

// Prefix mã phiếu theo dây chuyền (hoặc chủng loại — giá trị giống nhau)
export function getMaPhieuPrefix(day_chuyen: string | null): string {
  return day_chuyen === "Mủ tạp" ? "MT" : "MN"
}

// Format ngày ddmmyy cho mã phiếu
export function formatDdMmYy(dateStr: string): string {
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}${mm}${yy}`
}

// Lấy tên hiển thị chỉ tiêu (2 ký tự đầu cho CT display)
export function getChiTieuShort(ct: string): string {
  return ct.slice(0, 2)
}

// Tính số ngày lưu từ ngày bắt đầu ngăn
export function calcSoNgayLuu(ngayDo: string, ngayBd: string): number {
  const a = new Date(ngayDo)
  const b = new Date(ngayBd)
  return Math.max(0, Math.round((a.getTime() - b.getTime()) / 86400000))
}

export type EmptyProcessParamForm = {
  ngay: string
  day_chuyen: string
  loai_csr: string
  nhiet_do_dau_1: string
  nhiet_do_dau_2: string
  thoi_gian_say: string
  ghi_chu: string
}

export function emptyProcessParamForm(): EmptyProcessParamForm {
  return {
    ngay: new Date().toISOString().slice(0, 10),
    day_chuyen: "",
    loai_csr: "",
    nhiet_do_dau_1: "",
    nhiet_do_dau_2: "",
    thoi_gian_say: "",
    ghi_chu: "",
  }
}

export type MeasurementRowDraft = {
  id: string  // temp id for UI key
  chi_tieu: string[]
  thung: string
  lo: string
  mau: string
  che_do_say: string
  ca_sx: string
  ngan_id: string
  so_ngay_luu: number | null
  ket_qua: Record<string, string>
  image_urls: string[]
  nguoi_do: string
  ghi_chu: string
}

export function emptyMeasurementRow(defaultNguoiDo = "", defaultCheDo = ""): MeasurementRowDraft {
  return {
    id: Math.random().toString(36).slice(2),
    chi_tieu: [],
    thung: "",
    lo: "",
    mau: "",
    che_do_say: defaultCheDo,
    ca_sx: "",
    ngan_id: "",
    so_ngay_luu: null,
    ket_qua: {},
    image_urls: [],
    nguoi_do: defaultNguoiDo,
    ghi_chu: "",
  }
}
