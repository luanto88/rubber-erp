"use client"

// Module KPI — "Chi tiết cách tính điểm" (sub-tab của Bảng điểm KPI, /dashboard/kpi/scores).
// Thuần query READ-ONLY, không có RPC/action ghi nào — tính lại real-time từ dữ liệu hiện tại để
// giải thích minh bạch điểm A/B/C/D + hệ số chuyên cần của CHÍNH người xem, khác với
// `kpi_monthly_scores.chi_tiet` (chỉ lưu số tổng hợp, không đủ chi tiết từng bản ghi). Mọi query ở
// đây user luôn tự đọc được cho chính mình qua RLS hiện có (kpi_task_members/kpi_tasks cho active
// member, kpi_5s_evaluations/kpi_daily_evaluations SELECT rộng trong factory,
// personnel_group_members/maintenance_staff mirror đúng loadPrimaryGroup ở kpi/tasks/page.tsx).
//
// Công thức tham chiếu (KHÔNG đổi so với RPC kpi_compute_monthly_scores,
// supabase/migrations/20260813_kpi_score_weights_monthly_scores.sql, đã renormalize theo
// supabase/migrations/20260825_kpi_score_renormalize.sql):
//   A = AVG(tien_do_nghiem_thu ?? tien_do) theo task is_active=true, ngay_giao trong tháng
//   B = tỷ lệ da_nop_luc <= han_hoan_thanh trong số task ĐÃ ĐẾN HẠN (han_hoan_thanh <= cutoff)
//   C = AVG(dat=100/tuong_doi=50/khong_dat=0) theo kpi_5s_evaluations.nguoi_don_id, tuan_bat_dau
//       trong tháng
//   D = trung bình (Điểm ngày ÷ Max ngày × 100) qua các ngày CÓ loai='chinh'; Điểm ngày =
//       %chính×10 + Σ(%choàng_i×5); Max ngày = 10 + 5×số nhóm choàng có chấm ngày đó
//   Thành phần nào KHÔNG có dữ liệu trong tháng (0 việc/0 việc đến hạn/0 lần chấm 5S/0 ngày chấm
//   D) không còn mặc định = 100 — bị loại khỏi công thức, các thành phần còn lại được
//   RENORMALIZE theo đúng tỷ trọng tương ứng (chia cho tổng trọng số của các thành phần CÒN LẠI,
//   không phải chia cho 100). Nếu CẢ 4 thành phần đều thiếu dữ liệu, tháng đó không có điểm nào.
//   Xem .claude/rules/27-kpi-module.md mục "Công thức tính điểm" (đầu file) để biết đầy đủ.

import { supabase } from "@/lib/supabase"
import { computeDailyPercent, type KpiDailyResult } from "@/lib/kpi-daily-evaluations"

export type MyPrimaryGroup = { id: string; name: string } | null

type PrimaryGroupRow = {
  group_id: string
  personnel_groups: Array<{ name: string | null }> | null
}

// Mirror đúng query loadPrimaryGroup trong kpi/tasks/page.tsx — mọi user tự đọc được của chính
// mình (maintenance_staff.profile_id = chính họ).
export async function fetchMyPrimaryGroup(factoryId: string, userId: string): Promise<MyPrimaryGroup> {
  const { data } = await supabase
    .from("personnel_group_members")
    .select("group_id, personnel_groups(name), maintenance_staff!inner(profile_id)")
    .eq("factory_id", factoryId)
    .eq("is_primary", true)
    .eq("maintenance_staff.profile_id", userId)
    .maybeSingle()
  const row = data as PrimaryGroupRow | null
  if (!row) return null
  const name = row.personnel_groups?.[0]?.name?.trim()
  if (!name) return null
  return { id: row.group_id, name }
}

export type BreakdownTask = {
  task_id: string
  tieu_de: string
  ngay_giao: string
  han_hoan_thanh: string
  trang_thai: string
  tien_do: number
  tien_do_nghiem_thu: number | null
  da_nop_luc: string | null
}

function monthRange(nam: number, thang: number): { from: string; to: string } {
  const from = `${nam}-${String(thang).padStart(2, "0")}-01`
  const lastDay = new Date(nam, thang, 0).getDate()
  const to = `${nam}-${String(thang).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  return { from, to }
}

export async function fetchScoreBreakdownTasks(
  factoryId: string,
  userId: string,
  nam: number,
  thang: number,
): Promise<BreakdownTask[]> {
  const { from, to } = monthRange(nam, thang)
  const { data, error } = await supabase
    .from("kpi_task_members")
    .select("task_id, tien_do, tien_do_nghiem_thu, da_nop_luc, kpi_tasks!inner(id, tieu_de, ngay_giao, han_hoan_thanh, trang_thai, factory_id)")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("kpi_tasks.factory_id", factoryId)
    .gte("kpi_tasks.ngay_giao", from)
    .lte("kpi_tasks.ngay_giao", to)
  if (error) throw error
  type Row = {
    task_id: string
    tien_do: number
    tien_do_nghiem_thu: number | null
    da_nop_luc: string | null
    kpi_tasks: { id: string; tieu_de: string; ngay_giao: string; han_hoan_thanh: string; trang_thai: string } | Array<{ id: string; tieu_de: string; ngay_giao: string; han_hoan_thanh: string; trang_thai: string }>
  }
  return ((data || []) as Row[]).map((r) => {
    const t = Array.isArray(r.kpi_tasks) ? r.kpi_tasks[0] : r.kpi_tasks
    return {
      task_id: r.task_id,
      tieu_de: t?.tieu_de || "—",
      ngay_giao: t?.ngay_giao || "",
      han_hoan_thanh: t?.han_hoan_thanh || "",
      trang_thai: t?.trang_thai || "",
      tien_do: r.tien_do,
      tien_do_nghiem_thu: r.tien_do_nghiem_thu,
      da_nop_luc: r.da_nop_luc,
    }
  })
}

export type Breakdown5s = {
  id: string
  location_id: string
  vi_tri_ten: string
  tuan_bat_dau: string
  ket_qua: "dat" | "tuong_doi" | "khong_dat"
}

export async function fetchScoreBreakdown5s(
  factoryId: string,
  userId: string,
  nam: number,
  thang: number,
): Promise<Breakdown5s[]> {
  const { from, to } = monthRange(nam, thang)
  const { data, error } = await supabase
    .from("kpi_5s_evaluations")
    .select("id, location_id, tuan_bat_dau, ket_qua, kpi_5s_locations(ten_vi_tri)")
    .eq("factory_id", factoryId)
    .eq("nguoi_don_id", userId)
    .gte("tuan_bat_dau", from)
    .lte("tuan_bat_dau", to)
    .order("tuan_bat_dau", { ascending: true })
  if (error) throw error
  type Row = {
    id: string
    location_id: string
    tuan_bat_dau: string
    ket_qua: "dat" | "tuong_doi" | "khong_dat"
    kpi_5s_locations: { ten_vi_tri: string | null } | Array<{ ten_vi_tri: string | null }> | null
  }
  return ((data || []) as Row[]).map((r) => {
    const loc = Array.isArray(r.kpi_5s_locations) ? r.kpi_5s_locations[0] : r.kpi_5s_locations
    return { id: r.id, location_id: r.location_id, vi_tri_ten: loc?.ten_vi_tri || "—", tuan_bat_dau: r.tuan_bat_dau, ket_qua: r.ket_qua }
  })
}

export type BreakdownDailyEvaluation = {
  id: string
  ngay: string
  group_id: string
  group_ten: string
  loai: "chinh" | "choang"
  pct: number
}

// Cutoff cho B ("đã đến hạn"): LEAST(now, cuối tháng + 1 ngày) — mirror đúng RPC. Dùng mốc UTC
// (Date.UTC) thay vì local time vì han_hoan_thanh là TIMESTAMPTZ so sánh trong Postgres (mặc định
// UTC trên Supabase) — chấp nhận sai lệch nhỏ ở biên múi giờ Campuchia, cùng hạn chế đã ghi nhận
// ở các nơi khác trong module (vd getTodayISODate()).
export function computeCutoffMs(nam: number, thang: number): number {
  const monthEndPlus1Utc = Date.UTC(nam, thang, 1) // thang là 1-indexed nên Date.UTC(nam, thang, 1) = ngày 1 của tháng kế tiếp
  return Math.min(Date.now(), monthEndPlus1Utc)
}

export type DayScore = {
  ngay: string
  chinhPct: number | null
  choangEntries: { group_ten: string; pct: number }[]
  diemNgay: number
  maxNgay: number
  pctNgay: number
}

// Nhóm kpi_daily_evaluations theo ngày, chỉ giữ lại các ngày CÓ loai='chinh' (đúng "ngày có mặt/có
// chấm" — mirror RPC). Điểm ngày = %chính×10 + Σ(%choàng_i×5); Max ngày = 10 + 5×số choàng.
export function groupDailyByDay(rows: BreakdownDailyEvaluation[]): DayScore[] {
  const byDay = new Map<string, BreakdownDailyEvaluation[]>()
  for (const r of rows) {
    if (!byDay.has(r.ngay)) byDay.set(r.ngay, [])
    byDay.get(r.ngay)!.push(r)
  }
  const result: DayScore[] = []
  for (const [ngay, entries] of byDay) {
    const chinh = entries.find((e) => e.loai === "chinh")
    if (!chinh) continue // ngày chỉ có choàng, không có chính → không tính vào D (đúng công thức)
    const choangEntries = entries.filter((e) => e.loai === "choang").map((e) => ({ group_ten: e.group_ten, pct: e.pct }))
    const diemNgay = chinh.pct * 10 + choangEntries.reduce((s, c) => s + c.pct * 5, 0)
    const maxNgay = 10 + choangEntries.length * 5
    result.push({ ngay, chinhPct: chinh.pct, choangEntries, diemNgay, maxNgay, pctNgay: (diemNgay / maxNgay) * 100 })
  }
  return result.sort((a, b) => (a.ngay < b.ngay ? -1 : 1))
}

export async function fetchScoreBreakdownDaily(
  factoryId: string,
  userId: string,
  nam: number,
  thang: number,
): Promise<BreakdownDailyEvaluation[]> {
  const { from, to } = monthRange(nam, thang)
  const { data, error } = await supabase
    .from("kpi_daily_evaluations")
    .select("id, ngay, group_id, loai, personnel_groups(name), kpi_daily_evaluation_items(ket_qua)")
    .eq("factory_id", factoryId)
    .eq("user_id", userId)
    .gte("ngay", from)
    .lte("ngay", to)
    .order("ngay", { ascending: true })
  if (error) throw error
  type Row = {
    id: string
    ngay: string
    group_id: string
    loai: "chinh" | "choang"
    personnel_groups: { name: string | null } | Array<{ name: string | null }> | null
    kpi_daily_evaluation_items: Array<{ ket_qua: KpiDailyResult }> | null
  }
  return ((data || []) as Row[]).map((r) => {
    const g = Array.isArray(r.personnel_groups) ? r.personnel_groups[0] : r.personnel_groups
    return {
      id: r.id,
      ngay: r.ngay,
      group_id: r.group_id,
      group_ten: g?.name || "—",
      loai: r.loai,
      pct: computeDailyPercent(r.kpi_daily_evaluation_items || []),
    }
  })
}
