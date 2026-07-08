"use client"

import { useEffect } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

export default function ProductLabelError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Ghi log nội bộ cho việc điều tra sau này — không hiển thị ra UI cho người quét QR.
    console.error("product-label lookup error:", error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-500">
          <AlertTriangle size={28} strokeWidth={2} />
        </div>
        <p className="text-sm font-semibold leading-relaxed text-slate-600">
          Không tìm thấy thông tin kiện mủ hoặc đường link bị hỏng. Vui lòng kiểm tra và quét lại mã QR.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700"
        >
          <RotateCcw size={16} />
          Thử lại
        </button>
      </div>
    </div>
  )
}
