import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  role: string | null
  department: string | null
  department_id: string | null
}

// GET ?factoryId=xxx&dept=KTNN&leadership=true&permission=documents.create,documents.ky_phong_ban
// leadership=true → chỉ trả về role IN ('admin','manager')
// permission=xxx  → lọc user có explicit grant hoặc role được cấp qua role_permissions
//                    hỗ trợ nhiều code phân tách bằng dấu phẩy (OR-match)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const factoryId = searchParams.get("factoryId")
  const dept = searchParams.get("dept")
  const leadershipOnly = searchParams.get("leadership") === "true"
  const permissionCode = searchParams.get("permission")

  if (!factoryId) {
    return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
  }

  let query = supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, role, department, department_id")
    .eq("factory_id", factoryId)
    .eq("status", "active")

  if (leadershipOnly) {
    query = query.in("role", ["admin", "manager"])
  }

  const { data: profiles, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let rows = (profiles || []) as ProfileRow[]

  // Lọc theo phòng ban (3-way match: department_id FK, tên đầy đủ, code text)
  if (dept) {
    const deptUpper = dept.toUpperCase()

    const { data: deptRow } = await supabaseAdmin
      .from("departments")
      .select("id, name, code")
      .eq("code", deptUpper)
      .maybeSingle()

    rows = rows.filter((p) => {
      if (deptRow?.id && p.department_id === deptRow.id) return true
      if (deptRow?.name && p.department === deptRow.name) return true
      if (p.department?.toUpperCase() === deptUpper) return true
      return false
    })
  }

  // Lọc theo permission (explicit grant hoặc role-based default)
  if (permissionCode) {
    const codes = permissionCode.split(",").map((c) => c.trim()).filter(Boolean)

    // 1. Explicit user grants (cột là granted=true)
    const { data: permRows } = await supabaseAdmin
      .from("user_permissions")
      .select("user_id")
      .in("permission_code", codes)
      .eq("granted", true)

    const explicitUserIds = new Set((permRows || []).map((r: { user_id: string }) => r.user_id))

    // 2. Role-based grants via role_permissions (cột là "role", không phải "role_code")
    const { data: rolePermRows } = await supabaseAdmin
      .from("role_permissions")
      .select("role")
      .in("permission_code", codes)

    const rolesWithPerm = new Set((rolePermRows || []).map((r: { role: string }) => r.role))

    rows = rows.filter((p) => {
      if (explicitUserIds.has(p.id)) return true
      if (p.role && rolesWithPerm.has(p.role)) return true
      return false
    })
  }

  const result = rows.map((p) => ({
    id: p.id,
    full_name: p.full_name || p.username || "",
    username: p.username || "",
    role: p.role || "",
    department: p.department || "",
  }))

  return NextResponse.json(result)
}
