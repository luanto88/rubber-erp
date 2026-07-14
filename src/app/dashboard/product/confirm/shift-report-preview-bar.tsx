"use client";

// Thanh hành động dùng chung sau khi phiếu báo thành phẩm đã được mở xem trước ở tab mới (mục 7)
// — Chia sẻ/Tải xuống đều dùng LẠI đúng jsPDF doc đã dựng, không dựng lại PDF. Dùng ở cả
// confirm/page.tsx (Hub "Xem/Tạo lại phiếu" + modal "Kết thúc ca") lẫn nút "Xem phiếu PDF" mới ở
// header nhóm ngày trong product/page.tsx.

import type jsPDF from "jspdf";
import { FileDown, Share2 } from "lucide-react";
import {
  downloadShiftReportPdfDoc,
  shareShiftReportPdfDoc,
} from "@/app/dashboard/product/confirm/shift-report-pdf";

export function ShiftReportPreviewBar({
  doc,
  fileName,
  hint = "Đã mở phiếu xem trước ở tab mới.",
  shareLabel = "Chia sẻ phiếu",
  downloadLabel = "Tải phiếu PDF",
}: {
  doc: jsPDF;
  fileName: string;
  hint?: string;
  shareLabel?: string;
  downloadLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <span className="text-xs font-semibold text-emerald-700">{hint}</span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => void shareShiftReportPdfDoc(doc, fileName)}
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
        >
          <Share2 size={13} /> {shareLabel}
        </button>
        <button
          type="button"
          onClick={() => downloadShiftReportPdfDoc(doc, fileName)}
          className="flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
        >
          <FileDown size={13} /> {downloadLabel}
        </button>
      </div>
    </div>
  );
}
