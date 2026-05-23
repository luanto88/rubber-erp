import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import bcrypt from "bcryptjs"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const { userId, pin } = await req.json()

    if (!userId || !pin) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json({ error: "PIN phải là 4–6 chữ số" }, { status: 400 })
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
