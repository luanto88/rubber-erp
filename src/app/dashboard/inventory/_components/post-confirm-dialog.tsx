"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, BookCheck, Loader2, X } from "lucide-react"

/**
 * Hộp xác nhận nổi trước khi Ghi sổ phiếu Nhập / Xuất / Chuyển kho.
 * Desktop: hộp giữa màn hình. Mobile: tấm trượt từ đáy (nút bấm nằm trong tầm ngón cái).
 * Enter = Xác nhận ghi sổ, Esc / bấm nền = Để sau. Render qua portal ra `document.body`
 * (tránh ancestor có transform/filter làm lệch `position: fixed`).
 */
export function PostConfirmDialog({
  title,
  points,
  warning,
  confirmLabel = "Xác nhận ghi sổ",
  posting,
  onConfirm,
  onCancel,
}: {
  title: ReactNode
  points: ReactNode[]
  warning?: ReactNode
  confirmLabel?: string
  posting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Ref giữ hàm mới nhất để listener phím chỉ đăng ký 1 lần.
  const handlersRef = useRef({ onConfirm, onCancel, posting })
  useEffect(() => {
    handlersRef.current = { onConfirm, onCancel, posting }
  })

  useEffect(() => {
    confirmRef.current?.focus({ preventScroll: true })
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return
      const { onConfirm: confirm, onCancel: cancel, posting: busy } = handlersRef.current
      if (event.key === "Enter") {
        event.preventDefault()
        if (!busy) confirm()
      } else if (event.key === "Escape") {
        event.preventDefault()
        if (!busy) cancel()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
      onClick={() => {
        if (!posting) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-extrabold text-slate-800">Xác nhận ghi sổ</h2>
            <p className="mt-0.5 text-[13px] text-slate-500 [overflow-wrap:anywhere]">{title}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={posting}
            aria-label="Đóng"
            className="shrink-0 rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-slate-700">
            {points.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
          {warning ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-700">
              {warning}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex sm:justify-end sm:px-5 sm:pb-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={posting}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Để sau <span className="hidden text-[11px] font-normal text-slate-400 sm:inline">(Esc)</span>
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={posting}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-brand-600 bg-brand-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {posting ? <Loader2 size={15} className="animate-spin" /> : <BookCheck size={15} />}
            {posting ? "Đang ghi sổ..." : confirmLabel}
            {!posting ? <span className="hidden text-[11px] font-normal text-white/70 sm:inline">(Enter)</span> : null}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
