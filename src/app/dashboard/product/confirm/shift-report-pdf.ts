// Phiếu báo thành phẩm nhập kho — tổng hợp cuối ca, tham chiếu bố cục `cung_cap_dl/mau_ptp.pdf`
// (thiết kế lại chuyên nghiệp hơn theo yêu cầu, không copy y nguyên mẫu). Dữ liệu nguồn luôn
// truy vấn lại từ DB (xem loadShiftReportData trong confirm/actions.ts), không dùng sessionLog
// phía client — tránh mất dữ liệu nếu người dùng lỡ tải lại trang giữa ca.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_NAME, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared";
import { formatDateDisplay } from "@/lib/date-utils";
import type { ShiftReportData } from "@/app/dashboard/product/confirm/actions";

const ORG_LINE_1 = "Nhà máy chế biến";
const ORG_LINE_2 = "Phiếu báo thành phẩm nhập kho";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderHeader(doc: jsPDF, meta: { ngay: string; ca: string; nguoiGui: string; chucVu: string }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(16, 185, 129);
  doc.roundedRect(10, 8, pageWidth - 20, 30, 4, 4, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(10);
  doc.text(ORG_LINE_1, 16, 18);
  doc.text(ORG_LINE_2, 16, 26);
  doc.setFontSize(15);
  doc.text("PHIẾU BÁO THÀNH PHẨM NHẬP KHO", pageWidth / 2, 20, { align: "center" });

  doc.setTextColor(15, 23, 42);
  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(9.5);
  const metaY = 45;
  doc.text(
    `Ngày: ${formatDateDisplay(meta.ngay) || meta.ngay}     Ca: ${meta.ca || "—"}     Trực ca: ${meta.nguoiGui}${meta.chucVu ? ` (${meta.chucVu})` : ""}`,
    pageWidth / 2,
    metaY,
    { align: "center" },
  );
}

function renderFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(8);
  const printedAt = formatDateTime(new Date().toISOString());
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.text(`In lúc: ${printedAt}`, 12, pageH - 8);
    doc.text(`Trang ${i}/${pageCount}`, pageW - 12, pageH - 8, { align: "right" });
  }
}

type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

export async function buildShiftReportPdf(data: ShiftReportData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  await ensurePdfFont(doc);

  renderHeader(doc, { ngay: data.ngay, ca: data.ca, nguoiGui: data.nguoiGui, chucVu: data.chucVu });

  const body = data.rows.map((r, i) => [
    String(i + 1),
    `${r.maLo}${r.kienLetters ? ` (${r.kienLetters})` : ""}`,
    r.loaiCsr || "—",
    r.boc || "—",
    r.pallet || "—",
    r.chiThi || "—",
    String(r.soBanh),
    r.soKg.toLocaleString("vi-VN"),
    r.hoanThanhAt ? `✓ ${formatDateTime(r.hoanThanhAt)}` : "—",
  ]);

  autoTable(doc, {
    startY: 52,
    head: [["STT", "Lô số (kiện)", "Loại CSR", "Bọc", "Pallet", "Số chỉ thị", "Số bành", "KL (kg)", "Hoàn thành lúc"]],
    body,
    styles: { font: PDF_FONT_NAME, fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 38 },
      6: { cellWidth: 20, halign: "right" },
      7: { cellWidth: 24, halign: "right" },
      8: { cellWidth: 48 },
    },
    didParseCell: (hookData) => {
      if (hookData.section === "body" && hookData.column.index === 8) {
        hookData.cell.styles.textColor = [5, 150, 105];
        hookData.cell.styles.fontStyle = "bold";
      }
    },
  });

  const afterMainTableY = (doc as PdfWithTable).lastAutoTable?.finalY ?? 60;

  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(10.5);
  doc.text("Tổng hợp theo loại CSR", 14, afterMainTableY + 10);

  autoTable(doc, {
    startY: afterMainTableY + 13,
    head: [["Loại CSR", "Tổng số bành", "Tổng KL (kg)"]],
    body: [
      ...data.byLoaiCsr.map((r) => [r.loaiCsr || "—", String(r.soBanh), r.soKg.toLocaleString("vi-VN")]),
      ["Tổng cộng", String(data.tongBanh), data.tongKg.toLocaleString("vi-VN")],
    ],
    styles: { font: PDF_FONT_NAME, fontSize: 9, cellPadding: 2.2 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: "bold" },
    didParseCell: (hookData) => {
      if (hookData.section === "body" && hookData.row.index === data.byLoaiCsr.length) {
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.fillColor = [241, 245, 249];
      }
    },
    tableWidth: 120,
  });

  renderFooter(doc);
  return doc;
}

export function buildShiftReportFileName(data: ShiftReportData): string {
  const day = data.ngay.replace(/-/g, "");
  return `phieu-bao-thanh-pham-${safeName(day)}-${safeName(data.nguoiGui || "ca")}.pdf`;
}

// Chia sẻ trực tiếp qua Web Share API (Zalo/Telegram...) nếu trình duyệt hỗ trợ, fallback tải
// file PDF về máy — mirror đúng pattern "Chia sẻ ảnh nhanh" của module Kiểm soát quá trình
// (measurements/page.tsx handleQuickShare).
export async function shareOrDownloadShiftReportPdf(data: ShiftReportData): Promise<void> {
  const doc = await buildShiftReportPdf(data);
  const fileName = buildShiftReportFileName(data);
  const blob = doc.output("blob") as Blob;
  const file = new File([blob], fileName, { type: "application/pdf" });

  if (typeof navigator !== "undefined" && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      // Rơi xuống tải file nếu share thất bại vì lý do khác (không hỗ trợ định dạng...).
    }
  }
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}
