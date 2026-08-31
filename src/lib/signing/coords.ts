// Quy đổi tọa độ giữa jsPDF (mm, gốc góc TRÊN-TRÁI — dùng ở mọi hàm tạo PDF hiện có:
// quality-pdf.ts/export-order-pdf.ts/maintenance-pdf.ts/dispatch-pdf.ts/output-pdf.ts/
// storage-pdf.ts) và pdf-lib (point, gốc góc DƯỚI-TRÁI — dùng để stamp chữ ký ở
// src/lib/signing/stamp-pdf.ts và lưu trong bảng truong_ky).
//
// Bắt buộc quy đổi ngay tại nơi PDF được tạo ra (mm, top-left) trước khi gửi tọa độ
// cho hệ thống ký — không lưu lẫn 2 hệ quy chiếu ở bất kỳ đâu khác (đúng "cạm bẫy bắt
// buộc xử lý" đã ghi trong cung_cap_dl/du_an_ky_so_dung_chung - new.docx mục 4.3).

const MM_TO_PT = 72 / 25.4

export function mmToPt(mm: number): number {
  return mm * MM_TO_PT
}

export type JsPdfBoxMm = { x: number; y: number; w: number; h: number }
export type PdfLibBoxPt = { xPt: number; yPt: number; wPt: number; hPt: number }

/**
 * `box`: khung theo hệ jsPDF (mm, top-left) trên 1 trang có chiều cao `pageHeightMm`.
 * Trả về khung theo hệ pdf-lib (point, bottom-left) — dùng trực tiếp cho `truong_ky`.
 */
export function jsPdfBoxToPt(pageHeightMm: number, box: JsPdfBoxMm): PdfLibBoxPt {
  return {
    xPt: mmToPt(box.x),
    yPt: mmToPt(pageHeightMm - box.y - box.h),
    wPt: mmToPt(box.w),
    hPt: mmToPt(box.h),
  }
}
