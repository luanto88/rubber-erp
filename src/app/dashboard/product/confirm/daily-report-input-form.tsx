"use client";

// Bước nhập liệu bắt buộc trước khi dựng Báo cáo sản xuất hằng ngày (F12): số lít dầu DO (gợi ý từ
// xuất kho DO750K trong ngày, sửa được) + ghi chú của dòng dầu. KHÔNG lưu DB (đã chốt với người
// dùng) — mỗi lần tạo phiếu đều gợi ý lại từ xuất kho. Render inline (không phải modal) để nhúng
// được vào cả modal "Xem phiếu PDF", modal "Kết thúc ca" lẫn Hub mà không chồng modal.

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { DailyReportData } from "@/app/dashboard/product/confirm/daily-report-actions";
import type { DailyReportInputs } from "@/app/dashboard/product/confirm/daily-report-pdf";

const fmt = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function DailyReportInputForm({
  data,
  submitting,
  onSubmit,
  onCancel,
  notice,
}: {
  data: DailyReportData;
  submitting: boolean;
  onSubmit: (inputs: DailyReportInputs) => void;
  onCancel?: () => void;
  /** GĐ7b: nhắc khi lần nhập này sẽ tạo bản cứng (ngày đã khóa đủ ca). */
  notice?: string | null;
}) {
  const [doText, setDoText] = useState(String(data.doSuggestToday || 0));
  const [ghiChu, setGhiChu] = useState("");

  const parsed = Number(doText.replace(",", "."));
  const valid = doText.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
  const doLit = valid ? parsed : 0;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div>
        <p className="text-sm font-bold text-slate-800">Báo cáo sản xuất hằng ngày — {formatDay(data.ngay)}</p>
        <p className="text-xs text-slate-500">Xác nhận dầu Diesel sử dụng trước khi tạo phiếu.</p>
        {notice && (
          <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700">
            {notice}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-slate-600">Dầu DO sử dụng (lít) *</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={doText}
            onChange={(e) => setDoText(e.target.value)}
            className={`w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-emerald-500 ${valid ? "border-slate-300" : "border-red-400"}`}
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Gợi ý từ xuất kho DO750K trong ngày: <b>{fmt(data.doSuggestToday)}</b> lít
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-slate-600">Ghi chú (dòng dầu)</span>
          <input
            type="text"
            value={ghiChu}
            onChange={(e) => setGhiChu(e.target.value)}
            placeholder="VD: Chạy máy phát 10 tiếng"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span>
          Lũy kế tháng: <b className="text-slate-800">{fmt(data.doPriorMonth + doLit)}</b> lít
        </span>
        <span>
          Lũy kế năm: <b className="text-slate-800">{fmt(data.doPriorYear + doLit)}</b> lít
        </span>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
          >
            Hủy
          </button>
        )}
        <button
          type="button"
          disabled={!valid || submitting}
          onClick={() => onSubmit({ doLit, doGhiChu: ghiChu })}
          className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Tạo phiếu
        </button>
      </div>
    </div>
  );
}
