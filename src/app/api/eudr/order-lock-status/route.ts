import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { EudrFileOpError, loadOrderForFileOps } from "@/app/api/eudr/_lib/eudr-file-permissions"

// Cho UI biết đơn hàng đã "khóa" quản lý tệp đính kèm chưa (đã phê duyệt hoặc đã cấp
// quyền khách hàng) — dùng service role vì RLS của export_order_customer_grants chỉ cho
// đúng người đã cấp quyền / admin thấy dòng grant, staff khác (kể cả có export.view) sẽ
// tính thiếu nếu tự query thẳng từ client.
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const orderId = req.nextUrl.searchParams.get("orderId")?.trim() || ""

    if (!orderId) {
      return NextResponse.json({ error: "Thieu ma don xuat hang." }, { status: 400 })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("factory_id, status")
      .eq("id", authUser.id)
      .single()

    if (profileError || !profile) {
      throw new Error(profileError?.message || "Khong tai duoc ho so nguoi dung.")
    }

    if (profile.status !== "active") {
      return NextResponse.json({ error: "Tai khoan khong con hoat dong." }, { status: 403 })
    }

    const { locked } = await loadOrderForFileOps(orderId, profile.factory_id)

    return NextResponse.json({ locked })
  } catch (error) {
    if (error instanceof EudrFileOpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("EUDR order-lock-status failed", error)
    const message = error instanceof Error ? error.message : "Khong kiem tra duoc trang thai don hang."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
