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
import { describeNoteFilterMulti } from "@/lib/note-filter"

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

// Các loại nguyên liệu của phiếu điều xe ngày — chỉ loại CÓ dữ liệu trong ngày mới thành cột.
const ENTRY_MATERIALS = [
  { key: "mn", label: "Nước" },
  { key: "ct", label: "Chén" },
  { key: "dct", label: "Đông chén" },
  { key: "dkt", label: "Đông khối" },
  { key: "dt", label: "Dây" },
] as const
type EntryMaterialKey = (typeof ENTRY_MATERIALS)[number]["key"]
type EntryMaterials = ReturnType<typeof getTripTotals>["materials"]

function materialValue(materials: EntryMaterials, key: EntryMaterialKey, kind: "Tuoi" | "Kho"): number {
  return Number((materials as unknown as Record<string, number>)[`${key}${kind}`] || 0)
}

/** Cắt chuỗi cho vừa tối đa `maxLines` dòng ở bề rộng `widthMm`, dòng cuối thêm "…" nếu bị cắt. */
function clampLines(doc: jsPDF, text: string, widthMm: number, maxLines: number): string {
  const lines = doc.splitTextToSize(text, widthMm) as string[]
  if (lines.length <= maxLines) return lines.join("\n")
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length > 1 && doc.getTextWidth(`${last}…`) > widthMm) last = last.slice(0, -1)
  kept[maxLines - 1] = `${last.trimEnd()}…`
  return kept.join("\n")
}

// Khối ký (nhãn + khung 18mm + tên) cần ~26mm tính từ startY, và không được chạm dòng
// "Trang i/N" ở chân trang (y = pageH - 8). Vượt ngưỡng này thì khối ký phải sang trang mới.
const ENTRY_SIGNATURE_GAP_MM = 7
const ENTRY_SIGNATURE_BOTTOM_RESERVE_MM = 37

// 3 mức mật độ bảng chuyến: thử từ thoáng → dày, chọn mức đầu tiên để khối ký nằm cùng trang
// với bảng (yêu cầu 2026-09-26: phiếu điều xe gọn trong 1 trang A4 ngang cả phần ký).
const ENTRY_DENSITY = [
  { fontSize: 7.5, padV: 1.1, padH: 1.3 },
  { fontSize: 7.0, padV: 0.7, padH: 1.1 },
  { fontSize: 6.4, padV: 0.45, padH: 0.9 },
] as const

async function buildDispatchEntryDoc(params: {
  entry: DispatchAnalyticsEntry
  trips: DispatchFlatTrip[]
  factoryName: string
}): Promise<jsPDF> {
  let doc: jsPDF | null = null
  for (let level = 0; level < ENTRY_DENSITY.length; level++) {
    doc = await buildDispatchEntryDocAtDensity(params, level)
    const pdf = doc as PdfWithTable
    const finalY = pdf.lastAutoTable?.finalY || 0
    const pageH = doc.internal.pageSize.getHeight()
    const fits = finalY + ENTRY_SIGNATURE_GAP_MM <= pageH - ENTRY_SIGNATURE_BOTTOM_RESERVE_MM
    // Bảng đã dài quá 1 trang thì co chữ cũng vô ích — giữ mức thoáng nhất cho dễ đọc.
    if (fits || doc.getNumberOfPages() > 1) {
      if (!fits && level > 0) doc = await buildDispatchEntryDocAtDensity(params, 0)
      return doc
    }
  }
  return doc as jsPDF
}

async function buildDispatchEntryDocAtDensity(params: {
  entry: DispatchAnalyticsEntry
  trips: DispatchFlatTrip[]
  factoryName: string
}, level: number): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  renderHeader(doc, `PHIẾU ĐIỀU XE NGÀY ${formatDateVi(params.entry.ngay)}`, `Mã ĐX: ${params.entry.ma_dx || "-"}; nhà máy: ${params.factoryName}; chứng nhận: ${params.entry.chung_nhan || "-"}`)

  const margin = 10
  const pageW = doc.internal.pageSize.getWidth()
  const usableW = pageW - margin * 2
  const trips = params.trips
  const tripMaterials = trips.map((trip) => getTripTotals(trip).materials)

  // Loại nguyên liệu có dữ liệu trong ngày (tươi hoặc khô > 0); loại nào cả ngày bằng 0 không hiện.
  const activeMaterials = ENTRY_MATERIALS.filter((m) =>
    tripMaterials.some((mat) => materialValue(mat, m.key, "Tuoi") > 0 || materialValue(mat, m.key, "Kho") > 0),
  )
  const sumOf = (key: EntryMaterialKey, kind: "Tuoi" | "Kho") =>
    tripMaterials.reduce((acc, mat) => acc + materialValue(mat, key, kind), 0)

  // ── Bảng thông tin: 2 dòng × 8 cột, trải hết bề ngang (trước đây 4 dòng × 4 cột chiếm chỗ).
  // Tươi/Khô ở đây chỉ ghi tổng — tách theo loại nằm ở dòng TỔNG của bảng chuyến bên dưới. ──
  const vehicleCount = new Set(trips.map((trip) => trip.so_xe).filter(Boolean)).size
  const driverCount = new Set(trips.map((trip) => trip.tai_xe).filter(Boolean)).size
  const totalKm = trips.reduce((sum, trip) => sum + (trip.totalKm || 0), 0)
  const totalTuoi = trips.reduce((sum, trip) => sum + (trip.totalTuoi || 0), 0)
  const totalKho = trips.reduce((sum, trip) => sum + (trip.totalKho || 0), 0)

  const labelW = 22
  const valueW = (usableW - labelW * 4) / 4
  const labelStyle = { fontStyle: "bold" as const, cellWidth: labelW, fillColor: [241, 245, 249] as [number, number, number] }
  autoTable(doc, {
    startY: 28,
    margin: { left: margin, right: margin },
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 8.5, cellPadding: 1.4 },
    body: [
      ["Mã ĐX", params.entry.ma_dx || "-", "Số chuyến", String(trips.length), "Số xe", String(vehicleCount), "Tài xế", String(driverCount)],
      ["Chứng nhận", params.entry.chung_nhan || "-", "Tổng Km", formatKm(totalKm), "Tươi (kg)", formatKg(totalTuoi), "Khô (kg)", formatKg(totalKho)],
    ],
    columnStyles: {
      0: labelStyle,
      1: { cellWidth: valueW },
      2: labelStyle,
      3: { cellWidth: valueW },
      4: labelStyle,
      5: { cellWidth: valueW },
      6: labelStyle,
      7: { cellWidth: valueW },
    },
  })

  // ── Bảng chuyến ──
  const density = ENTRY_DENSITY[level]
  const fontSize = density.fontSize
  const cellPadding = { top: density.padV, bottom: density.padV, left: density.padH, right: density.padH }
  const nMat = activeMaterials.length

  // Tài xế / Đội / Điểm GN / Phiên đủ rộng để 1 dòng; Lô thu hoạch lấy phần còn lại, tối đa 2
  // dòng. Cột "Xử lý" đã bỏ theo yêu cầu (2026-09-26).
  const fixed = { xe: 12, chuyen: 14, taiXe: 32, doi: 22, diemGn: 30, phien: 26, km: 12 }
  const fixedSum = Object.values(fixed).reduce((a, b) => a + b, 0)
  const matW = nMat ? Math.max(12, Math.min(18, (usableW - fixedSum - 36) / (nMat * 2))) : 0
  const loW = Math.max(20, usableW - fixedSum - matW * nMat * 2)

  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(fontSize)
  const loTextW = loW - density.padH * 2 - 0.5

  const infoHead = ["Xe", "Chuyến", "Tài xế", "Đội", "Điểm GN", "Phiên", "Lô thu hoạch", "Km"]
  const head = nMat
    ? [
        [
          ...infoHead.map((content) => ({ content, rowSpan: 2, styles: { valign: "middle" as const } })),
          { content: "Tươi (kg)", colSpan: nMat, styles: { halign: "center" as const } },
          { content: "Khô (kg)", colSpan: nMat, styles: { halign: "center" as const } },
        ],
        [...activeMaterials.map((m) => m.label), ...activeMaterials.map((m) => m.label)],
      ]
    : [infoHead]

  const body: string[][] = trips.map((trip, idx) => [
    trip.so_xe || "-",
    String(trip.chuyen || 1),
    trip.tai_xe || "-",
    trip.dois.length ? trip.dois.map((doi) => `Đội ${doi}`).join(", ") : "-",
    (trip.diem_gn || []).join(", ") || "-",
    (trip.phien || []).join(", ") || "-",
    clampLines(doc, (trip.lo_thu_hoach || []).join(", ") || "-", loTextW, 2),
    formatKm(trip.totalKm),
    ...activeMaterials.map((m) => formatKg(materialValue(tripMaterials[idx], m.key, "Tuoi"))),
    ...activeMaterials.map((m) => formatKg(materialValue(tripMaterials[idx], m.key, "Kho"))),
  ])
  const totalRow = [
    "TỔNG", "", "", "", "", "", "",
    formatKm(totalKm),
    ...activeMaterials.map((m) => formatKg(sumOf(m.key, "Tuoi"))),
    ...activeMaterials.map((m) => formatKg(sumOf(m.key, "Kho"))),
  ]

  const columnStyles: Record<number, Record<string, unknown>> = {
    0: { cellWidth: fixed.xe, overflow: "ellipsize" },
    1: { cellWidth: fixed.chuyen, halign: "center" },
    2: { cellWidth: fixed.taiXe, overflow: "ellipsize" },
    3: { cellWidth: fixed.doi, overflow: "ellipsize" },
    4: { cellWidth: fixed.diemGn, overflow: "ellipsize" },
    5: { cellWidth: fixed.phien, overflow: "ellipsize" },
    6: { cellWidth: loW },
    7: { cellWidth: fixed.km, halign: "right" },
  }
  for (let i = 0; i < nMat * 2; i++) columnStyles[8 + i] = { cellWidth: matW, halign: "right" }

  const pdf = doc as PdfWithTable
  autoTable(doc, {
    startY: (pdf.lastAutoTable?.finalY || 28) + 5,
    margin: { left: margin, right: margin },
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize, cellPadding },
    headStyles: { fillColor: [15, 118, 80], textColor: 255, font: PDF_FONT_NAME, fontStyle: "bold", halign: "center" },
    head,
    body: [...body, totalRow],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    columnStyles: columnStyles as any,
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === body.length) {
        data.cell.styles.fontStyle = "bold"
        data.cell.styles.fillColor = [236, 253, 245]
      }
    },
  })

  return doc
}

export type DispatchSignatureBoxMm = { x: number; y: number; w: number; h: number }
export type DispatchSignerBoxes = { chuKyBox: DispatchSignatureBoxMm; tenBox: DispatchSignatureBoxMm }
export type DispatchEntrySigningInfo = {
  pageNumber: number
  pageHeightMm: number
  lapBang: DispatchSignerBoxes
  giamDoc: DispatchSignerBoxes
}

/**
 * Mirror `renderSignatures()` ở trên (vẫn dùng nguyên, không đổi, cho Trip PDF/Stats PDF)
 * nhưng thêm tính toán tọa độ khung ký (mm, gốc trên-trái) cho "Lập bảng"/"Giám đốc nhà
 * máy" — dùng riêng cho Phiếu điều xe ngày, tài liệu duy nhất của module này được gắn ký
 * số dùng chung (Giai đoạn 4). Khi có `makerName` (luồng "Xuất PDF ngày" cũ), vẽ giống hệt
 * `renderSignatures` — không đổi hình ảnh PDF tải về. Khi gọi không có `makerName` (luồng
 * ký số), không in sẵn tên để tránh chữ đè lên đúng chỗ hệ thống ký sẽ stamp tên thật.
 */
function renderEntrySignatures(doc: jsPDF, makerName?: string): DispatchEntrySigningInfo {
  const pdf = doc as PdfWithTable
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  // Khối ký cần ~30mm (nhãn + khung 18mm + tên + chân trang). Gọn hơn trước (16/42) để phần ký
  // nằm cùng trang với bảng chuyến trên A4 ngang (yêu cầu 2026-09-26).
  const desiredY = (pdf.lastAutoTable?.finalY || 0) + ENTRY_SIGNATURE_GAP_MM
  const overflow = desiredY > pageH - ENTRY_SIGNATURE_BOTTOM_RESERVE_MM
  if (overflow) {
    doc.addPage()
  }
  const startY = overflow ? 20 : desiredY

  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10)
  doc.text("Giám đốc nhà máy", 24, startY)
  doc.text("Lập bảng", pageW - 42, startY, { align: "center" })

  if (makerName) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(9)
    doc.text(makerName, pageW - 42, startY + 26, { align: "center" })
  }

  const colX = pageW - 42
  return {
    pageNumber: doc.getCurrentPageInfo().pageNumber,
    pageHeightMm: pageH,
    giamDoc: {
      chuKyBox: { x: 20, y: startY + 2, w: 50, h: 18 },
      tenBox: { x: 15, y: startY + 21, w: 60, h: 5 },
    },
    lapBang: {
      chuKyBox: { x: colX - 25, y: startY + 2, w: 50, h: 18 },
      tenBox: { x: colX - 25, y: startY + 21, w: 50, h: 5 },
    },
  }
}

export async function downloadDispatchEntryPdf(params: {
  entry: DispatchAnalyticsEntry
  trips: DispatchFlatTrip[]
  factoryName: string
  makerName?: string
}) {
  const doc = await buildDispatchEntryDoc(params)
  renderEntrySignatures(doc, params.makerName)
  footer(doc)
  doc.save(`phieu-dieu-xe-ngay-${safeName(params.entry.ngay)}.pdf`)
}

/**
 * Dựng PDF trả về bytes + toạ độ khung ký (mm, gốc trên-trái) — dùng cho nút "Ký duyệt"
 * (khác "Xuất PDF ngày" — không tự tải file, để caller upload lên hệ thống ký số dùng
 * chung rồi điều hướng sang /dashboard/ky/[id]).
 */
export async function buildDispatchEntryPdfForSigning(params: {
  entry: DispatchAnalyticsEntry
  trips: DispatchFlatTrip[]
  factoryName: string
}): Promise<{ bytes: Uint8Array; page: DispatchEntrySigningInfo }> {
  const doc = await buildDispatchEntryDoc(params)
  const page = renderEntrySignatures(doc)
  footer(doc)
  const bytes = doc.output("arraybuffer") as ArrayBuffer
  return { bytes: new Uint8Array(bytes), page }
}

function buildStatsContext(params: {
  from?: string
  to?: string
  mode: "all" | "doi" | "vehicle"
  selectedDois?: string[]
  selectedVehicles?: string[]
  selectedNote?: string[]
}) {
  const range = `T\u1eeb ng\u00e0y ${params.from ? formatDateVi(params.from) : "t\u1ea5t c\u1ea3"} \u0111\u1ebfn ng\u00e0y ${params.to ? formatDateVi(params.to) : "t\u1ea5t c\u1ea3"}`
  const noteLabel = describeNoteFilterMulti(params.selectedNote || [])
  const note = noteLabel ? `; ${noteLabel}` : ""
  const dois = params.selectedDois || []
  const vehicles = params.selectedVehicles || []
  if (params.mode === "doi" && dois.length > 0) return `${range}; \u0111\u1ed9i ${dois.join(", ")}${note}`
  if (params.mode === "vehicle" && vehicles.length > 0) return `${range}; xe ${vehicles.join(", ")}${note}`
  return `${range}; t\u1ea5t c\u1ea3 \u0111\u1ed9i xe${note}`
}

export async function downloadDispatchStatsPdf(params: {
  analytics: DispatchAnalytics
  factoryName: string
  from?: string
  to?: string
  mode: "all" | "doi" | "vehicle"
  selectedDois?: string[]
  selectedVehicles?: string[]
  selectedNote?: string[]
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
    ? `doi-${(params.selectedDois || []).length > 0 ? params.selectedDois!.map(safeName).join("-") : "tat-ca"}`
    : params.mode === "vehicle"
      ? `xe-${(params.selectedVehicles || []).length > 0 ? params.selectedVehicles!.map(safeName).join("-") : "tat-ca"}`
      : "tong-hop"
  doc.save(`thong-ke-dieu-xe-${suffix}-${params.from || "all"}-${params.to || "all"}.pdf`)
}
