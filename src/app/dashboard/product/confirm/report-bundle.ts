// 2 hành động báo cáo cuối ngày ĐỘC LẬP (tách 2026-09-27), dùng chung cho 3 luồng: Hub "Xem/Tạo lại
// phiếu", modal "Kết thúc ca" (chỉ Phiếu thành phẩm) và nút ở header nhóm ngày trong module Thành phẩm.
//
//   A. Phiếu thành phẩm (F09) — quyền TẠO thành phẩm (product.create | product.confirm_scan).
//      loadShiftReport() → buildShiftReport(). KHÔNG cần nhập dầu, KHÔNG dựng F11/F12.
//   B. Báo cáo ngày (F11 + F12) — quyền product.report_daily.
//      loadDailyReportDraft() → người dùng xác nhận dầu DO (DailyReportInputForm) → buildDailyReport().
//
// Server action tự kiểm quyền bằng access token của người gọi (report-access.ts) — ẩn nút ở UI chỉ
// là lớp thứ nhất.
import type jsPDF from "jspdf";
import { getFreshAuthSession } from "@/lib/auth";
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

export type ShiftReportBundle = { doc: jsPDF; fileName: string };

export type DailyReportDraft = { shift: ShiftReportData; daily: DailyReportData };

export type DailyReportBundle = {
  lotDoc: jsPDF;
  lotFileName: string;
  dailyDoc: jsPDF;
  dailyFileName: string;
  lotBundleDoc: jsPDF;
  lotBundleFileName: string;
};

async function getAccessToken(): Promise<string | null> {
  const session = await getFreshAuthSession();
  return session?.access_token ?? null;
}

export async function loadShiftReport(factoryId: string, ngay: string): Promise<ShiftReportData> {
  return loadShiftReportData(factoryId, ngay, await getAccessToken(), "shift");
}

export async function buildShiftReport(shift: ShiftReportData): Promise<ShiftReportBundle> {
  const doc = await buildShiftReportPdf(shift);
  openShiftReportPdfInNewTab(doc);
  return { doc, fileName: buildShiftReportFileName(shift) };
}

export async function loadDailyReportDraft(factoryId: string, ngay: string): Promise<DailyReportDraft> {
  const token = await getAccessToken();
  const [shift, daily] = await Promise.all([
    loadShiftReportData(factoryId, ngay, token, "daily"),
    loadDailyProductionReportData(factoryId, ngay, token),
  ]);
  return { shift, daily };
}

export async function buildDailyReport(
  draft: DailyReportDraft,
  inputs: DailyReportInputs,
): Promise<DailyReportBundle> {
  const lotDoc = await buildLotReportPdf(draft.shift);
  const dailyDoc = await buildDailyReportPdf(draft.daily, inputs);
  const lotBundleDoc = await buildLotAndDailyReportPdf(draft.shift, draft.daily, inputs);
  openShiftReportPdfInNewTab(lotBundleDoc);
  return {
    lotDoc,
    lotFileName: buildLotReportFileName(draft.shift),
    dailyDoc,
    dailyFileName: buildDailyReportFileName(draft.daily),
    lotBundleDoc,
    lotBundleFileName: buildLotAndDailyReportFileName(draft.daily),
  };
}
