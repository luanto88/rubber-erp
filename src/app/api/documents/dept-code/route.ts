import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveUserDeptCode } from "@/lib/documents-dept"

export async function GET(req: NextRequest) {
  try {
    await requireAuthUser(req)

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get("userId")
    if (!userId) return NextResponse.json({ code: null })

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("department, department_id")
      .eq("id", userId)
      .single()

    if (!profile) return NextResponse.json({ code: null })

    const code = await resolveUserDeptCode(supabaseAdmin, profile)

    return NextResponse.json({ code })
  } catch {
    return NextResponse.json({ code: null })
  }
}
