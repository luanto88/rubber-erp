import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id: string
  role: string | null
  status: string | null
  factory_id: string | null
}

// GET /api/eudr/resolve-order?code=<ma_don>
// Dùng bởi trang trung gian /dashboard/eudr/lookup (đích của QR trong file DDS) để tra
// nhanh `export_orders.id` theo `ma_don`, scoped đúng theo `factory_id` của tài khoản
// đang gọi — tránh lộ id đơn hàng ngoài phạm vi nhà máy của người quét. Chỉ dành cho
// role="customer" (nhân viên nội bộ không cần endpoint này, họ được chuyển thẳng sang
// /dashboard/eudr?order=... như cũ).
//
// Route này KHÔNG kiểm tra export_order_customer_grants — chỉ trả về id nếu tìm thấy
// đơn đúng nhà máy. Việc thực sự cấp quyền xem chi tiết đơn vẫn do
// /api/customer-portal/orders/[id] tự verify lại (đã có sẵn, không trùng lặp logic).
export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code")?.trim()
    if (!code) {
      return NextResponse.json({ error: "Thiếu mã đơn hàng" }, { status: 400 })
    }

    const authUser = await requireAuthUser(req)
    const supabaseAdmin = getSupabaseAdmin()

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, role, status, factory_id")
      .eq("id", authUser.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Không tìm thấy hồ sơ người dùng" }, { status: 403 })
    }

    const caller = profile as ProfileRow
    if (caller.role !== "customer" || caller.status !== "active" || !caller.factory_id) {
      return NextResponse.json({ error: "Tài khoản không có quyền truy cập" }, { status: 403 })
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("export_orders")
      .select("id")
      .eq("factory_id", caller.factory_id)
      .eq("ma_don", code)
      .maybeSingle()

    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 500 })
    }
    if (!order) {
      return NextResponse.json({ error: "Không tìm thấy đơn xuất hàng" }, { status: 404 })
    }

    return NextResponse.json({ id: order.id })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 401 },
    )
  }
}
