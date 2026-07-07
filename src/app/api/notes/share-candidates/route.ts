import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

const SHARE_PERMISSION_CODE = "notes.view"

type ProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  role: string | null
}

// GET /api/notes/share-candidates?factoryId=xxx
// Danh sách user active trong nhà máy, có quyền `notes.view`, KHÔNG bao gồm admin
// (admin đã mặc nhiên thấy mọi ghi chú nên không cần được "chia sẻ") — để chọn chia sẻ ghi chú.
// Bypass RLS profiles (RLS profiles chỉ cho admin đọc toàn bộ, xem
// .claude/rules/16-iso-vanban-module.md). Việc chia sẻ (insert/delete operation_note_shares)
// vẫn đi qua client Supabase bình thường và được RLS của operation_note_shares xác thực —
// route này chỉ trả tên để hiển thị.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const factoryId = searchParams.get("factoryId")

  if (!factoryId) {
    return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
  }

  try {
    const supabaseAdmin = getSupabaseAdmin()

    const [profilesRes, userPermRes, rolePermRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, username, role")
        .eq("factory_id", factoryId)
        .eq("status", "active")
        .neq("role", "admin")
        .order("full_name"),
      supabaseAdmin
        .from("user_permissions")
        .select("user_id")
        .eq("permission_code", SHARE_PERMISSION_CODE)
        .eq("granted", true),
      supabaseAdmin
        .from("role_permissions")
        .select("role")
        .eq("permission_code", SHARE_PERMISSION_CODE),
    ])

    if (profilesRes.error) {
      return NextResponse.json({ error: profilesRes.error.message }, { status: 500 })
    }

    const explicitUserIds = new Set(
      (userPermRes.data || []).map((r: { user_id: string }) => r.user_id),
    )
    const rolesWithPerm = new Set(
      (rolePermRes.data || []).map((r: { role: string }) => r.role),
    )

    const users = ((profilesRes.data || []) as ProfileRow[])
      .filter((p) => explicitUserIds.has(p.id) || (p.role && rolesWithPerm.has(p.role)))
      .map((p) => ({
        id: p.id,
        name: p.full_name || p.username || "Không rõ tên",
      }))

    return NextResponse.json({ users })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
