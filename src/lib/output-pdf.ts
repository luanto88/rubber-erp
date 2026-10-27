import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { OUTPUT_MATERIALS, type ProductionRecord } from "@/app/dashboard/output/_components/output-types"
import { PDF_FONT_NAME, addQrImage, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared"

const ORG_LINE_1 = "Nhà máy chế biến"
const ORG_LINE_2 = "Báo cáo sản lượng"
const QR_SIZE = 18
const QR_MARGIN = 12

type PdfWithTable = jsPDF & {
  lastAutoTable?: {
    finalY: number
  }
}

const MATERIAL_COLUMNS = OUTPUT_MATERIALS

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

export type OutputDayPdfParams = {
  ngay: string
  records: ProductionRecord[]
  makerName?: string | null
  /** URL trang chi tiết ngày — in QR góc phải trên trang đầu (rule 29 D2). */
  qrUrl?: string | null
}

async function buildOutputDayDoc(params: OutputDayPdfParams) {
  const { ngay, records, makerName, qrUrl } = params
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const totalTuoi = records.reduce((sum, record) => sum + totalFresh(record), 0)
  const totalKho = records.reduce((sum, record) => sum + totalDry(record), 0)
  const doiSet = [
    ...new Set(
      records
        .map((record) => record.doi)
        .filter((d): d is number => typeof d === "number"),
    ),
  ].sort((a, b) => a - b)
  const warnings = records.reduce((sum, record) => sum + record.warn_codes.length, 0)

  renderHeader(
    doc,
    "Báo cáo sản lượng theo ngày",
    `${fmtDate(ngay)} · ${records.length} dòng · Đội ${doiSet.join(", ") || "-"} · KL tươi ${fmtNum(totalTuoi)} kg · KL khô ${fmtNum(totalKho)} kg`,
  )
  if (qrUrl) {
    const pageW = doc.internal.pageSize.getWidth()
    await addQrImage(doc, qrUrl, pageW - QR_MARGIN - QR_SIZE, 5, QR_SIZE)
  }

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
      record.doi ? `Đội ${record.doi}` : (record.ma_nguon === "m" || record.doi === 0 ? "Thu mua" : (record.ma_nguon?.toUpperCase() || "-")),
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
  return doc
}

export async function buildOutputDayPdfBytes(params: OutputDayPdfParams): Promise<Uint8Array> {
  const doc = await buildOutputDayDoc(params)
  return new Uint8Array(doc.output("arraybuffer"))
}

export async function downloadOutputDayPdf(params: OutputDayPdfParams) {
  const doc = await buildOutputDayDoc(params)
  doc.save(`san-luong-${safeName(params.ngay)}.pdf`)
}
