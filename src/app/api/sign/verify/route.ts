import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import bcrypt from "bcryptjs"
import { SignJWT } from "jose"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const JWT_SECRET = new TextEncoder().encode(
  process.env.SIGN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const { userId, pin, docId, docType } = await req.json()

    if (!userId || !pin || !docId || !docType) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    // Lấy pin_hash từ DB
    const { data: pinRow, error } = await supabaseAdmin
      .from("sign_pins")
      .select("pin_hash")
      .eq("user_id", userId)
      .single()

    if (error || !pinRow) {
      return NextResponse.json(
        { error: "Chưa thiết lập PIN ký duyệt. Vào Cài đặt → Chữ ký cá nhân để tạo PIN." },
        { status: 404 },
      )
    }

    const valid = await bcrypt.compare(pin, pinRow.pin_hash)
    if (!valid) {
      return NextResponse.json({ error: "PIN không đúng" }, { status: 401 })
    }

    // Tạo JWT ngắn hạn 5 phút, scope = docId
    const token = await new SignJWT({ userId, docId, docType })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(JWT_SECRET)

    return NextResponse.json({ ok: true, token })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
