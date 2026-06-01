import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import {
  formatDateVi,
  formatKg,
  formatKm,
  formatTon,
  getTripTotals,
  type DispatchAnalytics,
  type DispatchAnalyticsEntry,
  type DispatchFlatTrip,
  type DispatchGroupSummary,
} from "@/lib/dispatch-analytics"

const PDF_FONT_FILE = "NotoSans-Regular.ttf"
const PDF_FONT_NAME = "NotoSans"
const ORG_LINE_1 = "Nhà máy chế biến"
const ORG_LINE_2 = "Đội xe vận chuyển"
let fontBase64Promise: Promise<string> | null = null

type PdfWithTable = jsPDF & {
  lastAutoTable?: {
    finalY: number
  }
}

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

function renderHeader(doc: jsPDF, title: string, contextLine?: string) {
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10)
  doc.text(ORG_LINE_1, 14, 12)
  doc.text(ORG_LINE_2, 14, 17)

  doc.setFontSize(15)
  doc.text(title, pageW / 2, 18, { align: "center" })
  if (contextLine) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(9)
    doc.text(contextLine, pageW / 2, 24, { align: "center" })
  }
}

function renderSignatures(doc: jsPDF, makerName?: string) {
  const pdf = doc as PdfWithTable
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const startY = Math.min((pdf.lastAutoTable?.finalY || 0) + 16, pageH - 42)

  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10)
  doc.text("Giám đốc nhà máy", 24, startY)
  doc.text("Lập bảng", pageW - 42, startY, { align: "center" })

  if (makerName) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(9)
    doc.text(makerName, pageW - 42, startY + 26, { align: "center" })
  }
}

function footer(doc: jsPDF) {
  const pages = doc.getNumberOfPages()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8)
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.text(`Trang ${i}/${pages}`, pageW - 14, pageH - 8, { align: "right" })
  }
}

function tripInfoRows(trip: DispatchFlatTrip) {
  const dois = trip.dois.length ? trip.dois.map((doi) => `Đội ${doi}`).join(", ") : "-"

  return [
    ["Mã ĐX", trip.maDx || "-", "Ngày", formatDateVi(trip.ngay)],
    ["Số xe", trip.so_xe || "-", "Tài xế", trip.tai_xe || "-"],
    ["Chuyến", String(trip.chuyen || 1), "Đội", dois],
    ["Dây chuyền", trip.dayChuyen || "-", "Chứng nhận", trip.chungNhan || "-"],
    ["Điểm giao nhận", (trip.diem_gn || []).join(", ") || "-", "Phiên", (trip.phien || []).join(", ") || "-"],
    ["Lộ trình", (trip.lo_trinh || []).join(" - ") || "-", "Km", `${formatKm(trip.totalKm)} km`],
    ["Lô thu hoạch", (trip.lo_thu_hoach || []).join(", ") || "-", "Xử lý", trip.xu_ly || "-"],
    ["Ghi chú", trip.ghi_chu || "-", "", ""],
  ]
}

function materialRows(trip: DispatchFlatTrip) {
  const { materials, totalTuoi, totalKho } = getTripTotals(trip)

  return [
    ["Mủ nước", formatKg(materials.mnTuoi), formatKg(materials.mnKho)],
    ["Mủ chén", formatKg(materials.ctTuoi), formatKg(materials.ctKho)],
    ["Đông chén", formatKg(materials.dctTuoi), formatKg(materials.dctKho)],
    ["Đông khối", formatKg(materials.dktTuoi), formatKg(materials.dktKho)],
    ["Mủ dây", formatKg(materials.dtTuoi), formatKg(materials.dtKho)],
    ["TỔNG", formatKg(totalTuoi), formatKg(totalKho)],
  ]
}

export async function downloadDispatchTripPdf(trip: DispatchFlatTrip, factoryName: string, makerName?: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  renderHeader(doc, `PHIẾU ĐIỀU XE NGÀY ${formatDateVi(trip.ngay)}`, `Nhà máy: ${factoryName}; xe ${trip.so_xe || "-"}; chuyến ${trip.chuyen || 1}`)

  autoTable(doc, {
    startY: 32,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 80], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
    body: tripInfoRows(trip),
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 28 },
      1: { cellWidth: 58 },
      2: { fontStyle: "bold", cellWidth: 28 },
      3: { cellWidth: 58 },
    },
  })

  const pdf = doc as PdfWithTable
  autoTable(doc, {
    startY: (pdf.lastAutoTable?.finalY || 96) + 8,
    head: [["Loại nguyên liệu", "Tươi (kg)", "Khô (kg)"]],
    body: materialRows(trip),
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
    columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" }, 2: { halign: "right" } },
  })

  renderSignatures(doc, makerName)
  footer(doc)
  doc.save(`phieu-dieu-xe-${safeName(trip.maDx || trip.ngay)}-${safeName(trip.so_xe || "xe")}-chuyen-${trip.chuyen || 1}.pdf`)
}

export async function downloadDispatchEntryPdf(params: {
  entry: DispatchAnalyticsEntry
  trips: DispatchFlatTrip[]
  factoryName: string
  makerName?: string
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  renderHeader(doc, `PHIẾU ĐIỀU XE NGÀY ${formatDateVi(params.entry.ngay)}`, `Mã ĐX: ${params.entry.ma_dx || "-"}; nhà máy: ${params.factoryName}; chứng nhận: ${params.entry.chung_nhan || "-"}`)

  autoTable(doc, {
    startY: 32,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 7.5, cellPadding: 1.3 },
    headStyles: { fillColor: [15, 118, 80], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
    head: [["Xe", "Chuyến", "Tài xế", "Đội", "Điểm GN", "Phiên", "Lô thu hoạch", "Xử lý", "Km", "Tươi (kg)", "Khô (kg)", "Ghi chú"]],
    body: params.trips.map((trip) => [
      trip.so_xe || "-",
      String(trip.chuyen || 1),
      trip.tai_xe || "-",
      trip.dois.length ? trip.dois.map((doi) => `Đội ${doi}`).join(", ") : "-",
      (trip.diem_gn || []).join(", ") || "-",
      (trip.phien || []).join(", ") || "-",
      (trip.lo_thu_hoach || []).join(", ") || "-",
      trip.xu_ly || "-",
      formatKm(trip.totalKm),
      formatKg(trip.totalTuoi),
      formatKg(trip.totalKho),
      trip.ghi_chu || "-",
    ]),
    columnStyles: {
      1: { halign: "center" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
    },
  })

  renderSignatures(doc, params.makerName)
  footer(doc)
  doc.save(`phieu-dieu-xe-ngay-${safeName(params.entry.ngay)}.pdf`)
}

function summaryRows(groups: DispatchGroupSummary[]) {
  return groups.map((group) => [
    group.label,
    String(group.trips),
    String(group.vehicles.size),
    formatKm(group.km),
    formatTon(group.mnTuoi, 2),
    formatTon(group.mnKho, 2),
    formatTon(group.ctTuoi + group.dctTuoi + group.dktTuoi + group.dtTuoi, 2),
    formatTon(group.ctKho + group.dctKho + group.dktKho + group.dtKho, 2),
    formatTon(group.totalTuoi, 2),
    formatTon(group.totalKho, 2),
  ])
}

function buildStatsContext(params: {
  from?: string
  to?: string
  mode: "all" | "doi" | "vehicle"
  selectedDoi?: string
  selectedVehicle?: string
}) {
  const range = `Từ ngày ${params.from ? formatDateVi(params.from) : "tất cả"} đến ngày ${params.to ? formatDateVi(params.to) : "tất cả"}`
  if (params.mode === "doi" && params.selectedDoi) return `${range}; đội ${params.selectedDoi}`
  if (params.mode === "vehicle" && params.selectedVehicle) return `${range}; xe ${params.selectedVehicle}`
  return `${range}; tất cả đội xe`
}

export async function downloadDispatchStatsPdf(params: {
  analytics: DispatchAnalytics
  factoryName: string
  from?: string
  to?: string
  mode: "all" | "doi" | "vehicle"
  selectedDoi?: string
  selectedVehicle?: string
  makerName?: string
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  renderHeader(doc, "THỐNG KÊ ĐIỀU XE", `Nhà máy: ${params.factoryName}; ${buildStatsContext(params)}`)

  const t = params.analytics.totals
  autoTable(doc, {
    startY: 32,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2, halign: "center" },
    headStyles: { fillColor: [15, 118, 80], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
    head: [["Bảng ĐX", "Chuyến", "Xe", "Tài xế", "Km", "Tươi (tấn)", "Khô (tấn)"]],
    body: [[
      String(t.entries),
      String(t.trips),
      String(t.vehicles),
      String(t.drivers),
      formatKm(t.km),
      formatTon(t.totalTuoi, 2),
      formatTon(t.totalKho, 2),
    ]],
  })

  const pdf = doc as PdfWithTable
  const groups = params.mode === "vehicle" ? params.analytics.byVehicle : params.analytics.byDoi
  const heading = params.mode === "vehicle" ? "Tổng hợp theo xe" : "Tổng hợp theo đội"
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(11)
  doc.text(heading, 14, (pdf.lastAutoTable?.finalY || 46) + 10)

  autoTable(doc, {
    startY: (pdf.lastAutoTable?.finalY || 46) + 14,
    head: [[params.mode === "vehicle" ? "Số xe" : "Đội", "Chuyến", "Xe", "Km", "MN tươi", "MN khô", "Tạp tươi", "Tạp khô", "Tổng tươi", "Tổng khô"]],
    body: summaryRows(groups),
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
    },
  })

  renderSignatures(doc, params.makerName)
  footer(doc)
  const suffix = params.mode === "doi" && params.selectedDoi
    ? `doi-${params.selectedDoi}`
    : params.mode === "vehicle" && params.selectedVehicle
      ? `xe-${safeName(params.selectedVehicle)}`
      : "tong-hop"
  doc.save(`thong-ke-dieu-xe-${suffix}-${params.from || "all"}-${params.to || "all"}.pdf`)
}
