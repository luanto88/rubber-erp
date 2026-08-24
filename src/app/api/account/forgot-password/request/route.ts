import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import nodemailer from "nodemailer"
import { normalizeUsername } from "@/lib/auth"
import { maskEmail, resolveOtpRecipient, supabaseAdmin } from "../../_lib/security"
import { assertNotPubliclyRateLimited, getClientIp } from "../_shared"

// Bước 2 của luồng Quên mật khẩu 2 bước (Bước 1 là check-username/route.ts). Route CÔNG KHAI
// (không có phiên đăng nhập), không dùng requireAuthUser(). Khác thiết kế "generic response" cũ
// (đã bỏ) — giờ trả rõ lý do khi email không khớp, vì Bước 1 đã tiết lộ username tồn tại rồi nên
// việc mơ hồ tiếp ở đây không còn tác dụng chống dò, chỉ còn gây khó hiểu cho người dùng thật.
// Rate-limit riêng (`forgot_password_submit:*`), độc lập với Bước 1, để hạn chế brute-force email
// khi đã biết đúng username.

// Loại bỏ ký tự dễ nhầm khi đọc lại từ email rồi gõ tay: 0/O, 1/l/I.
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

function generateStrongPassword(length = 12): string {
  const bytes = randomBytes(length)
  let out = ""
  for (let i = 0; i < length; i += 1) {
    out += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length]
  }
  return out
}

async function sendNewPasswordEmail(params: { email: string; userName: string; newPassword: string }) {
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) {
    throw new Error("Chưa cấu hình email trên máy chủ")
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  })

  // Không chèn magic link — chỉ hiện mật khẩu mới để người dùng tự gõ vào form đăng nhập bình
  // thường, giảm bề mặt tấn công phishing (không tập cho người dùng thói quen bấm link trong
  // email để đăng nhập).
  await transporter.sendMail({
    from: `"Rubber ERP" <${gmailUser}>`,
    to: params.email,
    subject: "[Rubber ERP] Mật khẩu mới của bạn",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <div style="background:#0f766e;padding:18px 24px;color:#fff">
          <h2 style="margin:0;font-size:18px">Mật khẩu mới của bạn</h2>
        </div>
        <div style="padding:24px;background:#fff;color:#0f172a">
          <p>Xin chào ${params.userName},</p>
          <p>Hệ thống vừa nhận yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Mật khẩu mới là:</p>
          <div style="font-size:26px;font-weight:700;letter-spacing:2px;color:#0f766e;margin:16px 0;padding:14px 18px;background:#f0fdfa;border-radius:8px;text-align:center">${params.newPassword}</div>
          <p>Vui lòng đăng nhập bằng mật khẩu này, hệ thống sẽ yêu cầu bạn đổi ngay sang mật khẩu do bạn tự chọn trước khi vào được các trang khác.</p>
          <p style="margin-top:20px;color:#475569">Nếu bạn không yêu cầu thao tác này, vui lòng báo ngay cho quản trị viên.</p>
        </div>
      </div>
    `,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawUsername = typeof body.username === "string" ? body.username : ""
    const rawEmail = typeof body.email === "string" ? body.email : ""
    const normalizedUsername = normalizeUsername(rawUsername)
    const normalizedEmail = rawEmail.trim().toLowerCase()

    if (!normalizedUsername || !normalizedEmail) {
      return NextResponse.json(
        { error: "Vui lòng nhập đầy đủ Tên đăng nhập và Email", code: "MISSING_FIELDS" },
        { status: 400 },
      )
    }

    const ip = getClientIp(req)

    try {
      await assertNotPubliclyRateLimited(`forgot_password_submit:username:${normalizedUsername}`)
      if (ip) await assertNotPubliclyRateLimited(`forgot_password_submit:ip:${ip}`)
    } catch (rateErr) {
      return NextResponse.json(
        {
          error: rateErr instanceof Error ? rateErr.message : "Yêu cầu quá nhanh, vui lòng thử lại sau.",
          code: "RATE_LIMITED",
        },
        { status: 429 },
      )
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, factory_id, full_name, status")
      .eq("username", normalizedUsername)
      .maybeSingle()

    // Username không hợp lệ ở bước này chỉ có thể xảy ra nếu client gọi thẳng route này, bỏ qua
    // Bước 1 (check-username) — Bước 1 đã là nơi chính thức báo "không tìm thấy tài khoản".
    if (profileError || !profile || profile.status !== "active" || !profile.factory_id) {
      return NextResponse.json(
        { error: "Không tìm thấy tài khoản này hoặc tài khoản không còn hoạt động.", code: "NOT_FOUND" },
        { status: 404 },
      )
    }

    let realEmail = ""
    try {
      realEmail = (
        await resolveOtpRecipient(profile.id, profile.factory_id, profile.full_name)
      )
        .trim()
        .toLowerCase()
    } catch {
      return NextResponse.json(
        {
          error: "Tài khoản này chưa cấu hình email cá nhân. Vui lòng liên hệ quản trị viên.",
          code: "NO_EMAIL_CONFIGURED",
        },
        { status: 200 },
      )
    }

    if (!realEmail || realEmail !== normalizedEmail) {
      return NextResponse.json(
        { error: "Email không khớp với tài khoản này.", code: "EMAIL_MISMATCH" },
        { status: 200 },
      )
    }

    const newPassword = generateStrongPassword()

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      password: newPassword,
    })
    if (updateAuthError) {
      return NextResponse.json({ error: updateAuthError.message, code: "SERVER_ERROR" }, { status: 500 })
    }

    const { error: updateProfileError } = await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", profile.id)
    if (updateProfileError) {
      return NextResponse.json({ error: updateProfileError.message, code: "SERVER_ERROR" }, { status: 500 })
    }

    try {
      await sendNewPasswordEmail({ email: realEmail, userName: profile.full_name, newPassword })
    } catch {
      // Mật khẩu đã đổi rồi nên không thể lùi lại nếu gửi mail lỗi (thiếu cấu hình SMTP...) —
      // vẫn trả OK (đã đổi thật), không lộ chi tiết lỗi gửi mail ra client công khai.
    }

    return NextResponse.json({ ok: true, code: "OK", maskedEmail: maskEmail(realEmail) })
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ", code: "SERVER_ERROR" }, { status: 500 })
  }
}
