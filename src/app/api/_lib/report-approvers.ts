// Người ký báo cáo 2 bước (Người lập → Ban giám đốc), dùng chung: báo cáo định mức (norms.report) và báo cáo kho
// theo ngày (inventory.daily_report). SERVER-ONLY (service role). Tách nguyên văn từ /api/norms/approvers (rule 30).
//  - Người lập: tài khoản active có quyền `permission` (cấp tường minh thì chỉ dùng tập đó); luôn có người gọi.
//  - Ban giám đốc: chức vụ chứa "giám đốc" (loại "tổng giám đốc"), ưu tiên NMCB; mặc định người tick "Người ký mặc
//    định" (maintenance_staff.mac_dinh_ky), rồi người có chức vụ đúng "Giám đốc", rồi người đầu.
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import type { IsoActor } from "@/app/api/iso/_lib/iso-actor"

const DEPT_CODE = "NMCB"
type ProfileRow = { id: string; full_name: string | null; username: string | null; role: string | null; department: string | null; department_id: string | null }
type StaffRow = { profile_id: string | null; chuc_vu: string | null; chuc_vu_chinh_quyen: string | null; mac_dinh_ky?: boolean | null }
export type ReportPerson = { id: string; full_name: string; chuc_vu: string }
export type ReportApprovers = { nguoiLap: ReportPerson[]; bgd: ReportPerson[]; bgdFallback: boolean; defaultBgdId: string | null; defaultNguoiLapId: string }

const lower = (t: string | null | undefined) => String(t || "").trim().toLowerCase()
const isDirector = (cv: string) => lower(cv).includes("giám đốc") && !lower(cv).includes("tổng giám đốc")
const isMainDirector = (cv: string) => lower(cv).replace(/\s+nhà\s+máy$/u, "").trim() === "giám đốc"

export async function loadReportApprovers(actor: IsoActor, permission: string): Promise<ReportApprovers> {
  const fid = actor.factoryId
  const [{ data: profiles, error }, { data: deptRow }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, full_name, username, role, department, department_id").eq("factory_id", fid).eq("status", "active"),
    supabaseAdmin.from("departments").select("id, name, code").eq("code", DEPT_CODE).maybeSingle(),
  ])
  if (error) throw new Error(error.message)
  const all = (profiles || []) as ProfileRow[]
  const ids = all.map((p) => p.id)
  const loadStaff = (cols: string) => supabaseAdmin.from("maintenance_staff").select(cols).eq("factory_id", fid).eq("active", true).in("profile_id", ids)
  let staffRes = await loadStaff("profile_id, chuc_vu, chuc_vu_chinh_quyen, mac_dinh_ky")
  if (staffRes.error) staffRes = await loadStaff("profile_id, chuc_vu, chuc_vu_chinh_quyen")
  const staffById = new Map<string, StaffRow>()
  for (const s of (staffRes.data || []) as unknown as StaffRow[]) if (s.profile_id) staffById.set(s.profile_id, s)
  const chucVuOf = (id: string) => {
    const s = staffById.get(id)
    return ((s?.chuc_vu_chinh_quyen || s?.chuc_vu || "") as string).trim()
  }
  const name = (p: ProfileRow) => p.full_name || p.username || ""

  const [{ data: grants }, { data: roleRows }] = await Promise.all([
    supabaseAdmin.from("user_permissions").select("user_id, permission_code").eq("granted", true).in("user_id", ids),
    supabaseAdmin.from("role_permissions").select("role").eq("permission_code", permission),
  ])
  const grantMap = new Map<string, Set<string>>()
  for (const g of (grants || []) as { user_id: string; permission_code: string }[]) {
    const s = grantMap.get(g.user_id) || new Set<string>()
    s.add(g.permission_code)
    grantMap.set(g.user_id, s)
  }
  const roles = new Set(((roleRows || []) as { role: string }[]).map((r) => r.role))
  const canReport = (p: ProfileRow) => p.role === "admin" || (grantMap.has(p.id) ? grantMap.get(p.id)!.has(permission) : !!p.role && roles.has(p.role))
  const nguoiLap: ReportPerson[] = all.filter(canReport).map((p) => ({ id: p.id, full_name: name(p), chuc_vu: chucVuOf(p.id) }))
  if (!nguoiLap.some((p) => p.id === actor.userId)) {
    const me = all.find((p) => p.id === actor.userId)
    if (me) nguoiLap.push({ id: me.id, full_name: name(me), chuc_vu: chucVuOf(me.id) })
  }

  const inNmcb = (p: ProfileRow) => {
    if (deptRow?.id && p.department_id === deptRow.id) return true
    const d = (p.department || "").trim()
    return d.toUpperCase() === DEPT_CODE || (!!deptRow?.name && d.toLowerCase() === String(deptRow.name).toLowerCase())
  }
  const directorOf = (p: ProfileRow): ReportPerson | null => {
    const s = staffById.get(p.id)
    const cv = [s?.chuc_vu_chinh_quyen, s?.chuc_vu].find((v) => v && isDirector(v))
    return cv ? { id: p.id, full_name: name(p), chuc_vu: cv.trim() } : null
  }
  let bgd = all.filter(inNmcb).map(directorOf).filter((x): x is ReportPerson => !!x)
  const fallback = !bgd.length
  if (fallback) bgd = all.map(directorOf).filter((x): x is ReportPerson => !!x)
  const sortVi = (a: ReportPerson, b: ReportPerson) => a.full_name.localeCompare(b.full_name, "vi")
  bgd.sort(sortVi)
  nguoiLap.sort(sortVi)
  const pick = (list: ReportPerson[]) => list.find((a) => !!staffById.get(a.id)?.mac_dinh_ky) || list[0]
  const defaultBgdId = (pick(bgd.filter((a) => isMainDirector(a.chuc_vu))) || pick(bgd))?.id || null
  return { nguoiLap, bgd, bgdFallback: fallback, defaultBgdId, defaultNguoiLapId: actor.userId }
}
