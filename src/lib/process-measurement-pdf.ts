import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { ensurePdfFont, addQrImage, safeName, PDF_FONT_NAME } from "@/lib/pdf-qr-shared"
import { formatDateDisplay } from "@/lib/date-utils"
import { fetchImageForPdf, isPdfImageFailure } from "@/lib/image-format"

/**
 * Phiếu đo nhanh chỉ tiêu (Kiểm soát quá trình) dạng PDF thật (jsPDF) — dùng cho khung xem nhúng
 * (`DocViewer loadBytes`) ở trang chi tiết `/dashboard/process/measurements/[id]` và nút "Tải PDF".
 * A4 ngang, QR góc phải trên trỏ trang chi tiết (rule 29 mục D2). Trang in HTML cũ
 * (`/dashboard/process/print`) vẫn giữ nguyên cho nút "In".
 */

export type ProcessMeasurementPdfRow = {
  chi_tieu: string[]
  thung: string | null
  lo: string | null
  mau: string | null
  che_do_say: string | null
  ca_sx: string | null
  ngan_label: string | null
  so_ngay_luu: number | null
  ket_qua: Record<string, number | null> | null
  nguoi_do: string | null
  ghi_chu: string | null
  image_urls: string[] | null
}

export type ProcessMeasurementPdfInput = {
  ma_phieu: string | null
  ngay: string
  created_at: string | null
  day_chuyen: string | null
  loai_csr: string | null
  factoryName: string | null
  rows: ProcessMeasurementPdfRow[]
  qrUrl?: string | null
}

const INK: [number, number, number] = [15, 23, 42]
const GRAY: [number, number, number] = [100, 116, 139]
const BORDER: [number, number, number] = [203, 213, 225]
const PANEL_BG: [number, number, number] = [248, 250, 252]

const PAGE_W = 297
const PAGE_H = 210
const MARGIN = 10
const CONTENT_W = PAGE_W - MARGIN * 2
const QR_SIZE = 18

function fmtNumber(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return ""
  return String(v).replace(".", ",")
}

function fmtTime(value: string | null) {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
}

/** Các chỉ tiêu xuất hiện trong phiếu, giữ thứ tự gặp đầu tiên. */
export function processMeasurementChiTieu(rows: ProcessMeasurementPdfRow[]): string[] {
  const seen: string[] = []
  for (const r of rows) for (const ct of r.chi_tieu || []) if (!seen.includes(ct)) seen.push(ct)
  return seen
}

async function buildProcessMeasurementDoc(input: ProcessMeasurementPdfInput) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" })
  await ensurePdfFont(doc)
  doc.setDisplayMode("fullpage", "single")
  doc.setFont(PDF_FONT_NAME, "normal")

  let y = MARGIN

  // Tiêu đề + QR góc phải trên
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text((input.factoryName || "KIỂM SOÁT QUÁ TRÌNH").toUpperCase(), MARGIN, y + 3)
  doc.setFontSize(15)
  doc.setTextColor(...INK)
  doc.text("PHIẾU ĐO NHANH CHỈ TIÊU", MARGIN, y + 11)
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  doc.text(`Số: ${input.ma_phieu || "—"}`, MARGIN, y + 16.5)

  if (input.qrUrl) {
    try {
      await addQrImage(doc, input.qrUrl, PAGE_W - MARGIN - QR_SIZE, y, QR_SIZE)
    } catch {
      // QR lỗi không chặn dựng phiếu
    }
  }
  y += QR_SIZE + 3

  // Thẻ thông tin
  const timeText = fmtTime(input.created_at)
  const cards: Array<{ label: string; value: string }> = [
    { label: "Ngày đo", value: `${formatDateDisplay(input.ngay)}${timeText ? ` ${timeText}` : ""}` },
    { label: "Dây chuyền", value: input.day_chuyen || "—" },
    { label: "Loại CSR", value: input.loai_csr || "—" },
    { label: "Số mẫu", value: String(input.rows.length) },
  ]
  const gap = 3
  const cardW = (CONTENT_W - gap * (cards.length - 1)) / cards.length
  const cardH = 11
  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardW + gap)
    doc.setFillColor(...PANEL_BG)
    doc.setDrawColor(...BORDER)
    doc.roundedRect(x, y, cardW, cardH, 1.2, 1.2, "FD")
    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text(card.label.toUpperCase(), x + 2, y + 3.6)
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text(doc.splitTextToSize(card.value, cardW - 4)[0] as string, x + 2, y + 8.2)
  })
  y += cardH + 4

  // Bảng dòng đo — cột kết quả động theo chỉ tiêu có trong phiếu
  const cts = processMeasurementChiTieu(input.rows)
  const head = ["STT", "Thùng / Lô / Mẫu", "Chế độ sấy", ...cts, "Ca SX", "Ngăn / Ngày lưu", "Người đo", "Ghi chú"]
  const colCount = head.length
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: "grid",
    head: [head],
    body: input.rows.length
      ? input.rows.map((r, idx) => [
          String(idx + 1),
          [r.thung, r.lo, r.mau].filter(Boolean).join(" / "),
          r.che_do_say || "",
          ...cts.map((ct) => ((r.chi_tieu || []).includes(ct) ? fmtNumber((r.ket_qua || {})[ct]) : "")),
          r.ca_sx || "",
          [r.ngan_label, r.so_ngay_luu != null ? `${r.so_ngay_luu} ngày` : ""].filter(Boolean).join(" · "),
          r.nguoi_do || "",
          r.ghi_chu || "",
        ])
      : [[{ content: "Phiếu chưa có dòng đo", colSpan: colCount, styles: { halign: "center", textColor: GRAY } }]],
    styles: { font: PDF_FONT_NAME, fontSize: 8, cellPadding: 1.4, textColor: INK, lineColor: BORDER, lineWidth: 0.2 },
    headStyles: { fillColor: [204, 251, 241], textColor: INK, fontStyle: "normal" },
    columnStyles: Object.fromEntries([
      [0, { cellWidth: 10, halign: "center" }],
      [1, { cellWidth: 34 }],
      [2, { cellWidth: 26 }],
      ...cts.map((_, i) => [3 + i, { cellWidth: 16, halign: "right" }]),
    ]),
    rowPageBreak: "avoid",
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5

  // Ảnh hiện trường — lưới 4 cột, kèm nhãn "Mẫu N"
  const images = input.rows.flatMap((r, idx) => (r.image_urls || []).map((url) => ({ url, label: `Mẫu ${idx + 1}` })))
  if (images.length) {
    const cols = 4
    const cellGap = 4
    const cellW = (CONTENT_W - cellGap * (cols - 1)) / cols
    const imgH = 48
    const cellH = imgH + 6
    if (y + 8 + cellH > PAGE_H - MARGIN) {
      doc.addPage()
      y = MARGIN
    }
    doc.setFontSize(10)
    doc.setTextColor(...INK)
    doc.text("HÌNH ẢNH HIỆN TRƯỜNG", MARGIN, y + 4)
    y += 7
    const loaded = await Promise.all(images.map((img) => fetchImageForPdf(img.url, { maxDimension: 900 })))
    loaded.forEach((res, i) => {
      const col = i % cols
      if (col === 0 && i > 0) y += cellH + cellGap
      if (col === 0 && y + cellH > PAGE_H - MARGIN) {
        doc.addPage()
        y = MARGIN
      }
      const x = MARGIN + col * (cellW + cellGap)
      doc.setDrawColor(...BORDER)
      doc.rect(x, y, cellW, imgH)
      if (isPdfImageFailure(res)) {
        doc.setFontSize(7.5)
        doc.setTextColor(...GRAY)
        doc.text(doc.splitTextToSize(res.reason, cellW - 4) as string[], x + cellW / 2, y + imgH / 2, { align: "center" })
      } else {
        const scale = Math.min((cellW - 2) / res.width, (imgH - 2) / res.height)
        const w = res.width * scale
        const h = res.height * scale
        doc.addImage(res.dataUrl, res.format, x + (cellW - w) / 2, y + (imgH - h) / 2, w, h)
      }
      doc.setFontSize(7.5)
      doc.setTextColor(...GRAY)
      doc.text(images[i].label, x + cellW / 2, y + imgH + 4, { align: "center" })
    })
  }

  return doc
}

export function processMeasurementFileName(maPhieu: string | null) {
  return `Phieu-do-nhanh-${safeName(maPhieu || "chua-co-ma")}.pdf`
}

/** Bytes PDF phiếu để nhúng vào `DocViewer loadBytes`. */
export async function buildProcessMeasurementPdfBytes(input: ProcessMeasurementPdfInput): Promise<Uint8Array> {
  const doc = await buildProcessMeasurementDoc(input)
  return new Uint8Array(doc.output("arraybuffer"))
}

export async function downloadProcessMeasurementPdf(input: ProcessMeasurementPdfInput) {
  const doc = await buildProcessMeasurementDoc(input)
  doc.save(processMeasurementFileName(input.ma_phieu))
}
