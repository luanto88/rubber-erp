"use client"

// Module KPI — "Khu vực" (tầng LỚN, vd Văn phòng, Kho 1, Kho 2, Ca SX mủ tạp, Ca SX mủ
// nước) — chứa nhiều "Vị trí" (kpi_5s_locations, tầng NHỎ, xem src/lib/kpi-5s.ts) bên
// trong. Chỉ dùng để giới hạn pool ứng viên khi "Phân công thông minh" random CHỈ trong
// nội bộ 1 khu vực — hoàn toàn tách biệt khỏi `personnel_groups` (nhóm CHUYÊN MÔN dùng
// cho hệ số điểm KPI, một khái niệm khác không liên quan). Xem đầy đủ
// .claude/rules/27-kpi-module.md.

import { supabase } from "@/lib/supabase"

export type Kpi5sZone = {
  id: string
  factory_id: string
  ten: string
  // Phòng ban gắn với khu vực này — quyết định lãnh đạo phòng ban nào (ngoài admin/
  // kpi.manage_config) được quản lý khu vực + giới hạn ứng viên "Quản lý thành viên".
  phong_ban_id: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

const ZONE_COLS = "id, factory_id, ten, phong_ban_id, is_active, sort_order, created_at, updated_at"

export async function fetchKpi5sZones(factoryId: string, opts?: { includeInactive?: boolean }): Promise<Kpi5sZone[]> {
  let q = supabase.from("kpi_5s_zones").select(ZONE_COLS).eq("factory_id", factoryId)
  if (!opts?.includeInactive) q = q.eq("is_active", true)
  const { data, error } = await q.order("sort_order", { ascending: true }).order("ten", { ascending: true })
  if (error) throw error
  return (data || []) as Kpi5sZone[]
}

export type Kpi5sZoneInput = {
  factory_id: string
  ten: string
  phong_ban_id: string | null
  is_active: boolean
  sort_order: number
}

export async function createKpi5sZone(input: Kpi5sZoneInput): Promise<string> {
  const { data, error } = await supabase.from("kpi_5s_zones").insert(input).select("id").single()
  if (error) throw error
  return data.id as string
}

export async function updateKpi5sZone(id: string, input: Partial<Kpi5sZoneInput>): Promise<void> {
  const { error } = await supabase.from("kpi_5s_zones").update(input).eq("id", id)
  if (error) throw error
}

export async function deleteKpi5sZone(id: string): Promise<void> {
  const { error } = await supabase.from("kpi_5s_zones").delete().eq("id", id)
  if (error) throw error
}

export type Kpi5sZoneMember = {
  id: string
  factory_id: string
  zone_id: string
  user_id: string
  created_at: string
}

// Toàn bộ thành viên của mọi khu vực trong nhà máy, gộp theo zone_id — dùng cho cả UI
// "Quản lý thành viên" lẫn thuật toán Phân công thông minh (kpi-5s-auto-assign.ts), tránh
// N+1 query theo từng khu vực.
export async function fetchAllZoneMemberships(factoryId: string): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("kpi_5s_zone_members")
    .select("zone_id, user_id")
    .eq("factory_id", factoryId)
  if (error) throw error
  const map = new Map<string, string[]>()
  for (const row of (data || []) as Pick<Kpi5sZoneMember, "zone_id" | "user_id">[]) {
    map.set(row.zone_id, [...(map.get(row.zone_id) || []), row.user_id])
  }
  return map
}

export async function addKpi5sZoneMember(factoryId: string, zoneId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("kpi_5s_zone_members").insert({ factory_id: factoryId, zone_id: zoneId, user_id: userId })
  if (error) throw error
}

export async function removeKpi5sZoneMember(zoneId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("kpi_5s_zone_members").delete().eq("zone_id", zoneId).eq("user_id", userId)
  if (error) throw error
}
