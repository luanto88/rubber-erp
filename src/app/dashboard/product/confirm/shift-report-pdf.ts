// Phiếu báo thành phẩm nhập kho — tổng hợp theo 1 ngày sản xuất + 1 ca, tham chiếu bố cục
// `cung_cap_dl/mau_ptp.pdf` (thiết kế lại chuyên nghiệp hơn theo yêu cầu, không copy y nguyên
// mẫu). Dữ liệu nguồn luôn truy vấn lại từ DB (loadShiftReportData trong confirm/actions.ts,
// lọc theo ngay_nhap + ca — KHÔNG theo người nhập, vì 1 ca có thể có nhiều người trực nối tiếp
// nhau), nên có thể tạo lại phiếu bất kỳ lúc nào sau đó, không phụ thuộc phiên làm việc.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_NAME, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared";
import { formatDateDisplay } from "@/lib/date-utils";
import type { ShiftReportData } from "@/app/dashboard/product/confirm/actions";

// Tên công ty hard-code theo đúng yêu cầu — nhà máy khác PHK cần rà lại nếu tái sử dụng
// (giống tiền lệ "Nhà máy chế biến PHK" hard-code ở nhãn kiện, xem product-label-pdf.ts).
const COMPANY_LINE = "CÔNG TY TNHH PHÁT TRIỂN CAO SU PHƯỚC HÒA KAMPONG THOM";
const FACTORY_LINE = "NHÀ MÁY CHẾ BIẾN";
const TITLE_LINE = "PHIẾU BÁO THÀNH PHẨM NHẬP KHO";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderHeader(doc: jsPDF, meta: { ngay: string; ca: string; nganMa: string }) {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setTextColor(15, 23, 42);
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(9.5);
  doc.text(COMPANY_LINE, 14, 14, { maxWidth: pageWidth - 28 });
  doc.text(FACTORY_LINE, 14, 19.5);

  doc.setFontSize(15);
  doc.text(TITLE_LINE, pageWidth / 2, 30, { align: "center" });

  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.6);
  doc.line(14, 34, pageWidth - 14, 34);

  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(9.5);
  doc.text(
    `Ngày: ${formatDateDisplay(meta.ngay) || meta.ngay}      Ca: ${meta.ca || "—"}      Ngăn lưu: ${meta.nganMa}`,
    pageWidth / 2,
    41,
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

const HOAN_THANH_COL_INDEX = 8;
// Ký tự phân tách 2 dòng trong cell "Hoàn thành lúc" — cell.text bị chặn render mặc định
// (didParseCell) rồi tự vẽ 2 dòng riêng qua didDrawCell để dòng 1 (dấu tick + giờ) đậm màu xanh,
// dòng 2 (tên người nhập) chữ thường màu xám, đúng yêu cầu tách 2 dòng khác kiểu.
const LINE_SEP = "␟";

export async function buildShiftReportPdf(data: ShiftReportData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await ensurePdfFont(doc);

  renderHeader(doc, { ngay: data.ngay, ca: data.ca, nganMa: data.nganMa });

  const body = data.rows.map((r, i) => [
    String(i + 1),
    `${r.maLo}${r.kienLetters ? ` (${r.kienLetters})` : ""}`,
    r.loaiCsr || "—",
    r.boc || "—",
    r.pallet || "—",
    r.chiThi || "—",
    String(r.soBanh),
    r.soKg.toLocaleString("vi-VN"),
    `✓ ${formatDateTime(r.hoanThanhAt)}${LINE_SEP}${r.nguoiNhap || "—"}`,
  ]);

  autoTable(doc, {
    startY: 47,
    head: [["STT", "Lô số (kiện)", "CSR", "Bọc", "Pallet", "Chỉ thị", "Bành", "KL (kg)", "Hoàn thành lúc"]],
    body,
    styles: { font: PDF_FONT_NAME, fontSize: 7.3, cellPadding: 1.6, valign: "middle" },
    headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: "bold", fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: 22 },
      2: { cellWidth: 14 },
      3: { cellWidth: 26 },
      4: { cellWidth: 18 },
      5: { cellWidth: 13, halign: "center" },
      6: { cellWidth: 12, halign: "right" },
      7: { cellWidth: 16, halign: "right" },
      8: { cellWidth: 34 },
    },
    didParseCell: (hookData) => {
      if (hookData.section === "body" && hookData.column.index === HOAN_THANH_COL_INDEX) {
        // Chặn render mặc định — tự vẽ 2 dòng khác màu/khác cỡ trong didDrawCell bên dưới.
        hookData.cell.text = [];
      }
    },
    didDrawCell: (hookData) => {
      if (hookData.section === "body" && hookData.column.index === HOAN_THANH_COL_INDEX) {
        const raw = String(hookData.cell.raw ?? "");
        const [line1, line2] = raw.split(LINE_SEP);
        const { x, y, width, height } = hookData.cell;
        const padX = 1.6;
        doc.setFont(PDF_FONT_NAME, "bold");
        doc.setFontSize(7.3);
        doc.setTextColor(5, 150, 105);
        doc.text(line1 || "", x + padX, y + height / 2 - 1, { maxWidth: width - padX * 2 });
        doc.setFont(PDF_FONT_NAME, "normal");
        doc.setFontSize(7);
        doc.setTextColor(71, 85, 105);
        doc.text(line2 || "", x + padX, y + height / 2 + 3, { maxWidth: width - padX * 2 });
        doc.setTextColor(15, 23, 42);
      }
    },
  });

  const afterMainTableY = (doc as PdfWithTable).lastAutoTable?.finalY ?? 60;

  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(10);
  doc.text("Tổng hợp theo Loại CSR - Loại bành - Bọc - Pallet", 14, afterMainTableY + 9);

  autoTable(doc, {
    startY: afterMainTableY + 12,
    head: [["Loại CSR", "Loại bành", "Bọc", "Pallet", "Tổng bành", "Tổng KL (kg)"]],
    body: [
      ...data.byGroup.map((g) => [
        g.loaiCsr || "—",
        g.loaiBanh ? String(g.loaiBanh) : "—",
        g.boc || "—",
        g.pallet || "—",
        String(g.soBanh),
        g.soKg.toLocaleString("vi-VN"),
      ]),
      ["Tổng cộng", "", "", "", String(data.tongBanh), data.tongKg.toLocaleString("vi-VN")],
    ],
    styles: { font: PDF_FONT_NAME, fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: "bold", fontSize: 8 },
    didParseCell: (hookData) => {
      if (hookData.section === "body" && hookData.row.index === data.byGroup.length) {
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });

  renderFooter(doc);
  return doc;
}

export function buildShiftReportFileName(data: ShiftReportData): string {
  const day = data.ngay.replace(/-/g, "");
  return `phieu-bao-thanh-pham-${safeName(day)}-ca-${safeName(data.ca || "x")}.pdf`;
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
