import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

type ProfileRow = { id: string; department: string | null; department_id: string | null }

// GET ?factoryId=xxx&departmentId=uuid — trả về id các profile active thuộc đúng phòng ban đó
// (3-way match: department_id FK, tên đầy đủ, code text) — dùng để lọc danh sách người nhận/
// chấm/thay thế theo Phòng ban đã chọn khi tạo Vị trí 5S/Khu vực 5S/Việc định kỳ/Việc giao tay.
// Bắt buộc route server-side dùng service role: RLS `profiles` chỉ cho đọc own row hoặc admin
// — client thường (không phải admin) không tự lọc được nhiều profile cùng lúc. Mirror
// /api/documents/dept-users/route.ts, chỉ khác nhận departmentId (UUID) trực tiếp thay vì code.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const factoryId = searchParams.get("factoryId")
  const departmentId = searchParams.get("departmentId")
  if (!factoryId || !departmentId) {
    return NextResponse.json({ error: "Thiếu factoryId hoặc departmentId" }, { status: 400 })
  }

  const { data: deptRow } = await supabaseAdmin
    .from("departments")
    .select("id, name, code")
    .eq("id", departmentId)
    .maybeSingle()

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, department, department_id")
    .eq("factory_id", factoryId)
    .eq("status", "active")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const matched = ((profiles || []) as ProfileRow[]).filter((p) => {
    if (!deptRow) return false
    if (p.department_id === deptRow.id) return true
    if (deptRow.name && p.department === deptRow.name) return true
    if (p.department && deptRow.code && p.department.toUpperCase() === deptRow.code.toUpperCase()) return true
    return false
  })

  return NextResponse.json({ userIds: matched.map((p) => p.id) })
}
