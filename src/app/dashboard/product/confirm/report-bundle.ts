// Gói 3 mẫu in cuối ngày dùng chung cho 3 luồng (Hub "Xem/Tạo lại phiếu", modal "Kết thúc ca",
// nút "Xem phiếu PDF" ở module Thành phẩm): F09 Phiếu báo thành phẩm, F11 Báo cáo lô sản xuất,
// F12 Báo cáo sản xuất hằng ngày. Luồng chuẩn:
//   1. loadReportDraft() — nạp dữ liệu F09/F11 + F12 song song.
//   2. Người dùng xác nhận số lít dầu DO + ghi chú (DailyReportInputForm) — F12 cần trước khi dựng.
//   3. buildReportBundle() — dựng cả 3 PDF 1 lần, mở F09 ở tab mới, trả bundle cho preview bar.
import type jsPDF from "jspdf";
import { loadShiftReportData, type ShiftReportData } from "@/app/dashboard/product/confirm/actions";
import {
  loadDailyProductionReportData,
  type DailyReportData,
} from "@/app/dashboard/product/confirm/daily-report-actions";
import {
  buildDailyReportFileName,
  buildDailyReportPdf,
  buildLotAndDailyReportFileName,
  buildLotAndDailyReportPdf,
  type DailyReportInputs,
} from "@/app/dashboard/product/confirm/daily-report-pdf";
import { buildLotReportFileName, buildLotReportPdf } from "@/app/dashboard/product/confirm/lot-report-pdf";
import {
  buildShiftReportFileName,
  buildShiftReportPdf,
  openShiftReportPdfInNewTab,
} from "@/app/dashboard/product/confirm/shift-report-pdf";

export type ReportDraft = { shift: ShiftReportData; daily: DailyReportData };

export type ReportBundle = {
  doc: jsPDF;
  fileName: string;
  lotDoc: jsPDF;
  lotFileName: string;
  dailyDoc: jsPDF;
  dailyFileName: string;
  lotBundleDoc: jsPDF;
  lotBundleFileName: string;
};

export async function loadReportDraft(factoryId: string, ngay: string): Promise<ReportDraft> {
  const [shift, daily] = await Promise.all([
    loadShiftReportData(factoryId, ngay),
    loadDailyProductionReportData(factoryId, ngay),
  ]);
  return { shift, daily };
}

export async function buildReportBundle(draft: ReportDraft, inputs: DailyReportInputs): Promise<ReportBundle> {
  const doc = await buildShiftReportPdf(draft.shift);
  const lotDoc = await buildLotReportPdf(draft.shift);
  const dailyDoc = await buildDailyReportPdf(draft.daily, inputs);
  const lotBundleDoc = await buildLotAndDailyReportPdf(draft.shift, draft.daily, inputs);
  openShiftReportPdfInNewTab(doc);
  return {
    doc,
    fileName: buildShiftReportFileName(draft.shift),
    lotDoc,
    lotFileName: buildLotReportFileName(draft.shift),
    dailyDoc,
    dailyFileName: buildDailyReportFileName(draft.daily),
    lotBundleDoc,
    lotBundleFileName: buildLotAndDailyReportFileName(draft.daily),
  };
}
