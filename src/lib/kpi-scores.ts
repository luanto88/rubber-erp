"use client"

// Module KPI — Phase 4: Trọng số công thức + Hệ số chuyên cần + Engine tính điểm tháng. Xem
// migration 20260813_kpi_score_weights_monthly_scores.sql và .claude/rules/27-kpi-module.md, mục
// "Công thức tính điểm" (đầu file) và "Cập nhật Phase 4".
//
// kpi_score_weights: 1 dòng/nhóm chuyên môn (group_id) hoặc 1 dòng mặc định toàn nhà máy
// (group_id = null). kpi_monthly_scores: snapshot bất biến (trừ khi trang_thai='nhap') do RPC
// kpi_compute_monthly_scores ghi — client KHÔNG được insert/update trực tiếp bảng này.
//
// Phase 5 (migration 20260814_kpi_score_lock_adjust_rank.sql): khóa sổ (lockKpiMonthlyScore),
// audit điều chỉnh điểm đã khóa (kpi_score_adjustments — chỉ ghi qua RPC, xem kpi-appeals.ts cho
// 2 hàm gọi kpi_monthly_score_adjust), và bảng xếp hạng ẩn danh theo nhóm/phòng ban.

import { supabase } from "@/lib/supabase"

export type KpiScoreWeights = {
  id: string
  factory_id: string
  group_id: string | null
  trong_so_hoan_thanh: number
  trong_so_dung_han: number
  trong_so_5s: number
  trong_so_chuyen_mon: number
  /** LEGACY (công thức v1) — từ C5 dùng so_ngay_nghi_tua_chuan. */
  ngay_chuan_chuyen_can: number
  he_so_chuyen_can_min: number
  he_so_chuyen_can_max: number
  /** C5: công chuẩn tháng = số ngày lịch − giá trị này. */
  so_ngay_nghi_tua_chuan: number
  /** C5: trừ vào hệ số cho mỗi ngày nghỉ không phép. */
  he_so_phat_khong_phep: number
  created_at: string
  updated_at: string
}

const WEIGHTS_COLS =
  "id, factory_id, group_id, trong_so_hoan_thanh, trong_so_dung_han, trong_so_5s, trong_so_chuyen_mon, ngay_chuan_chuyen_can, he_so_chuyen_can_min, he_so_chuyen_can_max, so_ngay_nghi_tua_chuan, he_so_phat_khong_phep, created_at, updated_at"

export function defaultKpiScoreWeights(): Omit<KpiScoreWeights, "id" | "factory_id" | "group_id" | "created_at" | "updated_at"> {
  return {
    trong_so_hoan_thanh: 30,
    trong_so_dung_han: 25,
    trong_so_5s: 20,
    trong_so_chuyen_mon: 25,
    ngay_chuan_chuyen_can: 24,
    he_so_chuyen_can_min: 0.75,
    he_so_chuyen_can_max: 1.1,
    so_ngay_nghi_tua_chuan: 6,
    he_so_phat_khong_phep: 0.02,
  }
}

export async function fetchKpiScoreWeights(factoryId: string): Promise<KpiScoreWeights[]> {
  const { data, error } = await supabase
    .from("kpi_score_weights")
    .select(WEIGHTS_COLS)
    .eq("factory_id", factoryId)
    .order("group_id", { ascending: true, nullsFirst: true })
  if (error) throw error
  return (data || []) as KpiScoreWeights[]
}

export type KpiScoreWeightsInput = {
  factoryId: string
  groupId: string | null
  trongSoHoanThanh: number
  trongSoDungHan: number
  trongSo5s: number
  trongSoChuyenMon: number
  ngayChuanChuyenCan: number
  heSoChuyenCanMin: number
  heSoChuyenCanMax: number
  soNgayNghiTuaChuan: number
  heSoPhatKhongPhep: number
}

function validateWeightsSum(input: Pick<KpiScoreWeightsInput, "trongSoHoanThanh" | "trongSoDungHan" | "trongSo5s" | "trongSoChuyenMon">) {
  const total = input.trongSoHoanThanh + input.trongSoDungHan + input.trongSo5s + input.trongSoChuyenMon
  if (Math.round(total * 10) / 10 !== 100) {
    throw new Error(`Tổng 4 trọng số phải bằng 100 (hiện tại: ${total}).`)
  }
}

export async function createKpiScoreWeights(input: KpiScoreWeightsInput): Promise<KpiScoreWeights> {
  validateWeightsSum(input)
  const { data, error } = await supabase
    .from("kpi_score_weights")
    .insert({
      factory_id: input.factoryId,
      group_id: input.groupId,
      trong_so_hoan_thanh: input.trongSoHoanThanh,
      trong_so_dung_han: input.trongSoDungHan,
      trong_so_5s: input.trongSo5s,
      trong_so_chuyen_mon: input.trongSoChuyenMon,
      ngay_chuan_chuyen_can: input.ngayChuanChuyenCan,
      he_so_chuyen_can_min: input.heSoChuyenCanMin,
      he_so_chuyen_can_max: input.heSoChuyenCanMax,
      so_ngay_nghi_tua_chuan: input.soNgayNghiTuaChuan,
      he_so_phat_khong_phep: input.heSoPhatKhongPhep,
    })
    .select(WEIGHTS_COLS)
    .single()
  if (error) throw error
  return data as KpiScoreWeights
}

export async function updateKpiScoreWeights(id: string, input: Omit<KpiScoreWeightsInput, "factoryId" | "groupId">): Promise<void> {
  validateWeightsSum(input)
  const { error } = await supabase
    .from("kpi_score_weights")
    .update({
      trong_so_hoan_thanh: input.trongSoHoanThanh,
      trong_so_dung_han: input.trongSoDungHan,
      trong_so_5s: input.trongSo5s,
      trong_so_chuyen_mon: input.trongSoChuyenMon,
      ngay_chuan_chuyen_can: input.ngayChuanChuyenCan,
      he_so_chuyen_can_min: input.heSoChuyenCanMin,
      he_so_chuyen_can_max: input.heSoChuyenCanMax,
      so_ngay_nghi_tua_chuan: input.soNgayNghiTuaChuan,
      he_so_phat_khong_phep: input.heSoPhatKhongPhep,
    })
    .eq("id", id)
  if (error) throw error
}

export async function deleteKpiScoreWeights(id: string): Promise<void> {
  const { error } = await supabase.from("kpi_score_weights").delete().eq("id", id)
  if (error) throw error
}

// ── kpi_monthly_scores ────────────────────────────────────────────────────────
export type KpiMonthlyScoreDetail = {
  a: number | null
  b: number | null
  c: number | null
  d: number | null
  trong_so: { a: number; b: number; c: number; d: number }
  // Trọng số SAU renormalize (0 nếu thành phần tương ứng thiếu dữ liệu) — optional vì dòng điểm
  // tính trước migration 20260825_kpi_score_renormalize.sql chưa có 2 field này trong chi_tiet.
  trong_so_hieu_luc?: { a: number; b: number; c: number; d: number }
  co_du_lieu?: { a: boolean; b: boolean; c: boolean; d: boolean }
  he_so_chuyen_can: number
  so_ngay_co_cham: number
  /** v1: ngày chuẩn chuyên cần; v2: công chuẩn tháng. */
  ngay_chuan: number
  /** C5 — có từ migration 20261216; thiếu = công thức v1 (số ngày chấm D ÷ ngày chuẩn). */
  cong_thuc_version?: number
  chuyen_can?: KpiScoreAttendanceDetail
}

/** chi_tiet.chuyen_can (công thức v2 — hệ số chuyên cần từ module Chấm công). */
export type KpiScoreAttendanceDetail = {
  loai: "nhan_vien" | "cong_nhan" | "khong_ho_so" | null
  khong_xet: string | null
  tam_tinh: boolean | null
  so_ngay_lich: number | null
  tua_chuan: number | null
  cong_chuan: number | null
  muc_phat: number | null
  co_mat: number | null
  co_mat_tu_dong: number | null
  co_mat_truc_ca: number | null
  co_mat_cham_tay: number | null
  phep_thuong_bu: number | null
  co_phep: number | null
  khong_phep: number | null
  nghi_tua: number | null
  chua_ghi_nhan: number | null
  /** B (20261224): nguồn số ngày tua chuẩn + lý do (cấu hình tháng), ngày chuyên cần (chỉ số phụ). */
  tua_nguon?: KpiTuaSource | null
  tua_ly_do?: string | null
  ngay_chuyen_can?: number | null
}

/** Tua chuẩn lấy từ: cấu hình tháng của nhóm chính → tháng chung → trọng số nhóm → trọng số chung → 6. */
export type KpiTuaSource = "thang_nhom" | "thang_chung" | "trong_so_nhom" | "trong_so_chung" | "mac_dinh"

export const KPI_TUA_SOURCE_LABEL: Record<KpiTuaSource, string> = {
  thang_nhom: "cấu hình tháng của nhóm chính",
  thang_chung: "cấu hình tháng chung",
  trong_so_nhom: "trọng số của nhóm chính",
  trong_so_chung: "trọng số mặc định",
  mac_dinh: "mặc định 6 ngày",
}

export type KpiMonthlyScore = {
  id: string
  factory_id: string
  user_id: string
  nam: number
  thang: number
  diem_hoan_thanh: number | null
  diem_dung_han: number | null
  diem_5s: number | null
  diem_chuyen_mon: number | null
  he_so_chuyen_can: number | null
  so_ngay_co_cham: number | null
  diem_tong: number | null
  chi_tiet: KpiMonthlyScoreDetail | null
  trang_thai: "nhap" | "da_khoa"
  khoa_boi: string | null
  khoa_luc: string | null
  created_at: string
  updated_at: string
}

const MONTHLY_SCORE_COLS =
  "id, factory_id, user_id, nam, thang, diem_hoan_thanh, diem_dung_han, diem_5s, diem_chuyen_mon, he_so_chuyen_can, so_ngay_co_cham, diem_tong, chi_tiet, trang_thai, khoa_boi, khoa_luc, created_at, updated_at"

export async function fetchKpiMonthlyScores(factoryId: string, nam: number, thang: number): Promise<KpiMonthlyScore[]> {
  const { data, error } = await supabase
    .from("kpi_monthly_scores")
    .select(MONTHLY_SCORE_COLS)
    .eq("factory_id", factoryId)
    .eq("nam", nam)
    .eq("thang", thang)
    .order("diem_tong", { ascending: false, nullsFirst: false })
  if (error) throw error
  return (data || []) as KpiMonthlyScore[]
}

export async function fetchMyKpiMonthlyScores(userId: string, factoryId: string): Promise<KpiMonthlyScore[]> {
  const { data, error } = await supabase
    .from("kpi_monthly_scores")
    .select(MONTHLY_SCORE_COLS)
    .eq("factory_id", factoryId)
    .eq("user_id", userId)
    .order("nam", { ascending: false })
    .order("thang", { ascending: false })
  if (error) throw error
  return (data || []) as KpiMonthlyScore[]
}

// Chỉ admin/kpi.manage_config gọi được (RPC tự validate lại server-side, không tin UI).
export async function computeKpiMonthlyScores(factoryId: string, nam: number, thang: number): Promise<number> {
  const { data, error } = await supabase.rpc("kpi_compute_monthly_scores", {
    p_factory_id: factoryId,
    p_nam: nam,
    p_thang: thang,
  })
  if (error) throw error
  return (data as number) || 0
}

// ── C5: tổng hợp chuyên cần từ module Chấm công (RPC kpi_attendance_month_summary) ──
// Nguồn DUY NHẤT số liệu + hệ số chuyên cần — chính hàm SQL mà kpi_compute_monthly_scores dùng.
// RPC trả của chính mình; admin / kpi.view_all / kpi.manage_config được xem mọi người.
export type KpiAttendanceSummary = {
  profile_id: string
  staff_id: string | null
  loai: "nhan_vien" | "cong_nhan" | "khong_ho_so"
  khong_tron: boolean
  tam_tinh: boolean
  so_ngay_lich: number
  so_ngay_da_qua: number
  tua_chuan: number
  cong_chuan: number
  muc_phat: number
  he_so_min: number
  he_so_max: number
  co_mat: number
  co_mat_tu_dong: number
  co_mat_truc_ca: number
  co_mat_cham_tay: number
  phep_thuong_bu: number
  co_phep: number
  khong_phep: number
  nghi_tua: number
  chua_ghi_nhan: number
  khong_xet: string | null
  /** NULL khi tháng làm không trọn (không có điểm KPI). */
  he_so: number | null
  /** B (20261224) — thiếu khi chưa chạy migration. */
  tua_nguon?: KpiTuaSource | null
  tua_ly_do?: string | null
  ngay_chuyen_can?: number | null
}

export async function fetchKpiAttendanceSummary(
  factoryId: string,
  nam: number,
  thang: number,
  profileId?: string,
): Promise<KpiAttendanceSummary[]> {
  const { data, error } = await supabase.rpc("kpi_attendance_month_summary", {
    p_factory_id: factoryId,
    p_nam: nam,
    p_thang: thang,
  })
  if (error) throw error
  const rows = ((data || []) as KpiAttendanceSummary[]).map((r) => ({
    ...r,
    muc_phat: Number(r.muc_phat),
    he_so_min: Number(r.he_so_min),
    he_so_max: Number(r.he_so_max),
    he_so: r.he_so == null ? null : Number(r.he_so),
  }))
  return profileId ? rows.filter((r) => r.profile_id === profileId) : rows
}

// ── Phase 5: Khóa sổ + audit điều chỉnh ─────────────────────────────────────────
// Chỉ admin/kpi.manage_config gọi được. Sau khi khóa, kpi_compute_monthly_scores tự động BỎ QUA
// (không ghi đè) điểm này ở các lần tính lại sau — không có RPC "mở khóa": mọi thay đổi điểm đã
// khóa phải đi qua kpi_monthly_score_adjust (có audit log kpi_score_adjustments), xem
// migration 20260814_kpi_score_lock_adjust_rank.sql.
export async function lockKpiMonthlyScore(monthlyScoreId: string): Promise<void> {
  const { error } = await supabase.rpc("kpi_monthly_score_lock", { p_monthly_score_id: monthlyScoreId })
  if (error) throw error
}

// Mở khoá sổ (migration 20261225): CHỈ admin, lý do bắt buộc, ghi nhật ký kpi_monthly_score_unlocks (bất biến).
// Mở xong "Tính điểm tháng" ghi đè cả điểm đã điều chỉnh (kpi_score_adjustments vẫn giữ lịch sử).
export async function unlockKpiMonthlyScore(monthlyScoreId: string, lyDo: string): Promise<void> {
  const { error } = await supabase.rpc("kpi_monthly_score_unlock", { p_monthly_score_id: monthlyScoreId, p_ly_do: lyDo })
  if (error) throw error
}

export type KpiScoreAdjustment = {
  id: string
  factory_id: string
  monthly_score_id: string
  ly_do: string
  diem_truoc: number | null
  diem_sau: number | null
  nguoi_dieu_chinh_id: string | null
  created_at: string
}

const ADJUSTMENT_COLS = "id, factory_id, monthly_score_id, ly_do, diem_truoc, diem_sau, nguoi_dieu_chinh_id, created_at"

export async function fetchKpiScoreAdjustments(monthlyScoreId: string): Promise<KpiScoreAdjustment[]> {
  const { data, error } = await supabase
    .from("kpi_score_adjustments")
    .select(ADJUSTMENT_COLS)
    .eq("monthly_score_id", monthlyScoreId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data || []) as KpiScoreAdjustment[]
}

// ── Phase 5: Bảng xếp hạng ẩn danh ────────────────────────────────────────────────
// 2 RPC SECURITY DEFINER trả về ĐÚNG {rank, diem_tong, is_me} — không bao giờ trả user_id/tên,
// nên mọi user có kpi.view gọi được (không cần kpi.view_all) mà vẫn giữ tính ẩn danh.
// B (20261224): hoà điểm ⇒ nhiều ngày chuyên cần xếp trên; trả thêm ngay_chuyen_can (vẫn ẩn danh).
export type KpiScoreRankingRow = { rank: number; diem_tong: number; is_me: boolean; ngay_chuyen_can?: number | null }

export async function fetchKpiScoreRankingByGroup(
  factoryId: string,
  nam: number,
  thang: number,
  groupId: string,
): Promise<KpiScoreRankingRow[]> {
  const { data, error } = await supabase.rpc("kpi_score_ranking_by_group", {
    p_factory_id: factoryId,
    p_nam: nam,
    p_thang: thang,
    p_group_id: groupId,
  })
  if (error) throw error
  return (data || []) as KpiScoreRankingRow[]
}

export async function fetchKpiScoreRankingByDepartment(
  factoryId: string,
  nam: number,
  thang: number,
  departmentId: string,
): Promise<KpiScoreRankingRow[]> {
  const { data, error } = await supabase.rpc("kpi_score_ranking_by_department", {
    p_factory_id: factoryId,
    p_nam: nam,
    p_thang: thang,
    p_department_id: departmentId,
  })
  if (error) throw error
  return (data || []) as KpiScoreRankingRow[]
}

// ── B (20261224): Tua chuẩn theo tháng ─────────────────────────────────────────────
// Ghi CHỈ qua 2 RPC (admin | kpi.manage_config, lý do bắt buộc, chặn tháng đã có điểm khoá sổ).
export type KpiAttendanceMonthConfig = {
  id: string
  factory_id: string
  group_id: string | null
  /** YYYY-MM-01 */
  thang: string
  so_ngay_nghi_tua_chuan: number
  ly_do: string
  updated_at: string
}

export type KpiAttendanceMonthConfigLog = {
  id: string
  config_id: string | null
  group_id: string | null
  thang: string
  hanh_dong: "them" | "sua" | "xoa"
  gia_tri_truoc: number | null
  gia_tri_sau: number | null
  ly_do: string
  nguoi_thuc_hien: string | null
  created_at: string
}

export async function fetchKpiAttendanceMonthConfigs(factoryId: string): Promise<KpiAttendanceMonthConfig[]> {
  const { data, error } = await supabase
    .from("kpi_attendance_month_config")
    .select("id, factory_id, group_id, thang, so_ngay_nghi_tua_chuan, ly_do, updated_at")
    .eq("factory_id", factoryId)
    .order("thang", { ascending: false })
  if (error) throw error
  return (data || []) as KpiAttendanceMonthConfig[]
}

export async function fetchKpiAttendanceMonthConfigLogs(factoryId: string): Promise<KpiAttendanceMonthConfigLog[]> {
  const { data, error } = await supabase
    .from("kpi_attendance_month_config_logs")
    .select("id, config_id, group_id, thang, hanh_dong, gia_tri_truoc, gia_tri_sau, ly_do, nguoi_thuc_hien, created_at")
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: false })
    .range(0, 499)
  if (error) throw error
  return (data || []) as KpiAttendanceMonthConfigLog[]
}

/** Tháng (của nhóm; groupId null = cả nhà máy) đã có điểm KPI khoá sổ ⇒ không sửa / xoá được cấu hình. */
export async function isKpiAttendanceMonthLocked(factoryId: string, groupId: string | null, thang: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("kpi_att_month_cfg_locked", {
    p_factory_id: factoryId,
    p_group_id: groupId,
    p_thang: thang,
  })
  if (error) throw error
  return !!data
}

export async function saveKpiAttendanceMonthConfig(input: {
  factoryId: string
  groupId: string | null
  thang: string
  soNgay: number
  lyDo: string
}): Promise<void> {
  const { error } = await supabase.rpc("kpi_attendance_month_config_save", {
    p_factory_id: input.factoryId,
    p_group_id: input.groupId,
    p_thang: input.thang,
    p_so_ngay: input.soNgay,
    p_ly_do: input.lyDo,
  })
  if (error) throw error
}

export async function deleteKpiAttendanceMonthConfig(id: string, lyDo: string): Promise<void> {
  const { error } = await supabase.rpc("kpi_attendance_month_config_delete", { p_id: id, p_ly_do: lyDo })
  if (error) throw error
}
