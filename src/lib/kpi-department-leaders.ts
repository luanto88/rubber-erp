"use client"

// Module KPI & 5S — thay thế "Quản lý theo phòng ban" (kpi_department_managers, cấu hình tay đã
// bị huỷ). Thay vì admin tự chọn tay "ai là Giám đốc/Phó giám đốc", hệ thống tự phát hiện "lãnh
// đạo" bằng cách đọc đúng chuc_vu/chuc_vu_chinh_quyen trong maintenance_staff — EXACT MATCH
// (không phải substring như dept-leader của module Văn bản, xem src/app/api/documents/dept-leader
// /route.ts) để tách đúng "Giám đốc/Phó giám đốc" (nhà máy) khỏi "Tổng giám đốc/Phó tổng giám
// đốc" (công ty) — cả 2 nhóm đều là lãnh đạo hợp lệ nhưng không được lẫn vào nhau.
//
// `resolveMyLeaderDepartmentId` chỉ tra ĐÚNG hồ sơ của chính user gọi (không quét toàn nhà máy)
// — rẻ và an toàn với RLS `profiles` (chỉ cho đọc own row hoặc admin). Một người là "lãnh đạo của
// phòng X" khi và chỉ khi họ THUỘC phòng X và giữ đúng 1 trong 6 chức danh dưới đây.
//
// Xem đầy đủ .claude/rules/27-kpi-module.md, mục "Phase B".

import { supabase } from "@/lib/supabase"
import { hasPermission, type SessionUser } from "@/lib/auth"

export type DepartmentOption = { id: string; code: string; name: string }

// `departments` không có factory_id — danh mục dùng chung toàn hệ thống, đọc được bởi mọi
// authenticated user (xem .claude/rules/04-settings-master-data.md mục 4.8).
export async function fetchDepartmentOptions(): Promise<DepartmentOption[]> {
  const { data, error } = await supabase.from("departments").select("id, code, name").order("code")
  if (error) throw error
  return (data || []) as DepartmentOption[]
}

const LEADER_TITLES = new Set([
  "giám đốc",
  "phó giám đốc",
  "trưởng phòng",
  "phó phòng",
  "tổng giám đốc",
  "phó tổng giám đốc",
])

function isLeaderTitle(text: string | null | undefined): boolean {
  if (!text) return false
  return LEADER_TITLES.has(text.trim().toLowerCase())
}

type OwnProfileRow = { department_id: string | null; department: string | null }
type OwnStaffRow = { chuc_vu: string | null; chuc_vu_chinh_quyen: string | null }

/** Phòng ban mà CHÍNH user này là lãnh đạo (Giám đốc/Phó giám đốc/Trưởng phòng/Phó phòng/Tổng
 *  giám đốc/Phó tổng giám đốc), hoặc `null` nếu không phải lãnh đạo phòng ban nào. */
export async function resolveMyLeaderDepartmentId(userId: string, factoryId: string): Promise<string | null> {
  const [{ data: profileRow }, { data: staffRow }] = await Promise.all([
    supabase.from("profiles").select("department_id, department").eq("id", userId).maybeSingle(),
    supabase
      .from("maintenance_staff")
      .select("chuc_vu, chuc_vu_chinh_quyen")
      .eq("factory_id", factoryId)
      .eq("profile_id", userId)
      .eq("active", true)
      .maybeSingle(),
  ])
  const profile = profileRow as OwnProfileRow | null
  const staff = staffRow as OwnStaffRow | null
  if (!profile || !staff) return null
  if (!isLeaderTitle(staff.chuc_vu_chinh_quyen) && !isLeaderTitle(staff.chuc_vu)) return null

  if (profile.department_id) return profile.department_id
  if (!profile.department) return null
  const { data: deptRow } = await supabase
    .from("departments")
    .select("id")
    .or(`name.eq.${profile.department},code.ilike.${profile.department}`)
    .maybeSingle()
  return (deptRow as { id: string } | null)?.id || null
}

/** Tab "Việc định kỳ" chỉ dành cho admin / kpi.manage_config / lãnh đạo phòng ban (bất kỳ phòng
 *  ban nào) — người dùng thường (chỉ kpi.view) không cần thấy tab quản trị này. */
export async function canSeeKpiTemplatesTab(user: SessionUser | null, factoryId: string | null): Promise<boolean> {
  if (!user || !factoryId) return false
  if (user.role === "admin" || hasPermission(user, "kpi.manage_config")) return true
  const leaderDeptId = await resolveMyLeaderDepartmentId(user.id, factoryId)
  return leaderDeptId != null
}
