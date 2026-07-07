import jsPDF from "jspdf"
import { ensurePdfFont, addQrImage, safeName, PDF_FONT_NAME } from "@/lib/pdf-qr-shared"
import { buildProductLabelLookupUrl, type KienLetter } from "@/lib/product-label"
import { buildShortLotLabel } from "@/lib/product-lot-config"

export type ProductLabelItem = {
  factoryId: string
  maLo: string
  num: number
  suffix: string
  kien: KienLetter
  loaiCsr: string
  loaiBanh: number
  boc: string
  nganMa?: string
  nganTen?: string
  // Tỷ lệ lấp đầy hiện tại (%) của ngăn nguồn gốc kiện này — real + predicted + KL "có chủ"
  // của kiện dở dang một phần (xem getReservedKgForPartialKien trong predict/actions.ts).
  nganFillPercent?: number
}

export type ProductLabelPdfOptions = {
  companyLine1?: string
  companyLine2?: string
  footerText?: string
}

// Logo gốc (631x809, dọc) = vòng tròn + dòng chữ viết tắt "VRG PHUOC HOA KAMPONG THOM" bên
// dưới. Một bản cũ từng crop vuông chỉ giữ vòng tròn để tránh bị bóp méo bầu dục khi ép cứng
// logoSize x logoSize — nhưng crop đó vô tình cắt mất dòng chữ viết tắt. Fix đúng: dùng lại
// ảnh gốc đầy đủ, vẽ theo ĐÚNG tỷ lệ khung hình gốc (LOGO_ASPECT) thay vì ép vuông — vừa giữ
// vòng tròn không méo, vừa giữ nguyên dòng chữ viết tắt (dù nhỏ do khung header thấp).
const LOGO_PATH = "/logo-phk-moi.png"
const LOGO_ASPECT = 631 / 809 // width / height gốc
const DEFAULT_COMPANY_LINE_1 = "CÔNG TY TNHH PHÁT TRIỂN CAO SU"
const DEFAULT_COMPANY_LINE_2 = "PHƯỚC HÒA KAMPONG THOM"
const DEFAULT_FOOTER_TEXT = "Nhà máy chế biến PHK"

let logoBase64Promise: Promise<string> | null = null

async function loadLogoBase64(): Promise<string> {
  if (!logoBase64Promise) {
    logoBase64Promise = fetch(LOGO_PATH)
      .then(async (res) => {
        if (!res.ok) throw new Error("Không tải được logo nhãn.")
        const buffer = await res.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ""
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        return `data:image/png;base64,${btoa(binary)}`
      })
      .catch((error) => {
        logoBase64Promise = null
        throw error
      })
  }
  return logoBase64Promise
}

// Lưới cố định 2 cột x 2 hàng = 4 nhãn / trang A4 (khác nhãn ngăn — nhãn kiện cần to,
// rõ, có chỗ ghi tay ngày/ca sản xuất). Xem .claude/rules/06-module-production.md mục "4.6".
const PAGE_MARGIN_MM = 10
const CELL_GAP_X_MM = 6
const CELL_GAP_Y_MM = 6

function computeFixedFourPerPageLayout(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const usableWidth = pageWidth - PAGE_MARGIN_MM * 2
  const usableHeight = pageHeight - PAGE_MARGIN_MM * 2
  const cellWidth = (usableWidth - CELL_GAP_X_MM) / 2
  const cellHeight = (usableHeight - CELL_GAP_Y_MM) / 2
  return { cols: 2, rows: 2, perPage: 4, cellWidth, cellHeight, marginX: PAGE_MARGIN_MM, marginY: PAGE_MARGIN_MM }
}

function shortBoc(boc: string) {
  return (boc || "").trim() || "—"
}

function dashedHLine(doc: jsPDF, x1: number, x2: number, y: number) {
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.2)
  doc.setLineDashPattern([1.5, 1], 0)
  doc.line(x1, y, x2, y)
  doc.setLineDashPattern([], 0)
}

function dashedVLine(doc: jsPDF, x: number, y1: number, y2: number) {
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.2)
  doc.setLineDashPattern([1.5, 1], 0)
  doc.line(x, y1, x, y2)
  doc.setLineDashPattern([], 0)
}

// Nét đứt xám cho đường kẻ điền tay (Ngày SX / Ca SX) — khác với dashedHLine (nét đứt đen,
// dùng để ngăn cách khối) để không lẫn 2 vai trò khác nhau trên cùng 1 nhãn.
function dashedGrayLine(doc: jsPDF, x1: number, x2: number, y: number) {
  doc.setDrawColor(148, 163, 184) // slate-400
  doc.setLineWidth(0.25)
  doc.setLineDashPattern([1, 1], 0)
  doc.line(x1, y, x2, y)
  doc.setLineDashPattern([], 0)
  doc.setDrawColor(0, 0, 0)
}

function fillPercentColor(pct: number): [number, number, number] {
  if (pct >= 100) return [4, 120, 87] // emerald-700
  if (pct >= 80) return [180, 83, 9] // amber-700
  return [71, 85, 105] // slate-600
}

async function renderLabelCell(
  doc: jsPDF,
  item: ProductLabelItem,
  logoDataUrl: string | null,
  opts: Required<ProductLabelPdfOptions>,
  cellX: number,
  cellY: number,
  cellWidth: number,
  cellHeight: number,
) {
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.25)
  doc.rect(cellX, cellY, cellWidth, cellHeight)

  const padX = 4
  doc.setTextColor(0, 0, 0)

  // ── Khối 1: logo (tỷ lệ gốc, không ép vuông) + tên công ty (font +20% cộng
  // dồn từ mức +10% trước đó — 8.25pt → 9.9pt) ─────────────────────────────
  const headerHeight = cellHeight * 0.185
  const logoHeight = Math.min(headerHeight - 4, 16)
  const logoWidth = logoHeight * LOGO_ASPECT
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", cellX + padX, cellY + (headerHeight - logoHeight) / 2, logoWidth, logoHeight)
    } catch {
      // bỏ qua nếu logo lỗi định dạng — không chặn in nhãn
    }
  }
  const companyTextX = cellX + padX + logoWidth + 3
  const companyTextWidth = cellWidth - padX * 2 - logoWidth - 3
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(9.9) // 8.25 * 1.2 (cộng dồn từ mức +10% trước đó, tổng +32% so với 7.5pt gốc)
  const line1 = doc.splitTextToSize(opts.companyLine1, companyTextWidth)
  const line2 = doc.splitTextToSize(opts.companyLine2, companyTextWidth)
  let companyLineY = cellY + headerHeight / 2 - ((line1.length + line2.length) * 4.2 - 4.2) / 2 + 3.2
  ;[...line1, ...line2].forEach((line: string) => {
    doc.text(line, companyTextX, companyLineY)
    companyLineY += 4.2
  })

  const afterHeaderY = cellY + headerHeight
  dashedHLine(doc, cellX, cellX + cellWidth, afterHeaderY)

  // ── Khối 2: QR + mã ngăn + % lấp đầy (trái) | CSR/mã lô/kiện (phải) ─────
  const midBlockHeight = cellHeight * 0.445
  const midTop = afterHeaderY
  const midBottom = midTop + midBlockHeight
  const colDividerX = cellX + cellWidth * 0.46
  dashedVLine(doc, colDividerX, midTop + 2, midBottom - 2)

  const qrColWidth = colDividerX - cellX - padX * 2
  const qrSize = Math.min(qrColWidth, midBlockHeight - 18)
  const qrX = cellX + padX + (qrColWidth - qrSize) / 2
  const qrY = midTop + 3
  const qrUrl = buildProductLabelLookupUrl(item.factoryId, item.maLo, item.kien)
  await addQrImage(doc, qrUrl, qrX, qrY, qrSize)

  // Mã ngăn dưới QR
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(6.5)
  doc.setTextColor(0, 0, 0)
  const nganLabel = (item.nganMa || item.nganTen || "").trim() || "—"
  const nganLines = doc.splitTextToSize(nganLabel, qrColWidth)
  let nganLineY = qrY + qrSize + 3.2
  nganLines.slice(0, 2).forEach((line: string) => {
    doc.text(line, cellX + padX + qrColWidth / 2, nganLineY, { align: "center" })
    nganLineY += 3
  })

  // Tỷ lệ lấp đầy của ngăn nguồn — tính cả KL "có chủ" của kiện dở dang một phần thuộc lô
  // dở dang khác (xem getReservedKgForPartialKien), không chỉ real + predicted thô.
  if (item.nganFillPercent != null) {
    doc.setFont(PDF_FONT_NAME, "bold")
    doc.setFontSize(7)
    const pct = Math.round(Math.max(0, item.nganFillPercent))
    const [r, g, b] = fillPercentColor(pct)
    doc.setTextColor(r, g, b)
    doc.text(`Đầy ${pct}%`, cellX + padX + qrColWidth / 2, nganLineY, { align: "center" })
    doc.setTextColor(0, 0, 0)
  }

  // Cột phải: 3 dòng to đậm, +50% so với bản gốc (15pt → 22.5pt)
  const rightColX = colDividerX + (cellWidth - (colDividerX - cellX)) / 2
  const rightColWidth = cellX + cellWidth - padX - colDividerX
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(22.5)
  const csrLine = doc.splitTextToSize(item.loaiCsr || "—", rightColWidth)
  const maLoLine = buildShortLotLabel(item.num, item.suffix)
  const kienLine = `Kiện ${item.kien}`
  const rightLines = [...csrLine, maLoLine, kienLine]
  const rightLineHeight = 10.5 // 7 * 1.5
  let rightY = midTop + (midBlockHeight - rightLines.length * rightLineHeight) / 2 + rightLineHeight * 0.75
  rightLines.forEach((line) => {
    doc.text(line, rightColX, rightY, { align: "center" })
    rightY += rightLineHeight
  })

  dashedHLine(doc, cellX, cellX + cellWidth, midBottom)

  // ── Khối 3: Bành / Bọc ───────────────────────────────────────────────────
  const infoBlockHeight = cellHeight * 0.16
  const infoTop = midBottom
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(11)
  doc.text(`Bành ${item.loaiBanh || "—"} kg`, cellX + padX, infoTop + infoBlockHeight * 0.42)
  doc.text(`Bọc ${shortBoc(item.boc)}`, cellX + padX, infoTop + infoBlockHeight * 0.85)

  const afterInfoY = infoTop + infoBlockHeight
  dashedHLine(doc, cellX, cellX + cellWidth, afterInfoY)

  // ── Khối 4: Ngày SX / Ca SX (để trống ghi tay) — đường kẻ nét đứt xám nằm
  // ngay mép dưới mỗi dòng, thay cho gạch liền đen ngay dưới chữ như trước ──
  const blankBlockHeight = cellHeight * 0.14
  const blankTop = afterInfoY
  const rowH = blankBlockHeight / 2
  const label1Y = blankTop + rowH * 0.62
  const label2Y = blankTop + rowH + rowH * 0.62
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(10)
  doc.text("Ngày SX:", cellX + padX, label1Y)
  dashedGrayLine(doc, cellX + padX + 18, cellX + cellWidth - padX, blankTop + rowH - 0.8)
  doc.text("Ca SX:", cellX + padX, label2Y)
  // Dịch lên 2mm so với vị trí mặc định (mép dưới hàng) theo yêu cầu — chỉ dòng Ca SX,
  // dòng Ngày SX ở trên giữ nguyên vị trí mép dưới hàng của nó.
  dashedGrayLine(doc, cellX + padX + 16, cellX + cellWidth - padX, blankTop + blankBlockHeight - 0.8 - 2)

  const afterBlankY = blankTop + blankBlockHeight
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.3)
  doc.line(cellX, afterBlankY, cellX + cellWidth, afterBlankY)

  // ── Footer (font +10%) ────────────────────────────────────────────────────
  const footerTop = afterBlankY
  const footerBottom = cellY + cellHeight
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(9.35) // 8.5 * 1.1
  doc.text(opts.footerText, cellX + cellWidth / 2, footerTop + (footerBottom - footerTop) / 2 + 1.5, {
    align: "center",
  })
}

export async function downloadProductLabelPdf(
  items: ProductLabelItem[],
  options: ProductLabelPdfOptions = {},
) {
  if (items.length === 0) throw new Error("Chưa có kiện nào để in nhãn.")

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  let logoDataUrl: string | null = null
  try {
    logoDataUrl = await loadLogoBase64()
  } catch {
    logoDataUrl = null
  }

  const opts: Required<ProductLabelPdfOptions> = {
    companyLine1: options.companyLine1 || DEFAULT_COMPANY_LINE_1,
    companyLine2: options.companyLine2 || DEFAULT_COMPANY_LINE_2,
    footerText: options.footerText || DEFAULT_FOOTER_TEXT,
  }

  // In 2 bản giống nhau / kiện — lặp mỗi item 2 lần liên tiếp
  const duplicated: ProductLabelItem[] = []
  for (const item of items) {
    duplicated.push(item, item)
  }

  const layout = computeFixedFourPerPageLayout(doc)

  for (let i = 0; i < duplicated.length; i++) {
    const indexInPage = i % layout.perPage
    if (indexInPage === 0 && i > 0) doc.addPage()

    const col = indexInPage % layout.cols
    const row = Math.floor(indexInPage / layout.cols)
    const cellX = layout.marginX + col * (layout.cellWidth + CELL_GAP_X_MM)
    const cellY = layout.marginY + row * (layout.cellHeight + CELL_GAP_Y_MM)

    await renderLabelCell(doc, duplicated[i], logoDataUrl, opts, cellX, cellY, layout.cellWidth, layout.cellHeight)
  }

  const fileSuffix = safeName(`${items.length}-kien-${new Date().toISOString().slice(0, 10)}`)
  doc.save(`nhan-thanh-pham-${fileSuffix}.pdf`)
}
