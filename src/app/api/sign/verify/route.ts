import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { SignJWT } from "jose"
import {
  requireAuthUser,
  supabaseAdmin,
  assertNotRateLimited,
  recordFailedVerifyAttempt,
} from "@/app/api/account/_lib/security"

const JWT_SECRET = new TextEncoder().encode(
  process.env.SIGN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { userId, pin, docId, docType } = await req.json()

    if (!userId || !pin || !docId || !docType) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    if (authUser.id !== userId) {
      return NextResponse.json({ error: "Không có quyền thực hiện thao tác này" }, { status: 403 })
    }

    // Vá bảo mật 2026-08-27 (Giai đoạn 0 mục 1-2 của kế hoạch ký số dùng chung): route này
    // trước đây không hề rate-limit hay ghi log lần nhập PIN sai — PIN có thể bị brute-force
    // trực tiếp qua endpoint này. Chặn TRƯỚC khi so PIN, cùng cửa sổ 5 lần/15 phút đã dùng cho
    // đổi mật khẩu/PIN/chữ ký ở account module.
    await assertNotRateLimited(userId)

    const { data: pinRow, error } = await supabaseAdmin
      .from("sign_pins")
      .select("pin_hash")
      .eq("user_id", userId)
      .single()

    if (error || !pinRow) {
      return NextResponse.json(
        { error: "Chưa thiết lập PIN ký duyệt. Vào Cài đặt để tạo PIN." },
        { status: 404 },
      )
    }

    const valid = await bcrypt.compare(pin, pinRow.pin_hash as string)
    if (!valid) {
      await recordFailedVerifyAttempt(userId)
      return NextResponse.json({ error: "PIN không đúng" }, { status: 401 })
    }

    const token = await new SignJWT({ userId, docId, docType })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(JWT_SECRET)

    return NextResponse.json({ ok: true, token })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 400 },
    )
  }
}
