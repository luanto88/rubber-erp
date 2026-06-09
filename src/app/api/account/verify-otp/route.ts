import { NextRequest, NextResponse } from "next/server"
import {
  issueSensitiveActionToken,
  requireAuthUser,
  verifyOtpChallenge,
  type SensitiveActionType,
} from "../_lib/security"

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { userId, actionType, challengeId, otp } = await req.json()

    if (!userId || !actionType || !challengeId || !otp) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    if (authUser.id !== userId) {
      return NextResponse.json({ error: "Không có quyền thực hiện thao tác này" }, { status: 403 })
    }

    if (!["change_pin", "change_signature", "change_password"].includes(actionType)) {
      return NextResponse.json({ error: "Loại thao tác không hợp lệ" }, { status: 400 })
    }

    await verifyOtpChallenge({
      userId,
      actionType: actionType as SensitiveActionType,
      challengeId,
      otp: String(otp),
    })

    const actionToken = await issueSensitiveActionToken({
      userId,
      actionType: actionType as SensitiveActionType,
    })

    return NextResponse.json({ ok: true, actionToken })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi máy chủ" },
      { status: 400 },
    )
  }
}
