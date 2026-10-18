import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { ensurePdfFont, addQrImage, safeName, PDF_FONT_NAME } from "@/lib/pdf-qr-shared"
import { formatDateDisplay } from "@/lib/date-utils"

/**
 * Phiếu Nhập / Xuất / Chuyển kho dạng PDF thật (jsPDF) — cùng nội dung với trang in HTML
 * `/dashboard/inventory/print`, dùng cho khung xem nhúng (`DocViewer loadBytes`) ở trang chi tiết
 * và nút "Tải PDF". Khổ A5 ngang như trang in.
 */

export type InventoryDocumentPdfType = "import" | "export" | "transfer"

export type InventoryDocumentPdfWarehouse = {
  code: string
  name: string
  keeper_name?: string | null
}

export type InventoryDocumentPdfInput = {
  type: InventoryDocumentPdfType
  document_code: string
  document_date: string
  status: "draft" | "posted" | "cancelled"
  notes: string | null
  source_name: string | null
  recipient_name: string | null
  requester_name: string | null
  posted_at: string | null
  posted_by_name: string | null
  cancel_reason: string | null
  approved_by_name: string | null
  approved_at: string | null
  sourceWarehouse: InventoryDocumentPdfWarehouse | null
  targetWarehouse: InventoryDocumentPdfWarehouse | null
  lines: Array<{
    item_code: string
    item_name: string
    unit: string
    quantity: number
    lot_no: string | null
    expiry_date: string | null
    line_notes: string | null
  }>
  /** URL QR in góc phải trên (trang chi tiết phiếu). */
  qrUrl?: string | null
}

const INK: [number, number, number] = [15, 23, 42]
const GRAY: [number, number, number] = [100, 116, 139]
const BORDER: [number, number, number] = [203, 213, 225]
const PANEL_BG: [number, number, number] = [248, 250, 252]

const PAGE_W = 210
const PAGE_H = 148
const MARGIN = 10
const CONTENT_W = PAGE_W - MARGIN * 2
const QR_SIZE = 16

export function inventoryDocumentTitle(type: InventoryDocumentPdfType) {
  if (type === "import") return "Phiếu nhập kho"
  if (type === "export") return "Phiếu xuất kho"
  return "Phiếu chuyển kho"
}

function warehouseLabel(w: InventoryDocumentPdfWarehouse | null, fallback: string | null) {
  if (w) return `${w.code} - ${w.name}`
  return fallback || "—"
}

function fmtDate(value: string | null | undefined) {
  if (!value) return ""
  return formatDateDisplay(value.slice(0, 10))
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
}

async function buildInventoryDocumentDoc(input: InventoryDocumentPdfInput) {
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "landscape" })
  await ensurePdfFont(doc)
  doc.setDisplayMode("fullpage", "single")

  let y = MARGIN

  // Tiêu đề + QR góc phải trên
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY)
  doc.text("QUẢN LÝ KHO", MARGIN, y + 3)
  doc.setFontSize(14)
  doc.setTextColor(...INK)
  doc.text(inventoryDocumentTitle(input.type).toUpperCase(), MARGIN, y + 10)
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  doc.text(`Số: ${input.document_code}`, MARGIN, y + 15)

  if (input.qrUrl) {
    try {
      await addQrImage(doc, input.qrUrl, PAGE_W - MARGIN - QR_SIZE, y, QR_SIZE)
    } catch {
      // QR lỗi không chặn dựng phiếu
    }
  }
  y += QR_SIZE + 3

  // Banner trạng thái
  let banner: string | null = null
  if (input.status === "draft") banner = "Phiếu chưa ghi sổ – Giao dịch này chưa ảnh hưởng đến tồn kho."
  else if (input.status === "cancelled")
    banner = `Phiếu đã bị hủy${input.cancel_reason ? ` — Lý do: ${input.cancel_reason}` : ""}`
  else if (input.type !== "transfer" && input.status === "posted" && !input.approved_by_name)
    banner = "Chưa phê duyệt — cần Ban giám đốc ký xác nhận."
  if (banner) {
    doc.setFillColor(254, 243, 199)
    doc.setDrawColor(245, 158, 11)
    doc.roundedRect(MARGIN, y, CONTENT_W, 6, 1, 1, "FD")
    doc.setFontSize(8)
    doc.setTextColor(146, 64, 14)
    doc.text(doc.splitTextToSize(banner, CONTENT_W - 4)[0] as string, MARGIN + 2, y + 4)
    y += 8
  }

  // Thẻ thông tin
  const statusText =
    input.status === "posted" ? "Đã ghi sổ" : input.status === "cancelled" ? "Đã hủy" : "Nháp"
  const statusSub = [fmtDateTime(input.posted_at), input.posted_by_name].filter(Boolean).join(" · ")
  const cards: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Ngày phiếu", value: fmtDate(input.document_date) || "—" },
    { label: "Trạng thái", value: statusText, sub: input.status === "posted" ? statusSub : undefined },
  ]
  if (input.type === "export") {
    cards.push({ label: "Kho xuất", value: warehouseLabel(input.sourceWarehouse, input.source_name) })
  } else if (input.type === "import") {
    cards.push({ label: "Kho nhập", value: warehouseLabel(input.targetWarehouse, input.recipient_name) })
  } else {
    cards.push({ label: "Kho nguồn", value: warehouseLabel(input.sourceWarehouse, input.source_name) })
    cards.push({ label: "Kho đích", value: warehouseLabel(input.targetWarehouse, input.recipient_name) })
  }
  const gap = 3
  const cardW = (CONTENT_W - gap * (cards.length - 1)) / cards.length
  const cardH = 12
  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardW + gap)
    doc.setFillColor(...PANEL_BG)
    doc.setDrawColor(...BORDER)
    doc.roundedRect(x, y, cardW, cardH, 1.2, 1.2, "FD")
    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text(card.label.toUpperCase(), x + 2, y + 3.5)
    doc.setFontSize(8.5)
    doc.setTextColor(...INK)
    doc.text(doc.splitTextToSize(card.value, cardW - 4)[0] as string, x + 2, y + 7.5)
    if (card.sub) {
      doc.setFontSize(6.5)
      doc.setTextColor(...GRAY)
      doc.text(doc.splitTextToSize(card.sub, cardW - 4)[0] as string, x + 2, y + 10.8)
    }
  })
  y += cardH + 3

  // Bảng vật tư
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: "grid",
    head: [["STT", "Mã vật tư", "Tên vật tư", "Đơn vị", "Số lượng", "Số lô", "Hạn sử dụng", "Ghi chú"]],
    body: input.lines.length
      ? input.lines.map((line, idx) => [
          String(idx + 1),
          line.item_code || "",
          line.item_name || "",
          line.unit || "",
          Number(line.quantity || 0).toLocaleString("vi-VN"),
          line.lot_no || "",
          fmtDate(line.expiry_date),
          line.line_notes || "",
        ])
      : [[{ content: "Phiếu chưa có dòng vật tư", colSpan: 8, styles: { halign: "center", textColor: GRAY } }]],
    styles: { font: PDF_FONT_NAME, fontSize: 7.5, cellPadding: 1.2, textColor: INK, lineColor: BORDER, lineWidth: 0.2 },
    headStyles: { fillColor: [241, 245, 249], textColor: INK, fontStyle: "normal" },
    columnStyles: {
      0: { cellWidth: 9, halign: "center" },
      1: { cellWidth: 24 },
      2: { cellWidth: 52 },
      3: { cellWidth: 14 },
      4: { cellWidth: 18, halign: "right" },
      5: { cellWidth: 20 },
      6: { cellWidth: 20 },
      7: { cellWidth: "auto" },
    },
    rowPageBreak: "avoid",
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 3

  if (input.notes) {
    doc.setFontSize(8)
    doc.setTextColor(...INK)
    const noteLines = doc.splitTextToSize(`Ghi chú: ${input.notes}`, CONTENT_W) as string[]
    doc.text(noteLines, MARGIN, y + 3)
    y += noteLines.length * 3.6 + 2
  }

  // Khối ký
  const keeper =
    input.type === "import" ? input.targetWarehouse?.keeper_name : input.sourceWarehouse?.keeper_name
  const sigs: Array<{ title: string; name: string; sub?: string }> = [
    { title: "Người lập phiếu", name: input.requester_name || "" },
    { title: "Thủ kho", name: keeper || "" },
    input.type === "export"
      ? { title: "Người nhận", name: input.recipient_name || "" }
      : { title: "Người bàn giao", name: input.recipient_name || input.source_name || "" },
  ]
  if (input.type !== "transfer") {
    sigs.push({
      title: "Người phê duyệt (BGĐ)",
      name: input.approved_by_name || "",
      sub: input.approved_at ? fmtDate(input.approved_at) : undefined,
    })
  }
  const sigBlockH = 26
  if (y + sigBlockH > PAGE_H - MARGIN) {
    doc.addPage()
    y = MARGIN
  }
  const colW = CONTENT_W / sigs.length
  sigs.forEach((sig, i) => {
    const cx = MARGIN + colW * i + colW / 2
    doc.setFontSize(8.5)
    doc.setTextColor(...INK)
    doc.text(sig.title, cx, y + 4, { align: "center" })
    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text("(Ký và ghi rõ họ tên)", cx, y + 7.5, { align: "center" })
    if (sig.name) {
      doc.setFontSize(8.5)
      doc.setTextColor(...INK)
      doc.text(doc.splitTextToSize(sig.name, colW - 4)[0] as string, cx, y + 22, { align: "center" })
    }
    if (sig.sub) {
      doc.setFontSize(6.5)
      doc.setTextColor(...GRAY)
      doc.text(sig.sub, cx, y + 25, { align: "center" })
    }
  })

  return doc
}

export function inventoryDocumentFileName(input: Pick<InventoryDocumentPdfInput, "type" | "document_code">) {
  return `${safeName(inventoryDocumentTitle(input.type))}-${safeName(input.document_code)}.pdf`
}

/** Bytes PDF phiếu để nhúng vào `DocViewer loadBytes`. */
export async function buildInventoryDocumentPdfBytes(input: InventoryDocumentPdfInput): Promise<Uint8Array> {
  const doc = await buildInventoryDocumentDoc(input)
  return new Uint8Array(doc.output("arraybuffer"))
}

export async function downloadInventoryDocumentPdf(input: InventoryDocumentPdfInput) {
  const doc = await buildInventoryDocumentDoc(input)
  doc.save(inventoryDocumentFileName(input))
}
