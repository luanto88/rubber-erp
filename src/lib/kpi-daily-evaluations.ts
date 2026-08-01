"use client"

// Module KPI — Phase 3: Chấm điểm chuyên môn theo ngày (kpi_daily_evaluations +
// kpi_daily_evaluation_items). Xem migration 20260811_kpi_criteria_daily_evaluations.sql và
// .claude/rules/27-kpi-module.md mục "D — Điểm chuyên môn".
//
// 1 lượt chấm = 1 nhóm, 1 người, 1 ngày. Nộp/sửa lại đều đi qua RPC atomic
// `kpi_submit_daily_evaluation` (upsert theo (factory_id,user_id,ngay,group_id) + thay toàn bộ
// items trong 1 transaction) — KHÔNG tự làm nhiều bước rời rạc ở client, và `loai`
// ('chinh'/'choang') luôn do RPC tự tính (snapshot is_primary tại đúng thời điểm chấm), không
// tin client tự khai báo.
//
// Công thức %đạt (dùng để hiển thị + sẽ dùng cho Điểm D ở Phase 4):
//   %đạt(1 nhóm, 1 ngày) = Σ(Đạt×1.0 + Tương_đối×0.5 + Chưa_đạt×0) ÷ số tiêu chí đã chấm

import { supabase } from "@/lib/supabase"

export type KpiDailyResult = "dat" | "tuong_doi" | "chua_dat"

export const KPI_DAILY_RESULT_LABEL: Record<KpiDailyResult, string> = {
  dat: "Đạt",
  tuong_doi: "Tương đối",
  chua_dat: "Chưa đạt",
}

export const KPI_DAILY_RESULT_BADGE_CLASS: Record<KpiDailyResult, string> = {
  dat: "bg-emerald-100 text-emerald-700",
  tuong_doi: "bg-amber-100 text-amber-700",
  chua_dat: "bg-rose-100 text-rose-700",
}

export type KpiDailyPhanLoai = "chinh" | "choang"

export type KpiDailyEvaluation = {
  id: string
  factory_id: string
  user_id: string
  ngay: string
  group_id: string
  loai: KpiDailyPhanLoai
  nguoi_cham_id: string
  ghi_chu: string | null
  created_at: string
  updated_at: string
}

export type KpiDailyEvaluationItem = {
  id: string
  factory_id: string
  evaluation_id: string
  criteria_id: string
  ket_qua: KpiDailyResult
  created_at: string
}

export type KpiDailyEvaluationWithItems = KpiDailyEvaluation & { items: KpiDailyEvaluationItem[] }

const EVAL_COLS = "id, factory_id, user_id, ngay, group_id, loai, nguoi_cham_id, ghi_chu, created_at, updated_at"
const ITEM_COLS = "id, factory_id, evaluation_id, criteria_id, ket_qua, created_at"
const EVAL_WITH_ITEMS_COLS = `${EVAL_COLS}, kpi_daily_evaluation_items(${ITEM_COLS})`

type EvalRow = KpiDailyEvaluation & { kpi_daily_evaluation_items: KpiDailyEvaluationItem[] | null }

function mapEvalRow(row: EvalRow): KpiDailyEvaluationWithItems {
  const { kpi_daily_evaluation_items, ...rest } = row
  return { ...rest, items: kpi_daily_evaluation_items || [] }
}

/** %đạt của 1 tập tiêu chí đã chấm — làm tròn 1 chữ số thập phân. 0 tiêu chí → 0 (không chia 0). */
export function computeDailyPercent(items: Pick<KpiDailyEvaluationItem, "ket_qua">[]): number {
  if (items.length === 0) return 0
  const sum = items.reduce((s, it) => s + (it.ket_qua === "dat" ? 1 : it.ket_qua === "tuong_doi" ? 0.5 : 0), 0)
  return Math.round((sum / items.length) * 1000) / 10
}

/** 1 lượt chấm cụ thể (user + ngày + nhóm) kèm items — dùng để pre-fill form khi mở lại/sửa. */
export async function fetchKpiDailyEvaluationOne(
  factoryId: string,
  userId: string,
  ngay: string,
  groupId: string,
): Promise<KpiDailyEvaluationWithItems | null> {
  const { data, error } = await supabase
    .from("kpi_daily_evaluations")
    .select(EVAL_WITH_ITEMS_COLS)
    .eq("factory_id", factoryId)
    .eq("user_id", userId)
    .eq("ngay", ngay)
    .eq("group_id", groupId)
    .maybeSingle()
  if (error) throw error
  return data ? mapEvalRow(data as unknown as EvalRow) : null
}

/** Toàn bộ lượt chấm trong 1 ngày (mọi người, mọi nhóm) — dùng cho bảng "Lịch sử chấm điểm". */
export async function fetchKpiDailyEvaluationsForDay(factoryId: string, ngay: string): Promise<KpiDailyEvaluationWithItems[]> {
  const { data, error } = await supabase
    .from("kpi_daily_evaluations")
    .select(EVAL_WITH_ITEMS_COLS)
    .eq("factory_id", factoryId)
    .eq("ngay", ngay)
    .order("created_at", { ascending: false })
  if (error) throw error
  return ((data || []) as unknown as EvalRow[]).map(mapEvalRow)
}

export async function submitKpiDailyEvaluation(input: {
  userId: string
  ngay: string
  groupId: string
  ghiChu: string
  items: { criteriaId: string; ketQua: KpiDailyResult }[]
}): Promise<string> {
  const { data, error } = await supabase.rpc("kpi_submit_daily_evaluation", {
    p_user_id: input.userId,
    p_ngay: input.ngay,
    p_group_id: input.groupId,
    p_ghi_chu: input.ghiChu.trim() || null,
    p_items: input.items.map((it) => ({ criteria_id: it.criteriaId, ket_qua: it.ketQua })),
  })
  if (error) throw error
  return data as string
}

export async function deleteKpiDailyEvaluation(evaluationId: string): Promise<void> {
  const { error } = await supabase.rpc("kpi_delete_daily_evaluation", { p_evaluation_id: evaluationId })
  if (error) throw error
}
