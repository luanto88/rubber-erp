import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, assertAccountActive, isSessionExpiredError } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { mintSignedUrlForPath } from "@/lib/secure-file-url"

export const dynamic = "force-dynamic"

const BUCKET = "iso-documents"
// Ảnh chữ ký thường hiển thị lâu hơn 1 lần mở file (preview khi đặt vị trí ký, xem hồ sơ đã ký
// nhiều bước) — TTL dài hơn route file-url chính, nhưng vẫn hữu hạn.
const TTL_SECONDS = 300

// Route dùng chung mint Signed URL cho `signatures/{factory_id}/{user_id}/chu_ky.png` — thay
// thế toàn bộ điểm trước đây gọi `supabase.storage.from("iso-documents").getPublicUrl(sigPath)`
// trực tiếp từ client (Điều xe/Chất lượng/Bảo trì ký số, Soạn thảo ISO, Thực hiện hồ sơ ISO, Văn
// bản nội bộ, màn Cài đặt vị trí ký...). Xem kế hoạch vá bucket iso-documents (2026-09-20).
//
// Phạm vi quyền: cho xem chữ ký của bất kỳ ai CÙNG NHÀ MÁY (không giới hạn chỉ chính chủ/admin)
// — giữ đúng hành vi hiện có: nhiều luồng cần xem chữ ký của NGƯỜI KHÁC (preview đặt vị trí ký
// hàng loạt, xem hồ sơ đã có chữ ký của người ký trước, xem trước mẫu vị trí cho người ký bất
// kỳ) — trước đây bucket public nên hoàn toàn không có gate nào, giờ ít nhất đòi hỏi đăng nhập
// + cùng nhà máy.

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    await assertAccountActive(authUser.id)

    const admin = getSupabaseAdmin()
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("factory_id")
      .eq("id", authUser.id)
      .maybeSingle()
    if (profileError || !profile?.factory_id) {
      return NextResponse.json({ error: "Tài khoản chưa gắn nhà máy" }, { status: 403 })
    }

    const targetUserId = req.nextUrl.searchParams.get("userId") || authUser.id

    if (targetUserId !== authUser.id) {
      const { data: targetProfile } = await admin
        .from("profiles")
        .select("factory_id")
        .eq("id", targetUserId)
        .maybeSingle()
      if (!targetProfile || targetProfile.factory_id !== profile.factory_id) {
        return NextResponse.json({ error: "Không có quyền xem chữ ký này" }, { status: 403 })
      }
    }

    const path = `signatures/${profile.factory_id}/${targetUserId}/chu_ky.png`
    const url = await mintSignedUrlForPath(path, { bucket: BUCKET, ttlSeconds: TTL_SECONDS })
    if (!url) {
      return NextResponse.json({ error: "Người này chưa có ảnh chữ ký" }, { status: 404 })
    }

    return NextResponse.json({ url })
  } catch (err) {
    const status = isSessionExpiredError(err) ? 401 : 500
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status })
  }
}
