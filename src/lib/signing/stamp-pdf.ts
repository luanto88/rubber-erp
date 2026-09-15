import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib"
import fs from "fs"
import path from "path"

// Hợp nhất phần lõi dùng chung giữa `stampPdf` (api/iso/forms/[id]/finalize/route.ts,
// api/sign/generate-pdf/route.ts) và `stampPdfStep` (api/documents/sign/route.ts) — vẽ
// ảnh chữ ký + tên người ký (tự thu nhỏ cỡ chữ) + tiền tố ký thay vào 1 khung trên PDF.
//
// CỐ Ý KHÔNG hợp nhất luôn phần QR và phần "vòng lặp nhiều người ký/nhiều bước" của 3
// route trên — 3 nơi đó có hành vi khác nhau thật sự (không chỉ trùng lặp code):
//   - ISO (finalize.ts) generate QR PNG từ `qrUrl` ngay bên trong, vẽ đè lên TẤT CẢ trang
//     nếu có override vị trí, ngược lại chỉ vẽ góc trên-phải TRANG ĐẦU.
//   - Văn bản (documents/sign.ts) nhận sẵn buffer QR đã render (kích thước 160px khác 100px
//     của ISO), LUÔN vẽ trên mọi trang kể cả không có override (tự tính góc theo từng trang).
//   - generate-pdf/route.ts còn lồng thêm logic quét header/footer/tag văn bản mà 2 nơi kia
//     không có — không an toàn để gộp trong đợt này.
// Gộp ép 3 hành vi QR khác nhau thành 1 sẽ đổi giao diện tài liệu đã ký thật — vi phạm
// nguyên tắc "Refactor, không đổi hành vi" của Giai đoạn 1. Vì vậy QR vẫn tự vẽ riêng ở
// từng route, chỉ phần khung chữ ký/tên/tiền tố dưới đây được dùng chung.

export type SignatureBox = {
  x: number
  y: number
  width: number
  height: number
  showSignature?: boolean
  showSignerName?: boolean
  nameX?: number
  nameY?: number
  nameWidth?: number
  nameHeight?: number
}

export type ExtraSignaturePlacement = SignatureBox & { page: number }

export type NameStyle = {
  maxFontSize: number
  minFontSize: number
  fontStep: number
  belowOffset: number
  minY: number
  extraWidth: number
  minMaxWidth: number
}

// Hằng số style hiện có của module ISO — đã đối chiếu trực tiếp và xác nhận
// `buildSignerNamePlacement()` + vòng lặp thu nhỏ cỡ chữ (13→9) ở
// `api/iso/forms/[id]/finalize/route.ts` và `api/sign/generate-pdf/route.ts` GIỐNG HỆT
// nhau — đúng 1 bản bị copy-paste 2 lần theo docx.
export const ISO_SIGNER_NAME_STYLE: NameStyle = {
  maxFontSize: 13,
  minFontSize: 9,
  fontStep: 0.5,
  belowOffset: 18,
  minY: 8,
  extraWidth: 24,
  minMaxWidth: 110,
}

// Hằng số style của module Văn bản — CHỈ CÒN phục vụ luồng ký TỰ DO (`stampPdfStep` trong
// `api/documents/sign/route.ts`), tức văn bản cũ chưa có mẫu vị trí ký. KHÔNG được đổi cỡ chữ ở
// đây — sẽ đổi giao diện chữ ký của các văn bản đang luân chuyển dở trên production.
//
// Luồng theo mẫu ("vị trí CỨNG") đã chuyển sang 13→9pt từ 2026-09-14 để khớp bản xem trước —
// xem `TEMPLATE_SIGNER_NAME_STYLE` (apply-template.ts) và `SIGN_TEXT_FONT_SIZE_PT`
// (template-layout.ts).
export const VAN_BAN_SIGNER_NAME_STYLE: NameStyle = {
  maxFontSize: 10,
  minFontSize: 7,
  fontStep: 0.5,
  belowOffset: 14,
  minY: 4,
  extraWidth: 20,
  minMaxWidth: 60,
}

/** Đọc font Times New Roman dùng để vẽ tên người ký — dùng chung cho mọi route ký PDF. */
export function loadSignerNameFont(): Buffer | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), "public/fonts/TimesNewRoman.ttf"))
  } catch {
    return null
  }
}

/**
 * Tính vị trí/khổ rộng tối đa để vẽ tên người ký từ 1 khung — dùng chung cho cả
 * `drawSignerName()` lẫn nơi cần tự custom vòng lặp vẽ (vd `generate-pdf/route.ts`
 * còn kiểm tra thêm "đã có sẵn tên gần đó chưa" trước khi vẽ, không dùng
 * `drawSignerName()` trực tiếp được).
 */
export function computeNameSlot(box: SignatureBox, style: NameStyle) {
  return {
    xCenter: typeof box.nameX === "number" ? box.nameX + (box.nameWidth ?? box.width) / 2 : box.x + box.width / 2,
    y: typeof box.nameY === "number" ? box.nameY : Math.max(box.y - style.belowOffset, style.minY),
    maxWidth: Math.max(
      typeof box.nameWidth === "number" ? box.nameWidth : box.width + style.extraWidth,
      style.minMaxWidth,
    ),
  }
}

/** Vẽ ảnh chữ ký vào 1 khung — `embedPng` với fallback `embedJpg`, bỏ qua êm nếu lỗi. */
export async function drawSignatureImage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  sigBytes: ArrayBuffer | Uint8Array,
  box: SignatureBox,
  opacity = 0.92,
): Promise<void> {
  if (box.showSignature === false) return
  try {
    const embedded = await pdfDoc.embedPng(sigBytes).catch(() => pdfDoc.embedJpg(sigBytes))
    page.drawImage(embedded, { x: box.x, y: box.y, width: box.width, height: box.height, opacity })
  } catch { /* bỏ qua nếu embed thất bại */ }
}

/** Vẽ tên người ký, tự thu nhỏ cỡ chữ tới khi vừa `maxWidth` (theo `NameStyle` của module gọi). */
export function drawSignerName(
  page: PDFPage,
  signerName: string | undefined,
  box: SignatureBox,
  font: PDFFont | null,
  style: NameStyle,
): void {
  if (!signerName || !font || box.showSignerName === false) return
  try {
    const slot = computeNameSlot(box, style)
    let fontSize = style.maxFontSize
    while (fontSize > style.minFontSize && font.widthOfTextAtSize(signerName, fontSize) > slot.maxWidth) {
      fontSize -= style.fontStep
    }
    const textWidth = font.widthOfTextAtSize(signerName, fontSize)
    page.drawText(signerName, {
      x: slot.xCenter - textWidth / 2,
      y: slot.y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    })
  } catch { /* bỏ qua nếu vẽ tên thất bại */ }
}

/** Vẽ tiền tố ký thay (KT./TM./TL./TUQ.) — chỉ khi có tọa độ `prefixX`/`prefixY` thật. */
export function drawSignPrefix(
  page: PDFPage,
  prefixText: string | null | undefined,
  box: { showPrefix?: boolean; prefixX?: number; prefixY?: number },
  font: PDFFont | null,
  size = 10,
): void {
  if (!prefixText || !font || !box.showPrefix) return
  if (typeof box.prefixX !== "number" || typeof box.prefixY !== "number") return
  try {
    page.drawText(prefixText, { x: box.prefixX, y: box.prefixY, size, font, color: rgb(0, 0, 0) })
  } catch { /* bỏ qua nếu vẽ tiền tố thất bại */ }
}

/** Khung CHỨC VỤ trong 1 placement — mọi trường đều optional để placement cũ vẫn hợp lệ. */
export type ChucVuBox = {
  showChucVu?: boolean
  chucVuText?: string | null
  cvX?: number
  cvY?: number
  cvWidth?: number
  cvHeight?: number
}

/**
 * Vẽ CHỨC VỤ của người ký vào khung riêng — khối độc lập với chữ ký và tên (người ký tự bật/tắt
 * và kéo riêng), không phải một dòng phụ nằm dưới tên.
 *
 * Hoàn toàn BỔ SUNG và có điều kiện: placement lưu trước khi có tính năng này không mang nhóm
 * trường `showChucVu`/`chucVuText`/`cv*` nên hàm thoát ngay ở các guard dưới — mọi hồ sơ/tài liệu
 * đang luân chuyển dở giữ nguyên hình ảnh cũ, không lệch một nét.
 *
 * `chucVuText` đi kèm trong chính placement (không tra lại hồ sơ nhân sự lúc đóng dấu) vì có
 * luồng vẽ lại toàn bộ các bước ký từ file gốc ở bước cuối — chức vụ của những bước trước phải
 * tự mang theo dữ liệu của chính nó mới sống sót.
 */
export function drawChucVu(
  page: PDFPage,
  box: ChucVuBox,
  font: PDFFont | null,
  style: NameStyle,
): void {
  if (!box.showChucVu || !font) return
  const text = (box.chucVuText || "").trim()
  if (!text) return
  const { cvX, cvY, cvWidth, cvHeight } = box
  if (
    typeof cvX !== "number" || typeof cvY !== "number"
    || typeof cvWidth !== "number" || typeof cvHeight !== "number"
  ) return
  drawTextFit(page, text, { x: cvX, y: cvY, width: cvWidth, height: cvHeight }, font, {
    maxFontSize: style.maxFontSize,
    minFontSize: style.minFontSize,
    fontStep: style.fontStep,
  })
}

/** Khung "Ngày ký" và "Ghi chú" của mẫu vị trí — mọi trường optional để placement cũ vẫn hợp lệ. */
export type MetaTextBoxes = {
  ngayKyText?: string | null
  ngayKyX?: number
  ngayKyY?: number
  ngayKyWidth?: number
  ngayKyHeight?: number
  ghiChuText?: string | null
  ghiChuX?: number
  ghiChuY?: number
  ghiChuWidth?: number
  ghiChuHeight?: number
}

/**
 * Vẽ "Ngày ký" (1 dòng, canh giữa) và "Ghi chú" (nhiều dòng, tự xuống dòng) theo khung mẫu.
 *
 * BỔ SUNG và có điều kiện như `drawChucVu`: placement không mang nhóm trường này thì không vẽ
 * gì, hồ sơ ký trước khi có tính năng giữ nguyên hình ảnh cũ.
 *
 * ⚠️ Nơi gọi phải tự đảm bảo mỗi khung chỉ gắn vào placement của ĐÚNG MỘT bước. Luồng ký ISO
 * vẽ lại toàn bộ các bước từ file gốc ở lượt cuối — gắn vào mọi bước sẽ ra chữ chồng nhiều lớp.
 */
export function drawMetaTextBoxes(
  page: PDFPage,
  box: MetaTextBoxes,
  font: PDFFont | null,
  style: NameStyle,
): void {
  if (!font) return

  const ngay = (box.ngayKyText || "").trim()
  if (
    ngay && typeof box.ngayKyX === "number" && typeof box.ngayKyY === "number"
    && typeof box.ngayKyWidth === "number" && typeof box.ngayKyHeight === "number"
  ) {
    drawTextFit(
      page, ngay,
      { x: box.ngayKyX, y: box.ngayKyY, width: box.ngayKyWidth, height: box.ngayKyHeight },
      font,
      { maxFontSize: style.maxFontSize, minFontSize: style.minFontSize, fontStep: style.fontStep },
    )
  }

  const ghiChu = (box.ghiChuText || "").trim()
  if (
    ghiChu && typeof box.ghiChuX === "number" && typeof box.ghiChuY === "number"
    && typeof box.ghiChuWidth === "number" && typeof box.ghiChuHeight === "number"
  ) {
    // Ghi chú thường dài vài dòng → dùng bản wrap, KHÔNG dùng drawTextFit (hàm đó chỉ vẽ 1 dòng
    // và tràn ra ngoài khung khi đã ở cỡ chữ nhỏ nhất).
    drawTextWrapped(
      page, ghiChu,
      { x: box.ghiChuX, y: box.ghiChuY, width: box.ghiChuWidth, height: box.ghiChuHeight },
      font,
      { maxFontSize: style.maxFontSize, minFontSize: style.minFontSize, fontStep: style.fontStep },
    )
  }
}

/**
 * Vẽ text canh giữa, tự thu nhỏ cỡ chữ, TRỰC TIẾP vào 1 khung `(x,y,w,h)` — khác
 * `drawSignerName()` (tính vị trí LỆCH so với 1 khung chữ ký khác theo `NameStyle`).
 * Dùng cho hệ thống ký số dùng chung (bảng `truong_ky`, mỗi dòng là 1 khung độc lập
 * với `loai` riêng như 'ten'/'ngay_ky' — không có khái niệm "khung cha" để lệch theo).
 */
export function drawTextFit(
  page: PDFPage,
  text: string | undefined,
  box: { x: number; y: number; width: number; height: number },
  font: PDFFont | null,
  opts?: { maxFontSize?: number; minFontSize?: number; fontStep?: number },
): void {
  if (!text || !font) return
  const maxFontSize = opts?.maxFontSize ?? 11
  const minFontSize = opts?.minFontSize ?? 6
  const fontStep = opts?.fontStep ?? 0.5
  try {
    let fontSize = maxFontSize
    while (fontSize > minFontSize && font.widthOfTextAtSize(text, fontSize) > box.width) {
      fontSize -= fontStep
    }
    const textWidth = font.widthOfTextAtSize(text, fontSize)
    page.drawText(text, {
      x: box.x + (box.width - textWidth) / 2,
      y: box.y + Math.max(0, (box.height - fontSize) / 2),
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    })
  } catch { /* bỏ qua nếu vẽ text thất bại */ }
}

/**
 * Xuống dòng tự động (word-wrap) trong 1 khung, canh trái, canh trên. Khác `drawTextFit()` —
 * hàm đó chỉ vẽ ĐÚNG 1 DÒNG và tràn ra ngoài khung nếu vẫn quá rộng ở cỡ chữ nhỏ nhất.
 *
 * Dùng cho ý kiến chỉ đạo của lãnh đạo (khung "Ghi chú" của mẫu vị trí) — nội dung thường dài
 * vài dòng. `reserveTopHeight` chừa sẵn một dải phía trên khung cho chữ ký nháy, để chữ không
 * đè lên ảnh chữ ký.
 */
export function drawTextWrapped(
  page: PDFPage,
  text: string | undefined,
  box: { x: number; y: number; width: number; height: number },
  font: PDFFont | null,
  opts?: {
    maxFontSize?: number
    minFontSize?: number
    fontStep?: number
    lineHeightRatio?: number
    reserveTopHeight?: number
    color?: { r: number; g: number; b: number }
  },
): void {
  if (!text || !font) return
  const maxFontSize = opts?.maxFontSize ?? 10
  const minFontSize = opts?.minFontSize ?? 6
  const fontStep = opts?.fontStep ?? 0.5
  const lineHeightRatio = opts?.lineHeightRatio ?? 1.25
  const reserveTop = Math.max(0, opts?.reserveTopHeight ?? 0)
  const color = opts?.color ?? { r: 0, g: 0, b: 0 }

  const availH = box.height - reserveTop
  if (availH <= 0) return

  const wrapAt = (size: number): string[] => {
    const out: string[] = []
    for (const paragraph of text.split(/\r?\n/)) {
      if (!paragraph.trim()) {
        out.push("")
        continue
      }
      let line = ""
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(candidate, size) <= box.width) {
          line = candidate
          continue
        }
        if (line) out.push(line)
        // Từ đơn dài hơn cả khung (mã số, đường dẫn...) → cắt theo ký tự.
        let chunk = ""
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > box.width && chunk) {
            out.push(chunk)
            chunk = ch
          } else {
            chunk += ch
          }
        }
        line = chunk
      }
      out.push(line)
    }
    return out
  }

  try {
    let fontSize = maxFontSize
    let lines = wrapAt(fontSize)
    while (fontSize > minFontSize && lines.length * fontSize * lineHeightRatio > availH) {
      fontSize -= fontStep
      lines = wrapAt(fontSize)
    }

    const lineH = fontSize * lineHeightRatio
    const maxLines = Math.max(1, Math.floor(availH / lineH))
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines)
      const last = lines[maxLines - 1]
      lines[maxLines - 1] = last.length > 1 ? `${last.slice(0, -1)}…` : "…"
    }

    let cursorY = box.y + availH - fontSize
    for (const line of lines) {
      if (line) {
        page.drawText(line, {
          x: box.x,
          y: cursorY,
          size: fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
        })
      }
      cursorY -= lineH
    }
  } catch { /* bỏ qua nếu vẽ text thất bại */ }
}

/** Nhân bản chữ ký/tên sang các trang/vị trí khác — tính năng "Nhân bản khung". */
export async function drawExtraPlacements(
  pdfDoc: PDFDocument,
  extraPlacements: ExtraSignaturePlacement[] | undefined,
  sigBytes: (ArrayBuffer | Uint8Array) | null,
  signerName: string | undefined,
  font: PDFFont | null,
  style: NameStyle,
): Promise<void> {
  if (!extraPlacements?.length) return
  for (const extraP of extraPlacements) {
    const extraPageIndex = (extraP.page ?? 1) - 1
    if (extraPageIndex < 0 || extraPageIndex >= pdfDoc.getPageCount()) continue
    const targetPage = pdfDoc.getPage(extraPageIndex)
    try {
      if (sigBytes) await drawSignatureImage(pdfDoc, targetPage, sigBytes, extraP)
      drawSignerName(targetPage, signerName, extraP, font, style)
    } catch { /* bỏ qua lỗi embed bản sao */ }
  }
}
