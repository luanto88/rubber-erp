"use client"

// Module KPI — Phase 2: Đánh giá 5S theo vị trí (kpi_5s_locations + kpi_5s_evaluations).
// "Vị trí" (vd PGĐ, PH01 — mỗi dòng có 1 QR riêng để chấm điểm hàng tuần) là tầng NHỎ,
// khác với "Khu vực" (vd Văn phòng, Kho 1, Kho 2 — xem src/lib/kpi-5s-zones.ts) là tầng
// LỚN chứa nhiều vị trí bên trong, chỉ dùng để giới hạn pool "Phân công thông minh".
// Xem đầy đủ .claude/rules/27-kpi-module.md, mục "Database Schema" (5S) + "UI".

import { supabase } from "@/lib/supabase"
import { addDaysISO } from "@/lib/date-utils"

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
  // LEGACY — không còn được form ghi trực tiếp (nguồn thật là kpi_5s_location_cleaners), chỉ
  // giữ làm fallback hiển thị/cho "Phân công thông minh". Xem getEffectiveCleanerIds().
  nguoi_don_id: string | null
  nguoi_cham_id: string | null
  // Khu vực (kpi_5s_zones.id, tầng LỚN) — giới hạn pool ứng viên khi "Phân công thông
  // minh" random. NULL = không giới hạn (pool toàn nhà máy). Không ảnh hưởng chọn tay.
  zone_id: string | null
  // Phòng ban chịu trách nhiệm — quyết định lãnh đạo phòng ban nào (ngoài admin/kpi.manage_config)
  // được quản lý vị trí này + giới hạn phạm vi hiển thị ở danh sách (xem migration
  // 20260807_kpi_department_scoping.sql).
  phong_ban_id: string | null
  // "Người giao" — ai đã cấu hình/gán vị trí này lần gần nhất.
  assigned_by: string | null
  assigned_at: string | null
  // Hạn chấm điểm hàng tuần, tuỳ chọn (opt-in) — 1=Thứ 2..7=CN. UI form chỉ cho chọn ĐÚNG 1 phần
  // tử (radio-behavior), nhưng cột là mảng để tương thích với cadence khác nếu cần mở rộng sau
  // này. NULL = không giới hạn, chấm bất kỳ ngày nào trong tuần (hành vi mặc định/cũ).
  deadline_weekdays: number[] | null
  deadline_time: string | null
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
  "id, factory_id, ma_vi_tri, ten_vi_tri, mo_ta, nguoi_don_id, nguoi_cham_id, zone_id, phong_ban_id, assigned_by, assigned_at, deadline_weekdays, deadline_time, is_active, sort_order, created_at, updated_at"
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
  nguoi_cham_id: string | null
  zone_id: string | null
  phong_ban_id: string | null
  deadline_weekdays: number[] | null
  deadline_time: string | null
  is_active: boolean
  sort_order: number
}

// "Người dọn hiện tại" giờ ghi thẳng vào kpi_5s_location_cleaners (multi-select trong CHÍNH form
// Thêm/Sửa vị trí — không còn nút "Quản lý đội ngũ dọn dẹp" riêng) — createKpi5sLocation/
// updateKpi5sLocation nhận thêm `cleanerUserIds` để đồng bộ 2 bảng trong cùng 1 lượt lưu.
// Cột `nguoi_don_id` KHÔNG còn được 2 hàm này ghi (để trống/giữ nguyên) — chỉ "Phân công thông
// minh" (kpi-5s-auto-assign) còn ghi trực tiếp cột này làm fallback lịch sử.
export async function createKpi5sLocation(input: Kpi5sLocationInput, cleanerUserIds: string[], assignedBy: string): Promise<string> {
  const { data, error } = await supabase
    .from("kpi_5s_locations")
    .insert({ ...input, assigned_by: assignedBy, assigned_at: new Date().toISOString() })
    .select("id")
    .single()
  if (error) throw error
  const id = data.id as string
  if (cleanerUserIds.length > 0) {
    const { error: cleanerErr } = await supabase
      .from("kpi_5s_location_cleaners")
      .insert(cleanerUserIds.map((uid) => ({ factory_id: input.factory_id, location_id: id, user_id: uid })))
    if (cleanerErr) throw cleanerErr
  }
  return id
}

export async function updateKpi5sLocation(
  id: string,
  input: Partial<Kpi5sLocationInput>,
  cleanerUserIds: string[],
  assignedBy: string,
): Promise<void> {
  // Thứ tự bắt buộc: xoá cleaner CŨ trước khi đổi nguoi_cham_id — trigger
  // trg_kpi_5s_locations_scorer_not_cleaner kiểm tra nguoi_cham_id mới đối chiếu với cleaner
  // set HIỆN TẠI trong DB tại thời điểm UPDATE; nếu người sắp thành "chấm" trước đó đang là
  // 1 trong các "người dọn" cũ, đổi thứ tự (update trước, xoá sau) sẽ bị trigger chặn nhầm.
  const { error: delErr } = await supabase.from("kpi_5s_location_cleaners").delete().eq("location_id", id)
  if (delErr) throw delErr
  const { error } = await supabase
    .from("kpi_5s_locations")
    .update({ ...input, assigned_by: assignedBy, assigned_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
  if (cleanerUserIds.length > 0 && input.factory_id) {
    const { error: insErr } = await supabase
      .from("kpi_5s_location_cleaners")
      .insert(cleanerUserIds.map((uid) => ({ factory_id: input.factory_id as string, location_id: id, user_id: uid })))
    if (insErr) throw insErr
  }
}

// Sửa nhanh 1 vài cột đơn giản (vd "Tạm ngưng"/"Kích hoạt lại", hoặc cột LEGACY nguoi_don_id/
// nguoi_cham_id do "Phân công thông minh" ghi — xem ghi chú TODO trong kpi-5s-auto-assign-modal.tsx
// về việc chưa đồng bộ công cụ đó với kpi_5s_location_cleaners) KHÔNG động tới đội ngũ dọn dẹp hay
// "Người giao" — tách riêng khỏi updateKpi5sLocation (dùng cho form Sửa đầy đủ) để không vô tình
// ghi đè assigned_by/assigned_at hay xoá sạch cleaner set hiện có.
export async function patchKpi5sLocation(
  id: string,
  patch: Partial<Pick<Kpi5sLocationInput, "is_active">> & { nguoi_don_id?: string | null; nguoi_cham_id?: string | null },
): Promise<void> {
  const { error } = await supabase.from("kpi_5s_locations").update(patch).eq("id", id)
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

// Hạn chấm điểm của TUẦN ĐANG XÉT, suy từ deadline_weekdays[0] + deadline_time — null nếu vị trí
// chưa cấu hình hạn. weekStartISO PHẢI là kết quả của getIsoWeekStart() (luôn = Thứ Hai).
export function computeKpi5sDeadline(
  location: Pick<Kpi5sLocation, "deadline_weekdays" | "deadline_time">,
  weekStartISO: string,
): Date | null {
  if (!location.deadline_weekdays?.length || !location.deadline_time) return null
  const weekday = location.deadline_weekdays[0] // UI form hiện chỉ cho chọn đúng 1 phần tử
  const dateISO = addDaysISO(weekStartISO, weekday - 1) // 1=Thứ 2 (weekStartISO chính nó) .. 7=CN
  const d = new Date(`${dateISO}T${location.deadline_time}`)
  return Number.isNaN(d.getTime()) ? null : d
}

// Chỉ quá hạn khi tuần này CHƯA có bản chấm — đã chấm xong thì không còn "quá hạn" nữa dù qua
// mốc giờ. Tính client-side thuần túy tại thời điểm render, không lưu TIMESTAMPTZ nào vào DB.
export function isKpi5sDeadlineOverdue(deadline: Date | null, hasEvaluatedThisWeek: boolean, nowMs = Date.now()): boolean {
  if (!deadline || hasEvaluatedThisWeek) return false
  return deadline.getTime() < nowMs
}

// Mirror KPI_DUE_SOON_HOURS = 24 (kpi-tasks.ts) — sắp đến hạn trong vòng 24 giờ tới.
export function isKpi5sDeadlineDueSoon(deadline: Date | null, hasEvaluatedThisWeek: boolean, nowMs = Date.now()): boolean {
  if (!deadline || hasEvaluatedThisWeek) return false
  const t = deadline.getTime()
  return t >= nowMs && t <= nowMs + 24 * 3600_000
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
  const path = `${factoryId}/kpi/5s/${locationId}/evaluations/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from("order-files").upload(path, file, { upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from("order-files").getPublicUrl(path)
  return data.publicUrl
}

// ── Đội ngũ dọn dẹp nhiều người/1 vị trí (kpi_5s_location_cleaners) ─────────────────────────
// Thay thế mô hình "chỉ 1 nguoi_don_id" khi vị trí quá rộng cần nhiều người phụ trách — cột
// `nguoi_don_id` cũ vẫn giữ nguyên (dùng cho "Phân công thông minh" và làm fallback hiển thị cho
// vị trí chưa được gán multi), nhưng nguồn xác định "ai chịu trách nhiệm dọn vị trí này" giờ là
// bảng này. Xem migration 20260806_kpi_management_upgrades.sql.
export type Kpi5sLocationCleaner = { id: string; factory_id: string; location_id: string; user_id: string; created_at: string }

export async function fetchAllLocationCleanerMemberships(factoryId: string): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("kpi_5s_location_cleaners")
    .select("location_id, user_id")
    .eq("factory_id", factoryId)
  if (error) throw error
  const map = new Map<string, string[]>()
  for (const row of (data || []) as Pick<Kpi5sLocationCleaner, "location_id" | "user_id">[]) {
    map.set(row.location_id, [...(map.get(row.location_id) || []), row.user_id])
  }
  return map
}

export async function fetchLocationCleaners(locationId: string): Promise<string[]> {
  const { data, error } = await supabase.from("kpi_5s_location_cleaners").select("user_id").eq("location_id", locationId)
  if (error) throw error
  return (data || []).map((r: { user_id: string }) => r.user_id)
}

export async function addKpi5sLocationCleaner(factoryId: string, locationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("kpi_5s_location_cleaners")
    .insert({ factory_id: factoryId, location_id: locationId, user_id: userId })
  if (error) throw error
}

export async function removeKpi5sLocationCleaner(locationId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("kpi_5s_location_cleaners").delete().eq("location_id", locationId).eq("user_id", userId)
  if (error) throw error
}

/** Đội ngũ dọn dẹp thực tế của 1 vị trí — ưu tiên bảng multi-select mới, fallback về
 *  `nguoi_don_id` đơn (cột cũ) nếu vị trí đó chưa từng được gán qua bảng mới. Dùng để giới hạn
 *  dropdown "Người chịu trách nhiệm dọn tuần này" khi chấm điểm và để xác định ai được tự báo
 *  cáo — không bao giờ trả về danh sách rỗng nếu vị trí có ít nhất 1 người được gán bằng cách
 *  nào đó (cũ hoặc mới). */
export function getEffectiveCleanerIds(location: Pick<Kpi5sLocation, "id" | "nguoi_don_id">, cleanerMap: Map<string, string[]>): string[] {
  const ids = cleanerMap.get(location.id) || []
  if (ids.length > 0) return ids
  return location.nguoi_don_id ? [location.nguoi_don_id] : []
}

