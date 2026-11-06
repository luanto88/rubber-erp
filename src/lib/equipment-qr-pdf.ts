// GĐ3 — PDF tem QR thiết bị hàng loạt (client). A4 dọc, 4×5 = 20 tem/trang, QR 35×35mm,
// mã thiết bị (giả đậm) + tên ngắn 1 dòng bên dưới — cùng khổ nhãn ngăn lưu (storage-pdf.ts).
import jsPDF from "jspdf"
import { PDF_FONT_NAME, addQrImage, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared"
import { buildEquipmentQrUrl } from "@/lib/equipment-qr"
import { getFactoryTodayISO } from "@/lib/date-utils"

export type EquipmentQrLabelInput = { ma_tb: string; ten_tb: string; token: string }

const QR_MM = 35
const PAD_MM = 2
const TEXT_GAP_MM = 1.2
const CODE_LINE_MM = 3.4
const NAME_LINE_MM = 3
const GAP_X_MM = 5
const GAP_Y_MM = 4
const MARGIN_MM = 10
const HEADER_MM = 8

function computeLayout(doc: jsPDF) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const cellW = QR_MM + PAD_MM * 2
  const cellH = QR_MM + TEXT_GAP_MM + CODE_LINE_MM + NAME_LINE_MM + PAD_MM * 2
  const usableW = pageW - MARGIN_MM * 2
  const usableH = pageH - MARGIN_MM * 2 - HEADER_MM
  const cols = Math.max(1, Math.floor((usableW + GAP_X_MM) / (cellW + GAP_X_MM)))
  const rows = Math.max(1, Math.floor((usableH + GAP_Y_MM) / (cellH + GAP_Y_MM)))
  const gridW = cols * cellW + (cols - 1) * GAP_X_MM
  const gridH = rows * cellH + (rows - 1) * GAP_Y_MM
  return {
    cols,
    rows,
    perPage: cols * rows,
    cellW,
    cellH,
    offsetX: MARGIN_MM + Math.max(0, (usableW - gridW) / 2),
    offsetY: MARGIN_MM + HEADER_MM + Math.max(0, (usableH - gridH) / 2),
  }
}

/** Cắt chuỗi cho vừa `maxWidth` mm ở cỡ chữ hiện tại, thêm "…" nếu bị cắt. */
function fitOneLine(doc: jsPDF, text: string, maxWidth: number) {
  if (doc.getTextWidth(text) <= maxWidth) return text
  let s = text
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > maxWidth) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

export async function buildEquipmentQrLabelsPdf(labels: EquipmentQrLabelInput[]): Promise<jsPDF> {
  if (labels.length === 0) throw new Error("Chưa chọn thiết bị nào để in tem QR.")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  const L = computeLayout(doc)
  const totalPages = Math.ceil(labels.length / L.perPage)
  const pageW = doc.internal.pageSize.getWidth()

  for (let i = 0; i < labels.length; i++) {
    const idx = i % L.perPage
    if (idx === 0) {
      const pageNo = Math.floor(i / L.perPage) + 1
      if (pageNo > 1) doc.addPage()
      doc.setFont(PDF_FONT_NAME, "normal")
      doc.setTextColor(15, 23, 42)
      doc.setFontSize(10)
      doc.text("Tem QR thiết bị — cắt theo đường viền", MARGIN_MM, 8)
      doc.setFontSize(8)
      doc.text(`Trang ${pageNo}/${totalPages}`, pageW - MARGIN_MM, 8, { align: "right" })
    }

    const cellX = L.offsetX + (idx % L.cols) * (L.cellW + GAP_X_MM)
    const cellY = L.offsetY + Math.floor(idx / L.cols) * (L.cellH + GAP_Y_MM)
    const qrX = cellX + PAD_MM
    const qrY = cellY + PAD_MM
    const label = labels[i]
    await addQrImage(doc, buildEquipmentQrUrl(label.token), qrX, qrY, QR_MM)

    doc.setDrawColor(148, 163, 184)
    doc.setLineWidth(0.15)
    doc.setLineDashPattern([1.2, 1], 0)
    doc.rect(cellX, cellY, L.cellW, L.cellH)
    doc.setLineDashPattern([], 0)

    const textX = qrX + QR_MM / 2
    const codeY = qrY + QR_MM + TEXT_GAP_MM + CODE_LINE_MM * 0.8
    // Mã thiết bị: font chỉ có Regular ⇒ giả đậm bằng fill + stroke mảnh (như nhãn kiện thành phẩm).
    doc.setTextColor(15, 23, 42)
    doc.setDrawColor(15, 23, 42)
    doc.setFontSize(9)
    doc.setLineWidth(9 * 0.016)
    doc.text(fitOneLine(doc, label.ma_tb || "—", QR_MM), textX, codeY, { align: "center", renderingMode: "fillThenStroke" })
    doc.setFontSize(7)
    doc.text(fitOneLine(doc, label.ten_tb || "", QR_MM), textX, codeY + NAME_LINE_MM, { align: "center" })
  }
  return doc
}

export async function downloadEquipmentQrLabelsPdf(labels: EquipmentQrLabelInput[]) {
  const doc = await buildEquipmentQrLabelsPdf(labels)
  doc.save(`tem-qr-thiet-bi-${safeName(`${labels.length}-tb-${getFactoryTodayISO()}`)}.pdf`)
}
