import { NextRequest, NextResponse } from "next/server"
import { jwtVerify } from "jose"
import { signField, type SigningPlacementOverride } from "@/lib/signing/requests"

export const dynamic = "force-dynamic"

// Token phát bởi /api/sign/verify (dùng chung route PIN đã có sẵn, gọi với
// docId = yeuCauId, docType = "yeu_cau_ky") — cùng cơ chế JWT ngắn hạn (15 phút)
// đang dùng cho ISO/Văn bản, không tạo route xác thực PIN riêng.
const JWT_SECRET = new TextEncoder().encode(
  process.env.SIGN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const { token, yeuCauId, placementOverrides } = (await req.json()) as {
      token: string
      yeuCauId: string
      placementOverrides?: SigningPlacementOverride[]
    }
    if (!token || !yeuCauId) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    let payload: { userId: string; docId: string; docType: string }
    try {
      const { payload: verified } = await jwtVerify(token, JWT_SECRET)
      payload = verified as typeof payload
    } catch {
      return NextResponse.json({ error: "Token không hợp lệ hoặc đã hết hạn" }, { status: 401 })
    }

    if (payload.docType !== "yeu_cau_ky" || payload.docId !== yeuCauId) {
      return NextResponse.json({ error: "Token không khớp với hồ sơ đang ký" }, { status: 400 })
    }

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || ""
    const thietBi = req.headers.get("user-agent") || ""
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin

    const result = await signField({ yeuCauId, userId: payload.userId, ip, thietBi, appOrigin, placementOverrides })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
