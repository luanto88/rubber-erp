import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id: string
  role: string | null
  status: string | null
}

type GrantRow = {
  export_orders: {
    id: string
    ma_don: string
    ngay: string
    chung_loai: string
    tong_banh: number
    trang_thai: string | null
    customers: { ten_kh_en: string | null; quoc_gia: string | null } | null
  } | null
}

// GET /api/customer-portal/orders
// Danh sách đơn xuất hàng mà tài khoản customer đang đăng nhập được admin cấp quyền xem
// (bảng export_order_customer_grants — gán tay từng đơn, không phải tự động theo
// customer_id). Dùng service role để bypass RESTRICTIVE RLS chặn role customer đọc thẳng
// export_orders — mọi kiểm tra quyền đều tự làm ở route này trước khi trả dữ liệu.
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const supabaseAdmin = getSupabaseAdmin()

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, role, status")
      .eq("id", authUser.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Không tìm thấy hồ sơ người dùng" }, { status: 403 })
    }

    const caller = profile as ProfileRow
    if (caller.role !== "customer" || caller.status !== "active") {
      return NextResponse.json({ error: "Tài khoản không có quyền truy cập" }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin
      .from("export_order_customer_grants")
      .select(
        "export_orders(id, ma_don, ngay, chung_loai, tong_banh, trang_thai, customers(ten_kh_en, quoc_gia))",
      )
      .eq("granted_to_user_id", authUser.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const orders = ((data || []) as unknown as GrantRow[])
      .map((row) => row.export_orders)
      .filter((order): order is NonNullable<GrantRow["export_orders"]> => Boolean(order))
      .map((order) => ({
        id: order.id,
        ma_don: order.ma_don,
        ngay: order.ngay,
        chung_loai: order.chung_loai,
        tong_banh: order.tong_banh,
        trang_thai: order.trang_thai,
        customer_name: order.customers?.ten_kh_en || null,
      }))
      .sort((a, b) => (b.ngay || "").localeCompare(a.ngay || ""))

    return NextResponse.json({ orders })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 401 },
    )
  }
}
