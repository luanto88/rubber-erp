import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import QRCode from "qrcode"
import {
  buildStorageLookupUrl,
  formatStorageDate,
  getKLFromTrip,
  summarizeStorageLots,
  type StorageDetailData,
  type StorageNgan,
} from "@/lib/storage-detail"

const PDF_FONT_FILE = "NotoSans-Regular.ttf"
const PDF_FONT_NAME = "NotoSans"
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

let fontBase64Promise: Promise<string> | null = null

async function loadPdfFontBase64() {
  if (!fontBase64Promise) {
    fontBase64Promise = fetch(`/fonts/${PDF_FONT_FILE}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Không tải được font PDF: ${PDF_FONT_FILE}`)
        const buffer = await res.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ""
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        return btoa(binary)
      })
      .catch((error) => {
        fontBase64Promise = null
        throw error
      })
  }

  return fontBase64Promise
}

async function ensurePdfFont(doc: jsPDF) {
  const base64 = await loadPdfFontBase64()
  doc.addFileToVFS(PDF_FONT_FILE, base64)
  doc.addFont(PDF_FONT_FILE, PDF_FONT_NAME, "normal")
  doc.addFont(PDF_FONT_FILE, PDF_FONT_NAME, "bold")
  doc.setFont(PDF_FONT_NAME, "normal")
}

function safeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
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

async function addQrImage(doc: jsPDF, qrUrl: string, x: number, y: number, size: number) {
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 240, margin: 1 })
  doc.addImage(qrDataUrl, "PNG", x, y, size, size)
}

function ratioLabel(ratio: number | null) {
  if (ratio === null || Number.isNaN(ratio)) return "—"
  return `${ratio.toFixed(1)}%`
}

export async function downloadStorageDetailPdf(detail: StorageDetailData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const qrUrl = buildStorageLookupUrl(detail.ngan.id)
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
