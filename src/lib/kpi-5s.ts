"use client"

// Module KPI — Phase 2: Đánh giá 5S theo vị trí (kpi_5s_locations + kpi_5s_evaluations).
// "Vị trí" (vd PGĐ, PH01 — mỗi dòng có 1 QR riêng để chấm điểm hàng tuần) là tầng NHỎ,
// khác với "Khu vực" (vd Văn phòng, Kho 1, Kho 2 — xem src/lib/kpi-5s-zones.ts) là tầng
// LỚN chứa nhiều vị trí bên trong, chỉ dùng để giới hạn pool "Phân công thông minh".
// Xem đầy đủ .claude/rules/27-kpi-module.md, mục "Database Schema" (5S) + "UI".

import { supabase } from "@/lib/supabase"

export type Kpi5sResult = "dat" | "tuong_doi" | "khong_dat"

export const KPI_5S_RESULT_LABEL: Record<Kpi5sResult, string> = {
  dat: "Đạt",
  tuong_doi: "Tương đối",
  khong_dat: "Không đạt",
}

// Badge dùng chung cho mọi nơi hiển thị kết quả 5S (danh sách vị trí, lịch sử chấm điểm,
// modal sửa kết quả/giải quyết khiếu nại) — tránh hard-code lại 2-3 màu rải rác từng nơi.
export const KPI_5S_RESULT_BADGE_CLASS: Record<Kpi5sResult, string> = {
  dat: "bg-emerald-100 text-emerald-700",
  tuong_doi: "bg-amber-100 text-amber-700",
  khong_dat: "bg-rose-100 text-rose-700",
}

export type Kpi5sLocation = {
  id: string
  factory_id: string
  ma_vi_tri: string
  ten_vi_tri: string
  mo_ta: string | null
  nguoi_don_id: string | null
  nguoi_cham_id: string | null
  // Khu vực (kpi_5s_zones.id, tầng LỚN) — giới hạn pool ứng viên khi "Phân công thông
  // minh" random. NULL = không giới hạn (pool toàn nhà máy). Không ảnh hưởng chọn tay.
  zone_id: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type Kpi5sEvaluation = {
  id: string
  factory_id: string
  location_id: string
  tuan_bat_dau: string
  nguoi_don_id: string
  nguoi_cham_id: string
  ket_qua: Kpi5sResult
  ly_do: string | null
  image_urls: string[]
  danh_gia_luc: string
  created_at: string
}

const LOCATION_COLS =
  "id, factory_id, ma_vi_tri, ten_vi_tri, mo_ta, nguoi_don_id, nguoi_cham_id, zone_id, is_active, sort_order, created_at, updated_at"
const EVAL_COLS =
  "id, factory_id, location_id, tuan_bat_dau, nguoi_don_id, nguoi_cham_id, ket_qua, ly_do, image_urls, danh_gia_luc, created_at"

// Supabase JS ném lỗi dạng plain object { message, code... }, không phải instance Error —
// mirror getKpiErrorMessage (kpi-tasks.ts) để dùng riêng cho lib này, tránh vòng import chéo.
export function getKpi5sErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg) return msg
  }
  return fallback
}

export async function fetchKpi5sLocations(factoryId: string, opts?: { includeInactive?: boolean }): Promise<Kpi5sLocation[]> {
  let q = supabase.from("kpi_5s_locations").select(LOCATION_COLS).eq("factory_id", factoryId)
  if (!opts?.includeInactive) q = q.eq("is_active", true)
  const { data, error } = await q.order("sort_order", { ascending: true }).order("ma_vi_tri", { ascending: true })
  if (error) throw error
  return (data || []) as Kpi5sLocation[]
}

export async function fetchKpi5sLocation(locationId: string): Promise<Kpi5sLocation | null> {
  const { data, error } = await supabase.from("kpi_5s_locations").select(LOCATION_COLS).eq("id", locationId).maybeSingle()
  if (error) throw error
  return (data as Kpi5sLocation | null) || null
}

export type Kpi5sLocationInput = {
  factory_id: string
  ma_vi_tri: string
  ten_vi_tri: string
  mo_ta: string | null
  nguoi_don_id: string | null
  nguoi_cham_id: string | null
  zone_id: string | null
  is_active: boolean
  sort_order: number
}

export async function createKpi5sLocation(input: Kpi5sLocationInput): Promise<string> {
  const { data, error } = await supabase.from("kpi_5s_locations").insert(input).select("id").single()
  if (error) throw error
  return data.id as string
}

export async function updateKpi5sLocation(id: string, input: Partial<Kpi5sLocationInput>): Promise<void> {
  const { error } = await supabase.from("kpi_5s_locations").update(input).eq("id", id)
  if (error) throw error
}

export async function deleteKpi5sLocation(id: string): Promise<void> {
  const { error } = await supabase.from("kpi_5s_locations").delete().eq("id", id)
  if (error) throw error
}

export async function fetchKpi5sEvaluations(locationId: string): Promise<Kpi5sEvaluation[]> {
  const { data, error } = await supabase
    .from("kpi_5s_evaluations")
    .select(EVAL_COLS)
    .eq("location_id", locationId)
    .order("tuan_bat_dau", { ascending: false })
  if (error) throw error
  return (data || []) as Kpi5sEvaluation[]
}

// Tuần hiện tại (Thứ Hai) đã có bản chấm chưa — quyết định có hiện nút "Chấm điểm tuần này".
export async function fetchKpi5sEvaluationForWeek(locationId: string, weekStartISO: string): Promise<Kpi5sEvaluation | null> {
  const { data, error } = await supabase
    .from("kpi_5s_evaluations")
    .select(EVAL_COLS)
    .eq("location_id", locationId)
    .eq("tuan_bat_dau", weekStartISO)
    .maybeSingle()
  if (error) throw error
  return (data as Kpi5sEvaluation | null) || null
}

// Kết quả tuần gần nhất của mỗi vị trí (dùng cho card danh sách) — 1 query duy nhất, không
// N+1 theo từng vị trí.
export async function fetchLatestKpi5sEvaluationsByLocationIds(locationIds: string[]): Promise<Map<string, Kpi5sEvaluation>> {
  const map = new Map<string, Kpi5sEvaluation>()
  if (locationIds.length === 0) return map
  const { data, error } = await supabase
    .from("kpi_5s_evaluations")
    .select(EVAL_COLS)
    .in("location_id", locationIds)
    .order("tuan_bat_dau", { ascending: false })
  if (error) throw error
  for (const row of (data || []) as Kpi5sEvaluation[]) {
    if (!map.has(row.location_id)) map.set(row.location_id, row)
  }
  return map
}

export type Kpi5sEvaluationInput = {
  factory_id: string
  location_id: string
  tuan_bat_dau: string
  nguoi_don_id: string
  nguoi_cham_id: string
  ket_qua: Kpi5sResult
  ly_do: string | null
  image_urls: string[]
}

export async function submitKpi5sEvaluation(input: Kpi5sEvaluationInput): Promise<void> {
  const { error } = await supabase.from("kpi_5s_evaluations").insert(input)
  if (error) throw error
}

export function buildKpi5sLocationUrl(locationId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const path = `/dashboard/kpi/5s/location/${locationId}`
  return origin ? `${origin}${path}` : path
}

export async function uploadKpi5sEvaluationImage(factoryId: string, locationId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg"
  const path = `${factoryId}/kpi/5s/${locationId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from("order-files").upload(path, file, { upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from("order-files").getPublicUrl(path)
  return data.publicUrl
}
