// Module Chấm công — kiểu dữ liệu + nhãn dùng chung (thuần, dùng được ở client và server).
// Kế hoạch: .claude/plans/cham-cong-2026-11-19.md. Danh mục song ngữ gốc: ./khmer-catalog.json.

export const ATTENDANCE_DAY_CHUYEN = ["Mủ tạp", "Mủ nước"] as const
export type AttendanceDayChuyen = (typeof ATTENDANCE_DAY_CHUYEN)[number]

export const ATTENDANCE_TO_NHOM = ["tiep_nhan", "co_dien", "nang_hang", "ca_san_xuat"] as const
export type AttendanceToNhom = (typeof ATTENDANCE_TO_NHOM)[number]

/** Tên tổ theo dây chuyền — Mủ nước tiếp nhận là "đánh đông", nâng hàng là "bao bì nâng hàng" (mẫu F02). */
export function toNhomLabel(to: AttendanceToNhom, dayChuyen?: string | null): string {
  if (to === "tiep_nhan") return dayChuyen === "Mủ nước" ? "Tổ tiếp nhận đánh đông" : "Tổ tiếp nhận mủ tạp"
  // Mẫu F01/F02 cải tiến (2026-11): cơ điện + nâng hàng gộp 1 tổ; mã nang_hang chỉ còn ở công việc cũ (đã tắt).
  if (to === "co_dien") return "Tổ cơ điện – nâng hàng"
  if (to === "nang_hang") return "Tổ nâng hàng (mẫu cũ)"
  return "Ca sản xuất"
}

export const ATTENDANCE_CA = ["A", "B", "C"] as const
export type AttendanceCa = (typeof ATTENDANCE_CA)[number]

export type LoaiNhanSu = "nhan_vien" | "cong_nhan"
export const LOAI_NHAN_SU_LABEL: Record<LoaiNhanSu, string> = {
  nhan_vien: "Nhân viên",
  cong_nhan: "Công nhân",
}

export type AttendanceJobType = {
  id: string
  factory_id: string
  /** NULL = việc của tổ độc lập (không theo dây chuyền). Migration 20261211. */
  day_chuyen: AttendanceDayChuyen | null
  to_nhom: AttendanceToNhom
  /** Mã Ca/Tổ của việc của TỔ; NULL = việc ca sản xuất theo dây chuyền. Migration 20261211. */
  unit_code?: string | null
  ten: string
  ten_khmer: string | null
  so_nguoi_goi_y: number
  loai_xe: string | null
  sort_order: number
  is_active: boolean
  /** true ⇒ không hiện ở màn điểm danh (vd Trực xuất hàng — chọn ở đơn xuất). Migration 20261207. */
  an_diem_danh?: boolean
  /** Ô trên Sơ đồ dây chuyền Mủ tạp (A3, migration 20261221). NULL = không có ô. */
  so_do_vi_tri?: string | null
}

export type AttendanceAbsenceReason = {
  id: string
  factory_id: string
  ten: string
  ten_khmer: string | null
  sort_order: number
  is_active: boolean
}

/** Nhãn tiếng Việt cho 6 quyền module Chấm công (Cài đặt → Phân quyền). */
export const ATTENDANCE_PERMISSION_LABELS: Record<string, string> = {
  "attendance.view": "xem công & sổ phép của chính mình",
  "attendance.shift_check": "trực ca: điểm danh ca được phân công",
  "attendance.mark": "chấm công tay cho nhân sự cùng phòng ban",
  "attendance.mark_all": "chấm công & điểm danh toàn nhà máy",
  "attendance.approve": "duyệt / trả về phiếu điểm danh",
  "attendance.manage_config": "quản lý danh mục chấm công (công việc, lý do vắng)",
}

/** Nhân sự còn làm việc trong ngày `isoDate` (YYYY-MM-DD) theo ngày vào làm / nghỉ việc. */
export function isWorkingOn(
  staff: { ngay_vao_lam?: string | null; ngay_nghi_viec?: string | null },
  isoDate: string,
): boolean {
  if (staff.ngay_vao_lam && isoDate < staff.ngay_vao_lam) return false
  if (staff.ngay_nghi_viec && isoDate > staff.ngay_nghi_viec) return false
  return true
}
