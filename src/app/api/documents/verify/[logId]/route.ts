import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { verifyPadesSignature } from "@/lib/signing/verify-pades"

export const dynamic = "force-dynamic"

// Route CÔNG KHAI (không yêu cầu đăng nhập) — mở khi bấm link nhúng trên đúng ô con dấu chữ ký
// của văn bản nội bộ đã ký (xem api/documents/sign/route.ts's performFileStamp).
//
// Module Văn bản dùng hệ ký RIÊNG, KHÔNG có bản ghi `nguoi_ky` như hệ ký dùng chung nên không
// dùng lại được /api/signing/verify/[nguoiKyId]. Ở đây mỗi CHỮ KÝ = mỗi DÒNG `doc_approval_log`
// (bảng bất biến, đã có `content_hash` từ Giai đoạn 0) → tra thẳng theo id dòng log.
//
// Mức lộ thông tin mirror đúng route xác thực đã có: chỉ những gì vốn đã in công khai trên chính
// con dấu (tên người ký, bước ký, thời gian) cộng trạng thái xác thực — không lộ thêm gì.

type LogRow = {
  id: string
  doc_id: string
  doc_type: string
  user_id: string | null
  action: string | null
  buoc_ky: number | null
  content_hash: string | null
  created_at: string
  pades_sig_index?: number | null
  pades_error?: string | null
}

/** "Ký bước 2" / "Phê duyệt" — nhãn hiển thị cho người xem, không phải mã nội bộ. */
function buocLabel(row: LogRow): string {
  if (row.action === "phe_duyet") return "Phê duyệt"
  if (row.buoc_ky != null) return `Ký bước ${row.buoc_ky}`
  return "Ký xác nhận"
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ logId: string }> }) {
  try {
    const { logId } = await params
    const supabase = getSupabaseAdmin()

    // `pades_sig_index`/`pades_error` (migration 20260905) là cột MỚI — SELECT nhiều cột mà 1 cột
    // chưa tồn tại sẽ bị Postgres từ chối TOÀN BỘ câu lệnh. Thử full trước, fallback bộ cột cũ
    // (chắc chắn đã có) để trang xác thực không sập hoàn toàn khi migration chưa chạy.
    const BASE_COLS = "id, doc_id, doc_type, user_id, action, buoc_ky, content_hash, created_at"
    let log: LogRow | null = null
    const full = await supabase
      .from("doc_approval_log")
      .select(`${BASE_COLS}, pades_sig_index, pades_error`)
      .eq("id", logId)
      .maybeSingle()
    if (!full.error) {
      log = full.data as LogRow | null
    } else {
      const base = await supabase.from("doc_approval_log").select(BASE_COLS).eq("id", logId).maybeSingle()
      log = base.data as LogRow | null
    }

    if (!log || log.doc_type !== "van_ban") {
      return NextResponse.json({ error: "Không tìm thấy chữ ký này" }, { status: 404 })
    }

    const [{ data: profile }, { data: doc }] = await Promise.all([
      log.user_id
        ? supabase.from("profiles").select("full_name, username").eq("id", log.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("van_ban_documents")
        .select("ma_van_ban, ten_van_ban, trang_thai, file_signed_pdf_url")
        .eq("id", log.doc_id)
        .maybeSingle(),
    ])

    const base = {
      signerName: (profile?.full_name as string) || (profile?.username as string) || "Không rõ",
      buoc: buocLabel(log),
      kyLuc: log.created_at,
      maVanBan: (doc?.ma_van_ban as string) || null,
      tenVanBan: (doc?.ten_van_ban as string) || null,
      trangThaiVanBan: (doc?.trang_thai as string) || null,
      contentHash: log.content_hash,
    }

    if (log.pades_sig_index === null || log.pades_sig_index === undefined) {
      return NextResponse.json({
        ...base,
        valid: false,
        reason: log.pades_error
          ? `Bước ký này không có chữ ký số (chỉ có con dấu hình ảnh) — ${log.pades_error}`
          : "Bước ký này không có chữ ký số (chỉ có con dấu hình ảnh)",
      })
    }

    if (!doc?.file_signed_pdf_url) {
      return NextResponse.json({ ...base, valid: false, reason: "Không tìm thấy file đã ký để xác thực" })
    }

    // Xác thực trên file MỚI NHẤT của văn bản: nhờ incremental update, chữ ký của mọi bước trước
    // vẫn còn nguyên trong file cuối — chữ ký index N luôn tra được ở đây.
    const fileRes = await fetch(doc.file_signed_pdf_url as string)
    if (!fileRes.ok) {
      return NextResponse.json({ ...base, valid: false, reason: "Không tải được file để xác thực" })
    }
    const pdfBytes = Buffer.from(await fileRes.arrayBuffer())
    const result = verifyPadesSignature(pdfBytes, log.pades_sig_index as number)

    return NextResponse.json({ ...base, ...result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
