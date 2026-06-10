import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

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

    let code: string | null = null

    if (profile.department_id) {
      const { data: dept } = await supabaseAdmin
        .from("departments")
        .select("code")
        .eq("id", profile.department_id)
        .single()
      code = (dept?.code as string) || null
    } else if (profile.department) {
      const { data: dept } = await supabaseAdmin
        .from("departments")
        .select("code")
        .eq("name", profile.department)
        .limit(1)
        .maybeSingle()
      code = (dept?.code as string) || null
    }

    return NextResponse.json({ code })
  } catch {
    return NextResponse.json({ code: null })
  }
}
