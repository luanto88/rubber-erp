"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Loader2, X } from "lucide-react"

/**
 * Hộp xác nhận nổi cho thao tác nguy hiểm (huỷ / xoá / đảo ngược), có ô lý do.
 * Desktop: hộp giữa màn hình. Mobile: tấm trượt từ đáy. Render qua portal ra `document.body`.
 * Enter = xác nhận (Shift+Enter xuống dòng trong ô lý do), Esc / bấm nền = thôi.
 * `requireReason` ⇒ khoá nút xác nhận khi lý do rỗng.
 */
export function ReasonConfirmDialog({
  title,
  subtitle,
  points,
  reasonLabel = "Lý do",
  reasonPlaceholder = "Nhập lý do...",
  requireReason = true,
  showReason = true,
  confirmLabel,
  busyLabel = "Đang xử lý...",
  busy,
  onConfirm,
  onCancel,
}: {
  title: string
  subtitle?: ReactNode
  points: ReactNode[]
  reasonLabel?: string
  reasonPlaceholder?: string
  requireReason?: boolean
  showReason?: boolean
  confirmLabel: string
  busyLabel?: string
  busy: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState("")
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const canConfirm = !busy && (!showReason || !requireReason || reason.trim().length > 0)
  // Ref giữ giá trị mới nhất để listener phím chỉ đăng ký 1 lần.
  const stateRef = useRef({ onConfirm, onCancel, busy, canConfirm, reason })
  useEffect(() => {
    stateRef.current = { onConfirm, onCancel, busy, canConfirm, reason }
  })

  useEffect(() => {
    if (showReason) reasonRef.current?.focus({ preventScroll: true })
    else confirmRef.current?.focus({ preventScroll: true })
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return
      const s = stateRef.current
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        if (s.canConfirm) s.onConfirm(s.reason.trim())
      } else if (event.key === "Escape") {
        event.preventDefault()
        if (!s.busy) s.onCancel()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [showReason])

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-extrabold text-slate-800">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[13px] text-slate-500 [overflow-wrap:anywhere]">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
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
          {showReason ? (
            <label className="mt-4 block">
              <span className="text-[13px] font-semibold text-slate-700">
                {reasonLabel}
                {requireReason ? <span className="text-red-600"> *</span> : null}
              </span>
              <textarea
                ref={reasonRef}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                placeholder={reasonPlaceholder}
                disabled={busy}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:bg-slate-50"
              />
              <span className="mt-1 block text-[11px] text-slate-400">Enter = xác nhận · Shift+Enter = xuống dòng · Esc = thôi</span>
            </label>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex sm:justify-end sm:px-5 sm:pb-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Thôi <span className="hidden text-[11px] font-normal text-slate-400 sm:inline">(Esc)</span>
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canConfirm}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-red-600 bg-red-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            {busy ? busyLabel : confirmLabel}
            {!busy ? <span className="hidden text-[11px] font-normal text-white/70 sm:inline">(Enter)</span> : null}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
