// Phiếu báo thành phẩm nhập kho — tổng hợp theo 1 ngày sản xuất (gồm mọi ca có phát sinh trong
// ngày đó), bám sát nội dung/bố cục mẫu thật `cung_cap_dl/mau_ptp.pdf` + `cung_cap_dl/mau_2.pdf`
// (không thêm nội dung ngoài mẫu, ngoại trừ dấu tích xanh ở cột "Trực ca" — đã được yêu cầu bổ
// sung riêng như một điểm nhấn hiển thị). Dữ liệu nguồn luôn truy vấn lại từ DB
// (loadShiftReportData trong confirm/actions.ts, lọc theo ngay_nhap — KHÔNG theo người nhập hay
// theo ca, vì 1 ngày có thể có nhiều ca, mỗi ca có thể có nhiều người trực nối tiếp nhau), nên có
// thể tạo lại phiếu bất kỳ lúc nào sau đó, không phụ thuộc phiên làm việc.
//
// Cấu trúc phiếu (2026-07-13, thay thế bản 1-ca/1-lần cũ): mỗi ca có phát sinh trong ngày là 1
// section riêng ("Ca 1: A {tên ca}") với bảng chi tiết + dòng "Tổng" của riêng ca đó; sau tất cả
// section là 1 bảng "Tổng hợp" GỘP CHUNG CẢ NGÀY (không tách theo ca) — đã chốt với người dùng.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_NAME, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared";
import { formatDateDisplay } from "@/lib/date-utils";
import type { ShiftReportCaSection, ShiftReportData } from "@/app/dashboard/product/confirm/actions";

// Tên nhà máy hard-code theo đúng mẫu — nhà máy khác PHK cần rà lại nếu tái sử dụng (giống tiền
// lệ "Nhà máy chế biến PHK" hard-code ở nhãn kiện, xem product-label-pdf.ts).
const COMPANY_LINE = "NHÀ MÁY CHẾ BIẾN CAO SU PHƯỚC HÒA KAMPONG THOM";
const TITLE_BASE = "PHIẾU BÁO THÀNH PHẨM NHẬP KHO";
// Mã tài liệu ISO của đúng mẫu giấy gốc — in cố định góc dưới bên trái mọi trang.
const DOC_CODE_LINE = "NMCB-QT01-F09 (03-01/08/2026) Có hiệu lực";

const PAGE_LEFT = 14;
const CONTENT_WIDTH = 182; // 210mm (A4) - 14*2 lề

// QUAN TRỌNG: khác với module Kiểm nghiệm (lưu "10"/"20" thô, cần tự thêm tiền tố "CSR" khi hiển
// thị — xem src/lib/quality-stats.ts), module Thành phẩm (`lots.loai_csr`, nguồn của toàn bộ
// phiếu này) đã lưu SẴN chuỗi đầy đủ dạng "CSR10"/"CSRL"/"CSRCV50" (xem product-lot-config.ts).
// Bug đã fix 2026-07-13: cột "Loại CSR" và tiêu đề trước đây tự thêm "CSR" một lần nữa, ra
// "CSRCSR10" / "CSR CSR10" — giờ dùng thẳng giá trị gốc cho cột, chỉ tách tiền tố ra cho tiêu đề.
function loaiCsrLabel(v: string): string {
  return v || "—";
}

// Chỉ dùng cho tiêu đề "...NHẬP KHO - CSR 10, 20" — tách tiền tố CSR/SVR ra khỏi từng giá trị để
// ghép thành 1 danh sách số dùng chung 1 chữ "CSR" phía trước, đúng định dạng mẫu giấy gốc.
function stripCsrPrefix(v: string): string {
  return v.replace(/^(CSR|SVR)/, "");
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Chừa lại đủ khoảng trống trước footer (16mm) — nếu không đủ `minSpace` tính từ y hiện tại thì
// sang trang mới và trả về y đầu trang. Dùng trước khi vẽ tiêu đề "Ca N:..."/"Tổng hợp" bằng
// doc.text() thủ công (autoTable tự phân trang được cho bảng, nhưng text thủ công thì không).
function ensurePageSpace(doc: jsPDF, y: number, minSpace: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + minSpace > pageH - 16) {
    doc.addPage();
    return 16;
  }
  return y;
}

function renderHeader(
  doc: jsPDF,
  meta: { ngay: string; soChiThi: string; csrList: string[] },
): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setTextColor(15, 23, 42);
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(12.5);
  doc.text(COMPANY_LINE, pageWidth / 2, 15, { align: "center", maxWidth: pageWidth - 24 });

  const titleSuffix =
    meta.csrList.length > 0 ? ` - CSR ${meta.csrList.map(stripCsrPrefix).join(", ")}` : "";
  doc.setFontSize(12);
  doc.text(`${TITLE_BASE}${titleSuffix}`, pageWidth / 2, 21.5, { align: "center", maxWidth: pageWidth - 24 });

  return renderMetaBox(doc, 26.5, {
    ngay: `Ngày: ${formatDateDisplay(meta.ngay) || meta.ngay}`,
    soChiThi: `Số chỉ thị: ${meta.soChiThi}`,
  });
}

// Bảng khung 1x2 viền đen mỏng: Ngày | Số chỉ thị — Ca và Ngăn SX không còn ở header vì giờ mỗi
// ca là 1 section riêng (có thể nhiều ca/ngày) và mỗi dòng đã có cột Ngăn SX riêng.
function renderMetaBox(doc: jsPDF, y: number, cells: { ngay: string; soChiThi: string }): number {
  const col1W = 122;
  const col2W = CONTENT_WIDTH - col1W;
  const padX = 2.5;
  const lineH = 4.2;

  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);

  const left = doc.splitTextToSize(cells.ngay, col1W - padX * 2) as string[];
  const right = doc.splitTextToSize(cells.soChiThi, col2W - padX * 2) as string[];

  const rowH = Math.max(7.6, Math.max(left.length, right.length) * lineH + 3.2);

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.25);
  doc.rect(PAGE_LEFT, y, CONTENT_WIDTH, rowH);
  doc.line(PAGE_LEFT + col1W, y, PAGE_LEFT + col1W, y + rowH);

  doc.text(left, PAGE_LEFT + padX, y + 5);
  doc.text(right, PAGE_LEFT + col1W + padX, y + 5);

  return y + rowH;
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

// 8 cột: Lô số | Loại CSR | Số bành | K.lượng (kg) | Bọc | Thùng chứa | Ngăn SX | Trực ca — dùng
// chung cho cả bảng chi tiết từng ca lẫn bảng "Tổng hợp" bên dưới để các bảng thẳng cột với nhau.
// Thêm cột "Ngăn SX" (2026-07-13) vì 1 lô/kiện có thể sản xuất từ nhiều ngăn khác nhau; nếu 1
// dòng gộp nhiều giao dịch dùng khác ngăn, cột này hiện đủ tất cả (cách nhau ", ").
const COLUMN_WIDTHS = [24, 15, 12, 16, 36, 20, 34, 25];
const NGAN_COL_INDEX = 6;
const TRUC_CA_COL_INDEX = 7;
const columnStyles = {
  0: { cellWidth: COLUMN_WIDTHS[0] },
  1: { cellWidth: COLUMN_WIDTHS[1] },
  2: { cellWidth: COLUMN_WIDTHS[2], halign: "right" as const },
  3: { cellWidth: COLUMN_WIDTHS[3], halign: "right" as const },
  4: { cellWidth: COLUMN_WIDTHS[4] },
  5: { cellWidth: COLUMN_WIDTHS[5] },
  6: { cellWidth: COLUMN_WIDTHS[NGAN_COL_INDEX] },
  7: { cellWidth: COLUMN_WIDTHS[TRUC_CA_COL_INDEX] },
};
const bodyStyles = {
  font: PDF_FONT_NAME,
  fontSize: 7.6,
  cellPadding: 1.8,
  valign: "middle" as const,
  lineColor: [15, 23, 42] as [number, number, number],
  lineWidth: 0.2,
  textColor: [15, 23, 42] as [number, number, number],
};
const totalsRowStyle = { fontStyle: "bold" as const, fillColor: [241, 245, 249] as [number, number, number] };

// Ký tự phân tách 2 dòng logic trong cell "Trực ca" (ngày-giờ + tên). Bug đã fix (2026-07-15):
// trước đây didParseCell set cell.text = [] (coi cell rỗng) rồi didDrawCell vẽ 2 dòng ở offset Y
// CỐ ĐỊNH — khi chuỗi ngày-giờ quá dài tự wrap thành 2 dòng con, dòng tên bị vẽ đè lên dòng giờ vì
// offset không biết line1 vừa chiếm thêm 1 dòng. Giờ đo số dòng THẬT của cả 2 phần bằng
// doc.splitTextToSize() trước, dùng đúng số dòng đó để (a) báo autoTable tính rowHeight đủ chỗ và
// (b) vẽ tuần tự từng dòng theo cursor tăng dần — không bao giờ chồng nhau dù có wrap hay không.
const LINE_SEP = "␟";
const TRUC_CA_FONT_SIZE_1 = 6.9; // dòng ngày-giờ, đậm, màu xanh
const TRUC_CA_FONT_SIZE_2 = 6.7; // dòng tên người, thường, màu xám
const TRUC_CA_LINE_HEIGHT = 2.9; // mm/dòng
const TRUC_CA_PAD_X = 1.8;
const TRUC_CA_BADGE_R = 1.7;

function trucCaMaxTextWidth(cellWidth: number): number {
  const textX = TRUC_CA_PAD_X + TRUC_CA_BADGE_R * 2 + 1.5;
  return cellWidth - textX - TRUC_CA_PAD_X;
}

// Dùng CHUNG hàm này ở cả didParseCell (đo để báo rowHeight) lẫn didDrawCell (đo lại để vẽ) với
// cùng `cellWidth` (luôn truyền COLUMN_WIDTHS[TRUC_CA_COL_INDEX], không đọc từ cell.width — tránh
// lệch kết quả wrap giữa 2 hook nếu thời điểm gọi có sai khác nhỏ về giá trị width trên cell).
function computeTrucCaLines(doc: jsPDF, raw: string, cellWidth: number): { line1: string[]; line2: string[] } {
  const [part1, part2] = raw.split(LINE_SEP);
  const maxTextWidth = trucCaMaxTextWidth(cellWidth);
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(TRUC_CA_FONT_SIZE_1);
  const line1 = doc.splitTextToSize(part1 || "", maxTextWidth) as string[];
  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(TRUC_CA_FONT_SIZE_2);
  const line2 = doc.splitTextToSize(part2 || "", maxTextWidth) as string[];
  return { line1: line1.length ? line1 : [""], line2: line2.length ? line2 : [""] };
}

function drawTrucCaCell(doc: jsPDF, cell: { x: number; y: number; width: number; height: number; raw: unknown }) {
  const raw = String(cell.raw ?? "");
  const { x, y, height } = cell;
  const { line1, line2 } = computeTrucCaLines(doc, raw, COLUMN_WIDTHS[TRUC_CA_COL_INDEX]);

  const badgeCx = x + TRUC_CA_PAD_X + TRUC_CA_BADGE_R;
  const badgeCy = y + height / 2;
  drawCheckBadge(doc, badgeCx, badgeCy, TRUC_CA_BADGE_R);

  const textX = badgeCx + TRUC_CA_BADGE_R + 1.5;
  const totalLines = line1.length + line2.length;
  let cursorY = y + (height - totalLines * TRUC_CA_LINE_HEIGHT) / 2 + TRUC_CA_LINE_HEIGHT * 0.75;

  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(TRUC_CA_FONT_SIZE_1);
  doc.setTextColor(5, 150, 105);
  for (const ln of line1) {
    doc.text(ln, textX, cursorY);
    cursorY += TRUC_CA_LINE_HEIGHT;
  }

  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(TRUC_CA_FONT_SIZE_2);
  doc.setTextColor(71, 85, 105);
  for (const ln of line2) {
    doc.text(ln, textX, cursorY);
    cursorY += TRUC_CA_LINE_HEIGHT;
  }
  doc.setTextColor(15, 23, 42);
}

// Vẽ 1 section ca: tiêu đề "Ca N: X {tên ca}" + bảng chi tiết + dòng "Tổng" của riêng ca đó.
// Trả về finalY để section/bảng tiếp theo nối tiếp đúng vị trí.
function renderCaSection(doc: jsPDF, startY: number, section: ShiftReportCaSection): number {
  const y = ensurePageSpace(doc, startY, 26);
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  const heading = `${section.caLabel}: ${section.ca}${section.caName ? ` ${section.caName}` : ""}`;
  doc.text(heading, PAGE_LEFT, y + 6);

  const body = section.rows.map((r) => [
    `${r.maLo}${r.kienLetters ? ` ${r.kienLetters}` : ""}`,
    loaiCsrLabel(r.loaiCsr),
    String(r.soBanh),
    r.soKg.toLocaleString("vi-VN"),
    r.boc || "—",
    r.pallet || "—",
    r.nganMa || "—",
    `${formatDateTime(r.hoanThanhAt)}${LINE_SEP}${r.nguoiNhap || "—"}`,
  ]);
  body.push(["Tổng", "", String(section.tongBanh), section.tongKg.toLocaleString("vi-VN"), "", "", "", ""]);
  const tongRowIndex = body.length - 1;

  autoTable(doc, {
    startY: y + 9,
    margin: { left: PAGE_LEFT, right: PAGE_LEFT },
    head: [["Lô số", "Loại CSR", "Số bành", "K.lượng (kg)", "Bọc", "Thùng chứa", "Ngăn SX", "Trực ca"]],
    body,
    theme: "grid",
    styles: bodyStyles,
    headStyles: { fillColor: [255, 255, 255], textColor: [15, 23, 42], fontStyle: "bold", fontSize: 8, lineColor: [15, 23, 42], lineWidth: 0.25 },
    columnStyles,
    didParseCell: (hookData) => {
      if (hookData.section !== "body") return;
      if (hookData.row.index === tongRowIndex) {
        hookData.cell.styles.fontStyle = totalsRowStyle.fontStyle;
        hookData.cell.styles.fillColor = totalsRowStyle.fillColor;
        return;
      }
      if (hookData.column.index === TRUC_CA_COL_INDEX) {
        // Đo đúng số dòng THẬT (ngày-giờ + tên, có thể wrap thêm) để autoTable tính rowHeight đủ
        // chỗ, nhưng KHÔNG được gán thẳng nội dung thật vào cell.text — autoTable vẫn tự vẽ mặc
        // định bất kỳ text nào còn lại trong cell.text (bằng font/màu mặc định của bodyStyles)
        // TRƯỚC KHI didDrawCell chạy, nên nếu gán content thật ở đây sẽ bị vẽ 2 lần chồng nhau
        // (1 lần mặc định màu đen + 1 lần màu xanh/xám tự vẽ bên dưới). Dùng placeholder rỗng
        // đúng SỐ LƯỢNG dòng cần thiết — giữ đúng rowHeight, không render nội dung nhìn thấy được.
        const raw = String(hookData.cell.raw ?? "");
        const { line1, line2 } = computeTrucCaLines(doc, raw, COLUMN_WIDTHS[TRUC_CA_COL_INDEX]);
        hookData.cell.text = Array(line1.length + line2.length).fill(" ");
      }
    },
    didDrawCell: (hookData) => {
      if (hookData.section !== "body" || hookData.row.index === tongRowIndex) return;
      if (hookData.column.index !== TRUC_CA_COL_INDEX) return;
      drawTrucCaCell(doc, hookData.cell);
    },
  });

  return (doc as PdfWithTable).lastAutoTable?.finalY ?? y + 20;
}

export async function buildShiftReportPdf(data: ShiftReportData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await ensurePdfFont(doc);

  const csrList = [...new Set(data.sections.flatMap((s) => s.rows.map((r) => r.loaiCsr)).filter(Boolean))].sort();
  let y = renderHeader(doc, { ngay: data.ngay, soChiThi: data.soChiThi, csrList });

  for (const section of data.sections) {
    y = renderCaSection(doc, y + 4, section);
  }

  y = ensurePageSpace(doc, y, 20);
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("Tổng hợp", PAGE_LEFT, y + 6);

  const groupBody = data.byGroup.map((g) => [
    "",
    loaiCsrLabel(g.loaiCsr),
    String(g.soBanh),
    g.soKg.toLocaleString("vi-VN"),
    g.boc || "—",
    g.pallet || "—",
    "",
    "",
  ]);
  groupBody.push(["Tổng", "", String(data.tongBanh), data.tongKg.toLocaleString("vi-VN"), "", "", "", ""]);
  const tongRowIndex = groupBody.length - 1;

  autoTable(doc, {
    startY: y + 9,
    margin: { left: PAGE_LEFT, right: PAGE_LEFT },
    body: groupBody,
    theme: "grid",
    styles: bodyStyles,
    columnStyles,
    didParseCell: (hookData) => {
      if (hookData.section === "body" && hookData.row.index === tongRowIndex) {
        hookData.cell.styles.fontStyle = totalsRowStyle.fontStyle;
        hookData.cell.styles.fillColor = totalsRowStyle.fillColor;
      }
    },
  });

  renderFooter(doc);
  return doc;
}

export function buildShiftReportFileName(data: ShiftReportData): string {
  const day = data.ngay.replace(/-/g, "");
  return `phieu-bao-thanh-pham-${safeName(day)}.pdf`;
}

// Mục 7 (2026-07-15): tách "xem trước" khỏi "chia sẻ/tải xuống" — trước đây bấm 1 nút là share/
// download thẳng, không có bước xem nội dung trước. Giờ luồng chuẩn là:
//   1. buildShiftReportPdf(data) — dựng PDF 1 lần duy nhất
//   2. openShiftReportPdfInNewTab(doc) — mở tab mới xem trước ngay (trình duyệt PDF viewer có sẵn)
//   3. Người dùng chủ động bấm "Chia sẻ" hoặc "Tải xuống" — dùng LẠI đúng doc đã dựng ở bước 1,
//      không dựng lại PDF lần nữa.
// Áp dụng đồng bộ cho cả confirm/page.tsx (Hub "Xem/Tạo lại phiếu" + "Kết thúc ca") lẫn nút "Xem
// phiếu PDF" mới ở header nhóm ngày trong product/page.tsx.

// jsPDF.output("bloburl") trả về URL blob PDF sẵn có, không cần tự tạo/thu hồi qua
// URL.createObjectURL — mở trực tiếp trong tab mới bằng trình xem PDF gốc của trình duyệt.
export function openShiftReportPdfInNewTab(doc: jsPDF): void {
  if (typeof window === "undefined") return;
  const url = doc.output("bloburl") as unknown as string;
  window.open(url, "_blank");
}

export function downloadShiftReportPdfDoc(doc: jsPDF, fileName: string): void {
  doc.save(fileName);
}

// Chia sẻ trực tiếp qua Web Share API (Zalo/Telegram...) nếu trình duyệt hỗ trợ, fallback tải
// file PDF về máy — mirror đúng pattern "Chia sẻ ảnh nhanh" của module Kiểm soát quá trình
// (measurements/page.tsx handleQuickShare). Nhận thẳng jsPDF doc đã dựng sẵn (không tự build lại).
export async function shareShiftReportPdfDoc(doc: jsPDF, fileName: string): Promise<void> {
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
  downloadShiftReportPdfDoc(doc, fileName);
}
