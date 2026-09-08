import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { verifyPadesSignature } from "@/lib/signing/verify-pades"

export const dynamic = "force-dynamic"

// Route CÔNG KHAI (không yêu cầu đăng nhập) — mở khi bấm link nhúng trên đúng ô con dấu chữ ký
// của tài liệu đã ký (xem `api/documents/sign/route.ts`'s performFileStamp cho Văn bản nội bộ và
// `api/sign/generate-pdf/route.ts` cho ISO).
//
// DÙNG CHUNG cho 2 module ký RIÊNG (Văn bản nội bộ + ISO) — cả hai đều KHÔNG có bản ghi `nguoi_ky`
// như hệ ký dùng chung nên không dùng lại được /api/signing/verify/[nguoiKyId]. Ở đây mỗi CHỮ KÝ =
// mỗi DÒNG `doc_approval_log` (bảng bất biến, đã có `content_hash` từ Giai đoạn 0) → tra thẳng
// theo id dòng log.
//
// ⚠️ Giữ nguyên đường dẫn `/api/documents/verify/...` và `/van-ban-verify/...` kể cả khi mở rộng
// sang ISO: link đã được IN VÀO các file PDF đã ký từ trước, không thể đổi lại được nữa.
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

const SUPPORTED_DOC_TYPES = new Set(["van_ban", "iso"])

/** "Ký bước 2" / "Phê duyệt" — nhãn hiển thị cho người xem, không phải mã nội bộ. */
function buocLabel(row: LogRow): string {
  if (row.doc_type === "iso") {
    // ISO chỉ niêm phong đúng 1 lần lúc phê duyệt (xem generate-pdf/route.ts's shouldSealPades);
    // dòng log không kèm chữ ký số là các lượt đóng dấu soạn thảo/xem xét.
    return row.pades_sig_index === null || row.pades_sig_index === undefined
      ? "Đóng dấu tài liệu"
      : "Phê duyệt ban hành"
  }
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

    if (!log || !SUPPORTED_DOC_TYPES.has(log.doc_type)) {
      return NextResponse.json({ error: "Không tìm thấy chữ ký này" }, { status: 404 })
    }

    const isIso = log.doc_type === "iso"

    const [{ data: profile }, { data: doc }] = await Promise.all([
      log.user_id
        ? supabase.from("profiles").select("full_name, username").eq("id", log.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
      isIso
        ? supabase
            .from("iso_documents")
            .select("ma_tai_lieu, ten_tai_lieu, trang_thai, file_signed_pdf_url")
            .eq("id", log.doc_id)
            .maybeSingle()
        : supabase
            .from("van_ban_documents")
            .select("ma_van_ban, ten_van_ban, trang_thai, file_signed_pdf_url")
            .eq("id", log.doc_id)
            .maybeSingle(),
    ])

    const docRow = (doc ?? null) as Record<string, unknown> | null
    const trangThai = (docRow?.trang_thai as string) || null

    const base = {
      docType: log.doc_type,
      signerName: (profile?.full_name as string) || (profile?.username as string) || "Không rõ",
      buoc: buocLabel(log),
      kyLuc: log.created_at,
      maTaiLieu: ((isIso ? docRow?.ma_tai_lieu : docRow?.ma_van_ban) as string) || null,
      tenTaiLieu: ((isIso ? docRow?.ten_tai_lieu : docRow?.ten_van_ban) as string) || null,
      trangThai,
      contentHash: log.content_hash,
    }

    /**
     * Phân biệt "chữ ký hỏng do quy trình bình thường" với "chữ ký hỏng thật sự".
     *
     * Khi 1 tài liệu ISO hết hiệu lực, `api/sign/restamp-pdf/route.ts` GHI ĐÈ `file_signed_pdf_url`
     * bằng bản đã đóng thêm dấu "Hết hiệu lực" ⇒ chữ ký PAdES của bản ban hành chắc chắn không còn
     * khớp. Đây là hệ quả đã được chấp nhận của quyết định "ghi đè khi hết hiệu lực", KHÔNG phải
     * dấu hiệu giả mạo. Thiếu nhánh này thì mọi tài liệu hết hiệu lực đều hiện cảnh báo đỏ "file đã
     * bị sửa" và gây hoảng khi đánh giá ISO.
     */
    const severityFor = (valid: boolean): "ok" | "warn" | "error" => {
      if (valid) return "ok"
      if (isIso && trangThai === "het_hieu_luc") return "warn"
      return "error"
    }

    if (log.pades_sig_index === null || log.pades_sig_index === undefined) {
      return NextResponse.json({
        ...base,
        valid: false,
        severity: severityFor(false),
        reason: log.pades_error
          ? `Bước ký này không có chữ ký số (chỉ có con dấu hình ảnh) — ${log.pades_error}`
          : "Bước ký này không có chữ ký số (chỉ có con dấu hình ảnh)",
      })
    }

    if (!docRow?.file_signed_pdf_url) {
      return NextResponse.json({
        ...base,
        valid: false,
        severity: severityFor(false),
        reason: "Không tìm thấy file đã ký để xác thực",
      })
    }

    // Xác thực trên file MỚI NHẤT của tài liệu.
    // - Văn bản: nhờ incremental update, chữ ký của mọi bước trước vẫn còn nguyên trong file cuối.
    // - ISO: file chỉ có đúng 1 niêm phong (index 0) đặt lúc phê duyệt.
    const fileRes = await fetch(docRow.file_signed_pdf_url as string)
    if (!fileRes.ok) {
      return NextResponse.json({
        ...base,
        valid: false,
        severity: severityFor(false),
        reason: "Không tải được file để xác thực",
      })
    }
    const pdfBytes = Buffer.from(await fileRes.arrayBuffer())
    const result = verifyPadesSignature(pdfBytes, log.pades_sig_index as number)

    return NextResponse.json({ ...base, ...result, severity: severityFor(result.valid) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
