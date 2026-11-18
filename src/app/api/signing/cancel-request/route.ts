import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { cancelSigningRequest } from "@/lib/signing/requests"

export const dynamic = "force-dynamic"

// Hủy 1 yêu cầu ký còn đang luân chuyển — chỉ người tạo (nguoi_tao) hoặc admin. Không qua PIN
// JWT như /api/signing/sign-field vì hủy không phải hành động ký, chỉ cần xác thực đăng nhập
// thường (Bearer token), mirror đúng /api/signing/create-request.
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { yeuCauId, force, lyDo } = (await req.json()) as { yeuCauId?: string; force?: boolean; lyDo?: string }
    if (!yeuCauId) {
      return NextResponse.json({ error: "Thiếu yeuCauId" }, { status: 400 })
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role, factory_id")
      .eq("id", authUser.id)
      .single()
    const isAdmin = profile?.role === "admin"

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || ""
    const thietBi = req.headers.get("user-agent") || ""

    // force: admin huỷ yêu cầu ký đã có người ký (để sửa biên bản) — bắt lý do, kiểm cùng nhà máy.
    const result = await cancelSigningRequest({
      yeuCauId,
      userId: authUser.id,
      isAdmin,
      ip,
      thietBi,
      force: !!force,
      lyDo,
      factoryId: force ? (profile?.factory_id as string | undefined) : undefined,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
