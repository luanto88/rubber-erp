"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

export type ReasonConfirmBannerLabels = {
  message: string;
  placeholder: string;
  confirm: string;
  back: string;
  saving: string;
};

export const DEFAULT_REASON_BANNER_LABELS: ReasonConfirmBannerLabels = {
  message: "Sửa dữ liệu đã gửi sẽ được ghi nhật ký — nhập lý do để lưu.",
  placeholder: "VD: nhập nhầm ngăn, sai số bành...",
  confirm: "Xác nhận lưu",
  back: "Quay lại",
  saving: "Đang lưu...",
};

/**
 * Banner cảnh báo hiện khi admin bấm Lưu thay đổi dữ liệu thành phẩm đã gửi: lý do được nhập NGAY
 * trong banner, chỉ nút "Xác nhận lưu" của banner mới gọi server (lý do ghi vào lot_admin_edits).
 */
export function ReasonConfirmBanner({
  value,
  onChange,
  onConfirm,
  onBack,
  saving,
  labels = DEFAULT_REASON_BANNER_LABELS,
}: {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onBack: () => void;
  saving: boolean;
  labels?: ReasonConfirmBannerLabels;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const canConfirm = value.trim().length > 0 && !saving;

  return (
    <div className="w-full rounded-xl border border-amber-300 bg-amber-50 p-3 text-left">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
        <p className="text-xs font-semibold text-amber-800">{labels.message}</p>
      </div>
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder={labels.placeholder}
        className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-white disabled:opacity-50"
        >
          {labels.back}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          {saving ? labels.saving : labels.confirm}
        </button>
      </div>
    </div>
  );
}
