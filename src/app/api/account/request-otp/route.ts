import { NextRequest, NextResponse } from "next/server"
import {
  createOtpChallenge,
  generateOtp,
  getProfileAuthRow,
  invalidateExistingOtpChallenges,
  maskEmail,
  requireAuthUser,
  resolveOtpRecipient,
  sendOtpEmail,
  verifyCurrentPassword,
  verifyCurrentPin,
  type SensitiveActionType,
} from "../_lib/security"

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { userId, actionType, currentPassword, currentPin } = await req.json()

    if (!userId || !actionType || !currentPassword || !currentPin) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    if (authUser.id !== userId) {
      return NextResponse.json({ error: "Không có quyền thực hiện thao tác này" }, { status: 403 })
    }

    if (!["change_pin", "change_signature", "change_password"].includes(actionType)) {
      return NextResponse.json({ error: "Loại thao tác không hợp lệ" }, { status: 400 })
    }

    const profile = await getProfileAuthRow(userId)

    const passwordOk = await verifyCurrentPassword(profile, String(currentPassword))
    if (!passwordOk) {
      return NextResponse.json({ error: "Mật khẩu hiện tại không đúng" }, { status: 401 })
    }

    const pinOk = await verifyCurrentPin(userId, String(currentPin))
    if (!pinOk) {
      return NextResponse.json({ error: "PIN hiện tại không đúng" }, { status: 401 })
    }

    const recipientEmail = await resolveOtpRecipient(userId, profile.factory_id, profile.full_name)
    const otp = generateOtp()

    await invalidateExistingOtpChallenges(userId, actionType as SensitiveActionType)
    const challenge = await createOtpChallenge({
      userId,
      actionType: actionType as SensitiveActionType,
      recipientEmail,
      otp,
    })

    await sendOtpEmail({
      email: recipientEmail,
      otp,
      userName: profile.full_name,
      actionType: actionType as SensitiveActionType,
    })

    return NextResponse.json({
      ok: true,
      challengeId: challenge.id,
      maskedEmail: maskEmail(recipientEmail),
      expiresAt: challenge.expires_at,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi máy chủ" },
      { status: 500 },
    )
  }
}
