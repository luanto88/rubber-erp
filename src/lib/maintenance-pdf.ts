import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { ensurePdfFont, addQrImage, safeName, PDF_FONT_NAME } from "@/lib/pdf-qr-shared"
import { convertCurrency } from "@/lib/currency"
import { fetchImageForPdf, isPdfImageFailure, type PdfImage, type PdfImageResult } from "@/lib/image-format"

// ─── Types (mirror DB shape dùng bởi maintenance/print/page.tsx) ────────────

export type MaterialRow = {
  nguon: "trong_kho" | "ben_ngoai"
  ten_vat_tu: string
  dvt: string | null
  so_luong: number
  don_gia: number | null
  loai_tien: string | null
  thanh_tien: number | null
}

export type LineData = {
  id: string
  ten_tb: string
  ma_tb: string
  ten_tai_xe: string | null
  noi_dung: string | null
  nguyen_nhan: string | null
  cac_khac_phuc: string | null
  loai_sua_chua: "lon" | "nho" | null
  chi_phi_dk: number
  loai_tien: string
  cong_tho: number
  nhien_lieu_su_dung: string | null
  dvt_do: string | null
  so_luong_do: number | null
  km_dong_ho: number | null
  chat_luong: string | null
  dispatch_vehicle_id: string | null
  image_urls: string[]
  materials: MaterialRow[]
}

export type RecordData = {
  id: string
  factory_id: string
  ma_bb: string | null
  hang_muc: string
  ngay: string
  tu_gio: string | null
  den_gio: string | null
  bo_phan: string
  nguoi_tao: string | null
  nguoi_thuc_hien: string[]
  nv_phu_trach: string | null
  phu_trach_bao_tri: string | null
  bgd_phu_trach: string | null
  giam_doc: string | null
  trang_thai: string
  nguoi_duyet: string | null
  ngay_duyet: string | null
  ghi_chu: string | null
  noi_dung_chung: string | null
  nguyen_nhan_chung: string | null
  cac_khac_phuc_chung: string | null
  image_urls_chung: string[] | null
  lines: LineData[]
}

export type HistoryRow = {
  ngay: string
  ma_bb: string | null
  hang_muc: string
  ten_tb: string
  ma_tb: string
  noi_dung: string | null
  cac_khac_phuc: string | null
  chi_phi_dk: number
  loai_tien: string
  cong_tho: number
  nguoi_thuc_hien: string[]
  nv_phu_trach: string | null
  phu_trach_bao_tri: string | null
}

export type AssetInfo = {
  ma_tb: string
  ten_tb: string
  bo_phan: string
  loai: "may_moc" | "xe"
  nam_sd: string | null
  bien_so: string | null
  mo_ta: string | null
}

export type VehicleInfo = {
  id: string
  code: string
  name: string
  vehicle_type: string | null
  plate_number: string | null
  factory_id: string
}

export type DriverAssignmentRow = {
  driver_name: string
  driver_code: string | null
  effective_from: string | null
  effective_to: string | null
  note: string | null
}

export type VehicleHistoryRow = {
  ngay: string
  ma_bb: string | null
  hang_muc: string
  km_dong_ho: number | null
  noi_dung: string | null
  cac_khac_phuc: string | null
  chi_phi_dk: number
  loai_tien: string
  cong_tho: number
  nguoi_thuc_hien: string[]
  nv_phu_trach: string | null
}

export type BaoCaoKyRow = {
  ma_bb: string | null
  ma_tb: string
  km_dong_ho: number | null
  ngay: string
  noi_dung: string
  gia_tri: number
  loai_tien: string
  hang_muc: string
}

export type BaoCaoKySection = { bo_phan: string; rows: BaoCaoKyRow[] }

// ─── Constants ────────────────────────────────────────────────────────────

type RGB = [number, number, number]
type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } }

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 15
const CONTENT_W = PAGE_W - MARGIN * 2
const BODY_SIZE = 9.5
const LINE_H = 5
const QR_SIZE = 22

const INK: RGB = [15, 23, 42]
const GRAY: RGB = [100, 116, 139]
const BORDER: RGB = [203, 213, 225]
const HEADER_BAR_BG: RGB = [241, 245, 249]

// ─── Helpers: ngày giờ / tiền tệ ─────────────────────────────────────────

function fmtDateVN(d: string | null): string {
  if (!d) return "......"
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`
}

function fmtDatePartsVN(d: string | null): { dd: string; mm: string; yyyy: string } {
  if (!d) return { dd: "......", mm: "......", yyyy: "........." }
  const dt = new Date(d)
  return {
    dd: String(dt.getDate()).padStart(2, "0"),
    mm: String(dt.getMonth() + 1).padStart(2, "0"),
    yyyy: String(dt.getFullYear()),
  }
}

function fmtTimeVN(t: string | null): string {
  if (!t) return "......"
  return t.slice(0, 5)
}

// Không dùng ký hiệu tiền tệ Unicode (៛/₫) — rủi ro thiếu glyph trong font NotoSans
// nhúng cho PDF (chỉ hỗ trợ Latin). Dùng mã tiền tệ ASCII-safe thay thế.
function pdfMoney(amount: number, loaiTien: string): string {
  return loaiTien === "USD" ? `$${amount.toLocaleString()}` : `${amount.toLocaleString()} ${loaiTien}`
}

// ─── Helpers: layout cơ bản ───────────────────────────────────────────────

function ensureSpace(doc: jsPDF, y: number, needed: number, bottom = MARGIN): number {
  if (y + needed > PAGE_H - bottom) {
    doc.addPage()
    return MARGIN
  }
  return y
}

function drawCompanyHeader(doc: jsPDF, y: number, boPhan?: string | null): number {
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10.5)
  doc.setTextColor(...INK)
  doc.text("Nhà máy chế biến Phước Hòa Kampong Thom", MARGIN, y)
  y += 4.6
  if (boPhan) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(9)
    doc.text(`Bộ phận: ${boPhan}`, MARGIN, y)
    y += 4.6
  }
  return y
}

async function drawQrBlock(doc: jsPDF, qrUrl: string, maBb: string | null, topY: number): Promise<number> {
  if (!qrUrl) return topY
  const x = PAGE_W - MARGIN - QR_SIZE
  await addQrImage(doc, qrUrl, x, topY, QR_SIZE)
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text(maBb || "", x + QR_SIZE / 2, topY + QR_SIZE + 3, { align: "center" })
  doc.setTextColor(...INK)
  return topY + QR_SIZE + 6
}

function drawCenteredTitleBlock(
  doc: jsPDF,
  y: number,
  regionX: number,
  regionW: number,
  opts: { title: string; subtitle?: string; soLabel?: string },
): number {
  const cx = regionX + regionW / 2
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(13)
  doc.setTextColor(...INK)
  const titleLines = doc.splitTextToSize(opts.title.toUpperCase(), regionW)
  titleLines.forEach((line: string) => {
    doc.text(line, cx, y, { align: "center" })
    y += 5.6
  })
  if (opts.subtitle) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(...GRAY)
    const subLines = doc.splitTextToSize(opts.subtitle, regionW)
    subLines.forEach((line: string) => {
      doc.text(line, cx, y, { align: "center" })
      y += 4
    })
  }
  if (opts.soLabel) {
    doc.setFont(PDF_FONT_NAME, "bold")
    doc.setFontSize(9.5)
    doc.setTextColor(...GRAY)
    doc.text(opts.soLabel, cx, y, { align: "center" })
    y += 5
  }
  doc.setTextColor(...INK)
  return y
}

// Mẫu "QR bên cạnh tiêu đề" (F13/F15/F15BaoDuong/F15SmallVehicle)
async function drawTitleWithQr(
  doc: jsPDF,
  y: number,
  opts: { title: string; subtitle?: string; soLabel?: string; qrUrl: string; maBb: string | null },
): Promise<number> {
  const qrPresent = !!opts.qrUrl
  const regionW = qrPresent ? CONTENT_W - QR_SIZE - 6 : CONTENT_W
  const titleBottom = drawCenteredTitleBlock(doc, y, MARGIN, regionW, opts)
  let qrBottom = y
  if (qrPresent) qrBottom = await drawQrBlock(doc, opts.qrUrl, opts.maBb, y)
  return Math.max(titleBottom, qrBottom) + 2
}

// Mẫu "QR đứng riêng phía trên, rồi tới dòng ngày căn phải, rồi mới tới tiêu đề" (F10/F03/F06/F08NB)
async function drawQrThenDateThenTitle(
  doc: jsPDF,
  y: number,
  opts: { qrUrl: string; maBb: string | null; dateParts: { dd: string; mm: string; yyyy: string }; title: string; subtitle?: string; soLabel?: string },
): Promise<number> {
  if (opts.qrUrl) y = await drawQrBlock(doc, opts.qrUrl, opts.maBb, y)
  y += 2
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(BODY_SIZE)
  doc.setTextColor(...INK)
  doc.text(
    `Kampong Thom, ngày ${opts.dateParts.dd} tháng ${opts.dateParts.mm} năm ${opts.dateParts.yyyy}`,
    PAGE_W - MARGIN,
    y,
    { align: "right" },
  )
  y += 6
  y = drawCenteredTitleBlock(doc, y, MARGIN, CONTENT_W, opts)
  return y
}

function drawSectionHeader(doc: jsPDF, y: number, label: string): number {
  y = ensureSpace(doc, y, 6)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(9)
  doc.setTextColor(...INK)
  doc.text(label.toUpperCase(), MARGIN, y)
  return y + 5
}

function drawGroupHeaderBar(doc: jsPDF, y: number, label: string): number {
  y = ensureSpace(doc, y, 7)
  doc.setFillColor(...HEADER_BAR_BG)
  doc.rect(MARGIN, y - 4, CONTENT_W, 6, "F")
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  doc.text(label.toUpperCase(), MARGIN + 2, y)
  return y + 4
}

function drawBlankLines(doc: jsPDF, x: number, y: number, width: number, count: number): number {
  for (let i = 0; i < count; i++) {
    y = ensureSpace(doc, y, LINE_H)
    doc.setDrawColor(...BORDER)
    doc.setLineWidth(0.15)
    doc.line(x, y, x + width, y)
    y += LINE_H
  }
  return y
}

// Workhorse dùng cho hầu hết các dòng "Nhãn: nội dung" trong tài liệu — nếu nội dung
// rỗng và có blankCount thì vẽ các dòng kẻ trống để ký tay; có nội dung thì thử vẽ
// liền dòng với nhãn (in đậm), nếu không đủ chỗ thì xuống dòng và wrap.
function drawLabelContent(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  label: string,
  content: string | null | undefined,
  opts?: { blankCount?: number; fontSize?: number },
): number {
  const fontSize = opts?.fontSize ?? BODY_SIZE
  const blankCount = opts?.blankCount ?? 0
  doc.setFontSize(fontSize)
  const trimmed = (content || "").trim()
  if (!trimmed) {
    y = ensureSpace(doc, y, LINE_H)
    doc.setFont(PDF_FONT_NAME, "bold")
    doc.setTextColor(...INK)
    doc.text(label, x, y)
    y += LINE_H
    if (blankCount > 0) y = drawBlankLines(doc, x, y, width, blankCount)
    return y
  }
  doc.setFont(PDF_FONT_NAME, "bold")
  const labelW = doc.getTextWidth(label)
  const paragraphs = trimmed.split("\n")
  const fitsInline =
    paragraphs.length === 1 &&
    doc.splitTextToSize(paragraphs[0], width).length <= 1 &&
    labelW + doc.getTextWidth(paragraphs[0]) <= width
  y = ensureSpace(doc, y, LINE_H)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setTextColor(...INK)
  doc.text(label, x, y)
  if (fitsInline) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.text(paragraphs[0], x + labelW, y)
    return y + LINE_H
  }
  y += LINE_H
  doc.setFont(PDF_FONT_NAME, "normal")
  for (const para of paragraphs) {
    const lines = para ? doc.splitTextToSize(para, width) : [""]
    for (const line of lines) {
      y = ensureSpace(doc, y, LINE_H)
      doc.text(line, x, y)
      y += LINE_H
    }
  }
  return y
}

function drawBoldPrefixLine(doc: jsPDF, text: string, x: number, y: number) {
  const idx = text.indexOf(": ")
  if (idx === -1) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.text(text, x, y)
    return
  }
  const label = text.slice(0, idx + 2)
  const rest = text.slice(idx + 2)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.text(label, x, y)
  const w = doc.getTextWidth(label)
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.text(rest, x + w, y)
}

function drawFactLines(doc: jsPDF, y: number, lines: string[]): number {
  const rowH = 5
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  for (let i = 0; i < lines.length; i += 2) {
    y = ensureSpace(doc, y, rowH)
    drawBoldPrefixLine(doc, lines[i], MARGIN, y)
    if (lines[i + 1]) drawBoldPrefixLine(doc, lines[i + 1], MARGIN + CONTENT_W / 2, y)
    y += rowH
  }
  return y
}

function drawInlineLabelPairs(doc: jsPDF, y: number, pairs: [string, string][], gap = 8): number {
  y = ensureSpace(doc, y, LINE_H)
  doc.setFontSize(BODY_SIZE)
  doc.setTextColor(...INK)
  let x = MARGIN
  pairs.forEach(([label, value]) => {
    doc.setFont(PDF_FONT_NAME, "bold")
    doc.text(`${label}: `, x, y)
    x += doc.getTextWidth(`${label}: `)
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.text(value, x, y)
    x += doc.getTextWidth(value) + gap
  })
  return y + LINE_H
}

function drawTwoColRow(doc: jsPDF, y: number, left: string, right: string): number {
  y = ensureSpace(doc, y, LINE_H)
  doc.setFontSize(BODY_SIZE)
  doc.setTextColor(...INK)
  drawBoldPrefixLine(doc, left, MARGIN, y)
  drawBoldPrefixLine(doc, right, MARGIN + CONTENT_W / 2, y)
  return y + LINE_H
}

// Khung ký (mm, gốc trên-trái) dùng cho luồng "Ký duyệt" (buildMaintenanceSuCoNhoPdfForSigning)
// — nằm trong khoảng trắng giữa nhãn vai trò và dòng "(Ký và ghi rõ họ tên)" đã vẽ, KHÔNG vẽ
// thêm gì mới, chỉ mô tả lại toạ độ có sẵn. `roleId` do caller tự gán (không suy từ label vì
// label hiển thị khác nhau giữa F13/F10/F15 dù cùng 1 người, vd "Nhân viên kỹ thuật" vs "Nhân
// viên phụ trách" đều là `nv_phu_trach`). Luồng "Xuất PDF"/in thường (downloadMaintenanceXxxPdf)
// không đọc `.boxes`, không đổi hành vi/hình ảnh.
export type SignatureRoleBoxMm = { x: number; y: number; w: number; h: number }
export type SignatureRoleBoxes = { roleId: string; page: number; chuKyBox: SignatureRoleBoxMm; tenBox: SignatureRoleBoxMm }

function drawSignatureRowCapture(
  doc: jsPDF, y: number, cols: { role: string; name?: string | null; roleId?: string; note?: string }[],
): { y: number; boxes: SignatureRoleBoxes[] } {
  y = ensureSpace(doc, y, 34)
  y += 6
  const colW = CONTENT_W / cols.length
  const page = doc.getCurrentPageInfo().pageNumber
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(9)
  doc.setTextColor(...INK)
  cols.forEach((c, i) => {
    const cx = MARGIN + colW * i + colW / 2
    doc.text(c.role, cx, y, { align: "center", maxWidth: colW - 4 })
  })
  const nameY = y + 18
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  cols.forEach((c, i) => {
    const cx = MARGIN + colW * i + colW / 2
    if (c.name) doc.text(c.name, cx, nameY, { align: "center", maxWidth: colW - 4 })
  })
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  cols.forEach((c, i) => {
    const cx = MARGIN + colW * i + colW / 2
    doc.text("(Ký và ghi rõ họ tên)", cx, nameY + 4, { align: "center" })
  })
  // Ghi chú nhỏ "ký thay" (vd Nhân viên phụ trách ký thay Tài xế) — chỉ vài cột có, đặt ngay
  // dưới dòng "(Ký và ghi rõ họ tên)". Có ít nhất 1 cột có note thì tăng thêm chiều cao trả về
  // để khối nội dung tiếp theo không đè lên dòng ghi chú này.
  const hasNote = cols.some((c) => c.note)
  if (hasNote) {
    // Không dùng style "italic" — font đăng ký qua ensurePdfFont() chỉ có normal/bold, xin style
    // khác sẽ bị jsPDF âm thầm fallback sang font khác không đủ glyph tiếng Việt, làm chữ có dấu
    // bị mangled (vd "phụ" ra "phả"). Dùng chữ thường + màu xám để phân biệt, giống các dòng phụ
    // khác trong file này (vd "(Ký và ghi rõ họ tên)").
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(6.5)
    cols.forEach((c, i) => {
      if (!c.note) return
      const cx = MARGIN + colW * i + colW / 2
      doc.text(c.note, cx, nameY + 10, { align: "center", maxWidth: colW - 4 })
    })
    doc.setFontSize(7)
  }
  doc.setTextColor(...INK)

  const boxes: SignatureRoleBoxes[] = cols
    .map((c, i): SignatureRoleBoxes | null => {
      if (!c.roleId) return null
      const boxX = MARGIN + colW * i + 6
      const boxW = colW - 12
      return {
        roleId: c.roleId,
        page,
        chuKyBox: { x: boxX, y: y + 1, w: boxW, h: 15 },
        tenBox: { x: boxX, y: nameY - 3, w: boxW, h: 5 },
      }
    })
    .filter((b): b is SignatureRoleBoxes => b !== null)

  return { y: nameY + (hasNote ? 14 : 8), boxes }
}

function drawSignatureRow(doc: jsPDF, y: number, cols: { role: string; name?: string | null }[]): number {
  return drawSignatureRowCapture(doc, y, cols).y
}

// Neo cố định ở góc trái, sát mép dưới trang — không phụ thuộc độ dài nội dung phía trên (trước
// đây vẽ ngay sau khối chữ ký nên trồi lên thấp/cao tùy nội dung; nay luôn đúng 1 vị trí trên
// mọi trang/mọi mẫu, đúng quy ước "page footer" chuẩn). Tham số `y` giữ lại chỉ để không phải
// sửa 11 call site đang truyền vào, không còn dùng trong thân hàm.
function drawDocumentFooter(doc: jsPDF, _y: number, code: string): number {
  const lineY = PAGE_H - MARGIN
  const textY = lineY + 5
  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, lineY, PAGE_W - MARGIN, lineY)
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text(`${code} (01-15/05/2026)`, MARGIN, textY)
  doc.setTextColor(...INK)
  return textY + 4
}

function drawChatLuongCheckbox(doc: jsPDF, y: number, isDat: boolean, isKhongDat: boolean): number {
  y = ensureSpace(doc, y, LINE_H + 2)
  doc.setFontSize(BODY_SIZE)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setTextColor(...INK)
  doc.text("Chất lượng:", MARGIN, y)
  let x = MARGIN + doc.getTextWidth("Chất lượng:") + 4
  const box = 3.2
  doc.setDrawColor(...INK)
  doc.rect(x, y - 2.6, box, box)
  if (isDat) doc.text("X", x + 0.6, y - 0.2)
  x += box + 1.5
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.text("Đạt yêu cầu", x, y)
  x += doc.getTextWidth("Đạt yêu cầu") + 6
  doc.rect(x, y - 2.6, box, box)
  if (isKhongDat) {
    doc.setFont(PDF_FONT_NAME, "bold")
    doc.text("X", x + 0.6, y - 0.2)
  }
  x += box + 1.5
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.text("Không đạt", x, y)
  return y + LINE_H + 2
}

function drawKetLuanBlank(doc: jsPDF, y: number): number {
  y = ensureSpace(doc, y, 14)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(BODY_SIZE)
  doc.setTextColor(...INK)
  doc.text("Kết luận:", MARGIN, y)
  y += 3
  for (let i = 0; i < 2; i++) {
    y = ensureSpace(doc, y, 8)
    doc.setDrawColor(...BORDER)
    doc.line(MARGIN, y + 7, PAGE_W - MARGIN, y + 7)
    y += 8
  }
  return y + 2
}

function drawGiaTriSuaChua(doc: jsPDF, y: number, lines: LineData[], label: string): number {
  y = ensureSpace(doc, y, LINE_H)
  doc.setFontSize(BODY_SIZE)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setTextColor(...INK)
  doc.text(label, MARGIN, y)
  let x = MARGIN + doc.getTextWidth(label)
  const multi = lines.length > 1
  lines.forEach((line, idx) => {
    doc.setFont(PDF_FONT_NAME, "normal")
    if (multi) {
      const prefix = `${line.ten_tb}: `
      doc.text(prefix, x, y)
      x += doc.getTextWidth(prefix)
    }
    doc.setFont(PDF_FONT_NAME, "bold")
    const val = pdfMoney(line.chi_phi_dk, line.loai_tien)
    doc.text(val, x, y)
    x += doc.getTextWidth(val)
    if (idx < lines.length - 1) {
      doc.setFont(PDF_FONT_NAME, "normal")
      doc.text(", ", x, y)
      x += doc.getTextWidth(", ")
    }
  })
  return y + LINE_H
}

// ─── Bảng vật tư (autoTable) ──────────────────────────────────────────────

function drawMaterialsTable(doc: jsPDF, startY: number, materials: MaterialRow[]): number {
  if (materials.length === 0) return startY
  const head = ["STT", "Tên vật tư / phụ tùng", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền", "Nguồn"]
  const body = materials.map((m, i) => [
    String(i + 1),
    m.ten_vat_tu,
    m.dvt || "—",
    String(m.so_luong),
    m.don_gia ? pdfMoney(m.don_gia, m.loai_tien || "USD") : "—",
    m.thanh_tien ? pdfMoney(m.thanh_tien, m.loai_tien || "USD") : "—",
    m.nguon === "trong_kho" ? "Kho" : "Mua ngoài",
  ])
  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN },
    head: [head],
    body,
    styles: { font: PDF_FONT_NAME, fontSize: 7.5, cellPadding: 1.2, textColor: INK, lineColor: BORDER, lineWidth: 0.1 },
    headStyles: { fillColor: HEADER_BAR_BG, textColor: [15, 23, 42], fontStyle: "bold" },
    theme: "grid",
  })
  return (doc as PdfWithTable).lastAutoTable?.finalY ?? startY
}

// ─── Ảnh hiện trường ───────────────────────────────────────────────────────

// Chỉ áp dụng khi forSigning=true (PDF dùng để ký số, nhúng thẳng vào file
// signing-documents giới hạn 20MB) — bản "In biên bản" thường giữ nguyên ảnh gốc đầy đủ
// chi tiết, không đụng tới. Ảnh hiện trường tải thẳng từ điện thoại (chưa từng qua bước
// nén nào) là nguồn chính gây phình file — đo thật xác nhận 1 hồ sơ chưa ai ký đã sẵn
// >20MB, trong khi ảnh chữ ký chỉ 47-99KB (không đáng kể). Nén bằng <canvas> trình duyệt
// (fetchImageForPdf chạy client-side, dùng chung logic build PDF của "In biên bản") —
// không cần thư viện ảnh server-side nào.
const SIGNING_IMAGE_MAX_DIM = 1200
const SIGNING_IMAGE_JPEG_QUALITY = 0.72

function drawImageContain(doc: jsPDF, img: PdfImage, boxX: number, boxY: number, boxW: number, boxH: number) {
  const boxRatio = boxW / boxH
  const imgRatio = img.width / img.height
  let drawW = boxW
  let drawH = boxH
  if (imgRatio > boxRatio) {
    drawW = boxW
    drawH = boxW / imgRatio
  } else {
    drawH = boxH
    drawW = boxH * imgRatio
  }
  const dx = boxX + (boxW - drawW) / 2
  const dy = boxY + (boxH - drawH) / 2
  doc.addImage(img.dataUrl, img.format, dx, dy, drawW, drawH)
}

async function collectAndFetchImages(urls: string[], forSigning = false): Promise<Map<string, PdfImageResult>> {
  const unique = Array.from(new Set(urls.filter(Boolean)))
  const entries = await Promise.all(
    unique.map(async (u) => [
      u,
      await fetchImageForPdf(u, forSigning ? { maxDimension: SIGNING_IMAGE_MAX_DIM, jpegQuality: SIGNING_IMAGE_JPEG_QUALITY } : undefined),
    ] as const),
  )
  return new Map(entries)
}

async function drawPhotoSection(
  doc: jsPDF,
  y: number,
  groupLabel: string | null,
  imgUrls: string[],
  photoMap: Map<string, PdfImageResult>,
): Promise<number> {
  if (imgUrls.length === 0) return y
  if (groupLabel) y = drawGroupHeaderBar(doc, y + 2, groupLabel)
  const gap = 3
  const cols = 2
  const cellW = (CONTENT_W - gap * (cols - 1)) / cols
  const cellH = (cellW * 3) / 4
  for (let i = 0; i < imgUrls.length; i += cols) {
    y = ensureSpace(doc, y, cellH + 2)
    for (let c = 0; c < cols; c++) {
      const idx = i + c
      if (idx >= imgUrls.length) break
      const url = imgUrls[idx]
      const x = MARGIN + c * (cellW + gap)
      doc.setDrawColor(...BORDER)
      doc.rect(x, y, cellW, cellH)
      const img = photoMap.get(url)
      if (img && !isPdfImageFailure(img)) {
        drawImageContain(doc, img, x, y, cellW, cellH)
      } else {
        // In đúng lý do thất bại (HEIC không giải mã được / lỗi mạng / tệp hỏng) thay vì một
        // câu chung chung — nhìn PDF là biết ngay nguyên nhân, không phải dò lại từ đầu.
        doc.setFont(PDF_FONT_NAME, "normal")
        doc.setFontSize(7)
        doc.setTextColor(...GRAY)
        doc.text(isPdfImageFailure(img) ? img.reason : "Không tải được ảnh", x + cellW / 2, y + cellH / 2, { align: "center" })
      }
    }
    y += cellH + gap
  }
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text(`${imgUrls.length} hình ảnh`, PAGE_W - MARGIN, y + 3, { align: "right" })
  doc.setTextColor(...INK)
  return y + 6
}

async function drawPhotoPage(doc: jsPDF, record: RecordData, forSigning = false): Promise<void> {
  const linesWithImages = record.lines.filter((l) => (l.image_urls || []).some(Boolean))
  if (linesWithImages.length === 0) return
  const allUrls = linesWithImages.flatMap((l) => (l.image_urls || []).filter(Boolean))
  const photoMap = await collectAndFetchImages(allUrls, forSigning)
  let y = drawCompanyHeader(doc, MARGIN, record.bo_phan)
  y = drawCenteredTitleBlock(doc, y + 2, MARGIN, CONTENT_W, {
    title: "Hình ảnh biên bản",
    subtitle: `Số: ${record.ma_bb || "..."}`,
  })
  y += 2
  const multiDevice = linesWithImages.length > 1
  for (const line of linesWithImages) {
    const imgs = (line.image_urls || []).filter(Boolean)
    y = await drawPhotoSection(doc, y, multiDevice ? `${line.ten_tb} (${line.ma_tb})` : null, imgs, photoMap)
  }
}

async function drawPhotoPageWithCommon(doc: jsPDF, record: RecordData, forSigning = false): Promise<void> {
  const commonImgs = (record.image_urls_chung || []).filter(Boolean)
  const linesWithImages = record.lines.filter((l) => (l.image_urls || []).some(Boolean))
  if (commonImgs.length === 0 && linesWithImages.length === 0) return
  const allUrls = [...commonImgs, ...linesWithImages.flatMap((l) => (l.image_urls || []).filter(Boolean))]
  const photoMap = await collectAndFetchImages(allUrls, forSigning)
  let y = drawCompanyHeader(doc, MARGIN, record.bo_phan)
  y = drawCenteredTitleBlock(doc, y + 2, MARGIN, CONTENT_W, {
    title: "Hình ảnh bảo dưỡng",
    subtitle: `Số: ${record.ma_bb || "..."}`,
  })
  y += 2
  const multiDevice = linesWithImages.length > 1
  if (commonImgs.length > 0) y = await drawPhotoSection(doc, y, "Ảnh chung", commonImgs, photoMap)
  for (const line of linesWithImages) {
    const imgs = (line.image_urls || []).filter(Boolean)
    const label = multiDevice || commonImgs.length > 0 ? `${line.ten_tb} (${line.ma_tb})` : null
    y = await drawPhotoSection(doc, y, label, imgs, photoMap)
  }
}

function hasLineImages(record: RecordData): boolean {
  return record.lines.some((l) => (l.image_urls || []).some(Boolean))
}

function hasAnyImages(record: RecordData): boolean {
  return hasLineImages(record) || (record.image_urls_chung || []).some(Boolean)
}

// ─── "Tổ trưởng cơ điện/cơ khí" + merge nội dung ──────────────────────────

export function findToTruongCoDien(nguoiThucHien: string[], staffMap: Map<string, string>, groupKeyword = "cơ điện"): string[] {
  return nguoiThucHien.filter((name) => {
    const role = staffMap.get(name)?.toLowerCase() || ""
    return role.includes("tổ trưởng") && role.includes(groupKeyword)
  })
}

// ─── Vai trò ký số cho bundle "su_co_nho" (F13+F10+F15+Ảnh) — Giai đoạn 5 ─────────
// 4 người ký thật xuất hiện xuyên suốt bundle (không đụng "Tài xế" — theo quyết định
// đã chốt, vai trò này bị bỏ qua khỏi ký số điện tử vì dispatch_drivers không có tài
// khoản đăng nhập). Tách riêng khỏi drawF13 để dùng ở tầng API resolve người ký mà
// không cần dựng cả RecordData đầy đủ.
//
// Cập nhật 2026-09: "Tổ trưởng cơ điện"/"Tổ trưởng cơ khí" (roleId `to_co_dien`) HIỆN TẠI
// cũng không có tài khoản đăng nhập — không còn tìm người thật qua `nguoi_thuc_hien` (đã
// bỏ `findToTruongCoDien` khỏi hàm này), luôn gán "Nhân viên phụ trách" ký thay ở vị trí
// đó (cùng người, cùng tài khoản với roleId `nv_phu_trach`) — khớp đúng đoạn code tương ứng
// đã sửa trong `drawF13`. `MaintenanceSignModal` đã có sẵn cơ chế gộp theo userId nên tự
// động xử lý đúng khi 2 roleId trỏ về cùng 1 người, không cần sửa gì thêm ở đó.

export type MaintenanceSignRoleId = "bgd_phu_trach" | "nv_phu_trach" | "to_co_dien" | "tai_xe" | "giam_doc"
export type MaintenanceSigningRole = { roleId: MaintenanceSignRoleId; roleLabel: string; name: string | null }
export type MaintenanceSignBundle = "su_co_nho" | "bao_duong" | "bao_duong_xe" | "sua_chua_nho_xe"

// Alias giữ tên cũ — su-co-nho-signers/route.ts và maintenance-sign-modal.tsx vẫn import theo
// tên này; giá trị thực chất đã tổng quát hóa để dùng chung cho cả 4 bundle (Giai đoạn 5 phần 2).
export type SuCoNhoRoleId = MaintenanceSignRoleId
export type SuCoNhoSigningRole = MaintenanceSigningRole
export type SuCoNhoSigningRoleInput = Pick<RecordData, "bo_phan" | "bgd_phu_trach" | "nv_phu_trach" | "giam_doc" | "nguoi_thuc_hien">

// Thứ tự trả về khớp đúng thứ tự KÝ ĐIỆN TỬ thật (đính chính 2026-09): Nhân viên phụ trách →
// Tổ trưởng cơ điện/cơ khí (ký thay, cùng người) → BGĐ phụ trách → Giám đốc nhà máy. KHÔNG
// theo thứ tự cột in trên F13 (BGĐ|NV|Tổ cơ điện|GĐ) — thứ tự cột in giữ nguyên theo mẫu
// KHXD-QT02-F13, không liên quan tới thứ tự ký.
export function buildSuCoNhoSigningRoles(record: SuCoNhoSigningRoleInput): SuCoNhoSigningRole[] {
  const isBoDoi = record.bo_phan === "Đội xe"
  const toRoleLabel = isBoDoi ? "Tổ trưởng cơ khí" : "Tổ trưởng cơ điện"
  return [
    { roleId: "nv_phu_trach", roleLabel: "Nhân viên phụ trách", name: record.nv_phu_trach || null },
    { roleId: "to_co_dien", roleLabel: `${toRoleLabel} (ký thay bởi Nhân viên phụ trách)`, name: record.nv_phu_trach || null },
    { roleId: "bgd_phu_trach", roleLabel: "BGĐ phụ trách", name: record.bgd_phu_trach || null },
    { roleId: "giam_doc", roleLabel: "Giám đốc nhà máy", name: record.giam_doc || null },
  ]
}

export type BaoDuongSigningRoleInput = Pick<RecordData, "bgd_phu_trach" | "nv_phu_trach" | "giam_doc">

// bao_duong (Bảo dưỡng ngoài Đội xe, F03+F15+Ảnh): 3 người ký thật — Nhân viên phụ trách (gộp
// luôn vị trí "Tổ trưởng cơ điện" trên F03 — cùng lý do "không có tài khoản" như su_co_nho) →
// BGĐ phụ trách → Giám đốc nhà máy (phê duyệt cuối).
export function buildBaoDuongSigningRoles(record: BaoDuongSigningRoleInput): MaintenanceSigningRole[] {
  return [
    { roleId: "nv_phu_trach", roleLabel: "Nhân viên phụ trách", name: record.nv_phu_trach || null },
    { roleId: "to_co_dien", roleLabel: "Tổ trưởng cơ điện (ký thay bởi Nhân viên phụ trách)", name: record.nv_phu_trach || null },
    { roleId: "bgd_phu_trach", roleLabel: "BGĐ phụ trách", name: record.bgd_phu_trach || null },
    { roleId: "giam_doc", roleLabel: "Giám đốc nhà máy", name: record.giam_doc || null },
  ]
}

// bao_duong_xe (Bảo dưỡng Đội xe, F03+F15+F06+Ảnh): 3 người ký thật — Nhân viên phụ trách (gộp
// "Tổ trưởng cơ khí" trên F03 VÀ "Tài xế" trên F15BaoDuong/F06 — dispatch_drivers không có tài
// khoản đăng nhập, cùng cơ chế ký thay) → BGĐ phụ trách → Giám đốc nhà máy.
export function buildBaoDuongXeSigningRoles(record: BaoDuongSigningRoleInput): MaintenanceSigningRole[] {
  return [
    { roleId: "nv_phu_trach", roleLabel: "Nhân viên phụ trách", name: record.nv_phu_trach || null },
    { roleId: "to_co_dien", roleLabel: "Tổ trưởng cơ khí (ký thay bởi Nhân viên phụ trách)", name: record.nv_phu_trach || null },
    { roleId: "tai_xe", roleLabel: "Tài xế (ký thay bởi Nhân viên phụ trách)", name: record.nv_phu_trach || null },
    { roleId: "bgd_phu_trach", roleLabel: "BGĐ phụ trách", name: record.bgd_phu_trach || null },
    { roleId: "giam_doc", roleLabel: "Giám đốc nhà máy", name: record.giam_doc || null },
  ]
}

// sua_chua_nho_xe (Sửa chữa nhỏ Đội xe, F08+F15SmallVehicle+F06): 3 người ký thật — Nhân viên
// phụ trách (gộp "Tài xế") → BGĐ phụ trách → Giám đốc nhà máy. Bundle này không có cột "Tổ
// trưởng cơ điện/cơ khí" ở bất kỳ mẫu nào (F08/F15SmallVehicle/F06 không có vai trò đó).
export function buildSuaChuaNhoXeSigningRoles(record: BaoDuongSigningRoleInput): MaintenanceSigningRole[] {
  return [
    { roleId: "nv_phu_trach", roleLabel: "Nhân viên phụ trách", name: record.nv_phu_trach || null },
    { roleId: "tai_xe", roleLabel: "Tài xế (ký thay bởi Nhân viên phụ trách)", name: record.nv_phu_trach || null },
    { roleId: "bgd_phu_trach", roleLabel: "BGĐ phụ trách", name: record.bgd_phu_trach || null },
    { roleId: "giam_doc", roleLabel: "Giám đốc nhà máy", name: record.giam_doc || null },
  ]
}

function mergeNoidung(common: string | null | undefined, own: string | null | undefined): string {
  return [common, own].filter(Boolean).join("\n")
}

type Participant = { name: string; role: string }

function drawParticipantsNumbered(doc: jsPDF, y: number, participants: Participant[]): number {
  doc.setFontSize(BODY_SIZE)
  participants.forEach((p, i) => {
    y = ensureSpace(doc, y, LINE_H)
    const prefix = `${i + 1}- `
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setTextColor(...INK)
    doc.text(prefix, MARGIN, y)
    const prefixW = doc.getTextWidth(prefix)
    doc.setFont(PDF_FONT_NAME, "bold")
    const nameText = p.name || "................................."
    doc.text(nameText, MARGIN + prefixW, y)
    const nameW = doc.getTextWidth(nameText)
    if (p.role) {
      doc.setFont(PDF_FONT_NAME, "normal")
      doc.text(` – ${p.role}`, MARGIN + prefixW + nameW, y)
    }
    y += LINE_H
  })
  return y
}

function drawParticipantsOng(doc: jsPDF, y: number, participants: Participant[]): number {
  doc.setFontSize(BODY_SIZE)
  participants.forEach((p) => {
    y = ensureSpace(doc, y, LINE_H)
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setTextColor(...INK)
    doc.text("Ông: ", MARGIN, y)
    const w0 = doc.getTextWidth("Ông: ")
    doc.setFont(PDF_FONT_NAME, "bold")
    const nameText = p.name || "................................."
    doc.text(nameText, MARGIN + w0, y)
    const w1 = doc.getTextWidth(nameText)
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.text(` – ${p.role}`, MARGIN + w0 + w1, y)
    y += LINE_H
  })
  return y
}

function buildF13Participants(record: RecordData, staffMap: Map<string, string>): Participant[] {
  const isBoDoi = record.bo_phan === "Đội xe"
  const toGroupKeyword = isBoDoi ? "cơ khí" : "cơ điện"
  const toRoleLabel = isBoDoi ? "Tổ trưởng tổ cơ khí" : "Tổ trưởng cơ điện"
  const toTruong = findToTruongCoDien(record.nguoi_thuc_hien, staffMap, toGroupKeyword)
  const list: Participant[] = []
  if (record.giam_doc) list.push({ name: record.giam_doc, role: staffMap.get(record.giam_doc) || "Giám đốc nhà máy" })
  if (record.bgd_phu_trach) list.push({ name: record.bgd_phu_trach, role: staffMap.get(record.bgd_phu_trach) || "BGĐ phụ trách" })
  if (record.nv_phu_trach) list.push({ name: record.nv_phu_trach, role: staffMap.get(record.nv_phu_trach) || "Nhân viên phụ trách" })
  if (record.phu_trach_bao_tri && record.phu_trach_bao_tri !== record.nv_phu_trach)
    list.push({ name: record.phu_trach_bao_tri, role: staffMap.get(record.phu_trach_bao_tri) || "Phụ trách bảo trì" })
  for (const name of toTruong) list.push({ name, role: staffMap.get(name) || toRoleLabel })
  if (!record.nv_phu_trach && !record.phu_trach_bao_tri && toTruong.length === 0) list.push({ name: "", role: toRoleLabel })
  return list
}

function buildF15Participants(record: RecordData, staffMap: Map<string, string>): Participant[] {
  const list: Participant[] = []
  if (record.giam_doc) list.push({ name: record.giam_doc, role: staffMap.get(record.giam_doc) || "Giám đốc Nhà máy" })
  if (record.bgd_phu_trach) list.push({ name: record.bgd_phu_trach, role: staffMap.get(record.bgd_phu_trach) || "BGĐ phụ trách" })
  if (record.nv_phu_trach) list.push({ name: record.nv_phu_trach, role: staffMap.get(record.nv_phu_trach) || "Nhân viên phụ trách" })
  if (record.phu_trach_bao_tri && record.phu_trach_bao_tri !== record.nv_phu_trach)
    list.push({ name: record.phu_trach_bao_tri, role: staffMap.get(record.phu_trach_bao_tri) || "Phụ trách bảo trì" })
  if (!record.nv_phu_trach && !record.phu_trach_bao_tri) list.push({ name: "", role: "Tổ trưởng cơ điện" })
  return list
}

function buildF15BaoDuongParticipants(
  record: RecordData,
  staffMap: Map<string, string>,
  isBoDoi: boolean,
  firstTaiXe: string | null,
): Participant[] {
  const list: Participant[] = []
  if (record.giam_doc) list.push({ name: record.giam_doc, role: staffMap.get(record.giam_doc) || "Giám đốc Nhà máy" })
  if (record.bgd_phu_trach) list.push({ name: record.bgd_phu_trach, role: staffMap.get(record.bgd_phu_trach) || "BGĐ phụ trách" })
  if (record.nv_phu_trach) list.push({ name: record.nv_phu_trach, role: staffMap.get(record.nv_phu_trach) || "Nhân viên phụ trách" })
  if (isBoDoi && firstTaiXe) list.push({ name: firstTaiXe, role: "Lái xe" })
  if (!isBoDoi && !record.nv_phu_trach && !record.phu_trach_bao_tri) list.push({ name: "", role: "Tổ trưởng cơ điện" })
  return list
}

function buildF15SmallVehicleParticipants(record: RecordData, staffMap: Map<string, string>): Participant[] {
  const list: Participant[] = []
  if (record.giam_doc) list.push({ name: record.giam_doc, role: staffMap.get(record.giam_doc) || "Giám đốc Nhà máy" })
  if (record.bgd_phu_trach) list.push({ name: record.bgd_phu_trach, role: staffMap.get(record.bgd_phu_trach) || "BGĐ phụ trách" })
  if (record.nv_phu_trach) list.push({ name: record.nv_phu_trach, role: staffMap.get(record.nv_phu_trach) || "Nhân viên phụ trách" })
  if (record.phu_trach_bao_tri && record.phu_trach_bao_tri !== record.nv_phu_trach)
    list.push({ name: record.phu_trach_bao_tri, role: staffMap.get(record.phu_trach_bao_tri) || "Đội trưởng đội xe" })
  if (record.lines[0]?.ten_tai_xe) list.push({ name: record.lines[0].ten_tai_xe, role: "Lái xe" })
  return list
}

// ─── F13: Biên bản kiểm tra sự cố ─────────────────────────────────────────

async function drawF13(
  doc: jsPDF, record: RecordData, qrUrl: string, staffMap: Map<string, string>, forSigning: boolean,
): Promise<SignatureRoleBoxes[]> {
  const { dd, mm, yyyy } = fmtDatePartsVN(record.ngay)
  const isBoDoi = record.bo_phan === "Đội xe"
  let y = MARGIN
  y = drawCompanyHeader(doc, y, record.bo_phan)
  y += 2
  y = await drawTitleWithQr(doc, y, {
    title: "Biên bản kiểm tra sự cố",
    subtitle: `(Áp dụng cho ${isBoDoi ? "phương tiện vận tải" : "thiết bị sơ chế cao su"})`,
    soLabel: `Số: ${record.ma_bb || "..."}`,
    qrUrl,
    maBb: record.ma_bb,
  })

  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Thời gian: ", `Hôm nay vào lúc ${fmtTimeVN(record.tu_gio)} giờ, ngày ${dd} tháng ${mm} năm ${yyyy}`)
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Tại: ", record.bo_phan)
  y += 1
  y = ensureSpace(doc, y, LINE_H)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(BODY_SIZE)
  doc.setTextColor(...INK)
  doc.text("Chúng tôi gồm:", MARGIN, y)
  y += LINE_H
  y = drawParticipantsNumbered(doc, y, buildF13Participants(record, staffMap))

  record.lines.forEach((line, idx) => {
    y += 1
    if (record.lines.length > 1) y = drawGroupHeaderBar(doc, y, `${idx + 1}. ${line.ten_tb} (${line.ma_tb})`)
    const intro =
      `Tiến hành kiểm tra ${record.hang_muc === "Sửa chữa" ? "sự cố" : "bảo dưỡng"} máy ${line.ten_tb}, ` +
      `Số hiệu nhận dạng ${line.ma_tb}` +
      (isBoDoi && line.ten_tai_xe ? `, Lái xe: ${line.ten_tai_xe}` : "")
    y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "", intro)
    y = drawLabelContent(
      doc, MARGIN, y, CONTENT_W,
      `Tình trạng ${record.hang_muc === "Sửa chữa" ? "sự cố" : "thiết bị"}: `,
      line.noi_dung, { blankCount: 2 },
    )
    if (record.hang_muc === "Sửa chữa") {
      y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Nguyên nhân sự cố: ", line.nguyen_nhan, { blankCount: 2 })
    }
    y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Cách khắc phục xử lý: ", line.cac_khac_phuc, { blankCount: 2 })

    y = ensureSpace(doc, y, LINE_H)
    doc.setFont(PDF_FONT_NAME, "bold")
    doc.setFontSize(BODY_SIZE)
    doc.setTextColor(...INK)
    doc.text("Vật tư sử dụng: ", MARGIN, y)
    if (line.materials.length === 0) {
      doc.setFont(PDF_FONT_NAME, "normal")
      doc.text("Không có", MARGIN + doc.getTextWidth("Vật tư sử dụng: "), y)
      y += LINE_H
    } else {
      y += LINE_H
      y = drawMaterialsTable(doc, y, line.materials) + 3
    }
  })

  y += 1
  y = drawLabelContent(
    doc, MARGIN, y, CONTENT_W,
    "Kết luận và những kiến nghị lên Giám đốc nhà máy (đối với những trường hợp không khắc phục ngay được): ",
    record.ghi_chu, { blankCount: 3 },
  )

  const isBoDoiRole = isBoDoi ? "Tổ cơ khí" : "Tổ cơ điện"
  // Tổ trưởng cơ điện/cơ khí hiện không có tài khoản đăng nhập trong hệ thống (quyết định
  // 2026-09 — xem CLAUDE.md mục Giai đoạn 5) — không tìm người thật qua nguoi_thuc_hien nữa,
  // Nhân viên phụ trách ký thay ở cả 2 vị trí (cột riêng trên form vẫn giữ nguyên tên "Tổ cơ
  // điện"/"Tổ cơ khí" theo đúng mẫu KHXD-QT02-F13, chỉ đổi NGƯỜI điền/ký vào đó).
  //
  // `forSigning=true` (luồng Ký duyệt): KHÔNG in sẵn tên snapshot — tên sẽ được đóng dấu điện
  // tử đúng vào ô này lúc ký thật (drawTextFit trong signField()), in sẵn + đóng dấu chồng lên
  // nhau tại đúng 1 vị trí sẽ ra chữ lệch nét/mờ (bug đã báo — xem CLAUDE.md). `forSigning=false`
  // (luồng "Xuất PDF" thường) vẫn in tên như cũ để phục vụ ký tay trên giấy.
  const sig = drawSignatureRowCapture(doc, y, [
    { role: "BGĐ phụ trách", name: forSigning ? undefined : record.bgd_phu_trach, roleId: "bgd_phu_trach" },
    { role: "Nhân viên kỹ thuật", name: forSigning ? undefined : record.nv_phu_trach, roleId: "nv_phu_trach" },
    { role: isBoDoiRole, name: forSigning ? undefined : record.nv_phu_trach, roleId: "to_co_dien", note: forSigning ? "(NV phụ trách ký thay)" : undefined },
    { role: "Giám đốc nhà máy", name: forSigning ? undefined : record.giam_doc, roleId: "giam_doc" },
  ])
  y = sig.y
  drawDocumentFooter(doc, y, "KHXD-QT02-F13")
  return sig.boxes
}

// ─── F10: Giấy đề nghị sửa chữa ────────────────────────────────────────────

async function drawF10(doc: jsPDF, record: RecordData, qrUrl: string, forSigning: boolean): Promise<SignatureRoleBoxes[]> {
  const dateParts = fmtDatePartsVN(record.ngay)
  const allMaterials = record.lines.flatMap((l) => l.materials)
  const machineNames = record.lines.map((l) => `${l.ten_tb} (${l.ma_tb})`).join(", ")
  let y = MARGIN
  y = drawCompanyHeader(doc, y, record.bo_phan)
  y += 2
  y = await drawQrThenDateThenTitle(doc, y, {
    qrUrl, maBb: record.ma_bb, dateParts,
    title: "Giấy đề nghị sửa chữa",
    subtitle: "(Áp dụng cho sửa chữa thiết bị sơ chế cao su)",
    soLabel: `Số: ${record.ma_bb || "..."}`,
  })

  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Kính gửi: ", "Giám đốc Nhà máy chế biến Phước Hòa Kampong Thom")
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Đề nghị Ban Giám đốc Nhà máy chế biến cho sửa chữa: ", machineNames)
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Đính kèm biên bản số: ", record.ma_bb || "...")
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Thời gian tiến hành, từ ngày: ", `${fmtDateVN(record.ngay)} đến ngày ${fmtDateVN(record.ngay)}`)
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Thực hiện sửa chữa: ", record.nguoi_thuc_hien.join(", ") || "...")

  y += 1
  y = ensureSpace(doc, y, LINE_H)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(BODY_SIZE)
  doc.setTextColor(...INK)
  doc.text("Nội dung cụ thể cần thay thế sửa chữa:", MARGIN, y)
  y += LINE_H

  record.lines.forEach((line, idx) => {
    if (record.lines.length > 1) {
      y = ensureSpace(doc, y, LINE_H)
      doc.setFont(PDF_FONT_NAME, "bold")
      doc.text(`${idx + 1}. ${line.ten_tb} (${line.ma_tb})`, MARGIN, y)
      y += LINE_H
    }
    if (line.noi_dung) y = drawLabelContent(doc, MARGIN + 3, y, CONTENT_W - 3, "• Nội dung: ", line.noi_dung)
    if (line.nguyen_nhan) y = drawLabelContent(doc, MARGIN + 3, y, CONTENT_W - 3, "• Nguyên nhân: ", line.nguyen_nhan)
  })

  y += 1
  y = ensureSpace(doc, y, LINE_H)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.text("Vật tư thay thế: ", MARGIN, y)
  if (allMaterials.length === 0) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.text("Không có", MARGIN + doc.getTextWidth("Vật tư thay thế: "), y)
    y += LINE_H
  } else {
    y += LINE_H
    y = drawMaterialsTable(doc, y, allMaterials) + 3
  }

  record.lines.forEach((line) => {
    const prefix = record.lines.length > 1 ? `${line.ten_tb}: ` : ""
    const suffix = line.loai_sua_chua ? ` (${line.loai_sua_chua === "lon" ? "Sửa chữa lớn >200$" : "Sửa chữa nhỏ ≤200$"})` : ""
    y = drawLabelContent(doc, MARGIN, y, CONTENT_W, `${prefix}Chi phí ước tính: `, `${pdfMoney(line.chi_phi_dk, line.loai_tien)}${suffix}`)
  })

  const sig = drawSignatureRowCapture(doc, y, [
    { role: "Giám đốc nhà máy", name: forSigning ? undefined : record.giam_doc, roleId: "giam_doc" },
    { role: "Nhân viên kỹ thuật", name: forSigning ? undefined : record.nv_phu_trach, roleId: "nv_phu_trach" },
    { role: "BGĐ phụ trách", name: forSigning ? undefined : record.bgd_phu_trach, roleId: "bgd_phu_trach" },
  ])
  y = sig.y
  drawDocumentFooter(doc, y, "KHXD-QT02-F10")
  return sig.boxes
}

// ─── F15: Biên bản nghiệm thu (chuẩn, dùng cho bundle su_co_nho) ──────────

async function drawF15(
  doc: jsPDF, record: RecordData, qrUrl: string, staffMap: Map<string, string>, forSigning: boolean,
): Promise<SignatureRoleBoxes[]> {
  const { dd, mm, yyyy } = fmtDatePartsVN(record.ngay_duyet || record.ngay)
  const isChatLuongDat = record.lines.every((l) => l.chat_luong !== "Không đạt")
  const isChatLuongKhongDat = record.lines.some((l) => l.chat_luong === "Không đạt")
  let y = MARGIN
  y = drawCompanyHeader(doc, y, record.bo_phan)
  y += 2
  y = await drawTitleWithQr(doc, y, {
    title: "Biên bản nghiệm thu",
    subtitle: "(Áp dụng cho sửa chữa nhỏ, thường xuyên)",
    soLabel: `Căn cứ biên bản số: ${record.ma_bb || "..."}`,
    qrUrl,
    maBb: record.ma_bb,
  })

  record.lines.forEach((line, idx) => {
    if (record.lines.length > 1) y = drawGroupHeaderBar(doc, y, `${idx + 1}. ${line.ten_tb} (${line.ma_tb})`)
    y = drawTwoColRow(doc, y, `Xe/máy/thiết bị: ${line.ten_tb}`, `Biển số/số hiệu: ${line.ma_tb}`)
    y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Lái xe / người phụ trách: ", line.ten_tai_xe || record.nv_phu_trach || "...")
  })

  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Đơn vị quản lý, sử dụng: ", "Nhà máy chế biến Phước Hòa Kampong Thom")
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Căn cứ: ", `Giấy đề nghị sửa chữa số ${record.ma_bb || "..."}`)
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Căn cứ: ", `Biên bản kiểm tra sự cố số ${record.ma_bb || "..."}`)
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Thời gian: ", `Hôm nay, ngày ${dd} tháng ${mm} năm ${yyyy}`)
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Tại: ", record.bo_phan)

  y += 1
  y = ensureSpace(doc, y, LINE_H)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(BODY_SIZE)
  doc.setTextColor(...INK)
  doc.text("Chúng tôi gồm:", MARGIN, y)
  y += LINE_H
  y = drawParticipantsOng(doc, y, buildF15Participants(record, staffMap))

  y += 1
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "", "Cùng tiến hành kiểm tra chất lượng sửa chữa. Kết quả như sau:")

  record.lines.forEach((line, idx) => {
    const content = line.cac_khac_phuc || line.noi_dung || ".............................."
    const label = record.lines.length > 1 ? `${idx + 1}. ${line.ten_tb} — Khối lượng đã sửa chữa, thay thế phụ tùng: ` : "Khối lượng đã sửa chữa, thay thế phụ tùng: "
    y = drawLabelContent(doc, MARGIN, y, CONTENT_W, label, content)
    if (line.materials.length > 0) y = drawMaterialsTable(doc, y, line.materials) + 3
  })

  y = drawChatLuongCheckbox(doc, y, isChatLuongDat, isChatLuongKhongDat)
  y = drawGiaTriSuaChua(doc, y, record.lines, "Giá trị sửa chữa: ")
  y = drawKetLuanBlank(doc, y)

  const sig = drawSignatureRowCapture(doc, y, [
    { role: "BGĐ phụ trách", name: forSigning ? undefined : record.bgd_phu_trach, roleId: "bgd_phu_trach" },
    { role: "Nhân viên phụ trách", name: forSigning ? undefined : record.nv_phu_trach, roleId: "nv_phu_trach" },
    { role: "Giám đốc nhà máy", name: forSigning ? undefined : record.giam_doc, roleId: "giam_doc" },
  ])
  y = sig.y
  drawDocumentFooter(doc, y, "KHXD-QT02-F15")
  return sig.boxes
}

// ─── Phase 1: orchestrator "su_co_nho" (F13 + F10 + F15 + Ảnh) ────────────

/**
 * Lõi dựng file dùng chung cho cả 2 luồng — "Xuất PDF" (không cần khung ký) và "Ký duyệt"
 * (cần toạ độ khung ký từng vai trò) — mirror pattern `buildQualityKqknDoc` trong
 * quality-pdf.ts. Vẽ giống hệt nhau ở cả 2 luồng, chỉ khác caller có đọc `.boxes` hay không.
 */
async function buildMaintenanceSuCoNhoDoc(
  record: RecordData, qrUrl: string, staffMap: Map<string, string>, forSigning: boolean,
): Promise<{ doc: jsPDF; boxes: SignatureRoleBoxes[] }> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  const f13Boxes = await drawF13(doc, record, qrUrl, staffMap, forSigning)
  doc.addPage()
  const f10Boxes = await drawF10(doc, record, qrUrl, forSigning)
  doc.addPage()
  const f15Boxes = await drawF15(doc, record, qrUrl, staffMap, forSigning)
  if (hasLineImages(record)) {
    doc.addPage()
    await drawPhotoPage(doc, record, forSigning)
  }
  return { doc, boxes: [...f13Boxes, ...f10Boxes, ...f15Boxes] }
}

export async function downloadMaintenanceSuCoNhoPdf(record: RecordData, qrUrl: string, staffMap: Map<string, string>): Promise<void> {
  const { doc } = await buildMaintenanceSuCoNhoDoc(record, qrUrl, staffMap, false)
  doc.save(`bien-ban-su-co-${safeName(record.ma_bb || "bien-ban")}.pdf`)
}

export type MaintenanceSigningResult = {
  bytes: Uint8Array
  pageHeightMm: number
  boxesByRole: Partial<Record<MaintenanceSignRoleId, SignatureRoleBoxes[]>>
}

// Alias giữ tên cũ — dùng chung cho cả 4 bundle từ Giai đoạn 5 phần 2.
export type MaintenanceSuCoNhoSigningResult = MaintenanceSigningResult

// Gộp danh sách box theo roleId — dùng chung cho cả 4 hàm "buildXxxPdfForSigning" bên dưới,
// tránh lặp lại y hệt vòng lặp này 4 lần.
function finalizeSigningResult(doc: jsPDF, boxes: SignatureRoleBoxes[]): MaintenanceSigningResult {
  const bytes = doc.output("arraybuffer") as ArrayBuffer
  const boxesByRole: Partial<Record<MaintenanceSignRoleId, SignatureRoleBoxes[]>> = {}
  for (const b of boxes) {
    const roleId = b.roleId as MaintenanceSignRoleId
    if (!boxesByRole[roleId]) boxesByRole[roleId] = []
    boxesByRole[roleId]!.push(b)
  }
  return { bytes: new Uint8Array(bytes), pageHeightMm: PAGE_H, boxesByRole }
}

/**
 * Dựng PDF trả về bytes + toạ độ khung ký theo từng vai trò (mm, gốc trên-trái) — dùng cho
 * nút "Ký duyệt" ở trang chi tiết biên bản. Không tự tải file — caller upload lên hệ thống
 * ký số dùng chung rồi điều hướng sang /dashboard/ky/[id].
 */
export async function buildMaintenanceSuCoNhoPdfForSigning(
  record: RecordData, qrUrl: string, staffMap: Map<string, string>,
): Promise<MaintenanceSigningResult> {
  const { doc, boxes } = await buildMaintenanceSuCoNhoDoc(record, qrUrl, staffMap, true)
  return finalizeSigningResult(doc, boxes)
}

// ─── F03: Giấy đề nghị bảo trì - sửa chữa ──────────────────────────────────

async function drawF03(doc: jsPDF, record: RecordData, qrUrl: string, forSigning: boolean): Promise<SignatureRoleBoxes[]> {
  const dateParts = fmtDatePartsVN(record.ngay)
  const isBoDoi = record.bo_phan === "Đội xe"
  const toRoleLabel = isBoDoi ? "Tổ cơ khí" : "Tổ cơ điện"
  let y = MARGIN
  y = drawCompanyHeader(doc, y, record.bo_phan)
  y += 2
  y = await drawQrThenDateThenTitle(doc, y, {
    qrUrl, maBb: record.ma_bb, dateParts,
    title: "Giấy đề nghị bảo trì - sửa chữa",
    soLabel: `Số: ${record.ma_bb || "..."}`,
  })

  record.lines.forEach((line) => {
    y = drawInlineLabelPairs(doc, y, [["Mã thiết bị", line.ma_tb], ["Tên thiết bị", line.ten_tb]])
  })

  y += 1
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Kính gửi: ", "Giám đốc nhà máy chế biến.")
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "", "Kính đề nghị giám đốc nhà máy cho bảo dưỡng xe, máy móc, thiết bị như sau:")

  record.lines.forEach((line, idx) => {
    if (record.lines.length > 1) {
      y = ensureSpace(doc, y, LINE_H)
      doc.setFont(PDF_FONT_NAME, "bold")
      doc.setFontSize(BODY_SIZE)
      doc.setTextColor(...INK)
      doc.text(`${idx + 1}. ${line.ten_tb} (${line.ma_tb})`, MARGIN, y)
      y += LINE_H
    }
    y = drawLabelContent(doc, MARGIN + 3, y, CONTENT_W - 3, "1/ Nội dung bảo dưỡng: ", mergeNoidung(record.noi_dung_chung, line.noi_dung), { blankCount: 3 })
    y = drawLabelContent(doc, MARGIN + 3, y, CONTENT_W - 3, "2/ Lý do bảo dưỡng: ", mergeNoidung(record.nguyen_nhan_chung, line.nguyen_nhan), { blankCount: 3 })
  })

  // Cột "Tổ cơ điện"/"Tổ cơ khí" dùng tên Nhân viên phụ trách ở cả 2 luồng (in thường lẫn ký
  // duyệt) — mirror đúng quyết định đã áp dụng cho F13's cột tương tự (xem buildSuCoNhoSigningRoles
  // phía trên): vai trò này thực chất không có tài khoản/người thật đáng tin cậy riêng, nên hiển
  // thị đúng người sẽ thực sự ký thay ngay cả ở bản in thường, tránh lệch giữa bản in và bản ký.
  const sig = drawSignatureRowCapture(doc, y, [
    { role: "BGĐ phụ trách", name: forSigning ? undefined : record.bgd_phu_trach, roleId: "bgd_phu_trach" },
    { role: "Nhân viên phụ trách", name: forSigning ? undefined : record.nv_phu_trach, roleId: "nv_phu_trach" },
    { role: "Giám đốc nhà máy", name: forSigning ? undefined : record.giam_doc, roleId: "giam_doc" },
    { role: toRoleLabel, name: forSigning ? undefined : record.nv_phu_trach, roleId: "to_co_dien", note: forSigning ? "(NV phụ trách ký thay)" : undefined },
  ])
  drawDocumentFooter(doc, sig.y, "KHXD-QT02-F03")
  return sig.boxes
}

// ─── F15BaoDuong: biến thể Biên bản nghiệm thu cho Bảo dưỡng ──────────────

async function drawF15BaoDuong(
  doc: jsPDF, record: RecordData, qrUrl: string, staffMap: Map<string, string>, forSigning: boolean,
): Promise<SignatureRoleBoxes[]> {
  const { dd, mm, yyyy } = fmtDatePartsVN(record.ngay_duyet || record.ngay)
  const isBoDoi = record.bo_phan === "Đội xe"
  const firstTaiXe = isBoDoi ? record.lines[0]?.ten_tai_xe || null : null
  const isChatLuongDat = record.lines.every((l) => l.chat_luong !== "Không đạt")
  const isChatLuongKhongDat = record.lines.some((l) => l.chat_luong === "Không đạt")
  let y = MARGIN
  y = drawCompanyHeader(doc, y, record.bo_phan)
  y += 2
  y = await drawTitleWithQr(doc, y, {
    title: "Biên bản nghiệm thu",
    subtitle: "(Áp dụng cho bảo dưỡng định kỳ)",
    soLabel: `Căn cứ biên bản số: ${record.ma_bb || "..."}`,
    qrUrl,
    maBb: record.ma_bb,
  })

  record.lines.forEach((line, idx) => {
    if (record.lines.length > 1) y = drawGroupHeaderBar(doc, y, `${idx + 1}. ${line.ten_tb} (${line.ma_tb})`)
    y = drawTwoColRow(doc, y, `Xe/máy/thiết bị: ${line.ten_tb}`, `Biển số/số hiệu: ${line.ma_tb}`)
    if (isBoDoi) y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Lái xe: ", line.ten_tai_xe || "...")
  })

  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Đơn vị quản lý, sử dụng: ", "Nhà máy chế biến Phước Hòa Kampong Thom")
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Căn cứ: ", `Giấy đề nghị bảo trì số ${record.ma_bb || "..."}`)
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Thời gian: ", `Hôm nay, ngày ${dd} tháng ${mm} năm ${yyyy}`)
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Tại: ", record.bo_phan)

  y += 1
  y = ensureSpace(doc, y, LINE_H)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(BODY_SIZE)
  doc.setTextColor(...INK)
  doc.text("Chúng tôi gồm:", MARGIN, y)
  y += LINE_H
  y = drawParticipantsOng(doc, y, buildF15BaoDuongParticipants(record, staffMap, isBoDoi, firstTaiXe))

  y += 1
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "", "Cùng tiến hành kiểm tra chất lượng bảo dưỡng. Kết quả như sau:")

  record.lines.forEach((line, idx) => {
    const content =
      mergeNoidung(record.cac_khac_phuc_chung, line.cac_khac_phuc) ||
      mergeNoidung(record.noi_dung_chung, line.noi_dung) ||
      ".............................."
    const label = record.lines.length > 1 ? `${idx + 1}. ${line.ten_tb} — Khối lượng đã bảo dưỡng, thay thế phụ tùng: ` : "Khối lượng đã bảo dưỡng, thay thế phụ tùng: "
    y = drawLabelContent(doc, MARGIN, y, CONTENT_W, label, content)
    if (line.materials.length > 0) y = drawMaterialsTable(doc, y, line.materials) + 3
  })

  y = drawChatLuongCheckbox(doc, y, isChatLuongDat, isChatLuongKhongDat)
  y = drawKetLuanBlank(doc, y)

  // Cột "Tài xế" (chỉ Đội xe): bản in thường vẫn hiện đúng tên tài xế thật (`firstTaiXe`) để
  // giữ đúng thông tin nghiệp vụ trên giấy — khác cột "Tổ cơ điện" ở F03 (thường không có người
  // thật đáng tin cậy). Khi ký duyệt (forSigning=true), bỏ trống để Nhân viên phụ trách ký thay
  // đúng vào vị trí đó (roleId "tai_xe" vẫn được gán để nhận toạ độ khung ký).
  const sig = drawSignatureRowCapture(
    doc, y,
    isBoDoi
      ? [
          { role: "BGĐ phụ trách", name: forSigning ? undefined : record.bgd_phu_trach, roleId: "bgd_phu_trach" },
          { role: "Nhân viên phụ trách", name: forSigning ? undefined : record.nv_phu_trach, roleId: "nv_phu_trach" },
          { role: "Tài xế", name: forSigning ? undefined : firstTaiXe, roleId: "tai_xe", note: forSigning ? "(NV phụ trách ký thay)" : undefined },
          { role: "Giám đốc nhà máy", name: forSigning ? undefined : record.giam_doc, roleId: "giam_doc" },
        ]
      : [
          { role: "BGĐ phụ trách", name: forSigning ? undefined : record.bgd_phu_trach, roleId: "bgd_phu_trach" },
          { role: "Nhân viên phụ trách", name: forSigning ? undefined : record.nv_phu_trach, roleId: "nv_phu_trach" },
          { role: "Giám đốc nhà máy", name: forSigning ? undefined : record.giam_doc, roleId: "giam_doc" },
        ],
  )
  drawDocumentFooter(doc, sig.y, "KHXD-QT02-F15")
  return sig.boxes
}

// ─── F06: Phiếu hoàn thành công việc bảo trì (xe) ──────────────────────────

type F06Row = { stt: number; hang_muc: string; dvt: string; so_luong: string | number; thanh_tien: string; ghi_chu: string }

function buildF06Rows(line: LineData): { rows: F06Row[]; grandTotal: number } {
  const rows: F06Row[] = []
  let rowIdx = 1
  rows.push({
    stt: rowIdx++,
    hang_muc: line.nhien_lieu_su_dung ? `Nhiên liệu bảo dưỡng: ${line.nhien_lieu_su_dung}` : "Nhiên liệu bảo dưỡng",
    dvt: line.dvt_do || "",
    so_luong: line.so_luong_do ?? "",
    thanh_tien: "",
    ghi_chu: "",
  })
  for (const mat of line.materials) {
    rows.push({
      stt: rowIdx++,
      hang_muc: mat.ten_vat_tu,
      dvt: mat.dvt || "",
      so_luong: mat.so_luong,
      thanh_tien: mat.thanh_tien ? pdfMoney(mat.thanh_tien, mat.loai_tien || "USD") : "",
      ghi_chu: mat.nguon === "ben_ngoai" ? "Mua ngoài" : "Kho",
    })
  }
  rows.push({
    stt: rowIdx++,
    hang_muc: "Công thợ",
    dvt: "",
    so_luong: "",
    thanh_tien: line.cong_tho > 0 ? pdfMoney(line.cong_tho, line.loai_tien) : "",
    ghi_chu: "",
  })
  const matTotal = line.materials.reduce((s, m) => s + (m.thanh_tien || 0), 0)
  return { rows, grandTotal: matTotal + (line.cong_tho || 0) }
}

async function drawF06(doc: jsPDF, record: RecordData, qrUrl: string, forSigning: boolean): Promise<SignatureRoleBoxes[]> {
  const dateParts = fmtDatePartsVN(record.ngay)
  let y = MARGIN
  y = drawCompanyHeader(doc, y, record.bo_phan)
  y += 2
  y = await drawQrThenDateThenTitle(doc, y, {
    qrUrl, maBb: record.ma_bb, dateParts,
    title: "Phiếu hoàn thành công việc bảo trì",
    subtitle: "(Áp dụng cho xe ôtô vận chuyển mủ)",
    soLabel: `Số: ${record.ma_bb || "..."}`,
  })

  record.lines.forEach((line, idx) => {
    if (record.lines.length > 1) y = drawGroupHeaderBar(doc, y, `${idx + 1}. ${line.ten_tb} (${line.ma_tb})`)
    y = drawTwoColRow(doc, y, `Biển số: ${line.ma_tb}`, `Tên lái xe: ${line.ten_tai_xe || "..."}`)
    y = drawLabelContent(
      doc, MARGIN, y, CONTENT_W, "Căn cứ: ",
      `Giấy đề nghị bảo trì số ${record.ma_bb || "..."}, ngày ${dateParts.dd} tháng ${dateParts.mm} năm ${dateParts.yyyy}`,
    )
    y += 1
    y = ensureSpace(doc, y, LINE_H)
    doc.setFont(PDF_FONT_NAME, "bold")
    doc.setFontSize(BODY_SIZE)
    doc.setTextColor(...INK)
    doc.text("Kết quả bảo dưỡng bao gồm:", MARGIN, y)
    y += LINE_H

    const { rows, grandTotal } = buildF06Rows(line)
    const head = ["STT", "Hạng mục công việc đã thực hiện", "ĐVT", "Số lượng", "Thành tiền", "Ghi chú"]
    const body = rows.map((r) => [String(r.stt), r.hang_muc, r.dvt, String(r.so_luong), r.thanh_tien, r.ghi_chu])
    body.push(["", "Cộng:", "", "", grandTotal > 0 ? pdfMoney(grandTotal, line.loai_tien) : "", ""])
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [head],
      body,
      styles: { font: PDF_FONT_NAME, fontSize: 7.5, cellPadding: 1.2, textColor: INK, lineColor: BORDER, lineWidth: 0.1 },
      headStyles: { fillColor: HEADER_BAR_BG, textColor: [15, 23, 42], fontStyle: "bold" },
      theme: "grid",
      didParseCell: (data) => {
        if (data.section === "body" && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = "bold"
          data.cell.styles.fillColor = HEADER_BAR_BG
        }
      },
    })
    y = ((doc as PdfWithTable).lastAutoTable?.finalY ?? y) + 4
  })

  const sig = drawSignatureRowCapture(doc, y, [
    { role: "BGĐ phụ trách", name: forSigning ? undefined : record.bgd_phu_trach, roleId: "bgd_phu_trach" },
    { role: "Nhân viên phụ trách", name: forSigning ? undefined : record.nv_phu_trach, roleId: "nv_phu_trach" },
    { role: "Tài xế", name: forSigning ? undefined : (record.lines[0]?.ten_tai_xe || null), roleId: "tai_xe", note: forSigning ? "(NV phụ trách ký thay)" : undefined },
    { role: "Giám đốc nhà máy", name: forSigning ? undefined : record.giam_doc, roleId: "giam_doc" },
  ])
  drawDocumentFooter(doc, sig.y, "KHXD-QT02-F06")
  return sig.boxes
}

// ─── Phase 2: orchestrators "bao_duong" / "bao_duong_xe" ──────────────────

/**
 * Lõi dựng file dùng chung cho "Xuất PDF" và "Ký duyệt" — mirror
 * `buildMaintenanceSuCoNhoDoc`. F03 và F15BaoDuong đều capture box theo roleId; ảnh (nếu có)
 * luôn ở trang cuối, không có toạ độ ký (không cần — không có vai trò nào ký trên trang ảnh).
 */
async function buildMaintenanceBaoDuongDoc(
  record: RecordData, qrUrl: string, staffMap: Map<string, string>, forSigning: boolean,
): Promise<{ doc: jsPDF; boxes: SignatureRoleBoxes[] }> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  const f03Boxes = await drawF03(doc, record, qrUrl, forSigning)
  doc.addPage()
  const f15Boxes = await drawF15BaoDuong(doc, record, qrUrl, staffMap, forSigning)
  if (hasAnyImages(record)) {
    doc.addPage()
    await drawPhotoPageWithCommon(doc, record, forSigning)
  }
  return { doc, boxes: [...f03Boxes, ...f15Boxes] }
}

export async function downloadMaintenanceBaoDuongPdf(record: RecordData, qrUrl: string, staffMap: Map<string, string>): Promise<void> {
  const { doc } = await buildMaintenanceBaoDuongDoc(record, qrUrl, staffMap, false)
  doc.save(`bao-duong-${safeName(record.ma_bb || "bien-ban")}.pdf`)
}

/**
 * Dựng PDF trả về bytes + toạ độ khung ký theo từng vai trò — dùng cho nút "Ký duyệt" ở trang
 * chi tiết biên bản Bảo dưỡng (ngoài Đội xe). Không tự tải file.
 */
export async function buildMaintenanceBaoDuongPdfForSigning(
  record: RecordData, qrUrl: string, staffMap: Map<string, string>,
): Promise<MaintenanceSigningResult> {
  const { doc, boxes } = await buildMaintenanceBaoDuongDoc(record, qrUrl, staffMap, true)
  return finalizeSigningResult(doc, boxes)
}

async function buildMaintenanceBaoDuongXeDoc(
  record: RecordData, qrUrl: string, staffMap: Map<string, string>, forSigning: boolean,
): Promise<{ doc: jsPDF; boxes: SignatureRoleBoxes[] }> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  const f03Boxes = await drawF03(doc, record, qrUrl, forSigning)
  doc.addPage()
  const f15Boxes = await drawF15BaoDuong(doc, record, qrUrl, staffMap, forSigning)
  doc.addPage()
  const f06Boxes = await drawF06(doc, record, qrUrl, forSigning)
  if (hasAnyImages(record)) {
    doc.addPage()
    await drawPhotoPageWithCommon(doc, record, forSigning)
  }
  return { doc, boxes: [...f03Boxes, ...f15Boxes, ...f06Boxes] }
}

export async function downloadMaintenanceBaoDuongXePdf(record: RecordData, qrUrl: string, staffMap: Map<string, string>): Promise<void> {
  const { doc } = await buildMaintenanceBaoDuongXeDoc(record, qrUrl, staffMap, false)
  doc.save(`bao-duong-xe-${safeName(record.ma_bb || "bien-ban")}.pdf`)
}

/**
 * Dựng PDF trả về bytes + toạ độ khung ký theo từng vai trò — dùng cho nút "Ký duyệt" ở trang
 * chi tiết biên bản Bảo dưỡng Đội xe. Không tự tải file.
 */
export async function buildMaintenanceBaoDuongXePdfForSigning(
  record: RecordData, qrUrl: string, staffMap: Map<string, string>,
): Promise<MaintenanceSigningResult> {
  const { doc, boxes } = await buildMaintenanceBaoDuongXeDoc(record, qrUrl, staffMap, true)
  return finalizeSigningResult(doc, boxes)
}

// ─── F08NB: Giấy đề nghị sửa chữa nhỏ thường xuyên ────────────────────────

async function drawF08NB(doc: jsPDF, record: RecordData, qrUrl: string, forSigning: boolean): Promise<SignatureRoleBoxes[]> {
  const dateParts = fmtDatePartsVN(record.ngay)
  let y = MARGIN
  y = drawCompanyHeader(doc, y, record.bo_phan)
  y += 2
  y = await drawQrThenDateThenTitle(doc, y, {
    qrUrl, maBb: record.ma_bb, dateParts,
    title: "Giấy đề nghị sửa chữa nhỏ thường xuyên",
    subtitle: "(Áp dụng cho sửa chữa nhỏ, thường xuyên)",
    soLabel: `Số: ${record.ma_bb || "..."}`,
  })

  record.lines.forEach((line, idx) => {
    if (record.lines.length > 1) {
      y = ensureSpace(doc, y, LINE_H)
      doc.setFont(PDF_FONT_NAME, "bold")
      doc.setFontSize(BODY_SIZE)
      doc.setTextColor(...INK)
      doc.text(`${idx + 1}. ${line.ten_tb} (${line.ma_tb})`, MARGIN, y)
      y += LINE_H
    }
    y = drawInlineLabelPairs(doc, y, [
      ["Xe/thiết bị", line.ten_tb],
      ["Biển số/Số hiệu", line.ma_tb],
    ])
    y = drawInlineLabelPairs(doc, y, [
      ["Chỉ số đồng hồ Km/giờ", line.km_dong_ho != null ? line.km_dong_ho.toLocaleString() : "......"],
      ["Họ tên lái xe", line.ten_tai_xe || "......"],
    ])
    y = drawLabelContent(doc, MARGIN + 3, y, CONTENT_W - 3, "1/ Mức độ hư hỏng: ", line.noi_dung, { blankCount: 2 })
    y = drawLabelContent(doc, MARGIN + 3, y, CONTENT_W - 3, "2/ Lý do hư hỏng: ", line.nguyen_nhan, { blankCount: 2 })
    y = drawLabelContent(doc, MARGIN + 3, y, CONTENT_W - 3, "3/ Hướng sửa chữa + tạm tính: ", line.cac_khac_phuc, { blankCount: 2 })
  })

  const sig = drawSignatureRowCapture(doc, y, [
    { role: "Giám đốc NM", name: forSigning ? undefined : record.giam_doc, roleId: "giam_doc" },
    { role: "Nhân viên phụ trách", name: forSigning ? undefined : record.nv_phu_trach, roleId: "nv_phu_trach" },
    { role: "Tài xế", name: forSigning ? undefined : (record.lines[0]?.ten_tai_xe || null), roleId: "tai_xe", note: forSigning ? "(NV phụ trách ký thay)" : undefined },
  ])
  drawDocumentFooter(doc, sig.y, "KHXD-QT02-F08")
  return sig.boxes
}

// ─── F15SmallVehicle: biến thể Biên bản nghiệm thu cho Sửa chữa nhỏ xe ────

async function drawF15SmallVehicle(
  doc: jsPDF, record: RecordData, qrUrl: string, staffMap: Map<string, string>, forSigning: boolean,
): Promise<SignatureRoleBoxes[]> {
  const { dd, mm, yyyy } = fmtDatePartsVN(record.ngay_duyet || record.ngay)
  let y = MARGIN
  y = drawCompanyHeader(doc, y, record.bo_phan)
  y += 2
  y = await drawTitleWithQr(doc, y, {
    title: "Biên bản nghiệm thu",
    subtitle: "(Áp dụng cho sửa chữa nhỏ, thường xuyên)",
    soLabel: `Căn cứ biên bản số: ${record.ma_bb || "..."}`,
    qrUrl,
    maBb: record.ma_bb,
  })

  record.lines.forEach((line, idx) => {
    if (record.lines.length > 1) y = drawGroupHeaderBar(doc, y, `${idx + 1}. ${line.ten_tb} (${line.ma_tb})`)
    y = drawTwoColRow(doc, y, `Xe/máy/thiết bị: ${line.ten_tb}`, `Biển số/số hiệu: ${line.ma_tb}`)
    y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Tài xế: ", line.ten_tai_xe || "...")
  })

  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Đơn vị quản lý, sử dụng: ", "Nhà máy chế biến Phước Hòa Kampong Thom")
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Căn cứ: ", `Giấy đề nghị sửa chữa số ${record.ma_bb || "..."}`)
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Thời gian: ", `Hôm nay, ngày ${dd} tháng ${mm} năm ${yyyy}`)
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "Tại: ", record.bo_phan)

  y += 1
  y = ensureSpace(doc, y, LINE_H)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(BODY_SIZE)
  doc.setTextColor(...INK)
  doc.text("Chúng tôi gồm:", MARGIN, y)
  y += LINE_H
  y = drawParticipantsOng(doc, y, buildF15SmallVehicleParticipants(record, staffMap))

  y += 1
  y = drawLabelContent(doc, MARGIN, y, CONTENT_W, "", "Cùng tiến hành nghiệm thu kết quả sửa chữa. Kết quả như sau:")

  record.lines.forEach((line, idx) => {
    const content = line.cac_khac_phuc || line.noi_dung || ".............................."
    const label = record.lines.length > 1 ? `${idx + 1}. ${line.ten_tb} — Khối lượng đã sửa chữa, thay thế phụ tùng: ` : "Khối lượng đã sửa chữa, thay thế phụ tùng: "
    y = drawLabelContent(doc, MARGIN, y, CONTENT_W, label, content)
    if (line.materials.length > 0) y = drawMaterialsTable(doc, y, line.materials) + 3
  })

  y = ensureSpace(doc, y, LINE_H)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(BODY_SIZE)
  doc.setTextColor(...INK)
  doc.text("Chất lượng: ", MARGIN, y)
  let cx = MARGIN + doc.getTextWidth("Chất lượng: ")
  doc.setFont(PDF_FONT_NAME, "normal")
  record.lines.forEach((line, idx) => {
    const seg = `${record.lines.length > 1 ? `${line.ten_tb}: ` : ""}${line.chat_luong || "......"}${idx < record.lines.length - 1 ? " / " : ""}`
    doc.text(seg, cx, y)
    cx += doc.getTextWidth(seg)
  })
  y += LINE_H

  y = drawGiaTriSuaChua(doc, y, record.lines, "Giá trị sửa chữa: ")
  y = drawKetLuanBlank(doc, y)

  const sig = drawSignatureRowCapture(doc, y, [
    { role: "BGĐ phụ trách", name: forSigning ? undefined : record.bgd_phu_trach, roleId: "bgd_phu_trach" },
    { role: "NV phụ trách", name: forSigning ? undefined : record.nv_phu_trach, roleId: "nv_phu_trach" },
    { role: "Tài xế", name: forSigning ? undefined : (record.lines[0]?.ten_tai_xe || null), roleId: "tai_xe", note: forSigning ? "(NV phụ trách ký thay)" : undefined },
    { role: "Giám đốc nhà máy", name: forSigning ? undefined : record.giam_doc, roleId: "giam_doc" },
  ])
  drawDocumentFooter(doc, sig.y, "KHXD-QT02-F15")
  return sig.boxes
}

// ─── Phase 3: orchestrator "sua_chua_nho_xe" (F08 + F15SmallVehicle + F06 + Ảnh) ─

async function buildMaintenanceSuaChuaNhoXeDoc(
  record: RecordData, qrUrl: string, staffMap: Map<string, string>, forSigning: boolean,
): Promise<{ doc: jsPDF; boxes: SignatureRoleBoxes[] }> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  const f08Boxes = await drawF08NB(doc, record, qrUrl, forSigning)
  doc.addPage()
  const f15Boxes = await drawF15SmallVehicle(doc, record, qrUrl, staffMap, forSigning)
  doc.addPage()
  const f06Boxes = await drawF06(doc, record, qrUrl, forSigning)
  if (hasLineImages(record)) {
    doc.addPage()
    await drawPhotoPage(doc, record, forSigning)
  }
  return { doc, boxes: [...f08Boxes, ...f15Boxes, ...f06Boxes] }
}

export async function downloadMaintenanceSuaChuaNhoXePdf(record: RecordData, qrUrl: string, staffMap: Map<string, string>): Promise<void> {
  const { doc } = await buildMaintenanceSuaChuaNhoXeDoc(record, qrUrl, staffMap, false)
  doc.save(`sua-chua-nho-xe-${safeName(record.ma_bb || "bien-ban")}.pdf`)
}

/**
 * Dựng PDF trả về bytes + toạ độ khung ký theo từng vai trò — dùng cho nút "Ký duyệt" ở trang
 * chi tiết biên bản Sửa chữa nhỏ Đội xe. Không tự tải file.
 */
export async function buildMaintenanceSuaChuaNhoXePdfForSigning(
  record: RecordData, qrUrl: string, staffMap: Map<string, string>,
): Promise<MaintenanceSigningResult> {
  const { doc, boxes } = await buildMaintenanceSuaChuaNhoXeDoc(record, qrUrl, staffMap, true)
  return finalizeSigningResult(doc, boxes)
}

// ─── F01: Lý lịch máy móc / thiết bị ───────────────────────────────────────

function drawHistoryTable(doc: jsPDF, startY: number, rows: HistoryRow[]): number {
  const head = ["STT", "Thời gian", "Nội dung sửa chữa, thay thế phụ tùng", "Giá trị", "Người thực hiện", "Người theo dõi"]
  const body = rows.map((r, i) => {
    const value = r.chi_phi_dk > 0 ? pdfMoney(r.chi_phi_dk, r.loai_tien) : r.cong_tho > 0 ? pdfMoney(r.cong_tho, r.loai_tien) : "—"
    const noiDungParts = [r.noi_dung || r.hang_muc || "—"]
    if (r.cac_khac_phuc) noiDungParts.push(r.cac_khac_phuc)
    if (r.ma_bb) noiDungParts.push(`BB: ${r.ma_bb}`)
    const nguoiTheoDoi = [r.nv_phu_trach, r.phu_trach_bao_tri].filter(Boolean).join(", ") || "—"
    return [String(i + 1), fmtDateVN(r.ngay), noiDungParts.join("\n"), value, r.nguoi_thuc_hien.join(", ") || "—", nguoiTheoDoi]
  })
  if (body.length === 0) body.push(["", "", "Chưa có dữ liệu bảo trì", "", "", ""])
  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN },
    head: [head],
    body,
    styles: { font: PDF_FONT_NAME, fontSize: 7.5, cellPadding: 1.3, textColor: INK, lineColor: BORDER, lineWidth: 0.1 },
    headStyles: { fillColor: HEADER_BAR_BG, textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 8 },
      1: { halign: "center", cellWidth: 18 },
      3: { halign: "right", cellWidth: 20 },
      4: { halign: "center", cellWidth: 26 },
      5: { halign: "center", cellWidth: 26 },
    },
    theme: "grid",
  })
  return (doc as PdfWithTable).lastAutoTable?.finalY ?? startY
}

function drawF01(doc: jsPDF, rows: HistoryRow[], asset: AssetInfo | null, filterFrom: string, filterTo: string): void {
  let y = MARGIN
  y = drawCompanyHeader(doc, y, asset?.bo_phan)
  y += 2
  y = drawCenteredTitleBlock(doc, y, MARGIN, CONTENT_W, {
    title: `Lý lịch ${asset?.loai === "xe" ? "xe" : "máy móc / thiết bị"}`,
    subtitle: "(KHXD-QT02-F01)",
  })
  y += 2

  if (asset) {
    y = drawSectionHeader(doc, y, "I. Thông tin thiết bị")
    const lines: string[] = [`Tên thiết bị: ${asset.ten_tb}`, `Mã thiết bị: ${asset.ma_tb}`, `Bộ phận: ${asset.bo_phan}`]
    if (asset.loai === "xe" && asset.bien_so) lines.push(`Biển số: ${asset.bien_so}`)
    if (asset.nam_sd) lines.push(`Năm sử dụng: ${asset.nam_sd}`)
    if (asset.mo_ta) lines.push(`Mô tả: ${asset.mo_ta}`)
    if (filterFrom || filterTo) lines.push(`Kỳ báo cáo: ${filterFrom ? fmtDateVN(filterFrom) : "Từ đầu"} – ${filterTo ? fmtDateVN(filterTo) : "nay"}`)
    y = drawFactLines(doc, y, lines) + 4
  }

  y = drawSectionHeader(doc, y, "II. Bảo trì, sửa chữa, thay thế phụ tùng")
  y = drawHistoryTable(doc, y, rows) + 3

  const sua = rows.filter((r) => r.hang_muc === "Sửa chữa").length
  const bd = rows.filter((r) => r.hang_muc === "Bảo dưỡng").length
  y = ensureSpace(doc, y, LINE_H)
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text(`Tổng: ${rows.length} lần bảo trì · Sửa chữa: ${sua} · Bảo dưỡng: ${bd}`, MARGIN, y)
  doc.setTextColor(...INK)
  y += LINE_H

  y = drawSignatureRow(doc, y, [
    { role: "Người lập" },
    { role: "Tổ cơ điện" },
    { role: "BGĐ phụ trách" },
    { role: "Giám đốc nhà máy" },
  ])
  drawDocumentFooter(doc, y, "KHXD-QT02-F01")
}

export async function downloadMaintenanceLyLichPdf(
  items: { info: AssetInfo; rows: HistoryRow[] }[],
  filterFrom: string,
  filterTo: string,
): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  items.forEach((item, idx) => {
    if (idx > 0) doc.addPage()
    drawF01(doc, item.rows, item.info, filterFrom, filterTo)
  })
  const today = new Date().toISOString().slice(0, 10)
  const label = items.length === 1 ? items[0].info.ma_tb : today
  doc.save(`ly-lich-thiet-bi-${safeName(label)}.pdf`)
}

// ─── F02: Lý lịch xe máy (3 section) ────────────────────────────────────────

function drawVehicleHistoryTable(doc: jsPDF, startY: number, rows: VehicleHistoryRow[]): number {
  const head = ["Ngày", "Km/giờ", "Nội dung", "Giá trị", "Người thực hiện", "Người theo dõi"]
  const body = rows.map((r) => {
    const noiDungParts = [r.noi_dung || "—"]
    if (r.cac_khac_phuc) noiDungParts.push(r.cac_khac_phuc)
    if (r.ma_bb) noiDungParts.push(`BB: ${r.ma_bb}`)
    return [
      fmtDateVN(r.ngay),
      r.km_dong_ho != null ? r.km_dong_ho.toLocaleString() : "—",
      noiDungParts.join("\n"),
      r.chi_phi_dk > 0 ? pdfMoney(r.chi_phi_dk, r.loai_tien) : "—",
      r.nguoi_thuc_hien.join(", ") || "—",
      r.nv_phu_trach || "—",
    ]
  })
  if (body.length === 0) body.push(["", "", "Chưa có dữ liệu", "", "", ""])
  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN },
    head: [head],
    body,
    styles: { font: PDF_FONT_NAME, fontSize: 7.5, cellPadding: 1.3, textColor: INK, lineColor: BORDER, lineWidth: 0.1 },
    headStyles: { fillColor: HEADER_BAR_BG, textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 18 },
      1: { halign: "center", cellWidth: 16 },
      3: { halign: "right", cellWidth: 18 },
      4: { halign: "center", cellWidth: 26 },
      5: { halign: "center", cellWidth: 22 },
    },
    theme: "grid",
  })
  return (doc as PdfWithTable).lastAutoTable?.finalY ?? startY
}

function drawF02(
  doc: jsPDF,
  vehicle: VehicleInfo,
  drivers: DriverAssignmentRow[],
  maintRows: VehicleHistoryRow[],
  repairRows: VehicleHistoryRow[],
  filterFrom: string,
  filterTo: string,
): void {
  let y = MARGIN
  y = drawCompanyHeader(doc, y, "Đội xe")
  y += 2
  y = drawCenteredTitleBlock(doc, y, MARGIN, CONTENT_W, { title: "Lý lịch xe máy", subtitle: "(KHXD-QT02-F02)" })
  y += 2

  y = drawSectionHeader(doc, y, "Thông tin xe")
  const infoLines: string[] = [`Mã xe: ${vehicle.code}`, `Tên xe: ${vehicle.name}`]
  if (vehicle.vehicle_type) infoLines.push(`Nhóm xe: ${vehicle.vehicle_type}`)
  if (vehicle.plate_number) infoLines.push(`Biển số: ${vehicle.plate_number}`)
  if (filterFrom || filterTo) infoLines.push(`Kỳ báo cáo: ${filterFrom ? fmtDateVN(filterFrom) : "Từ đầu"} – ${filterTo ? fmtDateVN(filterTo) : "nay"}`)
  y = drawFactLines(doc, y, infoLines) + 4

  y = drawSectionHeader(doc, y, "I. Lịch sử người vận hành")
  const driverHead = ["STT", "Họ tên", "Từ ngày", "Đến ngày", "Ghi chú"]
  const driverBody = drivers.map((d, i) => [
    String(i + 1),
    `${d.driver_name}${d.driver_code ? ` (${d.driver_code})` : ""}`,
    d.effective_from ? fmtDateVN(d.effective_from) : "—",
    d.effective_to ? fmtDateVN(d.effective_to) : "Hiện tại",
    d.note || "—",
  ])
  if (driverBody.length === 0) driverBody.push(["", "Chưa có dữ liệu", "", "", ""])
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [driverHead],
    body: driverBody,
    styles: { font: PDF_FONT_NAME, fontSize: 7.5, cellPadding: 1.3, textColor: INK, lineColor: BORDER, lineWidth: 0.1 },
    headStyles: { fillColor: HEADER_BAR_BG, textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles: { 0: { halign: "center", cellWidth: 8 }, 2: { halign: "center", cellWidth: 22 }, 3: { halign: "center", cellWidth: 22 } },
    theme: "grid",
  })
  y = ((doc as PdfWithTable).lastAutoTable?.finalY ?? y) + 5

  y = drawSectionHeader(doc, y, "II. Bảo trì - Bảo dưỡng")
  y = drawVehicleHistoryTable(doc, y, maintRows) + 5

  y = drawSectionHeader(doc, y, "III. Sửa chữa")
  y = drawVehicleHistoryTable(doc, y, repairRows) + 3

  y = drawSignatureRow(doc, y, [
    { role: "Người lập" },
    { role: "Tài xế" },
    { role: "BGĐ phụ trách" },
    { role: "Giám đốc nhà máy" },
  ])
  drawDocumentFooter(doc, y, "KHXD-QT02-F02")
}

export async function downloadMaintenanceLyLichXePdf(
  items: { vehicle: VehicleInfo; drivers: DriverAssignmentRow[]; maintRows: VehicleHistoryRow[]; repairRows: VehicleHistoryRow[] }[],
  filterFrom: string,
  filterTo: string,
): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  items.forEach((item, idx) => {
    if (idx > 0) doc.addPage()
    drawF02(doc, item.vehicle, item.drivers, item.maintRows, item.repairRows, filterFrom, filterTo)
  })
  const today = new Date().toISOString().slice(0, 10)
  const label = items.length === 1 ? items[0].vehicle.code : today
  doc.save(`ly-lich-xe-${safeName(label)}.pdf`)
}

// ─── F07: Báo cáo công tác bảo trì theo kỳ ────────────────────────────────

function drawF07(
  doc: jsPDF,
  section: BaoCaoKySection,
  from: string,
  to: string,
  rateVnd: number,
  rateKhr: number,
  lapBieuName: string,
): void {
  const totalUsd = section.rows.reduce((sum, r) => sum + convertCurrency(r.gia_tri, r.loai_tien, "USD"), 0)
  let y = MARGIN
  y = drawCompanyHeader(doc, y, section.bo_phan)
  y += 2
  y = drawCenteredTitleBlock(doc, y, MARGIN, CONTENT_W, { title: "Báo cáo công tác bảo trì", subtitle: "(KHXD-QT02-F07)" })
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  doc.text(`Kỳ: Từ ${fmtDateVN(from)} – Đến ${fmtDateVN(to)}`, PAGE_W / 2, y, { align: "center" })
  y += 6

  const head = ["STT", "Số biên bản", "Số xe/Mã TB", "Số Km/giờ hoạt động", "Ngày thực hiện", "Nội dung sửa chữa/bảo dưỡng", "Tổng giá trị", "Hạng mục"]
  const body = section.rows.map((r, i) => [
    String(i + 1),
    r.ma_bb || "—",
    r.ma_tb,
    r.km_dong_ho ?? "—",
    fmtDateVN(r.ngay),
    r.noi_dung,
    pdfMoney(r.gia_tri, r.loai_tien),
    r.hang_muc,
  ])
  if (body.length === 0) body.push(["", "", "", "", "", "Không có dữ liệu bảo trì", "", ""])
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [head],
    body,
    styles: { font: PDF_FONT_NAME, fontSize: 7, cellPadding: 1.2, textColor: INK, lineColor: BORDER, lineWidth: 0.1 },
    headStyles: { fillColor: HEADER_BAR_BG, textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 8 },
      1: { halign: "center", cellWidth: 22 },
      2: { halign: "center", cellWidth: 20 },
      3: { halign: "center", cellWidth: 18 },
      4: { halign: "center", cellWidth: 18 },
      6: { halign: "right", cellWidth: 20 },
      7: { halign: "center", cellWidth: 16 },
    },
    theme: "grid",
  })
  y = ((doc as PdfWithTable).lastAutoTable?.finalY ?? y) + 4

  y = ensureSpace(doc, y, LINE_H)
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8)
  doc.setTextColor(...INK)
  doc.text(
    `Quy đổi sang đơn giá USD 1USD=${rateVnd.toLocaleString()}VND; 1USD=${rateKhr.toLocaleString()} Riel: ${totalUsd.toFixed(2)} USD`,
    MARGIN, y,
  )
  y += LINE_H

  y = drawSignatureRow(doc, y, [{ role: "LÃNH ĐẠO ĐƠN VỊ" }, { role: "LẬP BIỂU", name: lapBieuName }])
  drawDocumentFooter(doc, y, "KHXD-QT02-F07")
}

export async function downloadMaintenanceBaoCaoKyPdf(
  sections: BaoCaoKySection[],
  from: string,
  to: string,
  rateVnd: number,
  rateKhr: number,
  lapBieuName: string,
): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  sections.forEach((sec, idx) => {
    if (idx > 0) doc.addPage()
    drawF07(doc, sec, from, to, rateVnd, rateKhr, lapBieuName)
  })
  doc.save(`bao-cao-bao-tri-${safeName(from)}-${safeName(to)}.pdf`)
}
