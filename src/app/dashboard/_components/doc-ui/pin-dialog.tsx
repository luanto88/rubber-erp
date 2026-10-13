"use client"

import { useState, type ReactNode } from "react"
import { AlertTriangle, Eye, EyeOff, KeyRound, Loader2, type LucideIcon } from "lucide-react"
import { ModalShell } from "../modal-shell"

/**
 * Doc-UI GĐ4 — hộp nhập PIN dùng chung cho 3 trang chi tiết (Văn bản, Tài liệu ISO,
 * Hồ sơ thực hiện) và màn ký hàng loạt ISO.
 *
 * Chỉ là phần TRÌNH BÀY: không gọi API, không giữ PIN. Mọi logic xác thực / ký vẫn nằm ở
 * trang gọi (truyền qua `onConfirm`), nên đổi giao diện không đụng tới luồng ký.
 *
 * - Ô PIN chỉ nhận chữ số (tự lọc), tối đa 6, có nút ẩn/hiện, Enter = xác nhận.
 * - `children` hiển thị PHÍA TRÊN ô PIN (vd ô lý do trả về), `after` hiển thị phía dưới
 *   (vd ghi chú vị trí đã khoá, tiến độ ký hàng loạt).
 * - Đang `busy` thì khoá nút Xác nhận và không cho đóng hộp (tránh đóng giữa lúc đang ký).
 */
export function PinDialog({
  title,
  subtitle = "Nhập PIN ký duyệt để xác nhận",
  icon: Icon = KeyRound,
  label = "PIN ký duyệt",
  pin,
  onPinChange,
  error,
  busy = false,
  busyLabel = "Đang xử lý...",
  confirmLabel = "Xác nhận",
  confirmDisabled = false,
  onConfirm,
  onClose,
  cancelLabel = "Hủy",
  children,
  after,
  zIndexClassName,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: LucideIcon
  label?: string
  pin: string
  onPinChange: (value: string) => void
  error?: string | null
  busy?: boolean
  busyLabel?: string
  confirmLabel?: string
  confirmDisabled?: boolean
  onConfirm: () => void
  onClose: () => void
  cancelLabel?: string
  children?: ReactNode
  after?: ReactNode
  zIndexClassName?: string
}) {
  const [showPin, setShowPin] = useState(false)
  const disabled = busy || confirmDisabled
  const close = () => { if (!busy) onClose() }
  const submit = () => { if (!disabled) onConfirm() }

  return (
    <ModalShell
      title={
        <span className="flex items-center gap-3">
          <span className="rounded-xl bg-brand-50 p-2 ring-1 ring-brand-100">
            <Icon size={18} className="text-brand-700" />
          </span>
          <span>
            <span className="block font-extrabold text-slate-800">{title}</span>
            {subtitle && <span className="text-xs font-normal text-slate-500">{subtitle}</span>}
          </span>
        </span>
      }
      onClose={close}
      closeOnBackdrop={!busy}
      maxWidth="sm"
      zIndexClassName={zIndexClassName}
      footer={
        <>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={disabled}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-800 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:from-brand-700 hover:to-brand-900 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-600">{label}</label>
          <div className="relative">
            <input
              type={showPin ? "text" : "password"}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              disabled={busy}
              value={pin}
              onChange={(e) => onPinChange(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") submit() }}
              placeholder="4–6 chữ số"
              aria-invalid={!!error}
              className={`w-full rounded-xl border px-3 py-2.5 pr-10 text-center font-code text-lg tracking-[0.4em] outline-none transition-colors focus:ring-2 disabled:bg-slate-50 ${
                error
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500/15"
                  : "border-slate-300 focus:border-brand-500 focus:ring-brand-500/15"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPin((v) => !v)}
              aria-label={showPin ? "Ẩn PIN" : "Hiện PIN"}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600"
            >
              {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {error && (
            <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-red-600" role="alert">
              <AlertTriangle size={12} className="shrink-0" /> {error}
            </p>
          )}
        </div>
        {after}
      </div>
    </ModalShell>
  )
}
