import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { KIEN_LETTERS, resolveProductLabelLookupTarget, type KienLetter } from "@/lib/product-label"

export const dynamic = "force-dynamic"

// GET /api/product-label/lookup?f=<factoryId>&lo=<maLo>&kien=<A|B|C|D>
//
// Route CÔNG KHAI — dùng cho `/product-label` (quét QR nhãn kiện thành phẩm dán trên pallet,
// không cần đăng nhập). Trước 2026-08-08, trang này đọc thẳng
// `lots`/`qc_results`/`ngans`/`lot_transactions`/`lot_prediction_lots` bằng anon key (RLS
// "Allow all"/`USING (true)` cho phép đọc dữ liệu của MỌI nhà máy). Route này dùng service role
// để chỉ trả về thông tin của ĐÚNG `(factoryId, maLo, kien)` đã yêu cầu, cho phép khóa RLS
// SELECT các bảng trên về `authenticated`-only mà không phá vỡ tính năng quét QR công khai.
export async function GET(req: NextRequest) {
  try {
    const factoryId = req.nextUrl.searchParams.get("f")?.trim() || ""
    const maLo = req.nextUrl.searchParams.get("lo")?.trim() || ""
    const kienParam = req.nextUrl.searchParams.get("kien")?.trim().toUpperCase() || ""

    if (!factoryId || !maLo || !(KIEN_LETTERS as string[]).includes(kienParam)) {
      return NextResponse.json({ error: "Thiếu hoặc sai tham số tra cứu." }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const result = await resolveProductLabelLookupTarget(factoryId, maLo, kienParam as KienLetter, admin)

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
