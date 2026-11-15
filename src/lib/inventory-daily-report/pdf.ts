// Kho vật tư — PDF báo cáo sử dụng theo ngày (55-BC / 46-BC Mẫu 12B), A4 NGANG, jsPDF + autoTable, font NotoSans regular
// ("đậm" = tô + viền mảnh). Bố cục đầu trang giống 8A/09: góc trái 3 dòng (dòng 3 đậm), biểu ngữ phải đậm, mã mẫu TRÊN QR
// góc phải trên (QR trỏ trang chi tiết). Khối ký "GIÁM ĐỐC NHÀ MÁY | LẬP BẢNG" — tên người ký do lõi ký đóng dấu. Rule 13/29.

import jsPDF from "jspdf"
import autoTable, { type CellHookData, type RowInput } from "jspdf-autotable"
import { addQrImage, ensurePdfFont, PDF_FONT_NAME } from "@/lib/pdf-qr-shared"
import { COMPANY_HEADING_LINE_1, COMPANY_HEADING_LINE_2, COMPANY_HEADING_LINE_3 } from "@/lib/pdf-company-heading"
import type { DailyReportConfig, DailyReportSignRole, DailyReportSnapshot } from "./types"
import { fmtDayShort, periodLabel } from "./types"

const INK: [number, number, number] = [15, 23, 42]
const RED: [number, number, number] = [185, 28, 28]
const HEAD_FILL: [number, number, number] = [241, 245, 249]
const TOTAL_FILL: [number, number, number] = [248, 250, 252]
const M = 10
const QR = 12.8
const QR_Y = M - 2

export type DailyReportPdfInput = {
  templateName: string
  config: DailyReportConfig
  snapshot: DailyReportSnapshot
  maBaoCao: string | null
  phongBan: string
  loaiKyHieu: string
  nguoiLapChucVu: string | null
  bgdChucVu: string | null
  qrUrl: string
}
export type BoxMm = { x: number; y: number; w: number; h: number }
export type RoleBoxes = { page: number; chuKyBox: BoxMm; tenBox: BoxMm }
export type DailyReportPdf = { bytes: Uint8Array; pageHeightMm: number; boxesByRole: Record<DailyReportSignRole, RoleBoxes> }

/** Số kiểu Việt Nam; 0 in "0" như mẫu giấy. */
export const fmtNum = (v: number) => (Math.abs(v) < 1e-9 ? "0" : v.toLocaleString("vi-VN", { maximumFractionDigits: 3, minimumFractionDigits: 0 }))

function boldAt(doc: jsPDF, s: string | string[], x: number, y: number, size: number, align: "left" | "center" | "right" = "left") {
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(size)
  doc.setLineWidth(size * 0.016)
  doc.setDrawColor(...INK)
  doc.setTextColor(...INK)
  doc.text(s, x, y, { align, renderingMode: "fillThenStroke" })
}

/** Tiêu đề cột: nhãn + dòng phụ (vd "VRG CSR10", "85%"). */
export function columnHeaderText(c: { label: string; subLabel: string }): string {
  return c.subLabel ? `${c.label}\n${c.subLabel}` : c.label
}

export async function buildDailyReportPdf(input: DailyReportPdfInput): Promise<DailyReportPdf> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  doc.setDisplayMode("fullwidth", "continuous")
  await ensurePdfFont(doc)
  const W = 297
  const H = 210
  const snap = input.snapshot
  const cfg = input.config || {}

  // ── Đầu trang ────────────────────────────────────────────────────────────
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setTextColor(...INK)
  if (cfg.maMau) {
    doc.setFontSize(7)
    doc.text(cfg.maMau, W - M - QR / 2, QR_Y - 0.8, { align: "center" })
  }
  const leftW = 100
  const lx = M + leftW / 2
  doc.setFontSize(8.5)
  doc.text(COMPANY_HEADING_LINE_1, lx, M + 1, { align: "center" })
  doc.text(COMPANY_HEADING_LINE_2, lx, M + 4.6, { align: "center" })
  boldAt(doc, COMPANY_HEADING_LINE_3, lx, M + 8.2, 8.5, "center")
  const rx = W - M - QR - 6 - 50
  boldAt(doc, "VƯƠNG QUỐC CAMPUCHIA", rx, M + 1, 8.5, "center")
  boldAt(doc, "Dân tộc - Tôn giáo - Quốc vương", rx, M + 4.6, 8.5, "center")
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8.5)
  const soLine = input.maBaoCao ? `Số: ${input.maBaoCao}` : `Số:      /${input.loaiKyHieu}-${input.phongBan}`
  doc.text(soLine, lx, M + 12.4, { align: "center" })
  const [y, m, d] = snap.to.split("-")
  doc.text(`Kampong Thom, ngày ${d} tháng ${m} năm ${y}`, rx, M + 12.4, { align: "center" })

  let cy = M + 19
  const title = (cfg.tieuDe || input.templateName || "BÁO CÁO").toUpperCase()
  boldAt(doc, title, W / 2, cy, 11.5, "center")
  cy += 5
  boldAt(doc, periodLabel(snap.from, snap.to), W / 2, cy, 10, "center")
  cy += 2.5
  doc.setFont(PDF_FONT_NAME, "normal")
  for (const w of snap.warnings) {
    doc.setFontSize(7.5)
    doc.setTextColor(...RED)
    doc.text(`(!) ${w}`, M, cy + 2.5)
    cy += 3.4
  }
  doc.setTextColor(...INK)

  // ── Bảng ngày × cột ──────────────────────────────────────────────────────
  const cols = snap.columns
  const n = cols.length
  const fontSize = n > 14 ? 6 : n > 10 ? 6.8 : 7.5
  const dayW = 16
  const head: RowInput[] = [["Ngày", ...cols.map(columnHeaderText)]]
  const body: RowInput[] = snap.days.map((day, i) => [fmtDayShort(day), ...snap.values[i].map(fmtNum)])
  const totalRows = new Set<number>()
  totalRows.add(body.length)
  body.push(["Tổng", ...cols.map((c) => fmtNum(c.total))])
  if (snap.kieu === "dau_12b" && n > 0) {
    totalRows.add(body.length)
    body.push(["Tổng cộng", { content: fmtNum(snap.grandTotal), colSpan: n, styles: { halign: "center" } }])
  }
  const colStyles: Record<number, { halign?: "left" | "right" | "center"; cellWidth?: number }> = { 0: { halign: "center", cellWidth: dayW } }
  const dataW = n ? (W - M * 2 - dayW) / n : 0 // cột đều nhau như mẫu giấy
  for (let j = 1; j <= n; j++) colStyles[j] = { halign: "right", cellWidth: dataW }
  autoTable(doc, {
    startY: cy + 1.5,
    margin: { left: M, right: M, top: M + 4, bottom: M },
    head,
    body,
    theme: "grid",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    styles: { font: PDF_FONT_NAME, fontStyle: "normal", fontSize, cellPadding: { top: 0.45, bottom: 0.45, left: 1, right: 1 }, textColor: INK, lineColor: [100, 116, 139], lineWidth: 0.15, valign: "middle", minCellHeight: 3.2 },
    headStyles: { fillColor: HEAD_FILL, textColor: INK, fontStyle: "normal", halign: "center", fontSize: Math.min(fontSize + 0.3, 7.8), cellPadding: 0.8 },
    columnStyles: colStyles,
    didParseCell: (h: CellHookData) => {
      if (h.section === "body" && totalRows.has(h.row.index)) h.cell.styles.fillColor = TOTAL_FILL
    },
  })
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cy

  // ── Khối ký ──────────────────────────────────────────────────────────────
  const SIGN_H = 26
  let sy = finalY + 3
  if (sy + SIGN_H > H - 4) {
    doc.addPage()
    sy = M + 6
  }
  const page = doc.getCurrentPageInfo().pageNumber
  const colW = (W - M * 2) / 2
  const deputy = (input.bgdChucVu || "").toLowerCase().includes("phó")
  const sigCols: Array<{ role: DailyReportSignRole; title: string; sub: string | null }> = [
    { role: "bgd", title: deputy ? "KT. GIÁM ĐỐC NHÀ MÁY" : "GIÁM ĐỐC NHÀ MÁY", sub: deputy ? input.bgdChucVu : null },
    { role: "nguoi_lap", title: (cfg.nhanLap || "LẬP BẢNG").toUpperCase(), sub: input.nguoiLapChucVu || cfg.chucVuLap || null },
  ]
  const boxes = {} as Record<DailyReportSignRole, RoleBoxes>
  sigCols.forEach((c, i) => {
    const cx = M + colW * i + colW / 2
    boldAt(doc, c.title, cx, sy + 3, 9, "center")
    let headBottom = sy + 3
    if (c.sub) {
      doc.setFont(PDF_FONT_NAME, "normal")
      doc.setFontSize(8)
      doc.setTextColor(...INK)
      doc.text(c.sub, cx, sy + 6.6, { align: "center", maxWidth: colW - 4 })
      headBottom = sy + 6.6
    }
    const boxX = M + colW * i + colW / 2 - 40
    const boxW = 80
    const nameY = sy + SIGN_H - 1
    boxes[c.role] = { page, chuKyBox: { x: boxX, y: headBottom + 1.2, w: boxW, h: nameY - headBottom - 5.5 }, tenBox: { x: boxX, y: nameY - 3.5, w: boxW, h: 5.5 } }
  })

  doc.setPage(1)
  await addQrImage(doc, input.qrUrl, W - M - QR, QR_Y, QR)
  const buf = doc.output("arraybuffer") as ArrayBuffer
  return { bytes: new Uint8Array(buf), pageHeightMm: H, boxesByRole: boxes }
}
