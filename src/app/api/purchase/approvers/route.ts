import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"

export const dynamic = "force-dynamic"

// Danh sách người ký cho Phiếu đề nghị mua vật tư (chỉ NMCB):
//  - Giám đốc nhà máy: chức vụ chứa "giám đốc" (gồm Phó giám đốc), loại "tổng giám đốc".
//    Mặc định = người có chức vụ đúng "Giám đốc (nhà máy)".
//  - Kế toán: chức vụ chứa "kế toán" hoặc "nhân viên". Mặc định = người có "kế toán".
// Chức vụ đọc từ maintenance_staff (chuc_vu_chinh_quyen ưu tiên, rồi chuc_vu) qua profile_id.
// Không có ai thuộc NMCB khớp → nới ra toàn nhà máy (cờ `fallback`) để không kẹt việc.

const DEPT_CODE = "NMCB"

type ProfileRow = { id: string; full_name: string | null; username: string | null; department: string | null; department_id: string | null }
type StaffRow = { profile_id: string | null; chuc_vu: string | null; chuc_vu_chinh_quyen: string | null }
type Approver = { id: string; full_name: string; chuc_vu: string }

function lower(text: string | null | undefined): string {
  return String(text || "").trim().toLowerCase()
}

function stripFactorySuffix(text: string): string {
  return text.replace(/\s+nhà\s+máy$/u, "").trim()
}

function isDirector(cv: string): boolean {
  const t = lower(cv)
  return t.includes("giám đốc") && !t.includes("tổng giám đốc")
}

function isMainDirector(cv: string): boolean {
  return stripFactorySuffix(lower(cv)) === "giám đốc"
}

function isAccountantOrStaff(cv: string): boolean {
  const t = lower(cv)
  return t.includes("kế toán") || t.includes("nhân viên")
}

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const factoryId = actor.factoryId

    const [{ data: profiles, error }, { data: deptRow }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, username, department, department_id")
        .eq("factory_id", factoryId)
        .eq("status", "active"),
      supabaseAdmin.from("departments").select("id, name, code").eq("code", DEPT_CODE).maybeSingle(),
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const all = (profiles || []) as ProfileRow[]
    const { data: staffRows } = await supabaseAdmin
      .from("maintenance_staff")
      .select("profile_id, chuc_vu, chuc_vu_chinh_quyen")
      .eq("factory_id", factoryId)
      .eq("active", true)
      .in("profile_id", all.map((p) => p.id))
    const staffById = new Map<string, StaffRow>()
    for (const s of (staffRows || []) as StaffRow[]) if (s.profile_id) staffById.set(s.profile_id, s)

    const inNmcb = (p: ProfileRow) => {
      if (deptRow?.id && p.department_id === deptRow.id) return true
      const d = (p.department || "").trim()
      return d.toUpperCase() === DEPT_CODE || (!!deptRow?.name && d.toLowerCase() === deptRow.name.toLowerCase())
    }

    const withChucVu = (p: ProfileRow, test: (cv: string) => boolean): Approver | null => {
      const s = staffById.get(p.id)
      if (!s) return null
      const cv = [s.chuc_vu_chinh_quyen, s.chuc_vu].find((v) => v && test(v))
      if (!cv) return null
      return { id: p.id, full_name: p.full_name || p.username || "", chuc_vu: cv.trim() }
    }

    const build = (test: (cv: string) => boolean) => {
      const nmcb = all.filter(inNmcb).map((p) => withChucVu(p, test)).filter((x): x is Approver => !!x)
      if (nmcb.length) return { list: nmcb, fallback: false }
      return { list: all.map((p) => withChucVu(p, test)).filter((x): x is Approver => !!x), fallback: true }
    }

    const giamDoc = build(isDirector)
    const keToan = build(isAccountantOrStaff)
    const sortVi = (a: Approver, b: Approver) => a.full_name.localeCompare(b.full_name, "vi")
    giamDoc.list.sort(sortVi)
    keToan.list.sort(sortVi)

    // Chức vụ của chính người đề nghị (in dưới "Người đề nghị").
    const me = staffById.get(actor.userId)
    const myChucVu = (me?.chuc_vu_chinh_quyen || me?.chuc_vu || "").trim() || null

    return NextResponse.json({
      giamDoc: giamDoc.list,
      keToan: keToan.list,
      giamDocFallback: giamDoc.fallback,
      keToanFallback: keToan.fallback,
      defaultGiamDocId: giamDoc.list.find((a) => isMainDirector(a.chuc_vu))?.id || giamDoc.list[0]?.id || null,
      defaultKeToanId: keToan.list.find((a) => lower(a.chuc_vu).includes("kế toán"))?.id || null,
      myChucVu,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
