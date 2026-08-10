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

// Module ERP liên quan 1 công việc/1 việc định kỳ — quyết định KpiLinkPrompt ("Gắn bản ghi tại
// chỗ") có gợi ý việc này hay không khi người dùng lưu 1 bản ghi ở đúng module đó. 9 giá trị
// khớp 9+ nơi đang có <KpiLinkPrompt moduleCode="...:..."> (2026-08-17: mở rộng thêm maintenance/
// export/inventory, xem migration 20260817_kpi_task_module_code_extend.sql) — KHÔNG lưu chuỗi
// đầy đủ "process:measurement", chỉ lưu phần "họ module" trước dấu ":" (xem kpi-link-prompt.tsx).
export const KPI_MODULE_OPTIONS = [
  { code: "dispatch", label: "Điều xe" },
  { code: "output", label: "Sản lượng" },
  { code: "quality", label: "Kiểm nghiệm" },
  { code: "storage", label: "Kho nguyên liệu" },
  { code: "product", label: "Thành phẩm" },
  { code: "process", label: "Kiểm soát quá trình (Đo nhanh)" },
  { code: "maintenance", label: "Bảo trì" },
  { code: "export", label: "Xuất hàng" },
  { code: "inventory", label: "Kho vật tư" },
] as const
export type KpiModuleCode = (typeof KPI_MODULE_OPTIONS)[number]["code"]
export const KPI_MODULE_LABEL: Record<string, string> = Object.fromEntries(
  KPI_MODULE_OPTIONS.map((m) => [m.code, m.label]),
)

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
  | "chuyen_giao"
  | "gia_han"

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
  chuyen_giao: "Chuyển giao",
  gia_han: "Gia hạn",
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
  // Việc mục tiêu số lượng chung (vd "đo 4 mẫu") — NULL = việc đơn, 1 bằng chứng là xong (hành
  // vi gốc). Có giá trị = việc chỉ Hoàn thành khi tổng bằng chứng >= giá trị này, xem
  // kpi_task_members.phan_loai + migration 20260725_kpi_task_quantity_target.sql.
  muc_tieu_so_luong: number | null
  // Phòng ban chịu trách nhiệm — quyết định ai (lãnh đạo phòng ban đó, ngoài admin/nguoi_giao)
  // được coi là đủ thẩm quyền tạo/quản lý việc này (xem RLS kpi_tasks_insert, migration
  // 20260807_kpi_department_scoping.sql). NULL = dữ liệu cũ trước migration này.
  phong_ban_id: string | null
  // Module ERP liên quan (xem KPI_MODULE_OPTIONS) — quyết định KpiLinkPrompt có gợi ý việc này
  // hay không. NULL = việc không liên quan module nào, không bao giờ được gợi ý gắn bằng chứng.
  module_code: string | null
  // Việc đột xuất 5S (tuỳ chọn) — liên kết tới 1 kpi_5s_locations cụ thể. HOÀN TOÀN TÁCH BIỆT
  // với chấm điểm 5S định kỳ (kpi_5s_evaluations) — chỉ để hiển thị link/badge "Vị trí 5S liên
  // quan" ở trang chi tiết việc, không ảnh hưởng công thức tính điểm C (5S) hàng tháng.
  kpi_5s_location_id: string | null
  // Ảnh hiện trạng ("before") do người GIAO việc đính kèm lúc tạo — khác kpi_task_logs.image_urls
  // (ảnh bằng chứng "after" do người THỰC HIỆN nộp sau khi xử lý xong).
  before_image_urls: string[] | null
  created_at: string
  updated_at: string
}

export type KpiPhanLoai = "chinh" | "choang"

export type KpiTaskMember = {
  id: string
  task_id: string
  factory_id: string
  user_id: string
  tien_do: number
  tien_do_nghiem_thu: number | null
  da_nop_luc: string | null
  is_active: boolean
  // Chỉ có ý nghĩa khi kpi_tasks.muc_tieu_so_luong khác NULL — đúng 1 thành viên 'chinh' (có
  // ngưỡng riêng, bị phạt nếu không đạt), còn lại 'choang' (không ngưỡng, luôn 100% khi việc
  // chung xong). NULL với việc đơn hoặc dữ liệu tạo trước migration này.
  phan_loai: KpiPhanLoai | null
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
  "id, factory_id, ma_cong_viec, tieu_de, mo_ta, nguoi_giao_id, ngay_giao, han_hoan_thanh, yeu_cau_bao_cao, da_chuyen_giao, trang_thai, muc_tieu_so_luong, phong_ban_id, module_code, kpi_5s_location_id, before_image_urls, created_at, updated_at"
const MEMBER_COLS =
  "id, task_id, factory_id, user_id, tien_do, tien_do_nghiem_thu, da_nop_luc, is_active, phan_loai, created_at, updated_at"
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

// Số ngày đã quá hạn — dùng cho badge "Quá hạn N ngày" trên card công việc. Sau fix bug "việc
// định kỳ mắc kẹt" (kpi_ensure_today_task_instances không còn sinh task trùng mỗi ngày khi task
// cũ chưa đóng), 1 task có thể tồn tại quá hạn nhiều ngày liên tục — cần hiển thị rõ mức độ trễ
// để không mất tính minh bạch. Trả về null nếu task không (còn) quá hạn.
export function daysOverdue(task: Pick<KpiTask, "han_hoan_thanh" | "trang_thai">, nowMs = Date.now()): number | null {
  if (!isTaskOverdue(task, nowMs)) return null
  const due = new Date(task.han_hoan_thanh).getTime()
  return Math.floor((nowMs - due) / 86_400_000)
}

// ── "Highlight" — bấm 1 mục trong Bell/trang chủ KPI phải lọc ĐÚNG danh sách mục đó, không rơi
// về "Việc của tôi" chung chung (bug thật đã báo 2026-08-19). Predicate ở đây PHẢI khớp chính
// xác công thức đếm trong getKpiTasks() (module-tasks.ts) — dùng CHUNG 1 nguồn để badge Bell/
// trang chủ và bộ lọc trên trang /dashboard/kpi/tasks không bao giờ lệch nhau.
export type KpiTaskHighlight =
  | "pendingMine"
  | "dueSoonMine"
  | "overdueMine"
  | "transferMine"
  | "approval"
  | "dueSoonGiven"
  | "overdueGiven"

export const KPI_TASK_HIGHLIGHT_LABEL: Record<KpiTaskHighlight, string> = {
  pendingMine: "Việc cần cập nhật/nộp",
  dueSoonMine: "Việc của bạn sắp đến hạn (24h)",
  overdueMine: "Việc của bạn đã quá hạn",
  transferMine: "Lời mời chuyển giao chờ phản hồi",
  approval: "Việc chờ nghiệm thu",
  dueSoonGiven: "Việc bạn giao sắp đến hạn (24h)",
  overdueGiven: "Việc bạn giao đã quá hạn",
}

export function matchesKpiTaskHighlight(
  task: KpiTask,
  highlight: KpiTaskHighlight,
  ctx: { isAdmin: boolean; isMember: boolean; isGiver: boolean; isPendingIncomingTransfer: boolean },
): boolean {
  switch (highlight) {
    case "pendingMine":
      return ctx.isMember && (task.trang_thai === "moi_giao" || task.trang_thai === "dang_thuc_hien" || task.trang_thai === "tra_ve")
    case "dueSoonMine":
      return ctx.isMember && isTaskDueSoon(task)
    case "overdueMine":
      return ctx.isMember && isTaskOverdue(task)
    case "transferMine":
      return ctx.isPendingIncomingTransfer
    case "approval":
      return task.trang_thai === "cho_nghiem_thu" && (ctx.isGiver || ctx.isAdmin)
    case "dueSoonGiven":
      return ctx.isGiver && isTaskDueSoon(task)
    case "overdueGiven":
      return ctx.isGiver && isTaskOverdue(task)
    default:
      return false
  }
}

// Export dùng chung — filter theo Phòng ban cho cả candidate list kiểu maintenance_staff
// (loadKpiTaskCandidates) lẫn danh sách profile thô (vd form Vị trí 5S, kpi-5s-locations-tab.tsx).
export async function fetchDepartmentUserIds(factoryId: string, departmentId: string): Promise<Set<string>> {
  try {
    const res = await fetch(`/api/kpi/dept-users?factoryId=${factoryId}&departmentId=${departmentId}`)
    if (!res.ok) return new Set()
    const json = (await res.json()) as { userIds?: string[] }
    return new Set(json.userIds || [])
  } catch {
    return new Set()
  }
}

// ── Ứng viên giao việc: người (maintenance_staff có profile liên kết) + nhóm ────────────
export type KpiTaskCandidate = { userId: string; ten: string; groupIds: string[]; primaryGroupId: string | null }
export type KpiTaskCandidateGroup = { id: string; name: string; memberUserIds: string[] }

type StaffRow = { id: string; ten: string; profile_id: string | null; active: boolean | null }
type GroupRow = { id: string; name: string; is_active: boolean | null }
type MemberRow = { staff_id: string; group_id: string; is_primary: boolean | null }

// `departmentId`: nếu truyền, chỉ giữ lại candidate thuộc đúng phòng ban đó — tra qua
// /api/kpi/dept-users (service role, bắt buộc vì RLS `profiles` chỉ cho đọc own row hoặc admin,
// client thường không tự lọc được nhiều profile cùng lúc). Lỗi tra cứu phòng ban bị nuốt êm
// (trả về danh sách rỗng) — không chặn hẳn form nếu route lỗi tạm thời, chỉ đơn giản không lọc
// ra candidate nào cho tới khi thử lại. `groups` (personnel_groups) KHÔNG lọc theo phòng ban —
// đây là 2 trục độc lập, "Thêm nhanh theo nhóm" vẫn hoạt động như cũ bất kể phòng ban đã chọn.
export async function loadKpiTaskCandidates(
  factoryId: string,
  opts?: { departmentId?: string },
): Promise<{ people: KpiTaskCandidate[]; groups: KpiTaskCandidateGroup[] }> {
  const [staffRes, groupRes, memberRes, deptUserIds] = await Promise.all([
    supabase.from("maintenance_staff").select("id, ten, profile_id, active").eq("factory_id", factoryId),
    supabase.from("personnel_groups").select("id, name, is_active").eq("factory_id", factoryId).order("sort_order").order("name"),
    supabase.from("personnel_group_members").select("staff_id, group_id, is_primary").eq("factory_id", factoryId),
    opts?.departmentId ? fetchDepartmentUserIds(factoryId, opts.departmentId) : Promise.resolve(null),
  ])
  if (staffRes.error) throw staffRes.error
  if (groupRes.error) throw groupRes.error
  if (memberRes.error) throw memberRes.error

  const staffRows = ((staffRes.data || []) as StaffRow[]).filter((s) => s.active !== false && s.profile_id)
  const staffById = new Map(staffRows.map((s) => [s.id, s]))
  const memberRows = (memberRes.data || []) as MemberRow[]

  const groupIdsByStaff = new Map<string, string[]>()
  const primaryGroupByStaff = new Map<string, string>()
  const staffIdsByGroup = new Map<string, string[]>()
  for (const m of memberRows) {
    if (!staffById.has(m.staff_id)) continue
    groupIdsByStaff.set(m.staff_id, [...(groupIdsByStaff.get(m.staff_id) || []), m.group_id])
    staffIdsByGroup.set(m.group_id, [...(staffIdsByGroup.get(m.group_id) || []), m.staff_id])
    if (m.is_primary) primaryGroupByStaff.set(m.staff_id, m.group_id)
  }

  const people: KpiTaskCandidate[] = staffRows
    .filter((s) => !deptUserIds || deptUserIds.has(s.profile_id as string))
    .map((s) => ({
      userId: s.profile_id as string,
      ten: s.ten,
      groupIds: groupIdsByStaff.get(s.id) || [],
      primaryGroupId: primaryGroupByStaff.get(s.id) || null,
    }))
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
  // Việc mục tiêu số lượng chung (tuỳ chọn) — xem KpiTask.muc_tieu_so_luong. Khi có giá trị,
  // nguoiChinhId BẮT BUỘC và phải nằm trong memberUserIds — người đó nhận phan_loai='chinh',
  // các thành viên còn lại 'choang'.
  mucTieuSoLuong?: number | null
  nguoiChinhId?: string | null
  phongBanId: string | null
  // Module ERP liên quan (xem KPI_MODULE_OPTIONS) — tuỳ chọn, NULL nếu việc không liên quan
  // module cụ thể nào.
  moduleCode?: string | null
  // Việc đột xuất 5S (tuỳ chọn) — xem KpiTask.kpi_5s_location_id/before_image_urls.
  kpi5sLocationId?: string | null
  beforeImageUrls?: string[] | null
  // `id` client-generated (crypto.randomUUID()) — CHỈ truyền khi đã upload ảnh before TRƯỚC
  // insert (path Storage {factory_id}/kpi/tasks/{id}/... cần id có sẵn). Việc thường không
  // truyền, để DB tự sinh id theo default gen_random_uuid() như trước — tránh đổi hành vi mặc
  // định của mọi task khác. Xem migration 20260817_kpi_tasks_5s_adhoc.sql.
  id?: string
}): Promise<KpiTask> {
  if (!input.memberUserIds.length) throw new Error("Vui lòng chọn ít nhất 1 người thực hiện.")
  const mucTieu = input.mucTieuSoLuong ?? null
  if (mucTieu !== null) {
    if (mucTieu <= 0) throw new Error("Số lượng mục tiêu phải lớn hơn 0.")
    if (!input.nguoiChinhId || !input.memberUserIds.includes(input.nguoiChinhId)) {
      throw new Error("Vui lòng chọn người chính trong số người thực hiện đã chọn.")
    }
  }
  const maCongViec = await generateKpiTaskCode(input.factoryId, input.ngayGiao)

  const { data: taskRow, error: taskErr } = await supabase
    .from("kpi_tasks")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      factory_id: input.factoryId,
      ma_cong_viec: maCongViec,
      tieu_de: input.tieuDe.trim(),
      mo_ta: input.moTa.trim() || null,
      nguoi_giao_id: input.nguoiGiaoId,
      ngay_giao: input.ngayGiao,
      han_hoan_thanh: input.hanHoanThanh,
      yeu_cau_bao_cao: input.yeuCauBaoCao,
      muc_tieu_so_luong: mucTieu,
      phong_ban_id: input.phongBanId,
      module_code: input.moduleCode || null,
      kpi_5s_location_id: input.kpi5sLocationId || null,
      before_image_urls: input.beforeImageUrls?.length ? input.beforeImageUrls : null,
    })
    .select(TASK_COLS)
    .single()
  if (taskErr) throw taskErr
  const task = taskRow as KpiTask

  const memberRows = [...new Set(input.memberUserIds)].map((uid) => ({
    task_id: task.id,
    factory_id: input.factoryId,
    user_id: uid,
    phan_loai: mucTieu === null ? null : uid === input.nguoiChinhId ? "chinh" : "choang",
  }))
  const { error: memberErr } = await supabase.from("kpi_task_members").insert(memberRows)
  if (memberErr) throw memberErr

  return task
}

/** Ngưỡng tối thiểu (số lượng) mà người "chính" phải đạt trong 1 việc mục tiêu số lượng chung
 *  để không bị phạt điểm A — dùng để hiển thị cho người dùng, khớp đúng công thức RPC
 *  kpi_task_link_and_complete (migration 20260726_kpi_task_evaluate_quantity_guard.sql):
 *  ngưỡng = CEIL(mục_tiêu_số_lượng * 0.5) — tính thẳng trên TỔNG mục tiêu, KHÔNG chia theo số
 *  thành viên trong nhóm. Người chính phải luôn tự làm ít nhất một nửa TOÀN BỘ việc, bất kể có
 *  bao nhiêu người choàng hỗ trợ (bản trước chia theo "kỳ vọng cá nhân" = mục tiêu/số người —
 *  sai vì nhóm càng đông, ngưỡng thật của chính so với tổng việc càng tụt thấp). CEIL đảm bảo
 *  toán học ngưỡng luôn >= đúng 50% tổng, không bao giờ undershoot. */
export function computeChinhThreshold(mucTieuSoLuong: number): number {
  return Math.ceil(mucTieuSoLuong * 0.5)
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

// ── Phase 1b: Chuyển giao việc (kpi_task_transfers) ─────────────────────────────────────
// Xem migration 20260727_kpi_task_transfers.sql. Mỗi task một-lần chỉ chuyển được ĐÚNG 1 LẦN
// (kpi_tasks.da_chuyen_giao) — người nhận phải chủ động chấp nhận, không có gì tự động.
export type KpiTransferStatus = "cho_duyet" | "da_nhan" | "tu_choi"

export type KpiTaskTransfer = {
  id: string
  factory_id: string
  task_id: string
  tu_nguoi_id: string
  den_nguoi_id: string
  tien_do_luc_chuyen: number
  ghi_chu: string | null
  trang_thai: KpiTransferStatus
  ngay_chuyen: string
  phan_hoi_luc: string | null
  created_at: string
}

const TRANSFER_COLS =
  "id, factory_id, task_id, tu_nguoi_id, den_nguoi_id, tien_do_luc_chuyen, ghi_chu, trang_thai, ngay_chuyen, phan_hoi_luc, created_at"

export async function requestKpiTaskTransfer(input: { taskId: string; denNguoiId: string; ghiChu?: string }): Promise<string> {
  const { data, error } = await supabase.rpc("kpi_task_transfer_request", {
    p_task_id: input.taskId,
    p_den_nguoi_id: input.denNguoiId,
    p_ghi_chu: input.ghiChu?.trim() || null,
  })
  if (error) throw error
  return data as string
}

export async function respondKpiTaskTransfer(input: { transferId: string; chapNhan: boolean }): Promise<void> {
  const { error } = await supabase.rpc("kpi_task_transfer_respond", {
    p_transfer_id: input.transferId,
    p_chap_nhan: input.chapNhan,
  })
  if (error) throw error
}

export async function cancelKpiTaskTransfer(transferId: string): Promise<void> {
  const { error } = await supabase.rpc("kpi_task_transfer_cancel", { p_transfer_id: transferId })
  if (error) throw error
}

// Đổi hạn hoàn thành — chỉ nguoi_giao_id/admin (kiểm tra lại ở RPC, không tin client).
export async function extendKpiTaskDeadline(input: { taskId: string; newHanHoanThanh: string; lyDo: string }): Promise<void> {
  const { error } = await supabase.rpc("kpi_task_extend_deadline", {
    p_task_id: input.taskId,
    p_new_han_hoan_thanh: input.newHanHoanThanh,
    p_ly_do: input.lyDo.trim(),
  })
  if (error) throw error
}

/** Toàn bộ yêu cầu chuyển giao (mọi trạng thái) của 1 task — dùng ở trang chi tiết để tìm lời
 *  mời đang chờ (của tôi hoặc gửi bởi tôi) và hiển thị lịch sử. */
export async function fetchTaskTransfers(taskId: string): Promise<KpiTaskTransfer[]> {
  const { data, error } = await supabase
    .from("kpi_task_transfers")
    .select(TRANSFER_COLS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data || []) as KpiTaskTransfer[]
}

/** Lời mời chuyển giao đang chờ TÔI phản hồi — dùng cho Bell và danh sách "Việc của tôi" (task
 *  chưa có dòng kpi_task_members active cho tôi nên không lọt qua myActiveTaskIds bình
 *  thường). */
export async function fetchPendingIncomingTransfers(userId: string): Promise<KpiTaskTransfer[]> {
  const { data, error } = await supabase
    .from("kpi_task_transfers")
    .select(TRANSFER_COLS)
    .eq("den_nguoi_id", userId)
    .eq("trang_thai", "cho_duyet")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data || []) as KpiTaskTransfer[]
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
 *
 *  `moduleCode` (tuỳ chọn — nên là "họ module", vd "process", không phải "process:measurement")
 *  lọc chỉ còn đúng việc đã gắn `module_code` khớp module đang thao tác — dùng bởi
 *  `KpiLinkPrompt` để không gợi ý nhầm việc thuộc module khác (vd việc "Điều xe" bị gợi ý gắn
 *  vào bản ghi Kho nguyên liệu). Không truyền = không lọc theo module (backward-compat, hiện
 *  không còn call site nào dùng nhánh này sau khi KpiLinkPrompt luôn truyền module). */
export async function fetchOpenKpiTasksForUser(factoryId: string, userId: string, moduleCode?: string): Promise<KpiTask[]> {
  const { data: memberRows, error: memberErr } = await supabase
    .from("kpi_task_members")
    .select("task_id")
    .eq("user_id", userId)
    .eq("is_active", true)
  if (memberErr) throw memberErr
  const taskIds = [...new Set((memberRows || []).map((r: { task_id: string }) => r.task_id))]
  if (!taskIds.length) return []

  let query = supabase
    .from("kpi_tasks")
    .select(TASK_COLS)
    .eq("factory_id", factoryId)
    .in("id", taskIds)
    .not("trang_thai", "in", "(hoan_thanh,huy)")
  if (moduleCode) query = query.eq("module_code", moduleCode)
  const { data, error } = await query.order("han_hoan_thanh", { ascending: true })
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
 *  viên ĐANG hoạt động (ưu tiên điểm nghiệm thu nếu đã có, không thì dùng tự báo cáo).
 *
 *  Task có `muc_tieu_so_luong` (mục tiêu số lượng chung, xem migration
 *  20260725_kpi_task_quantity_target.sql): KHÔNG dùng trung bình cộng — RPC
 *  `kpi_task_link_and_complete` đã tính `tien_do` của MỖI thành viên = đóng góp của họ / TỔNG
 *  mục tiêu × 100, nên CỘNG DỒN (SUM) qua mọi thành viên active ra đúng % hoàn thành thật của
 *  cả việc chung. Dùng trung bình cộng ở đây (chia cho số người) sẽ cho kết quả sai — ví dụ 1
 *  người đóng góp 1/4 mục tiêu, người còn lại 0, trung bình cộng 2 người sẽ ra 12.5% thay vì
 *  đúng 25% thật của cả việc. */
export function averageTaskProgress(task: Pick<KpiTask, "muc_tieu_so_luong">, members: KpiTaskMember[]): number {
  const active = members.filter((m) => m.is_active)
  if (!active.length) return 0
  if (task.muc_tieu_so_luong !== null) {
    const sum = active.reduce((s, m) => s + m.tien_do, 0)
    return Math.min(100, Math.round(sum))
  }
  const sum = active.reduce((s, m) => s + (m.tien_do_nghiem_thu ?? m.tien_do), 0)
  return Math.round(sum / active.length)
}
