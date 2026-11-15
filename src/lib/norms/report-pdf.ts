// Định mức KTKT GĐ4 — dựng PDF báo cáo kỳ Mẫu 8A / Mẫu 09 (A4 dọc, jsPDF, font NotoSans regular — "bold" chỉ là cùng file).
// QR GÓC PHẢI TRÊN trỏ trang chi tiết báo cáo. Khối ký 2 cột "GIÁM ĐỐC NHÀ MÁY" | "LẬP BIỂU" — tên người
// ký KHÔNG in sẵn (lõi ký đóng dấu chữ ký + tên đúng ô). Không dùng ký tự ✓ ⚠. Rule 30.

import jsPDF from "jspdf"
import autoTable, { type CellHookData, type RowInput } from "jspdf-autotable"
import { addQrImage, ensurePdfFont, PDF_FONT_NAME } from "@/lib/pdf-qr-shared"
import { addDaysISO } from "@/lib/date-utils"
import { COMPANY_HEADING_LINE_1, COMPANY_HEADING_LINE_2, COMPANY_HEADING_LINE_3 } from "@/lib/pdf-company-heading"
import type { NormReportKieu, NormReportSignRole, NormReportSnapshot, SnapLine, SnapOutside, Thang8aConfig } from "./report-types"
import { TP_NGUON_KEYS, TP_NGUON_LABEL, fmtDateVN, thanhPhanRows } from "./report-types"
import { build8a, buildDongHo, isOverSnapLine, lineTitle, lineUnit } from "./report-templates"
import { OUTSIDE_KIND_LABEL } from "./compute"
import { NORM_METER_UNIT, shortCsr } from "./types"

const INK: [number, number, number] = [15, 23, 42]
const GRAY: [number, number, number] = [100, 116, 139]
const RED: [number, number, number] = [185, 28, 28]
const HEAD_FILL: [number, number, number] = [241, 245, 249]
const M = 10
const QR = 12.8 // nhỏ hơn bản đầu 20% (16 → 12,8 mm)
const QR_Y = M - 2 // chừa 1 dòng phía trên QR cho mã mẫu
// Tiêu đề mục + hàng tiêu đề bảng + ~2 dòng đầu phải cùng trang (không để tiêu đề "mồ côi" cuối trang).
const KEEP_SECTION = 24

export type NormReportPdfInput = {
  kieu: NormReportKieu
  templateCode: string
  templateName: string
  config: Record<string, unknown>
  snapshot: NormReportSnapshot
  factoryName: string
  maBaoCao: string | null
  phongBan: string
  loaiKyHieu: string
  giaiTrinh: Record<string, string>
  kienNghi: string | null
  nguoiLapChucVu: string | null
  bgdChucVu: string | null
  qrUrl: string
}

export type NormBoxMm = { x: number; y: number; w: number; h: number }
export type NormRoleBoxes = { page: number; chuKyBox: NormBoxMm; tenBox: NormBoxMm }
export type NormReportPdf = { bytes: Uint8Array; pageHeightMm: number; boxesByRole: Record<NormReportSignRole, NormRoleBoxes> }

const nf = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "" : v.toLocaleString("vi-VN", { maximumFractionDigits: d, minimumFractionDigits: 0 })
const tons = (kg: number | undefined) => (kg ? kg / 1000 : 0)

function periodTitle(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-")
  const [ty, tm] = to.split("-")
  const lastDay = new Date(Date.UTC(Number(ty), Number(tm), 0)).getUTCDate()
  const fullMonth = fd === "01" && fy === ty && fm === tm && Number(to.slice(8, 10)) === lastDay
  if (fy === ty && fm === tm && fd === "01") return `THÁNG ${Number(tm)} NĂM ${ty}${fullMonth ? "" : ` (ĐẾN NGÀY ${fmtDateVN(to)})`}`
  return `TỪ NGÀY ${fmtDateVN(from)} ĐẾN NGÀY ${fmtDateVN(to)}`
}

type Ctx = { doc: jsPDF; W: number; H: number; y: number }

function ensureSpace(ctx: Ctx, need: number) {
  if (ctx.y + need > ctx.H - M) {
    ctx.doc.addPage()
    ctx.y = M + 4
  }
}

// Chữ đậm giả tại toạ độ tuyệt đối (NotoSans chỉ có Regular ⇒ tô + viền nét mảnh).
function boldAt(doc: jsPDF, s: string | string[], x: number, y: number, size: number, align: "left" | "center" | "right" = "left") {
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(size)
  doc.setLineWidth(size * 0.016)
  doc.setDrawColor(...INK)
  doc.setTextColor(...INK)
  doc.text(s, x, y, { align, renderingMode: "fillThenStroke" })
}

function text(
  ctx: Ctx,
  s: string,
  opts: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number; align?: "left" | "center" | "right"; gap?: number; keepWithNext?: number } = {},
) {
  const { doc } = ctx
  doc.setFont(PDF_FONT_NAME, opts.bold ? "bold" : "normal")
  doc.setFontSize(opts.size ?? 9)
  doc.setTextColor(...(opts.color ?? INK))
  const maxW = ctx.W - M * 2
  const lines = doc.splitTextToSize(s, maxW) as string[]
  const lh = (opts.size ?? 9) * 0.42
  ensureSpace(ctx, lines.length * lh + 1 + (opts.keepWithNext ?? 0))
  const x = opts.x ?? (opts.align === "center" ? ctx.W / 2 : opts.align === "right" ? ctx.W - M : M)
  // ctx.y là mép TRÊN dòng chữ ⇒ đường chân chữ = ctx.y + ~0.8 lh (không đè bảng phía trên).
  const base = ctx.y + lh * 0.8
  if (opts.bold) {
    // NotoSans chỉ có Regular ⇒ giả đậm bằng tô + viền nét mảnh (như nhãn thành phẩm).
    doc.setLineWidth((opts.size ?? 9) * 0.016)
    doc.setDrawColor(...(opts.color ?? INK))
    doc.text(lines, x, base, { align: opts.align ?? "left", renderingMode: "fillThenStroke" })
  } else doc.text(lines, x, base, { align: opts.align ?? "left" })
  ctx.y += lines.length * lh + (opts.gap ?? 1)
  doc.setTextColor(...INK)
}

function table(ctx: Ctx, head: RowInput[], body: RowInput[], opts: { redRows?: Set<number>; boldRows?: Set<number>; fontSize?: number; colStyles?: Record<number, { halign?: "left" | "right" | "center"; cellWidth?: number | "auto" | "wrap" }> } = {}) {
  // Không bắt đầu bảng sát đáy trang (chỉ kịp vẽ hàng tiêu đề rồi sang trang).
  ensureSpace(ctx, 7 * head.length + 8)
  autoTable(ctx.doc, {
    startY: ctx.y,
    margin: { left: M, right: M, top: M + 4 },
    head,
    body,
    theme: "grid",
    showHead: "everyPage", // bảng sang trang ⇒ lặp lại hàng tiêu đề
    rowPageBreak: "avoid",
    styles: { font: PDF_FONT_NAME, fontStyle: "normal", fontSize: opts.fontSize ?? 7.5, cellPadding: 1, textColor: INK, lineColor: [148, 163, 184], lineWidth: 0.15, valign: "middle" },
    headStyles: { fillColor: HEAD_FILL, textColor: INK, fontStyle: "normal", halign: "center" },
    columnStyles: opts.colStyles,
    didParseCell: (d: CellHookData) => {
      if (d.section !== "body") return
      if (opts.redRows?.has(d.row.index)) d.cell.styles.textColor = RED
      if (opts.boldRows?.has(d.row.index)) d.cell.styles.fillColor = [248, 250, 252]
    },
  })
  const last = (ctx.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  ctx.y = (last?.finalY ?? ctx.y) + 3
}

const R = { halign: "right" as const }

function compareTable(ctx: Ctx, lines: SnapLine[]) {
  if (!lines.length) {
    text(ctx, "Không có chỉ tiêu có định mức trong kỳ.", { size: 8, color: GRAY })
    return
  }
  const red = new Set<number>()
  const body = lines.map((l, i) => {
    if (isOverSnapLine(l)) red.add(i)
    const per = l.basis === "km100" ? "/100km" : "/tấn"
    return [
      String(i + 1),
      lineTitle(l),
      lineUnit(l),
      nf(l.actual, 2),
      nf(l.allowed, 2),
      l.avgActual === null ? "" : `${nf(l.avgActual, 3)}${per}`,
      l.avgNorm === null ? "" : `${nf(l.avgNorm, 3)}${per}`,
      l.diff === null ? "" : `${l.diff > 0 ? "+" : ""}${nf(l.diff, 2)}`,
      l.diffPct === null ? "" : `${l.diffPct > 0 ? "+" : ""}${nf(l.diffPct, 2)}`,
    ]
  })
  table(ctx, [["STT", "Tên vật tư / chỉ tiêu", "ĐVT", "Thực tế", "Định mức", "BQ thực tế", "BQ định mức", "Chênh SL", "Chênh %"]], body, {
    redRows: red,
    colStyles: { 0: { halign: "center", cellWidth: 8 }, 2: { cellWidth: 10 }, 3: R, 4: R, 5: R, 6: R, 7: R, 8: R },
  })
}

function outsideTable(ctx: Ctx, rows: SnapOutside[]) {
  if (!rows.length) return
  text(ctx, "Phát sinh ngoài định mức (chỉ hiển thị, không so sánh)", { bold: true, size: 9, keepWithNext: KEEP_SECTION })
  table(
    ctx,
    [["STT", "Loại", "Mã", "Tên", "Số lượng", "ĐVT", "Ghi chú / lý do"]],
    rows.map((r, i) => [String(i + 1), OUTSIDE_KIND_LABEL[r.kind], r.code, r.name, r.qty === null ? "" : nf(r.qty, 3), r.unit, r.note]),
    { colStyles: { 0: { halign: "center", cellWidth: 8 }, 4: R } },
  )
}

function drawHeader(ctx: Ctx, input: NormReportPdfInput, title: string, subtitle: string, ngayLap: string) {
  const { doc, W } = ctx
  // Mã mẫu (vd "Mẫu 8A-NMCB") canh giữa NGAY TRÊN QR góc phải trên (QR vẽ ở drawQr).
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(7)
  doc.setTextColor(...INK)
  doc.text(input.templateCode, W - M - QR / 2, QR_Y - 0.8, { align: "center" })
  const leftW = (W - M * 2 - QR - 4) / 2
  const lx = M + leftW / 2
  // Góc trái 3 dòng: 2 dòng tên công ty chữ thường, "NHÀ MÁY CHẾ BIẾN" in đậm.
  doc.setFontSize(8.5)
  doc.text(COMPANY_HEADING_LINE_1, lx, M + 1, { align: "center" })
  doc.text(COMPANY_HEADING_LINE_2, lx, M + 4.6, { align: "center" })
  boldAt(doc, COMPANY_HEADING_LINE_3, lx, M + 8.2, 8.5, "center")
  // Biểu ngữ phải: cả 2 dòng in đậm.
  const rx = M + leftW + leftW / 2
  boldAt(doc, "VƯƠNG QUỐC CAMPUCHIA", rx, M + 1, 8.5, "center")
  boldAt(doc, "Dân tộc - Tôn giáo - Quốc vương", rx, M + 4.6, 8.5, "center")
  doc.setFont(PDF_FONT_NAME, "normal")
  ctx.y = M + 8.2 + 5
  const [y, m, d] = ngayLap.split("-")
  doc.setFontSize(8.5)
  doc.text(input.maBaoCao ? `Số: ${input.maBaoCao}` : `Số:      /${input.loaiKyHieu}-${input.phongBan}`, M + leftW / 2, ctx.y, { align: "center" })
  doc.text(`Kampong Thom, ngày ${d} tháng ${m} năm ${y}`, rx, ctx.y, { align: "center" })
  ctx.y += 7
  text(ctx, title, { bold: true, size: 12, align: "center", gap: 0.5 })
  text(ctx, subtitle, { bold: true, size: 10.5, align: "center", gap: 1.5 })
}

async function drawQr(doc: jsPDF, W: number, url: string) {
  doc.setPage(1)
  await addQrImage(doc, url, W - M - QR, QR_Y, QR)
}

function drawMeta(ctx: Ctx, snap: NormReportSnapshot, showMeter: boolean, extra: string[] = []) {
  const parts = [`Kỳ: ${fmtDateVN(snap.from)} – ${fmtDateVN(snap.to)}`]
  if (showMeter && snap.meterFrom && snap.meterTo) parts.push(`Kỳ đồng hồ: ${fmtDateVN(snap.meterFrom)} → ${fmtDateVN(snap.meterTo)}`)
  text(ctx, parts.join("   ·   "), { size: 8, align: "center", gap: 0.5 })
  const vers = snap.versions.map((v) => `${v.name} (từ ${fmtDateVN(v.effective_from)}${v.effective_to ? ` đến ${fmtDateVN(v.effective_to)}` : ""})`)
  if (vers.length) text(ctx, `Khung định mức áp dụng: ${vers.join("; ")}`, { size: 7.5, color: GRAY, align: "center", gap: 0.5 })
  if (snap.draftUsed) text(ctx, "Số liệu xem thử bằng khung định mức NHÁP — chưa chính thức.", { size: 7.5, color: RED, align: "center", gap: 0.5 })
  for (const w of [...snap.warnings, ...extra]) text(ctx, `(!) ${w}`, { size: 7.5, color: RED, gap: 0.5 })
  ctx.y += 1.5
}

function drawSignatures(ctx: Ctx, input: NormReportPdfInput): Record<NormReportSignRole, NormRoleBoxes> {
  ensureSpace(ctx, 34)
  const { doc, W } = ctx
  const page = doc.getCurrentPageInfo().pageNumber
  const colW = (W - M * 2) / 2
  const y = ctx.y + 3
  const deputy = (input.bgdChucVu || "").toLowerCase().includes("phó")
  const cols: Array<{ role: NormReportSignRole; title: string; sub: string | null }> = [
    { role: "bgd", title: deputy ? "KT. GIÁM ĐỐC NHÀ MÁY" : "GIÁM ĐỐC NHÀ MÁY", sub: deputy ? input.bgdChucVu : null },
    { role: "nguoi_lap", title: "LẬP BIỂU", sub: input.nguoiLapChucVu },
  ]
  const boxes = {} as Record<NormReportSignRole, NormRoleBoxes>
  cols.forEach((c, i) => {
    const cx = M + colW * i + colW / 2
    doc.setFont(PDF_FONT_NAME, "bold")
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text(c.title, cx, y, { align: "center" })
    let headBottom = y
    if (c.sub) {
      doc.setFont(PDF_FONT_NAME, "normal")
      doc.setFontSize(8)
      doc.text(c.sub, cx, y + 3.6, { align: "center", maxWidth: colW - 4 })
      headBottom = y + 3.6
    }
    const boxX = M + colW * i + 10
    const boxW = colW - 20
    const nameY = y + 26
    boxes[c.role] = { page, chuKyBox: { x: boxX, y: headBottom + 1.5, w: boxW, h: nameY - headBottom - 6 }, tenBox: { x: boxX, y: nameY - 3.5, w: boxW, h: 5.5 } }
  })
  ctx.y = y + 30
  return boxes
}

// ─── Mẫu 8A ──────────────────────────────────────────────────────────────────

function body8a(ctx: Ctx, input: NormReportPdfInput) {
  const snap = input.snapshot
  const cfg = (input.config || {}) as Thang8aConfig
  const d = build8a(snap, cfg)

  // Thành phần nhà máy: 2 cột như mẫu giấy — "- Ông: Tên" | "Chức vụ: …" (cột chức vụ thẳng hàng).
  const thanhPhan = thanhPhanRows(cfg)
  if (thanhPhan.length) {
    text(ctx, "Thành phần nhà máy:", { size: 8.5, bold: true, keepWithNext: Math.min(thanhPhan.length, 3) * 3.9 })
    const { doc } = ctx
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(8.5)
    const leftX = M + 4
    const nameW = Math.max(...thanhPhan.map((r) => doc.getTextWidth(`- ${r.left}`)))
    const cvX = Math.min(leftX + Math.max(nameW + 8, 55), ctx.W / 2)
    const lh = 8.5 * 0.42
    for (const r of thanhPhan) {
      ensureSpace(ctx, lh + 0.5)
      const base = ctx.y + lh * 0.8
      doc.setFont(PDF_FONT_NAME, "normal")
      doc.setFontSize(8.5)
      doc.setTextColor(...INK)
      doc.text(`- ${r.left}`, leftX, base)
      if (r.chucVu) doc.text(`Chức vụ: ${r.chucVu}`, cvX, base, { maxWidth: ctx.W - M - cvX })
      ctx.y += lh + 0.4
    }
    ctx.y += 1.5
  }
  text(ctx, "Căn cứ kết quả tổng hợp của các bộ phận, Nhà máy chế biến thống nhất kết quả sản xuất trong kỳ như sau:", { size: 8.5, gap: 2 })

  // 1. NL tiếp nhận
  text(ctx, "1. KHỐI LƯỢNG NGUYÊN LIỆU TIẾP NHẬN (tấn, mọi nguồn)", { bold: true, size: 9.5, keepWithNext: KEEP_SECTION })
  if (!d.nlUnits.length) text(ctx, "Không có nguyên liệu tiếp nhận trong kỳ.", { size: 8, color: GRAY })
  else {
    const body: RowInput[] = d.nlUnits.map((u, i) => {
      const t = d.nlCols.reduce((s, c) => s + (u.tuoi[c.key] || 0), 0)
      return [String(i + 1), u.label, ...d.nlCols.map((c) => nf(tons(u.tuoi[c.key]), 3)), nf(tons(t), 3)]
    })
    const sumT = d.nlCols.reduce((s, c) => s + (d.nlTotalTuoi[c.key] || 0), 0)
    const sumK = d.nlCols.reduce((s, c) => s + (d.nlTotalKho[c.key] || 0), 0)
    const bold = new Set([body.length, body.length + 1])
    body.push(["", "Tổng khối lượng tươi", ...d.nlCols.map((c) => nf(tons(d.nlTotalTuoi[c.key]), 3)), nf(tons(sumT), 3)])
    body.push(["", "Tổng khối lượng khô", ...d.nlCols.map((c) => nf(tons(d.nlTotalKho[c.key]), 3)), nf(tons(sumK), 3)])
    const cs: Record<number, { halign: "right" }> = {}
    for (let i = 2; i < 3 + d.nlCols.length; i++) cs[i] = R
    table(ctx, [["STT", "Đơn vị", ...d.nlCols.map((c) => c.label), "Tổng"]], body, { boldRows: bold, colStyles: { 0: { halign: "center", cellWidth: 8 }, ...cs } })
  }

  const tpTable = (rows: typeof d.tpByCsr, empty: string) => {
    if (!rows.length) {
      text(ctx, empty, { size: 8, color: GRAY })
      return
    }
    const keys = TP_NGUON_KEYS.filter((k) => k !== "khac" || rows.some((r) => (r.kg.khac || 0) > 0))
    const body: RowInput[] = rows.map((r, i) => {
      const tot = keys.reduce((s, k) => s + (r.kg[k] || 0), 0)
      return [String(i + 1), shortCsr(r.csr) === r.csr ? r.csr : `CSR ${shortCsr(r.csr)}`, ...keys.map((k) => nf(tons(r.kg[k]), 3)), nf(tons(tot), 3)]
    })
    const sums = keys.map((k) => rows.reduce((s, r) => s + (r.kg[k] || 0), 0))
    body.push(["", "Tổng cộng", ...sums.map((s) => nf(tons(s), 3)), nf(tons(sums.reduce((a, b) => a + b, 0)), 3)])
    const cs: Record<number, { halign: "right" }> = {}
    for (let i = 2; i < 3 + keys.length; i++) cs[i] = R
    table(ctx, [["STT", "Chủng loại", ...keys.map((k) => TP_NGUON_LABEL[k]), "Tổng"]], body, { boldRows: new Set([body.length - 1]), colStyles: { 0: { halign: "center", cellWidth: 8 }, ...cs } })
  }

  text(ctx, "2. THÀNH PHẨM CHẾ BIẾN (tấn)", { bold: true, size: 9.5, keepWithNext: KEEP_SECTION })
  tpTable(d.tpByCsr, "Không có thành phẩm nhập trong kỳ.")
  text(ctx, "3. THÀNH PHẨM XUẤT KHO (tấn)", { bold: true, size: 9.5, keepWithNext: KEEP_SECTION })
  tpTable(d.tpExport, "Không có đơn xuất đã duyệt trong kỳ.")
  for (const w of snap.tpExportWarnings) text(ctx, `(!) ${w}`, { size: 7.5, color: RED })

  text(ctx, "4. SỬ DỤNG VẬT TƯ HÓA CHẤT CHẾ BIẾN", { bold: true, size: 9.5, keepWithNext: KEEP_SECTION + 8 })
  const ng = (k: string) => nf(tons(d.tpByNguon[k]), 3)
  text(ctx, `4.1 Thành phẩm Công ty: ${ng("cong_ty")} tấn   ·   4.2 Gia công: ${ng("gia_cong")} tấn   ·   4.3 Thu mua: ${ng("thu_mua")} tấn`, { size: 8 })
  text(ctx, "Định mức cho phép đã cộng theo từng nguồn; thực tế xuất kho không tách được theo nguồn nên ghi ở tổng.", { size: 7.5, color: GRAY })
  compareTable(ctx, d.sec4)

  text(ctx, "5. TIÊU THỤ ĐIỆN NƯỚC", { bold: true, size: 9.5, keepWithNext: KEEP_SECTION })
  compareTable(ctx, d.sec5)

  text(ctx, "6. TIÊU THỤ NHIÊN LIỆU", { bold: true, size: 9.5, keepWithNext: KEEP_SECTION + 8 })
  const km = d.kmByType.filter((k) => k.km > 0).map((k) => `${k.vehicleType} ${nf(k.km, 0)} km`).join(" · ")
  text(ctx, `- Số km vận chuyển: ${km || "không có"}`, { size: 8 })
  text(ctx, `- Quy khô nguyên liệu nông trường (theo bộ lọc ký hiệu KT của kỳ): ${nf(d.nlKhoTons, 4)} tấn`, { size: 8 })
  compareTable(ctx, d.sec6)

  text(ctx, "7. HỆ THỐNG XỬ LÝ NƯỚC THẢI VÀ CHỈ TIÊU KHÁC", { bold: true, size: 9.5, keepWithNext: KEEP_SECTION })
  compareTable(ctx, d.sec7)
  outsideTable(ctx, d.outside)

  text(ctx, "8. CÁC CHI PHÍ TRONG THÁNG", { bold: true, size: 9.5, gap: 2 })

  text(ctx, "9. TỔNG HỢP", { bold: true, size: 9.5, keepWithNext: KEEP_SECTION })
  if (d.summary.length) {
    const red = new Set<number>()
    table(
      ctx,
      [["STT", "Loại", "ĐVT", "Thực tế", "Định mức", "Chênh lệch"]],
      d.summary.map((s, i) => {
        if (s.diff > 1e-9 && s.allowed > 0) red.add(i)
        return [String(i + 1), s.name, s.unit, nf(s.actual, 2), nf(s.allowed, 2), `${s.diff > 0 ? "+" : ""}${nf(s.diff, 2)}`]
      }),
      { redRows: red, colStyles: { 0: { halign: "center", cellWidth: 8 }, 3: R, 4: R, 5: R } },
    )
  }

  text(ctx, "10. BẢNG GIẢI TRÌNH", { bold: true, size: 9.5, keepWithNext: KEEP_SECTION })
  text(ctx, "10.1 Vật tư, hóa chất vượt định mức", { bold: true, size: 8.5, keepWithNext: KEEP_SECTION })
  if (!d.over.length) text(ctx, "Không có chỉ tiêu vượt định mức.", { size: 8, color: GRAY })
  else compareTable(ctx, d.over)
  if (d.over.length) {
    text(ctx, "10.2 Nguyên nhân vượt định mức như sau:", { bold: true, size: 8.5, keepWithNext: KEEP_SECTION })
    const csrText = d.tpByCsr.map((r) => `CSR ${shortCsr(r.csr)}`).join(", ")
    const nlKhoAll = Object.values(d.nlTotalKho).reduce((a, b) => a + b, 0)
    text(
      ctx,
      `- Trong kỳ ${fmtDateVN(snap.from)} – ${fmtDateVN(snap.to)} nhà máy chế biến sản xuất ${nf(snap.totals.tpTons, 3)} tấn thành phẩm${csrText ? ` ${csrText}` : ""}, vận chuyển ${nf(tons(nlKhoAll), 3)} tấn khô nguyên liệu. Trong quá trình sản xuất có một số định mức khoán bị vượt cụ thể như sau:`,
      { size: 8.5 },
    )
    for (const l of d.over) text(ctx, `- ${lineTitle(l)}: ${(input.giaiTrinh[l.key] || "").trim() || "(chưa giải trình)"}`, { size: 8.5 })
  }

  text(ctx, "11. KIẾN NGHỊ", { bold: true, size: 9.5, keepWithNext: KEEP_SECTION })
  const kn = (input.kienNghi || "").trim()
  text(ctx, kn || "Không có.", { size: 8.5, color: kn ? INK : GRAY, gap: 2 })
}

// ─── Mẫu 09 ──────────────────────────────────────────────────────────────────

function body09(ctx: Ctx, input: NormReportPdfInput) {
  const d = buildDongHo(input.snapshot)
  if (!input.snapshot.meterFrom || !input.snapshot.meterTo) text(ctx, "(!) Chưa chọn kỳ đồng hồ — không có số tiêu thụ.", { size: 8, color: RED })
  const body: RowInput[] = []
  const bold = new Set<number>()
  d.groups.forEach((g, gi) => {
    bold.add(body.length)
    body.push([String(gi + 1), g.khuVuc, "", "", "", "", "", g.dien ? nf(g.dien, 0) : "", g.nuoc ? nf(g.nuoc, 2) : "", g.nuocThai ? nf(g.nuocThai, 2) : "", ""])
    for (const m of g.meters) {
      const v = m.value === null ? "" : nf(m.value, m.loai === "dien" ? 0 : 2)
      body.push([
        "",
        m.name,
        m.code,
        nf(m.heSo, 2),
        m.chiSoCu === null ? "" : nf(m.chiSoCu, 3),
        m.chiSoMoi === null ? "" : nf(m.chiSoMoi, 3),
        m.raw === null ? "" : nf(m.raw, 3),
        m.loai === "dien" ? v : "",
        m.loai === "nuoc" ? v : "",
        m.loai === "nuoc_thai" ? v : "",
        m.note,
      ])
    }
  })
  bold.add(body.length)
  body.push(["", "TỔNG CỘNG", "", "", "", "", "", nf(d.totalDien, 0), nf(d.totalNuoc, 2), nf(d.totalNuocThai, 2), ""])
  table(
    ctx,
    [
      ["STT", "Bộ phận / khu vực", "Ký hiệu", "Hệ số", "Chỉ số cũ", "Chỉ số mới", "Chỉ số tiêu thụ", `Điện năng tiêu thụ (${NORM_METER_UNIT.dien})`, "Thể tích nước sử dụng (m³)", "Thể tích nước xử lý (m³)", "Ghi chú"],
      ["", "a", "b", "c", "d", "e", "f = e − d", "g = f × c", "h = f × c", "h = f × c", ""],
    ],
    body,
    { boldRows: bold, fontSize: 7, colStyles: { 0: { halign: "center", cellWidth: 8 }, 3: R, 4: R, 5: R, 6: R, 7: R, 8: R, 9: R } },
  )
}

export async function buildNormReportPdf(input: NormReportPdfInput): Promise<NormReportPdf> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  doc.setDisplayMode("fullwidth", "continuous")
  await ensurePdfFont(doc)
  const W = 210
  const H = 297
  const ctx: Ctx = { doc, W, H, y: M }
  const snap = input.snapshot
  const title = "BÁO CÁO"
  if (input.kieu === "thang_8a") {
    drawHeader(ctx, input, title, `KẾT QUẢ SẢN XUẤT ${periodTitle(snap.from, snap.to)}`, snap.to)
    drawMeta(ctx, snap, true)
    body8a(ctx, input)
  } else {
    // Mẫu 09 (51-BC): tháng theo lần ghi mới, ngày lập = ngày sau lần ghi mới, dòng "(Từ ngày … đến …)" của kỳ đồng hồ.
    const mTo = snap.meterTo || snap.to
    const [my, mm] = mTo.split("-")
    drawHeader(ctx, input, title, `TỔNG HỢP ĐIỆN - NƯỚC TIÊU THỤ THÁNG ${Number(mm)} NĂM ${my}`, snap.meterTo ? addDaysISO(snap.meterTo, 1) : snap.to)
    if (snap.meterFrom && snap.meterTo) text(ctx, `(Từ ngày ${fmtDateVN(snap.meterFrom)} đến ngày ${fmtDateVN(snap.meterTo)})`, { size: 9, align: "center", gap: 1 })
    drawMeta(ctx, snap, false)
    body09(ctx, input)
  }
  const boxesByRole = drawSignatures(ctx, input)
  await drawQr(doc, W, input.qrUrl)
  const buf = doc.output("arraybuffer") as ArrayBuffer
  return { bytes: new Uint8Array(buf), pageHeightMm: H, boxesByRole }
}
