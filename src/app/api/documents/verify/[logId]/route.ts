import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { verifyPadesSignature, findUniqueByteRanges, findMatchingRevision } from "@/lib/signing/verify-pades"
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

/**
 * Dòng log ISO của bản TRUNG GIAN (trước khi niêm phong): ISO dựng lại file từ file gốc mỗi lượt
 * ký nên bản này bị thay thế hoàn toàn — không có chỉ số PAdES và mã băm không bao giờ khớp file
 * cuối. Không phải dấu hiệu can thiệp.
 */
function isSupersededIsoDraft(row: LogRow): boolean {
  return (row.doc_type === "iso" || row.doc_type === "iso_form")
    && (row.pades_sig_index === null || row.pades_sig_index === undefined)
}

const SIGN_STEP_ACTIONS = new Set(["soan_thao", "xem_xet", "phe_duyet", "ky_buoc"])

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
    let thuTuKy: Array<{ ten?: string; user_id?: string }> | null = null
    let nguoiKyMap: Record<string, { ten?: string; ky_at?: string; user_id?: string }> | null = null
    let soBuocTong: number | null = null

    if (isIsoForm) {
      const { data: formInst } = await supabase
        .from("iso_form_instances")
        .select("id, tieu_de, trang_thai, final_pdf_url, soan_thao_signed_url, draft_file_url, final_office_url, template_doc_id, thu_tu_ky_json, nguoi_ky, so_buoc_tong")
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
      thuTuKy = (formInst?.thu_tu_ky_json as Array<{ ten?: string; user_id?: string }>) || null
      nguoiKyMap = (formInst?.nguoi_ky as Record<string, { ten?: string; ky_at?: string; user_id?: string }>) || null
      soBuocTong = (formInst?.so_buoc_tong as number) || null
    } else {
      const { data: doc } = await (isIso
        ? supabase
            .from("iso_documents")
            .select("ma_tai_lieu, ten_tai_lieu, trang_thai, file_signed_pdf_url, file_de_nghi_soat_xet_signed_url, file_phieu_yeu_cau_thay_doi_signed_url, file_goc_url, file_signed_office_url, soan_thao, xem_xet, phe_duyet, soan_thao_user_id, xem_xet_user_id, phe_duyet_user_id, chon_quy_trinh, cap_tl, soan_thao_at, xem_xet_at, phe_duyet_at, ngay_ban_hanh, ngay_gui_duyet, ngay_tao")
            .eq("id", log.doc_id)
            .maybeSingle()
        : supabase
            .from("van_ban_documents")
            .select("ma_van_ban, ten_van_ban, trang_thai, file_signed_pdf_url")
            .eq("id", log.doc_id)
            .maybeSingle())

      docRow = (doc ?? null) as Record<string, unknown> | null
      trangThai = (docRow?.trang_thai as string) || null
      maTaiLieu = ((isIso ? docRow?.ma_tai_lieu : docRow?.ma_van_ban) as string) || null
      tenTaiLieu = ((isIso ? docRow?.ten_tai_lieu : docRow?.ten_van_ban) as string) || null
    }

    // Tập hợp danh sách URL ứng viên theo thứ tự ưu tiên
    const candidateUrls: string[] = isIsoForm
      ? [
          docRow?.final_pdf_url,
          docRow?.soan_thao_signed_url,
          docRow?.draft_file_url,
          docRow?.final_office_url,
        ].filter(Boolean) as string[]
      : isIso
        ? [
            docRow?.file_signed_pdf_url,
            docRow?.file_de_nghi_soat_xet_signed_url,
            docRow?.file_phieu_yeu_cau_thay_doi_signed_url,
            docRow?.file_goc_url,
            docRow?.file_signed_office_url,
          ].filter(Boolean) as string[]
        : [docRow?.file_signed_pdf_url].filter(Boolean) as string[]

    // Tải thông tin người ký hiện tại và lịch sử các bước ký của tài liệu này
    const siblingLogsRes = await supabase
      .from("doc_approval_log")
      .select("id, doc_type, user_id, action, buoc_ky, content_hash, created_at, pades_sig_index")
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

    // Chỉ giữ dòng thực sự gắn với một con dấu đã đóng lên file: bỏ dòng chuyển trạng thái ghi từ
    // client (không có mã băm) và — với ISO đã có nhật ký theo từng bước — bỏ các dòng
    // "generate_pdf" của bản trung gian đã bị thay thế (bấm vào chỉ ra cảnh báo, gây hiểu nhầm
    // "không xác minh được"). Dòng đang xem luôn được giữ.
    const hasStepLogs = siblingLogs.some((l) => !!l.content_hash && SIGN_STEP_ACTIONS.has(l.action || ""))
    const visibleLogs = siblingLogs.filter((l) => {
      if (l.id === log?.id) return true
      if (!l.content_hash) return false
      if (hasStepLogs && l.action === "generate_pdf" && isSupersededIsoDraft(l)) return false
      return true
    })
    const signingHistory = visibleLogs.map((l) => ({
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

    if (candidateUrls.length === 0) {
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
    //
    // Toàn vẹn nội dung kiểm THEO REVISION (sửa 2026-09-27): `content_hash` của bước N là hash file
    // NGAY SAU bước N, còn file hiện tại đã được các bước sau NỐI THÊM (incremental update). So hash
    // toàn file như trước làm mọi bước trừ bước cuối luôn báo "đã bị chỉnh sửa" dù chữ ký hợp lệ
    // tuyệt đối (lỗi thật ở 01/VB-NMCB, 22/BC-NMCB). Nay so với tiền tố file tới hết revision của
    // chữ ký đó — xem `findMatchingRevision`.
    let pdfBytes: Buffer | null = null
    let revisionMatch: { index: number; revisionEnd: number } | null = null
    let anyDownloaded = false

    for (const url of candidateUrls) {
      const objectPath = parseStorageObjectPath(url, BUCKET)
      if (!objectPath) continue
      const download = await getSupabaseAdmin().storage.from(BUCKET).download(objectPath)
      if (download?.error || !download?.data) continue
      const bytes = Buffer.from(await download.data.arrayBuffer())
      anyDownloaded = true

      if (!log.content_hash) {
        pdfBytes = bytes
        break
      }
      const match = findMatchingRevision(bytes, log.content_hash, log.pades_sig_index)
      if (match) {
        pdfBytes = bytes
        revisionMatch = match
        break
      }
    }

    if (!anyDownloaded) {
      return NextResponse.json({
        ...base,
        valid: false,
        severity: severityFor(false),
        reason: "Không tải được file để xác thực",
      })
    }

    // 1. Không revision nào khớp mã băm đã lưu lúc ký.
    if (!pdfBytes) {
      // ISO dựng lại file từ file gốc mỗi lượt ký ⇒ bản trung gian (trước khi niêm phong) bị THAY
      // THẾ hoàn toàn, không bao giờ nằm trong file cuối. Đây là quy trình bình thường, không phải
      // file bị can thiệp — trả cảnh báo trung tính thay vì báo đỏ.
      if (isSupersededIsoDraft(log)) {
        return NextResponse.json({
          ...base,
          valid: false,
          severity: "warn",
          supersededDraft: true,
          reason:
            "Đây là bản trung gian trước khi ban hành — đã được thay thế bởi bản cuối có niêm phong chữ ký số. Hãy xác thực bằng con dấu trên bản đang lưu hành.",
        })
      }
      return NextResponse.json({
        ...base,
        valid: false,
        severity: "error",
        reason: "Nội dung tài liệu đã bị chỉnh sửa sau khi ký (sai lệch mã băm toàn vẹn SHA-256)",
      })
    }

    // Khớp một revision ở giữa file ⇒ các bước ký sau chỉ nối thêm, phần đã ký còn nguyên vẹn.
    const revisionVerified = !!revisionMatch && revisionMatch.revisionEnd < pdfBytes.length
    const revisionNote = revisionVerified
      ? "Nội dung tại thời điểm ký còn nguyên vẹn — các bước ký sau chỉ được nối thêm vào cuối file, không đụng phần đã ký."
      : undefined

    // 2. Kiểm tra chữ ký số PAdES nếu có trong file
    const padesRanges = findUniqueByteRanges(pdfBytes)
    const hasPadesInFile = padesRanges.length > 0

    let sigIndexToVerify = log.pades_sig_index
    let isInheritedSeal = false

    // Với tài liệu/hồ sơ ISO đã ban hành/phê duyệt hoặc file đã được niêm phong PAdES:
    // Nếu dòng log là bước soạn thảo/xem xét (chưa có pades_sig_index riêng), chứng thực theo niêm phong gốc của file.
    if (sigIndexToVerify === null || sigIndexToVerify === undefined) {
      if ((isIso || isIsoForm) && hasPadesInFile) {
        sigIndexToVerify = 0
        isInheritedSeal = true
      }
    }

    // Nếu file có chữ ký PAdES và có vị trí chữ ký hợp lệ để verify
    if (hasPadesInFile && sigIndexToVerify !== null && sigIndexToVerify !== undefined && sigIndexToVerify < padesRanges.length) {
      const result = verifyPadesSignature(pdfBytes, sigIndexToVerify)
      const finalSignerName = base.signerName !== "Không rõ" ? base.signerName : (result.valid ? result.signerName : "Không rõ")
      const padesSealSignerName = result.valid ? result.signerName : undefined

      return NextResponse.json({
        ...base,
        ...result,
        signerName: finalSignerName,
        padesSignerName: padesSealSignerName,
        isInheritedSeal,
        revisionVerified,
        revisionNote: result.valid ? revisionNote : undefined,
        inheritedNote: isInheritedSeal && result.valid
          ? "Chữ ký điện tử nội bộ hợp lệ — Đã được niêm phong bảo chứng PAdES theo quy trình ban hành tài liệu"
          : undefined,
        severity: severityFor(result.valid),
      })
    }

    // Nếu file không có chữ ký PAdES mật mã (hoặc server chưa cấu hình Root CA lúc ký),
    // nhưng tính toàn vẹn SHA-256 đã khớp tuyệt đối và văn bản đã được phê duyệt trong hệ thống:
    const finalSignerName = base.signerName !== "Không rõ" ? base.signerName : "Người ký văn bản"
    return NextResponse.json({
      ...base,
      valid: true,
      signerName: finalSignerName,
      severity: severityFor(true),
      keyAlgorithm: "Mã băm toàn vẹn nội dung",
      digestAlgorithm: "SHA-256",
      isInheritedSeal: true,
      inheritedNote: isIso || isIsoForm
        ? "Chữ ký điện tử nội bộ hợp lệ — Đã xác thực toàn vẹn nội dung văn bản theo quy trình ISO (SHA-256)"
        : "Chữ ký điện tử nội bộ hợp lệ — Đã xác thực toàn vẹn nội dung văn bản (SHA-256)",
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
