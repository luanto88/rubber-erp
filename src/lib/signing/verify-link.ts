import { PDFDocument, PDFArray, PDFName, PDFNumber, PDFString } from "@cantoo/pdf-lib"
import { applyPadesSignatureToDoc } from "./pades"

/**
 * Link "xem bằng chứng xác minh" phủ trên ô con dấu chữ ký — dùng CHUNG cho mọi module có ký số
 * (Văn bản nội bộ và ISO). Tách ra khỏi `api/documents/sign/route.ts` ngày 2026-09-08 khi module
 * ISO cần đúng hành vi này: giữ 2 bản logic song song là cách chắc chắn nhất để chúng trôi lệch
 * nhau sau vài lần sửa.
 *
 * ⚠️ Annotation BẮT BUỘC phải được thêm TRƯỚC khi nhúng chữ ký PAdES — chữ ký ký lên đúng dải
 * byte tại thời điểm ký, thêm annotation sau sẽ làm hỏng chữ ký vừa tạo.
 */

export type VerifyLinkTarget = {
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * Phủ link annotation lên đúng ô con dấu — bấm vào (Acrobat/Chrome/mọi trình xem hỗ trợ link)
 * mở trang xác thực chữ ký PAdES của chính bước đó. Mirror kỹ thuật append-vào-Annots của
 * `addSignaturePlaceholderToDoc` (pades.ts).
 *
 * Dùng khi caller đang giữ sẵn 1 `PDFDocument` sống (module Văn bản: `pdfDoc` xuyên suốt cả
 * lượt ký, không được reload giữa chừng — xem bug 74.8MB ghi trong pades.ts). Caller chỉ có
 * bytes trong tay thì dùng `sealPdfWithVerifyLink` bên dưới.
 */
export function addVerifyLinkAnnotations(
  pdfDoc: PDFDocument,
  targets: VerifyLinkTarget[],
  url: string,
): void {
  const pages = pdfDoc.getPages()
  for (const t of targets) {
    const page = pages[t.pageIndex]
    if (!page) continue
    try {
      const rect = PDFArray.withContext(pdfDoc.context)
      ;[t.x, t.y, t.x + t.width, t.y + t.height].forEach((c) => rect.push(PDFNumber.of(c)))
      const linkDict = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: rect,
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
      })
      const linkRef = pdfDoc.context.register(linkDict)
      let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)
      if (typeof annots === "undefined") {
        annots = pdfDoc.context.obj([])
        page.node.set(PDFName.of("Annots"), annots)
      }
      annots.push(linkRef)
    } catch {
      /* thêm link thất bại không được chặn luồng ký chính */
    }
  }
}

/**
 * Biến thể nhận thẳng bytes: load 1 lần bằng `@cantoo/pdf-lib` → phủ link → nhúng PAdES.
 *
 * Dành cho module ISO — route ISO dựng lại toàn bộ file từ `file_goc_url` mỗi lượt ký rồi
 * `PDFDocument.create()` + `copyPages()` + `save()` (thao tác này phẳng hoá file, xoá sạch mọi
 * annotation/chữ ký số của lượt trước), nên nó chỉ có bytes cuối cùng trong tay và chỉ ký MỘT
 * lần duy nhất lúc phê duyệt. Vì chỉ load đúng 1 lần cho 1 lần ký, đây KHÔNG rơi vào bug
 * reload-nhiều-lần đã ghi trong `pades.ts` (bug đó phát sinh khi reload nhiều lượt liên tiếp
 * trên cùng một file đã qua incremental-update).
 */
export async function sealPdfWithVerifyLink(
  pdfBytes: Buffer,
  targets: VerifyLinkTarget[],
  verifyUrl: string,
  signerName: string,
  contactEmail: string,
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes, { forIncrementalUpdate: true })
  addVerifyLinkAnnotations(doc, targets, verifyUrl)
  return applyPadesSignatureToDoc(doc, signerName, contactEmail)
}
