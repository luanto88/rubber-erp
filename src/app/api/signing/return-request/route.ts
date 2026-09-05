import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser } from "@/app/api/account/_lib/security"
import { returnSigningRequest } from "@/lib/signing/requests"
import { scheduleSigningNotify } from "@/lib/signing/notify"

export const dynamic = "force-dynamic"

// Trả về 1 yêu cầu ký cho (các) người ký trước sửa & ký lại — chỉ cần xác thực đăng nhập
// thường (Bearer token), không qua PIN JWT (không phải hành động ký), mirror
// /api/signing/cancel-request. Guard "có phải người ký hợp lệ, chưa ký, có ai đó trước mình
// đã ký chưa" nằm trong returnSigningRequest() (lib dùng chung), không lặp lại ở đây.
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { yeuCauId, lyDo } = (await req.json()) as { yeuCauId?: string; lyDo?: string }
    if (!yeuCauId) {
      return NextResponse.json({ error: "Thiếu yeuCauId" }, { status: 400 })
    }

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || ""
    const thietBi = req.headers.get("user-agent") || ""

    const { notifyPlan, ...result } = await returnSigningRequest({
      yeuCauId,
      userId: authUser.id,
      lyDo: lyDo || "",
      ip,
      thietBi,
    })

    // Báo (các) người bị trả về kèm lý do — trước đây họ không hề biết phải sửa & ký lại.
    scheduleSigningNotify(notifyPlan)

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
