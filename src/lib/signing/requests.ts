import { randomUUID } from "crypto"
import { PDFDocument, PDFArray, PDFName, PDFNumber, PDFString } from "@cantoo/pdf-lib"
import type { PDFDocument as PdfLibDocument, PDFPage as PdfLibPage, PDFFont as PdfLibFont } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import QRCode from "qrcode"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getSignatureImage } from "./signature-image"
import { computeIntegrityHash } from "./hash"
import { drawSignatureImage, drawTextFit, loadSignerNameFont } from "./stamp-pdf"
import { getTodayISODate, formatDateDisplay } from "@/lib/date-utils"
import { hasPadesRootCa, applyPadesSignature } from "./pades"

// Lớp điều phối "tạo yêu cầu ký" + "ký 1 người" dùng chung cho MỌI module (6 module
// theo cung_cap_dl/du_an_ky_so_dung_chung - new.docx). Đọc/ghi 6 bảng lõi
// (yeu_cau_ky/nguoi_ky/truong_ky/nhat_ky_ky) bằng service role — RLS 6 bảng đó CHỈ có
// SELECT cho client (đúng thiết kế Giai đoạn 0 mục 5), mọi ghi đều đi qua đây, luôn
// gọi từ API route server-side, không bao giờ import vào component client.

const SIGNING_BUCKET = "signing-documents"

function storagePathFromPublicUrl(url: string): string {
  const marker = `/storage/v1/object/public/${SIGNING_BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) throw new Error("URL file ký không hợp lệ")
  return decodeURIComponent(url.slice(idx + marker.length))
}

export type SigningFieldInput = {
  page: number
  xPt: number
  yPt: number
  wPt: number
  hPt: number
  loai: "chu_ky" | "ten" | "ngay_ky" | "qr"
  nhan?: string
  batBuoc?: boolean
}

export type SigningSignerInput = {
  userId: string
  thuTu: number
  vaiTro: "ky" | "phe_duyet" | "nhan_ban_sao"
  fields: SigningFieldInput[]
}

export type CreateSigningRequestInput = {
  factoryId: string
  modun: string
  loaiTaiLieu: string
  banGhiId?: string | null
  maHoSo?: string | null
  nguoiTaoId: string
  fileBytes: Buffer
  fileExt: string
  signers: SigningSignerInput[]
  hanXuLy?: string | null
}

/**
 * Tạo 1 `yeu_cau_ky` mới: upload file gốc lên Storage, ghi `nguoi_ky` + `truong_ky`
 * cho từng người ký, ghi 1 dòng `nhat_ky_ky` mở đầu vòng đời hồ sơ.
 *
 * Không dùng RPC transaction (khác gợi ý ban đầu trong docx) — mirror đúng cách 3
 * route ký hiện có (ISO/Văn bản/Thực hiện hồ sơ ISO) đang ghi tuần tự bằng service
 * role, không transaction. Nếu 1 bước insert giữa chừng lỗi, cố gắng dọn lại
 * `yeu_cau_ky` vừa tạo (CASCADE tự xoá nguoi_ky/truong_ky con) để không để lại hồ sơ
 * mồ côi nửa vời.
 */
export async function createSigningRequest(input: CreateSigningRequestInput): Promise<{ yeuCauId: string }> {
  const supabase = getSupabaseAdmin()
  const yeuCauId = randomUUID()
  const storagePath = `${input.factoryId}/${input.modun}/${yeuCauId}/v1.${input.fileExt}`
  const contentType = input.fileExt === "pdf" ? "application/pdf" : "application/octet-stream"

  const { error: uploadErr } = await supabase.storage
    .from(SIGNING_BUCKET)
    .upload(storagePath, input.fileBytes, { contentType, upsert: false })
  if (uploadErr) throw new Error(`Không tải được file lên Storage: ${uploadErr.message}`)

  const { data: urlData } = supabase.storage.from(SIGNING_BUCKET).getPublicUrl(storagePath)
  const fileUrl = urlData.publicUrl
  const hash = computeIntegrityHash(input.fileBytes)

  const cleanup = async () => {
    await supabase.from("yeu_cau_ky").delete().eq("id", yeuCauId)
    await supabase.storage.from(SIGNING_BUCKET).remove([storagePath])
  }

  const { error: yeuCauErr } = await supabase.from("yeu_cau_ky").insert({
    id: yeuCauId,
    factory_id: input.factoryId,
    ma_ho_so: input.maHoSo ?? null,
    modun: input.modun,
    loai_tai_lieu: input.loaiTaiLieu,
    ban_ghi_id: input.banGhiId ?? null,
    nguon: "render",
    file_goc: fileUrl,
    file_hien_tai: fileUrl,
    hash_hien_tai: hash,
    trang_thai: "dang_luan_chuyen",
    nguoi_tao: input.nguoiTaoId,
    han_xu_ly: input.hanXuLy ?? null,
  })
  if (yeuCauErr) {
    // Đã có sẵn file gốc vừa upload (dòng ~73-76) — dọn lại tránh rác Storage khi insert thất bại.
    await supabase.storage.from(SIGNING_BUCKET).remove([storagePath])
    if (yeuCauErr.code === "23505") {
      throw new Error(
        "Đã có một yêu cầu ký cho hồ sơ này (có thể do người khác vừa tạo cùng lúc) — vui lòng tải lại trang.",
      )
    }
    throw new Error(`Không tạo được yêu cầu ký: ${yeuCauErr.message}`)
  }

  try {
    for (const signer of input.signers) {
      const { data: nguoiKyRow, error: nguoiKyErr } = await supabase
        .from("nguoi_ky")
        .insert({
          factory_id: input.factoryId,
          yeu_cau_id: yeuCauId,
          user_id: signer.userId,
          thu_tu: signer.thuTu,
          vai_tro: signer.vaiTro,
          loai_chu_ky: "anh",
          trang_thai: "cho",
        })
        .select("id")
        .single()
      if (nguoiKyErr || !nguoiKyRow) throw new Error(nguoiKyErr?.message || "Không tạo được người ký")

      if (signer.fields.length) {
        const { error: truongKyErr } = await supabase.from("truong_ky").insert(
          signer.fields.map((f) => ({
            factory_id: input.factoryId,
            yeu_cau_id: yeuCauId,
            nguoi_ky_id: nguoiKyRow.id,
            trang: f.page,
            x_pt: f.xPt,
            y_pt: f.yPt,
            w_pt: f.wPt,
            h_pt: f.hPt,
            loai: f.loai,
            nhan: f.nhan ?? null,
            bat_buoc: f.batBuoc ?? true,
          })),
        )
        if (truongKyErr) throw new Error(truongKyErr.message)
      }
    }
  } catch (err) {
    await cleanup()
    throw err instanceof Error ? err : new Error("Lỗi không xác định khi tạo yêu cầu ký")
  }

  await supabase.from("nhat_ky_ky").insert({
    factory_id: input.factoryId,
    yeu_cau_id: yeuCauId,
    hanh_dong: "tao_yeu_cau",
    user_id: input.nguoiTaoId,
    hash_sau_thao_tac: hash,
    chi_tiet: { modun: input.modun, loai_tai_lieu: input.loaiTaiLieu, so_nguoi_ky: input.signers.length },
  })

  return { yeuCauId }
}

export type SignFieldResult = {
  trangThaiYeuCau: string
  fileHienTai: string
  alreadySigned: boolean
}

/**
 * Ký toàn bộ `truong_ky` của 1 người (`userId`) trên 1 `yeu_cau_ky`. Idempotent theo
 * đúng mục 6.3 của docx: nếu `nguoi_ky.trang_thai` đã là 'da_ky' (bấm 2 lần / rớt
 * mạng bấm lại), KHÔNG stamp lại — trả về trạng thái hiện tại luôn.
 */
export async function signField(params: {
  yeuCauId: string
  userId: string
  ip: string
  thietBi: string
  appOrigin: string
}): Promise<SignFieldResult> {
  const supabase = getSupabaseAdmin()

  const { data: yeuCau, error: ycErr } = await supabase
    .from("yeu_cau_ky")
    .select("*")
    .eq("id", params.yeuCauId)
    .single()
  if (ycErr || !yeuCau) throw new Error("Không tìm thấy yêu cầu ký")
  if (yeuCau.trang_thai !== "dang_luan_chuyen") {
    throw new Error("Yêu cầu ký này không còn ở trạng thái đang luân chuyển")
  }

  const { data: nguoiKy, error: nkErr } = await supabase
    .from("nguoi_ky")
    .select("*")
    .eq("yeu_cau_id", params.yeuCauId)
    .eq("user_id", params.userId)
    .maybeSingle()
  if (nkErr || !nguoiKy) throw new Error("Bạn không nằm trong danh sách ký hồ sơ này")

  if (nguoiKy.trang_thai === "da_ky") {
    return { trangThaiYeuCau: yeuCau.trang_thai, fileHienTai: yeuCau.file_hien_tai, alreadySigned: true }
  }

  // Chặn ký sai thứ tự: người có `thu_tu` lớn hơn chỉ được ký khi TẤT CẢ người có `thu_tu`
  // nhỏ hơn đã `da_ky`. Không có kiểm tra này, sau khi 1 người "Trả về" (reset predecessor
  // về 'cho'), chính người vừa trả về vẫn có thể bấm ký ngay lập tức mà không cần chờ
  // predecessor sửa & ký lại — vô lý về nghiệp vụ. UI cũng gate tương tự (`myTurn` trong
  // ky/[id]/page.tsx), đây là lớp chặn cứng phía server (không tin tưởng riêng UI).
  const { data: signersBeforeStamp, error: signersBeforeStampErr } = await supabase
    .from("nguoi_ky")
    .select("thu_tu, trang_thai")
    .eq("yeu_cau_id", params.yeuCauId)
  if (signersBeforeStampErr) throw new Error(signersBeforeStampErr.message)
  const notYetMyTurn = (signersBeforeStamp || []).some(
    (s: { thu_tu: number; trang_thai: string }) => s.thu_tu < nguoiKy.thu_tu && s.trang_thai !== "da_ky",
  )
  if (notYetMyTurn) {
    throw new Error("Chưa tới lượt ký của bạn — cần người ký trước hoàn tất trước.")
  }

  const { data: fields, error: fieldsErr } = await supabase
    .from("truong_ky")
    .select("*")
    .eq("nguoi_ky_id", nguoiKy.id)
    .order("trang", { ascending: true })
  if (fieldsErr) throw new Error(fieldsErr.message)
  if (!fields?.length) throw new Error("Không tìm thấy trường ký của bạn trên hồ sơ này")

  const currentPath = storagePathFromPublicUrl(yeuCau.file_hien_tai as string)
  const { data: fileBlob, error: dlErr } = await supabase.storage.from(SIGNING_BUCKET).download(currentPath)
  if (dlErr || !fileBlob) throw new Error("Không tải được file hiện tại để ký")
  const currentBytes = Buffer.from(await fileBlob.arrayBuffer())

  // forIncrementalUpdate: true — BẮT BUỘC, kể cả cho lượt ký ĐẦU TIÊN. Dùng pdf-lib
  // thường (không incremental) ở đây từng làm mất trắng chữ ký PAdES của người ký TRƯỚC
  // ngay khi người ký SAU vẽ con dấu ảnh của họ (bug đã phát hiện + xác nhận bằng chứng
  // thật trên production 2026-08-31) — .save() không-incremental của pdf-lib gốc rebuild
  // lại toàn bộ file, xoá mất đoạn incremental-update mà applyPadesSignature() đã nối
  // thêm ở lượt ký trước. Đổi hẳn sang @cantoo/pdf-lib cho bước vẽ con dấu này để đồng bộ
  // 1 loại thư viện xuyên suốt — mỗi lượt ký giờ chỉ NỐI THÊM bytes, không đụng byte cũ.
  const pdfDoc = await PDFDocument.load(currentBytes, { forIncrementalUpdate: true })
  pdfDoc.registerFontkit(fontkit)
  const sigBytes = await getSignatureImage(yeuCau.factory_id as string, params.userId)

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username, auth_email")
    .eq("id", params.userId)
    .single()
  const signerName = (profile?.full_name as string) || (profile?.username as string) || ""
  const signerContact = (profile?.auth_email as string) || ""

  const fontBytes = loadSignerNameFont()
  // `stamp-pdf.ts` khai type theo pdf-lib (không phải @cantoo/pdf-lib) vì còn dùng chung
  // cho ISO/Văn bản (chưa đổi thư viện) — @cantoo là fork API tương thích, ép kiểu tại
  // đúng điểm gọi này, KHÔNG đổi type khai báo của stamp-pdf.ts để tránh ảnh hưởng 3 route
  // khác đang chạy thật (generate-pdf/generate-office/documents/sign).
  const font = fontBytes ? ((await pdfDoc.embedFont(fontBytes)) as unknown as PdfLibFont) : null
  const todayLabel = formatDateDisplay(getTodayISODate())

  for (const f of fields as Array<Record<string, unknown>>) {
    const pageIndex = (f.trang as number) - 1
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue
    const page = pdfDoc.getPage(pageIndex)
    const box = { x: Number(f.x_pt), y: Number(f.y_pt), width: Number(f.w_pt), height: Number(f.h_pt) }
    if (f.loai === "chu_ky") {
      if (sigBytes) {
        await drawSignatureImage(
          pdfDoc as unknown as PdfLibDocument,
          page as unknown as PdfLibPage,
          sigBytes,
          box,
        )
      }
      // Link annotation phủ đúng ô con dấu — bấm vào (Acrobat/Chrome/bất kỳ trình xem PDF nào
      // hỗ trợ link annotation) mở trang xác thực trạng thái chữ ký PAdES. Vẽ trong CÙNG lượt
      // incremental-update này (không tạo thêm lượt .save() riêng), mirror đúng kỹ thuật
      // append-annotation-vào-Annots mà addSignaturePlaceholder() trong pades.ts đã dùng.
      try {
        const rect = PDFArray.withContext(pdfDoc.context)
        ;[box.x, box.y, box.x + box.width, box.y + box.height].forEach((c) => rect.push(PDFNumber.of(c)))
        const linkDict = pdfDoc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: rect,
          Border: [0, 0, 0],
          A: { Type: "Action", S: "URI", URI: PDFString.of(`${params.appOrigin}/sign-verify/${nguoiKy.id}`) },
        })
        const linkRef = pdfDoc.context.register(linkDict)
        let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)
        if (typeof annots === "undefined") {
          annots = pdfDoc.context.obj([])
          page.node.set(PDFName.of("Annots"), annots)
        }
        annots.push(linkRef)
      } catch { /* bỏ qua nếu thêm link thất bại — không được chặn luồng ký chính */ }
    } else if (f.loai === "ten") {
      drawTextFit(page as unknown as PdfLibPage, signerName, box, font)
    } else if (f.loai === "ngay_ky") {
      drawTextFit(page as unknown as PdfLibPage, todayLabel, box, font, { maxFontSize: 9, minFontSize: 6 })
    } else if (f.loai === "qr") {
      try {
        const qrPng = await QRCode.toBuffer(`${params.appOrigin}/dashboard/ky/${params.yeuCauId}`, {
          width: 200,
          margin: 1,
        })
        const qrImg = await pdfDoc.embedPng(qrPng)
        page.drawImage(qrImg, { x: box.x, y: box.y, width: box.width, height: box.height })
      } catch { /* bỏ qua nếu tạo/nhúng QR thất bại */ }
    }
  }

  // `forIncrementalUpdate: true` lúc load → `.save()` chỉ trả về ĐOẠN BYTES MỚI cần nối
  // thêm (không phải toàn bộ file) — bắt buộc tự nối vào `currentBytes`, mirror đúng cách
  // `addSignaturePlaceholder()` trong `pades.ts` đang làm.
  const increment = await pdfDoc.save()
  let newBytes: Buffer = Buffer.concat([currentBytes, Buffer.from(increment)])

  // Lớp ký số mật mã thật (PAdES) — CỘNG THÊM lên trên con dấu ảnh vừa vẽ, không thay thế.
  // Best-effort: nếu chưa cấu hình root CA (`hasPadesRootCa()` false) hoặc bước nhúng chữ ký
  // lỗi vì bất kỳ lý do gì, bỏ qua và giữ nguyên `newBytes` chỉ có con dấu ảnh — không được để
  // lỗi ở lớp cộng thêm này chặn đứng luồng ký chính đang chạy thật cho 3 module production.
  let padesSigIndex: number | null = null
  let padesError: string | null = null
  if (hasPadesRootCa()) {
    try {
      // Đếm số chữ ký PAdES đã có của đúng yêu cầu này để biết vị trí (0-based) của chữ ký
      // sắp thêm — dùng để verify lại đúng người sau này (xem GET /api/signing/verify/[nguoiKyId]).
      const { count: priorPadesCount } = await supabase
        .from("nguoi_ky")
        .select("id", { count: "exact", head: true })
        .eq("yeu_cau_id", params.yeuCauId)
        .not("pades_sig_index", "is", null)
      newBytes = await applyPadesSignature(newBytes, signerName, signerContact)
      padesSigIndex = priorPadesCount ?? 0
    } catch (err) {
      padesError = err instanceof Error ? err.message : String(err)
      console.error("[signing/pades] Bỏ qua chữ ký PAdES do lỗi:", padesError)
    }
  } else {
    // Ghi rõ lý do "chưa cấu hình" — khác hẳn lỗi runtime ở nhánh trên, để không phải đoán
    // giữa "thiếu SIGN_PADES_ROOT_CA_*" và "applyPadesSignature() thật sự lỗi" khi chẩn đoán
    // (bug đã báo 2026-09-01: 1 lượt ký trên phiếu Kiểm nghiệm có CẢ 2 người ký cùng không
    // có pades_sig_index, cần phân biệt được nguyên nhân mà không cần xem log server).
    padesError = "Chưa cấu hình SIGN_PADES_ROOT_CA_CERT_PEM/SIGN_PADES_ROOT_CA_KEY_PEM ở môi trường này"
  }

  const newHash = computeIntegrityHash(newBytes)
  const versionMatch = currentPath.match(/\/v(\d+)\.([a-zA-Z0-9]+)$/)
  const nextVersion = versionMatch ? parseInt(versionMatch[1], 10) + 1 : 2
  const ext = versionMatch ? versionMatch[2] : "pdf"
  const newPath = currentPath.replace(/\/v\d+\.[a-zA-Z0-9]+$/, `/v${nextVersion}.${ext}`)

  const { error: upErr } = await supabase.storage
    .from(SIGNING_BUCKET)
    .upload(newPath, newBytes, { contentType: "application/pdf", upsert: true })
  if (upErr) throw new Error(`Không tải được file đã ký: ${upErr.message}`)

  const { data: newUrlData } = supabase.storage.from(SIGNING_BUCKET).getPublicUrl(newPath)
  const newUrl = newUrlData.publicUrl
  const signedAt = new Date().toISOString()

  await supabase
    .from("nguoi_ky")
    .update({ trang_thai: "da_ky", ky_luc: signedAt, ip: params.ip, thiet_bi: params.thietBi })
    .eq("id", nguoiKy.id)

  // Ghi `pades_sig_index`/`pades_error` bằng câu UPDATE RIÊNG (không gộp chung với update cốt
  // lõi ở trên) — nếu 2 cột này chưa tồn tại (migration 20260831/20260901 chưa chạy) thì CHỈ
  // mất tính năng chẩn đoán/"click con dấu xem xác thực", không làm hỏng luồng ký chính (UPDATE
  // nhiều cột cùng lúc mà 1 cột không tồn tại sẽ làm Postgres từ chối TOÀN BỘ câu lệnh). Thử cả
  // 2 cột trước; nếu Postgres từ chối (cột pades_error chưa tồn tại), thử lại chỉ với
  // pades_sig_index (cột cũ, chắc chắn đã có từ 2026-08-31) để không mất hẳn tính năng xác thực.
  if (padesSigIndex !== null || padesError !== null) {
    const { error: padesUpdateErr } = await supabase
      .from("nguoi_ky")
      .update({ pades_sig_index: padesSigIndex, pades_error: padesError })
      .eq("id", nguoiKy.id)
    if (padesUpdateErr && padesSigIndex !== null) {
      await supabase.from("nguoi_ky").update({ pades_sig_index: padesSigIndex }).eq("id", nguoiKy.id)
    }
  }

  const { data: allSigners } = await supabase
    .from("nguoi_ky")
    .select("id, trang_thai")
    .eq("yeu_cau_id", params.yeuCauId)
  const allDone = (allSigners || []).every(
    (r: { id: string; trang_thai: string }) => r.id === nguoiKy.id || r.trang_thai === "da_ky",
  )

  // Ký lại thành công (dù là lượt đầu hay sau khi bị "Trả về") luôn coi như đã xử lý
  // xong lần trả về gần nhất — xoá 3 cột tra_ve_* để badge không còn hiện "Đã trả về"
  // cũ. Ghi đè null vô hại nếu trước đó chưa từng có trả về nào.
  const yeuCauUpdate: Record<string, unknown> = {
    file_hien_tai: newUrl,
    hash_hien_tai: newHash,
    tra_ve_ly_do: null,
    tra_ve_boi: null,
    tra_ve_luc: null,
  }
  if (allDone) {
    yeuCauUpdate.trang_thai = "hoan_tat"
    yeuCauUpdate.hoan_tat_luc = signedAt
  }
  await supabase.from("yeu_cau_ky").update(yeuCauUpdate).eq("id", params.yeuCauId)

  await supabase.from("nhat_ky_ky").insert({
    factory_id: yeuCau.factory_id,
    yeu_cau_id: params.yeuCauId,
    hanh_dong: "ky",
    user_id: params.userId,
    ip: params.ip,
    thiet_bi: params.thietBi,
    hash_sau_thao_tac: newHash,
    chi_tiet: { nguoi_ky_id: nguoiKy.id, vai_tro: nguoiKy.vai_tro, so_truong: fields.length },
  })

  return { trangThaiYeuCau: allDone ? "hoan_tat" : (yeuCau.trang_thai as string), fileHienTai: newUrl, alreadySigned: false }
}

/**
 * Hủy 1 yêu cầu ký còn đang luân chuyển (chưa ký xong hết) — dành cho người tạo (`nguoi_tao`)
 * hoặc admin, để làm lại từ đầu khi lỡ chọn sai người ký. KHÔNG cho hủy khi đã `hoan_tat` (đúng
 * triết lý bất biến của toàn hệ thống ký — tài liệu đã hoàn tất không có đường quay lại).
 * `trang_thai = 'huy'` — giá trị đã hợp lệ theo CHECK constraint gốc, chưa từng có hàm nào ghi.
 */
export async function cancelSigningRequest(params: {
  yeuCauId: string
  userId: string
  isAdmin: boolean
  ip?: string
  thietBi?: string
}): Promise<{ trangThai: string }> {
  const supabase = getSupabaseAdmin()

  const { data: yeuCau, error: ycErr } = await supabase
    .from("yeu_cau_ky")
    .select("*")
    .eq("id", params.yeuCauId)
    .single()
  if (ycErr || !yeuCau) throw new Error("Không tìm thấy yêu cầu ký")

  if (yeuCau.trang_thai !== "dang_luan_chuyen") {
    throw new Error("Yêu cầu ký này không còn ở trạng thái đang luân chuyển, không thể hủy")
  }
  if (!params.isAdmin && yeuCau.nguoi_tao !== params.userId) {
    throw new Error("Bạn không có quyền hủy yêu cầu ký này")
  }

  const { error: updateErr } = await supabase
    .from("yeu_cau_ky")
    .update({ trang_thai: "huy" })
    .eq("id", params.yeuCauId)
  if (updateErr) throw new Error(`Không hủy được yêu cầu ký: ${updateErr.message}`)

  await supabase.from("nhat_ky_ky").insert({
    factory_id: yeuCau.factory_id,
    yeu_cau_id: params.yeuCauId,
    hanh_dong: "huy_yeu_cau",
    user_id: params.userId,
    ip: params.ip,
    thiet_bi: params.thietBi,
    hash_sau_thao_tac: yeuCau.hash_hien_tai,
    chi_tiet: { trang_thai_truoc: "dang_luan_chuyen" },
  })

  return { trangThai: "huy" }
}

/**
 * "Trả về": 1 người ký CHƯA đến lượt ký thật (`trang_thai !== 'da_ky'`) từ chối ký và gửi
 * ngược lại cho (các) người ký TRƯỚC mình (thu_tu nhỏ hơn) đã ký xong — dùng khi phát hiện
 * cần sửa vị trí ký/chọn nhầm người ký, KHÔNG dùng khi cần sửa nội dung file (xem giới hạn
 * ghi ở migration `20260905_signing_return_request.sql`). Giữ NGUYÊN 1 `yeu_cau_ky` (không
 * tạo bản mới): reset (các) người ký trước về `trang_thai='cho'`, khôi phục `file_hien_tai`
 * về đúng `file_goc` (huỷ hết chữ ký đã stamp), lưu lý do + người trả về trên `yeu_cau_ky`.
 * Bắt buộc phải có ít nhất 1 người ký trước ĐÃ ký — nếu không có gì để trả về (mình là
 * người đầu tiên), báo lỗi hướng dẫn dùng "Hủy yêu cầu" thay thế.
 */
export async function returnSigningRequest(params: {
  yeuCauId: string
  userId: string
  lyDo: string
  ip?: string
  thietBi?: string
}): Promise<{ resetUserIds: string[] }> {
  const supabase = getSupabaseAdmin()
  const lyDo = params.lyDo?.trim()
  if (!lyDo) throw new Error("Vui lòng nhập lý do trả về")

  const { data: yeuCau, error: ycErr } = await supabase
    .from("yeu_cau_ky")
    .select("*")
    .eq("id", params.yeuCauId)
    .single()
  if (ycErr || !yeuCau) throw new Error("Không tìm thấy yêu cầu ký")
  if (yeuCau.trang_thai !== "dang_luan_chuyen") {
    throw new Error("Yêu cầu ký này không còn ở trạng thái đang luân chuyển")
  }

  const { data: allSigners, error: nkErr } = await supabase
    .from("nguoi_ky")
    .select("*")
    .eq("yeu_cau_id", params.yeuCauId)
    .order("thu_tu", { ascending: true })
  if (nkErr || !allSigners) throw new Error("Không tải được danh sách người ký")

  const me = allSigners.find((n) => n.user_id === params.userId)
  if (!me) throw new Error("Bạn không nằm trong danh sách ký hồ sơ này")
  if (me.trang_thai === "da_ky") throw new Error("Bạn đã ký hồ sơ này, không thể trả về")

  const predecessors = allSigners.filter((n) => n.thu_tu < me.thu_tu && n.trang_thai === "da_ky")
  if (!predecessors.length) {
    throw new Error(
      "Chưa có ai ký trước bạn trên hồ sơ này — không có gì để trả về. Dùng \"Hủy yêu cầu\" nếu cần làm lại từ đầu.",
    )
  }

  const { error: resetErr } = await supabase
    .from("nguoi_ky")
    .update({ trang_thai: "cho", ky_luc: null, ip: null, thiet_bi: null })
    .in("id", predecessors.map((p) => p.id))
  if (resetErr) throw new Error(resetErr.message)

  if (!yeuCau.file_goc) throw new Error("Hồ sơ không có file gốc để khôi phục")
  let restoreHash = yeuCau.hash_hien_tai as string
  if (yeuCau.file_goc !== yeuCau.file_hien_tai) {
    const path = storagePathFromPublicUrl(yeuCau.file_goc as string)
    const { data: blob, error: dlErr } = await supabase.storage.from(SIGNING_BUCKET).download(path)
    if (dlErr || !blob) throw new Error("Không tải được file gốc để khôi phục")
    restoreHash = computeIntegrityHash(Buffer.from(await blob.arrayBuffer()))
  }

  const returnedAt = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from("yeu_cau_ky")
    .update({
      file_hien_tai: yeuCau.file_goc,
      hash_hien_tai: restoreHash,
      tra_ve_ly_do: lyDo,
      tra_ve_boi: params.userId,
      tra_ve_luc: returnedAt,
    })
    .eq("id", params.yeuCauId)
  if (updateErr) throw new Error(`Không trả về được yêu cầu ký: ${updateErr.message}`)

  await supabase.from("nhat_ky_ky").insert({
    factory_id: yeuCau.factory_id,
    yeu_cau_id: params.yeuCauId,
    hanh_dong: "tra_ve",
    user_id: params.userId,
    ip: params.ip,
    thiet_bi: params.thietBi,
    hash_sau_thao_tac: restoreHash,
    chi_tiet: { ly_do: lyDo, reset_nguoi_ky_ids: predecessors.map((p) => p.id) },
  })

  return { resetUserIds: predecessors.map((p) => p.user_id) }
}
