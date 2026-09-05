import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import {
  accountErrorResponse,
  requireAuthUser,
  supabaseAdmin,
} from "../_lib/security"

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)

    // Kiểm tra quyền của người gọi (admin hoặc có quyền quản lý/duyệt user)
    const [{ data: callerProfile }, { data: callerPerms }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", authUser.id)
        .single(),
      supabaseAdmin
        .from("user_permissions")
        .select("permission_code")
        .eq("user_id", authUser.id)
        .eq("granted", true),
    ])

    const isAdmin = callerProfile?.role === "admin"
    const hasPerm = (callerPerms || []).some((p) =>
      ["users.approve", "users.edit", "users.manage"].includes(p.permission_code),
    )

    if (!isAdmin && !hasPerm) {
      return NextResponse.json(
        { error: "Bạn không có quyền thực hiện thao tác đặt lại thông tin tài khoản này" },
        { status: 403 },
      )
    }

    const { targetUserId, action, newPassword, newPin } = await req.json()

    if (!targetUserId || !action) {
      return NextResponse.json({ error: "Thiếu thông tin người dùng hoặc hành động" }, { status: 400 })
    }

    const { data: targetProfile, error: targetError } = await supabaseAdmin
      .from("profiles")
      .select("id, username, full_name")
      .eq("id", targetUserId)
      .maybeSingle()

    if (targetError || !targetProfile) {
      return NextResponse.json({ error: "Không tìm thấy người dùng cần thao tác" }, { status: 404 })
    }

    // 1. Reset mật khẩu
    if (action === "password" || action === "both") {
      const pwd = String(newPassword || "")
      if (pwd.length < 6) {
        return NextResponse.json(
          { error: "Mật khẩu mới phải có ít nhất 6 ký tự" },
          { status: 400 },
        )
      }

      const { error: pwdErr } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        password: pwd,
      })

      if (pwdErr) {
        return NextResponse.json(
          { error: `Không thể đặt lại mật khẩu: ${pwdErr.message}` },
          { status: 500 },
        )
      }

      // Xóa cờ must_change_password nếu đang bật
      await supabaseAdmin
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", targetUserId)
    }

    // 2. Reset PIN
    if (action === "pin" || action === "both") {
      const pinStr = String(newPin || "")
      if (!/^\d{4,6}$/.test(pinStr)) {
        return NextResponse.json(
          { error: "Mã PIN phải là 4 đến 6 chữ số" },
          { status: 400 },
        )
      }

      const pin_hash = await bcrypt.hash(pinStr, 12)
      const { error: pinErr } = await supabaseAdmin.from("sign_pins").upsert(
        {
          user_id: targetUserId,
          pin_hash,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )

      if (pinErr) {
        return NextResponse.json(
          { error: `Không thể cập nhật mã PIN: ${pinErr.message}` },
          { status: 500 },
        )
      }
    }

    let successMsg = "Đã cập nhật thông tin thành công"
    if (action === "password") successMsg = `Đã đặt lại mật khẩu thành công cho ${targetProfile.full_name}`
    else if (action === "pin") successMsg = `Đã đặt lại mã PIN thành công cho ${targetProfile.full_name}`
    else if (action === "both") successMsg = `Đã đặt lại mật khẩu và mã PIN thành công cho ${targetProfile.full_name}`

    return NextResponse.json({ ok: true, message: successMsg })
  } catch (err) {
    return accountErrorResponse(err, "Lỗi máy chủ khi đặt lại thông tin")
  }
}
