import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import nodemailer from "nodemailer"
import { normalizeUsername } from "@/lib/auth"
import { resolveOtpRecipient, supabaseAdmin } from "../../_lib/security"

// Route CÔNG KHAI (không có phiên đăng nhập) — khác hẳn các route khác trong _lib/security.ts
// vốn bắt buộc requireAuthUser(). Người quên mật khẩu, theo định nghĩa, không có Bearer token
// nào cả nên không thể dùng lại requireAuthUser ở đây.

const RATE_LIMIT_WINDOW_MINUTES = 15
const MAX_ATTEMPTS_PER_IDENTIFIER = 3

// Luôn trả đúng 1 thông điệp này cho MỌI trường hợp không khớp (username không tồn tại, tài
// khoản không active, email không khớp, chưa cấu hình email cá nhân...) — không được phân biệt
// lý do cụ thể, chống dò tên đăng nhập/email hợp lệ đang tồn tại trong hệ thống.
const GENERIC_MESSAGE =
  "Nếu thông tin khớp với một tài khoản đang hoạt động, mật khẩu mới đã được gửi tới email đã đăng ký."

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

// Rate-limit theo 1 identifier tự do (username hoặc IP) — không thể dùng lại
// security_sensitive_action_attempts (user_id NOT NULL REFERENCES profiles) vì tại đây chưa
// chắc chắn username có khớp tài khoản thật hay không. Đếm TRƯỚC rồi luôn ghi nhận lượt gọi
// này NGAY SAU (bất kể tài khoản có tồn tại hay không) — nếu chỉ ghi nhận khi tài khoản tồn
// tại, kẻ tấn công có thể suy ra tài khoản có tồn tại hay không qua việc rate-limit có tăng
// hay không, làm hỏng tác dụng chống dò của GENERIC_MESSAGE.
async function assertNotPubliclyRateLimited(identifier: string) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString()
  const { count, error } = await supabaseAdmin
    .from("security_public_action_attempts")
    .select("id", { count: "exact", head: true })
    .eq("identifier", identifier)
    .gte("created_at", since)

  if (error) throw new Error(error.message)

  if ((count || 0) >= MAX_ATTEMPTS_PER_IDENTIFIER) {
    throw new Error(`Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau ${RATE_LIMIT_WINDOW_MINUTES} phút.`)
  }

  // Bug thật đã phát hiện khi test tay (2026-08-24): bản đầu không check lỗi INSERT — nếu bảng
  // `security_public_action_attempts` không tồn tại (vd migration 20260831_forgot_password.sql
  // chưa được chạy), INSERT lỗi bị nuốt âm thầm, không có dòng nào được ghi, nên COUNT ở lần gọi
  // sau luôn thấy 0 → rate-limit không bao giờ kích hoạt (fail OPEN thay vì fail CLOSED — sai
  // hướng cho 1 cơ chế chống lạm dụng). Giờ throw nếu INSERT lỗi, để route trả 429 (khoá an toàn)
  // thay vì âm thầm cho phép gọi vô hạn.
  const { error: insertError } = await supabaseAdmin
    .from("security_public_action_attempts")
    .insert({ identifier })
  if (insertError) throw new Error(insertError.message)
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

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown"

    try {
      await assertNotPubliclyRateLimited(`forgot_password:username:${normalizedUsername}`)
      await assertNotPubliclyRateLimited(`forgot_password:ip:${ip}`)
    } catch (rateErr) {
      return NextResponse.json(
        {
          error: rateErr instanceof Error ? rateErr.message : "Yêu cầu quá nhanh, vui lòng thử lại sau.",
          code: "RATE_LIMITED",
        },
        { status: 429 },
      )
    }

    // `code: "OK"` để client luôn hiển thị thông điệp đã dịch của CHÍNH client (đúng ngôn ngữ
    // đang chọn) thay vì tin theo `message` tiếng Việt cố định từ server — xem forgotSuccessMessage
    // trong customer-portal-i18n.ts (nội dung 2 bên phải khớp ý nhau, `message` giữ lại chỉ để
    // tương thích ngược/log, client không còn đọc field này để hiển thị).
    const genericResponse = () => NextResponse.json({ ok: true, code: "OK", message: GENERIC_MESSAGE })

    // Từ đây trở đi: mọi nhánh không khớp (username không tồn tại, không active, chưa gán nhà
    // máy, chưa cấu hình email cá nhân, email không khớp...) đều return genericResponse() — chỉ
    // nhánh khớp thật mới thực sự sinh + gửi mật khẩu mới.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, factory_id, full_name, status")
      .eq("username", normalizedUsername)
      .maybeSingle()

    if (profileError || !profile || profile.status !== "active" || !profile.factory_id) {
      return genericResponse()
    }

    let realEmail = ""
    try {
      realEmail = (
        await resolveOtpRecipient(profile.id, profile.factory_id, profile.full_name)
      )
        .trim()
        .toLowerCase()
    } catch {
      return genericResponse()
    }

    if (!realEmail || realEmail !== normalizedEmail) {
      return genericResponse()
    }

    const newPassword = generateStrongPassword()

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      password: newPassword,
    })
    if (updateAuthError) {
      return genericResponse()
    }

    const { error: updateProfileError } = await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", profile.id)
    if (updateProfileError) {
      return genericResponse()
    }

    try {
      await sendNewPasswordEmail({ email: realEmail, userName: profile.full_name, newPassword })
    } catch {
      // Mật khẩu đã đổi rồi nên không thể lùi lại nếu gửi mail lỗi (thiếu cấu hình SMTP...) —
      // vẫn trả response chung, không lộ chi tiết lỗi gửi mail ra client công khai.
    }

    return genericResponse()
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ", code: "SERVER_ERROR" }, { status: 500 })
  }
}
