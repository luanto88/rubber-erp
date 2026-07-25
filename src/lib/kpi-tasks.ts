"use client"

// Module "Quản lý công việc & Đánh giá KPI nhân viên" — Phase 1a (giao việc, A + B).
// Xem đầy đủ kiến trúc/roadmap tại .claude/rules/27-kpi-module.md.
//
// Người "phụ trách" 1 công việc được chọn từ `maintenance_staff` (không phải `profiles`
// trực tiếp) vì RLS của `profiles` chỉ cho admin đọc toàn bộ hồ sơ trong nhà máy, trong khi
// `maintenance_staff`/`personnel_groups`/`personnel_group_members` không bị RLS hạn chế và
// đã là "danh bạ nhân sự" chuẩn dùng xuyên suốt module Bảo trì/KPI (staff.profile_id là
// UUID auth.users thật, khớp `kpi_task_members.user_id`/`auth.uid()`).

import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"

export const KPI_DUE_SOON_HOURS = 24

export type KpiTaskStatus = "moi_giao" | "dang_thuc_hien" | "cho_nghiem_thu" | "hoan_thanh" | "tra_ve" | "huy"
export type KpiReportRequirement = "anh" | "file" | "dinh_vi" | "van_ban"
export type KpiTaskLogAction =
  | "cap_nhat_tien_do"
  | "nop"
  | "nghiem_thu"
  | "dieu_chinh"
  | "tra_ve"
  | "yeu_cau_bo_sung"
  | "gan_ban_ghi"

export const KPI_STATUS_LABEL: Record<KpiTaskStatus, string> = {
  moi_giao: "Mới giao",
  dang_thuc_hien: "Đang thực hiện",
  cho_nghiem_thu: "Chờ nghiệm thu",
  hoan_thanh: "Hoàn thành",
  tra_ve: "Trả về",
  huy: "Đã hủy",
}

export const KPI_STATUS_BADGE_CLASS: Record<KpiTaskStatus, string> = {
  moi_giao: "bg-sky-100 text-sky-700",
  dang_thuc_hien: "bg-amber-100 text-amber-700",
  cho_nghiem_thu: "bg-violet-100 text-violet-700",
  hoan_thanh: "bg-emerald-100 text-emerald-700",
  tra_ve: "bg-rose-100 text-rose-700",
  huy: "bg-slate-200 text-slate-500",
}

export const KPI_REPORT_REQ_LABEL: Record<KpiReportRequirement, string> = {
  anh: "Ảnh",
  file: "File",
  dinh_vi: "Định vị",
  van_ban: "Văn bản",
}

export const KPI_ACTION_LABEL: Record<KpiTaskLogAction, string> = {
  cap_nhat_tien_do: "Cập nhật tiến độ",
  nop: "Nộp",
  nghiem_thu: "Nghiệm thu",
  dieu_chinh: "Điều chỉnh",
  tra_ve: "Trả về",
  yeu_cau_bo_sung: "Yêu cầu bổ sung",
  gan_ban_ghi: "Gắn bằng chứng",
}

// Supabase JS (PostgREST/Storage/RPC) ném lỗi dạng plain object { message, code... }, không
// phải instance Error — dùng ở mọi catch block để luôn thấy đúng lý do thật (mirror
// getErrorMessage của operation-notes.ts).
export function getKpiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg) return msg
  }
  return fallback
}

export type KpiTask = {
  id: string
  factory_id: string
  ma_cong_viec: string | null
  tieu_de: string
  mo_ta: string | null
  nguoi_giao_id: string
  ngay_giao: string
  han_hoan_thanh: string
  yeu_cau_bao_cao: KpiReportRequirement[]
  da_chuyen_giao: boolean
  trang_thai: KpiTaskStatus
  created_at: string
  updated_at: string
}

export type KpiTaskMember = {
  id: string
  task_id: string
  factory_id: string
  user_id: string
  tien_do: number
  tien_do_nghiem_thu: number | null
  da_nop_luc: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type KpiTaskLog = {
  id: string
  task_id: string
  factory_id: string
  member_user_id: string
  nguoi_thuc_hien_id: string
  hanh_dong: KpiTaskLogAction
  tien_do_truoc: number | null
  tien_do_sau: number | null
  noi_dung: string | null
  image_urls: string[]
  file_urls: string[]
  vi_do: number | null
  kinh_do: number | null
  dia_diem_text: string | null
  created_at: string
}

const TASK_COLS =
  "id, factory_id, ma_cong_viec, tieu_de, mo_ta, nguoi_giao_id, ngay_giao, han_hoan_thanh, yeu_cau_bao_cao, da_chuyen_giao, trang_thai, created_at, updated_at"
const MEMBER_COLS =
  "id, task_id, factory_id, user_id, tien_do, tien_do_nghiem_thu, da_nop_luc, is_active, created_at, updated_at"
const LOG_COLS =
  "id, task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong, tien_do_truoc, tien_do_sau, noi_dung, image_urls, file_urls, vi_do, kinh_do, dia_diem_text, created_at"

export function isTaskOpen(status: KpiTaskStatus): boolean {
  return status !== "hoan_thanh" && status !== "huy"
}

export function isTaskOverdue(task: Pick<KpiTask, "han_hoan_thanh" | "trang_thai">, nowMs = Date.now()): boolean {
  if (!isTaskOpen(task.trang_thai)) return false
  const due = new Date(task.han_hoan_thanh).getTime()
  return !Number.isNaN(due) && due < nowMs
}

export function isTaskDueSoon(task: Pick<KpiTask, "han_hoan_thanh" | "trang_thai">, nowMs = Date.now()): boolean {
  if (!isTaskOpen(task.trang_thai)) return false
  const due = new Date(task.han_hoan_thanh).getTime()
  if (Number.isNaN(due)) return false
  return due >= nowMs && due <= nowMs + KPI_DUE_SOON_HOURS * 3600_000
}

// ── Ứng viên giao việc: người (maintenance_staff có profile liên kết) + nhóm ────────────
export type KpiTaskCandidate = { userId: string; ten: string; groupIds: string[] }
export type KpiTaskCandidateGroup = { id: string; name: string; memberUserIds: string[] }

type StaffRow = { id: string; ten: string; profile_id: string | null; active: boolean | null }
type GroupRow = { id: string; name: string; is_active: boolean | null }
type MemberRow = { staff_id: string; group_id: string }

export async function loadKpiTaskCandidates(
  factoryId: string,
): Promise<{ people: KpiTaskCandidate[]; groups: KpiTaskCandidateGroup[] }> {
  const [staffRes, groupRes, memberRes] = await Promise.all([
    supabase.from("maintenance_staff").select("id, ten, profile_id, active").eq("factory_id", factoryId),
    supabase.from("personnel_groups").select("id, name, is_active").eq("factory_id", factoryId).order("sort_order").order("name"),
    supabase.from("personnel_group_members").select("staff_id, group_id").eq("factory_id", factoryId),
  ])
  if (staffRes.error) throw staffRes.error
  if (groupRes.error) throw groupRes.error
  if (memberRes.error) throw memberRes.error

  const staffRows = ((staffRes.data || []) as StaffRow[]).filter((s) => s.active !== false && s.profile_id)
  const staffById = new Map(staffRows.map((s) => [s.id, s]))
  const memberRows = (memberRes.data || []) as MemberRow[]

  const groupIdsByStaff = new Map<string, string[]>()
  const staffIdsByGroup = new Map<string, string[]>()
  for (const m of memberRows) {
    if (!staffById.has(m.staff_id)) continue
    groupIdsByStaff.set(m.staff_id, [...(groupIdsByStaff.get(m.staff_id) || []), m.group_id])
    staffIdsByGroup.set(m.group_id, [...(staffIdsByGroup.get(m.group_id) || []), m.staff_id])
  }

  const people: KpiTaskCandidate[] = staffRows
    .map((s) => ({ userId: s.profile_id as string, ten: s.ten, groupIds: groupIdsByStaff.get(s.id) || [] }))
    .sort((a, b) => a.ten.localeCompare(b.ten, "vi"))

  const groups: KpiTaskCandidateGroup[] = ((groupRes.data || []) as GroupRow[])
    .filter((g) => g.is_active !== false)
    .map((g) => {
      const staffIds = staffIdsByGroup.get(g.id) || []
      const memberUserIds = staffIds.map((sid) => staffById.get(sid)?.profile_id).filter((v): v is string => !!v)
      return { id: g.id, name: g.name, memberUserIds }
    })
    .filter((g) => g.memberUserIds.length > 0)

  return { people, groups }
}

// ── Mã công việc: CV-ddmmyy/XXX, đếm tuần tự theo ngày trong phạm vi nhà máy ────────────
function pad2(n: number) {
  return String(n).padStart(2, "0")
}

export async function generateKpiTaskCode(factoryId: string, ngayGiao: string): Promise<string> {
  const d = new Date(`${ngayGiao}T00:00:00`)
  const prefix = `CV-${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}`
  const { count } = await supabase
    .from("kpi_tasks")
    .select("id", { count: "exact", head: true })
    .eq("factory_id", factoryId)
    .like("ma_cong_viec", `${prefix}/%`)
  const seq = (count || 0) + 1
  return `${prefix}/${String(seq).padStart(3, "0")}`
}

// ── CRUD danh sách/chi tiết ──────────────────────────────────────────────────
export type KpiTaskFilters = {
  from?: string
  to?: string
  status?: KpiTaskStatus[]
}

// Phân trang — PostgREST mặc định cắt 1000 dòng/query (xem .claude/rules/04-code-patterns.md).
// kpi_tasks tích lũy liên tục theo thời gian nên không đảm bảo luôn dưới 1000 dòng/nhà máy.
export async function fetchKpiTasks(factoryId: string, filters: KpiTaskFilters = {}): Promise<KpiTask[]> {
  const PAGE_SIZE = 1000
  let all: KpiTask[] = []
  let from = 0
  for (;;) {
    let q = supabase
      .from("kpi_tasks")
      .select(TASK_COLS)
      .eq("factory_id", factoryId)
      .order("han_hoan_thanh", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (filters.from) q = q.gte("han_hoan_thanh", filters.from)
    if (filters.to) q = q.lte("han_hoan_thanh", filters.to)
    if (filters.status?.length) q = q.in("trang_thai", filters.status)
    const { data, error } = await q
    if (error) throw error
    all = all.concat((data || []) as KpiTask[])
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

export async function fetchKpiTaskMembersByTaskIds(taskIds: string[]): Promise<KpiTaskMember[]> {
  if (!taskIds.length) return []
  const { data, error } = await supabase.from("kpi_task_members").select(MEMBER_COLS).in("task_id", taskIds)
  if (error) throw error
  return (data || []) as KpiTaskMember[]
}

export async function fetchMyActiveTaskIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("kpi_task_members").select("task_id").eq("user_id", userId).eq("is_active", true)
  if (error) throw error
  return new Set((data || []).map((r: { task_id: string }) => r.task_id))
}

export async function fetchKpiTaskDetail(
  taskId: string,
): Promise<{ task: KpiTask; members: KpiTaskMember[]; logs: KpiTaskLog[] }> {
  const [taskRes, membersRes, logsRes] = await Promise.all([
    supabase.from("kpi_tasks").select(TASK_COLS).eq("id", taskId).single(),
    supabase.from("kpi_task_members").select(MEMBER_COLS).eq("task_id", taskId).order("created_at"),
    supabase.from("kpi_task_logs").select(LOG_COLS).eq("task_id", taskId).order("created_at", { ascending: false }),
  ])
  if (taskRes.error) throw taskRes.error
  if (membersRes.error) throw membersRes.error
  if (logsRes.error) throw logsRes.error
  return {
    task: taskRes.data as KpiTask,
    members: (membersRes.data || []) as KpiTaskMember[],
    logs: (logsRes.data || []) as KpiTaskLog[],
  }
}

export async function createKpiTask(input: {
  factoryId: string
  nguoiGiaoId: string
  tieuDe: string
  moTa: string
  ngayGiao: string
  hanHoanThanh: string
  yeuCauBaoCao: KpiReportRequirement[]
  memberUserIds: string[]
}): Promise<KpiTask> {
  if (!input.memberUserIds.length) throw new Error("Vui lòng chọn ít nhất 1 người thực hiện.")
  const maCongViec = await generateKpiTaskCode(input.factoryId, input.ngayGiao)

  const { data: taskRow, error: taskErr } = await supabase
    .from("kpi_tasks")
    .insert({
      factory_id: input.factoryId,
      ma_cong_viec: maCongViec,
      tieu_de: input.tieuDe.trim(),
      mo_ta: input.moTa.trim() || null,
      nguoi_giao_id: input.nguoiGiaoId,
      ngay_giao: input.ngayGiao,
      han_hoan_thanh: input.hanHoanThanh,
      yeu_cau_bao_cao: input.yeuCauBaoCao,
    })
    .select(TASK_COLS)
    .single()
  if (taskErr) throw taskErr
  const task = taskRow as KpiTask

  const memberRows = [...new Set(input.memberUserIds)].map((uid) => ({
    task_id: task.id,
    factory_id: input.factoryId,
    user_id: uid,
  }))
  const { error: memberErr } = await supabase.from("kpi_task_members").insert(memberRows)
  if (memberErr) throw memberErr

  return task
}

export async function cancelKpiTask(taskId: string): Promise<void> {
  const { error } = await supabase.from("kpi_tasks").update({ trang_thai: "huy" }).eq("id", taskId)
  if (error) throw error
}

// ── Flow xử lý (2 RPC atomic — xem migration 20260724_kpi_tasks_phase1a.sql) ────────────
export async function submitKpiTaskProgress(input: {
  taskId: string
  hanhDong: "cap_nhat_tien_do" | "nop"
  tienDo: number
  noiDung: string
  imageUrls?: string[]
  fileUrls?: string[]
  viDo?: number | null
  kinhDo?: number | null
  diaDiemText?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc("kpi_task_member_update", {
    p_task_id: input.taskId,
    p_hanh_dong: input.hanhDong,
    p_tien_do: input.tienDo,
    p_noi_dung: input.noiDung.trim() || null,
    p_image_urls: input.imageUrls || [],
    p_file_urls: input.fileUrls || [],
    p_vi_do: input.viDo ?? null,
    p_kinh_do: input.kinhDo ?? null,
    p_dia_diem_text: input.diaDiemText || null,
  })
  if (error) throw error
}

export async function evaluateKpiTask(input: {
  taskId: string
  memberUserId: string
  hanhDong: "nghiem_thu" | "dieu_chinh" | "tra_ve" | "yeu_cau_bo_sung"
  tienDo?: number | null
  noiDung?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc("kpi_task_evaluate", {
    p_task_id: input.taskId,
    p_member_user_id: input.memberUserId,
    p_hanh_dong: input.hanhDong,
    p_tien_do: input.tienDo ?? null,
    p_noi_dung: input.noiDung?.trim() || null,
  })
  if (error) throw error
}

// ── "Gắn bản ghi tại chỗ" (in-context evidence linking) ─────────────────────────────────
// Thay thế hoàn toàn ý tưởng "auto-complete ngầm" (code tự dò hành động) — thay vào đó,
// sau khi lưu 1 bản ghi nghiệp vụ, UI hỏi người dùng có muốn gắn bản ghi đó vào 1 công việc
// KPI đang mở của chính họ hôm nay không, người dùng tự xác nhận bằng 1 cú click. Xem
// migration `20260725_kpi_task_evidence_links.sql` và `.claude/rules/27-kpi-module.md`.

export type KpiTaskEvidenceLink = {
  id: string
  factory_id: string
  task_id: string
  member_user_id: string
  module_code: string
  record_id: string
  record_label: string
  record_url: string | null
  created_at: string
}

const EVIDENCE_LINK_COLS =
  "id, factory_id, task_id, member_user_id, module_code, record_id, record_label, record_url, created_at"

/** Đọc `id` (auth.uid) của user đang đăng nhập từ cache session — dùng ở các module KHÔNG
 *  giữ sẵn `user.id` trong state (Điều xe/Kho nguyên liệu/Kiểm nghiệm hiện chỉ cache role/tên
 *  qua `localStorage.erp_user`, không phải toàn bộ `SessionUser`). */
export function getKpiCachedUserId(): string | null {
  try {
    const cached = JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
    return cached?.id || null
  } catch {
    return null
  }
}

/** Công việc KPI ĐANG MỞ của 1 người — dùng cho gợi ý gắn bằng chứng ngay sau khi lưu 1 bản
 *  ghi nghiệp vụ. Sắp xếp theo hạn gần nhất trước để việc "cần làm gấp" luôn nổi lên đầu
 *  dropdown, nhưng KHÔNG lọc theo `ngay_giao = hôm nay` — `ngay_giao` là ngày TẠO/giao việc,
 *  không phải ngày làm việc đó (vd người giao chuẩn bị sẵn task cho ngày mai, hoặc task còn
 *  tồn đọng từ hôm trước). Lọc theo `ngay_giao` từng gây bug thật: task giao hôm qua nhưng hạn
 *  hôm nay bị loại khỏi dropdown dù đang mở, trong khi 1 task khác giao đúng hôm nay nhưng hạn
 *  tận vài ngày sau lại xuất hiện — ngược hoàn toàn với kỳ vọng "việc tôi cần làm bây giờ".
 *  Chưa JOIN `kpi_task_templates` (bảng "Việc định kỳ" chưa tồn tại) — khi bảng đó ra đời, nối
 *  thêm để gợi ý sẵn việc khớp `auto_action_type`. */
export async function fetchOpenKpiTasksForUser(factoryId: string, userId: string): Promise<KpiTask[]> {
  const { data: memberRows, error: memberErr } = await supabase
    .from("kpi_task_members")
    .select("task_id")
    .eq("user_id", userId)
    .eq("is_active", true)
  if (memberErr) throw memberErr
  const taskIds = [...new Set((memberRows || []).map((r: { task_id: string }) => r.task_id))]
  if (!taskIds.length) return []

  const { data, error } = await supabase
    .from("kpi_tasks")
    .select(TASK_COLS)
    .eq("factory_id", factoryId)
    .in("id", taskIds)
    .not("trang_thai", "in", "(hoan_thanh,huy)")
    .order("han_hoan_thanh", { ascending: true })
  if (error) throw error
  return (data || []) as KpiTask[]
}

export async function linkKpiTaskEvidenceAndComplete(input: {
  taskId: string
  moduleCode: string
  recordId: string
  recordLabel: string
  recordUrl?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc("kpi_task_link_and_complete", {
    p_task_id: input.taskId,
    p_module_code: input.moduleCode,
    p_record_id: input.recordId,
    p_record_label: input.recordLabel,
    p_record_url: input.recordUrl || null,
  })
  if (error) throw error
}

export async function fetchKpiTaskEvidenceLinks(taskId: string): Promise<KpiTaskEvidenceLink[]> {
  const { data, error } = await supabase
    .from("kpi_task_evidence_links")
    .select(EVIDENCE_LINK_COLS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data || []) as KpiTaskEvidenceLink[]
}

// ── Upload bằng chứng (ảnh/file), bucket dùng chung order-files ────────────────────────
export async function uploadKpiEvidenceImage(factoryId: string, taskId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg"
  const path = `${factoryId}/kpi/tasks/${taskId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from("order-files").upload(path, file, { upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from("order-files").getPublicUrl(path)
  return data.publicUrl
}

export async function uploadKpiEvidenceFile(factoryId: string, taskId: string, file: File): Promise<{ url: string; name: string }> {
  const ext = file.name.split(".").pop() || "dat"
  const path = `${factoryId}/kpi/tasks/${taskId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from("order-files").upload(path, file, { upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from("order-files").getPublicUrl(path)
  return { url: data.publicUrl, name: file.name }
}

// ── Helper hiển thị ──────────────────────────────────────────────────────────
export function formatKpiDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function toDatetimeLocalValue(value: string | null | undefined): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Tiến độ đại diện của 1 task để hiển thị badge % trong danh sách — trung bình các thành
 *  viên ĐANG hoạt động (ưu tiên điểm nghiệm thu nếu đã có, không thì dùng tự báo cáo). */
export function averageTaskProgress(members: KpiTaskMember[]): number {
  const active = members.filter((m) => m.is_active)
  if (!active.length) return 0
  const sum = active.reduce((s, m) => s + (m.tien_do_nghiem_thu ?? m.tien_do), 0)
  return Math.round(sum / active.length)
}
