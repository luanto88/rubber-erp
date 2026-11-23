// Module Chấm công — GĐ C2 "Điểm danh ca" (rule 31). Kiểu dữ liệu + hàm THUẦN dùng chung (client / script).
// Phiếu ngày (attendance_daily_sheets) gồm các phần (attendance_sheet_sections), mỗi phần nhiều dòng (attendance_sheet_lines).

import { EQUIPMENT_QR_DEFAULT_ORIGIN } from "@/lib/equipment-qr"
import type { AttendanceCa, AttendanceDayChuyen, AttendanceJobType, AttendanceToNhom } from "./types"

export type SheetStatus = "dang_lap" | "da_gui" | "da_duyet" | "tra_ve"
export type SectionStatus = "dang_lam" | "da_gui" | "da_duyet" | "tra_ve"

export type AttendanceQrPoint = {
  id: string
  factory_id: string
  token: string
  ten_diem: string
  day_chuyen_mac_dinh: AttendanceDayChuyen | null
  is_active: boolean
  sort_order: number
}

export type AttendanceDailySheet = {
  id: string
  factory_id: string
  ngay: string
  day_chuyen: AttendanceDayChuyen
  ma_phieu: string
  trang_thai: SheetStatus
}

export type AttendanceSection = {
  id: string
  sheet_id: string
  factory_id: string
  loai: AttendanceToNhom
  ca: AttendanceCa | null
  ca_truong_ten: string | null
  to_truong_staff_id: string | null
  to_pho_staff_id: string | null
  truc_ca_user_id: string
  truc_ca_staff_id: string | null
  ngoai_phan_cong: boolean
  bat_dau_luc: string
  ket_thuc_luc: string | null
  trang_thai: SectionStatus
  gui_luc: string | null
  duyet_luc: string | null
  tra_ve_ly_do: string | null
  tra_ve_luc: string | null
  ghi_chu: string | null
}

export type DiemDanh = "co" | "vang"
export type VangLoai = "co_phep" | "khong_phep"

/** 1 dòng trên form (lưu bằng RPC attendance_save_section). staff_id rỗng = ô trống chưa chọn người (không lưu). */
export type SheetLineDraft = {
  id: string
  staff_id: string
  cong_viec_id: string
  vehicle_id: string
  xep_loai: "A" | "B"
  diem_danh: DiemDanh
  vang_loai: VangLoai
  ly_do_id: string
  ly_do: string
  thay_cho_staff_id: string
  ghi_chu: string
  la_them_ngoai: boolean
}

export const SECTION_SELECT =
  "id, sheet_id, factory_id, loai, ca, ca_truong_ten, to_truong_staff_id, to_pho_staff_id, truc_ca_user_id, truc_ca_staff_id, ngoai_phan_cong, bat_dau_luc, ket_thuc_luc, trang_thai, gui_luc, duyet_luc, tra_ve_ly_do, tra_ve_luc, ghi_chu"

export const LINE_SELECT =
  "id, section_id, stt, staff_id, cong_viec_id, vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_cho_staff_id, ghi_chu, la_them_ngoai"

export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
  dang_lam: "Đang điểm danh",
  da_gui: "Chờ duyệt",
  da_duyet: "Đã duyệt",
  tra_ve: "Bị trả về",
}

export function sectionLabel(loai: AttendanceToNhom, ca: string | null, dayChuyen?: string | null): string {
  if (loai === "ca_san_xuat") return `Ca sản xuất ${ca || ""}`.trim()
  if (loai === "tiep_nhan") return dayChuyen === "Mủ nước" ? "Tổ tiếp nhận đánh đông" : "Tổ tiếp nhận mủ tạp"
  if (loai === "co_dien") return "Tổ cơ điện – nâng hàng"
  return "Tổ nâng hàng (mẫu cũ)"
}

export function newLineId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

export function emptyLine(patch: Partial<SheetLineDraft> = {}): SheetLineDraft {
  return {
    id: newLineId(),
    staff_id: "",
    cong_viec_id: "",
    vehicle_id: "",
    xep_loai: "A",
    diem_danh: "co",
    vang_loai: "co_phep",
    ly_do_id: "",
    ly_do: "",
    thay_cho_staff_id: "",
    ghi_chu: "",
    la_them_ngoai: false,
    ...patch,
  }
}

// ── QR ────────────────────────────────────────────────────────────────────────
export function buildAttendanceQrPath(token: string) {
  return `/dashboard/attendance/shift?qr=${encodeURIComponent(token)}`
}

export function buildAttendanceQrUrl(token: string) {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || EQUIPMENT_QR_DEFAULT_ORIGIN).replace(/\/+$/, "")
  return `${origin}${buildAttendanceQrPath(token)}`
}

/** Token từ chuỗi quét được (URL đầy đủ, đường dẫn, hoặc token trần). */
export function parseAttendanceQrToken(text: string): string | null {
  const t = text.trim()
  const m = t.match(/[?&]qr=([A-Za-z0-9_-]{22})(?:[&#]|$)/)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{22}$/.test(t) ? t : null
}

// ── Dựng danh sách mặc định ──────────────────────────────────────────────────
export type ShiftStaff = {
  id: string
  ten: string
  loai_nhan_su: string | null
  ca_mac_dinh: string | null
  day_chuyen_mac_dinh: string | null
  cong_viec_mac_dinh_id: string | null
  thu_tu_diem_danh: number | null
  ngay_vao_lam: string | null
  ngay_nghi_viec: string | null
  active: boolean | null
  cho_xac_nhan: boolean | null
  profile_id: string | null
}

function working(s: ShiftStaff, iso: string) {
  if (s.active === false) return false
  if (s.ngay_vao_lam && iso < s.ngay_vao_lam) return false
  if (s.ngay_nghi_viec && iso > s.ngay_nghi_viec) return false
  return true
}

function byOrder(a: ShiftStaff, b: ShiftStaff) {
  const oa = a.thu_tu_diem_danh ?? 9999
  const ob = b.thu_tu_diem_danh ?? 9999
  return oa - ob || a.ten.localeCompare(b.ten, "vi")
}

export type DefaultLineContext = {
  loai: AttendanceToNhom
  ca: string | null
  dayChuyen: string
  ngay: string
  staff: ShiftStaff[]
  jobs: AttendanceJobType[]
  /** Xe mặc định theo nhân sự (tài xế chính / phụ). */
  vehicleByStaff: Map<string, string>
}

/**
 * Danh sách mặc định của 1 phần mới mở:
 * - Mỗi công việc của tổ (dây chuyền + tổ, đang dùng) hiện max(số người gợi ý, số người có việc đó làm mặc định) dòng;
 *   người có công việc mặc định đó (cùng dây chuyền; Ca sản xuất thì cùng ca) điền vào trước.
 * - Ca sản xuất: công nhân của ca (cùng dây chuyền hoặc chưa đặt dây chuyền) chưa có công việc thuộc tổ khác ⇒ thêm dòng
 *   chưa có công việc ở cuối.
 */
export function buildDefaultLines(ctx: DefaultLineContext): SheetLineDraft[] {
  const sectionJobs = ctx.jobs
    .filter((j) => j.is_active && j.day_chuyen === ctx.dayChuyen && j.to_nhom === ctx.loai)
    .sort((a, b) => a.sort_order - b.sort_order || a.ten.localeCompare(b.ten, "vi"))
  const jobById = new Map(ctx.jobs.map((j) => [j.id, j]))
  const pool = ctx.staff
    .filter((s) => s.loai_nhan_su === "cong_nhan" && !s.cho_xac_nhan && working(s, ctx.ngay))
    .filter((s) => !s.day_chuyen_mac_dinh || s.day_chuyen_mac_dinh === ctx.dayChuyen)
    .sort(byOrder)
  const inSection = (s: ShiftStaff) => {
    const job = s.cong_viec_mac_dinh_id ? jobById.get(s.cong_viec_mac_dinh_id) : undefined
    if (ctx.loai === "ca_san_xuat") {
      if (s.ca_mac_dinh !== ctx.ca) return false
      return !job || job.to_nhom === "ca_san_xuat"
    }
    return !!job && job.to_nhom === ctx.loai
  }
  const members = pool.filter(inSection)
  const used = new Set<string>()
  const lines: SheetLineDraft[] = []
  for (const job of sectionJobs) {
    const holders = members.filter((s) => s.cong_viec_mac_dinh_id === job.id && !used.has(s.id))
    const slots = Math.max(job.so_nguoi_goi_y, holders.length)
    for (let i = 0; i < slots; i += 1) {
      const s = holders[i]
      if (s) used.add(s.id)
      lines.push(
        emptyLine({
          staff_id: s?.id || "",
          cong_viec_id: job.id,
          vehicle_id: s && job.loai_xe ? ctx.vehicleByStaff.get(s.id) || "" : "",
        }),
      )
    }
  }
  for (const s of members) {
    if (used.has(s.id)) continue
    used.add(s.id)
    lines.push(emptyLine({ staff_id: s.id }))
  }
  return lines
}

/** Đếm tổng / có mặt / vắng trên các dòng ĐÃ chọn người. */
export function countLines(lines: SheetLineDraft[]) {
  const filled = lines.filter((l) => l.staff_id)
  const co = filled.filter((l) => l.diem_danh === "co").length
  return { total: filled.length, co, vang: filled.length - co }
}

/** Lỗi chặn lưu ở client (server kiểm lại). */
export function validateLines(lines: SheetLineDraft[], nameOf: (id: string) => string): string | null {
  const seen = new Set<string>()
  for (const l of lines) {
    if (!l.staff_id) continue
    if (seen.has(l.staff_id)) return `${nameOf(l.staff_id)} có 2 dòng trong cùng phần.`
    seen.add(l.staff_id)
    if (l.diem_danh === "vang" && l.vang_loai === "khong_phep" && !l.ly_do.trim() && !l.ly_do_id) {
      return `${nameOf(l.staff_id)} vắng không phép — chọn lý do.`
    }
  }
  return null
}

export function lineToPayload(l: SheetLineDraft, stt: number) {
  return {
    id: l.id,
    stt,
    staff_id: l.staff_id,
    cong_viec_id: l.cong_viec_id || null,
    vehicle_id: l.vehicle_id || null,
    xep_loai: l.diem_danh === "co" ? l.xep_loai : null,
    diem_danh: l.diem_danh,
    vang_loai: l.diem_danh === "vang" ? l.vang_loai : null,
    ly_do_id: l.diem_danh === "vang" && l.vang_loai === "khong_phep" ? l.ly_do_id || null : null,
    ly_do: l.diem_danh === "vang" && l.vang_loai === "khong_phep" ? l.ly_do : null,
    thay_cho_staff_id: l.thay_cho_staff_id || null,
    ghi_chu: l.ghi_chu,
    la_them_ngoai: l.la_them_ngoai,
  }
}

export type DbLine = {
  id: string
  section_id: string
  stt: number
  staff_id: string
  cong_viec_id: string | null
  vehicle_id: string | null
  xep_loai: "A" | "B" | null
  diem_danh: DiemDanh
  vang_loai: VangLoai | null
  ly_do_id: string | null
  ly_do: string | null
  thay_cho_staff_id: string | null
  ghi_chu: string | null
  la_them_ngoai: boolean
}

export function dbLineToDraft(r: DbLine): SheetLineDraft {
  return emptyLine({
    id: r.id,
    staff_id: r.staff_id,
    cong_viec_id: r.cong_viec_id || "",
    vehicle_id: r.vehicle_id || "",
    xep_loai: r.xep_loai || "A",
    diem_danh: r.diem_danh,
    vang_loai: r.vang_loai || "co_phep",
    ly_do_id: r.ly_do_id || "",
    ly_do: r.ly_do || "",
    thay_cho_staff_id: r.thay_cho_staff_id || "",
    ghi_chu: r.ghi_chu || "",
    la_them_ngoai: r.la_them_ngoai,
  })
}
