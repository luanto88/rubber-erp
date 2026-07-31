import jsPDF from "jspdf"
import { PDF_FONT_NAME, addQrImage, ensurePdfFont } from "@/lib/pdf-qr-shared"

// ─── Thẻ kho — nhãn vật lý dán hiện trường (QR bên trái + khối text bên phải) ─
// Khác layout QR-trên-text-dưới của downloadStorageBulkQrPdf (storage-pdf.ts) — nhãn vật tư cần
// tới 5 dòng thông tin (Mã/Tên/ĐVT/Kho/Vị trí), không đủ chỗ trong ô vuông 35x35mm kiểu ngăn lưu.

export type InventoryCardEntry =
  | {
      kind: "item"
      key: string
      code: string
      name: string
      unit: string
      warehouseCode: string
      warehouseName: string
      locationCode: string | null
      qrUrl: string
    }
  | {
      kind: "oil"
      key: string
      warehouseCode: string
      warehouseName: string
      itemCodes: string[]
      qrUrl: string
    }

const CARD_WIDTH_MM = 92
const CARD_HEIGHT_MM = 32
const CARD_PADDING_MM = 3
const CARD_QR_SIZE_MM = 24
const CARD_GAP_X_MM = 6
const CARD_GAP_Y_MM = 4
const CARD_PAGE_MARGIN_MM = 10
const CARD_HEADER_HEIGHT_MM = 8
const CARD_TEXT_GAP_MM = 3

function computeCardGridLayout(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  const cellBoxWidth = CARD_WIDTH_MM
  const cellBoxHeight = CARD_HEIGHT_MM

  const usableWidth = pageWidth - CARD_PAGE_MARGIN_MM * 2
  const usableHeight = pageHeight - CARD_PAGE_MARGIN_MM * 2 - CARD_HEADER_HEIGHT_MM

  const cols = Math.max(1, Math.floor((usableWidth + CARD_GAP_X_MM) / (cellBoxWidth + CARD_GAP_X_MM)))
  const rows = Math.max(1, Math.floor((usableHeight + CARD_GAP_Y_MM) / (cellBoxHeight + CARD_GAP_Y_MM)))

  const gridWidth = cols * cellBoxWidth + (cols - 1) * CARD_GAP_X_MM
  const gridHeight = rows * cellBoxHeight + (rows - 1) * CARD_GAP_Y_MM
  const offsetX = CARD_PAGE_MARGIN_MM + Math.max(0, (usableWidth - gridWidth) / 2)
  const offsetY = CARD_PAGE_MARGIN_MM + CARD_HEADER_HEIGHT_MM + Math.max(0, (usableHeight - gridHeight) / 2)

  return { cols, rows, perPage: cols * rows, cellBoxWidth, cellBoxHeight, offsetX, offsetY }
}

function renderCardPageHeader(doc: jsPDF, pageNo: number, totalPages: number) {
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text("Thẻ kho — cắt theo đường viền", CARD_PAGE_MARGIN_MM, 8)
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8)
  doc.text(`Trang ${pageNo}/${totalPages}`, pageWidth - CARD_PAGE_MARGIN_MM, 8, { align: "right" })
}

// Cắt text về tối đa maxLines dòng, dòng cuối thêm "…" nếu bị cắt bớt — mirror kỹ thuật đã dùng ở
// downloadStorageBulkQrPdf (storage-pdf.ts).
function wrapLines(doc: jsPDF, text: string, maxWidth: number, maxLines: number): string[] {
  let lines: string[] = doc.splitTextToSize(text, maxWidth)
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    const lastLine = lines[maxLines - 1] || ""
    lines[maxLines - 1] = lastLine.length > 1 ? `${lastLine.slice(0, -1)}…` : lastLine
  }
  return lines
}

type TextRow = { text: string; bold?: boolean; size: number; maxLines?: number }

function renderTextBlock(doc: jsPDF, rows: TextRow[], x: number, y: number, width: number) {
  let cursorY = y
  for (const row of rows) {
    doc.setFont(PDF_FONT_NAME, row.bold ? "bold" : "normal")
    doc.setFontSize(row.size)
    const lineHeight = row.size >= 8.5 ? 4.2 : 3.4
    const lines = wrapLines(doc, row.text, width, row.maxLines ?? 1)
    for (const line of lines) {
      doc.text(line, x, cursorY)
      cursorY += lineHeight
    }
  }
  return cursorY
}

export async function downloadInventoryCardLabelsPdf(entries: InventoryCardEntry[]) {
  if (entries.length === 0) throw new Error("Chưa chọn thẻ kho nào để in.")

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const layout = computeCardGridLayout(doc)
  const totalPages = Math.ceil(entries.length / layout.perPage)

  for (let i = 0; i < entries.length; i++) {
    const indexInPage = i % layout.perPage
    if (indexInPage === 0) {
      const pageIndex = Math.floor(i / layout.perPage)
      if (pageIndex > 0) doc.addPage()
      renderCardPageHeader(doc, pageIndex + 1, totalPages)
    }

    const col = indexInPage % layout.cols
    const row = Math.floor(indexInPage / layout.cols)
    const cellX = layout.offsetX + col * (layout.cellBoxWidth + CARD_GAP_X_MM)
    const cellY = layout.offsetY + row * (layout.cellBoxHeight + CARD_GAP_Y_MM)

    // Khung viền nét đứt = đường cắt tham khảo
    doc.setDrawColor(148, 163, 184)
    doc.setLineWidth(0.15)
    doc.setLineDashPattern([1.2, 1], 0)
    doc.rect(cellX, cellY, layout.cellBoxWidth, layout.cellBoxHeight)
    doc.setLineDashPattern([], 0)

    const entry = entries[i]
    const qrX = cellX + CARD_PADDING_MM
    const qrY = cellY + (CARD_HEIGHT_MM - CARD_QR_SIZE_MM) / 2
    await addQrImage(doc, entry.qrUrl, qrX, qrY, CARD_QR_SIZE_MM)

    const textX = qrX + CARD_QR_SIZE_MM + CARD_TEXT_GAP_MM
    const textWidth = CARD_WIDTH_MM - CARD_QR_SIZE_MM - CARD_TEXT_GAP_MM - CARD_PADDING_MM * 2
    const textY = cellY + CARD_PADDING_MM + 3.2

    doc.setTextColor(15, 23, 42)
    const rows: TextRow[] =
      entry.kind === "item"
        ? [
            { text: entry.code, bold: true, size: 9 },
            { text: entry.name, size: 7, maxLines: 2 },
            { text: `ĐVT: ${entry.unit}`, size: 6.5 },
            { text: `Kho: ${entry.warehouseCode} - ${entry.warehouseName}`, size: 6.5, maxLines: 1 },
            { text: `Vị trí: ${entry.locationCode || "Chưa cấu hình"}`, size: 6.5, maxLines: 1 },
          ]
        : [
            { text: `KHO DẦU ${entry.warehouseCode}`, bold: true, size: 9 },
            { text: entry.warehouseName, size: 7, maxLines: 1 },
            { text: "Dùng chung:", bold: true, size: 6.5 },
            { text: entry.itemCodes.join(", "), size: 6.5, maxLines: 2 },
          ]

    renderTextBlock(doc, rows, textX, textY, textWidth)
  }

  doc.save(`the-kho-${new Date().toISOString().slice(0, 10)}.pdf`)
}
