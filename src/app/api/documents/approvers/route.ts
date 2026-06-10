import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  role: string | null
}

export async function GET(req: NextRequest) {
  const factoryId = req.nextUrl.searchParams.get("factoryId")
  if (!factoryId) {
    return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
  }

  // 1. Users có explicit permission documents.phe_duyet
  const { data: permRows } = await supabaseAdmin
    .from("user_permissions")
    .select("user_id")
    .eq("permission_code", "documents.phe_duyet")

  const permUserIds = (permRows || []).map((r: { user_id: string }) => r.user_id)

  // 2. Users có role admin/manager trong factory (role_permissions cấp mặc định)
  const { data: adminRows } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, role")
    .eq("factory_id", factoryId)
    .eq("status", "active")
    .in("role", ["admin", "manager"])

  const adminIds = (adminRows || []).map((r: ProfileRow) => r.id)

  // Gộp, deduplicate
  const allIds = [...new Set([...permUserIds, ...adminIds])]
  if (!allIds.length) return NextResponse.json([])

  // Lấy profile của các user đã gộp (lọc theo factory để chắc chắn)
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, role")
    .eq("factory_id", factoryId)
    .eq("status", "active")
    .in("id", allIds)

  const result = (profiles || []).map((p: ProfileRow) => ({
    id: p.id,
    full_name: p.full_name || p.username || "",
    username: p.username || "",
    role: p.role || "",
  }))

  return NextResponse.json(result)
}
