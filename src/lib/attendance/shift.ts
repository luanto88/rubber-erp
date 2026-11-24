// Module Chấm công — GĐ C2 "Điểm danh ca" (rule 31). Kiểu dữ liệu + hàm THUẦN dùng chung (client / script).
// Phiếu ngày (attendance_daily_sheets) gồm các phần (attendance_sheet_sections), mỗi phần nhiều dòng (attendance_sheet_lines).

import { EQUIPMENT_QR_DEFAULT_ORIGIN } from "@/lib/equipment-qr"
import type { AttendanceCa, AttendanceDayChuyen, AttendanceToNhom } from "./types"

export type SheetStatus = "dang_lap" | "da_gui" | "da_duyet" | "tra_ve"
export type SectionStatus = "dang_lam" | "da_gui" | "da_duyet" | "tra_ve"

export type AttendanceQrPoint = {
  id: string
  factory_id: string
  token: string
  ten_diem: string
  day_chuyen_mac_dinh: AttendanceDayChuyen | null
  /** Mã Ca/Tổ mở sẵn khi quét (migration 20261210). */
  unit_code?: string | null
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
  duyet_boi?: string | null
  tra_ve_ly_do: string | null
  tra_ve_luc: string | null
  ghi_chu: string | null
  /** Vị trí phụ trách (migration 20261208). {} = chưa từng lưu ⇒ màn trực ca điền mặc định theo hồ sơ nhân sự. */
  vi_tri?: SectionPositions | null
}

// ── Ca / Tổ (đơn vị điểm danh, migration 20261210) ──
export type AttendanceUnit = {
  id: string
  code: string
  ten: string
  ten_khmer: string | null
  loai: "ca" | "to"
  /** Cũ (trước 20261211) — không còn dùng để lọc việc; việc của tổ gắn theo attendance_job_types.unit_code. */
  to_nhom: string | null
  /** NULL = chọn dây chuyền khi điểm danh (Ca A/B/C, tổ độc lập); có giá trị = tổ chỉ thuộc dây chuyền đó (20261211). */
  day_chuyen?: string | null
  sort_order: number
  is_active: boolean
}
export const UNIT_SELECT = "id, code, ten, ten_khmer, loai, to_nhom, day_chuyen, sort_order, is_active"

// ── Vị trí phụ trách: trưởng / phó của CHÍNH ca/tổ (người dùng chốt 2026-11-23/24) ──
// (a) người giữ vị trí tính CÓ MẶT A dù không có việc; (b) người gốc bị thay ⇒ tự VẮNG, người thay = người giữ mới.
// Ca ⇒ "Ca trưởng / Ca phó"; tổ ⇒ "Tổ trưởng / Tổ phó". Chưa có người ⇒ để trống trên phiếu.
export const POSITION_KEYS = ["truong", "pho"] as const
export type PositionKey = (typeof POSITION_KEYS)[number]
/** staff_id = người đang giữ; goc_staff_id = người mặc định theo hồ sơ lúc mở phiếu (để biết ai bị thay). */
export type PositionSlot = { staff_id: string | null; goc_staff_id: string | null }
export type SectionPositions = Partial<Record<PositionKey, PositionSlot>>

/** Khoá chữ (khmer-ui.json) của nhãn vị trí theo loại đơn vị. */
export function positionLabelKey(key: PositionKey, unitLoai: "ca" | "to" | null | undefined): string {
  if (unitLoai === "to") return key === "truong" ? "vtToTruong" : "vtToPho"
  return key === "truong" ? "vtCaTruong" : "vtCaPho"
}

const VAI_TRO_OF: Record<PositionKey, "to_truong" | "to_pho"> = { truong: "to_truong", pho: "to_pho" }

/** Đã từng lưu vị trí chưa (cột rỗng {} / null ⇒ chưa). */
export function hasStoredPositions(p: SectionPositions | null | undefined): boolean {
  return !!p && Object.keys(p).length > 0
}

/**
 * Người mặc định theo hồ sơ: vai trò trưởng/phó + Ca/Tổ mặc định = đơn vị này; dây chuyền khớp hoặc trống.
 * Nhiều người cùng vai trò ⇒ lấy người đầu theo thứ tự điểm danh.
 */
export function defaultPositions(staff: ShiftStaff[], unitCode: string, dayChuyen: string, ngay: string): SectionPositions {
  const out: SectionPositions = {}
  for (const key of POSITION_KEYS) {
    const found = staff
      .filter(
        (s) =>
          s.to_vai_tro === VAI_TRO_OF[key] &&
          s.ca_mac_dinh === unitCode &&
          !s.cho_xac_nhan &&
          isStaffWorking(s, ngay) &&
          (!s.day_chuyen_mac_dinh || s.day_chuyen_mac_dinh === dayChuyen),
      )
      .sort(compareStaffOrder)[0]
    out[key] = { staff_id: found?.id || null, goc_staff_id: found?.id || null }
  }
  return out
}

/** Người đang giữ ít nhất 1 vị trí. */
export function positionHolderIds(p: SectionPositions | null | undefined): Set<string> {
  const ids = new Set<string>()
  if (!p) return ids
  for (const key of POSITION_KEYS) {
    const id = p[key]?.staff_id
    if (id) ids.add(id)
  }
  return ids
}

/** Các vị trí 1 người đang giữ (để hiện nhãn trên ô). */
export function positionsOfStaff(p: SectionPositions | null | undefined, staffId: string): PositionKey[] {
  if (!p) return []
  return POSITION_KEYS.filter((k) => p[k]?.staff_id === staffId)
}

/**
 * Đổi người giữ vị trí ⇒ trả về DÒNG mới (người gốc tự vắng có người thay — quy tắc (b)).
 * - Bỏ dòng vắng tự động cũ của người gốc (vắng, người thay = người giữ cũ, không việc, chưa chọn phép).
 * - Người mới ≠ người gốc: người gốc chưa có dòng / có mặt mà không việc ⇒ thành vắng, người thay = người mới.
 *   Người gốc đã được giao việc (đi làm việc khác) hoặc đã đánh vắng tay ⇒ giữ nguyên.
 */
export function applyPositionChange(
  lines: SheetLineDraft[],
  slot: PositionSlot | undefined,
  newStaffId: string | null,
): SheetLineDraft[] {
  const goc = slot?.goc_staff_id || null
  const oldHolder = slot?.staff_id || null
  let out = lines
  if (goc && oldHolder && oldHolder !== goc) {
    out = out.filter(
      (l) =>
        !(
          l.staff_id === goc &&
          l.diem_danh === "vang" &&
          l.thay_the_staff_id === oldHolder &&
          l.cong_viec_ids.length === 0 &&
          !l.vang_loai
        ),
    )
  }
  if (goc && newStaffId && newStaffId !== goc) {
    const cur = out.find((l) => l.staff_id === goc)
    if (!cur || (cur.diem_danh === "co" && cur.cong_viec_ids.length === 0)) {
      const absent = emptyLine({ id: cur?.id, staff_id: goc, diem_danh: "vang", thay_the_staff_id: newStaffId })
      out = cur ? out.map((l) => (l.staff_id === goc ? absent : l)) : [...out, absent]
    }
  }
  return out
}

export type DiemDanh = "co" | "vang"
export type VangLoai = "co_phep" | "khong_phep"

/**
 * 1 dòng lưới (lưu bằng RPC attendance_save_section, migration 20261206). 1 người / phiếu ca.
 * Có mặt: cong_viec_ids = việc người đó làm. Vắng: cong_viec_ids = việc NGƯỜI THAY làm (nếu có người thay).
 */
export type SheetLineDraft = {
  id: string
  staff_id: string
  cong_viec_ids: string[]
  vehicle_id: string
  xep_loai: "A" | "B"
  diem_danh: DiemDanh
  /** "" = chưa chọn (được lúc nháp; bắt buộc khi gửi). */
  vang_loai: VangLoai | ""
  ly_do_id: string
  ly_do: string
  thay_the_staff_id: string
  thay_the_ten: string
  ghi_chu: string
  la_them_ngoai: boolean
}

export const SECTION_SELECT =
  "id, sheet_id, factory_id, loai, ca, ca_truong_ten, to_truong_staff_id, to_pho_staff_id, truc_ca_user_id, truc_ca_staff_id, ngoai_phan_cong, bat_dau_luc, ket_thuc_luc, trang_thai, gui_luc, duyet_luc, duyet_boi, tra_ve_ly_do, tra_ve_luc, ghi_chu, vi_tri"

export const LINE_SELECT =
  "id, section_id, stt, staff_id, cong_viec_id, cong_viec_ids, vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_the_staff_id, thay_the_ten, ghi_chu, la_them_ngoai"

export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
  dang_lam: "Đang điểm danh",
  da_gui: "Chờ duyệt",
  da_duyet: "Đã duyệt",
  tra_ve: "Bị trả về",
}

export function sectionLabel(
  loai: AttendanceToNhom,
  ca: string | null,
  dayChuyen?: string | null,
  units?: Map<string, { ten: string }>,
): string {
  if (loai === "ca_san_xuat") return (ca && units?.get(ca)?.ten) || `Ca ${ca || ""}`.trim()
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
    cong_viec_ids: [],
    vehicle_id: "",
    xep_loai: "A",
    diem_danh: "co",
    vang_loai: "",
    ly_do_id: "",
    ly_do: "",
    thay_the_staff_id: "",
    thay_the_ten: "",
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


// ── Lưới ô người (C2 làm lại GĐ2) ─────────────────────────────────────────────
export type ShiftStaff = {
  id: string
  ten: string
  gioi_tinh: string | null
  loai_nhan_su: string | null
  ca_mac_dinh: string | null
  day_chuyen_mac_dinh: string | null
  thu_tu_diem_danh: number | null
  ngay_vao_lam: string | null
  ngay_nghi_viec: string | null
  active: boolean | null
  cho_xac_nhan: boolean | null
  profile_id: string | null
  chuc_vu?: string | null
  chuc_vu_chinh_quyen?: string | null
  to_vai_tro?: string | null
  to_pham_vi?: string | null
}

export function isStaffWorking(s: ShiftStaff, iso: string): boolean {
  if (s.active === false) return false
  if (s.ngay_vao_lam && iso < s.ngay_vao_lam) return false
  if (s.ngay_nghi_viec && iso > s.ngay_nghi_viec) return false
  return true
}

/** Thứ tự giới tính trên lưới: nam trước, nữ sau, chưa khai cuối. */
export function genderRank(gioiTinh: string | null | undefined): number {
  const g = (gioiTinh || "").trim().toLowerCase()
  if (g === "nam" || g === "male") return 0
  if (g === "nữ" || g === "nu" || g === "female") return 1
  return 2
}

export function compareStaffOrder(a: ShiftStaff, b: ShiftStaff): number {
  const gr = genderRank(a.gioi_tinh) - genderRank(b.gioi_tinh)
  if (gr !== 0) return gr
  const oa = a.thu_tu_diem_danh ?? 9999
  const ob = b.thu_tu_diem_danh ?? 9999
  return oa - ob || a.ten.localeCompare(b.ten, "vi")
}

/** Thẻ trên lưới (từ 20261211 không còn thẻ nhóm — nhóm nhân sự chỉ là chuyên môn). */
export type RosterTab = { key: string; label: string; code: string | null; staffIds: string[] }

/**
 * Thẻ CHÍNH = người có "Ca/Tổ mặc định" = đơn vị đang điểm danh (cùng dây chuyền hoặc chưa đặt, còn làm việc, đã xác
 * nhận). `lineStaffIds` = người đã có dòng / giữ vị trí trong phiếu; ai không thuộc thẻ chính ⇒ thẻ "Khác"
 * (người thay mượn từ ca/tổ khác).
 */
export function buildRosterTabs(
  staff: ShiftStaff[],
  unit: Pick<AttendanceUnit, "code" | "ten"> | null,
  dayChuyen: string,
  ngay: string,
  lineStaffIds: string[],
): RosterTab[] {
  const byId = new Map(staff.map((s) => [s.id, s]))
  const unitCode = unit?.code || ""
  const caIds = staff
    .filter(
      (s) =>
        !s.cho_xac_nhan &&
        !!unitCode &&
        s.ca_mac_dinh === unitCode &&
        (!s.day_chuyen_mac_dinh || s.day_chuyen_mac_dinh === dayChuyen) &&
        isStaffWorking(s, ngay),
    )
    .sort(compareStaffOrder)
    .map((s) => s.id)
  const tabs: RosterTab[] = [{ key: "ca", label: unit?.ten || unitCode, code: null, staffIds: caIds }]
  const shown = new Set(tabs.flatMap((t) => t.staffIds))
  const extra = lineStaffIds
    .filter((id) => !shown.has(id) && byId.has(id))
    .map((id) => byId.get(id) as ShiftStaff)
    .sort(compareStaffOrder)
    .map((s) => s.id)
  if (extra.length > 0) tabs.push({ key: "khac", label: "Khác", code: null, staffIds: extra })
  return tabs
}

/** Việc thuộc Ca/Tổ (20261211): tổ ⇒ việc gắn unit_code; ca ⇒ việc ca sản xuất (không unit_code) của dây chuyền. */
export function isJobOfUnit(
  j: { day_chuyen: string | null; to_nhom: string; unit_code?: string | null },
  unit: Pick<AttendanceUnit, "code" | "loai"> | null,
  dayChuyen: string,
): boolean {
  if (!unit) return false
  if (unit.loai === "to") return j.unit_code === unit.code
  return !j.unit_code && j.to_nhom === "ca_san_xuat" && j.day_chuyen === dayChuyen
}

/**
 * Việc hiện ở tấm chọn việc: việc của Ca/Tổ đang điểm danh, đang dùng, không ẩn ở điểm danh — CỘNG việc đang có trên
 * dòng (dòng cũ / gợi ý) để không mất dữ liệu.
 */
export function jobsForUnit<
  J extends { id: string; day_chuyen: string | null; to_nhom: string; unit_code?: string | null; is_active: boolean; an_diem_danh?: boolean },
>(jobs: J[], unit: Pick<AttendanceUnit, "code" | "loai"> | null, dayChuyen: string, currentIds: string[]): J[] {
  const keep = new Set(currentIds)
  return jobs.filter((j) => keep.has(j.id) || (j.is_active && !j.an_diem_danh && isJobOfUnit(j, unit, dayChuyen)))
}

export type TileState = "chua_giao" | "co_mat" | "vang_co_thay" | "vang"

/** `isHolder` = đang giữ vị trí phụ trách ⇒ có mặt dù không có việc (quy tắc (a)). */
export function classifyTile(line: SheetLineDraft | undefined, isHolder = false): TileState {
  if (!line) return isHolder ? "co_mat" : "chua_giao"
  if (line.diem_danh === "vang") return line.thay_the_staff_id || line.thay_the_ten ? "vang_co_thay" : "vang"
  return line.cong_viec_ids.length > 0 || isHolder ? "co_mat" : "chua_giao"
}

/** Đếm trên MỌI người trong các thẻ (không trùng) + người có dòng + người giữ vị trí. */
export function countRoster(staffIds: string[], lines: SheetLineDraft[], holderIds: Set<string> = new Set()) {
  const byStaff = new Map(lines.map((l) => [l.staff_id, l]))
  const all = new Set([...staffIds, ...lines.map((l) => l.staff_id), ...holderIds])
  let co = 0
  let vang = 0
  let chuaGiao = 0
  for (const id of all) {
    const st = classifyTile(byStaff.get(id), holderIds.has(id))
    if (st === "co_mat") co += 1
    else if (st === "chua_giao") chuaGiao += 1
    else vang += 1
  }
  return { co, vang, chuaGiao }
}

/** Gợi ý từ phiếu ca gần nhất: chép việc + xe cho người còn trong danh sách (không chép vắng / người thay / xếp loại). */
export function suggestFromPrevious(prevLines: DbLine[], rosterIds: Set<string>, activeJobIds: Set<string>): SheetLineDraft[] {
  const out: SheetLineDraft[] = []
  for (const p of prevLines) {
    if (p.diem_danh !== "co" || !rosterIds.has(p.staff_id)) continue
    const jobs = jobIdsOf(p).filter((j) => activeJobIds.has(j))
    if (jobs.length === 0) continue
    out.push(emptyLine({ staff_id: p.staff_id, cong_viec_ids: jobs, vehicle_id: p.vehicle_id || "" }))
  }
  return out
}

/** Chỉ người có việc / vắng / đang giữ vị trí phụ trách mới lưu. Người giữ vị trí chưa có dòng ⇒ thêm dòng Có mặt A. */
export function linesToPayload(lines: SheetLineDraft[], holderIds: Set<string> = new Set()) {
  const kept = lines.filter((l) => l.staff_id && (l.diem_danh === "vang" || l.cong_viec_ids.length > 0 || holderIds.has(l.staff_id)))
  const has = new Set(kept.map((l) => l.staff_id))
  for (const id of holderIds) if (!has.has(id)) kept.push(emptyLine({ staff_id: id }))
  return kept.map((l, i) => lineToPayload(l, i + 1))
}

export function lineToPayload(l: SheetLineDraft, stt: number) {
  const vang = l.diem_danh === "vang"
  return {
    id: l.id,
    stt,
    staff_id: l.staff_id,
    cong_viec_ids: l.cong_viec_ids,
    vehicle_id: l.vehicle_id || null,
    xep_loai: vang ? null : l.xep_loai,
    diem_danh: l.diem_danh,
    vang_loai: vang ? l.vang_loai || null : null,
    ly_do_id: vang && l.vang_loai === "khong_phep" ? l.ly_do_id || null : null,
    ly_do: vang && l.vang_loai === "khong_phep" ? l.ly_do : null,
    thay_the_staff_id: vang ? l.thay_the_staff_id || null : null,
    thay_the_ten: vang && !l.thay_the_staff_id ? l.thay_the_ten || null : null,
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
  cong_viec_ids: string[] | null
  vehicle_id: string | null
  xep_loai: "A" | "B" | null
  diem_danh: DiemDanh
  vang_loai: VangLoai | null
  ly_do_id: string | null
  ly_do: string | null
  thay_the_staff_id: string | null
  thay_the_ten: string | null
  ghi_chu: string | null
  la_them_ngoai: boolean
}

/** Việc của dòng DB (dòng cũ chỉ có cong_viec_id). */
export function jobIdsOf(r: Pick<DbLine, "cong_viec_id" | "cong_viec_ids">): string[] {
  if (r.cong_viec_ids && r.cong_viec_ids.length > 0) return r.cong_viec_ids
  return r.cong_viec_id ? [r.cong_viec_id] : []
}

export function dbLineToDraft(r: DbLine): SheetLineDraft {
  return emptyLine({
    id: r.id,
    staff_id: r.staff_id,
    cong_viec_ids: jobIdsOf(r),
    vehicle_id: r.vehicle_id || "",
    xep_loai: r.xep_loai || "A",
    diem_danh: r.diem_danh,
    vang_loai: r.vang_loai || "",
    ly_do_id: r.ly_do_id || "",
    ly_do: r.ly_do || "",
    thay_the_staff_id: r.thay_the_staff_id || "",
    thay_the_ten: r.thay_the_ten || "",
    ghi_chu: r.ghi_chu || "",
    la_them_ngoai: r.la_them_ngoai,
  })
}

/** Nhãn ngắn của 1 việc trên ô người (cắt ~14 ký tự). */
export function shortJobLabel(name: string, max = 14): string {
  const t = name.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
