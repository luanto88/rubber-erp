// 2 hành động báo cáo cuối ngày ĐỘC LẬP (tách 2026-09-27), dùng chung cho 3 luồng: Hub "Xem/Tạo lại
// phiếu", modal "Kết thúc ca" (chỉ Phiếu thành phẩm) và nút ở header nhóm ngày trong module Thành phẩm.
//
//   A. Phiếu thành phẩm (F09) — quyền TẠO thành phẩm (product.create | product.confirm_scan) hoặc
//      duyệt & khóa ca. openShiftReport(). KHÔNG cần nhập dầu.
//   B. Báo cáo ngày (F11 + F12) — quyền product.report_daily.
//      prepareDailyReport() → (bản cứng) hoặc người dùng xác nhận dầu DO → buildDailyReport().
//
// GĐ7b — BẢN CỨNG (xem report-snapshots.ts, rule 06 mục 4.15): ngày đã khóa đủ mọi ca thì lần render
// đầu tiên được lưu thành PDF bất biến; các lần sau (kể cả admin) nhận lại đúng bản đó. Muốn sửa: admin
// mở khóa → khóa lại → lần render kế tiếp tạo bản mới. Lỗi lưu bản cứng KHÔNG chặn người dùng xem PDF.
//
// Server action tự kiểm quyền bằng access token của người gọi (report-access.ts) — ẩn nút ở UI chỉ
// là lớp thứ nhất.
import type jsPDF from "jspdf";
import { getFreshAuthSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
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
  pdfSourceToBlob,
  type PdfSource,
} from "@/app/dashboard/product/confirm/shift-report-pdf";
import {
  finalizeReportSnapshot,
  getReportSnapshotUrl,
  loadDayLockState,
  prepareReportSnapshotUpload,
  type DayLockState,
  type ReportSnapshotInfo,
  type ReportSnapshotKind,
} from "@/app/dashboard/product/confirm/report-snapshots";

const SNAPSHOT_BUCKET = "product-shift-reports";

export type ShiftReportBundle = {
  doc: PdfSource;
  fileName: string;
  hint?: string;
  warning?: string | null;
};

export type DailyReportDraft = {
  factoryId?: string;
  shift: ShiftReportData;
  daily: DailyReportData;
  /** Trạng thái khóa lúc mở form — quyết định có lưu bản cứng sau khi dựng hay không. */
  lockState?: DayLockState | null;
  /** ≠ null khi lần nhập dầu này sẽ tạo bản cứng — hiện trong DailyReportInputForm. */
  notice?: string | null;
};

export type DailyReportBundle = {
  lotDoc: PdfSource;
  lotFileName: string;
  dailyDoc: PdfSource;
  dailyFileName: string;
  lotBundleDoc: PdfSource;
  lotBundleFileName: string;
  hint?: string;
  warning?: string | null;
};

async function getAccessToken(): Promise<string | null> {
  const session = await getFreshAuthSession();
  return session?.access_token ?? null;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

function formatStamp(info: ReportSnapshotInfo): string {
  const at = new Date(info.createdAt).toLocaleString("vi-VN");
  return `${at} – ${info.createdByName}`;
}

// ── Bản cứng: tải lên / tải về ──────────────────────────────────────────────────────────────────

/** Trạng thái khóa của ngày. Lỗi (thiếu quyền, mạng...) → null: coi như chưa khóa, render sống. */
export async function loadReportLockState(factoryId: string, ngay: string): Promise<DayLockState | null> {
  try {
    return await loadDayLockState(await getAccessToken(), factoryId, ngay);
  } catch {
    return null;
  }
}

async function saveReportSnapshot(
  factoryId: string,
  ngay: string,
  loai: ReportSnapshotKind,
  doc: PdfSource,
  fileName: string,
  inputs?: Record<string, unknown> | null,
): Promise<ReportSnapshotInfo> {
  const token = await getAccessToken();
  const { path, token: uploadToken } = await prepareReportSnapshotUpload(token, factoryId, ngay, loai);
  const { error } = await supabase.storage
    .from(SNAPSHOT_BUCKET)
    .uploadToSignedUrl(path, uploadToken, pdfSourceToBlob(doc), { contentType: "application/pdf" });
  if (error) throw new Error(error.message);
  return finalizeReportSnapshot(await getAccessToken(), factoryId, ngay, loai, path, fileName, inputs ?? null);
}

async function fetchSnapshotBlob(factoryId: string, snapshotId: string): Promise<Blob> {
  const url = await getReportSnapshotUrl(await getAccessToken(), factoryId, snapshotId);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được bản cứng (HTTP ${res.status}).`);
  return new Blob([await res.arrayBuffer()], { type: "application/pdf" });
}

/** Mở 1 bản cứng ở tab mới (dùng cho nút "Xem" trong modal khóa ca). */
export async function openReportSnapshot(factoryId: string, snapshotId: string): Promise<void> {
  openShiftReportPdfInNewTab(await fetchSnapshotBlob(factoryId, snapshotId));
}

// ── A. Phiếu thành phẩm F09 ─────────────────────────────────────────────────────────────────────

export async function loadShiftReport(factoryId: string, ngay: string): Promise<ShiftReportData> {
  return loadShiftReportData(factoryId, ngay, await getAccessToken(), "shift");
}

/** Dựng F09 từ dữ liệu sống (luồng "Kết thúc ca" — ca chưa khóa, không lưu bản cứng). */
export async function buildShiftReport(shift: ShiftReportData): Promise<ShiftReportBundle> {
  const doc = await buildShiftReportPdf(shift);
  openShiftReportPdfInNewTab(doc);
  return { doc, fileName: buildShiftReportFileName(shift) };
}

/**
 * Mở Phiếu thành phẩm của 1 ngày: ngày đã khóa đủ ca + có bản cứng → mở bản cứng; đã khóa + chưa
 * có → dựng rồi lưu bản cứng; chưa khóa → dựng sống. `null` = ngày không có dữ liệu.
 */
export async function openShiftReport(factoryId: string, ngay: string): Promise<ShiftReportBundle | null> {
  const lockState = await loadReportLockState(factoryId, ngay);
  const saved = lockState?.fullyLocked ? lockState.current.F09 : undefined;
  if (saved) {
    try {
      const blob = await fetchSnapshotBlob(factoryId, saved.id);
      openShiftReportPdfInNewTab(blob);
      return {
        doc: blob,
        fileName: saved.fileName,
        hint: `Bản cứng (ngày đã khóa đủ ca) — tạo ${formatStamp(saved)}.`,
      };
    } catch (err) {
      // Không đọc được bản cứng → vẫn dựng sống để người dùng có phiếu, kèm cảnh báo rõ.
      const live = await buildLiveShift(factoryId, ngay);
      return live && { ...live, warning: `Không mở được bản cứng: ${errorText(err)}. Đang hiển thị bản dựng lại.` };
    }
  }

  const live = await buildLiveShift(factoryId, ngay);
  if (!live) return null;
  if (!lockState?.fullyLocked) return live;
  if (lockState.unavailable) {
    return { ...live, warning: "Ngày đã khóa đủ ca nhưng chưa bật lưu bản cứng (chưa chạy migration 20261003)." };
  }
  try {
    const info = await saveReportSnapshot(factoryId, ngay, "F09", live.doc, live.fileName);
    return { ...live, hint: `Đã lưu bản cứng (ngày đã khóa đủ ca) — ${formatStamp(info)}.` };
  } catch (err) {
    return { ...live, warning: `Chưa lưu được bản cứng: ${errorText(err)}. Mở lại phiếu để thử lại.` };
  }
}

async function buildLiveShift(factoryId: string, ngay: string): Promise<ShiftReportBundle | null> {
  const shift = await loadShiftReport(factoryId, ngay);
  if (shift.sections.length === 0) return null;
  return buildShiftReport(shift);
}

// ── B. Báo cáo ngày F11 + F12 ────────────────────────────────────────────────────────────────────

export async function loadDailyReportDraft(factoryId: string, ngay: string): Promise<DailyReportDraft> {
  const token = await getAccessToken();
  const [shift, daily, lockState] = await Promise.all([
    loadShiftReportData(factoryId, ngay, token, "daily"),
    loadDailyProductionReportData(factoryId, ngay, token),
    loadReportLockState(factoryId, ngay),
  ]);
  return { factoryId, shift, daily, lockState };
}

export type DailyReportPreparation =
  | { kind: "snapshot"; bundle: DailyReportBundle }
  | { kind: "draft"; draft: DailyReportDraft }
  | { kind: "empty" };

/**
 * Bước đầu của "Báo cáo ngày": đã có bản cứng → mở luôn (không hỏi dầu); ngược lại trả draft để
 * người dùng xác nhận dầu DO (draft.notice ≠ null khi lần nhập này sẽ tạo bản cứng).
 */
export async function prepareDailyReport(factoryId: string, ngay: string): Promise<DailyReportPreparation> {
  const lockState = await loadReportLockState(factoryId, ngay);
  const cur = lockState?.fullyLocked ? lockState.current : {};
  if (cur.F11 && cur.F12 && cur.F11_F12) {
    try {
      const [lotDoc, dailyDoc, lotBundleDoc] = await Promise.all([
        fetchSnapshotBlob(factoryId, cur.F11.id),
        fetchSnapshotBlob(factoryId, cur.F12.id),
        fetchSnapshotBlob(factoryId, cur.F11_F12.id),
      ]);
      openShiftReportPdfInNewTab(lotBundleDoc);
      return {
        kind: "snapshot",
        bundle: {
          lotDoc,
          lotFileName: cur.F11.fileName,
          dailyDoc,
          dailyFileName: cur.F12.fileName,
          lotBundleDoc,
          lotBundleFileName: cur.F11_F12.fileName,
          hint: `Bản cứng (ngày đã khóa đủ ca) — tạo ${formatStamp(cur.F11_F12)}.`,
        },
      };
    } catch {
      // Rơi xuống form: bản cứng hỏng/không đọc được thì vẫn cho dựng sống (không lưu đè được vì
      // server từ chối khi đã có bản hiện hành).
    }
  }

  const token = await getAccessToken();
  const [shift, daily] = await Promise.all([
    loadShiftReportData(factoryId, ngay, token, "daily"),
    loadDailyProductionReportData(factoryId, ngay, token),
  ]);
  if (shift.sections.length === 0) return { kind: "empty" };
  const willSnapshot = !!lockState?.fullyLocked && !lockState.unavailable && !cur.F11_F12;
  const notice = willSnapshot
    ? "Ngày này đã khóa đủ các ca: số liệu nhập lần này sẽ được lưu thành BẢN CỨNG. Muốn sửa sau, admin phải mở khóa rồi khóa lại ca."
    : null;
  return { kind: "draft", draft: { factoryId, shift, daily, lockState, notice } };
}

export async function buildDailyReport(
  draft: DailyReportDraft,
  inputs: DailyReportInputs,
): Promise<DailyReportBundle> {
  const lotDoc = await buildLotReportPdf(draft.shift);
  const dailyDoc = await buildDailyReportPdf(draft.daily, inputs);
  const lotBundleDoc = await buildLotAndDailyReportPdf(draft.shift, draft.daily, inputs);
  openShiftReportPdfInNewTab(lotBundleDoc);
  const bundle: DailyReportBundle = {
    lotDoc,
    lotFileName: buildLotReportFileName(draft.shift),
    dailyDoc,
    dailyFileName: buildDailyReportFileName(draft.daily),
    lotBundleDoc,
    lotBundleFileName: buildLotAndDailyReportFileName(draft.daily),
  };

  const lockState = draft.lockState;
  const factoryId = draft.factoryId;
  if (!factoryId || !lockState?.fullyLocked || lockState.unavailable || lockState.current.F11_F12) return bundle;

  // Lưu F11, F12 rồi bản gộp cuối cùng — bản gộp là dấu "đủ bộ". Bỏ qua loại đã có (lần trước lưu
  // dở dang) vì server từ chối ghi đè bản hiện hành.
  const savedInputs = { doLit: inputs.doLit, doGhiChu: inputs.doGhiChu };
  const jobs: Array<[ReportSnapshotKind, jsPDF, string]> = [
    ["F11", lotDoc, bundle.lotFileName],
    ["F12", dailyDoc, bundle.dailyFileName],
    ["F11_F12", lotBundleDoc, bundle.lotBundleFileName],
  ];
  try {
    let last: ReportSnapshotInfo | null = null;
    for (const [loai, doc, fileName] of jobs) {
      if (lockState.current[loai]) continue;
      last = await saveReportSnapshot(factoryId, draft.daily.ngay, loai, doc, fileName, savedInputs);
    }
    if (last) bundle.hint = `Đã lưu bản cứng (ngày đã khóa đủ ca) — ${formatStamp(last)}.`;
  } catch (err) {
    bundle.warning = `Chưa lưu được bản cứng: ${errorText(err)}. Mở lại Báo cáo ngày để thử lại.`;
  }
  return bundle;
}
