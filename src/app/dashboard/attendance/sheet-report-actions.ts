"use server"

// Dữ liệu phiếu triển khai sản xuất F01 / F02 của 1 phiếu điểm danh ngày (GĐ3 mục 4, rule 31).
// Service role + tự xác thực access token (không tin factory/user client gửi). Đọc cả lot_transactions /
// đơn xuất nên KHÔNG dựa RLS của người xem (nhân viên chấm công có thể không có quyền Thành phẩm).

import { createHash, randomUUID } from "crypto"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { mintSignedUrlForPath } from "@/lib/secure-file-url"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { loadGradeConfigServer } from "@/lib/product-grade-server"
import { dayChuyenForCsr } from "@/lib/product-lot-config"
import { assertProductAccess } from "@/app/dashboard/product/confirm/report-access"
import {
  f01FormOf,
  pushPerson,
  type F01Block,
  type F01JobRow,
  type F01Model,
  type F01Production,
} from "@/lib/attendance/f01-model"

const ATTENDANCE_REPORT_VIEW_PERMISSIONS = [
  "attendance.view",
  "attendance.approve",
  "attendance.mark_all",
  "attendance.shift_check",
]

type Slot = { staff_id: string | null; goc_staff_id: string | null }
type SectionRow = {
  id: string
  loai: string
  ca: string | null
  ca_truong_ten: string | null
  to_truong_staff_id: string | null
  to_pho_staff_id: string | null
  bat_dau_luc: string | null
  ket_thuc_luc: string | null
  trang_thai: string
  duyet_luc: string | null
  duyet_boi: string | null
  vi_tri: { truong?: Slot; pho?: Slot } | null
}
type LineRow = {
  id: string
  section_id: string
  stt: number
  staff_id: string
  cong_viec_id: string | null
  cong_viec_ids: string[] | null
  xep_loai: string | null
  diem_danh: "co" | "vang"
  vang_loai: "co_phep" | "khong_phep" | null
  ly_do: string | null
  thay_the_staff_id: string | null
  thay_the_ten: string | null
}
type UnitRow = { code: string; ten: string; ten_khmer: string | null; loai: string; to_nhom: string | null; sort_order: number }
type JobRow = { id: string; ten: string; ten_khmer: string | null; to_nhom: string; sort_order: number; an_diem_danh: boolean | null; day_chuyen: string | null; unit_code?: string | null; is_active?: boolean | null }
type StaffRow = {
  id: string
  ten: string
  to_vai_tro: string | null
  to_pham_vi: string | null
  ca_mac_dinh: string | null
  day_chuyen_mac_dinh: string | null
  active: boolean | null
  ngay_vao_lam: string | null
  ngay_nghi_viec: string | null
}

const fmtHm = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : ""

type ApprovalSection = { id: string; trang_thai: string; duyet_luc: string | null; duyet_boi: string | null }

/** Đủ duyệt = mọi phiếu ca (≥ 1) đã duyệt. Người duyệt = duyet_boi của phiếu ca duyệt muộn nhất. */
async function approvalOf(sections: ApprovalSection[]) {
  const approved = sections.length > 0 && sections.every((s) => s.trang_thai === "da_duyet" && s.duyet_luc)
  if (!approved) return { approved: false, approval: null, approvalKey: "" }
  const last = [...sections].sort((a, b) => (b.duyet_luc || "").localeCompare(a.duyet_luc || ""))[0]
  let ten = "—"
  if (last.duyet_boi) {
    const { data: p } = await getSupabaseAdmin().from("profiles").select("full_name, username").eq("id", last.duyet_boi).maybeSingle()
    ten = (p?.full_name || p?.username || "—") as string
  }
  const approvalKey = createHash("sha256")
    .update(sections.map((s) => `${s.id}:${s.duyet_luc}`).sort().join("|"))
    .digest("hex")
  return { approved: true, approval: { ten, luc: last.duyet_luc as string }, approvalKey }
}

async function sheetApproval(factoryId: string, sheetId: string) {
  const sb = getSupabaseAdmin()
  const { data: sheet, error } = await sb.from("attendance_daily_sheets").select("id, factory_id").eq("id", sheetId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!sheet || sheet.factory_id !== factoryId) throw new Error("Không tìm thấy phiếu điểm danh.")
  const { data, error: e2 } = await sb
    .from("attendance_sheet_sections")
    .select("id, loai, trang_thai, duyet_luc, duyet_boi")
    .eq("sheet_id", sheetId)
  if (e2) throw new Error(e2.message)
  return approvalOf(((data || []) as (ApprovalSection & { loai: string })[]).filter((s) => s.loai === "ca_san_xuat"))
}

// ── Bản cứng F01/F02 (mục 5, mirror product/confirm/report-snapshots.ts) ──
const SNAP_BUCKET = "attendance-sheet-reports"
const SNAP_TABLE = "attendance_sheet_snapshots"

export type SheetSnapshotInfo = { id: string; fileName: string; createdAt: string; duyetTen: string | null; duyetLuc: string | null }
export type SheetSnapshotState = { unavailable: boolean; approved: boolean; current: SheetSnapshotInfo | null }

function isMissingRelation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message || "")
}

async function currentSnapshot(sheetId: string, approvalKey: string) {
  const { data, error } = await getSupabaseAdmin()
    .from(SNAP_TABLE)
    .select("id, file_name, created_at, duyet_ten, duyet_luc, storage_path")
    .eq("sheet_id", sheetId)
    .eq("approval_key", approvalKey)
    .order("created_at", { ascending: false })
    .limit(1)
  if (error) {
    if (isMissingRelation(error)) return { missing: true as const, row: null }
    throw new Error(error.message)
  }
  return { missing: false as const, row: (data || [])[0] as { id: string; file_name: string; created_at: string; duyet_ten: string | null; duyet_luc: string | null; storage_path: string } | undefined }
}

/** Trạng thái bản cứng hiện hành của phiếu ngày. */
export async function loadSheetSnapshotState(accessToken: string | null, factoryId: string, sheetId: string): Promise<SheetSnapshotState> {
  await assertProductAccess(accessToken, factoryId, ATTENDANCE_REPORT_VIEW_PERMISSIONS, "xem phiếu điểm danh")
  const ap = await sheetApproval(factoryId, sheetId)
  if (!ap.approved) return { unavailable: false, approved: false, current: null }
  const { missing, row } = await currentSnapshot(sheetId, ap.approvalKey)
  if (missing) return { unavailable: true, approved: true, current: null }
  return {
    unavailable: false,
    approved: true,
    current: row ? { id: row.id, fileName: row.file_name, createdAt: row.created_at, duyetTen: row.duyet_ten, duyetLuc: row.duyet_luc } : null,
  }
}

async function assertCanCreateSnapshot(accessToken: string | null, factoryId: string, sheetId: string) {
  const userId = await assertProductAccess(accessToken, factoryId, ATTENDANCE_REPORT_VIEW_PERMISSIONS, "tạo bản cứng phiếu điểm danh")
  const ap = await sheetApproval(factoryId, sheetId)
  if (!ap.approved || !ap.approval) throw new Error("Phiếu chưa duyệt đủ các ca — chưa tạo bản cứng.")
  const { missing, row } = await currentSnapshot(sheetId, ap.approvalKey)
  if (missing) throw new Error("Chưa cấu hình lưu bản cứng (migration 20261207 chưa chạy).")
  if (row) throw new Error("Phiếu này đã có bản cứng.")
  return { userId, ap }
}

/** Bước 1: kiểm quyền + phát signed upload URL. */
export async function prepareSheetSnapshotUpload(accessToken: string | null, factoryId: string, sheetId: string): Promise<{ path: string; token: string }> {
  await assertCanCreateSnapshot(accessToken, factoryId, sheetId)
  const path = `${factoryId}/${sheetId}/${randomUUID()}.pdf`
  const { data, error } = await getSupabaseAdmin().storage.from(SNAP_BUCKET).createSignedUploadUrl(path)
  if (error || !data?.token) throw new Error(error?.message || "Không tạo được đường dẫn tải lên.")
  return { path, token: data.token }
}

/** Bước 2: tải lại object, tự tính sha256, ghi bản cứng. */
export async function finalizeSheetSnapshot(
  accessToken: string | null,
  factoryId: string,
  sheetId: string,
  path: string,
  fileName: string,
): Promise<SheetSnapshotInfo> {
  const { userId, ap } = await assertCanCreateSnapshot(accessToken, factoryId, sheetId)
  if (!path.startsWith(`${factoryId}/${sheetId}/`) || !path.endsWith(".pdf") || path.includes("..")) {
    throw new Error("Đường dẫn bản cứng không hợp lệ.")
  }
  const sb = getSupabaseAdmin()
  const { data: blob, error: dlErr } = await sb.storage.from(SNAP_BUCKET).download(path)
  if (dlErr || !blob) throw new Error(dlErr?.message || "Không đọc lại được file vừa tải lên.")
  const bytes = Buffer.from(await blob.arrayBuffer())
  if (bytes.length === 0 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("File tải lên không phải PDF.")
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const { data: row, error } = await sb
    .from(SNAP_TABLE)
    .insert({
      factory_id: factoryId,
      sheet_id: sheetId,
      approval_key: ap.approvalKey,
      storage_path: path,
      file_name: (fileName || "phieu-diem-danh.pdf").slice(0, 200),
      sha256,
      size_bytes: bytes.length,
      duyet_ten: ap.approval?.ten || null,
      duyet_luc: ap.approval?.luc || null,
      created_by: userId,
    })
    .select("id, file_name, created_at, duyet_ten, duyet_luc")
    .single()
  if (error || !row) throw new Error(error?.message || "Không ghi được bản cứng.")
  return { id: row.id, fileName: row.file_name, createdAt: row.created_at, duyetTen: row.duyet_ten, duyetLuc: row.duyet_luc }
}

/** Signed URL ngắn hạn (120 s) để mở/tải bản cứng. */
export async function getSheetSnapshotUrl(accessToken: string | null, factoryId: string, snapshotId: string, download = false): Promise<string> {
  await assertProductAccess(accessToken, factoryId, ATTENDANCE_REPORT_VIEW_PERMISSIONS, "xem bản cứng")
  const { data, error } = await getSupabaseAdmin().from(SNAP_TABLE).select("storage_path, file_name, factory_id").eq("id", snapshotId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || data.factory_id !== factoryId) throw new Error("Không tìm thấy bản cứng.")
  const url = await mintSignedUrlForPath(data.storage_path, { bucket: SNAP_BUCKET, downloadName: download ? data.file_name : undefined })
  if (!url) throw new Error("Không tạo được đường dẫn xem bản cứng.")
  return url
}

function jobIds(l: LineRow): string[] {
  if (l.cong_viec_ids && l.cong_viec_ids.length > 0) return l.cong_viec_ids
  return l.cong_viec_id ? [l.cong_viec_id] : []
}

export async function loadF01Model(accessToken: string | null, factoryId: string, sheetId: string): Promise<F01Model> {
  await assertProductAccess(accessToken, factoryId, ATTENDANCE_REPORT_VIEW_PERMISSIONS, "xem phiếu điểm danh")
  const sb = getSupabaseAdmin()

  const { data: sheet, error: shErr } = await sb
    .from("attendance_daily_sheets")
    .select("id, ngay, day_chuyen, ma_phieu, factory_id")
    .eq("id", sheetId)
    .maybeSingle()
  if (shErr) throw new Error(shErr.message)
  if (!sheet || sheet.factory_id !== factoryId) throw new Error("Không tìm thấy phiếu điểm danh.")
  const ngay = sheet.ngay as string
  const dayChuyen = sheet.day_chuyen as string

  const [secRes, lineRes, jobRes, staffRows, facRes, grade, unitRes] = await Promise.all([
    sb
      .from("attendance_sheet_sections")
      .select("id, loai, ca, ca_truong_ten, to_truong_staff_id, to_pho_staff_id, bat_dau_luc, ket_thuc_luc, trang_thai, duyet_luc, duyet_boi, vi_tri")
      .eq("sheet_id", sheetId),
    sb
      .from("attendance_sheet_lines")
      .select("id, section_id, stt, staff_id, cong_viec_id, cong_viec_ids, xep_loai, diem_danh, vang_loai, ly_do, thay_the_staff_id, thay_the_ten")
      .eq("sheet_id", sheetId)
      .order("stt"),
    sb.from("attendance_job_types").select("*").eq("factory_id", factoryId),
    fetchAllPaginated<StaffRow>((from, to) =>
      sb
        .from("maintenance_staff")
        .select("id, ten, to_vai_tro, to_pham_vi, ca_mac_dinh, day_chuyen_mac_dinh, active, ngay_vao_lam, ngay_nghi_viec")
        .eq("factory_id", factoryId)
        .order("ten")
        .order("id")
        .range(from, to),
    ),
    sb.from("factories").select("name, ten_khmer").eq("id", factoryId).maybeSingle(),
    loadGradeConfigServer(factoryId),
    sb.from("attendance_units").select("code, ten, ten_khmer, loai, to_nhom, sort_order").eq("factory_id", factoryId),
  ])
  for (const r of [secRes, lineRes, jobRes, facRes, unitRes]) if (r.error) throw new Error(r.error.message)

  const unitMap = new Map(((unitRes.data || []) as UnitRow[]).map((u) => [u.code, u]))
  const unitOrder = (code: string | null) => unitMap.get(code || "")?.sort_order ?? 9999
  const sections = ((secRes.data || []) as SectionRow[])
    .filter((s) => s.loai === "ca_san_xuat")
    .sort((a, b) => unitOrder(a.ca) - unitOrder(b.ca) || (a.ca || "").localeCompare(b.ca || ""))
  const lines = (lineRes.data || []) as LineRow[]
  const jobs = ((jobRes.data || []) as JobRow[]).sort((a, b) => a.sort_order - b.sort_order)
  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const staffById = new Map(staffRows.map((s) => [s.id, s]))
  const name = (id: string | null | undefined) => (id ? staffById.get(id)?.ten || "" : "")

  // ── Vị trí phụ trách (trưởng / phó của chính ca/tổ) ──
  const holderText = (slot: Slot | undefined): string => {
    if (!slot?.staff_id) return ""
    const n = name(slot.staff_id)
    return slot.goc_staff_id && slot.goc_staff_id !== slot.staff_id ? `${n} (thay ${name(slot.goc_staff_id)})` : n
  }
  const working = (s: StaffRow) =>
    s.active !== false && (!s.ngay_vao_lam || ngay >= s.ngay_vao_lam) && (!s.ngay_nghi_viec || ngay <= s.ngay_nghi_viec)
  /** Phiếu chưa lưu vị trí ⇒ người có vai trò trưởng/phó của ca/tổ trong hồ sơ; không có ⇒ trống. */
  const profileHolder = (unitCode: string | null, vaiTro: "to_truong" | "to_pho") =>
    staffRows.find(
      (s) =>
        s.to_vai_tro === vaiTro &&
        s.ca_mac_dinh === unitCode &&
        working(s) &&
        (!s.day_chuyen_mac_dinh || s.day_chuyen_mac_dinh === dayChuyen),
    )?.ten || ""

  // ── Dòng theo việc ──
  const personOf = (l: LineRow): { ten: string; xepLoai: string; thayCho?: string } | null => {
    if (l.diem_danh === "co") return { ten: name(l.staff_id), xepLoai: l.xep_loai || "A" }
    if (l.thay_the_staff_id) return { ten: name(l.thay_the_staff_id), xepLoai: "A", thayCho: name(l.staff_id) }
    if (l.thay_the_ten) return { ten: `${l.thay_the_ten} (tạm)`, xepLoai: "", thayCho: name(l.staff_id) }
    return null
  }
  /** Việc của Ca/Tổ (20261211): tổ ⇒ unit_code; ca ⇒ việc ca sản xuất của dây chuyền. Việc khác có người ⇒ thêm cuối. */
  const isJobOfUnit = (j: JobRow, unit: UnitRow | undefined) =>
    unit?.loai === "to" ? j.unit_code === unit.code : !j.unit_code && j.to_nhom === "ca_san_xuat" && j.day_chuyen === dayChuyen
  const buildRows = (unit: UnitRow | undefined, ls: LineRow[]): F01JobRow[] => {
    const base = jobs.filter((j) => isJobOfUnit(j, unit))
    const rows: F01JobRow[] = base.map((j) => ({ ten: j.ten, tenKm: j.ten_khmer, people: [] }))
    const rowByJob = new Map<string, F01JobRow>()
    base.forEach((j, i) => rowByJob.set(j.id, rows[i]))
    for (const l of ls) {
      const person = personOf(l)
      if (!person) continue
      for (const jid of jobIds(l)) {
        let row = rowByJob.get(jid)
        if (!row) {
          const j = jobById.get(jid)
          if (!j) continue
          row = { ten: j.ten, tenKm: j.ten_khmer, people: [] }
          rowByJob.set(jid, row)
          rows.push(row)
        }
        pushPerson(row, person)
      }
    }
    return rows
  }

  // ── Trực xuất hàng từ đơn xuất đã duyệt cùng ngày, CSR thuộc dây chuyền ──
  const { data: orders, error: ordErr } = await sb
    .from("export_orders")
    .select("chung_loai, trang_thai, nguoi_xuat_hang_ids")
    .eq("factory_id", factoryId)
    .eq("ngay", ngay)
  if (ordErr) throw new Error(ordErr.message)
  const exportStaff = new Set<string>()
  for (const o of (orders || []) as { chung_loai: string | null; trang_thai: string | null; nguoi_xuat_hang_ids: string[] | null }[]) {
    if (o.trang_thai && o.trang_thai !== "da_phe_duyet") continue
    if (!o.chung_loai || dayChuyenForCsr(o.chung_loai, grade) !== dayChuyen) continue
    for (const id of o.nguoi_xuat_hang_ids || []) exportStaff.add(id)
  }

  // ── Giao dịch thành phẩm trong ngày (chỉ thị, ngăn, sản xuất theo ca) ──
  type TxRow = { ca: string | null; so_banh: number | null; boc: string | null; chi_thi: string | null; ngan_id: string | null; lots: { loai_csr: string | null; loai_banh: number | null } | null }
  const txs = (await fetchAllPaginated<TxRow>((from, to) =>
    // lots!inner là quan hệ nhiều-1 ⇒ trả 1 object (kiểu sinh sẵn của supabase-js báo mảng).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb as any)
      .from("lot_transactions")
      .select("ca, so_banh, boc, chi_thi, ngan_id, lots!inner(factory_id, loai_csr, loai_banh)")
      .eq("lots.factory_id", factoryId)
      .eq("ngay_nhap", ngay)
      .order("id", { ascending: true })
      .range(from, to),
  )).filter((t) => t.lots?.loai_csr && dayChuyenForCsr(t.lots.loai_csr, grade) === dayChuyen)

  const chiThi = Array.from(new Set(txs.map((t) => (t.chi_thi || "").trim()).filter(Boolean))).join("; ")
  let ngan = ""
  const nganIds = Array.from(new Set(txs.map((t) => t.ngan_id).filter((x): x is string => !!x)))
  if (nganIds.length > 0) {
    const { data: ng, error: ngErr } = await sb.from("ngans").select("id, ten_ngan, ma_ngan").eq("factory_id", factoryId).in("id", nganIds.slice(0, 200))
    if (ngErr) throw new Error(ngErr.message)
    ngan = ((ng || []) as { ten_ngan: string | null; ma_ngan: string | null }[])
      .map((n) => n.ten_ngan || n.ma_ngan || "")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "vi", { numeric: true }))
      .join(", ")
  }
  const productionOf = (ca: string | null): F01Production[] => {
    const map = new Map<string, F01Production>()
    for (const t of txs) {
      if ((t.ca || "") !== (ca || "")) continue
      const csr = t.lots?.loai_csr || ""
      const loaiBanh = t.lots?.loai_banh ?? null
      const boc = (t.boc || "").trim()
      const key = `${csr}|${loaiBanh}|${boc}`
      const cur = map.get(key) || { csr, banh: 0, loaiBanh, boc }
      cur.banh += Number(t.so_banh || 0)
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => a.csr.localeCompare(b.csr) || a.boc.localeCompare(b.boc))
  }

  // ── Mỗi Ca/Tổ 1 mục ──
  const blocks: F01Block[] = sections.map((sec) => {
    const unit = unitMap.get(sec.ca || "")
    const loai: "ca" | "to" = unit?.loai === "to" ? "to" : "ca"
    const ls = lines.filter((l) => l.section_id === sec.id)
    const vt = sec.vi_tri || {}
    const stored = Object.keys(vt).length > 0
    return {
      code: sec.ca || "",
      ten: unit?.ten || `Ca ${sec.ca || ""}`,
      tenKm: unit?.ten_khmer || null,
      loai,
      truong: stored ? holderText(vt.truong) : profileHolder(sec.ca, "to_truong"),
      pho: stored ? holderText(vt.pho) : profileHolder(sec.ca, "to_pho"),
      coViTri: true,
      gioBatDau: fmtHm(sec.bat_dau_luc),
      gioKetThuc: fmtHm(sec.ket_thuc_luc),
      sanXuat: loai === "ca" ? productionOf(sec.ca) : [],
      rows: buildRows(unit, ls).filter((r) => r.people.length > 0),
    }
  })

  // Trực xuất hàng: vào mục tổ cơ điện đầu tiên; không có ⇒ 1 mục riêng.
  const xhJob =
    jobs.find((j) => j.an_diem_danh && j.is_active !== false && (!j.day_chuyen || j.day_chuyen === dayChuyen)) ||
    jobs.find((j) => j.an_diem_danh && (!j.day_chuyen || j.day_chuyen === dayChuyen))
  if (xhJob && exportStaff.size > 0) {
    let target =
      (xhJob.unit_code ? blocks.find((b) => b.code === xhJob.unit_code) : undefined) ||
      blocks.find((b) => unitMap.get(b.code)?.to_nhom === "co_dien")
    if (!target) {
      target = { code: "_XH", ten: xhJob.ten, tenKm: xhJob.ten_khmer, loai: "to", truong: "", pho: "", coViTri: false, gioBatDau: "", gioKetThuc: "", sanXuat: [], rows: [] }
      blocks.push(target)
    }
    let row = target.rows.find((r) => r.ten === xhJob.ten)
    if (!row) {
      row = { ten: xhJob.ten, tenKm: xhJob.ten_khmer, people: [] }
      target.rows.push(row)
    }
    for (const id of exportStaff) pushPerson(row, { ten: name(id), xepLoai: "" })
  }

  // ── Duyệt ──
  const { approved, approval, approvalKey } = await approvalOf(sections)

  return {
    form: f01FormOf(dayChuyen),
    sheetId,
    maPhieu: sheet.ma_phieu as string,
    ngay,
    dayChuyen,
    factoryName: (facRes.data?.name as string) || "",
    factoryKhmer: (facRes.data?.ten_khmer as string | null) || null,
    chiThi,
    ngan,
    blocks,
    approved,
    approval,
    approvalKey,
  }
}
