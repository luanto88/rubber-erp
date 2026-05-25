import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// GET /api/iso/profiles-by-permission?factoryId=...&permCode=...
// Dùng service role để bypass RLS — frontend client chỉ đọc được quyền của chính mình
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const factoryId = searchParams.get("factoryId")
  const permCode = searchParams.get("permCode")

  if (!factoryId || !permCode) {
    return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
  }

  const [directRes, roleRes] = await Promise.all([
    supabaseAdmin.from("user_permissions").select("user_id").eq("permission_code", permCode).eq("granted", true),
    supabaseAdmin.from("role_permissions").select("role").eq("permission_code", permCode),
  ])

  const directIds = ((directRes.data || []) as { user_id: string }[]).map((d) => d.user_id)
  const roles = [...new Set([...((roleRes.data || []) as { role: string }[]).map((r) => r.role), "admin"])]

  const [byId, byRole] = await Promise.all([
    directIds.length > 0
      ? supabaseAdmin.from("profiles").select("id, full_name, username, role")
          .eq("factory_id", factoryId).eq("status", "active").in("id", directIds).order("full_name")
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from("profiles").select("id, full_name, username, role")
      .eq("factory_id", factoryId).eq("status", "active").in("role", roles).order("full_name"),
  ])

  const seen = new Set<string>()
  const merged: { id: string; full_name: string | null; username: string; role: string }[] = []
  for (const list of [(byId.data || []), (byRole.data || [])]) {
    for (const p of list as typeof merged) {
      if (!seen.has(p.id)) { seen.add(p.id); merged.push(p) }
    }
  }
  merged.sort((a, b) => (a.full_name || a.username).localeCompare(b.full_name || b.username, "vi"))

  return NextResponse.json({ profiles: merged })
}
