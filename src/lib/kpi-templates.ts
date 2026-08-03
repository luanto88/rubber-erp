"use client"

// Module KPI — Việc định kỳ theo nhóm (kpi_task_templates) + Người thay thế tạm thời
// (kpi_user_substitutions). Xem migration 20260728_kpi_task_templates.sql và
// .claude/rules/27-kpi-module.md.
//
// KHÔNG có "auto_action_type"/tự động hoàn thành riêng cho task định kỳ — task sinh từ
// template hoạt động HỆT task tạo tay một-lần, dùng chung cơ chế "Gắn bản ghi tại chỗ" đã có
// (KpiLinkPrompt tự tìm mọi task đang mở của người dùng, không phân biệt nguồn gốc).

import { supabase } from "@/lib/supabase"
import type { KpiReportRequirement } from "@/lib/kpi-tasks"

export const KPI_WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const
export const KPI_WEEKDAY_LABEL: Record<number, string> = {
  1: "Thứ 2",
  2: "Thứ 3",
  3: "Thứ 4",
  4: "Thứ 5",
  5: "Thứ 6",
  6: "Thứ 7",
  7: "CN",
}

export type KpiTaskTemplate = {
  id: string
  factory_id: string
  group_id: string
  assigned_user_id: string
  tieu_de: string
  mo_ta: string | null
  apply_weekdays: number[]
  gio_han: string // "HH:MM:SS"
  yeu_cau_bao_cao: KpiReportRequirement[]
  is_active: boolean
  phong_ban_id: string | null
  // Module ERP liên quan (xem KPI_MODULE_OPTIONS trong kpi-tasks.ts) — copy sang mọi instance
  // kpi_tasks sinh ra từ template này (kpi_ensure_today_task_instances). NULL = không liên quan
  // module cụ thể, các instance sinh ra sẽ không bao giờ được KpiLinkPrompt gợi ý.
  module_code: string | null
  created_by: string
  created_at: string
  updated_at: string
}

const TEMPLATE_COLS =
  "id, factory_id, group_id, assigned_user_id, tieu_de, mo_ta, apply_weekdays, gio_han, yeu_cau_bao_cao, is_active, phong_ban_id, module_code, created_by, created_at, updated_at"

export type KpiSubstitutionStatus = "cho_duyet" | "da_duyet" | "tu_choi"

export const KPI_SUBSTITUTION_STATUS_LABEL: Record<KpiSubstitutionStatus, string> = {
  cho_duyet: "Chờ duyệt",
  da_duyet: "Đã duyệt",
  tu_choi: "Từ chối",
}

export const KPI_SUBSTITUTION_STATUS_BADGE_CLASS: Record<KpiSubstitutionStatus, string> = {
  cho_duyet: "bg-amber-100 text-amber-700",
  da_duyet: "bg-emerald-100 text-emerald-700",
  tu_choi: "bg-rose-100 text-rose-700",
}

export type KpiUserSubstitution = {
  id: string
  factory_id: string
  original_user_id: string
  substitute_user_id: string
  template_id: string | null
  tu_ngay: string
  den_ngay: string
  ly_do: string | null
  created_by: string
  created_at: string
  trang_thai: KpiSubstitutionStatus
  nguoi_duyet_id: string | null
  duyet_luc: string | null
  ly_do_tu_choi: string | null
}

const SUBSTITUTION_COLS =
  "id, factory_id, original_user_id, substitute_user_id, template_id, tu_ngay, den_ngay, ly_do, created_by, created_at, trang_thai, nguoi_duyet_id, duyet_luc, ly_do_tu_choi"

export type KpiGroupOption = { id: string; name: string }

export async function loadAllPersonnelGroups(factoryId: string): Promise<KpiGroupOption[]> {
  const { data, error } = await supabase
    .from("personnel_groups")
    .select("id, name")
    .eq("factory_id", factoryId)
    .eq("is_active", true)
    .order("sort_order")
    .order("name")
  if (error) throw error
  return (data || []) as KpiGroupOption[]
}

// ── kpi_task_templates ───────────────────────────────────────────────────────
export async function fetchKpiTaskTemplates(factoryId: string): Promise<KpiTaskTemplate[]> {
  const { data, error } = await supabase
    .from("kpi_task_templates")
    .select(TEMPLATE_COLS)
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data || []) as KpiTaskTemplate[]
}

export type KpiTaskTemplateInput = {
  factoryId: string
  createdBy: string
  groupId: string
  assignedUserId: string
  tieuDe: string
  moTa: string
  applyWeekdays: number[]
  gioHan: string
  yeuCauBaoCao: KpiReportRequirement[]
  isActive: boolean
  phongBanId: string | null
  moduleCode: string | null
}

export async function createKpiTaskTemplate(input: KpiTaskTemplateInput): Promise<KpiTaskTemplate> {
  if (!input.applyWeekdays.length) throw new Error("Vui lòng chọn ít nhất 1 ngày áp dụng.")
  const { data, error } = await supabase
    .from("kpi_task_templates")
    .insert({
      factory_id: input.factoryId,
      created_by: input.createdBy,
      group_id: input.groupId,
      assigned_user_id: input.assignedUserId,
      tieu_de: input.tieuDe.trim(),
      mo_ta: input.moTa.trim() || null,
      apply_weekdays: input.applyWeekdays,
      gio_han: input.gioHan,
      yeu_cau_bao_cao: input.yeuCauBaoCao,
      is_active: input.isActive,
      phong_ban_id: input.phongBanId,
      module_code: input.moduleCode,
    })
    .select(TEMPLATE_COLS)
    .single()
  if (error) throw error
  return data as KpiTaskTemplate
}

export async function updateKpiTaskTemplate(
  id: string,
  input: Omit<KpiTaskTemplateInput, "factoryId" | "createdBy">,
): Promise<void> {
  if (!input.applyWeekdays.length) throw new Error("Vui lòng chọn ít nhất 1 ngày áp dụng.")
  const { error } = await supabase
    .from("kpi_task_templates")
    .update({
      group_id: input.groupId,
      assigned_user_id: input.assignedUserId,
      tieu_de: input.tieuDe.trim(),
      mo_ta: input.moTa.trim() || null,
      apply_weekdays: input.applyWeekdays,
      gio_han: input.gioHan,
      yeu_cau_bao_cao: input.yeuCauBaoCao,
      is_active: input.isActive,
      phong_ban_id: input.phongBanId,
      module_code: input.moduleCode,
    })
    .eq("id", id)
  if (error) throw error
}

export async function setKpiTaskTemplateActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("kpi_task_templates").update({ is_active: isActive }).eq("id", id)
  if (error) throw error
}

export async function deleteKpiTaskTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("kpi_task_templates").delete().eq("id", id)
  if (error) throw error
}

// ── kpi_user_substitutions ───────────────────────────────────────────────────
export async function fetchKpiUserSubstitutions(factoryId: string): Promise<KpiUserSubstitution[]> {
  const { data, error } = await supabase
    .from("kpi_user_substitutions")
    .select(SUBSTITUTION_COLS)
    .eq("factory_id", factoryId)
    .order("tu_ngay", { ascending: false })
  if (error) throw error
  return (data || []) as KpiUserSubstitution[]
}

export async function createKpiUserSubstitution(input: {
  factoryId: string
  createdBy: string
  originalUserId: string
  substituteUserId: string
  templateId: string | null
  tuNgay: string
  denNgay: string
  lyDo: string
}): Promise<KpiUserSubstitution> {
  if (input.originalUserId === input.substituteUserId) {
    throw new Error("Người thay thế phải khác người đi vắng.")
  }
  if (input.denNgay < input.tuNgay) {
    throw new Error("Đến ngày phải sau hoặc bằng Từ ngày.")
  }
  const { data, error } = await supabase
    .from("kpi_user_substitutions")
    .insert({
      factory_id: input.factoryId,
      created_by: input.createdBy,
      original_user_id: input.originalUserId,
      substitute_user_id: input.substituteUserId,
      template_id: input.templateId,
      tu_ngay: input.tuNgay,
      den_ngay: input.denNgay,
      ly_do: input.lyDo.trim() || null,
    })
    .select(SUBSTITUTION_COLS)
    .single()
  if (error) throw error
  return data as KpiUserSubstitution
}

export async function deleteKpiUserSubstitution(id: string): Promise<void> {
  const { error } = await supabase.from("kpi_user_substitutions").delete().eq("id", id)
  if (error) throw error
}

// ── Duyệt/từ chối (Phase C) — ai đăng ký thì phía còn lại duyệt: tự đăng ký → lãnh đạo phòng
// ban của người đó duyệt; lãnh đạo/kpi.assign đăng ký hộ → chính người đi vắng tự xác nhận. Xem
// đầy đủ RPC kpi_substitution_approve/kpi_substitution_reject trong
// 20260807_kpi_substitution_approval.sql — 2 hàm dưới đây chỉ là wrapper mỏng.
export async function approveKpiUserSubstitution(id: string): Promise<void> {
  const { error } = await supabase.rpc("kpi_substitution_approve", { p_id: id })
  if (error) throw error
}

export async function rejectKpiUserSubstitution(id: string, lyDo: string): Promise<void> {
  const { error } = await supabase.rpc("kpi_substitution_reject", { p_id: id, p_ly_do: lyDo.trim() || null })
  if (error) throw error
}

// Đăng ký 'cho_duyet' mà CHÍNH user này có khả năng cần xử lý — RLS (kpi_user_substitutions_select)
// đã tự giới hạn tập nhìn thấy được (chỉ liên quan/admin/kpi.view_all/lãnh đạo phòng ban của
// original_user_id), ở đây chỉ lọc tiếp bỏ các dòng do chính mình tự đăng ký (đang chờ NGƯỜI
// KHÁC duyệt cho mình, không phải mình duyệt).
export async function fetchPendingSubstitutionsForApprover(userId: string, factoryId: string): Promise<KpiUserSubstitution[]> {
  const { data, error } = await supabase
    .from("kpi_user_substitutions")
    .select(SUBSTITUTION_COLS)
    .eq("factory_id", factoryId)
    .eq("trang_thai", "cho_duyet")
  if (error) throw error
  return ((data || []) as KpiUserSubstitution[]).filter((s) => {
    if (s.created_by !== s.original_user_id) return s.original_user_id === userId
    return s.original_user_id !== userId
  })
}

// ── Sinh "lười" instance công việc định kỳ hôm nay ───────────────────────────
// Gọi 1 lần/phiên/ngày từ bootstrap dashboard layout — RPC tự idempotent (UNIQUE
// (template_id, ngay_giao)) nên gọi lặp lại không tạo trùng; lỗi phải được caller tự
// catch-and-ignore (không được làm chậm/gãy bootstrap chính).
export async function ensureTodayKpiTaskInstances(factoryId: string): Promise<number> {
  const { data, error } = await supabase.rpc("kpi_ensure_today_task_instances", { p_factory_id: factoryId })
  if (error) throw error
  return (data as number) || 0
}
