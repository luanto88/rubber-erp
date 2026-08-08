import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { loadStorageDetail, resolveStorageLookupTarget } from "@/lib/storage-detail"

export const dynamic = "force-dynamic"

// GET /api/storage/public-lookup?id=<nganId>&code=<maNgan>
//
// Route CÔNG KHAI — không yêu cầu đăng nhập, dùng cho `/storage` và `/dashboard/storage/[id]`
// (xem `dashboard/layout.tsx`'s `isPublicStorageLookup` — bypass toàn bộ phiên đăng nhập có
// chủ đích, mirror thiết kế "quét QR dán ngoài hiện trường xem được không cần đăng nhập").
//
// Trước 2026-08-08, trang này đọc thẳng `ngans`/`lots`/`dispatch_entries`/`lot_transactions`
// bằng anon key — RLS "Allow all" cho phép đọc dữ liệu của MỌI nhà máy, không chỉ đúng ngăn
// đang quét. Route này dùng service role để chỉ trả về ĐÚNG 1 ngăn khớp `id`/`code` đã yêu
// cầu (không dump nguyên bảng), cho phép khóa RLS SELECT của các bảng trên về
// `authenticated`-only mà không phá vỡ tính năng quét QR công khai.
export async function GET(req: NextRequest) {
  try {
    const admin = getSupabaseAdmin()
    const nganId = req.nextUrl.searchParams.get("id")
    const nganCode = req.nextUrl.searchParams.get("code")

    if (!nganId && !nganCode) {
      return NextResponse.json({ error: "Thiếu mã ngăn hoặc mã tra cứu." }, { status: 400 })
    }

    const target = await resolveStorageLookupTarget({ nganId, nganCode }, admin)
    const detail = await loadStorageDetail(target.factory_id, target.id, admin)

    return NextResponse.json(detail)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi server"
    const notFound = /khong tim thay|không tìm thấy/i.test(message)
    return NextResponse.json({ error: message }, { status: notFound ? 404 : 500 })
  }
}
