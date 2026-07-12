// Phiếu báo thành phẩm nhập kho — tổng hợp theo 1 ngày sản xuất + 1 ca, bám sát nội dung/bố cục
// mẫu thật `cung_cap_dl/mau_ptp.pdf` (không thêm nội dung ngoài mẫu, ngoại trừ dấu tích xanh ở
// cột "Trực ca" — đã được yêu cầu bổ sung riêng như một điểm nhấn hiển thị). Dữ liệu nguồn luôn
// truy vấn lại từ DB (loadShiftReportData trong confirm/actions.ts, lọc theo ngay_nhap + ca —
// KHÔNG theo người nhập, vì 1 ca có thể có nhiều người trực nối tiếp nhau), nên có thể tạo lại
// phiếu bất kỳ lúc nào sau đó, không phụ thuộc phiên làm việc.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_NAME, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared";
import { formatDateDisplay } from "@/lib/date-utils";
import type { ShiftReportData } from "@/app/dashboard/product/confirm/actions";

// Tên nhà máy hard-code theo đúng mẫu — nhà máy khác PHK cần rà lại nếu tái sử dụng (giống tiền
// lệ "Nhà máy chế biến PHK" hard-code ở nhãn kiện, xem product-label-pdf.ts).
const COMPANY_LINE = "NHÀ MÁY CHẾ BIẾN CAO SU PHƯỚC HÒA KAMPONG THOM";
const TITLE_BASE = "PHIẾU BÁO THÀNH PHẨM NHẬP KHO";
// Mã tài liệu ISO của đúng mẫu giấy gốc — in cố định góc dưới bên trái mọi trang.
const DOC_CODE_LINE = "NMCB-QT01-F09 (03-01/08/2026) Có hiệu lực";

const PAGE_LEFT = 14;
const CONTENT_WIDTH = 182; // 210mm (A4) - 14*2 lề

// Quy ước hiển thị "CSR" của app: CSR + giá trị thô lưu trong DB (mirror src/lib/quality-stats.ts).
function loaiCsrLabel(v: string): string {
  return v ? `CSR${v}` : "—";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderHeader(
  doc: jsPDF,
  meta: { ngay: string; ca: string; nganMa: string; soChiThi: string; csrList: string[] },
): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setTextColor(15, 23, 42);
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(12.5);
  doc.text(COMPANY_LINE, pageWidth / 2, 15, { align: "center", maxWidth: pageWidth - 24 });

  const titleSuffix = meta.csrList.length > 0 ? ` - CSR ${meta.csrList.join(", ")}` : "";
  doc.setFontSize(12);
  doc.text(`${TITLE_BASE}${titleSuffix}`, pageWidth / 2, 21.5, { align: "center", maxWidth: pageWidth - 24 });

  return renderMetaBox(doc, 26.5, {
    ngay: `Ngày: ${formatDateDisplay(meta.ngay) || meta.ngay}`,
    ca: `Ca ${meta.ca || "—"}`,
    nganSx: `Ngăn SX: ${meta.nganMa}`,
    soChiThi: `Số chỉ thị: ${meta.soChiThi}`,
  });
}

// Bảng khung 2x2 viền đen mỏng đúng mẫu: Ngày/Ca ở hàng 1, Ngăn SX/Số chỉ thị ở hàng 2. Tự co
// giãn chiều cao theo số dòng thực tế (nganSx có thể dài khi nhiều ngăn cùng ca).
function renderMetaBox(
  doc: jsPDF,
  y: number,
  cells: { ngay: string; ca: string; nganSx: string; soChiThi: string },
): number {
  const col1W = 122;
  const col2W = CONTENT_WIDTH - col1W;
  const padX = 2.5;
  const lineH = 4.2;

  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);

  const row1Left = doc.splitTextToSize(cells.ngay, col1W - padX * 2) as string[];
  const row1Right = doc.splitTextToSize(cells.ca, col2W - padX * 2) as string[];
  const row2Left = doc.splitTextToSize(cells.nganSx, col1W - padX * 2) as string[];
  const row2Right = doc.splitTextToSize(cells.soChiThi, col2W - padX * 2) as string[];

  const row1H = Math.max(7.6, Math.max(row1Left.length, row1Right.length) * lineH + 3.2);
  const row2H = Math.max(7.6, Math.max(row2Left.length, row2Right.length) * lineH + 3.2);
  const totalH = row1H + row2H;

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.25);
  doc.rect(PAGE_LEFT, y, CONTENT_WIDTH, totalH);
  doc.line(PAGE_LEFT, y + row1H, PAGE_LEFT + CONTENT_WIDTH, y + row1H);
  doc.line(PAGE_LEFT + col1W, y, PAGE_LEFT + col1W, y + totalH);

  doc.text(row1Left, PAGE_LEFT + padX, y + 5);
  doc.text(row1Right, PAGE_LEFT + col1W + padX, y + 5);
  doc.text(row2Left, PAGE_LEFT + padX, y + row1H + 5);
  doc.text(row2Right, PAGE_LEFT + col1W + padX, y + row1H + 5);

  return y + totalH;
}

// Huy hiệu tích xanh vẽ bằng vector (không phụ thuộc glyph emoji của font) — đẹp và sắc nét hơn
// hẳn ký tự "✓" thuần chữ, theo đúng yêu cầu "đổi mẫu tích xanh khác đẹp hơn".
function drawCheckBadge(doc: jsPDF, cx: number, cy: number, r: number) {
  doc.setFillColor(5, 150, 105);
  doc.circle(cx, cy, r, "F");
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(Math.max(0.32, r * 0.32));
  doc.setLineCap("round");
  doc.setLineJoin("round");
  doc.line(cx - r * 0.5, cy + r * 0.02, cx - r * 0.08, cy + r * 0.42);
  doc.line(cx - r * 0.08, cy + r * 0.42, cx + r * 0.55, cy - r * 0.4);
  doc.setLineCap("butt");
  doc.setLineJoin("miter");
}

function renderFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.line(PAGE_LEFT, pageH - 12, pageW - PAGE_LEFT, pageH - 12);
    doc.setFont(PDF_FONT_NAME, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(DOC_CODE_LINE, PAGE_LEFT, pageH - 8);
  }
}

type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

// 7 cột đúng mẫu: Lô số | Loại CSR | Số bành | K.lượng (kg) | Bọc | Thùng chứa | Trực ca —
// dùng chung cho cả bảng chi tiết và bảng "Tổng hợp" bên dưới để 2 bảng thẳng cột với nhau.
const COLUMN_WIDTHS = [26, 16, 14, 18, 46, 22, 40];
const TRUC_CA_COL_INDEX = 6;
const columnStyles = {
  0: { cellWidth: COLUMN_WIDTHS[0] },
  1: { cellWidth: COLUMN_WIDTHS[1] },
  2: { cellWidth: COLUMN_WIDTHS[2], halign: "right" as const },
  3: { cellWidth: COLUMN_WIDTHS[3], halign: "right" as const },
  4: { cellWidth: COLUMN_WIDTHS[4] },
  5: { cellWidth: COLUMN_WIDTHS[5] },
  6: { cellWidth: COLUMN_WIDTHS[6] },
};

// Ký tự phân tách 2 dòng trong cell "Trực ca" — cell.text bị chặn render mặc định (didParseCell)
// rồi tự vẽ huy hiệu tích + 2 dòng riêng qua didDrawCell (dòng 1 đậm màu xanh, dòng 2 chữ thường
// màu xám), đúng yêu cầu tách 2 dòng khác kiểu kèm dấu tích xanh.
const LINE_SEP = "␟";

export async function buildShiftReportPdf(data: ShiftReportData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await ensurePdfFont(doc);

  const csrList = [...new Set(data.rows.map((r) => r.loaiCsr).filter(Boolean))].sort();
  const headerBottomY = renderHeader(doc, {
    ngay: data.ngay,
    ca: data.ca,
    nganMa: data.nganMa,
    soChiThi: data.soChiThi,
    csrList,
  });

  const body = data.rows.map((r) => [
    `${r.maLo}${r.kienLetters ? ` ${r.kienLetters}` : ""}`,
    loaiCsrLabel(r.loaiCsr),
    String(r.soBanh),
    r.soKg.toLocaleString("vi-VN"),
    r.boc || "—",
    r.pallet || "—",
    `${formatDateTime(r.hoanThanhAt)}${LINE_SEP}${r.nguoiNhap || "—"}`,
  ]);

  autoTable(doc, {
    startY: headerBottomY + 4,
    margin: { left: PAGE_LEFT, right: PAGE_LEFT },
    head: [["Lô số", "Loại CSR", "Số bành", "K.lượng (kg)", "Bọc", "Thùng chứa", "Trực ca"]],
    body,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 7.6, cellPadding: 1.8, valign: "middle", lineColor: [15, 23, 42], lineWidth: 0.2, textColor: [15, 23, 42] },
    headStyles: { fillColor: [255, 255, 255], textColor: [15, 23, 42], fontStyle: "bold", fontSize: 8, lineColor: [15, 23, 42], lineWidth: 0.25 },
    columnStyles,
    didParseCell: (hookData) => {
      if (hookData.section === "body" && hookData.column.index === TRUC_CA_COL_INDEX) {
        // Chặn render mặc định — tự vẽ huy hiệu + 2 dòng khác màu/khác cỡ trong didDrawCell.
        hookData.cell.text = [];
      }
    },
    didDrawCell: (hookData) => {
      if (hookData.section === "body" && hookData.column.index === TRUC_CA_COL_INDEX) {
        const raw = String(hookData.cell.raw ?? "");
        const [line1, line2] = raw.split(LINE_SEP);
        const { x, y, width, height } = hookData.cell;
        const padX = 1.8;
        const r = 1.7;
        const badgeCx = x + padX + r;
        const badgeCy = y + height / 2;
        drawCheckBadge(doc, badgeCx, badgeCy, r);

        const textX = badgeCx + r + 1.5;
        const maxTextWidth = width - (textX - x) - padX;
        doc.setFont(PDF_FONT_NAME, "bold");
        doc.setFontSize(6.9);
        doc.setTextColor(5, 150, 105);
        doc.text(line1 || "", textX, y + height / 2 - 1.1, { maxWidth: maxTextWidth });
        doc.setFont(PDF_FONT_NAME, "normal");
        doc.setFontSize(6.7);
        doc.setTextColor(71, 85, 105);
        doc.text(line2 || "", textX, y + height / 2 + 2.9, { maxWidth: maxTextWidth });
        doc.setTextColor(15, 23, 42);
      }
    },
  });

  const afterMainTableY = (doc as PdfWithTable).lastAutoTable?.finalY ?? headerBottomY + 20;

  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("Tổng hợp", PAGE_LEFT, afterMainTableY + 6);

  const groupBody = data.byGroup.map((g) => [
    "",
    loaiCsrLabel(g.loaiCsr),
    String(g.soBanh),
    g.soKg.toLocaleString("vi-VN"),
    g.boc || "—",
    g.pallet || "—",
    "",
  ]);
  groupBody.push(["Tổng", "", String(data.tongBanh), data.tongKg.toLocaleString("vi-VN"), "", "", ""]);
  const tongRowIndex = groupBody.length - 1;

  autoTable(doc, {
    startY: afterMainTableY + 9,
    margin: { left: PAGE_LEFT, right: PAGE_LEFT },
    body: groupBody,
    theme: "grid",
    styles: { font: PDF_FONT_NAME, fontSize: 7.6, cellPadding: 1.8, valign: "middle", lineColor: [15, 23, 42], lineWidth: 0.2, textColor: [15, 23, 42] },
    columnStyles,
    didParseCell: (hookData) => {
      if (hookData.section === "body" && hookData.row.index === tongRowIndex) {
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
