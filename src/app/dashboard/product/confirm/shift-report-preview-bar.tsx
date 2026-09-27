"use client";

// Thanh hành động sau khi mẫu báo cáo đã được mở xem trước ở tab mới — Chia sẻ/Tải xuống đều dùng
// LẠI đúng jsPDF doc đã dựng, không dựng lại PDF.
//
// Tách 2026-09-27 thành 2 thanh độc lập, khớp 2 hành động / 2 quyền (xem report-bundle.ts):
//   - ShiftReportPreviewBar: Phiếu báo thành phẩm F09 — chia sẻ 1 ảnh + tải 1 PDF.
//   - DailyReportPreviewBar: Báo cáo lô F11 + Báo cáo sản xuất hằng ngày F12 — chia sẻ 2 ẢNH TÁCH
//     RỜI, tải 1 file PDF gộp F11 (dọc) + F12 (ngang).

import { useState } from "react";
import type jsPDF from "jspdf";
import { FileDown, Loader2, Share2 } from "lucide-react";
import {
  downloadShiftReportPdfDoc,
  shareReportImages,
  shareShiftReportImage,
} from "@/app/dashboard/product/confirm/shift-report-pdf";

function PreviewBarShell({
  hint,
  sharing,
  onShare,
  shareLabel,
  shareTitle,
  onDownload,
  downloadTitle,
}: {
  hint: string;
  sharing: boolean;
  onShare: () => void;
  shareLabel: string;
  shareTitle: string;
  onDownload: () => void;
  downloadTitle: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <span className="text-xs font-semibold text-emerald-700">{hint}</span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          disabled={sharing}
          onClick={onShare}
          title={shareTitle}
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {sharing ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />} {shareLabel}
        </button>
        <button
          type="button"
          onClick={onDownload}
          title={downloadTitle}
          aria-label={downloadTitle}
          className="flex items-center rounded-lg border border-emerald-300 bg-white p-1.5 text-emerald-700 hover:bg-emerald-100"
        >
          <FileDown size={15} />
        </button>
      </div>
    </div>
  );
}

export function ShiftReportPreviewBar({
  doc,
  fileName,
  hint = "Đã mở Phiếu báo thành phẩm ở tab mới.",
}: {
  doc: jsPDF;
  fileName: string;
  hint?: string;
}) {
  const [sharing, setSharing] = useState(false);
  const handleShare = async () => {
    setSharing(true);
    try {
      await shareShiftReportImage(doc, fileName);
    } finally {
      setSharing(false);
    }
  };
  return (
    <PreviewBarShell
      hint={hint}
      sharing={sharing}
      onShare={() => void handleShare()}
      shareLabel="Chia sẻ ảnh"
      shareTitle="Chia sẻ Phiếu báo thành phẩm (ảnh)"
      onDownload={() => downloadShiftReportPdfDoc(doc, fileName)}
      downloadTitle="Tải PDF Phiếu báo thành phẩm"
    />
  );
}

export function DailyReportPreviewBar({
  lotDoc,
  lotFileName,
  dailyDoc,
  dailyFileName,
  lotBundleDoc,
  lotBundleFileName,
  hint = "Đã mở Báo cáo lô + Báo cáo sản xuất hằng ngày ở tab mới.",
}: {
  lotDoc: jsPDF;
  lotFileName: string;
  dailyDoc: jsPDF;
  dailyFileName: string;
  lotBundleDoc: jsPDF;
  lotBundleFileName: string;
  hint?: string;
}) {
  const [sharing, setSharing] = useState(false);
  const handleShare = async () => {
    setSharing(true);
    try {
      await shareReportImages([
        { doc: lotDoc, fileName: lotFileName },
        { doc: dailyDoc, fileName: dailyFileName },
      ]);
    } finally {
      setSharing(false);
    }
  };
  return (
    <PreviewBarShell
      hint={hint}
      sharing={sharing}
      onShare={() => void handleShare()}
      shareLabel="Chia sẻ 2 ảnh"
      shareTitle="Chia sẻ Báo cáo lô + Báo cáo sản xuất hằng ngày (2 ảnh)"
      onDownload={() => downloadShiftReportPdfDoc(lotBundleDoc, lotBundleFileName)}
      downloadTitle="Tải PDF Báo cáo lô + Báo cáo sản xuất hằng ngày"
    />
  );
}
