import { NextRequest, NextResponse } from "next/server"
import {
  accountErrorResponse,
  assertAccountActive,
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

    // Tài khoản có thể bị khóa GIỮA lúc request-otp và verify-otp (2 request cách nhau vài phút
    // chờ đọc email) — chặn lại ở đây thay vì chỉ kiểm tra 1 lần ở bước request-otp.
    await assertAccountActive(userId)

    await verifyOtpChallenge({
      userId,
      actionType: actionType as SensitiveActionType,
      challengeId,
      otp: String(otp),
    })

    const actionToken = await issueSensitiveActionToken(
      { userId, actionType: actionType as SensitiveActionType },
      challengeId,
    )

    return NextResponse.json({ ok: true, actionToken })
  } catch (err) {
    return accountErrorResponse(err, "Lỗi máy chủ")
  }
}
