"use client"

import { OpenExternalBrowser } from "./open-external-browser"

/**
 * Màn báo lỗi dùng chung cho `global-error.tsx` và `dashboard/error.tsx` — thay cho màn trắng khi
 * một lỗi JS làm sập trang (vd trình duyệt trong Telegram chặn bộ nhớ). Hiện thông điệp lỗi để
 * người dùng chụp gửi lại, kèm lối thoát: tải lại / mở bằng trình duyệt ngoài.
 */
export function AppErrorView({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-extrabold text-slate-800">Không mở được trang</h1>
        <p className="mt-1 text-sm text-slate-500">
          Trang gặp lỗi khi tải. Hãy thử tải lại; nếu vẫn lỗi, chụp màn hình này gửi quản trị viên.
        </p>
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-100 p-2 text-[11px] text-slate-600">
          {error?.message || "Lỗi không xác định"}
          {error?.digest ? `\nMã lỗi: ${error.digest}` : ""}
        </pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => (reset ? reset() : window.location.reload())}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
          >
            Thử lại
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Tải lại trang
          </button>
          <a
            href="/login"
            className="rounded-xl px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100"
          >
            Về đăng nhập
          </a>
        </div>
        <div className="mt-4">
          <OpenExternalBrowser force />
        </div>
      </div>
    </div>
  )
}
