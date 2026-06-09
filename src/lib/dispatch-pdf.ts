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
import { describeNoteFilter } from "@/lib/note-filter"

const PDF_FONT_FILE = "NotoSans-Regular.ttf"
const PDF_FONT_NAME = "NotoSans"
const ORG_LINE_1 = "Nh\u00e0 m\u00e1y ch\u1ebf bi\u1ebfn"
const ORG_LINE_2 = "\u0110\u1ed9i xe v\u1eadn chuy\u1ec3n"
let fontBase64Promise: Promise<string> | null = null

type PdfWithTable = jsPDF & {
  lastAutoTable?: {
    finalY: number
  }
}

type MaterialAggregateRow = {
  ngay: string
  doi?: number
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
  { baseKey: "mn", label: "M\u1ee7 n\u01b0\u1edbc", tuoiKey: "mnTuoi", khoKey: "mnKho" },
  { baseKey: "ct", label: "M\u1ee7 ch\u00e9n", tuoiKey: "ctTuoi", khoKey: "ctKho" },
  { baseKey: "dct", label: "\u0110\u00f4ng ch\u00e9n", tuoiKey: "dctTuoi", khoKey: "dctKho" },
  { baseKey: "dkt", label: "\u0110\u00f4ng kh\u1ed1i", tuoiKey: "dktTuoi", khoKey: "dktKho" },
  { baseKey: "dt", label: "M\u1ee7 d\u00e2y", tuoiKey: "dtTuoi", khoKey: "dtKho" },
]

async function loadPdfFontBase64() {
  if (!fontBase64Promise) {
    fontBase64Promise = fetch(`/fonts/${PDF_FONT_FILE}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Kh\u00f4ng t\u1ea3i \u0111\u01b0\u1ee3c font PDF: ${PDF_FONT_FILE}`)
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
  const desiredY = (pdf.lastAutoTable?.finalY || 0) + 16
  if (desiredY > pageH - 42) {
    doc.addPage()
  }
  const startY = desiredY > pageH - 42 ? 20 : desiredY

  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10)
  doc.text("Gi\u00e1m \u0111\u1ed1c nh\u00e0 m\u00e1y", 24, startY)
  doc.text("L\u1eadp b\u1ea3ng", pageW - 42, startY, { align: "center" })

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

function compareDateAsc(a: string, b: string) {
  return a.localeCompare(b)
}

function compareVehicleAsc(a?: string, b?: string) {
  const left = (a || "").trim()
  const right = (b || "").trim()
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return left.localeCompare(right, "vi", { numeric: true, sensitivity: "base" })
}

function buildDoiRows(trips: DispatchFlatTrip[]) {
  const grouped = new Map<string, MaterialAggregateRow>()
  for (const trip of trips) {
    const dois = trip.dois.length > 0 ? trip.dois : [0]
    const tripMaterials = getTripMaterials(trip)
    for (const doi of dois) {
      const doiLabel = doi ? `\u0110\u1ed9i ${doi}` : "Ch\u01b0a r\u00f5 \u0111\u1ed9i"
      const key = `${trip.ngay}__${doiLabel}`
      const current = grouped.get(key) || {
        ngay: trip.ngay,
        doi,
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
  return [...grouped.values()].sort((a, b) => {
    const dateCompare = compareDateAsc(a.ngay, b.ngay)
    if (dateCompare !== 0) return dateCompare
    return (a.doi || 0) - (b.doi || 0)
  })
}

function buildVehicleRows(trips: DispatchFlatTrip[]) {
  return trips
    .map((trip) => ({
      ngay: trip.ngay,
      trip,
      materials: getTripMaterials(trip),
    }))
    .sort((a, b) => {
      const dateCompare = compareDateAsc(a.ngay, b.ngay)
      if (dateCompare !== 0) return dateCompare
      const vehicleCompare = compareVehicleAsc(a.trip?.so_xe, b.trip?.so_xe)
      if (vehicleCompare !== 0) return vehicleCompare
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
  const dois = trip.dois.length ? trip.dois.map((doi) => `\u0110\u1ed9i ${doi}`).join(", ") : "-"

  return [
    ["M\u00e3 \u0110X", trip.maDx || "-", "Ng\u00e0y", formatDateVi(trip.ngay)],
    ["S\u1ed1 xe", trip.so_xe || "-", "T\u00e0i x\u1ebf", trip.tai_xe || "-"],
    ["Chuy\u1ebfn", String(trip.chuyen || 1), "\u0110\u1ed9i", dois],
    ["D\u00e2y chuy\u1ec1n", trip.dayChuyen || "-", "Ch\u1ee9ng nh\u1eadn", trip.chungNhan || "-"],
    ["\u0110i\u1ec3m giao nh\u1eadn", (trip.diem_gn || []).join(", ") || "-", "Phi\u00ean", (trip.phien || []).join(", ") || "-"],
    ["L\u1ed9 tr\u00ecnh", (trip.lo_trinh || []).join(" - ") || "-", "Km", `${formatKm(trip.totalKm)} km`],
    ["L\u00f4 thu ho\u1ea1ch", (trip.lo_thu_hoach || []).join(", ") || "-", "X\u1eed l\u00fd", trip.xu_ly || "-"],
  ]
}

function materialRows(trip: DispatchFlatTrip) {
  const { materials, totalTuoi, totalKho } = getTripTotals(trip)

  return [
    ["M\u1ee7 n\u01b0\u1edbc", formatKg(materials.mnTuoi), formatDrc(materials.mnKho, materials.mnTuoi), formatKg(materials.mnKho)],
    ["M\u1ee7 ch\u00e9n", formatKg(materials.ctTuoi), formatDrc(materials.ctKho, materials.ctTuoi), formatKg(materials.ctKho)],
    ["\u0110\u00f4ng ch\u00e9n", formatKg(materials.dctTuoi), formatDrc(materials.dctKho, materials.dctTuoi), formatKg(materials.dctKho)],
    ["\u0110\u00f4ng kh\u1ed1i", formatKg(materials.dktTuoi), formatDrc(materials.dktKho, materials.dktTuoi), formatKg(materials.dktKho)],
    ["M\u1ee7 d\u00e2y", formatKg(materials.dtTuoi), formatDrc(materials.dtKho, materials.dtTuoi), formatKg(materials.dtKho)],
    ["T\u1ed4NG", formatKg(totalTuoi), formatDrc(totalKho, totalTuoi), formatKg(totalKho)],
  ]
}

function buildDispatchEntrySummaryRows(trips: DispatchFlatTrip[], entry: DispatchAnalyticsEntry) {
  const vehicleCount = new Set(trips.map((trip) => trip.so_xe).filter(Boolean)).size
  const driverCount = new Set(trips.map((trip) => trip.tai_xe).filter(Boolean)).size
  const totalKm = trips.reduce((sum, trip) => sum + (trip.totalKm || 0), 0)
  const totalTuoi = trips.reduce((sum, trip) => sum + (trip.totalTuoi || 0), 0)
  const totalKho = trips.reduce((sum, trip) => sum + (trip.totalKho || 0), 0)

  return [
    ["Mã ĐX", entry.ma_dx || "-", "Số chuyến", String(trips.length)],
    ["Số xe", String(vehicleCount), "Tài xế", String(driverCount)],
    ["Tổng Km", formatKm(totalKm), "Tươi (kg)", formatKg(totalTuoi)],
    ["Chứng nhận", entry.chung_nhan || "-", "Khô (kg)", formatKg(totalKho)],
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
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 80], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
    body: buildDispatchEntrySummaryRows(params.trips, params.entry),
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 24 },
      1: { cellWidth: 48 },
      2: { fontStyle: "bold", cellWidth: 24 },
      3: { cellWidth: 48 },
    },
  })

  const pdf = doc as PdfWithTable
  autoTable(doc, {
    startY: (pdf.lastAutoTable?.finalY || 32) + 8,
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
  selectedNote?: string
}) {
  const range = `T\u1eeb ng\u00e0y ${params.from ? formatDateVi(params.from) : "t\u1ea5t c\u1ea3"} \u0111\u1ebfn ng\u00e0y ${params.to ? formatDateVi(params.to) : "t\u1ea5t c\u1ea3"}`
  const noteLabel = describeNoteFilter(params.selectedNote || "")
  const note = noteLabel ? `; ${noteLabel}` : ""
  if (params.mode === "doi" && params.selectedDoi) return `${range}; \u0111\u1ed9i ${params.selectedDoi}${note}`
  if (params.mode === "vehicle" && params.selectedVehicle) return `${range}; xe ${params.selectedVehicle}${note}`
  return `${range}; t\u1ea5t c\u1ea3 \u0111\u1ed9i xe${note}`
}

export async function downloadDispatchStatsPdf(params: {
  analytics: DispatchAnalytics
  factoryName: string
  from?: string
  to?: string
  mode: "all" | "doi" | "vehicle"
  selectedDoi?: string
  selectedVehicle?: string
  selectedNote?: string
  makerName?: string
}) {
  const isVehicleMode = params.mode === "vehicle"
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: isVehicleMode ? "a3" : "a4" })
  await ensurePdfFont(doc)
  renderHeader(doc, "TH\u1ed0NG K\u00ca \u0110I\u1ec0U XE", `Nh\u00e0 m\u00e1y: ${params.factoryName}; ${buildStatsContext(params)}`)

  const t = params.analytics.totals
  autoTable(doc, {
    startY: 32,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2, halign: "center" },
    headStyles: { fillColor: [15, 118, 80], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
    head: [["B\u1ea3ng \u0110X", "Chuy\u1ebfn", "Xe", "T\u00e0i x\u1ebf", "Km", "T\u01b0\u01a1i (t\u1ea5n)", "Kh\u00f4 (t\u1ea5n)"]],
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
    ? "Chi ti\u1ebft theo xe"
    : params.mode === "doi"
      ? "Chi ti\u1ebft theo \u0111\u1ed9i theo ng\u00e0y"
      : "T\u1ed5ng h\u1ee3p theo ng\u00e0y"
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(11)
  doc.text(heading, 14, (pdf.lastAutoTable?.finalY || 46) + 10)

  const startY = (pdf.lastAutoTable?.finalY || 46) + 14
  if (params.mode === "vehicle") {
    autoTable(doc, {
      startY,
      head: [[
        "Ng\u00e0y",
        "S\u1ed1 xe",
        "T\u00e0i x\u1ebf",
        "Chuy\u1ebfn",
        "Phi\u00ean",
        "\u0110i\u1ec3m giao nh\u1eadn",
        "L\u1ed9 tr\u00ecnh",
        "S\u1ed1 Km",
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
        "Ng\u00e0y",
        params.mode === "doi" ? "\u0110\u1ed9i" : "Nh\u00f3m",
        ...materialColumns,
      ]],
      body: (params.mode === "doi" ? doiRows : allRows).map((row) => [
        formatDateVi(row.ngay),
        params.mode === "doi" ? (row.doiLabel || "-") : "T\u1ed5ng ng\u00e0y",
        ...materialTripValues(row.materials, visibleMaterials),
      ]),
      theme: "grid",
      styles: { font: PDF_FONT_NAME, fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold" },
    })
  }

  renderSignatures(doc, params.makerName)
  footer(doc)
  const suffix = params.mode === "doi"
    ? `doi-${safeName(params.selectedDoi || "tat-ca")}`
    : params.mode === "vehicle"
      ? `xe-${safeName(params.selectedVehicle || "tat-ca")}`
      : "tong-hop"
  doc.save(`thong-ke-dieu-xe-${suffix}-${params.from || "all"}-${params.to || "all"}.pdf`)
}
