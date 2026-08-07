import { NextRequest, NextResponse } from "next/server"
import { createClient, type User as SupabaseUser } from "@supabase/supabase-js"
import { jwtVerify, SignJWT } from "jose"
import bcrypt from "bcryptjs"
import nodemailer from "nodemailer"
import { randomUUID } from "crypto"
import { authEmailsForUsername } from "@/lib/auth"

// Số lần thử OTP tối đa cho mỗi challenge trước khi bị khóa, phải bắt cùng 1 người dùng yêu cầu
// mã mới — chặn brute-force mã 6 số (900.000 khả năng) qua chính /api/account/verify-otp.
const MAX_OTP_ATTEMPTS = 5

// Đánh dấu riêng trường hợp requireAuthUser() từ chối token — client cần phân biệt được đây là
// lỗi PHIÊN THẬT SỰ ĐÃ CHẾT (Supabase server xác nhận token/session không còn tồn tại, ví dụ
// error_code "session_not_found" — xảy ra khi session bị thu hồi do refresh token bị dùng trùng
// giữa 2 nguồn refresh chạy song song) so với các lỗi khác (OTP sai, thiếu tham số...). Dùng
// `name` để nhận diện thay vì so sánh chuỗi message (dễ vỡ nếu message đổi).
export class SessionExpiredError extends Error {
  constructor() {
    super("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
    this.name = "SessionExpiredError"
  }
}

export function isSessionExpiredError(err: unknown): err is SessionExpiredError {
  return err instanceof Error && err.name === "SessionExpiredError"
}

// Helper dùng chung cho catch block của các route dưới _lib/security.ts — tự thêm
// `code: "session_expired"` khi lỗi đến từ requireAuthUser() bị từ chối, để client
// (settings/page.tsx) phân biệt được với lỗi thường và biết khi nào nên tự đăng xuất thay vì cứ
// hiện lỗi rồi để người dùng bấm lại vô ích.
export function accountErrorResponse(err: unknown, fallbackMessage: string, status = 400) {
  const message = err instanceof Error ? err.message : fallbackMessage
  return NextResponse.json(
    { error: message, ...(isSessionExpiredError(err) ? { code: "session_expired" } : {}) },
    { status },
  )
}

export type SensitiveActionType = "change_pin" | "change_signature" | "change_password"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)

const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey)

const ACTION_TOKEN_SECRET = new TextEncoder().encode(
  process.env.SIGN_JWT_SECRET || supabaseServiceRoleKey,
)

type ActionTokenPayload = {
  userId: string
  actionType: SensitiveActionType
}

type ProfileAuthRow = {
  id: string
  username: string
  auth_email: string
  factory_id: string | null
  full_name: string
  status: string
}

// Audit bảo mật 2026-08-07, mục #4: trước đây các route account chỉ xác thực token Supabase còn
// hợp lệ (requireAuthUser), không kiểm tra profiles.status — một tài khoản vừa bị admin khóa
// (`disabled`) hoặc còn `pending` vẫn có thể đổi mật khẩu/PIN/chữ ký của chính họ cho tới khi
// access token tự hết hạn tự nhiên. Gọi hàm này ngay sau requireAuthUser() ở MỌI route nhạy cảm.
export async function assertAccountActive(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("status")
    .eq("id", userId)
    .single()

  if (error || !data) {
    throw new Error("Không tìm thấy hồ sơ người dùng")
  }

  if (data.status !== "active") {
    throw new Error(
      data.status === "disabled"
        ? "Tài khoản đã bị khóa, không thể thực hiện thao tác này."
        : "Tài khoản đang chờ duyệt, không thể thực hiện thao tác này.",
    )
  }
}

// Audit bảo mật 2026-08-07, mục #3: giới hạn 5 lần thử sai mật khẩu/PIN trong 15 phút — trước đây
// không giới hạn, kẻ tấn công đã có access token hợp lệ của nạn nhân có thể vét cạn PIN (nếu biết
// trước mật khẩu) hoặc ngược lại. Rate-limit theo user, không tách riêng theo actionType vì đều
// cùng dùng chung 1 mật khẩu/PIN của tài khoản đó.
const MAX_VERIFY_ATTEMPTS = 5
const VERIFY_ATTEMPTS_WINDOW_MINUTES = 15

export async function assertNotRateLimited(userId: string): Promise<void> {
  const since = new Date(Date.now() - VERIFY_ATTEMPTS_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count, error } = await supabaseAdmin
    .from("security_sensitive_action_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since)

  if (error) {
    throw new Error(error.message)
  }

  if ((count || 0) >= MAX_VERIFY_ATTEMPTS) {
    throw new Error(
      `Bạn đã nhập sai mật khẩu hoặc PIN quá nhiều lần. Vui lòng thử lại sau ${VERIFY_ATTEMPTS_WINDOW_MINUTES} phút.`,
    )
  }
}

export async function recordFailedVerifyAttempt(userId: string): Promise<void> {
  await supabaseAdmin.from("security_sensitive_action_attempts").insert({ user_id: userId })
}

export async function requireAuthUser(req: NextRequest): Promise<SupabaseUser> {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

  if (!token) {
    throw new Error("Phiên đăng nhập không hợp lệ")
  }

  const { data, error } = await supabaseAuth.auth.getUser(token)
  if (error || !data.user) {
    const detail = error
      ? `${error.name}: ${error.message}${"status" in error && error.status ? ` (status=${error.status})` : ""}`
      : "getUser() trả về rỗng dù không có lỗi"
    // Log rõ nguyên nhân gốc ra console server (terminal chạy npm run dev / log Vercel) — lỗi
    // hiển thị cho người dùng luôn là 1 câu chung chung, nhưng nguyên nhân thật (token hết hạn
    // thật sự vs "Invalid Refresh Token: Already Used" do 2 nguồn refresh song song...) chỉ thấy
    // được ở đây.
    console.error(`requireAuthUser: xác thực token thất bại — ${detail} — token đầu: ${token.slice(0, 12)}...`)
    throw new SessionExpiredError()
  }

  return data.user
}

export async function getProfileAuthRow(userId: string): Promise<ProfileAuthRow> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, username, auth_email, factory_id, full_name, status")
    .eq("id", userId)
    .single()

  if (error || !data) {
    throw new Error("Không tìm thấy hồ sơ người dùng")
  }

  const profile = data as ProfileAuthRow
  if (profile.status !== "active") {
    throw new Error(
      profile.status === "disabled"
        ? "Tài khoản đã bị khóa, không thể thực hiện thao tác này."
        : "Tài khoản đang chờ duyệt, không thể thực hiện thao tác này.",
    )
  }

  return profile
}

// BUG THẬT ĐÃ XÁC NHẬN 2026-08-07 (nguyên nhân gốc của lỗi "Phiên đăng nhập đã hết hạn" tái diễn ở
// MỌI tài khoản, MỌI lần thử, kể cả vừa đăng nhập lại hoàn toàn mới): bản cũ của hàm này gọi
// `supabaseAuth.auth.signInWithPassword(...)` rồi `supabaseAuth.auth.signOut()` trên CHÍNH client
// singleton dùng chung với `requireAuthUser()` (biến `supabaseAuth` module-level phía trên).
// `signOut()` không truyền `scope` mặc định là `scope: "global"` trong supabase-js v2 — tức thu
// hồi TẤT CẢ session của user đó trên MỌI thiết bị, không chỉ session tạm vừa tạo bởi
// signInWithPassword. Vì đây CÙNG LÀ user đang thao tác (verifyCurrentPassword luôn gọi với chính
// mật khẩu của người dùng hiện tại), lệnh signOut() này VÔ TÌNH THU HỒI LUÔN session thật đang mở
// trên trình duyệt của chính họ — ngay ở bước "request-otp" (nhập mật khẩu để bắt đầu), TRƯỚC KHI
// họ kịp nhập OTP. Session bị hủy ở tầng Supabase server (session_id không còn trong bảng
// `sessions`), nên access token cũ tuy chưa hết hạn theo `exp` vẫn bị từ chối với
// `AuthSessionMissingError`/`session_not_found` ở mọi request xác thực sau đó — khớp chính xác
// mọi triệu chứng đã quan sát (xảy ra với bất kỳ tài khoản nào, chỉ 1 tab, không liên quan cấu
// hình "single session"/"time-box" nào của Supabase).
// Fix: dùng 1 client HOÀN TOÀN RIÊNG (persistSession/autoRefreshToken tắt), không đụng gì tới
// `supabaseAuth`/session thật của user — không cần gọi signOut() vì client này bị hủy ngay sau
// khi hàm return, không giữ lại state nào cần dọn.
export async function verifyCurrentPassword(profile: ProfileAuthRow, password: string) {
  const candidates = Array.from(
    new Set([profile.auth_email, ...authEmailsForUsername(profile.username)]),
  )

  const throwawayClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  for (const email of candidates) {
    const result = await throwawayClient.auth.signInWithPassword({ email, password })
    if (!result.error) {
      return true
    }
  }

  return false
}

export async function verifyCurrentPin(userId: string, pin: string) {
  const { data, error } = await supabaseAdmin
    .from("sign_pins")
    .select("pin_hash")
    .eq("user_id", userId)
    .single()

  if (error || !data) {
    throw new Error("Bạn chưa thiết lập PIN ký duyệt")
  }

  return bcrypt.compare(pin, data.pin_hash as string)
}

export async function resolveOtpRecipient(userId: string, factoryId: string | null, fullName: string) {
  if (factoryId) {
    const { data: staffByProfile, error: staffByProfileError } = await supabaseAdmin
      .from("maintenance_staff")
      .select("email")
      .eq("factory_id", factoryId)
      .eq("profile_id", userId)
      .maybeSingle()

    if (staffByProfileError) {
      throw new Error(staffByProfileError.message)
    }

    const profileEmail = staffByProfile?.email || null
    if (profileEmail && profileEmail.includes("@")) return profileEmail

    const { data: staffByNameRows, error: staffByNameError } = await supabaseAdmin
      .from("maintenance_staff")
      .select("email")
      .eq("factory_id", factoryId)
      .eq("ten", fullName)
      .limit(2)

    if (staffByNameError) {
      throw new Error(staffByNameError.message)
    }

    if ((staffByNameRows?.length || 0) > 1) {
      throw new Error("Có nhiều hồ sơ nhân sự trùng họ tên. Vui lòng liên hệ admin để gán email đúng người.")
    }

    const nameEmail = staffByNameRows?.[0]?.email || null
    if (nameEmail && nameEmail.includes("@")) return nameEmail
  }

  throw new Error("Chưa cấu hình email cá nhân cho tài khoản này trong Nhân sự")
}

export function maskEmail(email: string) {
  const [localPart, domain] = email.split("@")
  if (!localPart || !domain) return email
  if (localPart.length <= 2) return `${localPart[0] || "*"}*@${domain}`
  return `${localPart.slice(0, 2)}***${localPart.slice(-1)}@${domain}`
}

export function generateOtp() {
  return `${Math.floor(100000 + Math.random() * 900000)}`
}

export async function invalidateExistingOtpChallenges(userId: string, actionType: SensitiveActionType) {
  await supabaseAdmin
    .from("security_otp_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("action_type", actionType)
    .is("consumed_at", null)
}

export async function createOtpChallenge(params: {
  userId: string
  actionType: SensitiveActionType
  recipientEmail: string
  otp: string
}) {
  const otpHash = await bcrypt.hash(params.otp, 10)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  const { data, error } = await supabaseAdmin
    .from("security_otp_challenges")
    .insert({
      user_id: params.userId,
      action_type: params.actionType,
      recipient_email: params.recipientEmail,
      otp_hash: otpHash,
      expires_at: expiresAt,
    })
    .select("id, expires_at")
    .single()

  if (error || !data) {
    throw new Error(error?.message || "Không tạo được yêu cầu OTP")
  }

  return data as { id: string; expires_at: string }
}

export async function verifyOtpChallenge(params: {
  userId: string
  actionType: SensitiveActionType
  challengeId: string
  otp: string
}) {
  const { data, error } = await supabaseAdmin
    .from("security_otp_challenges")
    .select("id, expires_at, consumed_at")
    .eq("id", params.challengeId)
    .eq("user_id", params.userId)
    .eq("action_type", params.actionType)
    .single()

  if (error || !data) {
    throw new Error("Mã OTP không hợp lệ")
  }

  if (data.consumed_at) {
    throw new Error("Mã OTP này đã được sử dụng")
  }

  if (new Date(data.expires_at).getTime() < Date.now()) {
    throw new Error("Mã OTP đã hết hạn")
  }

  // Bug thật đã xác nhận 2026-08-07 (audit bảo mật): trước đây không có bất kỳ giới hạn số lần
  // thử nào — mã OTP 6 số (900.000 khả năng) có thể bị brute-force trực tiếp qua endpoint này
  // trong suốt 10 phút hiệu lực. RPC `security_otp_challenge_claim_attempt` tăng `attempt_count`
  // và trả về `otp_hash` MỚI NHẤT một cách atomic — mệnh đề `attempt_count < 5` nằm ngay trong
  // câu UPDATE nên dù bao nhiêu request đoán OTP được gửi song song, tối đa đúng 5 lần "claim"
  // thành công, không thể lách qua bằng cách gửi dồn dập để né rate-limit.
  const { data: claimRows, error: claimError } = await supabaseAdmin.rpc(
    "security_otp_challenge_claim_attempt",
    {
      p_challenge_id: params.challengeId,
      p_user_id: params.userId,
      p_action_type: params.actionType,
    },
  )

  const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as
    | { otp_hash: string; attempt_count: number }
    | undefined

  if (claimError || !claim) {
    throw new Error("Đã nhập sai quá nhiều lần hoặc mã OTP không còn hiệu lực, vui lòng yêu cầu mã mới.")
  }

  const matched = await bcrypt.compare(params.otp, claim.otp_hash)
  if (!matched) {
    const remaining = Math.max(0, MAX_OTP_ATTEMPTS - claim.attempt_count)
    throw new Error(
      remaining > 0
        ? `Mã OTP không đúng (còn ${remaining} lần thử)`
        : "Mã OTP không đúng. Đã hết lượt thử, vui lòng yêu cầu mã mới.",
    )
  }

  await supabaseAdmin
    .from("security_otp_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.id as string)
}

// Bug thật đã xác nhận 2026-08-07 (audit bảo mật): trước đây actionToken không có `jti`, chỉ được
// xác thực bằng chữ ký + hạn 10 phút + khớp userId/actionType — nghĩa là CÙNG 1 actionToken có thể
// tái sử dụng NHIỀU LẦN để lặp lại cùng 1 thao tác nhạy cảm (đổi chữ ký/PIN/mật khẩu) trong suốt
// 10 phút hiệu lực, dù ý định thiết kế là "1 lần xác thực OTP = 1 lần đổi". Giờ gắn `jti` ngẫu
// nhiên vào token VÀ lưu lại đúng challenge đã sinh ra nó — `verifySensitiveActionToken()` đánh
// dấu `action_token_used_at` atomically khi tiêu thụ, token dùng lần 2 sẽ bị từ chối dù chữ ký và
// hạn vẫn còn hợp lệ.
export async function issueSensitiveActionToken(payload: ActionTokenPayload, challengeId: string) {
  const jti = randomUUID()

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime("10m")
    .sign(ACTION_TOKEN_SECRET)

  const { error } = await supabaseAdmin
    .from("security_otp_challenges")
    .update({ action_token_jti: jti })
    .eq("id", challengeId)

  if (error) {
    throw new Error("Không tạo được xác thực thay đổi")
  }

  return token
}

export async function verifySensitiveActionToken(token: string, userId: string, actionType: SensitiveActionType) {
  const verified = await jwtVerify(token, ACTION_TOKEN_SECRET)
  const payload = verified.payload as Partial<ActionTokenPayload> & { jti?: string }
  if (payload.userId !== userId || payload.actionType !== actionType || !payload.jti) {
    throw new Error("Xác thực thay đổi không hợp lệ")
  }

  // `.update(...).is("action_token_used_at", null)` dịch thành đúng 1 câu
  // `UPDATE ... WHERE action_token_jti = ? AND action_token_used_at IS NULL` — Postgres tự
  // serialize các UPDATE cùng dòng nên atomic: chỉ lần gọi ĐẦU TIÊN với đúng jti này khớp được
  // điều kiện, các lần gọi lại sau (kể cả gửi song song) đều không còn dòng nào để cập nhật.
  const { data, error } = await supabaseAdmin
    .from("security_otp_challenges")
    .update({ action_token_used_at: new Date().toISOString() })
    .eq("action_token_jti", payload.jti)
    .is("action_token_used_at", null)
    .select("id")
    .maybeSingle()

  if (error || !data) {
    throw new Error("Xác thực thay đổi đã được sử dụng hoặc không còn hiệu lực, vui lòng thực hiện lại từ đầu.")
  }
}

export async function sendOtpEmail(params: {
  email: string
  otp: string
  userName: string
  actionType: SensitiveActionType
}) {
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD

  if (!gmailUser || !gmailPass) {
    throw new Error("Chưa cấu hình email OTP trên máy chủ")
  }

  const actionLabelMap: Record<SensitiveActionType, string> = {
    change_pin: "đổi PIN ký duyệt",
    change_signature: "đổi chữ ký cá nhân",
    change_password: "đổi mật khẩu",
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  })

  await transporter.sendMail({
    from: `"Rubber ERP" <${gmailUser}>`,
    to: params.email,
    subject: `[Rubber ERP] OTP xác nhận ${actionLabelMap[params.actionType]}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <div style="background:#0f766e;padding:18px 24px;color:#fff">
          <h2 style="margin:0;font-size:18px">Xác nhận ${actionLabelMap[params.actionType]}</h2>
        </div>
        <div style="padding:24px;background:#fff;color:#0f172a">
          <p>Xin chào ${params.userName},</p>
          <p>Hệ thống vừa nhận yêu cầu ${actionLabelMap[params.actionType]}.</p>
          <p style="margin:20px 0 10px">Mã OTP của bạn là:</p>
          <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0f766e">${params.otp}</div>
          <p style="margin-top:20px;color:#475569">Mã có hiệu lực trong 10 phút. Nếu bạn không thực hiện thao tác này, hãy đổi mật khẩu ngay.</p>
        </div>
      </div>
    `,
  })
}
