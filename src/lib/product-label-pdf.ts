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

// Hầu hết giá trị loai_boc đã có sẵn tiền tố "Bọc" (vd "Bọc trơn 0,04", "Bọc nhãn 0,04 VRG
// CSR10" — xem .claude/rules/11-factory-config.md) — nếu luôn ghép thêm "Bọc " phía trước sẽ
// bị lặp thành "Bọc Bọc ...". Chỉ tự thêm tiền tố khi dữ liệu KHÔNG có sẵn.
function bocDisplayLine(boc: string) {
  const trimmed = (boc || "").trim()
  if (!trimmed) return "Bọc —"
  return trimmed.startsWith("Bọc") ? trimmed : `Bọc ${trimmed}`
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
  // Tỷ lệ giảm nhẹ (0.185 → 0.16) để nhường chỗ cho khối 4 (Ngày/Giờ/Ca SX) thêm dòng —
  // không ảnh hưởng logo (vẫn bị chặn ở mức tối đa 16mm) hay 2 dòng tên công ty.
  const headerHeight = cellHeight * 0.16
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
  const midBlockHeight = cellHeight * 0.42
  const midTop = afterHeaderY
  const midBottom = midTop + midBlockHeight
  const colDividerX = cellX + cellWidth * 0.46
  dashedVLine(doc, colDividerX, midTop + 2, midBottom - 2)

  // Đo trước mã ngăn (đặt font trước khi splitTextToSize để đo đúng độ rộng) để biết số dòng
  // thực tế, từ đó tính tổng chiều cao nội dung (QR + mã ngăn + % lấp đầy) rồi CĂN GIỮA cả
  // nhóm theo chiều dọc trong khối — thay vì neo cứng QR ở mép trên (fix test tay 2026-07-08:
  // "QR, mã ngăn, tỷ lệ lắp đầy canh giữa vào ô chứa").
  const qrColWidth = colDividerX - cellX - padX * 2
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(6.5)
  doc.setTextColor(0, 0, 0)
  const nganLabel = (item.nganMa || item.nganTen || "").trim() || "—"
  const nganLines: string[] = doc.splitTextToSize(nganLabel, qrColWidth).slice(0, 2)
  const belowQrLineHeight = 3
  const gapAfterQr = 3.2
  const belowQrLines = nganLines.length + (item.nganFillPercent != null ? 1 : 0)
  const qrSize = Math.min(qrColWidth, midBlockHeight - gapAfterQr - belowQrLines * belowQrLineHeight)
  const qrContentHeight = qrSize + gapAfterQr + belowQrLines * belowQrLineHeight
  const qrX = cellX + padX + (qrColWidth - qrSize) / 2
  const qrY = midTop + (midBlockHeight - qrContentHeight) / 2
  const qrUrl = buildProductLabelLookupUrl(item.factoryId, item.maLo, item.kien)
  await addQrImage(doc, qrUrl, qrX, qrY, qrSize)

  // Mã ngăn dưới QR
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(6.5)
  doc.setTextColor(0, 0, 0)
  let nganLineY = qrY + qrSize + gapAfterQr
  nganLines.forEach((line) => {
    doc.text(line, cellX + padX + qrColWidth / 2, nganLineY, { align: "center" })
    nganLineY += belowQrLineHeight
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

  // Cột phải: 3 dòng to đậm — +50% so với gốc (15pt → 22.5pt), +10% (→ 24.75pt), rồi thêm
  // +10% cộng dồn nữa theo yêu cầu tăng thêm kích thước chữ CSR/Kiện/Số lô (→ 27.225pt),
  // vẫn giữ in đậm.
  const rightColX = colDividerX + (cellWidth - (colDividerX - cellX)) / 2
  const rightColWidth = cellX + cellWidth - padX - colDividerX
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(27.225)
  const csrLine = doc.splitTextToSize(item.loaiCsr || "—", rightColWidth)
  const maLoLine = buildShortLotLabel(item.num, item.suffix)
  const kienLine = `Kiện ${item.kien}`
  const rightLines = [...csrLine, maLoLine, kienLine]
  const rightLineHeight = 12.705 // 7 * 1.5 * 1.1 * 1.1
  let rightY = midTop + (midBlockHeight - rightLines.length * rightLineHeight) / 2 + rightLineHeight * 0.75
  rightLines.forEach((line) => {
    doc.text(line, rightColX, rightY, { align: "center" })
    rightY += rightLineHeight
  })

  dashedHLine(doc, cellX, cellX + cellWidth, midBottom)

  // ── Khối 3: Bành / Bọc — cân đối 2 dòng thành 1 nhóm căn giữa khung theo chiều dọc,
  // khoảng cách đều nhau (cùng kỹ thuật với khối 2 — cột CSR/Số lô/Kiện — thay vì 2 mốc
  // tỷ lệ cố định 0.42/0.85 lệch nhau như trước). Tỷ lệ chiều cao giảm nhẹ (0.16 → 0.15) —
  // khối 4 bên dưới có 3 dòng (Ngày/Giờ/Ca SX) nên phải rộng hơn khối 2 dòng này.
  const infoBlockHeight = cellHeight * 0.15
  const infoTop = midBottom
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(11)
  const infoLines = [`Bành ${item.loaiBanh || "—"} kg`, bocDisplayLine(item.boc)]
  const infoLineHeight = 6
  let infoY = infoTop + (infoBlockHeight - infoLines.length * infoLineHeight) / 2 + infoLineHeight * 0.75
  infoLines.forEach((line) => {
    doc.text(line, cellX + padX, infoY)
    infoY += infoLineHeight
  })

  const afterInfoY = infoTop + infoBlockHeight
  dashedHLine(doc, cellX, cellX + cellWidth, afterInfoY)

  // ── Khối 4: Ngày SX / Giờ SX / Ca SX (để trống ghi tay) — chia đều 3 hàng bằng nhau,
  // dùng CHUNG 1 công thức nhất quán cho cả 3 dòng để đảm bảo "3 dòng cách đều nhau" —
  // không còn hiệu chỉnh lệch riêng cho dòng Ca SX như trước (từng phá vỡ tính đều nhau).
  // Đường kẻ nét đứt xám nằm ngay mép dưới mỗi hàng.
  const blankBlockHeight = cellHeight * 0.2
  const blankTop = afterInfoY
  const rowH = blankBlockHeight / 3
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(10)

  // Hàng 1-2: Ngày SX / Giờ SX — mỗi hàng 1 cột chạy hết chiều rộng nhãn
  const blankRows: { label: string; dashOffset: number }[] = [
    { label: "Ngày SX:", dashOffset: 18 },
    { label: "Giờ SX:", dashOffset: 16 },
  ]
  blankRows.forEach((row, i) => {
    const rowTop = blankTop + rowH * i
    doc.text(row.label, cellX + padX, rowTop + rowH * 0.62)
    dashedGrayLine(doc, cellX + padX + row.dashOffset, cellX + cellWidth - padX, rowTop + rowH - 0.8)
  })

  // Hàng 3: Ca SX / Trực ca — tách 2 cột trên cùng 1 hàng theo yêu cầu bổ sung thông tin
  // người trực ca cạnh ca sản xuất, thay vì để nguyên 1 cột full-width như 2 hàng trên.
  const caRowTop = blankTop + rowH * 2
  const caLabelY = caRowTop + rowH * 0.62
  const caDashY = caRowTop + rowH - 0.8
  const caColWidth = (cellWidth - padX * 2) / 2
  doc.text("Ca SX:", cellX + padX, caLabelY)
  dashedGrayLine(doc, cellX + padX + 16, cellX + padX + caColWidth - 3, caDashY)
  doc.text("Trực ca:", cellX + padX + caColWidth + 3, caLabelY)
  dashedGrayLine(doc, cellX + padX + caColWidth + 3 + 18, cellX + cellWidth - padX, caDashY)

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

// Trả về Blob của PDF vừa tạo (bên cạnh việc tự tải file qua doc.save()) — dùng để upload lên
// Storage làm bản "cố định" mở lại được qua icon mà không phải render lại (xem
// .claude/rules/06-module-production.md mục "Cập nhật 2026-07-14"). Chỉ predict/page.tsx đang
// gọi 2 hàm này và không dùng giá trị trả về trước đây, nên đổi Promise<void> → Promise<Blob>
// không phá vỡ nơi gọi khác.
export async function downloadProductLabelPdf(
  items: ProductLabelItem[],
  options: ProductLabelPdfOptions = {},
): Promise<Blob> {
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
  return doc.output("blob")
}

// ─── Nhãn QR nhỏ (chỉ QR + thông tin ngắn) — theo mẫu cung_cap_dl/nhãn nhỏ.png ─────────────
// Lưới cố định 4 cột x 4 hàng = 16 nhãn / trang A4 dọc. Mỗi nhãn chỉ có QR + mã ngăn nguồn
// gốc + % lấp đầy + "Lô: {mã lô ngắn} {kiện}" — không có logo/tên công ty/khối ghi tay như
// nhãn lớn, dùng khi chỉ cần dán nhanh để nhận diện kiện, không cần đầy đủ thông tin.
const SMALL_LABEL_COLS = 4
const SMALL_LABEL_ROWS = 4
const SMALL_LABEL_PAGE_MARGIN_MM = 8
const SMALL_LABEL_GAP_X_MM = 3
const SMALL_LABEL_GAP_Y_MM = 3
const SMALL_LABEL_CELL_PADDING_MM = 2

function computeSmallQrGridLayout(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const usableWidth = pageWidth - SMALL_LABEL_PAGE_MARGIN_MM * 2
  const usableHeight = pageHeight - SMALL_LABEL_PAGE_MARGIN_MM * 2
  const cellWidth = (usableWidth - SMALL_LABEL_GAP_X_MM * (SMALL_LABEL_COLS - 1)) / SMALL_LABEL_COLS
  const cellHeight = (usableHeight - SMALL_LABEL_GAP_Y_MM * (SMALL_LABEL_ROWS - 1)) / SMALL_LABEL_ROWS
  return {
    cols: SMALL_LABEL_COLS,
    rows: SMALL_LABEL_ROWS,
    perPage: SMALL_LABEL_COLS * SMALL_LABEL_ROWS,
    cellWidth,
    cellHeight,
    marginX: SMALL_LABEL_PAGE_MARGIN_MM,
    marginY: SMALL_LABEL_PAGE_MARGIN_MM,
  }
}

async function renderSmallQrCell(
  doc: jsPDF,
  item: ProductLabelItem,
  cellX: number,
  cellY: number,
  cellWidth: number,
  cellHeight: number,
) {
  const padding = SMALL_LABEL_CELL_PADDING_MM

  // Khung nét đứt = đường cắt tham khảo (đậm hơn khung xám nhạt của nhãn ngăn để dễ nhận ra
  // đây là ranh giới từng nhãn khi cắt hàng loạt)
  doc.setDrawColor(51, 65, 85) // slate-700
  doc.setLineWidth(0.2)
  doc.setLineDashPattern([1.5, 1], 0)
  doc.rect(cellX, cellY, cellWidth, cellHeight)
  doc.setLineDashPattern([], 0)

  // QR chiếm gần trọn chiều rộng ô, giới hạn thêm theo chiều cao để luôn còn đủ chỗ cho
  // tối đa 3 dòng text bên dưới (mã ngăn có thể wrap 2 dòng + % lấp đầy + dòng Lô, cỡ chữ
  // đã tăng nên dành thêm dư địa so với bản đầu — 17mm → 20mm)
  const textReserveMm = 20
  const qrSize = Math.min(cellWidth - padding * 2, cellHeight - textReserveMm - padding)
  const qrX = cellX + padding
  const qrY = cellY + padding
  const qrUrl = buildProductLabelLookupUrl(item.factoryId, item.maLo, item.kien)
  await addQrImage(doc, qrUrl, qrX, qrY, qrSize)

  doc.setTextColor(15, 23, 42)
  const textCenterX = cellX + cellWidth / 2
  const textWidth = cellWidth - padding * 2
  let lineY = qrY + qrSize + 3.5

  // Dòng 1: mã ngăn đầy đủ — canh giữa, đậm, cho phép wrap tối đa 2 dòng. Fix test tay
  // 2026-07-08: đổi từ trái sang giữa + tăng font +10% (7.5pt → 8.25pt). Đậm cùng dòng "Lô"
  // bên dưới; chỉ riêng dòng "Lắp đầy %" ở giữa là chữ thường.
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(8.25)
  const nganLabel = (item.nganMa || item.nganTen || "").trim() || "—"
  let nganLines: string[] = doc.splitTextToSize(nganLabel, textWidth)
  if (nganLines.length > 2) {
    nganLines = nganLines.slice(0, 2)
    const last = nganLines[1] || ""
    nganLines[1] = last.length > 1 ? `${last.slice(0, -1)}…` : last
  }
  nganLines.forEach((line) => {
    doc.text(line, textCenterX, lineY, { align: "center" })
    lineY += 3.6
  })

  // Dòng: Lắp đầy X% — canh giữa, chữ thường, +10% (7.5pt → 8.25pt)
  if (item.nganFillPercent != null) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(8.25)
    const pct = Math.round(Math.max(0, item.nganFillPercent))
    doc.text(`Lắp đầy: ${pct}%`, textCenterX, lineY, { align: "center" })
    lineY += 4.6
  }

  // Dòng: Lô {mã lô ngắn} {kiện} — canh giữa, đậm (test tay 2026-07-08: người dùng xác nhận
  // số lô cũng phải in đậm, không chỉ riêng mã ngăn), to, +10% cộng dồn (13pt → 14.3pt → 15.73pt)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(15.73)
  const shortLabel = buildShortLotLabel(item.num, item.suffix)
  const loText = `Lô: ${shortLabel} ${item.kien}`
  const loLines = doc.splitTextToSize(loText, textWidth)
  let loY = lineY + 3.3
  loLines.forEach((line: string) => {
    doc.text(line, textCenterX, loY, { align: "center" })
    loY += 6.1
  })
}

export async function downloadProductLabelSmallQrPdf(items: ProductLabelItem[]): Promise<Blob> {
  if (items.length === 0) throw new Error("Chưa có kiện nào để in nhãn.")

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  // In 2 bản giống nhau / kiện — đồng nhất với nhãn lớn (xem .claude/rules/06-module-production.md mục 4.6)
  const duplicated: ProductLabelItem[] = []
  for (const item of items) {
    duplicated.push(item, item)
  }

  const layout = computeSmallQrGridLayout(doc)

  for (let i = 0; i < duplicated.length; i++) {
    const indexInPage = i % layout.perPage
    if (indexInPage === 0 && i > 0) doc.addPage()

    const col = indexInPage % layout.cols
    const row = Math.floor(indexInPage / layout.cols)
    const cellX = layout.marginX + col * (layout.cellWidth + SMALL_LABEL_GAP_X_MM)
    const cellY = layout.marginY + row * (layout.cellHeight + SMALL_LABEL_GAP_Y_MM)

    await renderSmallQrCell(doc, duplicated[i], cellX, cellY, layout.cellWidth, layout.cellHeight)
  }

  const fileSuffix = safeName(`${items.length}-kien-${new Date().toISOString().slice(0, 10)}`)
  doc.save(`nhan-qr-nho-${fileSuffix}.pdf`)
  return doc.output("blob")
}
