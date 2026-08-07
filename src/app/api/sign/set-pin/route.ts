import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import {
  accountErrorResponse,
  assertAccountActive,
  requireAuthUser,
  supabaseAdmin,
  verifySensitiveActionToken,
} from "@/app/api/account/_lib/security"

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { userId, pin, actionToken } = await req.json()

    if (!userId || !pin) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    if (authUser.id !== userId) {
      return NextResponse.json({ error: "Không có quyền thực hiện thao tác này" }, { status: 403 })
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json({ error: "PIN phải là 4-6 chữ số" }, { status: 400 })
    }

    await assertAccountActive(userId)

    const { data: existingPin } = await supabaseAdmin
      .from("sign_pins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle()

    if (existingPin) {
      if (!actionToken) {
        return NextResponse.json({ error: "Thiếu xác thực OTP cho thao tác đổi PIN" }, { status: 403 })
      }
      await verifySensitiveActionToken(String(actionToken), userId, "change_pin")
    }

    const pin_hash = await bcrypt.hash(pin, 12)

    const { error } = await supabaseAdmin.from("sign_pins").upsert(
      { user_id: userId, pin_hash, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return accountErrorResponse(err, "Lỗi server")
  }
}
