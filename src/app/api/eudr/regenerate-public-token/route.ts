import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

type ProfileRow = {
  role: string | null
  status: string | null
  factory_id: string | null
}

// POST /api/eudr/regenerate-public-token  body: { orderId: string }
// Cấp lại `public_token` (QR nhúng trong file DDS, xem migration 20260818) cho 1 đơn
// xuất hàng — dùng khi token cũ đã lộ ra ngoài (vd file DDS PDF bị chia sẻ/leak) và cần
// vô hiệu hóa mọi QR đã in trước đó. Trước đây chỉ sửa được tay qua Supabase Table
// Editor. Chỉ admin CÙNG nhà máy với đơn mới được cấp lại.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { orderId?: string } | null
    const orderId = body?.orderId?.trim()
    if (!orderId) {
      return NextResponse.json({ error: "Thiếu mã đơn xuất hàng" }, { status: 400 })
    }

    const authUser = await requireAuthUser(req)
    const supabaseAdmin = getSupabaseAdmin()

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role, status, factory_id")
      .eq("id", authUser.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Không tìm thấy hồ sơ người dùng" }, { status: 403 })
    }

    const caller = profile as ProfileRow
    if (caller.role !== "admin" || caller.status !== "active" || !caller.factory_id) {
      return NextResponse.json({ error: "Chỉ Admin mới được cấp lại mã công khai" }, { status: 403 })
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("export_orders")
      .select("id, factory_id")
      .eq("id", orderId)
      .maybeSingle()

    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 500 })
    }
    if (!order || order.factory_id !== caller.factory_id) {
      return NextResponse.json({ error: "Không tìm thấy đơn xuất hàng" }, { status: 404 })
    }

    const nextToken = randomUUID()
    const { error: updateError } = await supabaseAdmin
      .from("export_orders")
      .update({ public_token: nextToken })
      .eq("id", orderId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ public_token: nextToken })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 401 },
    )
  }
}
