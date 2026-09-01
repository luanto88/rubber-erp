import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { reopenSigningRequest } from "@/lib/signing/requests"

export const dynamic = "force-dynamic"

// "Mở lại để ký lại" 1 yêu cầu ký ĐÃ hoàn tất — ADMIN-ONLY thật sự (đọc profiles.role tại đây,
// không tin bất kỳ cờ nào client tự khai), mirror /api/signing/cancel-request. Không qua PIN
// JWT vì đây không phải hành động ký.
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { yeuCauId } = (await req.json()) as { yeuCauId?: string }
    if (!yeuCauId) {
      return NextResponse.json({ error: "Thiếu yeuCauId" }, { status: 400 })
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", authUser.id)
      .single()
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Chỉ admin mới được mở lại yêu cầu ký đã hoàn tất" }, { status: 403 })
    }

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || ""
    const thietBi = req.headers.get("user-agent") || ""

    const result = await reopenSigningRequest({ yeuCauId, userId: authUser.id, ip, thietBi })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
