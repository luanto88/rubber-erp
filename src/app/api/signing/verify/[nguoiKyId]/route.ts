import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { verifyPadesSignature } from "@/lib/signing/verify-pades"

export const dynamic = "force-dynamic"

// Route CÔNG KHAI (không yêu cầu đăng nhập) — mở khi bấm link nhúng trên đúng ô con dấu chữ
// ký của PDF đã ký (xem src/lib/signing/requests.ts's signField()). Mirror đúng mức bảo mật
// của các trang tra cứu công khai đã có (/storage, /product-label) — chỉ lộ thông tin ĐÃ hiển
// thị công khai trên chính con dấu (tên, thời gian ký) cộng trạng thái xác thực, không lộ gì
// thêm.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ nguoiKyId: string }> }) {
  try {
    const { nguoiKyId } = await params
    const supabase = getSupabaseAdmin()

    // `pades_error` (migration 20260901) là cột chẩn đoán MỚI — SELECT nhiều cột mà 1 cột
    // chưa tồn tại sẽ bị Postgres từ chối TOÀN BỘ câu lệnh, không phải chỉ thiếu field đó.
    // Thử full trước, fallback về bộ cột cũ (chắc chắn đã có) nếu migration chưa chạy — để
    // route này không bị sập hoàn toàn chỉ vì 1 cột chẩn đoán còn thiếu.
    type NguoiKyRow = {
      id: string; user_id: string; yeu_cau_id: string; thu_tu: number; vai_tro: string
      trang_thai: string; ky_luc: string | null; pades_sig_index: number | null; pades_error?: string | null
    }
    let nguoiKy: NguoiKyRow | null = null
    const full = await supabase
      .from("nguoi_ky")
      .select("id, user_id, yeu_cau_id, thu_tu, vai_tro, trang_thai, ky_luc, pades_sig_index, pades_error")
      .eq("id", nguoiKyId)
      .maybeSingle()
    if (!full.error) {
      nguoiKy = full.data as NguoiKyRow | null
    } else {
      const base = await supabase
        .from("nguoi_ky")
        .select("id, user_id, yeu_cau_id, thu_tu, vai_tro, trang_thai, ky_luc, pades_sig_index")
        .eq("id", nguoiKyId)
        .maybeSingle()
      nguoiKy = base.data as NguoiKyRow | null
    }
    if (!nguoiKy) {
      return NextResponse.json({ error: "Không tìm thấy chữ ký này" }, { status: 404 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", nguoiKy.user_id)
      .maybeSingle()
    const signerName = (profile?.full_name as string) || (profile?.username as string) || "Không rõ"

    if (nguoiKy.trang_thai !== "da_ky") {
      return NextResponse.json({
        signerName,
        vaiTro: nguoiKy.vai_tro,
        kyLuc: null,
        valid: false,
        reason: "Người này chưa ký hồ sơ này",
      })
    }

    if (nguoiKy.pades_sig_index === null || nguoiKy.pades_sig_index === undefined) {
      return NextResponse.json({
        signerName,
        vaiTro: nguoiKy.vai_tro,
        kyLuc: nguoiKy.ky_luc,
        valid: false,
        reason: nguoiKy.pades_error
          ? `Chữ ký này chưa được ký số điện tử (chỉ có con dấu hình ảnh) — ${nguoiKy.pades_error}`
          : "Chữ ký này chưa được ký số điện tử (chỉ có con dấu hình ảnh)",
      })
    }

    const { data: yeuCau, error: ycErr } = await supabase
      .from("yeu_cau_ky")
      .select("file_hien_tai")
      .eq("id", nguoiKy.yeu_cau_id)
      .maybeSingle()
    if (ycErr || !yeuCau?.file_hien_tai) {
      return NextResponse.json({
        signerName,
        vaiTro: nguoiKy.vai_tro,
        kyLuc: nguoiKy.ky_luc,
        valid: false,
        reason: "Không tìm thấy file đã ký để xác thực",
      })
    }

    const fileRes = await fetch(yeuCau.file_hien_tai as string)
    if (!fileRes.ok) {
      return NextResponse.json({
        signerName,
        vaiTro: nguoiKy.vai_tro,
        kyLuc: nguoiKy.ky_luc,
        valid: false,
        reason: "Không tải được file để xác thực",
      })
    }
    const pdfBytes = Buffer.from(await fileRes.arrayBuffer())
    const result = verifyPadesSignature(pdfBytes, nguoiKy.pades_sig_index as number)

    return NextResponse.json({
      signerName,
      vaiTro: nguoiKy.vai_tro,
      kyLuc: nguoiKy.ky_luc,
      ...result,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
