import jsPDF from "jspdf"
import { ensurePdfFont, addQrImage, safeName, PDF_FONT_NAME } from "@/lib/pdf-qr-shared"
import { formatDateDisplay } from "@/lib/date-utils"
import { fetchImageForPdf, isPdfImageFailure, type PdfImage } from "@/lib/image-format"

export type ExportOrderPdfVehicle = {
  id: string
  loai_xe: string
  bien_truoc: string
  bien_sau: string
  ghi_chu: string
  image_urls?: string[]
  image_url_1?: string | null
  image_url_2?: string | null
  image_url_3?: string | null
}

export type ExportOrderPdfAssignment = {
  lot_id: string
  ma_lo: string
  vehicleIdx: number
  kien_a: number
  kien_b: number
  kien_c: number
  kien_d: number
}

export type ExportOrderPdfInput = {
  ma_don: string
  ngay: string
  so_thong_bao: string
  so_hoa_don: string
  so_hop_dong: string
  chung_loai: string
  loai_pallet: string
  loai_banh: number
  loai_boc: string
  vehicles: ExportOrderPdfVehicle[]
  assignments: ExportOrderPdfAssignment[]
  tong_banh: number
  customerName?: string | null
}

const LOGO_PATH = "/logo-phk-moi.png"
const LOGO_ASPECT = 631 / 809 // width / height gốc — xem product-label-pdf.ts
const DEFAULT_FACTORY_NAME = "CÔNG TY TNHH PTCS PHƯỚC HÒA KAMPONG THOM"

const INK: [number, number, number] = [15, 23, 42]
const GRAY: [number, number, number] = [100, 116, 139]
const BLUE: [number, number, number] = [30, 64, 175]
const EMERALD: [number, number, number] = [4, 120, 87]
const PANEL_BG: [number, number, number] = [248, 250, 252]
const BORDER: [number, number, number] = [203, 213, 225]

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 15
const CONTENT_W = PAGE_W - MARGIN * 2

let logoBase64Promise: Promise<string> | null = null

async function loadLogoBase64(): Promise<string> {
  if (!logoBase64Promise) {
    logoBase64Promise = fetch(LOGO_PATH)
      .then(async (res) => {
        if (!res.ok) throw new Error("Không tải được logo.")
        const buffer = await res.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ""
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        return `data:image/png;base64,${btoa(binary)}`
      })
      .catch((error) => {
        logoBase64Promise = null
        throw error
      })
  }
  return logoBase64Promise
}

// Ảnh xe/hàng hóa/chứng từ do người dùng upload lên Supabase Storage (public bucket) — fetch
// qua network thay vì static asset local, nên phải chịu lỗi mềm: ảnh không tải được (mạng lỗi,
// CORS, file đã xóa, định dạng HEIC...) chỉ bỏ qua đúng ảnh đó kèm lý do, không được làm hỏng
// toàn bộ PDF. Việc nhận diện định dạng + chuẩn hóa nằm ở `fetchImageForPdf`
// (src/lib/image-format.ts), dùng chung với module Bảo trì.

function drawImageContain(doc: jsPDF, img: PdfImage, boxX: number, boxY: number, boxW: number, boxH: number) {
  const boxRatio = boxW / boxH
  const imgRatio = img.width / img.height
  let drawW = boxW, drawH = boxH
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

function ensureSpace(doc: jsPDF, y: number, needed: number, bottomMargin = MARGIN): number {
  if (y + needed > PAGE_H - bottomMargin) {
    doc.addPage()
    return MARGIN
  }
  return y
}

const PHOTO_CAPTIONS = ["Ảnh xe / Biển số", "Ảnh hàng hóa / Niêm phong", "Ảnh chứng từ / Phiếu cân"]

function getVehiclePhotoUrls(v: ExportOrderPdfVehicle): string[] {
  if (v.image_urls && v.image_urls.length > 0) {
    return v.image_urls.filter(Boolean)
  }
  return [v.image_url_1, v.image_url_2, v.image_url_3].filter(Boolean) as string[]
}

export async function downloadExportOrderPdf(order: ExportOrderPdfInput, factoryName?: string | null) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const logoDataUrl = await loadLogoBase64().catch(() => null)

  const photoUrls = new Set<string>()
  order.vehicles.forEach((v) => {
    getVehiclePhotoUrls(v).forEach((u) => { if (u) photoUrls.add(u) })
  })
  const photoEntries = await Promise.all(
    Array.from(photoUrls).map(async (url) => [url, await fetchImageForPdf(url)] as const),
  )
  const photoMap = new Map(photoEntries)

  let y = MARGIN

  // ── Header: logo + tên công ty + QR ──────────────────────────────────────
  const logoBoxSize = 20
  if (logoDataUrl) {
    const logoH = logoBoxSize
    const logoW = logoBoxSize * LOGO_ASPECT
    doc.addImage(logoDataUrl, "PNG", MARGIN, y, logoW, logoH)
  }
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(12)
  doc.setTextColor(...INK)
  doc.text(factoryName?.trim() || DEFAULT_FACTORY_NAME, MARGIN + logoBoxSize * LOGO_ASPECT + 4, y + 6)
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  doc.text("Nhà máy chế biến mủ cao su", MARGIN + logoBoxSize * LOGO_ASPECT + 4, y + 11)

  const qrSize = 20
  const qrOrigin = typeof window !== "undefined" ? window.location.origin : ""
  await addQrImage(doc, `${qrOrigin}/dashboard/eudr?order=${order.ma_don}`, PAGE_W - MARGIN - qrSize, y, qrSize)
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(7)
  doc.setTextColor(...INK)
  doc.text(order.ma_don, PAGE_W - MARGIN - qrSize / 2, y + qrSize + 3, { align: "center" })

  y += logoBoxSize + 4
  doc.setDrawColor(...INK)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 8

  // ── Tiêu đề ───────────────────────────────────────────────────────────────
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(14)
  doc.setTextColor(...INK)
  doc.text("BIÊN BẢN KIỂM TRA & GIAO NHẬN HÀNG HÓA", PAGE_W / 2, y, { align: "center" })
  y += 6
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  doc.text(`Ngày xuất: ${formatDateDisplay(order.ngay) || order.ngay}`, PAGE_W / 2, y, { align: "center" })
  y += 8

  // ── Thông tin chung (bảng 2 cột x 4 dòng) ───────────────────────────────────
  const infoRowH = 7
  const infoBoxH = infoRowH * 4 + 4
  doc.setFillColor(...PANEL_BG)
  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.2)
  doc.roundedRect(MARGIN, y, CONTENT_W, infoBoxH, 2, 2, "FD")

  const tanTotal = ((order.tong_banh * order.loai_banh) / 1000).toLocaleString("vi-VN")
  const infoRows: [string, string][] = [
    [`Khách hàng: ${order.customerName || "—"}`, `Mã đơn: ${order.ma_don}`],
    [`Số hóa đơn / Hợp đồng: ${order.so_hoa_don || "—"} / ${order.so_hop_dong || "—"}`, `Số thông báo: ${order.so_thong_bao || "—"}`],
    [`Chủng loại SP: ${order.chung_loai} · ${order.loai_banh}kg/bành`, `Tổng lượng: ${order.tong_banh.toLocaleString("vi-VN")} bành (${tanTotal} Tấn)`],
    [`Loại bọc: ${order.loai_boc || "—"}`, `Pallet: ${order.loai_pallet || "—"}`],
  ]
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(9)
  doc.setTextColor(...INK)
  infoRows.forEach(([left, right], i) => {
    const rowY = y + 5 + i * infoRowH
    doc.text(left, MARGIN + 4, rowY)
    doc.text(right, MARGIN + CONTENT_W / 2 + 2, rowY)
  })
  y += infoBoxH + 8

  // ── Chi tiết phương tiện & lô hàng ───────────────────────────────────────
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  doc.text("CHI TIẾT PHƯƠNG TIỆN & LÔ HÀNG", MARGIN, y)
  y += 1.5
  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 5

  for (let i = 0; i < order.vehicles.length; i++) {
    const v = order.vehicles[i]
    const assignedLots = order.assignments.filter((a) => a.vehicleIdx === i)
    const vBanh = assignedLots.reduce(
      (s, a) => s + (a.kien_a || 0) + (a.kien_b || 0) + (a.kien_c || 0) + (a.kien_d || 0),
      0,
    )
    const hasLots = assignedLots.length > 0
    const photoUrlsForVehicle = getVehiclePhotoUrls(v)
    const hasPhotos = photoUrlsForVehicle.length > 0

    const cols = 3
    const gap = 4
    const photoW = (CONTENT_W - 8 - gap * (cols - 1)) / cols
    const photoH = 32
    const numRows = hasPhotos ? Math.ceil(photoUrlsForVehicle.length / cols) : 0
    const rowStep = 6 + photoH + gap

    const headerH = 12
    const lotsH = hasLots ? 6 : 0
    const photosH = hasPhotos ? numRows * (6 + photoH) + (numRows - 1) * gap + 2 : 0
    const blockPad = 8
    const blockH = blockPad + headerH + lotsH + photosH

    y = ensureSpace(doc, y, blockH + 4)

    doc.setDrawColor(...BORDER)
    doc.setLineWidth(0.2)
    doc.roundedRect(MARGIN, y, CONTENT_W, blockH, 2, 2)

    const innerX = MARGIN + 4
    let innerY = y + 6

    doc.setFont(PDF_FONT_NAME, "bold")
    doc.setFontSize(11)
    doc.setTextColor(...BLUE)
    doc.text(`Xe ${i + 1}: ${v.bien_truoc}${v.bien_sau ? ` / ${v.bien_sau}` : ""}`, innerX, innerY)

    doc.setFont(PDF_FONT_NAME, "bold")
    doc.setFontSize(9)
    doc.setTextColor(...EMERALD)
    doc.text(`${vBanh} bành`, PAGE_W - MARGIN - 4, innerY, { align: "right" })

    innerY += 4.5
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(...GRAY)
    doc.text(`${v.loai_xe || "—"}${v.ghi_chu ? ` — ${v.ghi_chu}` : ""}`, innerX, innerY)
    doc.text(`${assignedLots.length} lô`, PAGE_W - MARGIN - 4, innerY, { align: "right" })

    innerY += headerH - 9

    if (hasLots) {
      doc.setFont(PDF_FONT_NAME, "bold")
      doc.setFontSize(8)
      doc.setTextColor(...INK)
      const label = "Các lô bốc lên xe: "
      doc.text(label, innerX, innerY)
      doc.setFont(PDF_FONT_NAME, "normal")
      doc.text(assignedLots.map((a) => a.ma_lo).join(", "), innerX + doc.getTextWidth(label), innerY)
      innerY += lotsH
    }

    if (hasPhotos) {
      innerY += 2
      photoUrlsForVehicle.forEach((url, idx) => {
        const col = idx % cols
        const row = Math.floor(idx / cols)
        const boxX = innerX + col * (photoW + gap)
        const boxY = innerY + row * rowStep

        doc.setFont(PDF_FONT_NAME, "normal")
        doc.setFontSize(6.5)
        doc.setTextColor(...GRAY)
        const caption = PHOTO_CAPTIONS[idx] || `Ảnh ${idx + 1}`
        doc.text(caption, boxX + photoW / 2, boxY, { align: "center", maxWidth: photoW })
        doc.setDrawColor(...BORDER)
        doc.rect(boxX, boxY + 1.5, photoW, photoH)
        const img = url ? photoMap.get(url) : null
        if (img && !isPdfImageFailure(img)) {
          drawImageContain(doc, img, boxX, boxY + 1.5, photoW, photoH)
        } else if (url) {
          doc.setFontSize(6.5)
          doc.setTextColor(...GRAY)
          doc.text(isPdfImageFailure(img) ? img.reason : "Không tải được ảnh", boxX + photoW / 2, boxY + 1.5 + photoH / 2, { align: "center" })
        }
      })
    }

    y += blockH + 4
  }

  // ── Chữ ký ────────────────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 40)
  y += 6
  const sigLabels = ["Đại diện Giao hàng", "Đại diện Vận chuyển", "Đại diện Nhận hàng"]
  const colW = CONTENT_W / 3
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(9)
  doc.setTextColor(...INK)
  sigLabels.forEach((label, i) => {
    const cx = MARGIN + colW * i + colW / 2
    doc.text(label, cx, y, { align: "center" })
  })
  const sigY = y + 22
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  sigLabels.forEach((_, i) => {
    const cx = MARGIN + colW * i + colW / 2
    doc.text("(Ký và ghi rõ họ tên)", cx, sigY, { align: "center" })
  })

  doc.save(`bien-ban-giao-nhan-${safeName(order.ma_don)}.pdf`)
}
