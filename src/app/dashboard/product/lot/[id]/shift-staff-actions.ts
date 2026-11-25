"use server"

// C2b Truy vết (rule 31): nhân sự các ca sản xuất đã làm ra 1 lô thành phẩm — đọc phiếu điểm danh ca.
// Service role + tự xác thực access token: RLS các bảng attendance_* chặn người chỉ có product.view, nhưng người dùng
// chốt (2026-11-25) người xem Thành phẩm được thấy Việc + Người + Xe; xếp loại A/B và người vắng CHỈ trả cho người có
// quyền chấm công.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { loadGradeConfigServer } from "@/lib/product-grade-server"
import { dayChuyenForCsr } from "@/lib/product-lot-config"
import { assertProductAccess } from "@/app/dashboard/product/confirm/report-access"
import {
  isEmptyOpenSection,
  lineJobIds,
  linePerson,
  slotHolderText,
  type SectionLineLike,
  type SectionViTri,
} from "@/lib/attendance/section-people"

const ATTENDANCE_VIEW_PERMISSIONS = ["attendance.view", "attendance.approve", "attendance.mark_all", "attendance.shift_check"]

export type LotShiftPerson = {
  ten: string
  /** Người vắng mà người này thay. */
  thayCho?: string
  tam?: boolean
  xe?: string
  /** Chỉ trả khi người xem có quyền chấm công. */
  xepLoai?: string
}
export type LotShiftJobRow = { ten: string; people: LotShiftPerson[] }
export type LotShiftAbsent = { ten: string; loai: "co_phep" | "khong_phep" | null; lyDo: string | null; nguoiThay: string | null }

export type LotShiftBlock = {
  key: string
  ngay: string
  ca: string
  caTen: string
  /** Kiện của LÔ làm trong ca này + số bành / kg. */
  kien: string[]
  soBanh: number
  soKg: number
  /** Không có phiếu điểm danh (hoặc phiếu ca trống) ⇒ null. */
  section: null | {
    sheetId: string
    maPhieu: string
    trangThai: string
    caTruong: string
    caPho: string
    gioBatDau: string
    gioKetThuc: string
    rows: LotShiftJobRow[]
    vang: LotShiftAbsent[]
    soNguoi: number
  }
}

export type LotShiftStaffResult = { dayChuyen: string; canSeeAttendance: boolean; blocks: LotShiftBlock[] }

type TxRow = {
  lot_id?: string
  ngay_nhap: string | null
  ca: string | null
  kien_a: number | null
  kien_b: number | null
  kien_c: number | null
  kien_d: number | null
  so_banh: number | null
  so_kg: number | null
  created_at: string | null
  quet_luc?: string | null
  lots?: { loai_csr: string | null } | null
}
type SectionRow = {
  id: string
  sheet_id: string
  ca: string | null
  ca_truong_ten: string | null
  bat_dau_luc: string | null
  ket_thuc_luc: string | null
  trang_thai: string
  vi_tri: SectionViTri | null
}
type LineRow = SectionLineLike & {
  id: string
  section_id: string
  stt: number
  vehicle_id: string | null
  vang_loai: "co_phep" | "khong_phep" | null
  ly_do: string | null
}

const fmtHm = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : ""
const n = (v: number | null | undefined) => Number(v || 0)
const earlier = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : new Date(a).getTime() <= new Date(b).getTime() ? a : b

function chunk<T>(arr: T[], size = 200): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function canSeeAttendanceOf(token: string, factoryId: string): Promise<boolean> {
  try {
    await assertProductAccess(token, factoryId, ATTENDANCE_VIEW_PERMISSIONS, "xem chấm công")
    return true
  } catch {
    return false
  }
}

export async function loadLotShiftStaff(accessToken: string | null, factoryId: string, lotId: string): Promise<LotShiftStaffResult> {
  await assertProductAccess(accessToken, factoryId, ["product.view", ...ATTENDANCE_VIEW_PERMISSIONS], "xem nhân sự ca của lô")
  const canSeeAttendance = await canSeeAttendanceOf(accessToken as string, factoryId)
  const sb = getSupabaseAdmin()

  const { data: lot, error: lotErr } = await sb
    .from("lots")
    .select("id, factory_id, day_chuyen, loai_csr")
    .eq("id", lotId)
    .maybeSingle()
  if (lotErr) throw new Error(lotErr.message)
  if (!lot || lot.factory_id !== factoryId) throw new Error("Không tìm thấy lô.")

  const grade = await loadGradeConfigServer(factoryId)
  const dayChuyen = ((lot.day_chuyen as string | null) || "").trim() || dayChuyenForCsr((lot.loai_csr as string | null) || "", grade)

  // "*" để vẫn chạy khi cột quet_luc (migration 20261213) chưa có.
  const { data: txData, error: txErr } = await sb.from("lot_transactions").select("*").eq("lot_id", lotId).range(0, 4999)
  if (txErr) throw new Error(txErr.message)
  const lotTxs = (txData || []) as TxRow[]

  // ── Gom giao dịch của lô theo (ngày, ca) ──
  type Group = { ngay: string; ca: string; kien: Set<string>; soBanh: number; soKg: number }
  const groups = new Map<string, Group>()
  for (const t of lotTxs) {
    if (!t.ngay_nhap) continue
    const ca = (t.ca || "").trim()
    const key = `${t.ngay_nhap}|${ca}`
    const g = groups.get(key) || { ngay: t.ngay_nhap, ca, kien: new Set<string>(), soBanh: 0, soKg: 0 }
    if (n(t.kien_a) > 0) g.kien.add("A")
    if (n(t.kien_b) > 0) g.kien.add("B")
    if (n(t.kien_c) > 0) g.kien.add("C")
    if (n(t.kien_d) > 0) g.kien.add("D")
    g.soBanh += n(t.so_banh)
    g.soKg += n(t.so_kg)
    groups.set(key, g)
  }
  const groupList = Array.from(groups.values()).sort((a, b) => a.ngay.localeCompare(b.ngay) || a.ca.localeCompare(b.ca))
  if (groupList.length === 0) return { dayChuyen, canSeeAttendance, blocks: [] }

  const ngays = Array.from(new Set(groupList.map((g) => g.ngay)))
  const cas = Array.from(new Set(groupList.map((g) => g.ca).filter(Boolean)))

  const [sheetRes, unitRes, jobRes] = await Promise.all([
    sb
      .from("attendance_daily_sheets")
      .select("id, ngay, ma_phieu")
      .eq("factory_id", factoryId)
      .eq("day_chuyen", dayChuyen)
      .in("ngay", ngays),
    sb.from("attendance_units").select("code, ten").eq("factory_id", factoryId),
    sb.from("attendance_job_types").select("id, ten, sort_order").eq("factory_id", factoryId),
  ])
  for (const r of [sheetRes, unitRes, jobRes]) if (r.error) throw new Error(r.error.message)
  const sheets = (sheetRes.data || []) as { id: string; ngay: string; ma_phieu: string }[]
  const sheetByNgay = new Map(sheets.map((s) => [s.ngay, s]))
  const unitTen = new Map(((unitRes.data || []) as { code: string; ten: string }[]).map((u) => [u.code, u.ten]))
  const jobs = (jobRes.data || []) as { id: string; ten: string; sort_order: number }[]
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  // ── Phiếu ca + dòng ──
  let sections: SectionRow[] = []
  let lines: LineRow[] = []
  if (sheets.length > 0 && cas.length > 0) {
    const { data: secData, error: secErr } = await sb
      .from("attendance_sheet_sections")
      .select("id, sheet_id, ca, ca_truong_ten, bat_dau_luc, ket_thuc_luc, trang_thai, vi_tri")
      .eq("factory_id", factoryId)
      .eq("loai", "ca_san_xuat")
      .in("sheet_id", sheets.map((s) => s.id))
      .in("ca", cas)
    if (secErr) throw new Error(secErr.message)
    sections = (secData || []) as SectionRow[]
    if (sections.length > 0) {
      const { data: lineData, error: lineErr } = await sb
        .from("attendance_sheet_lines")
        .select("id, section_id, stt, staff_id, cong_viec_id, cong_viec_ids, vehicle_id, xep_loai, diem_danh, vang_loai, ly_do, thay_the_staff_id, thay_the_ten")
        .in("section_id", sections.map((s) => s.id))
        .order("stt")
        .range(0, 9999)
      if (lineErr) throw new Error(lineErr.message)
      lines = (lineData || []) as LineRow[]
    }
  }
  const withLines = new Set(lines.map((l) => l.section_id))
  sections = sections.filter((s) => !isEmptyOpenSection(s, withLines))

  // ── Tên nhân sự + mã xe chỉ theo id cần ──
  const staffIds = new Set<string>()
  for (const l of lines) {
    staffIds.add(l.staff_id)
    if (l.thay_the_staff_id) staffIds.add(l.thay_the_staff_id)
  }
  for (const s of sections) {
    for (const slot of [s.vi_tri?.truong, s.vi_tri?.pho]) {
      if (slot?.staff_id) staffIds.add(slot.staff_id)
      if (slot?.goc_staff_id) staffIds.add(slot.goc_staff_id)
    }
  }
  const staffName = new Map<string, string>()
  for (const ids of chunk(Array.from(staffIds))) {
    const { data, error } = await sb.from("maintenance_staff").select("id, ten").eq("factory_id", factoryId).in("id", ids)
    if (error) throw new Error(error.message)
    for (const r of (data || []) as { id: string; ten: string }[]) staffName.set(r.id, r.ten)
  }
  const name = (id: string | null | undefined) => (id ? staffName.get(id) || "" : "")
  const vehicleIds = Array.from(new Set(lines.map((l) => l.vehicle_id).filter((v): v is string => !!v)))
  const vehicleCode = new Map<string, string>()
  for (const ids of chunk(vehicleIds)) {
    const { data, error } = await sb.from("dispatch_vehicles").select("id, code, name").eq("factory_id", factoryId).in("id", ids)
    if (error) throw new Error(error.message)
    for (const r of (data || []) as { id: string; code: string | null; name: string | null }[]) vehicleCode.set(r.id, r.code || r.name || "")
  }

  // ── Giờ kết thúc ca = kiện quét cuối của CẢ ca (dây chuyền của lô), như phiếu TKSX ──
  const lastScan = new Map<string, string>()
  // Giờ bắt đầu = sớm hơn giữa kiện quét đầu tiên của ca và lúc mở phiếu điểm danh (điểm danh có thể mở sau khi đã chạy).
  const firstScan = new Map<string, string>()
  if (sections.length > 0) {
    const dayTxs = await fetchAllPaginated<TxRow>((from, to) =>
      // lots!inner nhiều-1 ⇒ 1 object; "*" để chạy khi thiếu cột quet_luc.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb as any)
        .from("lot_transactions")
        .select("*, lots!inner(factory_id, loai_csr)")
        .eq("lots.factory_id", factoryId)
        .in("ngay_nhap", ngays)
        .in("ca", cas)
        .order("id", { ascending: true })
        .range(from, to),
    )
    for (const t of dayTxs) {
      if (!t.ngay_nhap || !t.lots?.loai_csr || dayChuyenForCsr(t.lots.loai_csr, grade) !== dayChuyen) continue
      const at = t.quet_luc || t.created_at
      if (!at) continue
      const key = `${t.ngay_nhap}|${(t.ca || "").trim()}`
      const cur = lastScan.get(key)
      if (!cur || new Date(at).getTime() > new Date(cur).getTime()) lastScan.set(key, at)
      const first = firstScan.get(key)
      if (!first || new Date(at).getTime() < new Date(first).getTime()) firstScan.set(key, at)
    }
  }

  const blocks: LotShiftBlock[] = groupList.map((g) => {
    const key = `${g.ngay}|${g.ca}`
    const sheet = sheetByNgay.get(g.ngay)
    const sec = sheet ? sections.find((s) => s.sheet_id === sheet.id && (s.ca || "") === g.ca) : undefined
    const base = {
      key,
      ngay: g.ngay,
      ca: g.ca,
      caTen: unitTen.get(g.ca) || (g.ca ? `Ca ${g.ca}` : "Không rõ ca"),
      kien: Array.from(g.kien).sort(),
      soBanh: g.soBanh,
      soKg: Math.round(g.soKg * 100) / 100,
    }
    if (!sheet || !sec) return { ...base, section: null }

    const ls = lines.filter((l) => l.section_id === sec.id)
    const rowByJob = new Map<string, LotShiftJobRow>()
    const order: string[] = []
    const people = new Set<string>()
    for (const l of ls) {
      const p = linePerson(l, name)
      if (!p) continue
      people.add(p.staffId || p.ten)
      const person: LotShiftPerson = { ten: p.ten }
      if (p.thayCho) person.thayCho = p.thayCho
      if (p.tam) person.tam = true
      // Xe ghi trên dòng của người có mặt; người thay nhận việc + xe của dòng.
      if (l.vehicle_id) person.xe = vehicleCode.get(l.vehicle_id) || undefined
      if (canSeeAttendance && p.xepLoai) person.xepLoai = p.xepLoai
      for (const jid of lineJobIds(l)) {
        const j = jobById.get(jid)
        if (!j) continue
        let row = rowByJob.get(jid)
        if (!row) {
          row = { ten: j.ten, people: [] }
          rowByJob.set(jid, row)
          order.push(jid)
        }
        if (!row.people.some((x) => x.ten === person.ten)) row.people.push(person)
      }
    }
    const rows = order
      .sort((a, b) => (jobById.get(a)?.sort_order ?? 0) - (jobById.get(b)?.sort_order ?? 0))
      .map((id) => rowByJob.get(id) as LotShiftJobRow)
    const vang: LotShiftAbsent[] = canSeeAttendance
      ? ls
          .filter((l) => l.diem_danh === "vang")
          .map((l) => ({
            ten: name(l.staff_id),
            loai: l.vang_loai,
            lyDo: l.ly_do,
            nguoiThay: l.thay_the_staff_id ? name(l.thay_the_staff_id) : l.thay_the_ten ? `${l.thay_the_ten} (tạm)` : null,
          }))
      : []
    const vt = sec.vi_tri || {}
    return {
      ...base,
      section: {
        sheetId: sheet.id,
        maPhieu: sheet.ma_phieu,
        trangThai: sec.trang_thai,
        caTruong: slotHolderText(vt.truong, name) || (sec.ca_truong_ten || ""),
        caPho: slotHolderText(vt.pho, name),
        gioBatDau: fmtHm(earlier(firstScan.get(key) || null, sec.bat_dau_luc)),
        gioKetThuc: fmtHm(lastScan.get(key) || sec.ket_thuc_luc),
        rows,
        vang,
        soNguoi: people.size,
      },
    }
  })

  return { dayChuyen, canSeeAttendance, blocks }
}
