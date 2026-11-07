// Tra cứu thiết bị bằng QR — hàm THUẦN, dùng được ở cả client lẫn server (không import server).
// Kế hoạch: docs/qr-equipment-plan.md
import { normalizeSearchText } from "./text-normalize"

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
  /** Chỉ xe Đội xe (GĐ4a): `dispatch_vehicles.vehicle_type`. */
  loai_xe?: string | null
  bo_phan: string
  last_maintenance: { ngay: string; hang_muc: string } | null
}

/** Chỉ trả cho người ĐÃ đăng nhập (qua /history) — người chốt 2026-11-07: biển số + tài xế không công khai. */
export type EquipmentVehicleInfo = {
  plate_number: string | null
  driver_name: string | null
}

export type EquipmentHistoryMaterial = {
  ten_vat_tu: string
  dvt: string | null
  so_luong: number
  nguon: string
  /** Chỉ có khi người xem được xem giá (admin / maintenance.view_cost). */
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
  /** Ảnh hiện trường của dòng thiết bị (maintenance_record_lines.image_urls). */
  images: string[]
  /** Ảnh chung của biên bản Bảo dưỡng nhiều thiết bị (maintenance_records.image_urls_chung). */
  images_chung: string[]
  materials: EquipmentHistoryMaterial[]
  chi_phi_dk?: number | null
  cong_tho?: number | null
  loai_tien?: string | null
}

/** Người đang xem (góc phải trang QR). */
export type EquipmentViewer = {
  username: string
  full_name: string
  chuc_vu: string | null
}

export type EquipmentHistoryResponse = {
  viewer: EquipmentViewer | null
  inactive: boolean
  canSeeCost: boolean
  /** Có `maintenance.view` ⇒ mở được trang Lý lịch / chi tiết biên bản trong module. */
  canOpenModule: boolean
  /** Có `maintenance.create` ⇒ link tạo biên bản điền sẵn thiết bị; không có quyền ⇒ null. */
  createRecordHref: string | null
  /** Xe Đội xe: biển số + tài xế chính hiện hành; máy móc ⇒ null. */
  vehicle: EquipmentVehicleInfo | null
  total: number
  records: EquipmentHistoryRecord[]
}

// ── GĐ2: tab "Vật tư" — gom vật tư đã thay của 1 thiết bị ────────────────────────────

/** Chuẩn hoá tên vật tư để gom nhóm: bỏ dấu (NFD), đ→d, chữ thường, ký tự lạ → khoảng trắng, gộp
 *  khoảng trắng. "Dao băm" = "dao  bằm" = "DAO BAM". */
export function normalizeMaterialName(name: string | null | undefined): string {
  return normalizeSearchText(name)
}

export type EquipmentMaterialSort = "count" | "latest"

/** 1 lần thay (1 dòng vật tư trên 1 biên bản). */
export type EquipmentMaterialOccurrence = {
  record_id: string
  ma_bb: string | null
  ngay: string | null
  hang_muc: string
  trang_thai: string
  ten_vat_tu: string
  dvt: string | null
  so_luong: number
  nguon: string
  /** Chỉ có khi người xem được xem giá (admin / maintenance.view_cost). */
  don_gia?: number | null
  thanh_tien?: number | null
  loai_tien?: string | null
}

export type EquipmentMaterialGroup = {
  key: string
  /** Mã vật tư kho (inventory_items.code) nếu nhóm gắn mã. */
  item_code: string | null
  /** Tên hiển thị: tên vật tư kho, hoặc tên gốc dùng nhiều nhất. */
  name: string
  /** Các tên gốc khác nhau đã ghi trên biên bản (để nhận ra cách viết khác). */
  names: string[]
  /** Số lần thay = số BIÊN BẢN có vật tư này. */
  times: number
  /** Tổng số lượng theo từng ĐVT. */
  totals: { dvt: string | null; so_luong: number }[]
  last_date: string | null
  /** Khoảng cách trung bình (ngày) giữa các lần thay; < 2 lần ⇒ null. */
  avg_interval_days: number | null
  nguon: string[]
  /** Tổng thành tiền theo loại tiền — chỉ có khi được xem giá. */
  costs?: { loai_tien: string; thanh_tien: number }[]
  occurrences: EquipmentMaterialOccurrence[]
}

export type EquipmentMaterialsResponse = {
  canSeeCost: boolean
  canOpenModule: boolean
  /** Số biên bản (đã lọc ngày/hạng mục) có dùng ít nhất 1 vật tư. */
  recordCount: number
  groups: EquipmentMaterialGroup[]
}
