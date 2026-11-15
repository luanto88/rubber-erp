import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"

export const dynamic = "force-dynamic"

// GET — người ký báo cáo định mức (rule 30, GĐ4):
//  - Người lập: tài khoản active có quyền norms.report (mặc định chính người gọi).
//  - Ban giám đốc: chức vụ chứa "giám đốc" (loại "tổng giám đốc"), ưu tiên NMCB; mặc định Giám đốc tick
//    "Người ký mặc định" (maintenance_staff.mac_dinh_ky), rồi người có chức vụ đúng "Giám đốc", rồi người đầu.
// Mirror logic chọn Giám đốc của /api/purchase/approvers (không sửa route đó).

const DEPT_CODE = "NMCB"
type ProfileRow = { id: string; full_name: string | null; username: string | null; role: string | null; department: string | null; department_id: string | null }
type StaffRow = { profile_id: string | null; chuc_vu: string | null; chuc_vu_chinh_quyen: string | null; mac_dinh_ky?: boolean | null }
type Person = { id: string; full_name: string; chuc_vu: string }

const lower = (t: string | null | undefined) => String(t || "").trim().toLowerCase()
const isDirector = (cv: string) => lower(cv).includes("giám đốc") && !lower(cv).includes("tổng giám đốc")
const isMainDirector = (cv: string) => lower(cv).replace(/\s+nhà\s+máy$/u, "").trim() === "giám đốc"

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const fid = actor.factoryId
    const [{ data: profiles, error }, { data: deptRow }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, username, role, department, department_id").eq("factory_id", fid).eq("status", "active"),
      supabaseAdmin.from("departments").select("id, name, code").eq("code", DEPT_CODE).maybeSingle(),
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const all = (profiles || []) as ProfileRow[]
    const ids = all.map((p) => p.id)
    const loadStaff = (cols: string) =>
      supabaseAdmin.from("maintenance_staff").select(cols).eq("factory_id", fid).eq("active", true).in("profile_id", ids)
    let staffRes = await loadStaff("profile_id, chuc_vu, chuc_vu_chinh_quyen, mac_dinh_ky")
    if (staffRes.error) staffRes = await loadStaff("profile_id, chuc_vu, chuc_vu_chinh_quyen")
    const staffById = new Map<string, StaffRow>()
    for (const s of (staffRes.data || []) as unknown as StaffRow[]) if (s.profile_id) staffById.set(s.profile_id, s)
    const chucVuOf = (id: string) => {
      const s = staffById.get(id)
      return ((s?.chuc_vu_chinh_quyen || s?.chuc_vu || "") as string).trim()
    }
    const name = (p: ProfileRow) => p.full_name || p.username || ""

    // Người lập: quyền norms.report (cấp tường minh thì chỉ dùng tập đó — như fetchPermissionCodesForUser).
    const [{ data: grants }, { data: roleRows }] = await Promise.all([
      supabaseAdmin.from("user_permissions").select("user_id, permission_code").eq("granted", true).in("user_id", ids),
      supabaseAdmin.from("role_permissions").select("role").eq("permission_code", "norms.report"),
    ])
    const grantMap = new Map<string, Set<string>>()
    for (const g of (grants || []) as { user_id: string; permission_code: string }[]) {
      const s = grantMap.get(g.user_id) || new Set<string>()
      s.add(g.permission_code)
      grantMap.set(g.user_id, s)
    }
    const roles = new Set(((roleRows || []) as { role: string }[]).map((r) => r.role))
    const canReport = (p: ProfileRow) => p.role === "admin" || (grantMap.has(p.id) ? grantMap.get(p.id)!.has("norms.report") : !!p.role && roles.has(p.role))
    const nguoiLap: Person[] = all.filter(canReport).map((p) => ({ id: p.id, full_name: name(p), chuc_vu: chucVuOf(p.id) }))
    if (!nguoiLap.some((p) => p.id === actor.userId)) {
      const me = all.find((p) => p.id === actor.userId)
      if (me) nguoiLap.push({ id: me.id, full_name: name(me), chuc_vu: chucVuOf(me.id) })
    }

    const inNmcb = (p: ProfileRow) => {
      if (deptRow?.id && p.department_id === deptRow.id) return true
      const d = (p.department || "").trim()
      return d.toUpperCase() === DEPT_CODE || (!!deptRow?.name && d.toLowerCase() === String(deptRow.name).toLowerCase())
    }
    const directorOf = (p: ProfileRow): Person | null => {
      const s = staffById.get(p.id)
      const cv = [s?.chuc_vu_chinh_quyen, s?.chuc_vu].find((v) => v && isDirector(v))
      return cv ? { id: p.id, full_name: name(p), chuc_vu: cv.trim() } : null
    }
    let bgd = all.filter(inNmcb).map(directorOf).filter((x): x is Person => !!x)
    const fallback = !bgd.length
    if (fallback) bgd = all.map(directorOf).filter((x): x is Person => !!x)
    const sortVi = (a: Person, b: Person) => a.full_name.localeCompare(b.full_name, "vi")
    bgd.sort(sortVi)
    nguoiLap.sort(sortVi)
    const pick = (list: Person[]) => list.find((a) => !!staffById.get(a.id)?.mac_dinh_ky) || list[0]
    const defaultBgdId = (pick(bgd.filter((a) => isMainDirector(a.chuc_vu))) || pick(bgd))?.id || null

    return NextResponse.json({ nguoiLap, bgd, bgdFallback: fallback, defaultBgdId, defaultNguoiLapId: actor.userId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
