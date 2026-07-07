import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  role: string | null
  factory_id: string | null
  status: string | null
}

// GET /api/export/customer-grant-candidates?factoryId=xxx
// Danh sách tài khoản role="customer" đang active trong nhà máy, để admin chọn cấp quyền
// xem 1 đơn xuất hàng cụ thể. Bypass RLS `profiles` (chỉ admin đọc được toàn bộ profiles
// trong factory) bằng getSupabaseAdmin() — nhưng KHÁC với tiền lệ nhẹ hơn của
// /api/notes/share-candidates: route này bắt buộc requireAuthUser + verify caller chính
// là admin trước khi trả dữ liệu, vì đây là bước dẫn tới cấp quyền xem dữ liệu thương mại
// (đơn xuất hàng + truy xuất nguồn gốc) cho tài khoản bên ngoài.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const factoryId = searchParams.get("factoryId")

  if (!factoryId) {
    return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
  }

  try {
    const authUser = await requireAuthUser(req)
    const supabaseAdmin = getSupabaseAdmin()

    const { data: callerProfile, error: callerError } = await supabaseAdmin
      .from("profiles")
      .select("id, role, factory_id, status")
      .eq("id", authUser.id)
      .single()

    if (callerError || !callerProfile) {
      return NextResponse.json({ error: "Không tìm thấy hồ sơ người dùng" }, { status: 403 })
    }

    const caller = callerProfile as ProfileRow
    if (caller.role !== "admin" || caller.status !== "active" || caller.factory_id !== factoryId) {
      return NextResponse.json({ error: "Bạn không có quyền cấp quyền khách hàng" }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username, role, factory_id, status")
      .eq("factory_id", factoryId)
      .eq("status", "active")
      .eq("role", "customer")
      .order("full_name")

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const users = ((data || []) as ProfileRow[]).map((p) => ({
      id: p.id,
      name: p.full_name || p.username || "Không rõ tên",
    }))

    return NextResponse.json({ users })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 401 },
    )
  }
}
