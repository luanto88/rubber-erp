"use client";

// Thanh hành động dùng chung sau khi phiếu báo thành phẩm đã được mở xem trước ở tab mới (mục 7)
// — Chia sẻ/Tải xuống đều dùng LẠI đúng jsPDF doc đã dựng, không dựng lại PDF. Dùng ở cả
// confirm/page.tsx (Hub "Xem/Tạo lại phiếu" + modal "Kết thúc ca") lẫn nút "Xem phiếu PDF" ở
// header nhóm ngày trong product/page.tsx.
//
// 2 mẫu KHÁC NHAU, 2 file riêng: Phiếu báo thành phẩm (F09, `doc`) và Báo cáo lô sản xuất (F11,
// `lotDoc`, xem lot-report-pdf.ts). Mỗi nút chia sẻ gửi ẢNH của đúng 1 mẫu (ghép trang thành 1
// PNG dài — shareShiftReportImage). Icon tải tải CẢ 2 file PDF trong 1 lần bấm.
//
// 2026-09-27: thêm Báo cáo sản xuất hằng ngày (F12, `dailyDoc`) đi kèm F11. Nút "Báo cáo lô" chia
// sẻ 2 ẢNH TÁCH RỜI (F11 + F12); icon tải tải F09 + 1 file gộp F11/F12 (`lotBundleDoc`).

import { useState } from "react";
import type jsPDF from "jspdf";
import { FileDown, Loader2, Share2 } from "lucide-react";
import {
  downloadShiftReportPdfDoc,
  shareReportImages,
  shareShiftReportImage,
} from "@/app/dashboard/product/confirm/shift-report-pdf";

export function ShiftReportPreviewBar({
  doc,
  fileName,
  lotDoc,
  lotFileName,
  dailyDoc,
  dailyFileName,
  lotBundleDoc,
  lotBundleFileName,
  hint = "Đã mở phiếu xem trước ở tab mới.",
}: {
  doc: jsPDF;
  fileName: string;
  lotDoc: jsPDF;
  lotFileName: string;
  dailyDoc: jsPDF;
  dailyFileName: string;
  lotBundleDoc: jsPDF;
  lotBundleFileName: string;
  hint?: string;
}) {
  const [sharing, setSharing] = useState<"tp" | "lo" | null>(null);

  const handleShare = async (which: "tp" | "lo") => {
    setSharing(which);
    try {
      if (which === "tp") await shareShiftReportImage(doc, fileName);
      else
        await shareReportImages([
          { doc: lotDoc, fileName: lotFileName },
          { doc: dailyDoc, fileName: dailyFileName },
        ]);
    } finally {
      setSharing(null);
    }
  };

  const handleDownloadBoth = () => {
    downloadShiftReportPdfDoc(doc, fileName);
    // Một số trình duyệt bỏ qua lượt tải thứ 2 nếu bắn cùng 1 tick — tách nhẹ ra.
    window.setTimeout(() => downloadShiftReportPdfDoc(lotBundleDoc, lotBundleFileName), 400);
  };

  const shareBtn = (which: "tp" | "lo", label: string) => (
    <button
      type="button"
      disabled={sharing !== null}
      onClick={() => void handleShare(which)}
      title={which === "tp" ? "Chia sẻ Phiếu báo thành phẩm (ảnh)" : "Chia sẻ Báo cáo lô + Báo cáo sản xuất hằng ngày (2 ảnh)"}
      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
    >
      {sharing === which ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />} {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <span className="text-xs font-semibold text-emerald-700">{hint}</span>
      <div className="ml-auto flex items-center gap-2">
        {shareBtn("tp", "Thành phẩm")}
        {shareBtn("lo", "Báo cáo lô")}
        <button
          type="button"
          onClick={handleDownloadBoth}
          title="Tải PDF: Thành phẩm + (Báo cáo lô & Báo cáo sản xuất hằng ngày)"
          aria-label="Tải 2 phiếu PDF"
          className="flex items-center rounded-lg border border-emerald-300 bg-white p-1.5 text-emerald-700 hover:bg-emerald-100"
        >
          <FileDown size={15} />
        </button>
      </div>
    </div>
  );
}
