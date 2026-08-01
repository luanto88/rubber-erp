"use client"

// Module KPI — Phase 3: Khung tiêu chí KPI theo nhóm chuyên môn (kpi_criteria_templates). Xem
// migration 20260811_kpi_criteria_daily_evaluations.sql và .claude/rules/27-kpi-module.md mục
// "Database Schema" ("Nhóm & Chuyên môn (D)").
//
// Mỗi tiêu chí thuộc đúng 1 nhóm (personnel_groups.id) — khi chấm điểm chuyên môn cho 1 người ở
// 1 nhóm cụ thể, chỉ hiện đúng các tiêu chí của nhóm đó (fetchKpiCriteriaTemplatesByGroup).
// KHÔNG có phong_ban_id (personnel_groups không mang khái niệm phòng ban) — CRUD chỉ giới hạn
// admin/kpi.manage_config (xem RLS trong migration), không mở rộng cho "lãnh đạo phòng ban" như
// kpi_5s_locations/kpi_task_templates.

import { supabase } from "@/lib/supabase"

export type KpiCriteriaTemplate = {
  id: string
  factory_id: string
  group_id: string
  ten_tieu_chi: string
  mo_ta: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

const CRITERIA_COLS = "id, factory_id, group_id, ten_tieu_chi, mo_ta, sort_order, is_active, created_at, updated_at"

export async function fetchKpiCriteriaTemplates(factoryId: string, opts?: { includeInactive?: boolean }): Promise<KpiCriteriaTemplate[]> {
  let q = supabase.from("kpi_criteria_templates").select(CRITERIA_COLS).eq("factory_id", factoryId)
  if (!opts?.includeInactive) q = q.eq("is_active", true)
  const { data, error } = await q.order("sort_order", { ascending: true }).order("ten_tieu_chi", { ascending: true })
  if (error) throw error
  return (data || []) as KpiCriteriaTemplate[]
}

/** Tiêu chí ĐANG ÁP DỤNG của đúng 1 nhóm — dùng cho form chấm điểm chuyên môn (chỉ hiện tiêu chí
 *  còn hiệu lực, không hiện tiêu chí đã tạm ngưng dù nhóm đó từng có). */
export async function fetchKpiCriteriaTemplatesByGroup(factoryId: string, groupId: string): Promise<KpiCriteriaTemplate[]> {
  const { data, error } = await supabase
    .from("kpi_criteria_templates")
    .select(CRITERIA_COLS)
    .eq("factory_id", factoryId)
    .eq("group_id", groupId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("ten_tieu_chi", { ascending: true })
  if (error) throw error
  return (data || []) as KpiCriteriaTemplate[]
}

export type KpiCriteriaTemplateInput = {
  factory_id: string
  group_id: string
  ten_tieu_chi: string
  mo_ta: string | null
  sort_order: number
  is_active: boolean
}

export async function createKpiCriteriaTemplate(input: KpiCriteriaTemplateInput): Promise<void> {
  const { error } = await supabase.from("kpi_criteria_templates").insert(input)
  if (error) throw error
}

export async function updateKpiCriteriaTemplate(id: string, input: Partial<KpiCriteriaTemplateInput>): Promise<void> {
  const { error } = await supabase.from("kpi_criteria_templates").update(input).eq("id", id)
  if (error) throw error
}

export async function setKpiCriteriaTemplateActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("kpi_criteria_templates").update({ is_active: isActive }).eq("id", id)
  if (error) throw error
}

export async function deleteKpiCriteriaTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("kpi_criteria_templates").delete().eq("id", id)
  if (error) throw error
}
