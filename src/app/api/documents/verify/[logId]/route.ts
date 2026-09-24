import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { verifyPadesSignature } from "@/lib/signing/verify-pades"
import { parseStorageObjectPath } from "@/lib/secure-file-url"

export const dynamic = "force-dynamic"

const BUCKET = "iso-documents"

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

const SUPPORTED_DOC_TYPES = new Set(["van_ban", "iso", "iso_form"])

/** "Người lập" / "Thực hiện" / "Phê duyệt" — nhãn hiển thị cho người xem, lấy động từ cấu hình bước nếu có. */
function getBuocLabel(
  row: LogRow,
  thuTuKyJson?: Array<{ ten?: string }> | null,
  totalSteps?: number,
  docRow?: Record<string, unknown> | null,
): string {
  // 1. Ưu tiên lấy từ cấu hình các bước trong thu_tu_ky_json (dành cho Biểu mẫu ISO N bước)
  if (Array.isArray(thuTuKyJson) && typeof row.buoc_ky === "number" && row.buoc_ky >= 1) {
    const step = thuTuKyJson[row.buoc_ky - 1]
    if (step?.ten?.trim()) return step.ten.trim()
  }

  // 2. Nếu là Tài liệu ISO hoặc Biểu mẫu ISO
  if (row.doc_type === "iso" || row.doc_type === "iso_form") {
    const is2Step = docRow?.chon_quy_trinh === "2_step" || docRow?.cap_tl === "cap_2" || docRow?.cap_tl === "Cấp 2"
    if (is2Step) {
      if (row.action === "phe_duyet" || row.buoc_ky === 2 || (totalSteps && row.buoc_ky === totalSteps)) return "Phê duyệt"
      if (row.action === "soan_thao" || row.buoc_ky === 1) return "Soạn thảo / Người lập"
    }

    if (row.action === "phe_duyet" || (totalSteps && row.buoc_ky === totalSteps)) return "Phê duyệt"
    if (row.action === "soan_thao" || row.buoc_ky === 1) return "Soạn thảo / Người lập"
    if (row.action === "xem_xet" || row.buoc_ky === 2) return "Xem xét / Soát xét"
    if (row.buoc_ky != null) return `Ký bước ${row.buoc_ky}`
    return row.pades_sig_index === null || row.pades_sig_index === undefined
      ? "Đóng dấu xác nhận"
      : "Phê duyệt"
  }

  if (row.action === "phe_duyet") return "Phê duyệt"
  if (row.buoc_ky != null) return `Ký bước ${row.buoc_ky}`
  return "Ký xác nhận"
}

function resolveSignerName(
  r: LogRow,
  pMap: Map<string, string>,
  nguoiKy?: Record<string, { ten?: string; user_id?: string } | undefined> | null,
  docRow?: Record<string, unknown> | null,
): string {
  // 1. Ưu tiên lấy từ nguoi_ky (snapshot lúc ký của iso_form_instances)
  if (nguoiKy && typeof r.buoc_ky === "number") {
    const nk = nguoiKy[String(r.buoc_ky)]
    if (nk?.ten && nk.ten.trim()) return nk.ten.trim()
  }

  // 2. Tra từ user_id trong profileMap
  if (r.user_id && pMap.has(r.user_id) && pMap.get(r.user_id)) {
    return pMap.get(r.user_id)!
  }

  // 3. Với tài liệu ISO: snapshot lưu trong các cột soan_thao, xem_xet, phe_duyet
  if (docRow && (r.doc_type === "iso" || r.doc_type === "iso_form")) {
    if ((r.action === "soan_thao" || r.buoc_ky === 1) && typeof docRow.soan_thao === "string" && docRow.soan_thao.trim()) {
      return docRow.soan_thao.trim()
    }
    if ((r.action === "xem_xet" || r.buoc_ky === 2) && typeof docRow.xem_xet === "string" && docRow.xem_xet.trim()) {
      return docRow.xem_xet.trim()
    }
    if (r.action === "phe_duyet" && typeof docRow.phe_duyet === "string" && docRow.phe_duyet.trim()) {
      return docRow.phe_duyet.trim()
    }
  }

  return "Không rõ"
}

function resolveKyLuc(
  r: LogRow,
  nguoiKy?: Record<string, { ky_at?: string } | undefined> | null,
  docRow?: Record<string, unknown> | null,
): string | null {
  // 1. Nếu có trong nguoi_ky (của iso_form_instances)
  if (nguoiKy && typeof r.buoc_ky === "number") {
    const nk = nguoiKy[String(r.buoc_ky)]
    if (nk?.ky_at) return nk.ky_at
  }

  // 2. Nếu có trong docRow (của iso_documents)
  if (docRow) {
    if (r.action === "soan_thao" || r.buoc_ky === 1) {
      const at = (docRow.soan_thao_at || docRow.ngay_gui_duyet || docRow.ngay_tao) as string | undefined
      if (at) return at
    }
    if (r.action === "xem_xet" || r.buoc_ky === 2) {
      const at = (docRow.xem_xet_at || docRow.ngay_xem_xet) as string | undefined
      if (at) return at
    }
    if (r.action === "phe_duyet") {
      const at = (docRow.phe_duyet_at || docRow.ngay_ban_hanh) as string | undefined
      if (at) return at
    }
  }

  return r.created_at || null
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
    const isIsoForm = log.doc_type === "iso_form"

    let docRow: Record<string, unknown> | null = null
    let trangThai: string | null = null
    let maTaiLieu: string | null = null
    let tenTaiLieu: string | null = null
    let fileSignedPdfUrl: string | null = null
    let thuTuKy: Array<{ ten?: string; user_id?: string }> | null = null
    let nguoiKyMap: Record<string, { ten?: string; ky_at?: string; user_id?: string }> | null = null
    let soBuocTong: number | null = null

    if (isIsoForm) {
      const { data: formInst } = await supabase
        .from("iso_form_instances")
        .select("id, tieu_de, trang_thai, final_pdf_url, template_doc_id, thu_tu_ky_json, nguoi_ky, so_buoc_tong")
        .eq("id", log.doc_id)
        .maybeSingle()

      let tmplDoc: { ma_tai_lieu: string | null; ten_tai_lieu: string | null } | null = null
      if (formInst?.template_doc_id) {
        const { data: tmpl } = await supabase
          .from("iso_documents")
          .select("ma_tai_lieu, ten_tai_lieu")
          .eq("id", formInst.template_doc_id)
          .maybeSingle()
        tmplDoc = tmpl
      }
      docRow = (formInst ?? null) as Record<string, unknown> | null
      trangThai = formInst?.trang_thai === "da_phe_duyet" ? "co_hieu_luc" : (formInst?.trang_thai || null)
      maTaiLieu = tmplDoc?.ma_tai_lieu || formInst?.tieu_de || null
      tenTaiLieu = tmplDoc?.ten_tai_lieu || formInst?.tieu_de || null
      fileSignedPdfUrl = (formInst?.final_pdf_url as string) || null
      thuTuKy = (formInst?.thu_tu_ky_json as Array<{ ten?: string; user_id?: string }>) || null
      nguoiKyMap = (formInst?.nguoi_ky as Record<string, { ten?: string; ky_at?: string; user_id?: string }>) || null
      soBuocTong = (formInst?.so_buoc_tong as number) || null
    } else {
      const { data: doc } = await (isIso
        ? supabase
            .from("iso_documents")
            .select("ma_tai_lieu, ten_tai_lieu, trang_thai, file_signed_pdf_url, soan_thao, xem_xet, phe_duyet, soan_thao_user_id, xem_xet_user_id, phe_duyet_user_id, chon_quy_trinh, cap_tl, soan_thao_at, xem_xet_at, phe_duyet_at, ngay_ban_hanh, ngay_gui_duyet, ngay_tao")
            .eq("id", log.doc_id)
            .maybeSingle()
        : supabase
            .from("van_ban_documents")
            .select("ma_van_ban, ten_van_ban, trang_thai, file_signed_pdf_url")
            .eq("id", log.doc_id)
            .maybeSingle())

      docRow = (doc ?? null) as Record<string, unknown> | null
      trangThai = (docRow?.trang_thai as string) || null
      fileSignedPdfUrl = (docRow?.file_signed_pdf_url as string) || null
      maTaiLieu = ((isIso ? docRow?.ma_tai_lieu : docRow?.ma_van_ban) as string) || null
      tenTaiLieu = ((isIso ? docRow?.ten_tai_lieu : docRow?.ten_van_ban) as string) || null
    }

    // Tải thông tin người ký hiện tại và lịch sử các bước ký của tài liệu này
    const siblingLogsRes = await supabase
      .from("doc_approval_log")
      .select("id, user_id, action, buoc_ky, created_at, pades_sig_index")
      .eq("doc_id", log.doc_id)
      .order("created_at", { ascending: true })

    const siblingLogs = (siblingLogsRes.data || []) as LogRow[]
    const candidateUserIds = [
      log.user_id,
      ...siblingLogs.map((l) => l.user_id),
      ...(thuTuKy ? thuTuKy.map((s) => s.user_id) : []),
      (docRow?.soan_thao_user_id as string | undefined),
      (docRow?.xem_xet_user_id as string | undefined),
      (docRow?.phe_duyet_user_id as string | undefined),
    ].filter(Boolean) as string[]
    const uniqueUserIds = [...new Set(candidateUserIds)]

    const { data: profiles } = uniqueUserIds.length > 0
      ? await supabase.from("profiles").select("id, full_name, username").in("id", uniqueUserIds)
      : { data: [] }
    const profileMap = new Map((profiles || []).map((p) => [p.id, (p.full_name as string) || (p.username as string) || ""]))

    const effectiveTotalSteps = soBuocTong || (thuTuKy?.length ?? siblingLogs.length)

    const signingHistory = siblingLogs.map((l) => ({
      id: l.id,
      signerName: resolveSignerName(l, profileMap, nguoiKyMap, docRow),
      buoc: getBuocLabel(l, thuTuKy, effectiveTotalSteps, docRow),
      action: l.action,
      kyLuc: resolveKyLuc(l, nguoiKyMap, docRow),
      isCurrent: l.id === log?.id,
      hasPades: l.pades_sig_index != null,
    }))

    const currentSignerName = resolveSignerName(log, profileMap, nguoiKyMap, docRow)
    const currentBuocLabel = getBuocLabel(log, thuTuKy, effectiveTotalSteps, docRow)
    const currentKyLuc = resolveKyLuc(log, nguoiKyMap, docRow)

    const base = {
      docType: log.doc_type,
      signerName: currentSignerName,
      buoc: currentBuocLabel,
      kyLuc: currentKyLuc,
      maTaiLieu,
      tenTaiLieu,
      trangThai,
      contentHash: log.content_hash,
      signingHistory: signingHistory.length > 0 ? signingHistory : undefined,
    }

    const severityFor = (valid: boolean): "ok" | "warn" | "error" => {
      if (valid) return "ok"
      if (isIso && trangThai === "het_hieu_luc") return "warn"
      return "error"
    }

    let sigIndexToVerify = log.pades_sig_index
    let isInheritedSeal = false

    // Với tài liệu/hồ sơ ISO đã ban hành/phê duyệt, niêm phong PAdES bao trùm toàn bộ các bước ký.
    // Nếu dòng log là bước soạn thảo/xem xét (chưa có pades_sig_index riêng), chứng thực theo niêm phong gốc của file.
    if (sigIndexToVerify === null || sigIndexToVerify === undefined) {
      if ((isIso || isIsoForm) && fileSignedPdfUrl && (trangThai === "co_hieu_luc" || trangThai === "da_phe_duyet")) {
        sigIndexToVerify = 0
        isInheritedSeal = true
      }
    }

    if (sigIndexToVerify === null || sigIndexToVerify === undefined) {
      return NextResponse.json({
        ...base,
        valid: false,
        severity: severityFor(false),
        reason: log.pades_error
          ? `Bước ký này không có chữ ký số (chỉ có con dấu hình ảnh) — ${log.pades_error}`
          : "Bước ký này không có chữ ký số (chỉ có con dấu hình ảnh)",
      })
    }

    if (!fileSignedPdfUrl) {
      return NextResponse.json({
        ...base,
        valid: false,
        severity: severityFor(false),
        reason: "Không tìm thấy file đã ký để xác thực",
      })
    }

    // Vá bảo mật 2026-09-20: bucket iso-documents sẽ chuyển private — `fetch()` thẳng URL public
    // sẽ 403 dù route này chạy phía server. Tải object bằng service role (bypass cờ public/RLS)
    // thay vì gọi HTTP thô ra URL đã lưu trong DB.
    const objectPath = parseStorageObjectPath(fileSignedPdfUrl, BUCKET)
    const download = objectPath ? await getSupabaseAdmin().storage.from(BUCKET).download(objectPath) : null
    if (!objectPath || download?.error || !download?.data) {
      return NextResponse.json({
        ...base,
        valid: false,
        severity: severityFor(false),
        reason: "Không tải được file để xác thực",
      })
    }

    const pdfBytes = Buffer.from(await download.data.arrayBuffer())
    const result = verifyPadesSignature(pdfBytes, sigIndexToVerify)

    const finalSignerName = base.signerName !== "Không rõ" ? base.signerName : (result.valid ? result.signerName : "Không rõ")
    const padesSealSignerName = result.valid ? result.signerName : undefined

    return NextResponse.json({
      ...base,
      ...result,
      signerName: finalSignerName,
      padesSignerName: padesSealSignerName,
      isInheritedSeal,
      inheritedNote: isInheritedSeal && result.valid ? "Chữ ký điện tử nội bộ hợp lệ — Đã được niêm phong bảo chứng theo quy trình ban hành tài liệu" : undefined,
      severity: severityFor(result.valid),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
