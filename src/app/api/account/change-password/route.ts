import { NextRequest, NextResponse } from "next/server"
import {
  accountErrorResponse,
  assertAccountActive,
  requireAuthUser,
  supabaseAdmin,
  verifySensitiveActionToken,
} from "../_lib/security"

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { userId, newPassword, actionToken } = await req.json()

    if (!userId || !newPassword || !actionToken) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    if (authUser.id !== userId) {
      return NextResponse.json({ error: "Không có quyền thực hiện thao tác này" }, { status: 403 })
    }

    if (String(newPassword).length < 6) {
      return NextResponse.json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự" }, { status: 400 })
    }

    await assertAccountActive(userId)
    await verifySensitiveActionToken(String(actionToken), userId, "change_password")

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: String(newPassword),
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return accountErrorResponse(err, "Lỗi máy chủ")
  }
}
