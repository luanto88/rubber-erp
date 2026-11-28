// Module Chấm công — hàm thuần cho lịch công tháng (dùng được client + server). Rule 31.

export type AttendanceStatus = "co_mat" | "nghi_tua" | "nghi_co_phep" | "nghi_khong_phep"
export type AttendanceSource = "auto_app" | "cham_diem_d" | "truc_ca" | "bo_sung_tay"

export type AttendanceRecord = {
  id: string
  staff_id: string
  ngay: string
  trang_thai: AttendanceStatus
  nguon: AttendanceSource
  xep_loai: "A" | "B" | null
  ly_do: string | null
  dung_phep_thuong: boolean
  updated_by: string | null
  updated_at: string
  /** C3: thao tác app phát hiện trong ngày (migration 20261214). Thiếu cột ⇒ undefined. */
  hoat_dong?: AttendanceActivity[] | null
}

/** 1 nguồn thao tác app trong ngày, giờ sớm nhất (do RPC attendance_sync_auto ghi). */
export type AttendanceActivity = { nguon: string; luc: string }

export const ACTIVITY_LABEL: Record<string, string> = {
  dieu_xe: "Điều xe",
  san_luong: "Sản lượng",
  thanh_pham: "Thành phẩm",
  kiem_nghiem: "Kiểm nghiệm",
  xuat_hang: "Xuất hàng",
  do_nhanh: "Đo nhanh",
  bao_tri: "Bảo trì",
  kho: "Kho vật tư",
  de_nghi_mua: "Đề nghị mua",
  ky_so: "Ký số",
  iso: "ISO",
  ghi_chu: "Ghi chú",
  dong_ho: "Đồng hồ định mức",
  kpi: "KPI",
  diem_danh: "Điểm danh ca",
  cham_diem_d: "Được chấm điểm chuyên môn",
}

export function activitiesOf(r: AttendanceRecord | undefined | null): AttendanceActivity[] {
  return Array.isArray(r?.hoat_dong) ? r!.hoat_dong! : []
}

/** Mâu thuẫn: ngày đang chấm "Nghỉ" (nguồn cao hơn) nhưng có thao tác trên app / được chấm D. */
export function isAttendanceConflict(r: AttendanceRecord | undefined | null): boolean {
  return !!r && r.trang_thai !== "co_mat" && activitiesOf(r).length > 0
}

/**
 * B (20261224) — phân loại ngày Nghỉ có thao tác app (Lịch công):
 * - "chuyen_can": Nghỉ tua mà vẫn thao tác ĐÚNG nguồn của nhóm chính (`personnel_groups.nguon_hoat_dong`) —
 *   chỉ số phụ KPI, cùng quy tắc với kpi_attendance_summary_internal.ngay_chuyen_can.
 * - "mau_thuan": Nghỉ có phép / không phép mà có thao tác — cần kiểm tra lại.
 * - null: không có thao tác, đang có mặt, hoặc Nghỉ tua + thao tác ngoài nhóm chính (chỉ hiện ở tooltip).
 */
export type ActivityDayKind = "chuyen_can" | "mau_thuan" | null

export function classifyActivityDay(
  r: AttendanceRecord | undefined | null,
  primarySources: readonly string[],
): ActivityDayKind {
  if (!r || r.trang_thai === "co_mat") return null
  const acts = activitiesOf(r)
  if (acts.length === 0) return null
  if (r.trang_thai === "nghi_tua") {
    return primarySources.length > 0 && acts.some((a) => primarySources.includes(a.nguon)) ? "chuyen_can" : null
  }
  return "mau_thuan"
}

/** "Sản lượng 08:15 · Ký số 10:02" — giờ theo giờ nhà máy. */
export function formatActivities(list: AttendanceActivity[]): string {
  return list
    .map((a) => {
      const t = new Date(a.luc)
      const hm = Number.isNaN(t.getTime())
        ? ""
        : t.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" })
      return `${ACTIVITY_LABEL[a.nguon] || a.nguon}${hm ? ` ${hm}` : ""}`
    })
    .join(" · ")
}

export type AttendanceLog = {
  id: string
  staff_id: string
  ngay: string
  hanh_dong: "cham" | "xoa"
  trang_thai_truoc: AttendanceStatus | null
  trang_thai_sau: AttendanceStatus | null
  xep_loai_truoc: string | null
  xep_loai_sau: string | null
  nguon_truoc: AttendanceSource | null
  nguon_sau: AttendanceSource | null
  ly_do: string
  nguoi_thuc_hien_id: string
  created_at: string
}

export const ATTENDANCE_STATUS_SHORT: Record<AttendanceStatus, string> = {
  co_mat: "+",
  nghi_tua: "T",
  nghi_co_phep: "P",
  nghi_khong_phep: "K",
}

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  co_mat: "Có mặt",
  nghi_tua: "Nghỉ tua",
  nghi_co_phep: "Nghỉ có phép",
  nghi_khong_phep: "Nghỉ không phép",
}

export const ATTENDANCE_SOURCE_LABEL: Record<AttendanceSource, string> = {
  auto_app: "Tự động (thao tác trên app)",
  cham_diem_d: "Được chấm điểm chuyên môn",
  truc_ca: "Trực ca điểm danh",
  bo_sung_tay: "Chấm tay",
}

/** Số ngày nghỉ tua chuẩn mỗi tháng (công chuẩn = số ngày lịch − giá trị này). */
export const DEFAULT_TUA_DAYS = 6

const pad = (n: number) => String(n).padStart(2, "0")

/** "YYYY-MM" → danh sách ngày ISO trong tháng. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number)
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`)
}

export function monthRange(month: string): { from: string; to: string } {
  const days = monthDays(month)
  return { from: days[0], to: days[days.length - 1] }
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

/** Thứ trong tuần (0 = Chủ nhật) của ngày ISO. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function standardDays(month: string, tuaDays = DEFAULT_TUA_DAYS): number {
  return Math.max(0, monthDays(month).length - tuaDays)
}

type WorkRange = { ngay_vao_lam?: string | null; ngay_nghi_viec?: string | null }

export function isInWorkRange(staff: WorkRange, iso: string): boolean {
  if (staff.ngay_vao_lam && iso < staff.ngay_vao_lam) return false
  if (staff.ngay_nghi_viec && iso > staff.ngay_nghi_viec) return false
  return true
}

/** Tháng làm không trọn: vào làm sau ngày 1 hoặc nghỉ việc trước ngày cuối tháng. */
export function isPartialMonth(staff: WorkRange, month: string): boolean {
  const { from, to } = monthRange(month)
  return (!!staff.ngay_vao_lam && staff.ngay_vao_lam > from) || (!!staff.ngay_nghi_viec && staff.ngay_nghi_viec < to)
}

/** Nhân sự có làm việc ít ngày nào trong tháng không. */
export function worksInMonth(staff: WorkRange, month: string): boolean {
  const { from, to } = monthRange(month)
  return !(staff.ngay_vao_lam && staff.ngay_vao_lam > to) && !(staff.ngay_nghi_viec && staff.ngay_nghi_viec < from)
}

export type StaffMonthSummary = {
  coMat: number
  tua: number
  coPhep: number
  khongPhep: number
  xepA: number
  xepB: number
  /** Ngày trong khoảng làm việc, đã qua (≤ hôm nay) mà chưa ghi nhận gì. */
  chuaGhiNhan: number
}

export function summarizeStaffMonth(
  staff: WorkRange,
  month: string,
  recordsByDay: Map<string, AttendanceRecord>,
  today: string,
): StaffMonthSummary {
  const s: StaffMonthSummary = { coMat: 0, tua: 0, coPhep: 0, khongPhep: 0, xepA: 0, xepB: 0, chuaGhiNhan: 0 }
  for (const day of monthDays(month)) {
    if (!isInWorkRange(staff, day)) continue
    const r = recordsByDay.get(day)
    if (!r) {
      if (day <= today) s.chuaGhiNhan++
      continue
    }
    if (r.trang_thai === "co_mat") {
      s.coMat++
      if (r.xep_loai === "A") s.xepA++
      if (r.xep_loai === "B") s.xepB++
    } else if (r.trang_thai === "nghi_tua") s.tua++
    else if (r.trang_thai === "nghi_co_phep") s.coPhep++
    else s.khongPhep++
  }
  return s
}
