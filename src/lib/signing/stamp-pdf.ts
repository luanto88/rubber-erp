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

// Hằng số style hiện có của module Văn bản (`api/documents/sign/route.ts`) — nhỏ hơn ISO
// có chủ đích (khung chữ ký Văn bản nhỏ hơn khung ISO). KHÔNG được đổi thành
// `ISO_SIGNER_NAME_STYLE` — sẽ đổi giao diện chữ ký Văn bản đã ký thật trên production.
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
