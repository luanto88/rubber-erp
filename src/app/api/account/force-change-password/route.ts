import { NextRequest, NextResponse } from "next/server"
import { accountErrorResponse, assertAccountActive, requireAuthUser, supabaseAdmin } from "../_lib/security"

// Route dành RIÊNG cho luồng bắt buộc đổi mật khẩu sau khi đăng nhập bằng mật khẩu mới do
// "Quên mật khẩu" sinh ra (profiles.must_change_password = true). KHÔNG dùng route này để đổi
// mật khẩu tuỳ ý — luồng đổi mật khẩu bình thường (đã đăng nhập, không bị bắt buộc) vẫn phải đi
// qua request-otp/verify-otp/change-password như cũ. Route này không nhận actionToken vì danh
// tính đã được xác thực bằng chính việc đăng nhập thành công bằng mật khẩu mới gửi tới đúng
// email đã xác minh ở bước /api/account/forgot-password/request.
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { newPassword } = await req.json()

    if (!newPassword) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    if (String(newPassword).length < 6) {
      return NextResponse.json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự" }, { status: 400 })
    }

    await assertAccountActive(authUser.id)

    // Chỉ kiểm tra cờ của CHÍNH authUser.id (không nhận userId từ body) — chặn cứng nếu tài
    // khoản không thực sự đang bị buộc đổi mật khẩu, tránh route này bị dùng làm cửa sau đổi
    // mật khẩu tuỳ ý mà không qua OTP.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("must_change_password")
      .eq("id", authUser.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Không tìm thấy hồ sơ người dùng" }, { status: 404 })
    }

    if (!profile.must_change_password) {
      return NextResponse.json(
        { error: "Tài khoản này không ở trạng thái bắt buộc đổi mật khẩu" },
        { status: 403 },
      )
    }

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      password: String(newPassword),
    })
    if (updateAuthError) {
      return NextResponse.json({ error: updateAuthError.message }, { status: 500 })
    }

    const { error: updateProfileError } = await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", authUser.id)
    if (updateProfileError) {
      return NextResponse.json({ error: updateProfileError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return accountErrorResponse(err, "Lỗi máy chủ")
  }
}
