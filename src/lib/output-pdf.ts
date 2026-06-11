import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import type { ProductionRecord } from "@/app/dashboard/output/_components/output-types"

const PDF_FONT_FILE = "NotoSans-Regular.ttf"
const PDF_FONT_NAME = "NotoSans"
const ORG_LINE_1 = "Nhà máy chế biến"
const ORG_LINE_2 = "Báo cáo sản lượng"

type PdfWithTable = jsPDF & {
  lastAutoTable?: {
    finalY: number
  }
}

let fontBase64Promise: Promise<string> | null = null

const MATERIAL_COLUMNS = [
  { label: "Mủ nước", tuoiKey: "mn_tuoi", khoKey: "mn_kho" },
  { label: "Mủ chén", tuoiKey: "ct_tuoi", khoKey: "ct_kho" },
  { label: "Mủ đông chén", tuoiKey: "dct_tuoi", khoKey: "dct_kho" },
  { label: "Mủ đông khối", tuoiKey: "dkt_tuoi", khoKey: "dkt_kho" },
  { label: "Mủ dây", tuoiKey: "dt_tuoi", khoKey: "dt_kho" },
] as const satisfies ReadonlyArray<{
  label: string
  tuoiKey: keyof ProductionRecord
  khoKey: keyof ProductionRecord
}>

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

function fmtDate(iso: string) {
  if (!iso) return ""
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function fmtNum(n: number, decimals = 0) {
  return n.toLocaleString("vi-VN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function totalFresh(record: ProductionRecord) {
  return (
    Number(record.mn_tuoi ?? 0) +
    Number(record.ct_tuoi ?? 0) +
    Number(record.dct_tuoi ?? 0) +
    Number(record.dkt_tuoi ?? 0) +
    Number(record.dt_tuoi ?? 0)
  )
}

function totalDry(record: ProductionRecord) {
  return (
    Number(record.mn_kho ?? 0) +
    Number(record.ct_kho ?? 0) +
    Number(record.dct_kho ?? 0) +
    Number(record.dkt_kho ?? 0) +
    Number(record.dt_kho ?? 0)
  )
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

export async function downloadOutputDayPdf(params: {
  ngay: string
  records: ProductionRecord[]
  makerName?: string | null
}) {
  const { ngay, records, makerName } = params
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const totalTuoi = records.reduce((sum, record) => sum + totalFresh(record), 0)
  const totalKho = records.reduce((sum, record) => sum + totalDry(record), 0)
  const doiSet = [...new Set(records.map((record) => record.doi))].sort((a, b) => a - b)
  const warnings = records.reduce((sum, record) => sum + record.warn_codes.length, 0)

  renderHeader(
    doc,
    "Báo cáo sản lượng theo ngày",
    `${fmtDate(ngay)} · ${records.length} dòng · Đội ${doiSet.join(", ") || "-"} · KL tươi ${fmtNum(totalTuoi)} kg · KL khô ${fmtNum(totalKho)} kg`,
  )

  autoTable(doc, {
    startY: 30,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2.2, textColor: [30, 41, 59] },
    headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: "bold" },
    body: [
      ["Ngày", fmtDate(ngay), "Số dòng", String(records.length), "Cảnh báo", String(warnings)],
      ["Tổng KL tươi", `${fmtNum(totalTuoi)} kg`, "Tổng KL khô", `${fmtNum(totalKho)} kg`, "Người lập", makerName || "-"],
    ],
  })

  const materialHead = MATERIAL_COLUMNS.flatMap((material) => [`${material.label} tươi`, `${material.label} khô`])

  autoTable(doc, {
    startY: ((doc as PdfWithTable).lastAutoTable?.finalY || 45) + 8,
    theme: "striped",
    styles: { font: PDF_FONT_NAME, fontSize: 7.6, cellPadding: 1.8, valign: "middle" },
    headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: "bold" },
    bodyStyles: { textColor: [30, 41, 59] },
    head: [[
      "Xe",
      "Chuyến",
      "Đội",
      "Tài xế",
      ...materialHead,
      "Tổng tươi",
      "Tổng khô",
      "Ghi chú",
      "Cảnh báo",
    ]],
    body: records.map((record) => [
      record.so_xe || "-",
      String(record.chuyen || 1),
      String(record.doi || "-"),
      record.tai_xe || "-",
      ...MATERIAL_COLUMNS.flatMap((material) => [
        fmtNum(Number(record[material.tuoiKey] ?? 0)),
        fmtNum(Number(record[material.khoKey] ?? 0)),
      ]),
      fmtNum(totalFresh(record)),
      fmtNum(totalDry(record)),
      record.ghi_chu || "-",
      record.warn_codes.join(", ") || "-",
    ]),
  })

  renderFooter(doc)
  doc.save(`san-luong-${safeName(ngay)}.pdf`)
}
