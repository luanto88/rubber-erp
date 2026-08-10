"use client"

// Module KPI — Khiếu nại (kpi_appeals). Gắn với 1 công việc, 1 lần chấm điểm 5S, HOẶC (Phase 5)
// 1 điểm KPI tháng đã khóa sổ. Xem đầy đủ .claude/rules/27-kpi-module.md, mục "Cập nhật — Phân
// công thông minh + Gia hạn + Khiếu nại" và "Liệt kê Phase 5".

import { supabase } from "@/lib/supabase"
import type { Kpi5sResult } from "@/lib/kpi-5s"

// "cho_duyet_sua" — riêng cho khiếu nại 5S: người chấm đã đề xuất kết quả sửa lại, đang chờ
// lãnh đạo phòng ban/admin duyệt (xem proposeKpi5sAppealCorrection/decideKpi5sAppealCorrection).
export type KpiAppealStatus = "cho_xu_ly" | "cho_duyet_sua" | "da_giai_quyet" | "tu_choi"

export const KPI_APPEAL_STATUS_LABEL: Record<KpiAppealStatus, string> = {
  cho_xu_ly: "Chờ xử lý",
  cho_duyet_sua: "Chờ duyệt đề xuất sửa",
  da_giai_quyet: "Đã giải quyết",
  tu_choi: "Từ chối",
}

export const KPI_APPEAL_STATUS_BADGE_CLASS: Record<KpiAppealStatus, string> = {
  cho_xu_ly: "bg-amber-100 text-amber-700",
  cho_duyet_sua: "bg-sky-100 text-sky-700",
  da_giai_quyet: "bg-emerald-100 text-emerald-700",
  tu_choi: "bg-slate-200 text-slate-500",
}

export type KpiAppeal = {
  id: string
  factory_id: string
  task_id: string | null
  location_evaluation_id: string | null
  monthly_score_id: string | null
  nguoi_khieu_nai_id: string
  noi_dung: string
  trang_thai: KpiAppealStatus
  phan_hoi: string | null
  nguoi_xu_ly_id: string | null
  proposed_ket_qua: Kpi5sResult | null
  proposed_ly_do: string | null
  proposed_by: string | null
  proposed_at: string | null
  created_at: string
  updated_at: string
}

const APPEAL_COLS =
  "id, factory_id, task_id, location_evaluation_id, monthly_score_id, nguoi_khieu_nai_id, noi_dung, trang_thai, phan_hoi, nguoi_xu_ly_id, proposed_ket_qua, proposed_ly_do, proposed_by, proposed_at, created_at, updated_at"

export function getKpiAppealErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg) return msg
  }
  return fallback
}

// RLS tự lọc đúng phạm vi (chủ khiếu nại thấy của mình; admin/kpi.manage_config thấy tất cả).
export async function fetchKpiAppeals(factoryId: string): Promise<KpiAppeal[]> {
  const { data, error } = await supabase
    .from("kpi_appeals")
    .select(APPEAL_COLS)
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data || []) as KpiAppeal[]
}

export async function createKpiAppealForTask(input: { factoryId: string; taskId: string; nguoiKhieuNaiId: string; noiDung: string }): Promise<void> {
  const { error } = await supabase.from("kpi_appeals").insert({
    factory_id: input.factoryId,
    task_id: input.taskId,
    nguoi_khieu_nai_id: input.nguoiKhieuNaiId,
    noi_dung: input.noiDung.trim(),
  })
  if (error) throw error
}

export async function createKpiAppealForLocationEvaluation(input: {
  factoryId: string
  locationEvaluationId: string
  nguoiKhieuNaiId: string
  noiDung: string
}): Promise<void> {
  const { error } = await supabase.from("kpi_appeals").insert({
    factory_id: input.factoryId,
    location_evaluation_id: input.locationEvaluationId,
    nguoi_khieu_nai_id: input.nguoiKhieuNaiId,
    noi_dung: input.noiDung.trim(),
  })
  if (error) throw error
}

// Bước 2 của quy trình khiếu nại 5S (2026-08-19) — NGƯỜI CHẤM (đúng nguoi_cham_id của lần chấm
// bị khiếu nại) tự đề xuất kết quả sửa lại. Chuyển khiếu nại sang 'cho_duyet_sua', CHƯA đụng
// kpi_5s_evaluations — chỉ khi lãnh đạo phòng ban/admin duyệt (decideKpi5sAppealCorrection) mới
// thực sự ghi đè kết quả gốc.
export async function proposeKpi5sAppealCorrection(input: {
  appealId: string
  newKetQua: Kpi5sResult
  newLyDo: string
}): Promise<void> {
  const { error } = await supabase.rpc("kpi_appeal_propose_correction", {
    p_appeal_id: input.appealId,
    p_new_ket_qua: input.newKetQua,
    p_new_ly_do: input.newLyDo.trim() || null,
  })
  if (error) throw error
}

// Bước 3 — lãnh đạo phòng ban của vị trí (hoặc admin/kpi.manage_config) duyệt/từ chối đề xuất ở
// bước 2. approve=true mới thực sự ghi đè kpi_5s_evaluations.ket_qua/ly_do; false chỉ đóng
// khiếu nại "Từ chối", giữ nguyên kết quả gốc.
export async function decideKpi5sAppealCorrection(input: {
  appealId: string
  approve: boolean
  ghiChu: string
}): Promise<void> {
  const { error } = await supabase.rpc("kpi_appeal_decide_correction", {
    p_appeal_id: input.appealId,
    p_approve: input.approve,
    p_ghi_chu: input.ghiChu.trim() || null,
  })
  if (error) throw error
}

export async function resolveKpiAppeal(input: {
  id: string
  trangThai: "da_giai_quyet" | "tu_choi"
  phanHoi: string
  nguoiXuLyId: string
}): Promise<void> {
  const { error } = await supabase
    .from("kpi_appeals")
    .update({ trang_thai: input.trangThai, phan_hoi: input.phanHoi.trim() || null, nguoi_xu_ly_id: input.nguoiXuLyId })
    .eq("id", input.id)
  if (error) throw error
}

// Bug 2 fix: đóng 1 khiếu nại 5S "Đã giải quyết" ĐỒNG THỜI sửa lại kết quả gốc gây tranh chấp
// — ngoại lệ duy nhất được phép sửa kpi_5s_evaluations (bảng cố ý bất biến với client), chỉ đi
// qua RPC SECURITY DEFINER này (kpi_5s_evaluation_correct, admin/kpi.manage_config only).
export async function resolveKpiLocationEvaluationAppeal(input: {
  appealId: string
  locationEvaluationId: string
  newKetQua: Kpi5sResult
  newLyDo: string
  ghiChu: string
}): Promise<void> {
  const { error } = await supabase.rpc("kpi_5s_evaluation_correct", {
    p_location_evaluation_id: input.locationEvaluationId,
    p_new_ket_qua: input.newKetQua,
    p_new_ly_do: input.newLyDo.trim() || null,
    p_ghi_chu: input.ghiChu.trim() || null,
    p_appeal_id: input.appealId,
  })
  if (error) throw error
}

// Admin tự sửa kết quả 5S trực tiếp, KHÔNG qua 1 khiếu nại có sẵn — dùng khi người chấm tự
// phát hiện chấm sai (báo ngoài luồng app) và không có nút "Khiếu nại" cho chính mình. RPC tự
// tạo 1 khiếu nại đã "Đã giải quyết" làm audit trail duy nhất cho thao tác này.
export async function correctKpi5sEvaluationDirect(input: {
  locationEvaluationId: string
  newKetQua: Kpi5sResult
  newLyDo: string
  ghiChu: string
}): Promise<void> {
  const { error } = await supabase.rpc("kpi_5s_evaluation_correct", {
    p_location_evaluation_id: input.locationEvaluationId,
    p_new_ket_qua: input.newKetQua,
    p_new_ly_do: input.newLyDo.trim() || null,
    p_ghi_chu: input.ghiChu.trim() || null,
    p_appeal_id: null,
  })
  if (error) throw error
}

// ── Phase 5: Khiếu nại điểm KPI tháng (chỉ khi điểm đã khóa sổ — RLS tự chặn) ────────────────
export async function createKpiAppealForMonthlyScore(input: {
  factoryId: string
  monthlyScoreId: string
  nguoiKhieuNaiId: string
  noiDung: string
}): Promise<void> {
  const { error } = await supabase.from("kpi_appeals").insert({
    factory_id: input.factoryId,
    monthly_score_id: input.monthlyScoreId,
    nguoi_khieu_nai_id: input.nguoiKhieuNaiId,
    noi_dung: input.noiDung.trim(),
  })
  if (error) throw error
}

// Đóng 1 khiếu nại điểm tháng "Đã giải quyết" ĐỒNG THỜI ghi audit điều chỉnh vào
// kpi_score_adjustments — mirror đúng resolveKpiLocationEvaluationAppeal. RPC tự chặn nếu điểm
// chưa 'da_khoa' hoặc khiếu nại không còn 'cho_xu_ly'.
export async function resolveKpiMonthlyScoreAppeal(input: {
  appealId: string
  monthlyScoreId: string
  newDiemTong: number
  lyDo: string
  ghiChu: string
}): Promise<void> {
  const { error } = await supabase.rpc("kpi_monthly_score_adjust", {
    p_monthly_score_id: input.monthlyScoreId,
    p_new_diem_tong: input.newDiemTong,
    p_ly_do: input.lyDo.trim(),
    p_ghi_chu: input.ghiChu.trim() || null,
    p_appeal_id: input.appealId,
  })
  if (error) throw error
}

// Admin tự điều chỉnh điểm tháng ĐÃ KHÓA trực tiếp, KHÔNG qua 1 khiếu nại có sẵn — mirror
// correctKpi5sEvaluationDirect. RPC tự tạo 1 khiếu nại "Đã giải quyết" làm audit trail.
export async function adjustKpiMonthlyScoreDirect(input: {
  monthlyScoreId: string
  newDiemTong: number
  lyDo: string
  ghiChu: string
}): Promise<void> {
  const { error } = await supabase.rpc("kpi_monthly_score_adjust", {
    p_monthly_score_id: input.monthlyScoreId,
    p_new_diem_tong: input.newDiemTong,
    p_ly_do: input.lyDo.trim(),
    p_ghi_chu: input.ghiChu.trim() || null,
    p_appeal_id: null,
  })
  if (error) throw error
}
