// Tra cứu thiết bị bằng QR — hàm THUẦN, dùng được ở cả client lẫn server (không import server).
// Kế hoạch: docs/qr-equipment-plan.md

/** Domain in lên tem QR. Người dùng chốt 2026-11-06: giữ qlsxkpt.vercel.app.
 *  ⚠️ QR đã in sẽ chết nếu đổi domain — đổi biến này nghĩa là phải in lại toàn bộ tem. */
export const EQUIPMENT_QR_DEFAULT_ORIGIN = "https://qlsxkpt.vercel.app"

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/

/** Token hợp lệ về HÌNH THỨC (base64url 22 ký tự) — lọc rác trước khi chạm DB. */
export function isEquipmentQrToken(value: string | null | undefined): value is string {
  return typeof value === "string" && TOKEN_RE.test(value)
}

export function buildEquipmentQrPath(token: string) {
  return `/tb/${token}`
}

/** URL in lên tem: luôn dùng domain chính thức, KHÔNG dùng origin hiện tại (localhost / preview). */
export function buildEquipmentQrUrl(token: string) {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || EQUIPMENT_QR_DEFAULT_ORIGIN).replace(/\/+$/, "")
  return `${origin}${buildEquipmentQrPath(token)}`
}

/** Lấy token từ chuỗi quét được (URL đầy đủ hoặc đường dẫn `/tb/<token>`). */
export function parseEquipmentQrToken(text: string): string | null {
  const m = text.trim().match(/\/tb\/([A-Za-z0-9_-]{22})(?:[/?#]|$)/)
  return m ? m[1] : null
}

export type EquipmentPublicInfo = {
  ten_tb: string
  ma_tb: string
  loai: "may_moc" | "xe"
  bo_phan: string
  last_maintenance: { ngay: string; hang_muc: string } | null
}

export type EquipmentHistoryMaterial = {
  ten_vat_tu: string
  dvt: string | null
  so_luong: number
  nguon: string
  /** Chỉ có khi người xem được xem giá (admin / maintenance.approve). */
  don_gia?: number | null
  thanh_tien?: number | null
  loai_tien?: string | null
}

export type EquipmentHistoryRecord = {
  /** id dòng thiết bị trong biên bản (1 biên bản có thể có nhiều dòng của cùng thiết bị). */
  line_id: string
  /** id biên bản — dùng mở `/dashboard/maintenance/records/{id}`. */
  id: string
  ma_bb: string | null
  ngay: string | null
  hang_muc: string
  trang_thai: string
  bo_phan: string | null
  nguoi_thuc_hien: string[]
  noi_dung: string | null
  nguyen_nhan: string | null
  cac_khac_phuc: string | null
  loai_sua_chua: string | null
  materials: EquipmentHistoryMaterial[]
  chi_phi_dk?: number | null
  cong_tho?: number | null
  loai_tien?: string | null
}

export type EquipmentHistoryResponse = {
  inactive: boolean
  canSeeCost: boolean
  total: number
  records: EquipmentHistoryRecord[]
}
