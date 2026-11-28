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
  /** Ca/Tổ được mở khi quét QR này (20261219). NULL/rỗng = mọi Ca/Tổ. */
  unit_codes?: string[] | null
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
  /** A2 (20261219): NULL = tổ/ca thường; "auto" = chấm theo khung ngày/đêm; "24h" = khung 24 giờ. */
  khung_mac_dinh?: KhungMode | null
  /** A4 (20261222): tổ phân ca — mỗi dòng có Ca (Ca A/B/C hoặc CA_NGAY). Seed: CD. */
  phan_ca?: boolean
}
export const UNIT_SELECT = "id, code, ten, ten_khmer, loai, to_nhom, day_chuyen, sort_order, is_active, khung_mac_dinh, phan_ca"

// ── A4: Tổ phân ca (Tổ cơ điện – bảo trì – xe nâng) ──
/** Mã "Cả ngày (24h)" của ca_phan_cong. */
export const CA_NGAY = "CA_NGAY"

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
  /** A2 — tổ ghi giờ làm: giờ bắt đầu / kết thúc (HH:MM). "" ở đơn vị khác. */
  gio_bd: string
  gio_kt: string
  /** A4 — tổ phân ca: mã Ca (A/B/C) hoặc CA_NGAY; "" ở đơn vị khác. 1 người làm 2 ca = 2 dòng. */
  ca_phan_cong: string
  /** A4 — phiếu tổ: lần gửi có dòng này. Chỉ đọc (server ghi). */
  gui_luc: string
  /** A4b — người giao (giữ chỗ). "" = dòng mới chưa lưu (của người đang thao tác). Chỉ đọc. */
  lap_boi: string
  gui_boi: string
  /** A4b — tổ phân ca: đã được trực ca của đúng ca đó gửi ⇒ khoá hẳn. */
  chot_ca: boolean
}

export const SECTION_SELECT =
  "id, sheet_id, factory_id, loai, ca, ca_truong_ten, to_truong_staff_id, to_pho_staff_id, truc_ca_user_id, truc_ca_staff_id, ngoai_phan_cong, bat_dau_luc, ket_thuc_luc, trang_thai, gui_luc, duyet_luc, duyet_boi, tra_ve_ly_do, tra_ve_luc, ghi_chu, vi_tri"

export const LINE_SELECT =
  "id, section_id, stt, staff_id, cong_viec_id, cong_viec_ids, vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_the_staff_id, thay_the_ten, ghi_chu, la_them_ngoai, giao_luc, gio_bd, gio_kt, ca_phan_cong, gui_luc, lap_boi, gui_boi, chot_ca"

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
    gio_bd: "",
    gio_kt: "",
    ca_phan_cong: "",
    gui_luc: "",
    lap_boi: "",
    gui_boi: "",
    chot_ca: false,
    ...patch,
  }
}

// ── A2: tổ chấm theo GIỜ LÀM của từng người (20261220) ──
// auto (Tổ tiếp nhận mủ tạp) ⇒ theo giờ điểm danh; 24h (Tổ XLNT) ⇒ 05:00–05:00; ngay (Đội xe cơ khí) ⇒ 05:00–17:00.
export type KhungMode = "auto" | "24h" | "ngay"

/** Giờ ở múi giờ nhà máy (0–23) của 1 thời điểm. */
export function factoryHour(d: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Ho_Chi_Minh" }).format(d)
  return Number(h) || 0
}

/** Giờ làm mặc định khi giao việc (sửa được). null = đơn vị không ghi giờ làm. */
export function defaultWorkHours(mode: KhungMode | null | undefined, now: Date = new Date()): { bd: string; kt: string } | null {
  if (mode === "24h") return { bd: "05:00", kt: "05:00" }
  if (mode === "ngay") return { bd: "05:00", kt: "17:00" }
  if (mode !== "auto") return null
  const h = factoryHour(now)
  return h >= 5 && h < 17 ? { bd: "05:00", kt: "17:00" } : { bd: "17:00", kt: "05:00" }
}

/** "05:00 – 17:00" ("" nếu thiếu). */
export function workHoursLabel(bd: string | null | undefined, kt: string | null | undefined): string {
  return bd && kt ? `${bd} – ${kt}` : ""
}

/** Dòng tổ ghi giờ làm có việc mà thiếu giờ (bắt buộc khi gửi). */
export function linesMissingHours(lines: SheetLineDraft[], mode: KhungMode | null | undefined): SheetLineDraft[] {
  if (!mode) return []
  return lines.filter((l) => l.cong_viec_ids.length > 0 && (!l.gio_bd || !l.gio_kt))
}

/**
 * Xếp 1 giờ giao việc vào ca sản xuất theo khung giờ thật (kiện quét đầu → cuối):
 * trong khung của ca nào ⇒ ca đó (chồng nhau ⇒ ca bắt đầu muộn nhất); trước mọi ca ⇒ ca bắt đầu gần nhất sau đó;
 * sau mọi ca ⇒ ca kết thúc gần nhất. Không có khung nào ⇒ null.
 */
export function assignToProductionCa(giaoLuc: string | null | undefined, windows: { ca: string; start: string; end: string }[]): string | null {
  if (!giaoLuc || windows.length === 0) return null
  const t = new Date(giaoLuc).getTime()
  if (!Number.isFinite(t)) return null
  const ws = windows
    .map((w) => ({ ca: w.ca, s: new Date(w.start).getTime(), e: new Date(w.end).getTime() }))
    .filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e))
  if (ws.length === 0) return null
  const inside = ws.filter((w) => t >= w.s && t <= w.e).sort((a, b) => b.s - a.s)
  if (inside.length > 0) return inside[0].ca
  const after = ws.filter((w) => w.s > t).sort((a, b) => a.s - b.s)
  if (after.length > 0) return after[0].ca
  return ws.sort((a, b) => b.e - a.e)[0].ca
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

/**
 * Việc "Trực ca" của Ca/Tổ đang điểm danh (hiện thuộc Tổ cơ điện – bảo trì – xe nâng). Nhận diện theo TÊN đã bỏ dấu
 * ("truc ca") để không hard-code mã tổ / id việc. null = đơn vị không có việc này.
 */
export function findTrucCaJob<
  J extends { id: string; ten: string; day_chuyen: string | null; to_nhom: string; unit_code?: string | null; is_active: boolean },
>(jobs: J[], unit: Pick<AttendanceUnit, "code" | "loai"> | null, dayChuyen: string): J | null {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim()
  return jobs.find((j) => j.is_active && norm(j.ten) === "truc ca" && isJobOfUnit(j, unit, dayChuyen)) || null
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
  const byStaff = groupLinesByStaff(lines)
  const all = new Set([...staffIds, ...lines.map((l) => l.staff_id), ...holderIds])
  let co = 0
  let vang = 0
  let chuaGiao = 0
  for (const id of all) {
    const st = classifyTiles(byStaff.get(id) || [], holderIds.has(id))
    if (st === "co_mat") co += 1
    else if (st === "chua_giao") chuaGiao += 1
    else vang += 1
  }
  return { co, vang, chuaGiao }
}

/**
 * A2b — gợi ý từ phiếu cùng Ca/Tổ + dây chuyền gần nhất: chép NGUYÊN bố trí (người dùng chốt 2026-11-26).
 * - Có mặt có việc ⇒ việc + giờ làm (tổ ghi giờ) + xe (kể cả người mượn ngoài danh sách — tự hiện ở thẻ "Khác").
 * - Vắng CÓ người thay ⇒ chép vắng + người thay (cả tên gõ tay "(tạm)") + việc + xe.
 * - Không chép giờ giao việc (giao_luc tính lại lúc lưu).
 * - KHÔNG chép: xếp loại (về A), có / không phép, lý do; vắng không người thay.
 * - Bỏ người (hoặc người thay) đã nghỉ việc / ngoài khoảng làm việc ngày `ngay`.
 */
export function suggestFromPrevious(
  prevLines: DbLine[],
  staffById: Map<string, ShiftStaff>,
  ngay: string,
  activeJobIds: Set<string>,
): SheetLineDraft[] {
  const out: SheetLineDraft[] = []
  const working = (id: string | null | undefined) => {
    const s = id ? staffById.get(id) : undefined
    return !!s && !s.cho_xac_nhan && isStaffWorking(s, ngay)
  }
  // Khoá 1 dòng / người / ca (tổ phân ca: người làm 2 ca = 2 dòng; đơn vị khác: ca rỗng ⇒ 1 dòng / người).
  const used = new Set<string>()
  const sorted = [...prevLines].sort((a, b) => (a.stt ?? 0) - (b.stt ?? 0))
  for (const p of sorted) {
    const ca = p.ca_phan_cong || ""
    const key = `${p.staff_id}:${ca}`
    if (!working(p.staff_id) || used.has(key)) continue
    const jobs = jobIdsOf(p).filter((j) => activeJobIds.has(j))
    if (jobs.length === 0) continue
    const gio = { gio_bd: p.gio_bd || "", gio_kt: p.gio_kt || "", ca_phan_cong: ca }
    if (p.diem_danh === "co") {
      out.push(emptyLine({ staff_id: p.staff_id, cong_viec_ids: jobs, vehicle_id: p.vehicle_id || "", ...gio }))
      used.add(key)
      continue
    }
    const tenTam = (p.thay_the_ten || "").trim()
    if (p.thay_the_staff_id) {
      if (!working(p.thay_the_staff_id)) continue
    } else if (!tenTam) continue
    out.push(
      emptyLine({
        staff_id: p.staff_id,
        diem_danh: "vang",
        thay_the_staff_id: p.thay_the_staff_id || "",
        thay_the_ten: p.thay_the_staff_id ? "" : tenTam,
        cong_viec_ids: jobs,
        vehicle_id: p.vehicle_id || "",
        ...gio,
      }),
    )
    used.add(key)
  }
  // Người thay có thể đồng thời có dòng riêng (1 người làm nhiều vị trí — chốt 2026-11-27) ⇒ chép nguyên.
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
    // Server chỉ lưu ở phiếu tổ ghi giờ làm.
    gio_bd: l.cong_viec_ids.length > 0 ? l.gio_bd || null : null,
    gio_kt: l.cong_viec_ids.length > 0 ? l.gio_kt || null : null,
    // Server chỉ lưu ở tổ phân ca.
    ca_phan_cong: l.ca_phan_cong || null,
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
  /** Migration 20261219 / 20261220 (chạy TRƯỚC deploy — LINE_SELECT đọc các cột này). */
  giao_luc?: string | null
  gio_bd?: string | null
  gio_kt?: string | null
  /** Migration 20261222 (chạy TRƯỚC deploy). */
  ca_phan_cong?: string | null
  gui_luc?: string | null
  /** Migration 20261223. */
  lap_boi?: string | null
  gui_boi?: string | null
  chot_ca?: boolean | null
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
    gio_bd: r.gio_bd || "",
    gio_kt: r.gio_kt || "",
    ca_phan_cong: r.ca_phan_cong || "",
    gui_luc: r.gui_luc || "",
    lap_boi: r.lap_boi || "",
    gui_boi: r.gui_boi || "",
    chot_ca: !!r.chot_ca,
  })
}

/** A4b — ngữ cảnh quyền sửa dòng phiếu TỔ (mirror SQL attendance_line_editable, migration 20261223). */
export type LineEditCtx = {
  /** Phiếu đang mở là tổ (phiếu Ca sản xuất ⇒ mọi dòng sửa được theo quyền cả phiếu). */
  isTo: boolean
  phanCa: boolean
  userId: string
  myCas: string[]
  isAdmin: boolean
  sectionStatus: string
}

/**
 * Người đăng nhập sửa được 1 dòng phiếu tổ không (mirror SQL attendance_line_editable, migration 20261225):
 * chưa gửi / phiếu Trả về ⇒ chính người giao, hoặc (tổ phân ca) trực ca đúng ca; ĐÃ GỬI ⇒ chỉ admin
 * (muốn sửa: văn phòng Trả về / admin Thu hồi). Dòng mới chưa lưu (lap_boi rỗng) luôn của người đang thao tác.
 */
export function canEditLine(l: Pick<SheetLineDraft, "lap_boi" | "gui_luc" | "chot_ca" | "ca_phan_cong">, c: LineEditCtx): boolean {
  if (!c.isTo || c.isAdmin) return true
  if (l.gui_luc && c.sectionStatus !== "tra_ve") return false
  if (!l.lap_boi) return true
  const myCa = c.phanCa && !!l.ca_phan_cong && c.myCas.includes(l.ca_phan_cong)
  return l.lap_boi === c.userId || myCa
}

/** L1 (2026-11-28) — ngữ cảnh "phần của tôi" trên phiếu TỔ (người không phải admin chỉ thấy phần này). */
export type MineCtx = {
  userId: string
  /** Ca A/B/C người đăng nhập trực (phân công → Ca mặc định trong hồ sơ). */
  myCas: string[]
  phanCa: boolean
}

/** Dòng thuộc phần của tôi: tôi giao (hoặc dòng mới chưa lưu), hoặc (tổ phân ca) dòng của ca tôi dù ai giao. */
export function isLineMine(l: { lap_boi?: string | null; ca_phan_cong?: string | null }, c: MineCtx): boolean {
  if (!l.lap_boi || l.lap_boi === c.userId) return true
  return c.phanCa && !!l.ca_phan_cong && c.myCas.includes(l.ca_phan_cong)
}

/** Tách dòng phiếu tổ: `visible` (hiện + sửa) và `hidden` (người khác chấm cho ca khác — chỉ để kiểm trùng; server giữ nguyên). */
export function splitVisibleLines<L extends { lap_boi?: string | null; ca_phan_cong?: string | null }>(lines: L[], c: MineCtx): { visible: L[]; hidden: L[] } {
  const visible: L[] = []
  const hidden: L[] = []
  for (const l of lines) (isLineMine(l, c) ? visible : hidden).push(l)
  return { visible, hidden }
}

/** L3 — 1 phân công trùng với các dòng khác của CÙNG người (tổ phân ca: trùng ca / Cả ngày ↔ ca khác; tổ ghi giờ: chồng giờ). */
export function lineConflicts(
  draft: SheetLineDraft,
  others: SheetLineDraft[],
  opts: { phanCa: boolean; khung: boolean },
): SheetLineDraft[] {
  const has = (l: SheetLineDraft) => l.diem_danh === "vang" || l.cong_viec_ids.length > 0
  if (!has(draft)) return []
  return others.filter((o) => {
    if (o.id === draft.id || o.staff_id !== draft.staff_id || !has(o)) return false
    if (opts.phanCa) {
      if (!draft.ca_phan_cong || !o.ca_phan_cong) return false
      return o.ca_phan_cong === draft.ca_phan_cong || o.ca_phan_cong === CA_NGAY || draft.ca_phan_cong === CA_NGAY
    }
    if (opts.khung) return draft.cong_viec_ids.length > 0 && o.cong_viec_ids.length > 0 && workHoursOverlap(draft, o)
    return false
  })
}

/** A4b — 2 khoảng giờ làm (HH:MM, qua đêm khi kết thúc ≤ bắt đầu) có chồng nhau không. Thiếu giờ ⇒ coi như không chồng. */
export function workHoursOverlap(a: { gio_bd: string; gio_kt: string }, b: { gio_bd: string; gio_kt: string }): boolean {
  const toMin = (t: string) => {
    const m = /^(\d{2}):(\d{2})$/.exec(t || "")
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const range = (x: { gio_bd: string; gio_kt: string }): [number, number] | null => {
    const s0 = toMin(x.gio_bd)
    let e = toMin(x.gio_kt)
    if (s0 === null || e === null) return null
    if (e <= s0) e += 24 * 60
    return [s0, e]
  }
  const ra = range(a)
  const rb = range(b)
  if (!ra || !rb) return false
  // So cả khi một khoảng qua đêm: dịch khoảng kia +24h.
  const hit = (x: [number, number], y: [number, number]) => x[0] < y[1] && y[0] < x[1]
  return hit(ra, rb) || hit(ra, [rb[0] + 1440, rb[1] + 1440]) || hit([ra[0] + 1440, ra[1] + 1440], rb)
}

/** Khoá dòng nháp: người + ca (đơn vị không phân ca ⇒ ca rỗng ⇒ 1 dòng / người). */
export function lineKey(l: Pick<SheetLineDraft, "staff_id" | "ca_phan_cong">): string {
  return `${l.staff_id}:${l.ca_phan_cong || ""}`
}

/** Dòng đã gửi bị khoá việc / ca / xe (trừ admin). */
export function isLineLocked(l: Pick<SheetLineDraft, "gui_luc">, isAdmin: boolean): boolean {
  return !!l.gui_luc && !isAdmin
}

/** Nhãn ca của 1 dòng: "Ca A" / "Cả ngày". */
export function caPhanCongLabel(code: string, units: Map<string, { ten: string }>, caNgayLabel = "Cả ngày"): string {
  if (!code) return ""
  if (code === CA_NGAY) return caNgayLabel
  return units.get(code)?.ten || `Ca ${code}`
}

/** Các ca của 1 người trên phiếu tổ phân ca (có mặt có việc hoặc vắng), theo thứ tự đơn vị — "Ca A + Ca B" / "Cả ngày". */
export function personCaCodes(lines: SheetLineDraft[], staffId: string, order: string[]): string[] {
  const set = new Set(lines.filter((l) => l.staff_id === staffId && l.ca_phan_cong && (l.diem_danh === "vang" || l.cong_viec_ids.length > 0)).map((l) => l.ca_phan_cong))
  const rank = (c: string) => (c === CA_NGAY ? 999 : order.indexOf(c) < 0 ? 500 : order.indexOf(c))
  return Array.from(set).sort((a, b) => rank(a) - rank(b))
}

/** Trạng thái ô của 1 người có NHIỀU dòng (tổ phân ca): có mặt nếu bất kỳ dòng có mặt có việc. */
export function classifyTiles(ls: SheetLineDraft[], isHolder = false): TileState {
  if (ls.length <= 1) return classifyTile(ls[0], isHolder)
  if (ls.some((l) => l.diem_danh === "co" && l.cong_viec_ids.length > 0)) return "co_mat"
  const vang = ls.filter((l) => l.diem_danh === "vang")
  if (vang.length > 0) return vang.some((l) => l.thay_the_staff_id || l.thay_the_ten) ? "vang_co_thay" : "vang"
  return isHolder ? "co_mat" : "chua_giao"
}

/**
 * A4 — tổ phân ca: người vừa có dòng CŨ chưa có ca vừa có dòng đã có ca ⇒ gộp việc của dòng cũ vào dòng có ca đầu tiên,
 * bỏ dòng cũ (không để 2 dòng song song chặn gửi). `canEdit(l)` = dòng cũ được sửa (chưa khoá / phiếu Trả về / admin).
 */
export function mergeLegacyCaLines(lines: SheetLineDraft[], canEdit: (l: SheetLineDraft) => boolean): { lines: SheetLineDraft[]; changed: boolean } {
  let out = lines
  let changed = false
  for (const legacy of lines.filter((l) => !l.ca_phan_cong && canEdit(l))) {
    const target = out.find((l) => l.staff_id === legacy.staff_id && !!l.ca_phan_cong)
    if (!target) continue
    const jobs = Array.from(new Set([...target.cong_viec_ids, ...legacy.cong_viec_ids]))
    out = out.filter((l) => l.id !== legacy.id).map((l) => (l.id === target.id ? { ...l, cong_viec_ids: jobs } : l))
    changed = true
  }
  return { lines: out, changed }
}

/** Gom dòng theo người (giữ thứ tự). */
export function groupLinesByStaff(lines: SheetLineDraft[]): Map<string, SheetLineDraft[]> {
  const m = new Map<string, SheetLineDraft[]>()
  for (const l of lines) m.set(l.staff_id, [...(m.get(l.staff_id) || []), l])
  return m
}

/** Nhãn ngắn của 1 việc trên ô người (cắt ~14 ký tự). */
export function shortJobLabel(name: string, max = 14): string {
  const t = name.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
