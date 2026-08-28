import jsPDF from "jspdf"
import autoTable, { type CellHookData, type CellDef } from "jspdf-autotable"
import { ensurePdfFont, safeName, PDF_FONT_NAME } from "@/lib/pdf-qr-shared"
import { getDateParts, formatDateDisplay } from "@/lib/date-utils"

export type QualityKqknResult = {
  id: string
  ma_lo: string
  pkn: number
  lo_kn: number
  batch_id?: string | null
  ngay_kn: string
  ngay_sx: string
  loai_csr: string
  samples: Record<string, (string | number)[]>
  grade: Record<string, { dat: boolean; tb?: number; detail?: string }>
  dat_hang: string
}

type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } }

const GREEN: [number, number, number] = [6, 95, 70]
const RED: [number, number, number] = [220, 38, 38]
const GRAY: [number, number, number] = [148, 163, 184]
const INK: [number, number, number] = [30, 41, 59]

function normalizeLotCode(maLo: string): string {
  return String(maLo || "").trim().toLowerCase().replace(/\s+/g, "").replace(/\\/g, "/")
}

function stripYear(maLo: string): string {
  return normalizeLotCode(maLo).replace(/\/\d{2,4}$/, "")
}

function formatPKN(pkn: number, ngayKN: string, fCode: string): string {
  const parts = getDateParts(ngayKN)
  if (!parts) return `PKN-${fCode}-000000/${pkn}`
  const yy = parts.year.slice(2)
  return `PKN-${fCode}-${parts.day}${parts.month}${yy}/${pkn}`
}

const nums = (arr: (string | number)[] | undefined) =>
  (arr || []).map(Number).filter((v) => !isNaN(v) && v > 0)
const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
const sd3 = (a: number[]) => {
  if (!a.length) return null
  const m = avg(a)!
  return 3 * Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
}
const mx = (a: number[]) => (a.length ? Math.max(...a) : null)
const mn = (a: number[]) => (a.length ? Math.min(...a) : null)
const fmt = (v: number | null, d = 3) => (v === null ? "—" : v.toFixed(d))

// X̄ (ký tự "X" + dấu gạch ngang kết hợp) bị bỏ, dùng "TB" (Trung bình) — jsPDF không có bộ
// máy shaping chữ (không như trình duyệt), ký tự kết hợp Unicode (combining mark) render qua
// font nhúng có rủi ro không xếp chồng đúng lên ký tự gốc. "TB" an toàn tuyệt đối, giữ đúng
// nghĩa "trung bình" — đã xác nhận với người dùng không cần khớp pixel-perfect với bản HTML cũ.
const statA = (vals: (string | number)[] | undefined): [string, string, string] => {
  const a = nums(vals)
  if (!a.length) return ["—", "—", "—"]
  const m = avg(a)!, s3 = sd3(a)!
  return [fmt(m), fmt(s3), fmt(m + s3)]
}
const statBH = (vals: (string | number)[] | undefined): [string, string] => {
  const a = nums(vals)
  if (!a.length) return ["—", "—"]
  return [fmt(avg(a)!), fmt(mx(a)!)]
}
const statNi = (vals: (string | number)[] | undefined): [string, string, string] => {
  const a = nums(vals)
  if (!a.length) return ["—", "—", "—"]
  return [fmt(avg(a)!), fmt(mn(a)!), fmt(mx(a)!)]
}
const statC = (vals: (string | number)[] | undefined): [string, string, string] => {
  const a = nums(vals)
  if (!a.length) return ["—", "—", "—"]
  return [fmt(avg(a)!, 1), fmt(mn(a)!, 1), fmt(mx(a)!, 1)]
}
const statD = (vals: (string | number)[] | undefined): [string, string, string] => {
  const a = nums(vals)
  if (!a.length) return ["—", "—", "—"]
  return [fmt(avg(a), 1), fmt(mn(a), 1), fmt(mx(a), 1)]
}

type RowStyle = { color: [number, number, number]; bold?: boolean }

// Header 2 tầng: tầng 1 gộp cột theo nhóm chỉ tiêu (colSpan), 3 cột đầu + cột cuối rowSpan
// xuyên cả 2 tầng — mirror đúng cấu trúc bảng gốc trong buildBatchPage() (quality/page.tsx).
const HEAD_ROW_1: CellDef[] = [
  { content: "Lô PKN", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
  { content: "Lô NM", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
  { content: "Hạng ĐK", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
  { content: "Tạp chất", colSpan: 3, styles: { halign: "center" } },
  { content: "Tro", colSpan: 3, styles: { halign: "center" } },
  { content: "Bay hơi", colSpan: 2, styles: { halign: "center" } },
  { content: "Nitơ", colSpan: 3, styles: { halign: "center" } },
  { content: "Po", colSpan: 3, styles: { halign: "center" } },
  { content: "PRI", colSpan: 3, styles: { halign: "center" } },
  { content: "Màu", colSpan: 3, styles: { halign: "center" } },
  { content: "ML(1'+4')100°C", colSpan: 3, styles: { halign: "center" } },
  { content: "Đạt hạng", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
]
const HEAD_ROW_2 = [
  "TB", "3SD", "TB+3SD", // Tạp chất
  "TB", "3SD", "TB+3SD", // Tro
  "TB", "Max", // Bay hơi
  "TB", "Min", "Max", // Nitơ
  "TB", "Min", "Max", // Po
  "TB", "Min", "Max", // PRI
  "TB", "Min", "Max", // Màu
  "TB", "Min", "Max", // ML
]

function renderBatchPage(doc: jsPDF, batchResults: QualityKqknResult[], fCode: string) {
  const sorted = [...batchResults].sort((a, b) => (a.lo_kn || 0) - (b.lo_kn || 0))
  const r0 = sorted[0]
  const pknCode = formatPKN(r0.pkn, r0.ngay_kn, fCode)
  const ngaySXStr = formatDateDisplay(r0.ngay_sx) || r0.ngay_sx || "--"
  const ngayKnParts = getDateParts(r0.ngay_kn)

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 8

  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(12)
  doc.setTextColor(...INK)
  doc.text("BẢNG KẾT QUẢ KIỂM NGHIỆM CAO SU CSR", pageW / 2, 12, { align: "center" })

  doc.setFontSize(8)
  doc.text(`Mã phiếu: ${pknCode}`, margin, 19)
  doc.text(`Ngày sản xuất: ${ngaySXStr}`, pageW / 2, 19, { align: "center" })
  doc.text(`Nhà máy: ${fCode}`, pageW - margin, 19, { align: "right" })

  const body: string[][] = []
  const rowStyles: Record<number, RowStyle>[] = []

  sorted.forEach((r) => {
    const s = r.samples || {}
    const g = r.grade || {}
    const resOk = !r.dat_hang?.endsWith("RH")
    const resColor: [number, number, number] = resOk ? GREEN : RED

    const [tc1, tc2, tc3] = statA(s.tap_chat)
    const [tr1, tr2, tr3] = statA(s.tro)
    const [bh1, bh2] = statBH(s.bay_hoi)
    const [ni1, ni2, ni3] = statNi(s.nito)
    const [po1, po2, po3] = statC(s.po)
    const [pr1, pr2, pr3] = statC(s.pri)
    const [ma1, ma2, ma3] = statNi(s.mau_sac)
    const [ml1, ml2, ml3] = statD(s.mooney)

    body.push([
      String(r.lo_kn || "—"),
      stripYear(r.ma_lo),
      r.loai_csr,
      tc1, tc2, tc3,
      tr1, tr2, tr3,
      bh1, bh2,
      ni1, ni2, ni3,
      po1, po2, po3,
      pr1, pr2, pr3,
      ma1, ma2, ma3,
      ml1, ml2, ml3,
      r.dat_hang,
    ])

    const styleFor = (ok: boolean | undefined): RowStyle =>
      ok === undefined ? { color: GRAY } : ok ? { color: GREEN } : { color: RED, bold: true }

    rowStyles.push({
      3: styleFor(g.tap_chat?.dat), 4: { color: GRAY }, 5: styleFor(g.tap_chat?.dat),
      6: styleFor(g.tro?.dat), 7: { color: GRAY }, 8: styleFor(g.tro?.dat),
      9: styleFor(g.bay_hoi?.dat), 10: styleFor(g.bay_hoi?.dat),
      11: styleFor(g.nito?.dat), 12: { color: GRAY }, 13: styleFor(g.nito?.dat),
      14: styleFor(g.po?.dat), 15: { color: GRAY }, 16: styleFor(g.po?.dat),
      17: styleFor(g.pri?.dat), 18: { color: GRAY }, 19: styleFor(g.pri?.dat),
      26: { color: resColor, bold: true },
    })
  })

  autoTable(doc, {
    startY: 23,
    theme: "grid",
    styles: {
      font: PDF_FONT_NAME, fontSize: 6, cellPadding: 0.8,
      halign: "center", valign: "middle", textColor: INK,
      lineColor: [203, 213, 225], lineWidth: 0.1,
    },
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold", fontSize: 6 },
    margin: { left: margin, right: margin },
    head: [HEAD_ROW_1, HEAD_ROW_2],
    body,
    didParseCell: (data: CellHookData) => {
      if (data.section !== "body") return
      const style = rowStyles[data.row.index]?.[data.column.index]
      if (!style) return
      data.cell.styles.textColor = style.color
      if (style.bold) data.cell.styles.fontStyle = "bold"
    },
  })

  const finalY = (doc as PdfWithTable).lastAutoTable?.finalY || 23
  let y = finalY + 6
  if (y > pageH - 40) {
    doc.addPage()
    y = 18
  }

  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(8)
  doc.setTextColor(...INK)
  doc.text(`Tổng số lô kiểm nghiệm: ${sorted.length}`, margin, y)

  doc.setFont(PDF_FONT_NAME, "normal")
  const ngayInStr = ngayKnParts
    ? `Kampong Thom, ngày ${ngayKnParts.dayNumber} tháng ${ngayKnParts.monthNumber} năm ${ngayKnParts.yearNumber}`
    : "Kampong Thom, ......."
  doc.text(ngayInStr, pageW - margin, y, { align: "right" })

  const contentW = pageW - margin * 2
  const col1X = margin + contentW * 0.25
  const col2X = margin + contentW * 0.75

  y += 14
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.text("LẬP BIỂU", col1X, y, { align: "center" })
  doc.text("TRƯỞNG PHÒNG QLCL", col2X, y, { align: "center" })

  y += 14
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.text("________________________", col1X, y, { align: "center" })
  doc.text("________________________", col2X, y, { align: "center" })

  y += 6
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text("QLCL-QT21-F08 (01-10/01/2025)", margin, y)
  doc.setTextColor(...INK)
}

export async function downloadQualityKqknPdf(dateResults: QualityKqknResult[], date: string, fCode: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const batchMap = new Map<string, QualityKqknResult[]>()
  dateResults.forEach((r) => {
    const key = r.batch_id || String(r.pkn)
    if (!batchMap.has(key)) batchMap.set(key, [])
    batchMap.get(key)!.push(r)
  })
  const batches = Array.from(batchMap.values()).sort((a, b) => (a[0].pkn || 0) - (b[0].pkn || 0))

  batches.forEach((batch, i) => {
    if (i > 0) doc.addPage()
    renderBatchPage(doc, batch, fCode)
  })

  const pageCount = doc.getNumberOfPages()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.text(`Trang ${p}/${pageCount}`, pageW - 8, pageH - 5, { align: "right" })
  }

  doc.save(`phieu-kqkn-${safeName(date)}.pdf`)
}
