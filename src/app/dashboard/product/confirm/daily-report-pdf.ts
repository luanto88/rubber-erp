// Báo cáo sản xuất hằng ngày (NMCB-QT01-F12) — bám `cung_cap_dl/NMCB-QT01-F12 Báo cáo sản xuất
// hàng ngày.pdf`: khổ NGANG, 1 phiếu = đúng 1 trang, mã tài liệu góc trái dưới. Xuất cùng Báo cáo
// lô sản xuất (F11): file PDF tải về gộp F11 (dọc) + 1 trang F12 (ngang); chia sẻ ảnh thì F11 và
// F12 là 2 ảnh tách rời (xem shift-report-preview-bar.tsx). Dữ liệu: daily-report-actions.ts.
import jsPDF from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { PDF_FONT_NAME, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared";
import type { ShiftReportData } from "@/app/dashboard/product/confirm/actions";
import type { DailyReportData } from "@/app/dashboard/product/confirm/daily-report-actions";
import { renderLotReport } from "@/app/dashboard/product/confirm/lot-report-pdf";

export type DailyReportInputs = {
  doLit: number; // số lít dầu DO người dùng xác nhận cho ngày báo cáo
  doGhiChu: string; // chỉ điền vào cột Ghi chú của dòng dầu
};

const COMPANY_LINE_1 = "CÔNG TY TNHH PHÁT TRIỂN CAO SU PHƯỚC HÒA KAMPONG THOM";
const COMPANY_LINE_2 = "NHÀ MÁY CHẾ BIẾN";
const TITLE = "BÁO CÁO SẢN XUẤT HẰNG NGÀY";
const DOC_CODE_LINE = "NMCB-QT01-F12 (03-01/8/2026) Có hiệu lực";
const PAGE_MARGIN = 10;
const FOOTER_RESERVE = 13;

// Mức mật độ giảm dần tới khi phiếu vừa 1 trang (mirror ENTRY_DENSITY của dispatch-pdf.ts).
const DENSITY = [
  { fontSize: 7.8, headSize: 7.8, pad: 1.3, gap: 6 },
  { fontSize: 7.1, headSize: 7.2, pad: 0.9, gap: 5 },
  { fontSize: 6.4, headSize: 6.5, pad: 0.55, gap: 4 },
  { fontSize: 5.7, headSize: 5.8, pad: 0.35, gap: 3 },
] as const;

type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } };
const INK: [number, number, number] = [15, 23, 42];

function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const numFmt = (v: number) =>
  v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
// Ô số trong ngày để trống khi = 0 cho đỡ rối; tồn kho & tổng luôn hiện số (kể cả 0).
const blankZero = (v: number) => (v ? numFmt(v) : "");
const banhLabel = (v: number) => (v ? numFmt(v) : "");

function renderDailyReportPage(
  doc: jsPDF,
  data: DailyReportData,
  inputs: DailyReportInputs,
  level: number,
): number {
  const d = DENSITY[level];
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const bodyStyles = {
    font: PDF_FONT_NAME,
    fontSize: d.fontSize,
    cellPadding: d.pad,
    valign: "middle" as const,
    halign: "center" as const,
    lineColor: INK,
    lineWidth: 0.2,
    textColor: INK,
    overflow: "linebreak" as const,
  };
  const headStyles = {
    fillColor: [255, 255, 255] as [number, number, number],
    textColor: INK,
    fontStyle: "bold" as const,
    fontSize: d.headSize,
    halign: "center" as const,
    valign: "middle" as const,
    lineColor: INK,
    lineWidth: 0.25,
  };
  const margin = {
    left: PAGE_MARGIN,
    right: PAGE_MARGIN,
    bottom: FOOTER_RESERVE,
  };

  doc.setTextColor(...INK);
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(10);
  doc.text(COMPANY_LINE_1, PAGE_MARGIN, 12);
  doc.text(COMPANY_LINE_2, PAGE_MARGIN, 17);
  doc.setFontSize(13);
  doc.text(TITLE, pageW / 2, 24, { align: "center" });
  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(10);
  doc.text(`Ngày sản xuất: ${formatDay(data.ngay)}`, pageW / 2, 30, {
    align: "center",
  });

  // ── 1. Thành phẩm chế biến ──
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.text("1. Thành phẩm chế biến", PAGE_MARGIN, 37);
  doc.setFont(PDF_FONT_NAME, "normal");
  doc.text("ĐVT: kg", pageW - PAGE_MARGIN, 37, { align: "right" });

  const stock = data.stockRows;
  // Mẫu gốc ghi đầy đủ CSR/Nguồn gốc/Bọc ở mọi dòng — không dùng dấu " như F11.
  const stockCells = stock.map((r, i) => [
    String(i + 1),
    r.loaiCsr,
    r.nguonGoc,
    r.boc,
    banhLabel(r.loaiBanh),
    blankZero(r.nhapBanh),
    blankZero(r.nhapKg),
    blankZero(r.nhapThangKg),
    blankZero(r.nhapNamKg),
    blankZero(r.xuatKg),
    blankZero(r.xuatThangKg),
    blankZero(r.xuatNamKg),
    numFmt(r.tonKg),
    "",
  ]);
  const sum = (pick: (r: (typeof stock)[number]) => number) =>
    stock.reduce((s, r) => s + pick(r), 0);
  const stockBody: RowInput[] =
    stockCells.length > 0
      ? [
          ...stockCells,
          [
            {
              content: "Tổng cộng",
              colSpan: 5,
              styles: { halign: "left" as const },
            },
            numFmt(sum((r) => r.nhapBanh)),
            numFmt(sum((r) => r.nhapKg)),
            numFmt(sum((r) => r.nhapThangKg)),
            numFmt(sum((r) => r.nhapNamKg)),
            numFmt(sum((r) => r.xuatKg)),
            numFmt(sum((r) => r.xuatThangKg)),
            numFmt(sum((r) => r.xuatNamKg)),
            numFmt(sum((r) => r.tonKg)),
            "",
          ],
        ]
      : [[{ content: "Không có thành phẩm phát sinh trong năm", colSpan: 14 }]];
  const stockTotalIndex = stockCells.length > 0 ? stockBody.length - 1 : -1;

  // Tổng 277mm: 8+16+17+44+12 | 14+19 | 20+22 | 18 | 20+22 | 21 | 24
  autoTable(doc, {
    startY: 39,
    margin,
    pageBreak: "avoid",
    head: [
      [
        { content: "STT", rowSpan: 2 },
        { content: "Loại CSR", rowSpan: 2 },
        { content: "Nguồn gốc", rowSpan: 2 },
        { content: "Bọc", rowSpan: 2 },
        { content: "Loại bành", rowSpan: 2 },
        { content: "Nhập kho", colSpan: 2 },
        { content: "Lũy kế nhập", colSpan: 2 },
        { content: "Xuất kho", rowSpan: 2 },
        { content: "Lũy kế xuất kho", colSpan: 2 },
        { content: "Tồn kho", rowSpan: 2 },
        { content: "Ghi chú", rowSpan: 2 },
      ],
      ["Số bành", "Số kg", "Tháng", "Năm", "Tháng", "Năm"],
    ],
    body: stockBody,
    theme: "grid",
    styles: bodyStyles,
    headStyles,
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 16 },
      2: { cellWidth: 17 },
      3: { cellWidth: 44, halign: "left" },
      4: { cellWidth: 12 },
      5: { cellWidth: 14, halign: "right" },
      6: { cellWidth: 19, halign: "right" },
      7: { cellWidth: 20, halign: "right" },
      8: { cellWidth: 22, halign: "right" },
      9: { cellWidth: 18, halign: "right" },
      10: { cellWidth: 20, halign: "right" },
      11: { cellWidth: 22, halign: "right" },
      12: { cellWidth: 21, halign: "right" },
      13: { cellWidth: 24, halign: "left" },
    },
    didParseCell: (hook) => {
      if (hook.section === "body" && hook.row.index === stockTotalIndex) {
        hook.cell.styles.fontStyle = "bold";
        hook.cell.styles.fillColor = [241, 245, 249];
      }
      // Tồn âm = dữ liệu lệch (xuất nhiều hơn nhập/tồn chốt) → tô đỏ để lộ ra, không che bằng 0.
      if (hook.section === "body" && hook.column.index === 12) {
        const value =
          hook.row.index === stockTotalIndex
            ? sum((r) => r.tonKg)
            : stock[hook.row.index]?.tonKg;
        if (typeof value === "number" && value < 0) hook.cell.styles.textColor = [220, 38, 38];
      }
    },
  });

  // Ghi chú nguồn số tồn + đơn xuất trỏ lô không còn tồn tại.
  let noteY = ((doc as PdfWithTable).lastAutoTable?.finalY ?? 60) + 3.2;
  const notes: string[] = [
    data.ngayChotTon
      ? `Tồn kho tính từ số chốt kiểm kê ngày ${formatDay(data.ngayChotTon)} + nhập − xuất sau ngày chốt.`
      : "Chưa chốt tồn đầu kỳ — tồn kho tự tính từ toàn bộ dữ liệu nhập/xuất trong hệ thống.",
  ];
  if (data.unmatchedExport.bales > 0) {
    notes.push(
      `Có ${numFmt(data.unmatchedExport.bales)} bành trong ${data.unmatchedExport.orderCount} đơn xuất trỏ tới lô không còn tồn tại — chưa trừ vào tồn kho.`,
    );
  }
  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(7.5);
  for (const note of notes) {
    doc.setTextColor(...(note.startsWith("Có ") ? ([220, 38, 38] as [number, number, number]) : INK));
    doc.text(note, PAGE_MARGIN, noteY);
    noteY += 3.4;
  }
  doc.setTextColor(...INK);

  // ── 2. Chi tiết sản xuất, sử dụng nhiên liệu ──
  let y = noteY - 3.4 + d.gap;
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text("2. Chi tiết sản xuất, sử dụng nhiên liệu", PAGE_MARGIN, y);
  y += 2;

  const detailRows: string[][] = data.shiftRows.map((r) => [
    "",
    `Khối lượng sản xuất Ca ${r.ca}${r.caName ? ` (${r.caName})` : ""} – ${r.loaiCsr}`,
    "kg",
    numFmt(r.soBanh),
    banhLabel(r.loaiBanh),
    numFmt(r.soKg),
    numFmt(r.luyKeThangKg),
    numFmt(r.luyKeNamKg),
    "",
  ]);
  const doLit = Math.max(0, Number(inputs.doLit) || 0);
  detailRows.push([
    "",
    "Dầu Diesel sử dụng",
    "lít",
    "",
    "",
    numFmt(doLit),
    numFmt(data.doPriorMonth + doLit),
    numFmt(data.doPriorYear + doLit),
    inputs.doGhiChu.trim(),
  ]);
  detailRows.forEach((row, i) => {
    row[0] = String(i + 1);
  });

  // Tổng 277mm: 8+80+14+18+18+26+28+30+55
  autoTable(doc, {
    startY: y,
    margin,
    pageBreak: "avoid",
    head: [
      [
        { content: "STT", rowSpan: 2 },
        { content: "Nội dung", rowSpan: 2 },
        { content: "ĐVT", rowSpan: 2 },
        { content: "Số bành", rowSpan: 2 },
        { content: "Loại bành", rowSpan: 2 },
        { content: "Số lượng", rowSpan: 2 },
        { content: "Lũy kế", colSpan: 2 },
        { content: "Ghi chú", rowSpan: 2 },
      ],
      ["Tháng", "Năm"],
    ],
    body: detailRows,
    theme: "grid",
    styles: bodyStyles,
    headStyles,
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 80, halign: "left" },
      2: { cellWidth: 14 },
      3: { cellWidth: 18, halign: "right" },
      4: { cellWidth: 18 },
      5: { cellWidth: 26, halign: "right" },
      6: { cellWidth: 28, halign: "right" },
      7: { cellWidth: 30, halign: "right" },
      8: { cellWidth: 55, halign: "left" },
    },
  });

  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text(DOC_CODE_LINE, PAGE_MARGIN, pageH - 8);

  return (doc as PdfWithTable).lastAutoTable?.finalY ?? 0;
}

function newLandscapeDoc(): jsPDF {
  return new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
}

// Chọn mức mật độ thoáng nhất mà phiếu vẫn vừa đúng 1 trang. Nếu kể cả mức chật nhất vẫn tràn thì
// giữ mức chật nhất (trường hợp cực hiếm — vài chục tổ hợp sản phẩm).
async function pickDensityLevel(
  data: DailyReportData,
  inputs: DailyReportInputs,
): Promise<number> {
  for (let level = 0; level < DENSITY.length; level++) {
    const doc = newLandscapeDoc();
    await ensurePdfFont(doc);
    const finalY = renderDailyReportPage(doc, data, inputs, level);
    const pageH = doc.internal.pageSize.getHeight();
    if (doc.getNumberOfPages() === 1 && finalY <= pageH - FOOTER_RESERVE)
      return level;
  }
  return DENSITY.length - 1;
}

export async function buildDailyReportPdf(
  data: DailyReportData,
  inputs: DailyReportInputs,
): Promise<jsPDF> {
  const level = await pickDensityLevel(data, inputs);
  const doc = newLandscapeDoc();
  await ensurePdfFont(doc);
  renderDailyReportPage(doc, data, inputs, level);
  return doc;
}

// File PDF tải về: F11 (dọc) + 1 trang F12 (ngang) trong cùng 1 file.
export async function buildLotAndDailyReportPdf(
  shiftData: ShiftReportData,
  dailyData: DailyReportData,
  inputs: DailyReportInputs,
): Promise<jsPDF> {
  const level = await pickDensityLevel(dailyData, inputs);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await ensurePdfFont(doc);
  renderLotReport(doc, shiftData);
  doc.addPage("a4", "landscape");
  renderDailyReportPage(doc, dailyData, inputs, level);
  return doc;
}

export function buildDailyReportFileName(data: DailyReportData): string {
  return `bao-cao-san-xuat-hang-ngay-${safeName(data.ngay.replace(/-/g, ""))}.pdf`;
}

export function buildLotAndDailyReportFileName(data: DailyReportData): string {
  return `bao-cao-lo-va-san-xuat-${safeName(data.ngay.replace(/-/g, ""))}.pdf`;
}
