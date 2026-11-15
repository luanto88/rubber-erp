// Kho vật tư — Excel báo cáo sử dụng theo ngày, bám mẫu giấy (đầu trang, tiêu đề, cột, viền, dòng Tổng / Tổng cộng, khổ
// A4 ngang). exceljs nạp ĐỘNG (chỉ khi bấm "Tải Excel"). Cùng nguồn snapshot với PDF. Rule 13.

import { COMPANY_HEADING_LINE_1, COMPANY_HEADING_LINE_2, COMPANY_HEADING_LINE_3 } from "@/lib/pdf-company-heading"
import type { DailyReportConfig, DailyReportSnapshot } from "./types"
import { fmtDayShort, maMauOf, periodLabel } from "./types"

export async function buildDailyReportXlsx(input: {
  templateName: string
  config: DailyReportConfig
  snapshot: DailyReportSnapshot
  maBaoCao: string | null
  phongBan: string
  loaiKyHieu: string
  nguoiLapChucVu?: string | null
}): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  const snap = input.snapshot
  const cfg = input.config || {}
  const n = snap.columns.length
  const lastCol = Math.max(n + 1, 6)
  const ws = wb.addWorksheet("Báo cáo", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  })
  const font = { name: "Times New Roman", size: 11 }
  const bold = { ...font, bold: true }
  const center: { horizontal: "center" | "right" | "left"; vertical: "middle"; wrapText: boolean } = { horizontal: "center", vertical: "middle", wrapText: true }
  const thin = { style: "thin" as const, color: { argb: "FF64748B" } }
  const border = { top: thin, left: thin, bottom: thin, right: thin }
  const half = Math.max(2, Math.floor(lastCol / 2))

  type Font = { name: string; size: number; bold?: boolean; italic?: boolean }
  type Align = { horizontal: "center" | "right" | "left"; vertical: "middle"; wrapText: boolean }
  const put = (row: number, c1: number, c2: number, text: string, f: Font = font, align: Align = center) => {
    if (c2 > c1) ws.mergeCells(row, c1, row, c2)
    const cell = ws.getCell(row, c1)
    cell.value = text
    cell.font = f
    cell.alignment = align
  }
  put(1, 1, half, COMPANY_HEADING_LINE_1)
  put(2, 1, half, COMPANY_HEADING_LINE_2)
  put(3, 1, half, COMPANY_HEADING_LINE_3, bold)
  put(1, half + 1, lastCol, "VƯƠNG QUỐC CAMPUCHIA", bold)
  put(2, half + 1, lastCol, "Dân tộc - Tôn giáo - Quốc vương", bold)
  const maMau = maMauOf(snap.kieu, cfg)
  if (maMau) put(3, half + 1, lastCol, maMau,{ ...font, size: 9 }, { horizontal: "right" as const, vertical: "middle" as const, wrapText: false })
  const [y, m, d] = snap.to.split("-")
  put(4, 1, half, input.maBaoCao ? `Số: ${input.maBaoCao}` : `Số:      /${input.loaiKyHieu}-${input.phongBan}`)
  put(4, half + 1, lastCol, `Kampong Thom, ngày ${d} tháng ${m} năm ${y}`, { ...font, italic: true })
  put(6, 1, lastCol, (cfg.tieuDe || input.templateName || "BÁO CÁO").toUpperCase(), { ...bold, size: 13 })
  put(7, 1, lastCol, periodLabel(snap.from, snap.to), bold)

  let r = 9
  const headRow = ws.getRow(r)
  headRow.values = ["Ngày", ...snap.columns.map((c) => (c.subLabel ? `${c.label}\n${c.subLabel}` : c.label))]
  headRow.height = 34
  headRow.eachCell((cell) => {
    cell.font = bold
    cell.alignment = center
    cell.border = border
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }
  })
  r++
  const numFmt = "#,##0.###;-#,##0.###;0"
  snap.days.forEach((day, i) => {
    const row = ws.getRow(r++)
    row.values = [fmtDayShort(day), ...snap.values[i]]
    row.eachCell((cell, c) => {
      cell.font = font
      cell.border = border
      cell.alignment = c === 1 ? center : { horizontal: "right", vertical: "middle" }
      if (c > 1) cell.numFmt = numFmt
    })
  })
  const totalRow = ws.getRow(r++)
  totalRow.values = ["Tổng", ...snap.columns.map((c) => c.total)]
  totalRow.eachCell((cell, c) => {
    cell.font = bold
    cell.border = border
    cell.alignment = c === 1 ? center : { horizontal: "right", vertical: "middle" }
    if (c > 1) cell.numFmt = numFmt
  })
  if (snap.kieu === "dau_12b" && n > 0) {
    ws.getCell(r, 1).value = "Tổng cộng"
    ws.mergeCells(r, 2, r, n + 1)
    ws.getCell(r, 2).value = snap.grandTotal
    ws.getCell(r, 2).numFmt = numFmt
    for (let c = 1; c <= n + 1; c++) {
      const cell = ws.getCell(r, c)
      cell.font = bold
      cell.border = border
      cell.alignment = center
    }
    r++
  }
  r++
  put(r, 1, half, "GIÁM ĐỐC NHÀ MÁY", bold)
  put(r, half + 1, lastCol, (cfg.nhanLap || "LẬP BẢNG").toUpperCase(), bold)
  const sub = input.nguoiLapChucVu || cfg.chucVuLap
  if (sub) put(r + 1, half + 1, lastCol, sub, { ...font, italic: true })

  ws.getColumn(1).width = 11
  for (let c = 2; c <= n + 1; c++) ws.getColumn(c).width = n > 12 ? 9 : 12
  ws.views = [{ state: "frozen", ySplit: 9, xSplit: 1 }]
  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}
