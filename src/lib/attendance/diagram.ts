// A3 — "Sơ đồ dây chuyền" Mủ tạp trên màn điểm danh (rule 31 mục A3). Hàm THUẦN (client / script).
// Sơ đồ gom nhiều phiếu Ca/Tổ của cùng phiếu ngày: Tổ cơ điện, XLNT, Đội xe cơ khí, Tổ tiếp nhận mủ tạp + 1 Ca (chip).
// Ô ↔ việc qua attendance_job_types.so_do_vi_tri (migration 20261221).

import type { AttendanceJobType } from "./types"
import { CA_NGAY, assignToProductionCa, emptyLine, genderRank, type AttendanceUnit, type SheetLineDraft } from "./shift"

export const STATION_KEYS = [
  "truc_ca", "lo_say", "bao_tri", "xlnt", "co_khi", "xe_nang",
  "tn_xuc", "tn_xe", "tn_vs",
  "ca_xuc", "ca_xe", "ca_can", "ca_bam", "ca_pha", "ca_ralo", "ca_ep", "ca_bao", "ca_kien", "ca_vs",
] as const
export type StationKey = (typeof STATION_KEYS)[number]

/** Nhãn ô ở Cài đặt (tên việc thật hiện trên màn điểm danh). */
export const STATION_LABEL: Record<StationKey, string> = {
  truc_ca: "Trực ca",
  lo_say: "Vận hành lò sấy",
  bao_tri: "Bảo trì máy",
  xlnt: "Trực hồ XLNT",
  co_khi: "Sửa chữa cơ khí",
  xe_nang: "Lái xe nâng",
  tn_xuc: "Tiếp nhận · Vận hành xe xúc",
  tn_xe: "Tiếp nhận · Xé nhỏ - lưu kho",
  tn_vs: "Tiếp nhận · Vệ sinh kho",
  ca_xuc: "Ca · Xe xúc tiếp liệu",
  ca_xe: "Ca · Tiếp liệu & vận hành máy xé",
  ca_can: "Ca · Vận hành máy cán",
  ca_bam: "Ca · Vận hành băm tinh",
  ca_pha: "Ca · Phả mủ",
  ca_ralo: "Ca · Ra lò",
  ca_ep: "Ca · Cân ép bành mủ",
  ca_bao: "Ca · Vô bao dán nhãn",
  ca_kien: "Ca · Cắt mẫu - vô kiện",
  ca_vs: "Ca · Vệ sinh dây chuyền",
}

export const TRUC_STATIONS: StationKey[] = ["truc_ca", "lo_say", "bao_tri", "xlnt", "co_khi", "xe_nang"]
export const TN_BAND: StationKey[] = ["tn_xuc", "tn_xe", "tn_vs"]
/** 3 dải viên thuốc của Ca. Dải 3 hiển thị theo thứ tự trái → phải, mũi tên chỉ sang TRÁI. */
export const CA_BANDS: { keys: StationKey[]; dir: "right" | "left" }[] = [
  { keys: ["ca_xuc", "ca_xe", "ca_can"], dir: "right" },
  { keys: ["ca_bam", "ca_pha", "ca_ralo", "ca_ep"], dir: "right" },
  { keys: ["ca_vs", "ca_kien", "ca_bao"], dir: "left" },
]
/** Dây chuyền có sơ đồ. */
export const DIAGRAM_DAY_CHUYEN = "Mủ tạp"

export function isStationKey(v: unknown): v is StationKey {
  return typeof v === "string" && (STATION_KEYS as readonly string[]).includes(v)
}

export type ProdWindow = { ca: string; start: string; end: string }
export type DiagramLine = SheetLineDraft & { giao_luc: string | null }
export type DiagramSectionInput = {
  id: string
  /** Mã Ca/Tổ của phiếu. */
  ca: string
  trang_thai: string
  lines: DiagramLine[]
}

/** 1 người hiện trong ô. workerId null = tên gõ tay "(tạm)". */
export type DiagramPerson = {
  key: string
  sectionId: string
  unitCode: string
  lineId: string
  lineStaffId: string
  jobId: string
  workerId: string | null
  name: string
  gioiTinh: string | null
  vehicleId: string
  temp: boolean
  /** A4 — dòng đã gửi (phiếu tổ): không gỡ / chuyển được trừ admin. */
  locked: boolean
}
export type DiagramCell = {
  key: StationKey
  job: AttendanceJobType | null
  /** Mã Ca/Tổ chủ ô (việc của tổ ⇒ unit_code; việc ca ⇒ ca đang chọn). */
  unitCode: string | null
  people: DiagramPerson[]
}
export type DiagramOther = { job: AttendanceJobType; unitCode: string; people: DiagramPerson[] }
export type DiagramModel = {
  cells: Record<StationKey, DiagramCell>
  others: DiagramOther[]
  /** Tổ ghi giờ / tổ theo giờ giao việc nhưng ca đang chọn chưa có kiện quét ⇒ hiện tất cả người của tổ. */
  noWindowForCa: boolean
}

/** Việc gắn từng ô (việc đang dùng). */
export function stationJobs(jobs: AttendanceJobType[]): Map<StationKey, AttendanceJobType> {
  const m = new Map<StationKey, AttendanceJobType>()
  for (const j of jobs) {
    if (!j.is_active || !isStationKey(j.so_do_vi_tri)) continue
    if (!m.has(j.so_do_vi_tri)) m.set(j.so_do_vi_tri, j)
  }
  return m
}

const ms = (iso: string) => new Date(iso).getTime()

/** Khoảng giờ làm (HH:MM, qua đêm nếu kết thúc ≤ bắt đầu) của ngày `ngay` có giao khung kiện quét không. */
export function workOverlapsWindow(ngay: string, bd: string, kt: string, w: ProdWindow): boolean {
  if (!bd || !kt) return true
  const s = ms(`${ngay}T${bd}:00+07:00`)
  let e = ms(`${ngay}T${kt}:00+07:00`)
  if (!Number.isFinite(s) || !Number.isFinite(e)) return true
  if (e <= s) e += 24 * 3600 * 1000
  const ws = ms(w.start)
  const we = ms(w.end)
  if (!Number.isFinite(ws) || !Number.isFinite(we)) return true
  return s <= we && e >= ws
}

/**
 * Dòng của TỔ có hiện khi đang xem ca `chipCa` không.
 * Tổ ghi giờ: giờ làm giao khung kiện quét của ca (24h luôn hiện). Tổ khác: giờ giao việc xếp đúng ca.
 * Ca chưa có kiện quét ⇒ hiện (caller báo "chưa có kiện quét").
 */
export function toLineVisible(unit: AttendanceUnit, line: DiagramLine, chipCa: string, windows: ProdWindow[], ngay: string): boolean {
  // A4 — tổ phân ca: theo ca của dòng (Cả ngày luôn hiện). Dòng cũ chưa có ca ⇒ quy tắc giờ giao việc bên dưới.
  if (unit.phan_ca && line.ca_phan_cong) return line.ca_phan_cong === chipCa || line.ca_phan_cong === CA_NGAY
  const w = windows.find((x) => x.ca === chipCa)
  if (!w) return true
  if (unit.khung_mac_dinh) {
    if (!line.gio_bd || !line.gio_kt || line.gio_bd === line.gio_kt) return true
    return workOverlapsWindow(ngay, line.gio_bd, line.gio_kt, w)
  }
  if (!line.giao_luc) return true
  const ca = assignToProductionCa(line.giao_luc, windows)
  return !ca || ca === chipCa
}

type StaffLite = { ten: string; gioi_tinh: string | null }

export function buildDiagram(args: {
  jobs: AttendanceJobType[]
  units: AttendanceUnit[]
  sections: DiagramSectionInput[]
  chipCa: string
  windows: ProdWindow[]
  ngay: string
  dayChuyen: string
  staffById: Map<string, StaffLite>
  tempSuffix: string
}): DiagramModel {
  const { jobs, units, sections, chipCa, windows, ngay, dayChuyen, staffById, tempSuffix } = args
  const unitByCode = new Map(units.map((u) => [u.code, u]))
  const byStation = stationJobs(jobs)
  const stationOfJob = new Map<string, StationKey>()
  for (const [k, j] of byStation) stationOfJob.set(j.id, k)
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  const cells = {} as Record<StationKey, DiagramCell>
  for (const key of STATION_KEYS) {
    const job = byStation.get(key) || null
    cells[key] = { key, job, unitCode: job ? job.unit_code || chipCa : null, people: [] }
  }
  const others = new Map<string, DiagramOther>()
  const chipHasWindow = windows.some((w) => w.ca === chipCa)
  let usesWindowFilter = false

  for (const sec of sections) {
    const unit = unitByCode.get(sec.ca)
    if (!unit) continue
    if (unit.loai === "ca" && sec.ca !== chipCa) continue
    if (unit.loai === "to" && unit.day_chuyen && unit.day_chuyen !== dayChuyen) continue
    for (const l of sec.lines) {
      let workerId: string | null
      let name: string
      let temp = false
      if (l.diem_danh === "co") {
        workerId = l.staff_id
        name = staffById.get(l.staff_id)?.ten || "?"
      } else if (l.thay_the_staff_id) {
        workerId = l.thay_the_staff_id
        name = staffById.get(l.thay_the_staff_id)?.ten || "?"
      } else if (l.thay_the_ten) {
        workerId = null
        name = `${l.thay_the_ten} (${tempSuffix})`
        temp = true
      } else continue
      if (unit.loai === "to") {
        usesWindowFilter = true
        if (!toLineVisible(unit, l, chipCa, windows, ngay)) continue
      }
      for (const jobId of l.cong_viec_ids) {
        const job = jobById.get(jobId)
        if (!job || job.an_diem_danh) continue
        const person: DiagramPerson = {
          key: `${sec.id}:${l.id}:${jobId}`,
          sectionId: sec.id,
          unitCode: sec.ca,
          lineId: l.id,
          lineStaffId: l.staff_id,
          jobId,
          workerId,
          name,
          gioiTinh: workerId ? staffById.get(workerId)?.gioi_tinh || null : null,
          vehicleId: l.vehicle_id,
          temp,
          locked: !!l.gui_luc,
        }
        const st = stationOfJob.get(jobId)
        // Việc ca chỉ thuộc ô khi đúng phiếu Ca; việc tổ chỉ thuộc ô khi đúng phiếu tổ đó.
        if (st && cells[st].unitCode === sec.ca) cells[st].people.push(person)
        else {
          const o = others.get(`${sec.ca}:${jobId}`) || { job, unitCode: sec.ca, people: [] }
          o.people.push(person)
          others.set(`${sec.ca}:${jobId}`, o)
        }
      }
    }
  }
  for (const key of STATION_KEYS) cells[key].people.sort((a, b) => genderRank(a.gioiTinh) - genderRank(b.gioiTinh) || a.name.localeCompare(b.name, "vi"))
  return {
    cells,
    others: Array.from(others.values()).sort((a, b) => a.job.sort_order - b.job.sort_order),
    noWindowForCa: usesWindowFilter && !chipHasWindow,
  }
}

// ── Sửa dòng (thuần) ──
export type LineEditOptions = {
  /** Giờ làm mặc định của tổ ghi giờ (null = đơn vị không ghi giờ). */
  hours: { bd: string; kt: string } | null
  /** Xe mặc định của người (tài xế chính / phụ). */
  vehicleOf: (staffId: string) => string
  jobById: Map<string, AttendanceJobType>
  /** A4 — tổ phân ca: ca của dòng được giao (undefined = đơn vị không phân ca). */
  caPhanCong?: string
  /** A4b — dòng này người đang thao tác sửa được không (giữ chỗ theo người giao). Không truyền = sửa được. */
  canEdit?: (l: SheetLineDraft) => boolean
}
export type LineEditResult = { lines: SheetLineDraft[]; error?: "absent" | "not_found" | "locked" }

/** Bỏ 1 việc khỏi 1 dòng. Dòng có mặt hết việc ⇒ xoá dòng (người giữ vị trí vẫn được linesToPayload giữ lại). */
export function removeJobFromLine(lines: SheetLineDraft[], lineId: string, jobId: string, canEdit?: (l: SheetLineDraft) => boolean): LineEditResult {
  const idx = lines.findIndex((l) => l.id === lineId)
  if (idx < 0) return { lines, error: "not_found" }
  const l = lines[idx]
  if (canEdit && !canEdit(l)) return { lines, error: "locked" }
  const ids = l.cong_viec_ids.filter((x) => x !== jobId)
  if (ids.length === 0 && l.diem_danh === "co") return { lines: lines.filter((_, i) => i !== idx) }
  const out = [...lines]
  out[idx] = { ...l, cong_viec_ids: ids, ...(ids.length === 0 ? { gio_bd: "", gio_kt: "", vehicle_id: "" } : {}) }
  return { lines: out }
}

function withJob(l: SheetLineDraft, jobId: string, opt: LineEditOptions, workerId: string): SheetLineDraft {
  if (l.cong_viec_ids.includes(jobId)) return l
  const ids = [...l.cong_viec_ids, jobId]
  const needsVehicle = !!opt.jobById.get(jobId)?.loai_xe
  return {
    ...l,
    cong_viec_ids: ids,
    vehicle_id: l.vehicle_id || (needsVehicle ? opt.vehicleOf(workerId) : ""),
    gio_bd: l.gio_bd || opt.hours?.bd || "",
    gio_kt: l.gio_kt || opt.hours?.kt || "",
  }
}

/** Giao 1 việc cho người: có dòng có mặt / đang là người thay ⇒ thêm việc; đang vắng ⇒ từ chối; chưa có ⇒ dòng mới. */
export function addJobForWorker(lines: SheetLineDraft[], workerId: string, jobId: string, opt: LineEditOptions): LineEditResult {
  const ca = opt.caPhanCong
  const can = opt.canEdit || (() => true)
  const sameCa = (l: SheetLineDraft) => ca === undefined || (l.ca_phan_cong || "") === ca
  if (ca !== undefined) {
    // Tổ phân ca: người đã làm Cả ngày không nhận thêm ca khác (và ngược lại).
    const mine = lines.filter((l) => l.staff_id === workerId && (l.diem_danh === "vang" || l.cong_viec_ids.length > 0))
    if (mine.some((l) => (l.ca_phan_cong === CA_NGAY) !== (ca === CA_NGAY) && l.ca_phan_cong)) return { lines, error: "locked" }
    // Tổ phân ca: (người, ca) chỉ 1 dòng — dòng đó không sửa được ⇒ khoá.
    const same = lines.find((l) => l.staff_id === workerId && sameCa(l))
    if (same && !can(same)) return { lines, error: "locked" }
  }
  // Tổ không phân ca: chỉ thêm vào dòng mình sửa được; dòng người khác giao ⇒ tạo phân công riêng (giữ chỗ).
  const own = lines.findIndex((l) => l.staff_id === workerId && sameCa(l) && can(l))
  if (own >= 0) {
    if (lines[own].diem_danh === "vang") return { lines, error: "absent" }
    const out = [...lines]
    out[own] = withJob(lines[own], jobId, opt, workerId)
    return { lines: out }
  }
  const sub = lines.findIndex((l) => l.diem_danh === "vang" && l.thay_the_staff_id === workerId && sameCa(l) && can(l))
  if (sub >= 0) {
    const out = [...lines]
    out[sub] = withJob(lines[sub], jobId, opt, workerId)
    return { lines: out }
  }
  const needsVehicle = !!opt.jobById.get(jobId)?.loai_xe
  return {
    lines: [
      ...lines,
      emptyLine({
        staff_id: workerId,
        cong_viec_ids: [jobId],
        diem_danh: "co",
        xep_loai: "A",
        vehicle_id: needsVehicle ? opt.vehicleOf(workerId) : "",
        gio_bd: opt.hours?.bd || "",
        gio_kt: opt.hours?.kt || "",
        ca_phan_cong: ca || "",
      }),
    ],
  }
}

/** Đổi việc trên CÙNG 1 dòng (chuyển ô trong cùng phiếu): bỏ việc cũ, nhận việc mới, giữ việc khác. */
export function moveJobOnLine(lines: SheetLineDraft[], lineId: string, fromJobId: string, toJobId: string, opt: LineEditOptions, workerId: string): LineEditResult {
  const idx = lines.findIndex((l) => l.id === lineId)
  if (idx < 0) return { lines, error: "not_found" }
  const l = lines[idx]
  if (opt.canEdit && !opt.canEdit(l)) return { lines, error: "locked" }
  const kept = l.cong_viec_ids.filter((x) => x !== fromJobId)
  const out = [...lines]
  out[idx] = withJob({ ...l, cong_viec_ids: kept }, toJobId, opt, workerId)
  return { lines: out }
}

/** Người (workerId) đang ở ô `jobId` trên dòng nào của phiếu (để bỏ khi bỏ tick ở tấm chọn người). */
export function lineOfWorkerJob(lines: SheetLineDraft[], workerId: string, jobId: string, ca?: string): SheetLineDraft | undefined {
  return lines.find(
    (l) =>
      l.cong_viec_ids.includes(jobId) &&
      (ca === undefined || (l.ca_phan_cong || "") === ca || l.ca_phan_cong === CA_NGAY) &&
      ((l.diem_danh === "co" && l.staff_id === workerId) || (l.diem_danh === "vang" && l.thay_the_staff_id === workerId)),
  )
}
