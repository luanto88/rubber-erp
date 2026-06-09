import { NextRequest } from "next/server"
import { createClient, type User as SupabaseUser } from "@supabase/supabase-js"
import { jwtVerify, SignJWT } from "jose"
import bcrypt from "bcryptjs"
import nodemailer from "nodemailer"
import { authEmailsForUsername } from "@/lib/auth"

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
}

export async function requireAuthUser(req: NextRequest): Promise<SupabaseUser> {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

  if (!token) {
    throw new Error("Phiên đăng nhập không hợp lệ")
  }

  const { data, error } = await supabaseAuth.auth.getUser(token)
  if (error || !data.user) {
    throw new Error("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
  }

  return data.user
}

export async function getProfileAuthRow(userId: string): Promise<ProfileAuthRow> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, username, auth_email, factory_id, full_name")
    .eq("id", userId)
    .single()

  if (error || !data) {
    throw new Error("Không tìm thấy hồ sơ người dùng")
  }

  return data as ProfileAuthRow
}

export async function verifyCurrentPassword(profile: ProfileAuthRow, password: string) {
  const candidates = Array.from(
    new Set([profile.auth_email, ...authEmailsForUsername(profile.username)]),
  )

  for (const email of candidates) {
    const result = await supabaseAuth.auth.signInWithPassword({ email, password })
    if (!result.error) {
      await supabaseAuth.auth.signOut()
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
    .select("id, otp_hash, expires_at, consumed_at")
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

  const matched = await bcrypt.compare(params.otp, data.otp_hash as string)
  if (!matched) {
    throw new Error("Mã OTP không đúng")
  }

  await supabaseAdmin
    .from("security_otp_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.id as string)
}

export async function issueSensitiveActionToken(payload: ActionTokenPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(ACTION_TOKEN_SECRET)
}

export async function verifySensitiveActionToken(token: string, userId: string, actionType: SensitiveActionType) {
  const verified = await jwtVerify(token, ACTION_TOKEN_SECRET)
  const payload = verified.payload as Partial<ActionTokenPayload>
  if (payload.userId !== userId || payload.actionType !== actionType) {
    throw new Error("Xác thực thay đổi không hợp lệ")
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
