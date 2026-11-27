// Vẽ phiếu triển khai sản xuất F01 / F02 song ngữ Việt – Khmer (GĐ3 mục 4, rule 31). CHỈ chạy ở trình duyệt.
// jsPDF không ghép (shaping) được chữ Khmer ⇒ vẽ từng trang A4 dọc bằng Canvas 2D rồi ghép ảnh JPEG vào jsPDF.
// QR góc phải trên trang đầu → /dashboard/attendance/sheet/{id}. Chưa duyệt đủ các ca ⇒ chữ "BẢN XEM TRƯỚC", không dấu.
// Duyệt đủ ⇒ dấu "Đã duyệt" góc phải cuối trang cuối (bản cứng, mục 5).

import QRCode from "qrcode"
import { EQUIPMENT_QR_DEFAULT_ORIGIN } from "@/lib/equipment-qr"
import { drawApprovalStampCanvas } from "@/lib/pdf-approval-stamp"
import { at } from "./i18n"
import { F01_DOC_CODE, F01_TITLE_PRODUCTS, type F01JobGroup, type F01JobRow, type F01Model } from "./f01-model"

const SCALE = 2
const PAGE_W = 794
const PAGE_H = 1123
const MX = 48
const TOP = 40
const BOTTOM = 70
const CONTENT_W = PAGE_W - MX * 2
const FONT = `"Times New Roman", Times, "NotoSansKhmer", "Khmer OS", serif`
const LINE = "#1f2937"

const km = (key: string) => at("km", key)
const vi = (key: string) => at("vi", key)
const bi = (key: string) => `${km(key)}/${vi(key)}`

let khmerFontPromise: Promise<void> | null = null
function ensureKhmerFont(): Promise<void> {
  if (khmerFontPromise) return khmerFontPromise
  khmerFontPromise = (async () => {
    try {
      if (typeof FontFace === "undefined" || !document.fonts) return
      const face = new FontFace("NotoSansKhmer", "url(/fonts/NotoSansKhmer-Regular.ttf)")
      await face.load()
      document.fonts.add(face)
    } catch {
      /* thiếu font Khmer ⇒ dùng font hệ thống, không chặn */
    }
  })()
  return khmerFontPromise
}

export function buildAttendanceSheetUrl(sheetId: string) {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || EQUIPMENT_QR_DEFAULT_ORIGIN).replace(/\/+$/, "")
  return `${origin}/dashboard/attendance/sheet/${sheetId}`
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Không tạo được ảnh QR"))
    img.src = src
  })
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

class Painter {
  pages: HTMLCanvasElement[] = []
  ctx!: CanvasRenderingContext2D
  y = TOP

  constructor() {
    this.newPage()
  }

  newPage() {
    const c = document.createElement("canvas")
    c.width = PAGE_W * SCALE
    c.height = PAGE_H * SCALE
    const ctx = c.getContext("2d")
    if (!ctx) throw new Error("Trình duyệt không hỗ trợ vẽ phiếu")
    ctx.scale(SCALE, SCALE)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, PAGE_W, PAGE_H)
    ctx.textBaseline = "middle"
    this.pages.push(c)
    this.ctx = ctx
    this.y = TOP
  }

  need(h: number) {
    if (this.y + h > PAGE_H - BOTTOM) this.newPage()
  }

  font(size: number, bold = false) {
    this.ctx.font = `${bold ? "bold " : ""}${size}px ${FONT}`
  }

  text(t: string, x: number, y: number, size = 13, bold = false, color = "#000000", align: CanvasTextAlign = "left") {
    this.font(size, bold)
    this.ctx.fillStyle = color
    this.ctx.textAlign = align
    this.ctx.fillText(t, x, y)
  }

  wrap(t: string, maxW: number, size = 13, bold = false): string[] {
    this.font(size, bold)
    const clean = t.trim()
    if (!clean) return [""]
    const words = clean.split(/\s+/)
    const out: string[] = []
    let cur = ""
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w
      if (this.ctx.measureText(cand).width <= maxW || !cur) cur = cand
      else {
        out.push(cur)
        cur = w
      }
    }
    if (cur) out.push(cur)
    return out
  }

  /** Dòng nhãn 1 dòng: "nhãn: giá trị" — giá trị đậm, tự thu chữ cho vừa (không cắt). */
  labelValue(label: string, value: string, x: number, y: number, maxW: number) {
    this.font(13)
    this.ctx.fillStyle = "#000000"
    this.ctx.textAlign = "left"
    const lw = this.ctx.measureText(`${label}: `).width
    this.ctx.fillText(`${label}: `, x, y)
    const size = this.fitSize(value || "", maxW - lw, 13, 8, true)
    this.text(value || "", x + lw, y, size, true)
  }

  /** Nhãn + giá trị dài xuống nhiều dòng (Ngăn, Chỉ thị) — hiện đủ, không cắt. Trả chiều cao đã dùng. */
  labelValueBlock(label: string, value: string, x: number, top: number, maxW: number): number {
    this.font(13)
    const lw = this.ctx.measureText(`${label}: `).width
    this.text(`${label}: `, x, top + 9, 13)
    const lines = this.wrap(value || "", maxW - lw, 13, true)
    lines.forEach((l, i) => this.text(l, x + lw, top + 9 + i * 18, 13, true))
    return Math.max(1, lines.length) * 18 + 4
  }

  /** Cỡ chữ lớn nhất (≤ size, ≥ min) để `text` vừa `maxW` trên 1 dòng. */
  fitSize(text: string, maxW: number, size: number, min: number, bold = false, italic = false): number {
    let s = size
    while (s > min) {
      this.ctx.font = `${italic ? "italic " : ""}${bold ? "bold " : ""}${s}px ${FONT}`
      if (this.ctx.measureText(text).width <= maxW) break
      s -= 0.5
    }
    return s
  }
}

const COLS = [0.44, 0.44, 0.12]
const ROW_H = 24

function drawTableHeader(p: Painter) {
  const h = 40
  p.need(h + 26)
  const ws = COLS.map((c) => c * CONTENT_W)
  let x = MX
  const heads: [string, string][] = [
    [km("pCongViec"), vi("pCongViec")],
    [km("pNguoiThucHien"), vi("pNguoiThucHien")],
    [km("pXepLoai"), vi("pXepLoai")],
  ]
  p.ctx.strokeStyle = LINE
  p.ctx.lineWidth = 0.8
  heads.forEach(([k, v], i) => {
    p.ctx.strokeRect(x, p.y, ws[i], h)
    p.text(`${k}/`, x + ws[i] / 2, p.y + 12, 12, true, "#000", "center")
    p.text(v, x + ws[i] / 2, p.y + 28, 12, true, "#000", "center")
    x += ws[i]
  })
  p.y += h
}

/**
 * Mỗi việc 1 dòng, KHÔNG xuống dòng (chữ tự thu nhỏ cho vừa ô). Nhiều người trong 1 ô nối tiếp "A, B, C";
 * người thay in NGHIÊNG; xếp loại cùng thứ tự "A-A-B".
 */
function drawGroupRow(p: Painter, label: string) {
  if (p.y + ROW_H * 2 > PAGE_H - BOTTOM) {
    p.newPage()
    drawTableHeader(p)
  }
  p.ctx.fillStyle = "#eef2f7"
  p.ctx.fillRect(MX, p.y, CONTENT_W, ROW_H)
  p.ctx.strokeStyle = LINE
  p.ctx.lineWidth = 0.8
  p.ctx.strokeRect(MX, p.y, CONTENT_W, ROW_H)
  p.text(label, MX + 6, p.y + ROW_H / 2, p.fitSize(label, CONTENT_W - 12, 12, 8, true), true)
  p.y += ROW_H
}

/** A2 — khối tổ chia nhóm con (khung giờ / ca sản xuất): 1 tiêu đề bảng, mỗi nhóm 1 dòng tiêu đề nền xám. */
function drawGroupedJobTable(p: Painter, groups: F01JobGroup[]) {
  drawTableHeader(p)
  for (const g of groups) {
    if (g.label) drawGroupRow(p, g.label)
    drawJobRows(p, g.rows)
  }
}

function drawJobTable(p: Painter, rows: F01JobRow[]) {
  drawTableHeader(p)
  drawJobRows(p, rows)
}

function drawJobRows(p: Painter, rows: F01JobRow[]) {
  const ws = COLS.map((c) => c * CONTENT_W)
  if (rows.length === 0) {
    p.need(ROW_H)
    p.ctx.strokeStyle = LINE
    p.ctx.strokeRect(MX, p.y, CONTENT_W, ROW_H)
    p.text(vi("pChuaCoNguoi"), MX + CONTENT_W / 2, p.y + ROW_H / 2, 12, false, "#94a3b8", "center")
    p.y += ROW_H
    return
  }
  for (const r of rows) {
    if (p.y + ROW_H > PAGE_H - BOTTOM) {
      p.newPage()
      drawTableHeader(p)
    }
    p.ctx.strokeStyle = LINE
    p.ctx.lineWidth = 0.8
    let x = MX
    ws.forEach((w) => {
      p.ctx.strokeRect(x, p.y, w, ROW_H)
      x += w
    })
    const cy = p.y + ROW_H / 2

    // Ô công việc
    const job = r.tenKm ? `${r.tenKm}/${r.ten}` : r.ten
    p.text(job, MX + 5, cy, p.fitSize(job, ws[0] - 10, 12, 7))

    // Ô người thực hiện: cùng 1 cỡ chữ cho cả dòng; người thay in nghiêng.
    const segs = r.people.map((pp, i) => ({ t: `${pp.ten}${i < r.people.length - 1 ? ", " : ""}`, italic: !!pp.thayCho }))
    const widthAt = (s: number) =>
      segs.reduce((sum, sg) => {
        p.ctx.font = `${sg.italic ? "italic " : ""}${s}px ${FONT}`
        return sum + p.ctx.measureText(sg.t).width
      }, 0)
    let size = 12
    while (size > 7 && widthAt(size) > ws[1] - 10) size -= 0.5
    let px = MX + ws[0] + 5
    p.ctx.save()
    p.ctx.beginPath()
    p.ctx.rect(MX + ws[0] + 1, p.y + 1, ws[1] - 2, ROW_H - 2)
    p.ctx.clip()
    for (const sg of segs) {
      p.ctx.font = `${sg.italic ? "italic " : ""}${size}px ${FONT}`
      p.ctx.fillStyle = "#000000"
      p.ctx.textAlign = "left"
      p.ctx.fillText(sg.t, px, cy)
      px += p.ctx.measureText(sg.t).width
    }
    p.ctx.restore()

    // Ô xếp loại: "A-A-B" theo đúng thứ tự người.
    const xl = r.people.some((pp) => pp.xepLoai) ? r.people.map((pp) => pp.xepLoai || "–").join("-") : ""
    if (xl) p.text(xl, MX + ws[0] + ws[1] + ws[2] / 2, cy, p.fitSize(xl, ws[2] - 8, 12, 7, true), true, "#000", "center")
    p.y += ROW_H
  }
}

/** Dòng trưởng / phó; chưa phân công ⇒ để trống sau dấu ":". */
function drawPositions(p: Painter, labelTruong: string, truong: string, labelPho: string, pho: string) {
  p.need(24)
  p.labelValue(labelTruong, truong, MX, p.y + 10, CONTENT_W / 2 - 8)
  p.labelValue(labelPho, pho, MX + CONTENT_W / 2, p.y + 10, CONTENT_W / 2)
  p.y += 24
}

function drawHeading(p: Painter, text: string) {
  p.need(90)
  p.y += 8
  const lines = p.wrap(text, CONTENT_W, 14, true)
  lines.forEach((l) => {
    p.text(l, MX, p.y + 10, 14, true)
    p.y += 20
  })
}

export async function buildF01PdfBytes(model: F01Model): Promise<Uint8Array> {
  if (typeof document === "undefined") throw new Error("Chỉ dựng được phiếu trên trình duyệt")
  await ensureKhmerFont()
  const { default: JsPDF } = await import("jspdf")
  const p = new Painter()

  // ── Đầu phiếu ──
  const qrSize = 58 // giảm 20% so với 72px (người dùng yêu cầu 2026-11-24)
  const qr = await loadImage(await QRCode.toDataURL(buildAttendanceSheetUrl(model.sheetId), { width: 300, margin: 1 }))
  p.ctx.drawImage(qr, PAGE_W - MX - qrSize, TOP - 8, qrSize, qrSize)
  if (model.factoryKhmer) p.text(model.factoryKhmer, MX, p.y + 8, 13)
  p.y += model.factoryKhmer ? 20 : 0
  p.text(`NHÀ MÁY CHẾ BIẾN CAO SU ${model.factoryName.toUpperCase()}`, MX, p.y + 8, 13, true)
  p.y += 34
  const products = F01_TITLE_PRODUCTS[model.form]
  p.text(`${km("pTitle")} ${products}`, PAGE_W / 2, p.y + 8, 16, true, "#000", "center")
  p.y += 24
  p.text(`${vi("pTitle")} ${products}`, PAGE_W / 2, p.y + 8, 15, true, "#000", "center")
  p.y += 22
  if (!model.approved) {
    p.text("BẢN XEM TRƯỚC — chưa duyệt đủ các ca", PAGE_W / 2, p.y + 8, 12, true, "#dc2626", "center")
    p.y += 20
  }
  p.y += 6
  p.labelValue(bi("pNgaySx"), fmtDate(model.ngay), MX, p.y + 9, CONTENT_W * 0.36)
  p.y += p.labelValueBlock(bi("pChiThi"), model.chiThi, MX + CONTENT_W * 0.36, p.y, CONTENT_W * 0.64)
  if (model.form === "F01") {
    p.y += p.labelValueBlock(bi("pNgan"), model.ngan, MX, p.y, CONTENT_W)
  }

  // ── Mỗi Ca/Tổ đã điểm danh 1 mục (thứ tự theo danh mục Ca/Tổ) ──
  model.blocks.forEach((b, idx) => {
    const tenVi = b.ten.toUpperCase()
    drawHeading(p, b.tenKm ? `${idx + 1}. ${b.tenKm} /${tenVi}` : `${idx + 1}. ${tenVi}`)
    if (b.loai === "ca") {
      const gio = `${km("pGio")}${vi("pGio")} ${b.gioBatDau || "……"} - ${km("pGio")} ${vi("pGio")} ${b.gioKetThuc || "……"}`
      p.need(46)
      p.text(gio, MX, p.y + 9, 13)
      p.y += 22
      const csr = Array.from(new Set(b.sanXuat.map((s) => s.csr))).join(", ")
      const banh = b.sanXuat.reduce((a, s) => a + s.banh, 0)
      const loaiBanh = Array.from(new Set(b.sanXuat.map((s) => s.loaiBanh).filter((x) => x != null))).join(", ")
      const boc = Array.from(new Set(b.sanXuat.map((s) => s.boc).filter(Boolean))).join(", ")
      p.labelValue(`${km("pSanXuatCsr")}/${vi("pSanXuatCsr")}`, csr || "—", MX, p.y + 8, CONTENT_W * 0.3)
      p.labelValue(`${km("pBanh")}/${vi("pBanh")}`, banh ? `${banh.toLocaleString("vi-VN")}${loaiBanh ? ` (${loaiBanh} kg)` : ""}` : "—", MX + CONTENT_W * 0.3, p.y + 8, CONTENT_W * 0.3)
      p.labelValue(`${km("pBoc")}/${vi("pBoc")}`, boc || "—", MX + CONTENT_W * 0.6, p.y + 8, CONTENT_W * 0.4)
      p.y += 22
    }
    if (b.coViTri) {
      const [kT, kP] = b.loai === "ca" ? ["vtCaTruong", "vtCaPho"] : ["vtToTruong", "vtToPho"]
      drawPositions(p, `${km(kT)}/${vi(kT)}`, b.truong, `${km(kP)}/${vi(kP)}`, b.pho)
    }
    if (b.groups && b.groups.length > 0) drawGroupedJobTable(p, b.groups)
    else drawJobTable(p, b.rows)
    // Người vắng KHÔNG in trên phiếu (mẫu giấy không có ô này) — xem ở trang chi tiết phiếu.
  })
  if (model.blocks.length === 0) {
    p.need(24)
    p.text(vi("pChuaCoNguoi"), MX, p.y + 10, 12, false, "#94a3b8")
    p.y += 24
  }

  // ── Dấu duyệt (bản cứng) ──
  if (model.approved && model.approval) {
    p.need(40)
    drawApprovalStampCanvas(p.ctx, model.approval, PAGE_W - MX, p.y + 24, FONT)
    p.y += 40
  }

  // ── Chân trang ──
  const total = p.pages.length
  p.pages.forEach((c, i) => {
    const ctx = c.getContext("2d")
    if (!ctx) return
    ctx.save()
    ctx.textBaseline = "middle"
    ctx.font = `11px ${FONT}`
    ctx.fillStyle = "#000000"
    ctx.textAlign = "left"
    ctx.fillText(F01_DOC_CODE[model.form], MX, PAGE_H - 36)
    ctx.textAlign = "right"
    ctx.fillText(`${i + 1}/${total}`, PAGE_W - MX, PAGE_H - 36)
    ctx.restore()
  })

  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  p.pages.forEach((c, i) => {
    if (i > 0) doc.addPage("a4", "portrait")
    doc.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 210, 297)
  })
  doc.setProperties({ title: `${model.form} ${model.maPhieu}` })
  return new Uint8Array(doc.output("arraybuffer"))
}
