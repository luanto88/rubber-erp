"use client"

import { useEffect, type ReactNode } from "react"
import { X } from "lucide-react"

const MAX_WIDTH_CLASS: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
}

type ModalShellProps = {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  maxWidth?: keyof typeof MAX_WIDTH_CLASS
  closeOnBackdrop?: boolean
  bodyClassName?: string
  zIndexClassName?: string
}

/**
 * Modal chuẩn dùng chung: header sticky (tiêu đề + nút đóng), body cuộn riêng,
 * footer sticky tùy chọn cho các nút hành động (Lưu/Hủy...) để luôn nhìn thấy trên mobile
 * mà không cần cuộn hết form dài. Trên desktop hành vi giữ như modal centered hiện có.
 */
export function ModalShell({
  title,
  onClose,
  children,
  footer,
  maxWidth = "lg",
  closeOnBackdrop = true,
  bodyClassName = "",
  zIndexClassName = "z-50",
}: ModalShellProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div
      className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center bg-black/50 p-0 sm:p-4`}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`flex max-h-[100dvh] w-full ${MAX_WIDTH_CLASS[maxWidth]} flex-col overflow-hidden rounded-none bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl`}
      >
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 rounded-t-none border-b border-slate-200 bg-white px-4 py-4 sm:rounded-t-2xl sm:px-6">
          <h2 className="text-base font-extrabold text-slate-800 sm:text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl p-2 text-slate-500 hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        <div className={`flex-1 overflow-y-auto p-4 sm:p-6 ${bodyClassName}`}>{children}</div>

        {footer && (
          <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-end gap-3 rounded-b-none border-t border-slate-200 bg-white px-4 py-4 sm:rounded-b-2xl sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
