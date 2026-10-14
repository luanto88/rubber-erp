"use client"

import { AlertTriangle, Inbox } from "lucide-react"

/**
 * Trạng thái danh sách dùng chung (U0) — 3 câu chuẩn. Quy tắc: lỗi tải KHÔNG được hiện như
 * "Không có dữ liệu" (xem CLAUDE.md mục 8.1); spinner chỉ khi request đang chạy thật.
 * `asRow` ⇒ render thành <tr><td colSpan> để đặt thẳng trong <tbody>.
 */
export function ListState({
  kind,
  message,
  onRetry,
  asRow,
  colSpan = 1,
}: {
  kind: "loading" | "empty" | "error"
  message?: string
  onRetry?: () => void
  asRow?: boolean
  colSpan?: number
}) {
  const text =
    message ??
    (kind === "loading" ? "Đang tải…" : kind === "empty" ? "Không có dữ liệu phù hợp" : "Không tải được dữ liệu")
  const inner = (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm ${
        kind === "error" ? "text-red-700" : "text-slate-500"
      }`}
    >
      {kind === "loading" && (
        <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
      )}
      {kind === "empty" && <Inbox size={28} className="text-slate-300" />}
      {kind === "error" && <AlertTriangle size={26} />}
      <span>{text}</span>
      {kind === "error" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-bold text-brand-800 hover:bg-brand-50"
        >
          Thử lại
        </button>
      )}
    </div>
  )
  if (asRow) {
    return (
      <tr>
        <td colSpan={colSpan} className="!p-0">
          {inner}
        </td>
      </tr>
    )
  }
  return inner
}
