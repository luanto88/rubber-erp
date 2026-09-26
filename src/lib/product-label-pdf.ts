import jsPDF from "jspdf"
import { ensurePdfFont, addQrImage, safeName, PDF_FONT_NAME } from "@/lib/pdf-qr-shared"
import { buildProductLabelLookupUrl, type KienLetter } from "@/lib/product-label"
import { buildShortLotLabel } from "@/lib/product-lot-config"
import {
  ICON_BOC,
  ICON_CALENDAR,
  ICON_FACTORY,
  ICON_KG,
  ICON_WORKER,
  loadIconPng,
} from "@/lib/product-label-icons"

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
  companyLine3?: string
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
const DEFAULT_COMPANY_LINE_3 = "NHÀ MÁY CHẾ BIẾN"

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

// Lưới cố định 2 cột x 3 hàng = 6 nhãn / trang A4, các nhãn nằm sát nhau — chỉ chừa khe nhỏ
// đủ để cắt bằng kéo. Xem .claude/rules/06-module-production.md mục "4.6".
const PAGE_MARGIN_MM = 6
const CELL_GAP_X_MM = 2
const CELL_GAP_Y_MM = 2
const LABEL_COLS = 2
const LABEL_ROWS = 3

function computeSixPerPageLayout(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const usableWidth = pageWidth - PAGE_MARGIN_MM * 2
  const usableHeight = pageHeight - PAGE_MARGIN_MM * 2
  const cellWidth = (usableWidth - CELL_GAP_X_MM * (LABEL_COLS - 1)) / LABEL_COLS
  const cellHeight = (usableHeight - CELL_GAP_Y_MM * (LABEL_ROWS - 1)) / LABEL_ROWS
  return {
    cols: LABEL_COLS,
    rows: LABEL_ROWS,
    perPage: LABEL_COLS * LABEL_ROWS,
    cellWidth,
    cellHeight,
    marginX: PAGE_MARGIN_MM,
    marginY: PAGE_MARGIN_MM,
  }
}

type LabelIcons = {
  kg: string | null
  boc: string | null
  calendar: string | null
  factory: string | null
  worker: string | null
}

async function loadLabelIcons(): Promise<LabelIcons> {
  const [kg, boc, calendar, factory, worker] = await Promise.all([
    loadIconPng(ICON_KG),
    loadIconPng(ICON_BOC),
    loadIconPng(ICON_CALENDAR),
    loadIconPng(ICON_FACTORY),
    loadIconPng(ICON_WORKER),
  ])
  return { kg, boc, calendar, factory, worker }
}

function drawIcon(doc: jsPDF, dataUrl: string | null, x: number, y: number, size: number) {
  if (!dataUrl) return
  try {
    doc.addImage(dataUrl, "PNG", x, y, size, size)
  } catch {
    // icon lỗi không chặn in nhãn
  }
}

// Chọn cỡ chữ lớn nhất ≤ maxSize để text vừa maxWidth (đo bằng font đang set)
function fitFontSize(doc: jsPDF, text: string, maxWidth: number, maxSize: number, minSize: number) {
  let size = maxSize
  doc.setFontSize(size)
  while (size > minSize && doc.getTextWidth(text) > maxWidth) {
    size -= 0.5
    doc.setFontSize(size)
  }
  return size
}

// Thanh tỷ lệ lấp đầy ngăn: phần đã đầy tô chuyển dần trắng → đen (vẽ bằng nhiều dải rect liền
// nhau vì jsPDF không có gradient đơn giản), kèm số % nhỏ ngay mép phần đầy.
function drawFillProgressBar(doc: jsPDF, x: number, y: number, w: number, h: number, pct: number) {
  const radius = h / 2
  const shown = Math.round(Math.max(0, pct))
  const fillW = (w * Math.min(100, Math.max(0, pct))) / 100

  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x, y, w, h, radius, radius, "F")

  if (fillW > 0) {
    const steps = 48
    const stepW = fillW / steps
    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps
      const gray = Math.round(235 - 215 * t)
      doc.setFillColor(gray, gray, gray)
      // Phủ lấn nhẹ sang dải kế tiếp để không lộ khe trắng giữa các dải
      const sx = x + i * stepW
      const sw = Math.min(stepW + 0.05, x + fillW - sx)
      // Bo góc giả ở 2 đầu bằng cách thu chiều cao dải theo cung tròn
      const edgeDist = Math.min(sx + sw / 2 - x, x + w - (sx + sw / 2))
      let inset = 0
      if (edgeDist < radius) {
        const dy = radius - Math.sqrt(Math.max(0, radius * radius - (radius - edgeDist) ** 2))
        inset = dy
      }
      doc.rect(sx, y + inset, sw, h - inset * 2, "F")
    }
  }

  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.3)
  doc.roundedRect(x, y, w, h, radius, radius, "S")

  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(5.8)
  const label = `${shown}%`
  const labelW = doc.getTextWidth(label)
  const textY = y + h / 2 + 0.75
  if (fillW + 1 + labelW <= w - radius / 2) {
    doc.setTextColor(0, 0, 0)
    doc.text(label, x + fillW + 0.8, textY)
  } else {
    doc.setTextColor(255, 255, 255)
    doc.text(label, x + Math.max(radius, fillW - labelW - 1.2), textY)
  }
  doc.setTextColor(0, 0, 0)
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

async function renderLabelCell(
  doc: jsPDF,
  item: ProductLabelItem,
  logoDataUrl: string | null,
  icons: LabelIcons,
  opts: Required<ProductLabelPdfOptions>,
  cellX: number,
  cellY: number,
  cellWidth: number,
  cellHeight: number,
) {
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.3)
  doc.rect(cellX, cellY, cellWidth, cellHeight)

  const padX = 3.5
  doc.setTextColor(0, 0, 0)

  // ── Khối 1: logo (tỷ lệ gốc) + 3 dòng tên công ty / nhà máy (chữ thường, không đậm) ──
  const headerHeight = cellHeight * 0.21
  const logoHeight = headerHeight - 3
  const logoWidth = logoHeight * LOGO_ASPECT
  const logoX = cellX + padX + 2
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", logoX, cellY + (headerHeight - logoHeight) / 2, logoWidth, logoHeight)
    } catch {
      // bỏ qua nếu logo lỗi định dạng — không chặn in nhãn
    }
  }
  const companyTextX = logoX + logoWidth + 7
  const companyTextWidth = cellX + cellWidth - padX - companyTextX
  doc.setFont(PDF_FONT_NAME, "normal")
  const companyLines = [opts.companyLine1, opts.companyLine2, opts.companyLine3].filter(Boolean)
  const companySize = Math.min(
    ...companyLines.map((line) => fitFontSize(doc, line, companyTextWidth, 11.5, 7)),
  )
  doc.setFontSize(companySize)
  const companyLineH = companySize * 0.42
  let companyLineY = cellY + headerHeight / 2 - ((companyLines.length - 1) * companyLineH) / 2 + companySize * 0.14
  companyLines.forEach((line) => {
    doc.text(line, companyTextX, companyLineY)
    companyLineY += companyLineH
  })

  const afterHeaderY = cellY + headerHeight
  dashedHLine(doc, cellX, cellX + cellWidth, afterHeaderY)

  // ── Khối 2: QR + mã ngăn + thanh lấp đầy (trái) | CSR / SỐ LÔ (nổi bật) / Kiện (phải) ──
  const midBlockHeight = cellHeight * 0.51
  const midTop = afterHeaderY
  const midBottom = midTop + midBlockHeight
  const colDividerX = cellX + cellWidth * 0.43
  dashedVLine(doc, colDividerX, midTop + 2.5, midBottom - 2.5)

  const leftColWidth = colDividerX - cellX - padX * 2
  const hasFill = item.nganFillPercent != null
  const nganLabel = (item.nganMa || item.nganTen || "").trim() || "—"
  doc.setFont(PDF_FONT_NAME, "normal")
  const nganSize = fitFontSize(doc, nganLabel, leftColWidth, 7.5, 5)
  const nganLineH = nganSize * 0.42
  const barH = 1.9
  const gapAfterQr = 1.6
  const belowQrHeight = nganLineH + 1.2 + (hasFill ? barH + 0.6 : 0)
  const qrSize = Math.min(leftColWidth - 2, midBlockHeight - 4 - gapAfterQr - belowQrHeight)
  const contentHeight = qrSize + gapAfterQr + belowQrHeight
  const leftCenterX = cellX + padX + leftColWidth / 2
  const qrX = leftCenterX - qrSize / 2
  const qrY = midTop + (midBlockHeight - contentHeight) / 2
  const qrUrl = buildProductLabelLookupUrl(item.factoryId, item.maLo, item.kien)
  await addQrImage(doc, qrUrl, qrX, qrY, qrSize)

  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(nganSize)
  doc.setTextColor(0, 0, 0)
  const nganY = qrY + qrSize + gapAfterQr + nganLineH * 0.8
  doc.text(nganLabel, leftCenterX, nganY, { align: "center" })

  if (hasFill) {
    const barW = Math.min(leftColWidth, qrSize + 2)
    drawFillProgressBar(doc, leftCenterX - barW / 2, nganY + 1.6, barW, barH, item.nganFillPercent || 0)
  }

  // Cột phải: CSR / SỐ LÔ (to nhất) / Kiện — tự co cỡ chữ cho vừa cột
  const rightColLeft = colDividerX
  const rightColWidth = cellX + cellWidth - padX - rightColLeft - 2
  const rightColX = rightColLeft + (cellX + cellWidth - rightColLeft) / 2
  const csrText = (item.loaiCsr || "—").trim()
  const maLoText = buildShortLotLabel(item.num, item.suffix)
  const kienText = `Kiện ${item.kien}`
  doc.setFont(PDF_FONT_NAME, "normal")
  const sideSize = Math.min(
    fitFontSize(doc, csrText, rightColWidth, 30, 12),
    fitFontSize(doc, kienText, rightColWidth, 30, 12),
  )
  doc.setFont(PDF_FONT_NAME, "bold")
  const loSize = fitFontSize(doc, maLoText, rightColWidth - 3, 48, 16)
  const sideH = sideSize * 0.35
  const loH = loSize * 0.35
  const gap = 4.5
  const totalH = sideH + gap + loH + gap + sideH
  let y = midTop + (midBlockHeight - totalH) / 2
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(sideSize)
  doc.text(csrText, rightColX, y + sideH, { align: "center" })
  y += sideH + gap
  // Font PDF chỉ có bản Regular (ensurePdfFont đăng ký "bold" trỏ cùng file) — giả đậm bằng
  // chế độ tô + viền nét cùng màu để số lô nổi bật như mẫu nhãn.
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(loSize)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(loSize * 0.016)
  doc.text(maLoText, rightColX, y + loH, { align: "center", renderingMode: "fillThenStroke" })
  doc.setLineWidth(0.2)
  y += loH + gap
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(sideSize)
  doc.text(kienText, rightColX, y + sideH, { align: "center" })

  dashedHLine(doc, cellX, cellX + cellWidth, midBottom)

  // ── Khối 3: [icon KG] Bành ... · [icon lá] Bọc ... — cùng 1 hàng ──
  const infoHeight = cellHeight * 0.15
  const infoTop = midBottom
  const iconSize = infoHeight * 0.55
  const infoCenterY = infoTop + infoHeight / 2
  const banhText = `Bành ${item.loaiBanh || "—"} kg`
  const bocText = bocDisplayLine(item.boc)
  const bocColX = cellX + cellWidth * 0.36
  doc.setFont(PDF_FONT_NAME, "normal")
  drawIcon(doc, icons.kg, cellX + padX, infoCenterY - iconSize / 2, iconSize)
  const banhX = cellX + padX + iconSize + 2.5
  const banhSize = fitFontSize(doc, banhText, bocColX - banhX - 1.5, 13, 7)
  drawIcon(doc, icons.boc, bocColX, infoCenterY - iconSize / 2, iconSize)
  const bocX = bocColX + iconSize + 2.5
  const bocSize = fitFontSize(doc, bocText, cellX + cellWidth - padX - bocX, 13, 6.5)
  const infoSize = Math.min(banhSize, bocSize)
  doc.setFontSize(infoSize)
  const infoTextY = infoCenterY + infoSize * 0.13
  doc.text(banhText, banhX, infoTextY)
  doc.text(bocText, bocX, infoTextY)

  // ── Khối 4: 3 ô ghi tay — [lịch] Ngày SX · [nhà máy] Ca SX · [công nhân] Trực ca ──
  const blankTop = infoTop + infoHeight
  const blankHeight = cellY + cellHeight - blankTop
  const blankIcon = Math.min(blankHeight * 0.66, 11)
  const blankIconY = blankTop + (blankHeight - blankIcon) / 2 - 0.6
  const lineY = blankIconY + blankIcon - 0.6
  const colW = (cellWidth - padX * 2) / 3
  const blankIcons = [icons.calendar, icons.factory, icons.worker]
  blankIcons.forEach((icon, i) => {
    const colX = cellX + padX + colW * i
    drawIcon(doc, icon, colX, blankIconY, blankIcon)
    dashedGrayLine(doc, colX + blankIcon + 1.2, colX + colW - 1.5, lineY)
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
    companyLine3: options.companyLine3 || DEFAULT_COMPANY_LINE_3,
  }

  // In 2 bản giống nhau / kiện — lặp mỗi item 2 lần liên tiếp
  const duplicated: ProductLabelItem[] = []
  for (const item of items) {
    duplicated.push(item, item)
  }

  const icons = await loadLabelIcons()
  const layout = computeSixPerPageLayout(doc)

  for (let i = 0; i < duplicated.length; i++) {
    const indexInPage = i % layout.perPage
    if (indexInPage === 0 && i > 0) doc.addPage()

    const col = indexInPage % layout.cols
    const row = Math.floor(indexInPage / layout.cols)
    const cellX = layout.marginX + col * (layout.cellWidth + CELL_GAP_X_MM)
    const cellY = layout.marginY + row * (layout.cellHeight + CELL_GAP_Y_MM)

    await renderLabelCell(doc, duplicated[i], logoDataUrl, icons, opts, cellX, cellY, layout.cellWidth, layout.cellHeight)
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
