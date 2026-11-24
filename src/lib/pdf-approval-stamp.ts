// Dấu duyệt góc PHẢI cuối trang cuối (GĐ3 L4) — cùng kiểu tag "✓ Văn bản được ký dd/mm/yyyy hh:mm:ss" của Văn bản
// nội bộ: 1 dòng, tick xanh vẽ bằng 2 nét (KHÔNG dùng ký tự ✓ — font thiếu glyph) + chữ xám mờ.
// Nội dung: "Phiếu được duyệt bởi {Tên} dd/mm/yyyy hh:mm:ss" (giờ nhà máy). Dùng cho F09 (jsPDF) và F01/F02 (Canvas).

import type jsPDF from "jspdf"
import { formatFactoryDateTimeVN } from "@/lib/date-utils"

export type ApprovalStamp = { ten: string; luc: string }

// Đồng bộ màu với TICK_COLOR / DATE_TEXT_COLOR của src/lib/signing/stamp-pdf.ts (rgb 0.06,0.6,0.35 / 0.45 xám).
const TICK_RGB: [number, number, number] = [15, 153, 89]
const TEXT_RGB: [number, number, number] = [115, 115, 115]
const TICK_HEX = "#0f9959"
const TEXT_HEX = "#737373"

export function approvalStampText(stamp: ApprovalStamp): string {
  const d = new Date(stamp.luc)
  const when = Number.isNaN(d.getTime()) ? "" : formatFactoryDateTimeVN(d)
  return `Phiếu được duyệt bởi ${stamp.ten} ${when}`.trim()
}

/** jsPDF (mm). Canh phải tại `rightX`, tâm dòng tại `centerY`. Font hiện hành phải có dấu tiếng Việt. */
export function drawApprovalStampPdf(doc: jsPDF, stamp: ApprovalStamp, rightX: number, centerY: number) {
  const text = approvalStampText(stamp)
  doc.setFontSize(8.5)
  const textW = doc.getTextWidth(text)
  const tick = 3.4
  const gap = tick * 0.35
  const startX = rightX - textW - gap - tick
  const y0 = centerY - tick / 2
  doc.setDrawColor(...TICK_RGB)
  doc.setLineWidth(Math.max(0.35, tick * 0.12))
  // Toạ độ jsPDF gốc trên-trái ⇒ lật trục y so với drawTick của pdf-lib.
  doc.line(startX + tick * 0.16, y0 + tick * 0.48, startX + tick * 0.42, y0 + tick * 0.76)
  doc.line(startX + tick * 0.42, y0 + tick * 0.76, startX + tick * 0.86, y0 + tick * 0.22)
  doc.setTextColor(...TEXT_RGB)
  doc.text(text, startX + tick + gap, centerY + 1.1)
  doc.setTextColor(0, 0, 0)
  doc.setDrawColor(0, 0, 0)
}

/** Canvas 2D (px CSS). Canh phải tại `rightX`, tâm dòng tại `centerY`. */
export function drawApprovalStampCanvas(
  ctx: CanvasRenderingContext2D,
  stamp: ApprovalStamp,
  rightX: number,
  centerY: number,
  fontFamily: string,
) {
  const text = approvalStampText(stamp)
  ctx.save()
  ctx.font = `12px ${fontFamily}`
  ctx.textBaseline = "middle"
  ctx.textAlign = "left"
  const textW = ctx.measureText(text).width
  const tick = 14
  const gap = tick * 0.35
  const startX = rightX - textW - gap - tick
  const y0 = centerY - tick / 2
  ctx.strokeStyle = TICK_HEX
  ctx.lineWidth = Math.max(1.5, tick * 0.14)
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(startX + tick * 0.16, y0 + tick * 0.48)
  ctx.lineTo(startX + tick * 0.42, y0 + tick * 0.76)
  ctx.lineTo(startX + tick * 0.86, y0 + tick * 0.22)
  ctx.stroke()
  ctx.fillStyle = TEXT_HEX
  ctx.fillText(text, startX + tick + gap, centerY)
  ctx.restore()
}
