// Báo cáo lô sản xuất (NMCB-QT01-F11) — mẫu thứ 2 đi kèm Phiếu báo thành phẩm (F09), bám sát
// `cung_cap_dl/NMCB-QT01-F11Báo cáo lô sản xuất.pdf`. Dựng từ cùng `ShiftReportData` nhưng là 1
// FILE RIÊNG. Mục 1 = các lô HOÀN THÀNH trong ngày (`completedLots`, theo lots.ngay_ht) + dòng
// "Tổng: N lô"; mục 2 = tổng hợp thành phẩm SẢN XUẤT trong ngày (`byGroup`, theo giao dịch).
//
// Quy ước của mẫu giấy: ô có giá trị trùng với dòng liền trên được thay bằng dấu " cho đỡ rối.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_NAME, ensurePdfFont, safeName } from "@/lib/pdf-qr-shared";
import type { ShiftReportData } from "@/app/dashboard/product/confirm/actions";

const COMPANY_LINE = "NHÀ MÁY CHẾ BIẾN PHƯỚC HÒA KAMPONG THOM";
const TITLE = "BÁO CÁO LÔ SẢN XUẤT";
const DOC_CODE_LINE = "NMCB-QT01-F11 (03-01/8/2026) Có hiệu lực";
const DITTO = '"';

const PAGE_LEFT = 14;
const FOOTER_RESERVE = 16; // chừa đáy trang cho footer mã tài liệu

type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

// "25/9/2026" — đúng định dạng mẫu (không đệm 0).
function formatDayShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
}

// Mẫu ghi "1636cs" — bỏ đuôi năm "/26".
function stripYear(maLo: string): string {
  return maLo.replace(/\/\d{2,4}$/, "");
}

// Gộp tập giá trị theo đúng thứ tự xuất hiện, nối bằng "/" như mẫu ("Sắt đế gỗ/Sắt mỏng").
function joinUnique(values: string[]): string {
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.join("/");
}

function formatBanh(v: number): string {
  return v ? String(v) : "";
}

// Ô trùng dòng liền trên (cùng cột, giá trị khác rỗng) → dấu ". So sánh với GIÁ TRỊ GỐC của dòng
// trên, không phải giá trị đã bị thay bằng " (tránh chuỗi dài bị ngắt khi dòng giữa là ").
function applyDitto(rows: string[][], cols: number[]): string[][] {
  return rows.map((row, i) => {
    if (i === 0) return row;
    const prev = rows[i - 1];
    return row.map((cell, c) => (cols.includes(c) && cell !== "" && cell === prev[c] ? DITTO : cell));
  });
}

function ensurePageSpace(doc: jsPDF, y: number, minSpace: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + minSpace > pageH - FOOTER_RESERVE) {
    doc.addPage();
    return 16;
  }
  return y;
}

function renderFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFont(PDF_FONT_NAME, "normal");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(DOC_CODE_LINE, PAGE_LEFT, pageH - 8);
  }
}

const bodyStyles = {
  font: PDF_FONT_NAME,
  fontSize: 8.4,
  cellPadding: 1.6,
  valign: "middle" as const,
  halign: "center" as const,
  lineColor: [15, 23, 42] as [number, number, number],
  lineWidth: 0.2,
  textColor: [15, 23, 42] as [number, number, number],
  overflow: "linebreak" as const,
};
const headStyles = {
  fillColor: [255, 255, 255] as [number, number, number],
  textColor: [15, 23, 42] as [number, number, number],
  fontStyle: "bold" as const,
  fontSize: 8.6,
  halign: "center" as const,
  valign: "middle" as const,
  lineColor: [15, 23, 42] as [number, number, number],
  lineWidth: 0.25,
};

export async function buildLotReportPdf(data: ShiftReportData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await ensurePdfFont(doc);
  const pageW = doc.internal.pageSize.getWidth();

  doc.setTextColor(15, 23, 42);
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(10.5);
  doc.text(COMPANY_LINE, PAGE_LEFT, 15);
  doc.setFontSize(13);
  doc.text(TITLE, pageW / 2, 22, { align: "center" });
  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(10);
  doc.text(`Ngày: ${formatDayShort(data.ngay)}`, pageW - PAGE_LEFT - 40, 29);

  // ── 1. Tên lô sản xuất ──
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(10);
  doc.text("1. Tên lô sản xuất", PAGE_LEFT, 36);

  // Chỉ lô HOÀN THÀNH (tròn lô) trong ngày báo cáo — xem loadCompletedLotsForDay (actions.ts).
  const lots = [...data.completedLots].sort((a, b) => a.num - b.num || a.maLo.localeCompare(b.maLo));
  const lotRows = applyDitto(
    lots.map((l) => ["", l.loaiCsr || "—", stripYear(l.maLo), formatBanh(l.loaiBanh), l.boc, l.pallet, l.ghiChu]),
    [1, 3, 4, 5],
  ).map((row, i) => {
    row[0] = String(i + 1);
    return row;
  });
  const lotBody =
    lotRows.length > 0
      ? [...lotRows, [{ content: `Tổng: ${lots.length} lô`, colSpan: 3, styles: { halign: "left" as const } }, "", "", "", ""]]
      : [["", "", "", "", "Không có lô nào hoàn thành trong ngày", "", ""]];
  const lotTotalIndex = lotRows.length > 0 ? lotBody.length - 1 : -1;

  // Tổng 182mm: 10 + 20 + 24 + 16 + 44 + 34 + 34
  autoTable(doc, {
    startY: 39,
    margin: { left: PAGE_LEFT, right: PAGE_LEFT, bottom: FOOTER_RESERVE },
    head: [["TT", "Sản phẩm", "Tên lô nhà máy", "Loại bành (kg)", "Bọc PE (mm)", "Loại pallet", "Ghi chú"]],
    body: lotBody,
    theme: "grid",
    styles: bodyStyles,
    headStyles,
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 20 },
      2: { cellWidth: 24 },
      3: { cellWidth: 16 },
      4: { cellWidth: 44 },
      5: { cellWidth: 34 },
      6: { cellWidth: 34, halign: "left" },
    },
    didParseCell: (hookData) => {
      if (hookData.section !== "body" || hookData.row.index !== lotTotalIndex) return;
      hookData.cell.styles.fontStyle = "bold";
      hookData.cell.styles.fillColor = [241, 245, 249];
    },
  });

  // ── 2. Tổng hợp thành phẩm sản xuất trong ngày ──
  let y = ((doc as PdfWithTable).lastAutoTable?.finalY ?? 60) + 8;
  y = ensurePageSpace(doc, y, 28);
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("2. Tổng hợp thành phẩm sản xuất trong ngày", PAGE_LEFT, y);

  const groups = [...data.byGroup].sort(
    (a, b) =>
      a.loaiCsr.localeCompare(b.loaiCsr) ||
      a.loaiBanh - b.loaiBanh ||
      a.boc.localeCompare(b.boc) ||
      a.pallet.localeCompare(b.pallet),
  );
  const groupRows = applyDitto(
    groups.map((g) => [
      "",
      g.loaiCsr || "—",
      formatBanh(g.loaiBanh),
      g.boc,
      joinUnique(g.pallet.split(",")),
      g.soBanh.toLocaleString("vi-VN"),
      g.soKg.toLocaleString("vi-VN"),
    ]),
    [1, 2, 3],
  ).map((row, i) => {
    row[0] = String(i + 1);
    return row;
  });
  groupRows.push(["Cộng", "", "", "", "", data.tongBanh.toLocaleString("vi-VN"), data.tongKg.toLocaleString("vi-VN")]);
  const congIndex = groupRows.length - 1;

  // Tổng 182mm: 10 + 26 + 16 + 50 + 34 + 20 + 26
  autoTable(doc, {
    startY: y + 3,
    margin: { left: PAGE_LEFT, right: PAGE_LEFT, bottom: FOOTER_RESERVE },
    head: [
      [
        { content: "TT", rowSpan: 2 },
        { content: "Thành phẩm", colSpan: 4 },
        { content: "Khối lượng", colSpan: 2 },
      ],
      ["Loại sản phẩm", "Loại bành", "Bọc PE", "Loại pallet", "Số bành", "Số kg"],
    ],
    body: groupRows,
    theme: "grid",
    styles: bodyStyles,
    headStyles,
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 26 },
      2: { cellWidth: 16 },
      3: { cellWidth: 50 },
      4: { cellWidth: 34 },
      5: { cellWidth: 20, halign: "right" },
      6: { cellWidth: 26, halign: "right" },
    },
    didParseCell: (hookData) => {
      if (hookData.section === "body" && hookData.row.index === congIndex) {
        hookData.cell.styles.fontStyle = "bold";
        if (hookData.column.index === 0) hookData.cell.styles.halign = "left";
      }
    },
  });

  renderFooter(doc);
  return doc;
}

export function buildLotReportFileName(data: ShiftReportData): string {
  return `bao-cao-lo-san-xuat-${safeName(data.ngay.replace(/-/g, ""))}.pdf`;
}
