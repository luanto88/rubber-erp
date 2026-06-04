import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import {
  formatDateVi,
  formatKg,
  formatKm,
  formatTon,
  getTripMaterials,
  getTripTotals,
  type DispatchAnalytics,
  type DispatchAnalyticsEntry,
  type DispatchMaterialTotals,
  type DispatchFlatTrip,
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

type MaterialAggregateRow = {
  ngay: string
  doiLabel?: string
  trip?: DispatchFlatTrip
  materials: DispatchMaterialTotals
}

const MATERIAL_DEFS: Array<{
  tuoiKey: keyof DispatchMaterialTotals
  khoKey: keyof DispatchMaterialTotals
  baseKey: "mn" | "ct" | "dct" | "dkt" | "dt"
  label: string
}> = [
  { baseKey: "mn", label: "Mủ nước", tuoiKey: "mnTuoi", khoKey: "mnKho" },
  { baseKey: "ct", label: "Mủ chén", tuoiKey: "ctTuoi", khoKey: "ctKho" },
  { baseKey: "dct", label: "Đông chén", tuoiKey: "dctTuoi", khoKey: "dctKho" },
  { baseKey: "dkt", label: "Đông khối", tuoiKey: "dktTuoi", khoKey: "dktKho" },
  { baseKey: "dt", label: "Mủ dây", tuoiKey: "dtTuoi", khoKey: "dtKho" },
]

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

function formatDrc(kho: number, tuoi: number) {
  if (tuoi <= 0 || kho <= 0) return "-"
  return (kho / tuoi * 100).toLocaleString("vi-VN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

function getVisibleMaterials(rows: MaterialAggregateRow[]) {
  return MATERIAL_DEFS.filter((def) =>
    rows.some((row) => {
      const tuoi = row.materials[def.tuoiKey] as number
      const kho = row.materials[def.khoKey] as number
      return tuoi > 0 || kho > 0
    }),
  )
}

function buildMaterialColumns(materials: ReturnType<typeof getVisibleMaterials>) {
  return materials.flatMap((material) => [
    `${material.label} tươi`,
    `${material.label} DRC`,
    `${material.label} khô`,
  ])
}

function materialTripValues(materials: DispatchMaterialTotals, defs: ReturnType<typeof getVisibleMaterials>) {
  return defs.flatMap((def) => {
    const tuoi = materials[def.tuoiKey] as number
    const kho = materials[def.khoKey] as number
    return [formatKg(tuoi), formatDrc(kho, tuoi), formatKg(kho)]
  })
}

function buildDoiRows(trips: DispatchFlatTrip[]) {
  const grouped = new Map<string, MaterialAggregateRow>()
  for (const trip of trips) {
    const dois = trip.dois.length > 0 ? trip.dois : [0]
    const tripMaterials = getTripMaterials(trip)
    for (const doi of dois) {
      const doiLabel = doi ? `Đội ${doi}` : "Chưa rõ đội"
      const key = `${trip.ngay}__${doiLabel}`
      const current = grouped.get(key) || {
        ngay: trip.ngay,
        doiLabel,
        materials: {
          mnTuoi: 0, mnKho: 0,
          ctTuoi: 0, ctKho: 0,
          dctTuoi: 0, dctKho: 0,
          dktTuoi: 0, dktKho: 0,
          dtTuoi: 0, dtKho: 0,
        },
      }
      for (const def of MATERIAL_DEFS) {
        current.materials[def.tuoiKey] = (current.materials[def.tuoiKey] as number) + (tripMaterials[def.tuoiKey] as number)
        current.materials[def.khoKey] = (current.materials[def.khoKey] as number) + (tripMaterials[def.khoKey] as number)
      }
      grouped.set(key, current)
    }
  }
  return [...grouped.values()].sort((a, b) =>
    a.ngay === b.ngay ? (a.doiLabel || "").localeCompare(b.doiLabel || "") : a.ngay.localeCompare(b.ngay),
  )
}

function buildVehicleRows(trips: DispatchFlatTrip[]) {
  return trips
    .map((trip) => ({
      ngay: trip.ngay,
      trip,
      materials: getTripMaterials(trip),
    }))
    .sort((a, b) => {
      if (a.ngay !== b.ngay) return a.ngay.localeCompare(b.ngay)
      if ((a.trip?.so_xe || "") !== (b.trip?.so_xe || "")) return (a.trip?.so_xe || "").localeCompare(b.trip?.so_xe || "")
      return Number(a.trip?.chuyen || 1) - Number(b.trip?.chuyen || 1)
    })
}

function buildAllRows(trips: DispatchFlatTrip[]) {
  const grouped = new Map<string, MaterialAggregateRow>()
  for (const trip of trips) {
    const tripMaterials = getTripMaterials(trip)
    const current = grouped.get(trip.ngay) || {
      ngay: trip.ngay,
      materials: {
        mnTuoi: 0, mnKho: 0,
        ctTuoi: 0, ctKho: 0,
        dctTuoi: 0, dctKho: 0,
        dktTuoi: 0, dktKho: 0,
        dtTuoi: 0, dtKho: 0,
      },
    }
    for (const def of MATERIAL_DEFS) {
      current.materials[def.tuoiKey] = (current.materials[def.tuoiKey] as number) + (tripMaterials[def.tuoiKey] as number)
      current.materials[def.khoKey] = (current.materials[def.khoKey] as number) + (tripMaterials[def.khoKey] as number)
    }
    grouped.set(trip.ngay, current)
  }
  return [...grouped.values()].sort((a, b) => a.ngay.localeCompare(b.ngay))
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
  ]
}

function materialRows(trip: DispatchFlatTrip) {
  const { materials, totalTuoi, totalKho } = getTripTotals(trip)

  return [
    ["Mủ nước", formatKg(materials.mnTuoi), formatDrc(materials.mnKho, materials.mnTuoi), formatKg(materials.mnKho)],
    ["Mủ chén", formatKg(materials.ctTuoi), formatDrc(materials.ctKho, materials.ctTuoi), formatKg(materials.ctKho)],
    ["Đông chén", formatKg(materials.dctTuoi), formatDrc(materials.dctKho, materials.dctTuoi), formatKg(materials.dctKho)],
    ["Đông khối", formatKg(materials.dktTuoi), formatDrc(materials.dktKho, materials.dktTuoi), formatKg(materials.dktKho)],
    ["Mủ dây", formatKg(materials.dtTuoi), formatDrc(materials.dtKho, materials.dtTuoi), formatKg(materials.dtKho)],
    ["TỔNG", formatKg(totalTuoi), formatDrc(totalKho, totalTuoi), formatKg(totalKho)],
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
    head: [["Loại nguyên liệu", "Tươi (kg)", "DRC (%)", "Khô (kg)"]],
    body: materialRows(trip),
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
    columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
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
    head: [["Xe", "Chuyến", "Tài xế", "Đội", "Điểm GN", "Phiên", "Lô thu hoạch", "Xử lý", "Km", "Tươi (kg)", "Khô (kg)"]],
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
  const isVehicleMode = params.mode === "vehicle"
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: isVehicleMode ? "a3" : "a4" })
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
  const allRows = buildAllRows(params.analytics.trips)
  const doiRows = buildDoiRows(params.analytics.trips)
  const vehicleRows = buildVehicleRows(params.analytics.trips)
  const materialRows = params.mode === "vehicle" ? vehicleRows : params.mode === "doi" ? doiRows : allRows
  const visibleMaterials = getVisibleMaterials(materialRows)
  const materialColumns = buildMaterialColumns(visibleMaterials)
  const heading = params.mode === "vehicle"
    ? "Chi tiết theo xe"
    : params.mode === "doi"
      ? "Chi tiết theo đội theo ngày"
      : "Tổng hợp theo ngày"
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(11)
  doc.text(heading, 14, (pdf.lastAutoTable?.finalY || 46) + 10)

  const startY = (pdf.lastAutoTable?.finalY || 46) + 14
  if (params.mode === "vehicle") {
    autoTable(doc, {
      startY,
      head: [[
        "Ngày",
        "Số xe",
        "Tài xế",
        "Chuyến",
        "Phiên",
        "Điểm giao nhận",
        "Lộ trình",
        "Số Km",
        ...materialColumns,
      ]],
      body: vehicleRows.map(({ trip, materials, ngay }) => [
        formatDateVi(ngay),
        trip?.so_xe || "-",
        trip?.tai_xe || "-",
        String(trip?.chuyen || 1),
        (trip?.phien || []).join(", ") || "-",
        (trip?.diem_gn || []).join(", ") || "-",
        (trip?.lo_trinh || []).join(" - ") || "-",
        formatKm(trip?.totalKm || 0),
        ...materialTripValues(materials, visibleMaterials),
      ]),
      theme: "grid",
      styles: { font: PDF_FONT_NAME, fontSize: 7.5, cellPadding: 1.3 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
      columnStyles: {
        3: { halign: "center" },
        7: { halign: "right" },
      },
    })
  } else {
    autoTable(doc, {
      startY,
      head: [[
        "Ngày",
        params.mode === "doi" ? "Đội" : "Nhóm",
        ...materialColumns,
      ]],
      body: (params.mode === "doi" ? doiRows : allRows).map((row) => [
        formatDateVi(row.ngay),
        params.mode === "doi" ? (row.doiLabel || "-") : "Tổng ngày",
        ...materialTripValues(row.materials, visibleMaterials),
      ]),
      theme: "grid",
      styles: { font: PDF_FONT_NAME, fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
    })
  }

  renderSignatures(doc, params.makerName)
  footer(doc)
  const suffix = params.mode === "doi" && params.selectedDoi
    ? `doi-${params.selectedDoi}`
    : params.mode === "vehicle" && params.selectedVehicle
      ? `xe-${safeName(params.selectedVehicle)}`
      : "tong-hop"
  doc.save(`thong-ke-dieu-xe-${suffix}-${params.from || "all"}-${params.to || "all"}.pdf`)
}
