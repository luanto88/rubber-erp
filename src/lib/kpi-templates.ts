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
  created_by: string
  created_at: string
  updated_at: string
}

const TEMPLATE_COLS =
  "id, factory_id, group_id, assigned_user_id, tieu_de, mo_ta, apply_weekdays, gio_han, yeu_cau_bao_cao, is_active, created_by, created_at, updated_at"

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
}

const SUBSTITUTION_COLS =
  "id, factory_id, original_user_id, substitute_user_id, template_id, tu_ngay, den_ngay, ly_do, created_by, created_at"

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

// ── Sinh "lười" instance công việc định kỳ hôm nay ───────────────────────────
// Gọi 1 lần/phiên/ngày từ bootstrap dashboard layout — RPC tự idempotent (UNIQUE
// (template_id, ngay_giao)) nên gọi lặp lại không tạo trùng; lỗi phải được caller tự
// catch-and-ignore (không được làm chậm/gãy bootstrap chính).
export async function ensureTodayKpiTaskInstances(factoryId: string): Promise<number> {
  const { data, error } = await supabase.rpc("kpi_ensure_today_task_instances", { p_factory_id: factoryId })
  if (error) throw error
  return (data as number) || 0
}
