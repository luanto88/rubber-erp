import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { ensurePdfFont, addQrImage, PDF_FONT_NAME } from "@/lib/pdf-qr-shared"
import {
  formatMoney, formatQty, formatSoPhieu, insightWarnings, isDeputyDirector,
  type PurchaseInsightSnapshot, type PurchaseSignRole,
} from "@/lib/purchase/types"

// Phiếu đề nghị mua vật tư hàng hóa — khổ A5 NGANG (GĐ2f, 210×148mm), bố cục bám mẫu giấy
// cung_cap_dl/mau_dn_mua_vthh.pdf. Chỉ dựng bản để KÝ SỐ: tên người ký KHÔNG in sẵn (lõi ký
// đóng dấu chữ ký + tên đúng ô — in sẵn sẽ chồng nét, bài học module Bảo trì).
// Hàng ký giữ đúng thứ tự in của mẫu: Giám đốc nhà máy | Kế toán | Người đề nghị
// (thứ tự KÝ là luồng riêng: Người đề nghị → Giám đốc → Kế toán).

const PAGE_W = 210
const PAGE_H = 148
const MARGIN = 8
const CONTENT_W = PAGE_W - MARGIN * 2
const INK: [number, number, number] = [15, 23, 42]
const GRAY: [number, number, number] = [100, 116, 139]
/** Màu dòng bằng chứng khi có cảnh báo (tồn còn nhiều / đang có trong phiếu khác). */
const WARN: [number, number, number] = [180, 35, 24]
/** QR nhỏ, nằm cùng hàng tiêu đề (GĐ2e: 17mm → 10mm). */
const QR_SIZE = 10

export type PurchasePdfLine = {
  item_code: string | null
  item_name: string
  unit: string | null
  so_luong: number
  don_gia: number
  thanh_tien: number
  muc_dich: string | null
  ghi_chu: string | null
  la_vat_tu_moi: boolean
  lech_gia_pct: number | null
  ly_do_lech_gia: string | null
  /** Nơi mua dự kiến / ngày có hàng / ngày cần hàng — in thành dòng phụ dưới vật tư. */
  mua_tai?: string | null
  ngay_co_hang?: string | null
  ngay_can_hang?: string | null
  /** Chỉ phiếu điều chỉnh: thông số đã duyệt trước khi điều chỉnh. */
  /** Bằng chứng chụp lúc gửi ký: tồn, tiêu hao 90 ngày, lần mua gần nhất (GĐ2e). */
  insight?: PurchaseInsightSnapshot | null
  truoc?: { item_code: string | null; item_name: string | null; so_luong: number | null; don_gia: number | null } | null
}

export type PurchasePdfInput = {
  /** Có giá trị → dựng "Phiếu điều chỉnh" (cột Trước điều chỉnh + lý do). */
  adjustment?: { parentSoPhieu: string; lyDo: string } | null
  factoryName: string
  soPhieu: number
  ngay: string // YYYY-MM-DD
  loaiTien: string
  nguoiDeNghiTen: string
  nguoiDeNghiChucVu: string | null
  /** Bộ phận đề nghị — null với phiếu tạo trước GĐ2b (không in). */
  boPhan?: string | null
  giamDocChucVu: string | null
  keToanChucVu: string | null
  ghiChu: string | null
  lines: PurchasePdfLine[]
  qrUrl: string
}

export type PurchaseBoxMm = { x: number; y: number; w: number; h: number }
export type PurchaseRoleBoxes = { page: number; chuKyBox: PurchaseBoxMm; tenBox: PurchaseBoxMm }

export type PurchaseSigningPdf = {
  bytes: Uint8Array
  pageHeightMm: number
  boxesByRole: Record<PurchaseSignRole, PurchaseRoleBoxes>
}

function formatDateVN(iso: string): string {
  const [y, m, d] = String(iso || "").slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : iso
}

function lineNote(l: PurchasePdfLine): string {
  const parts: string[] = []
  if (l.ghi_chu?.trim()) parts.push(l.ghi_chu.trim())
  if (l.la_vat_tu_moi) parts.push("Vật tư mới")
  if (l.lech_gia_pct !== null && l.lech_gia_pct !== undefined && Math.abs(l.lech_gia_pct) > 10) {
    const sign = l.lech_gia_pct > 0 ? "+" : ""
    parts.push(`Giá ${sign}${l.lech_gia_pct.toFixed(0)}%${l.ly_do_lech_gia ? `: ${l.ly_do_lech_gia}` : ""}`)
  }
  return parts.join("; ")
}

/** Tiêu đề nhà máy: "NHÀ MÁY CHẾ BIẾN " + tên viết hoa; không lặp nếu tên đã bắt đầu bằng "NHÀ MÁY". */
export function factoryHeading(name: string): string {
  const upper = String(name || "").trim().toLocaleUpperCase("vi-VN")
  if (!upper) return "NHÀ MÁY CHẾ BIẾN"
  return upper.startsWith("NHÀ MÁY") ? upper : `NHÀ MÁY CHẾ BIẾN ${upper}`
}

/** Phần bằng chứng: "Tồn: 8 Bộ · Mua gần nhất 12/08/2026: 2 × 7 USD"; rỗng nếu không có bản chụp. */
function insightParts(l: PurchasePdfLine): { parts: string[]; warnings: string[] } {
  const ins = l.insight
  if (!ins) return { parts: [], warnings: [] }
  const unit = l.unit ? ` ${l.unit}` : ""
  const parts = [`Tồn: ${formatQty(ins.totalStock)}${unit}`]
  const last = ins.recentPurchases?.[0]
  parts.push(last
    ? `Mua gần nhất ${formatDateVN(last.ngay)}: ${formatQty(last.soLuong)} × ${formatMoney(last.donGia, last.loaiTien)} ${last.loaiTien}`
    : "Chưa có lần mua đã duyệt")
  return { parts, warnings: insightWarnings(ins) }
}

/**
 * MỘT dòng phụ dưới vật tư (GĐ2f): chỉ Tồn + Lần mua gần nhất kèm giá. Có cảnh báo → cả dòng đỏ, tiền
 * tố "(!) …". Nơi mua / ngày có hàng / ngày cần hàng KHÔNG in (xem ở trang chi tiết). Rỗng nếu không có bản chụp.
 */
export function subRowText(l: PurchasePdfLine): { text: string; warn: boolean } {
  const ins = insightParts(l)
  const text = ins.parts.join("  ·  ")
  if (!ins.warnings.length) return { text, warn: false }
  return { text: `(!) ${ins.warnings.join("; ")}  —  ${text}`, warn: true }
}

/** Ô "Trước điều chỉnh": mã/tên cũ (nếu đổi), SL và đơn giá đã duyệt trước đó. */
function beforeText(l: PurchasePdfLine, loaiTien: string): string {
  const t = l.truoc
  if (!t) return ""
  const parts: string[] = []
  if ((t.item_code || "") !== (l.item_code || "")) parts.push(`${t.item_code || ""} ${t.item_name || ""}`.trim())
  if (t.so_luong !== null && t.so_luong !== undefined) parts.push(`SL ${formatQty(t.so_luong)}`)
  if (t.don_gia !== null && t.don_gia !== undefined) parts.push(`giá ${formatMoney(t.don_gia, loaiTien)}`)
  return parts.join("; ")
}

export async function buildPurchasePdfForSigning(input: PurchasePdfInput): Promise<PurchaseSigningPdf> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a5" })
  // Mặc định jsPDF ghi OpenAction /FitH (vừa chiều NGANG cửa sổ) ⇒ Foxit/Acrobat phóng trang A5 lấp
  // bề ngang màn hình, nhìn như A4. /Fit = mở ra thấy trọn 1 trang; in đúng khổ A5, không tự phóng.
  doc.setDisplayMode("fullpage", "single")
  doc.viewerPreferences({ PrintScaling: "None", PickTrayByPDFSize: true })
  await ensurePdfFont(doc)
  doc.setTextColor(...INK)

  // ── Đầu phiếu ──
  // Tên nhà máy, ngay dưới là số phiếu (cùng lề trái); QR nhỏ đặt góc phải CÙNG HÀNG tiêu đề (GĐ2e).
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(8.5)
  const nameLines = doc.splitTextToSize(factoryHeading(input.factoryName), CONTENT_W - QR_SIZE - 4) as string[]
  doc.text(nameLines, MARGIN, MARGIN + 2)
  let y = MARGIN + 2 + nameLines.length * 3.6
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.text(`Số: ${formatSoPhieu(input.soPhieu)}`, MARGIN, y)

  const adj = input.adjustment || null
  y += 6
  // Hàng tiêu đề: tiêu đề căn giữa trang, QR căn giữa dọc theo tiêu đề ở mép phải.
  await addQrImage(doc, input.qrUrl, PAGE_W - MARGIN - QR_SIZE, y - 1.3 - QR_SIZE / 2, QR_SIZE)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(adj ? 10 : 11)
  doc.text(adj ? "PHIẾU ĐIỀU CHỈNH ĐỀ NGHỊ MUA VẬT TƯ HÀNG HÓA" : "PHIẾU ĐỀ NGHỊ MUA VẬT TƯ HÀNG HÓA", PAGE_W / 2, y, { align: "center" })
  y += 4.5
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8.5)
  doc.text(
    adj ? `Ngày: ${formatDateVN(input.ngay)} — Điều chỉnh phiếu số ${adj.parentSoPhieu}` : `Ngày: ${formatDateVN(input.ngay)}`,
    PAGE_W / 2, y, { align: "center" },
  )
  y += 5
  doc.text("Kính gởi Ban Giám đốc nhà máy", MARGIN, y)
  y += 4.2
  const boPhanText = input.boPhan ? `Bộ phận: ${input.boPhan}` : ""
  const boPhanW = boPhanText ? doc.getTextWidth(boPhanText) + 3 : 0
  doc.text(
    `Người đề nghị: ${input.nguoiDeNghiTen}${input.nguoiDeNghiChucVu ? ` — ${input.nguoiDeNghiChucVu}` : ""}`,
    MARGIN, y, { maxWidth: CONTENT_W - boPhanW },
  )
  if (boPhanText) doc.text(boPhanText, PAGE_W - MARGIN, y, { align: "right" })
  y += 4.2
  if (adj) {
    const reasonLines = doc.splitTextToSize(`Lý do điều chỉnh: ${adj.lyDo}`, CONTENT_W) as string[]
    doc.text(reasonLines, MARGIN, y)
    y += reasonLines.length * 3.8
    doc.text("Nội dung điều chỉnh (số lượng là tổng số lượng duyệt mới):", MARGIN, y)
  } else {
    doc.text("Nội dung đề nghị mua vật tư hàng hóa như sau:", MARGIN, y)
  }
  y += 2

  // ── Bảng ──
  const total = input.lines.reduce((s, l) => s + Number(l.thanh_tien || 0), 0)
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: MARGIN },
    rowPageBreak: "avoid",
    theme: "grid",
    styles: {
      font: PDF_FONT_NAME, fontSize: 6.5, cellPadding: 0.9, textColor: INK,
      lineColor: [30, 41, 59], lineWidth: 0.15, valign: "middle",
    },
    headStyles: { fontStyle: "bold", fillColor: [255, 255, 255], textColor: INK, halign: "center", fontSize: 6.5 },
    columnStyles: {
      0: { cellWidth: 6, halign: "center" },
      1: { cellWidth: 50 },
      2: { cellWidth: 18, halign: "center" },
      3: { cellWidth: 10, halign: "center" },
      4: { cellWidth: 12, halign: "right" },
      5: { cellWidth: 18, halign: "right" },
      6: { cellWidth: 20, halign: "right" },
      7: { cellWidth: 36 },
      8: { cellWidth: 24 },
    },
    head: [[
      "STT", "Tên vật tư hàng hóa", "Mã vật tư hàng hóa", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền",
      adj ? "Trước điều chỉnh" : "Mục đích sử dụng", "Ghi chú",
    ]],
    // Mỗi vật tư kèm tối đa MỘT dòng phụ trải hết bề ngang (GĐ2f): Tồn + lần mua gần nhất kèm giá, chụp lúc
    // gửi ký (+ cảnh báo). Ô STT gộp 2 hàng.
    body: input.lines.flatMap((l, i) => {
      const subStyle = { fontSize: 6, textColor: GRAY, cellPadding: { top: 0.5, bottom: 0.5, left: 1.2, right: 0.9 } }
      const subRows: unknown[][] = []
      const sub = subRowText(l)
      if (sub.text) {
        subRows.push([{ content: sub.text, colSpan: 8, styles: { ...subStyle, textColor: sub.warn ? WARN : GRAY } }])
      }
      const main = [
        subRows.length ? { content: String(i + 1), rowSpan: 1 + subRows.length, styles: { valign: "middle" as const } } : String(i + 1),
        l.item_name,
        l.item_code || "",
        l.unit || "",
        formatQty(l.so_luong),
        formatMoney(l.don_gia, input.loaiTien),
        formatMoney(l.thanh_tien, input.loaiTien),
        adj ? beforeText(l, input.loaiTien) : l.muc_dich || "",
        adj ? (l.ghi_chu || "") : lineNote(l),
      ]
      return [main, ...subRows] as never[]
    }),
    foot: [[
      { content: `Tổng cộng (${input.loaiTien})`, colSpan: 6, styles: { halign: "right", fontStyle: "bold" } },
      { content: formatMoney(total, input.loaiTien), styles: { halign: "right", fontStyle: "bold" } },
      { content: "", colSpan: 2 },
    ]],
    footStyles: { fillColor: [255, 255, 255], textColor: INK, fontSize: 6.5 },
    showFoot: "lastPage",
  })

  const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  y = (lastTable?.finalY ?? y) + 4

  if (input.ghiChu?.trim()) {
    doc.setFontSize(7.5)
    const lines = doc.splitTextToSize(`Ghi chú: ${input.ghiChu.trim()}`, CONTENT_W) as string[]
    if (y + lines.length * 3.2 > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN + 4 }
    doc.text(lines, MARGIN, y)
    y += lines.length * 3.2 + 1
  }

  // ── Hàng ký: cần ~30mm ──
  if (y + 30 > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN + 4 }
  const page = doc.getCurrentPageInfo().pageNumber
  const colW = CONTENT_W / 3
  y += 3

  const gdDeputy = isDeputyDirector(input.giamDocChucVu)
  const cols: { role: PurchaseSignRole; title: string; sub: string | null }[] = [
    {
      role: "giam_doc",
      title: gdDeputy ? "KT. Giám đốc nhà máy" : "Giám đốc nhà máy",
      sub: gdDeputy ? (input.giamDocChucVu || "Phó giám đốc") : null,
    },
    { role: "ke_toan", title: "Kế toán", sub: input.keToanChucVu || null },
    { role: "nguoi_de_nghi", title: "Người đề nghị", sub: input.nguoiDeNghiChucVu || null },
  ]

  const boxesByRole = {} as Record<PurchaseSignRole, PurchaseRoleBoxes>
  cols.forEach((c, i) => {
    const cx = MARGIN + colW * i + colW / 2
    doc.setFont(PDF_FONT_NAME, "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...INK)
    doc.text(c.title, cx, y, { align: "center", maxWidth: colW - 2 })
    let headBottom = y
    if (c.sub && c.sub.trim().toLowerCase() !== c.title.toLowerCase()) {
      doc.setFont(PDF_FONT_NAME, "normal")
      doc.setFontSize(6.8)
      doc.setTextColor(...GRAY)
      doc.text(c.sub, cx, y + 3.3, { align: "center", maxWidth: colW - 2 })
      headBottom = y + 3.3
    }
    const boxX = MARGIN + colW * i + 3
    const boxW = colW - 6
    const nameY = y + 22
    boxesByRole[c.role] = {
      page,
      chuKyBox: { x: boxX, y: headBottom + 1.5, w: boxW, h: nameY - headBottom - 6 },
      tenBox: { x: boxX, y: nameY - 3.5, w: boxW, h: 5 },
    }
  })
  doc.setTextColor(...INK)

  const bytes = doc.output("arraybuffer") as ArrayBuffer
  return { bytes: new Uint8Array(bytes), pageHeightMm: PAGE_H, boxesByRole }
}
