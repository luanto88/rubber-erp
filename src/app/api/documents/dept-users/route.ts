import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  role: string | null
  department: string | null
}

// GET ?factoryId=xxx&dept=KTNN&leadership=true
// leadership=true → chỉ trả về role IN ('admin','manager')
// leadership=false/omit → tất cả active users của factory
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const factoryId = searchParams.get("factoryId")
  const dept = searchParams.get("dept")
  const leadershipOnly = searchParams.get("leadership") === "true"

  if (!factoryId) {
    return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
  }

  let query = supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, role, department")
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

  // Lọc theo phòng ban nếu có — so sánh department text (có thể là tên hoặc code)
  if (dept) {
    rows = rows.filter(
      (p) => p.department === dept || p.department?.toUpperCase() === dept.toUpperCase(),
    )
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
