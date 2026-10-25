import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { formatStorageDate } from "@/lib/storage-detail"
import { PDF_FONT_NAME, addQrImage, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared"

/**
 * Phiếu chi tiết lô thành phẩm (trang chi tiết `/dashboard/product/lot/[id]`, rule 29 mục C).
 * Chỉ là bản xem/in tham khảo — KHÔNG phải biểu mẫu ISO có mã (F09/F11/F12 vẫn ở luồng báo cáo ngày).
 * QR góc phải trên trỏ đúng trang chi tiết lô (rule 29 mục D2).
 */

const DEFAULT_COMPANY_LINE = "NHÀ MÁY CHẾ BIẾN CAO SU"
const TITLE = "PHIẾU CHI TIẾT LÔ THÀNH PHẨM"

type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } }

export type ProductLotPdfKien = { label: string; banh: number; max: number }

export type ProductLotPdfTransaction = {
  ngay: string
  ca: string
  ngan: string
  kien: string
  so_banh: number
  so_kg: number
  boc: string
  pallet: string
}

export type ProductLotPdfExport = { ma_don: string; ngay: string; so_banh: number }

export type ProductLotPdfInput = {
  ma_lo: string
  factoryName?: string | null
  trang_thai: string
  day_chuyen: string
  loai_csr: string
  loai_banh: number
  boc: string
  tham: string
  pallet: string
  chi_thi: string
  ngay_sx: string | null
  ngay_ht: string | null
  ca: string
  ngan: string
  tong_banh: number
  tong_kg: number
  ghi_chu: string
  kien: ProductLotPdfKien[]
  transactions: ProductLotPdfTransaction[]
  exports: ProductLotPdfExport[]
  qcText: string
  qrUrl?: string | null
}

const fmtNum = (v: number) => Math.round((v || 0) * 100) / 100
const fmtKg = (v: number) => `${Math.round(v || 0).toLocaleString("vi-VN")} kg`

async function buildProductLotDoc(input: ProductLotPdfInput) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)
  const pageW = doc.internal.pageSize.getWidth()

  doc.setTextColor(15, 23, 42)
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(10.5)
  const company = (input.factoryName || "").trim().toUpperCase()
  const heading = !company
    ? DEFAULT_COMPANY_LINE
    : company.startsWith("NHÀ MÁY")
      ? company
      : `${DEFAULT_COMPANY_LINE.replace(" CAO SU", "")} ${company}`
  doc.text(heading, 14, 15, { maxWidth: pageW - 60 })
  doc.setFontSize(15)
  doc.text(TITLE, pageW / 2, 26, { align: "center" })
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(10)
  doc.text(`Mã lô: ${input.ma_lo}`, pageW / 2, 32, { align: "center" })

  if (input.qrUrl) {
    await addQrImage(doc, input.qrUrl, pageW - 14 - 22, 8, 22)
  }

  autoTable(doc, {
    startY: 38,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2.2, textColor: [30, 41, 59] },
    columnStyles: { 0: { cellWidth: 36, fontStyle: "bold" }, 1: { cellWidth: 57 }, 2: { cellWidth: 36, fontStyle: "bold" }, 3: { cellWidth: 53 } },
    body: [
      ["Mã lô", input.ma_lo, "Trạng thái", input.trang_thai || "—"],
      ["Dây chuyền", input.day_chuyen || "—", "Loại CSR", input.loai_csr || "—"],
      ["Loại bành", `${fmtNum(input.loai_banh)} kg`, "Thảm", input.tham || "—"],
      ["Bọc", input.boc || "—", "Pallet", input.pallet || "—"],
      ["Ngày mở lô", formatStorageDate(input.ngay_sx), "Ngày tròn lô", formatStorageDate(input.ngay_ht)],
      ["Ca", input.ca || "—", "Ngăn nguồn", input.ngan || "—"],
      ["Tổng bành", `${input.tong_banh.toLocaleString("vi-VN")} bành`, "Tổng KL", fmtKg(input.tong_kg)],
      ["Chỉ thị", input.chi_thi || "—", "Kiểm nghiệm", input.qcText || "—"],
      ["Ghi chú", { content: input.ghi_chu || "—", colSpan: 3 }],
    ],
  })

  let y = ((doc as PdfWithTable).lastAutoTable?.finalY || 90) + 7
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(11)
  doc.text("Số bành theo kiện", 14, y)
  autoTable(doc, {
    startY: y + 3,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2, halign: "center" },
    headStyles: { fillColor: [47, 93, 82], textColor: [255, 255, 255] },
    head: [input.kien.map((k) => `Kiện ${k.label}`)],
    body: [input.kien.map((k) => `${k.banh} / ${k.max}`)],
  })

  y = ((doc as PdfWithTable).lastAutoTable?.finalY || 120) + 7
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(11)
  doc.text("Giao dịch nhập thành phẩm", 14, y)
  autoTable(doc, {
    startY: y + 3,
    theme: "striped",
    styles: { font: PDF_FONT_NAME, fontSize: 8.4, cellPadding: 1.8 },
    headStyles: { fillColor: [15, 118, 110] },
    head: [["Ngày", "Ca", "Ngăn", "Kiện", "Bành", "KL", "Bọc", "Pallet"]],
    body: input.transactions.length
      ? input.transactions.map((t) => [
          formatStorageDate(t.ngay), t.ca || "—", t.ngan || "—", t.kien || "—",
          t.so_banh.toLocaleString("vi-VN"), fmtKg(t.so_kg), t.boc || "—", t.pallet || "—",
        ])
      : [["—", "—", "—", "—", "—", "—", "Chưa có giao dịch", "—"]],
  })

  y = ((doc as PdfWithTable).lastAutoTable?.finalY || 170) + 7
  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(11)
  doc.text("Đơn xuất hàng đã gán", 14, y)
  autoTable(doc, {
    startY: y + 3,
    theme: "striped",
    styles: { font: PDF_FONT_NAME, fontSize: 8.4, cellPadding: 1.8 },
    headStyles: { fillColor: [37, 99, 235] },
    head: [["Mã đơn", "Ngày", "Số bành"]],
    body: input.exports.length
      ? input.exports.map((e) => [e.ma_don || "—", formatStorageDate(e.ngay), e.so_banh.toLocaleString("vi-VN")])
      : [["—", "—", "Chưa gán đơn xuất nào"]],
  })

  const pageCount = doc.getNumberOfPages()
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFont(PDF_FONT_NAME, "normal")
  doc.setFontSize(8)
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.text(`Lô ${input.ma_lo}`, 14, pageH - 8)
    doc.text(`Trang ${i}/${pageCount}`, pageW - 14, pageH - 8, { align: "right" })
  }
  return doc
}

export function productLotPdfFileName(maLo: string) {
  return `chi-tiet-lo-${safeName(maLo)}.pdf`
}

export async function buildProductLotPdfBytes(input: ProductLotPdfInput): Promise<Uint8Array> {
  const doc = await buildProductLotDoc(input)
  return new Uint8Array(doc.output("arraybuffer"))
}

export async function downloadProductLotPdf(input: ProductLotPdfInput) {
  const doc = await buildProductLotDoc(input)
  doc.save(productLotPdfFileName(input.ma_lo))
}
