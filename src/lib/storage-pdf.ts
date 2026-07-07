import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import {
  buildStorageLookupUrl,
  formatStorageDate,
  getKLFromTrip,
  summarizeStorageLots,
  type StorageDetailData,
  type StorageNgan,
} from "@/lib/storage-detail"
import { PDF_FONT_NAME, addQrImage, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared"

const ORG_LINE_1 = "Nhà máy chế biến"
const ORG_LINE_2 = "Báo cáo ngăn lưu nguyên liệu"

type PdfWithTable = jsPDF & {
  lastAutoTable?: {
    finalY: number
  }
}

type StoragePeriodReportRow = {
  ngan: StorageNgan
  thanhPhamKg: number
  totalLots: number
  doDangCount: number
  ratioPct: number | null
  lotDetailsText: string
}

function formatKg(value: number) {
  return `${Math.round(value || 0).toLocaleString("vi-VN")} kg`
}

function renderHeader(doc: jsPDF, title: string, contextLine?: string) {
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFillColor(16, 185, 129)
  doc.roundedRect(10, 8, pageWidth - 20, 32, 4, 4, "F")

  doc.setTextColor(255, 255, 255)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10)
  doc.text(ORG_LINE_1, 16, 18)
  doc.text(ORG_LINE_2, 16, 26)
  doc.setFontSize(16)
  doc.text(title, pageWidth / 2, 20, { align: "center" })

  if (contextLine) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(9)
    doc.text(contextLine, pageWidth / 2, 29, { align: "center" })
  }

  doc.setTextColor(15, 23, 42)
}

function renderFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8)
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.text(`Trang ${i}/${pageCount}`, pageW - 12, pageH - 8, { align: "right" })
  }
}

// ─── Bulk QR label sheet (35x35mm, cắt dán tại hiện trường) ──────────────────
const QR_LABEL_SIZE_MM = 35
const QR_LABEL_CELL_PADDING_MM = 2
const QR_LABEL_TEXT_GAP_MM = 1.2
const QR_LABEL_LINE_HEIGHT_MM = 3
const QR_LABEL_MAX_TEXT_LINES = 2
const QR_LABEL_FONT_SIZE_PT = 7.2
const QR_LABEL_GAP_X_MM = 5
const QR_LABEL_GAP_Y_MM = 4
const QR_LABEL_PAGE_MARGIN_MM = 10
const QR_LABEL_HEADER_HEIGHT_MM = 8

function computeBulkQrGridLayout(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  const cellBoxWidth = QR_LABEL_SIZE_MM + QR_LABEL_CELL_PADDING_MM * 2
  const textBlockHeight = QR_LABEL_LINE_HEIGHT_MM * QR_LABEL_MAX_TEXT_LINES
  const cellBoxHeight =
    QR_LABEL_SIZE_MM + QR_LABEL_TEXT_GAP_MM + textBlockHeight + QR_LABEL_CELL_PADDING_MM * 2

  const usableWidth = pageWidth - QR_LABEL_PAGE_MARGIN_MM * 2
  const usableHeight = pageHeight - QR_LABEL_PAGE_MARGIN_MM * 2 - QR_LABEL_HEADER_HEIGHT_MM

  const cols = Math.max(1, Math.floor((usableWidth + QR_LABEL_GAP_X_MM) / (cellBoxWidth + QR_LABEL_GAP_X_MM)))
  const rows = Math.max(1, Math.floor((usableHeight + QR_LABEL_GAP_Y_MM) / (cellBoxHeight + QR_LABEL_GAP_Y_MM)))

  const gridWidth = cols * cellBoxWidth + (cols - 1) * QR_LABEL_GAP_X_MM
  const gridHeight = rows * cellBoxHeight + (rows - 1) * QR_LABEL_GAP_Y_MM
  const offsetX = QR_LABEL_PAGE_MARGIN_MM + Math.max(0, (usableWidth - gridWidth) / 2)
  const offsetY =
    QR_LABEL_PAGE_MARGIN_MM + QR_LABEL_HEADER_HEIGHT_MM + Math.max(0, (usableHeight - gridHeight) / 2)

  return { cols, rows, perPage: cols * rows, cellBoxWidth, cellBoxHeight, offsetX, offsetY }
}

function renderBulkQrPageHeader(doc: jsPDF, pageNo: number, totalPages: number) {
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text("Nhãn QR ngăn lưu — cắt theo đường viền", QR_LABEL_PAGE_MARGIN_MM, 8)
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8)
  doc.text(`Trang ${pageNo}/${totalPages}`, pageWidth - QR_LABEL_PAGE_MARGIN_MM, 8, { align: "right" })
}

export async function downloadStorageBulkQrPdf(
  ngans: Pick<StorageNgan, "id" | "ma_ngan" | "ten_ngan">[],
) {
  if (ngans.length === 0) throw new Error("Chưa chọn ngăn nào để in QR.")

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const layout = computeBulkQrGridLayout(doc)
  const totalPages = Math.ceil(ngans.length / layout.perPage)

  for (let i = 0; i < ngans.length; i++) {
    const indexInPage = i % layout.perPage
    if (indexInPage === 0) {
      const pageIndex = Math.floor(i / layout.perPage)
      if (pageIndex > 0) doc.addPage()
      renderBulkQrPageHeader(doc, pageIndex + 1, totalPages)
    }

    const col = indexInPage % layout.cols
    const row = Math.floor(indexInPage / layout.cols)
    const cellX = layout.offsetX + col * (layout.cellBoxWidth + QR_LABEL_GAP_X_MM)
    const cellY = layout.offsetY + row * (layout.cellBoxHeight + QR_LABEL_GAP_Y_MM)
    const qrX = cellX + QR_LABEL_CELL_PADDING_MM
    const qrY = cellY + QR_LABEL_CELL_PADDING_MM

    const ngan = ngans[i]
    const qrUrl = buildStorageLookupUrl(ngan.id, ngan.ma_ngan)
    await addQrImage(doc, qrUrl, qrX, qrY, QR_LABEL_SIZE_MM)

    // Khung viền nét đứt = đường cắt tham khảo
    doc.setDrawColor(148, 163, 184)
    doc.setLineWidth(0.15)
    doc.setLineDashPattern([1.2, 1], 0)
    doc.rect(cellX, cellY, layout.cellBoxWidth, layout.cellBoxHeight)
    doc.setLineDashPattern([], 0)

    // Nhãn text: ma_ngan đầy đủ, fallback ten_ngan, fallback "—"
    const label = (ngan.ma_ngan || ngan.ten_ngan || "").trim() || "—"
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(QR_LABEL_FONT_SIZE_PT)
    doc.setTextColor(15, 23, 42)

    let lines: string[] = doc.splitTextToSize(label, QR_LABEL_SIZE_MM)
    if (lines.length > QR_LABEL_MAX_TEXT_LINES) {
      lines = lines.slice(0, QR_LABEL_MAX_TEXT_LINES)
      const lastLine = lines[QR_LABEL_MAX_TEXT_LINES - 1] || ""
      lines[QR_LABEL_MAX_TEXT_LINES - 1] =
        lastLine.length > 1 ? `${lastLine.slice(0, -1)}…` : lastLine
    }

    const textX = qrX + QR_LABEL_SIZE_MM / 2
    const textStartY = qrY + QR_LABEL_SIZE_MM + QR_LABEL_TEXT_GAP_MM + QR_LABEL_LINE_HEIGHT_MM * 0.8
    lines.forEach((line, lineIndex) => {
      doc.text(line, textX, textStartY + lineIndex * QR_LABEL_LINE_HEIGHT_MM, { align: "center" })
    })
  }

  const fileSuffix = safeName(`${ngans.length}-ngan-${new Date().toISOString().slice(0, 10)}`)
  doc.save(`in-qr-hang-loat-${fileSuffix}.pdf`)
}

function ratioLabel(ratio: number | null) {
  if (ratio === null || Number.isNaN(ratio)) return "—"
  return `${ratio.toFixed(1)}%`
}

export async function downloadStorageDetailPdf(detail: StorageDetailData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const qrUrl = buildStorageLookupUrl(detail.ngan.id, detail.ngan.ma_ngan)
  const lotSummary = summarizeStorageLots(detail.lots)
  const ratioPct = detail.ngan.tong_kho > 0 ? (lotSummary.thanhPhamKg / detail.ngan.tong_kho) * 100 : null

  renderHeader(
    doc,
    `Phiếu chi tiết ngăn ${detail.ngan.ten_ngan}`,
    `Nguyên liệu ${formatStorageDate(detail.ngan.ngay_bd)} - ${formatStorageDate(detail.ngan.ngay_kt)}`,
  )

  doc.setFillColor(255, 255, 255)
  doc.roundedRect(170, 10, 28, 28, 3, 3, "F")
  await addQrImage(doc, qrUrl, 173, 13, 22)

  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(11)
  doc.text("Thông tin ngăn lưu", 14, 47)

  autoTable(doc, {
    startY: 51,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2.5, textColor: [30, 41, 59] },
    headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 44, fontStyle: "bold" }, 1: { cellWidth: 54 }, 2: { cellWidth: 44, fontStyle: "bold" }, 3: { cellWidth: 44 } },
    body: [
      ["Tên ngăn", detail.ngan.ten_ngan || "—", "Mã ngăn", detail.ngan.ma_ngan || "—"],
      ["Loại nguyên liệu", detail.ngan.loai_nl || "—", "Nguồn gốc", detail.ngan.nguon_goc || "—"],
      ["Xử lý", detail.ngan.xu_ly || "—", "Chứng nhận", detail.ngan.chung_nhan || "—"],
      ["Ngày nguyên liệu", formatStorageDate(detail.ngan.ngay_bd), "Đến ngày", formatStorageDate(detail.ngan.ngay_kt)],
      ["Xé từ ngày", formatStorageDate(detail.ngan.xe_tu_ngay), "Xé đến ngày", formatStorageDate(detail.ngan.xe_den_ngay)],
      ["KL nguyên liệu tươi", formatKg(detail.ngan.tong_tuoi || 0), "KL nguyên liệu khô", formatKg(detail.ngan.tong_kho || 0)],
      ["KL thành phẩm", formatKg(lotSummary.thanhPhamKg), "Tỷ lệ TP/QK", ratioLabel(ratioPct)],
      ["Số chuyến xe", `${detail.trips.length} chuyến`, "Số lô", `${lotSummary.totalLots} lô (${lotSummary.doDangCount} dở dang)`],
      ["Ghi chú", detail.ngan.ghi_chu || "—", "Trạng thái", detail.ngan.trang_thai || "—"],
    ],
  })

  const pdf = doc as PdfWithTable
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(11)
  doc.text("Danh sách chuyến xe", 14, (pdf.lastAutoTable?.finalY || 96) + 8)

  autoTable(doc, {
    startY: (pdf.lastAutoTable?.finalY || 96) + 11,
    theme: "striped",
    styles: { font: PDF_FONT_NAME, fontSize: 8.4, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 110] },
    bodyStyles: { textColor: [30, 41, 59] },
    head: [["Ngày", "Xe", "Chuyến", "Tài xế", "KL tươi", "KL khô"]],
    body: detail.trips.length > 0
      ? detail.trips.map((trip) => {
          const weight = getKLFromTrip(trip, detail.ngan.loai_nl)
          return [
            formatStorageDate(trip._date),
            trip.so_xe || "—",
            `C${trip.chuyen || 1}`,
            trip.tai_xe || "—",
            formatKg(weight.tuoi),
            formatKg(weight.kho),
          ]
        })
      : [["—", "—", "—", "Không có chuyến xe", "—", "—"]],
  })

  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(11)
  doc.text("Danh sách lô thành phẩm", 14, ((doc as PdfWithTable).lastAutoTable?.finalY || 150) + 8)

  autoTable(doc, {
    startY: ((doc as PdfWithTable).lastAutoTable?.finalY || 150) + 11,
    theme: "striped",
    styles: { font: PDF_FONT_NAME, fontSize: 8.4, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235] },
    bodyStyles: { textColor: [30, 41, 59] },
    head: [["Ngày SX", "Mã lô", "Ca", "Chủng loại", "Bành", "KL", "Trạng thái"]],
    body: detail.lots.length > 0
      ? detail.lots.map((lot) => [
          formatStorageDate(lot.ngay_sx),
          lot.ma_lo || "—",
          lot.ca || "—",
          `${lot.loai_csr || "—"} / ${lot.boc || "—"}`,
          `${lot.tong_banh || 0}`,
          formatKg(lot.tong_kg || 0),
          lot.trang_thai || "—",
        ])
      : [["—", "—", "—", "Chưa có lô thành phẩm", "—", "—", "—"]],
  })

  renderFooter(doc)
  doc.save(`chi-tiet-ngan-${safeName(detail.ngan.ten_ngan || detail.ngan.ma_ngan || detail.ngan.id)}.pdf`)
}

export async function downloadStoragePeriodReportPdf(params: {
  from: string
  to: string
  rows: StoragePeriodReportRow[]
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const totalNgans = params.rows.length
  const totalNguyenLieu = params.rows.reduce((sum, row) => sum + (row.ngan.tong_kho || 0), 0)
  const totalThanhPham = params.rows.reduce((sum, row) => sum + row.thanhPhamKg, 0)
  const totalLots = params.rows.reduce((sum, row) => sum + row.totalLots, 0)
  const totalDoDang = params.rows.reduce((sum, row) => sum + row.doDangCount, 0)
  const ratioPct = totalNguyenLieu > 0 ? (totalThanhPham / totalNguyenLieu) * 100 : null

  renderHeader(
    doc,
    "Báo cáo cân đối ngăn lưu theo kỳ",
    `Kỳ ${formatStorageDate(params.from)} - ${formatStorageDate(params.to)}`,
  )

  autoTable(doc, {
    startY: 44,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 10, cellPadding: 3 },
    bodyStyles: { textColor: [15, 23, 42] },
    body: [[
      `Số ngăn: ${totalNgans}`,
      `KL nguyên liệu khô: ${formatKg(totalNguyenLieu)}`,
      `KL thành phẩm: ${formatKg(totalThanhPham)}`,
      `Tỷ lệ TP/QK: ${ratioLabel(ratioPct)}`,
      `Số lô: ${totalLots} (${totalDoDang} dở dang)`,
    ]],
    columnStyles: {
      0: { fillColor: [236, 253, 245] },
      1: { fillColor: [239, 246, 255] },
      2: { fillColor: [238, 242, 255] },
      3: { fillColor: [255, 247, 237] },
      4: { fillColor: [248, 250, 252] },
    },
  })

  autoTable(doc, {
    startY: ((doc as PdfWithTable).lastAutoTable?.finalY || 56) + 8,
    theme: "striped",
    styles: { font: PDF_FONT_NAME, fontSize: 8.2, cellPadding: 2 },
    headStyles: { fillColor: [15, 23, 42] },
    bodyStyles: { textColor: [30, 41, 59] },
    columnStyles: {
      9: { cellWidth: 42 },
    },
    head: [[
      "Ngăn lưu",
      "Mã ngăn",
      "Loại NL",
      "Ngày nguyên liệu",
      "Ngày xé",
      "Ghi chú",
      "KL nguyên liệu khô",
      "KL thành phẩm",
      "Tỷ lệ TP/QK",
      "Số lô chi tiết",
    ]],
    body: params.rows.length > 0
      ? params.rows.map((row) => [
          row.ngan.ten_ngan || "—",
          row.ngan.ma_ngan || "—",
          row.ngan.loai_nl || "—",
          `${formatStorageDate(row.ngan.ngay_bd)} - ${formatStorageDate(row.ngan.ngay_kt)}`,
          `${formatStorageDate(row.ngan.xe_tu_ngay)} - ${formatStorageDate(row.ngan.xe_den_ngay)}`,
          row.ngan.ghi_chu || "—",
          formatKg(row.ngan.tong_kho || 0),
          formatKg(row.thanhPhamKg || 0),
          ratioLabel(row.ratioPct),
          row.lotDetailsText || "—",
        ])
      : [[
          "Không có ngăn phù hợp",
          "—",
          "—",
          "—",
          "—",
          "—",
          "—",
          "—",
          "—",
          "—",
        ]],
  })

  renderFooter(doc)
  doc.save(`bao-cao-ngan-luu-${safeName(params.from)}-${safeName(params.to)}.pdf`)
}
