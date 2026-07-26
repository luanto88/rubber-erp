import jsPDF from "jspdf"
import { PDF_FONT_NAME, addQrImage, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared"
import { buildKpi5sLocationUrl, type Kpi5sLocation } from "@/lib/kpi-5s"

// In QR hàng loạt cho vị trí 5S — dán tại hiện trường, mirror đúng layout
// downloadStorageBulkQrPdf (src/lib/storage-pdf.ts) nhưng tách file riêng vì QR trỏ tới URL
// vị trí 5S khác hẳn ngăn lưu, và nhãn hiển thị "Mã vị trí + Tên vị trí" (2 dòng) thay vì chỉ
// mã ngăn. Không refactor gộp với storage-pdf.ts để tránh đụng code đang chạy ổn định.
const QR_LABEL_SIZE_MM = 32
const QR_LABEL_CELL_PADDING_MM = 2.5
const QR_LABEL_TEXT_GAP_MM = 1.2
const QR_LABEL_LINE_HEIGHT_MM = 3.4
const QR_LABEL_MAX_TEXT_LINES = 3
const QR_LABEL_FONT_SIZE_PT = 7.5
const QR_LABEL_GAP_X_MM = 6
const QR_LABEL_GAP_Y_MM = 5
const QR_LABEL_PAGE_MARGIN_MM = 10
const QR_LABEL_HEADER_HEIGHT_MM = 8

function computeGridLayout(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  const cellBoxWidth = QR_LABEL_SIZE_MM + QR_LABEL_CELL_PADDING_MM * 2
  const textBlockHeight = QR_LABEL_LINE_HEIGHT_MM * QR_LABEL_MAX_TEXT_LINES
  const cellBoxHeight = QR_LABEL_SIZE_MM + QR_LABEL_TEXT_GAP_MM + textBlockHeight + QR_LABEL_CELL_PADDING_MM * 2

  const usableWidth = pageWidth - QR_LABEL_PAGE_MARGIN_MM * 2
  const usableHeight = pageHeight - QR_LABEL_PAGE_MARGIN_MM * 2 - QR_LABEL_HEADER_HEIGHT_MM

  const cols = Math.max(1, Math.floor((usableWidth + QR_LABEL_GAP_X_MM) / (cellBoxWidth + QR_LABEL_GAP_X_MM)))
  const rows = Math.max(1, Math.floor((usableHeight + QR_LABEL_GAP_Y_MM) / (cellBoxHeight + QR_LABEL_GAP_Y_MM)))

  const gridWidth = cols * cellBoxWidth + (cols - 1) * QR_LABEL_GAP_X_MM
  const gridHeight = rows * cellBoxHeight + (rows - 1) * QR_LABEL_GAP_Y_MM
  const offsetX = QR_LABEL_PAGE_MARGIN_MM + Math.max(0, (usableWidth - gridWidth) / 2)
  const offsetY = QR_LABEL_PAGE_MARGIN_MM + QR_LABEL_HEADER_HEIGHT_MM + Math.max(0, (usableHeight - gridHeight) / 2)

  return { cols, rows, perPage: cols * rows, cellBoxWidth, cellBoxHeight, offsetX, offsetY }
}

function renderPageHeader(doc: jsPDF, pageNo: number, totalPages: number) {
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text("Nhãn QR vị trí 5S — cắt theo đường viền, dán tại vị trí", QR_LABEL_PAGE_MARGIN_MM, 8)
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8)
  doc.text(`Trang ${pageNo}/${totalPages}`, pageWidth - QR_LABEL_PAGE_MARGIN_MM, 8, { align: "right" })
}

export async function downloadKpi5sLocationBulkQrPdf(locations: Pick<Kpi5sLocation, "id" | "ma_vi_tri" | "ten_vi_tri">[]) {
  if (locations.length === 0) throw new Error("Chưa chọn vị trí nào để in QR.")

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const layout = computeGridLayout(doc)
  const totalPages = Math.ceil(locations.length / layout.perPage)

  for (let i = 0; i < locations.length; i++) {
    const indexInPage = i % layout.perPage
    if (indexInPage === 0) {
      const pageIndex = Math.floor(i / layout.perPage)
      if (pageIndex > 0) doc.addPage()
      renderPageHeader(doc, pageIndex + 1, totalPages)
    }

    const col = indexInPage % layout.cols
    const row = Math.floor(indexInPage / layout.cols)
    const cellX = layout.offsetX + col * (layout.cellBoxWidth + QR_LABEL_GAP_X_MM)
    const cellY = layout.offsetY + row * (layout.cellBoxHeight + QR_LABEL_GAP_Y_MM)
    const qrX = cellX + QR_LABEL_CELL_PADDING_MM
    const qrY = cellY + QR_LABEL_CELL_PADDING_MM

    const location = locations[i]
    const qrUrl = buildKpi5sLocationUrl(location.id)
    await addQrImage(doc, qrUrl, qrX, qrY, QR_LABEL_SIZE_MM)

    // Khung viền nét đứt = đường cắt tham khảo
    doc.setDrawColor(148, 163, 184)
    doc.setLineWidth(0.15)
    doc.setLineDashPattern([1.2, 1], 0)
    doc.rect(cellX, cellY, layout.cellBoxWidth, layout.cellBoxHeight)
    doc.setLineDashPattern([], 0)

    // Nhãn 2 dòng: mã vị trí (đậm) + tên vị trí (thường), tự wrap tối đa 3 dòng tổng
    doc.setTextColor(15, 23, 42)
    const textX = qrX + QR_LABEL_SIZE_MM / 2
    let cursorY = qrY + QR_LABEL_SIZE_MM + QR_LABEL_TEXT_GAP_MM + QR_LABEL_LINE_HEIGHT_MM * 0.8
    let linesUsed = 0

    doc.setFont(PDF_FONT_NAME, "bold")
    doc.setFontSize(QR_LABEL_FONT_SIZE_PT)
    const codeLines: string[] = doc.splitTextToSize((location.ma_vi_tri || "—").trim(), QR_LABEL_SIZE_MM)
    for (const line of codeLines) {
      if (linesUsed >= QR_LABEL_MAX_TEXT_LINES) break
      doc.text(line, textX, cursorY, { align: "center" })
      cursorY += QR_LABEL_LINE_HEIGHT_MM
      linesUsed += 1
    }

    if (linesUsed < QR_LABEL_MAX_TEXT_LINES) {
      doc.setFont(PDF_FONT_NAME, "normal")
      const nameLines: string[] = doc.splitTextToSize((location.ten_vi_tri || "").trim(), QR_LABEL_SIZE_MM)
      for (let li = 0; li < nameLines.length && linesUsed < QR_LABEL_MAX_TEXT_LINES; li++) {
        let line = nameLines[li]
        if (linesUsed === QR_LABEL_MAX_TEXT_LINES - 1 && li < nameLines.length - 1) {
          line = line.length > 1 ? `${line.slice(0, -1)}…` : line
        }
        doc.text(line, textX, cursorY, { align: "center" })
        cursorY += QR_LABEL_LINE_HEIGHT_MM
        linesUsed += 1
      }
    }
  }

  const fileSuffix = safeName(`${locations.length}-vi-tri-${new Date().toISOString().slice(0, 10)}`)
  doc.save(`in-qr-5s-hang-loat-${fileSuffix}.pdf`)
}
