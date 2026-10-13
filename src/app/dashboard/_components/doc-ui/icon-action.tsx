"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import type { MouseEvent } from "react"

export type IconActionTone = "brand" | "danger" | "amber" | "sky" | "neutral"

// Class literal để Tailwind quét được.
const TONE_HOVER: Record<IconActionTone, string> = {
  brand: "hover:bg-brand-50 hover:text-brand-700",
  danger: "hover:bg-red-50 hover:text-red-600",
  amber: "hover:bg-amber-50 hover:text-amber-700",
  sky: "hover:bg-sky-50 hover:text-sky-700",
  neutral: "hover:bg-slate-100 hover:text-slate-800",
}

/**
 * Nút icon trong dòng bảng (Doc-UI): 32px, xám khi nghỉ, tô màu theo tone khi hover.
 * Luôn có `aria-label` + `title` (bỏ chữ thì không được mất thông tin).
 */
export function IconAction({
  icon: Icon,
  label,
  tone = "brand",
  onClick,
  href,
  target,
  disabled = false,
  loading = false,
  stopPropagation = true,
}: {
  icon: LucideIcon
  label: string
  tone?: IconActionTone
  onClick?: (e: MouseEvent) => void
  href?: string
  target?: string
  disabled?: boolean
  loading?: boolean
  stopPropagation?: boolean
}) {
  const cls = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors ${TONE_HOVER[tone]} ${
    disabled || loading ? "pointer-events-none opacity-40" : ""
  }`
  const content = loading ? (
    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
  ) : (
    <Icon size={16} />
  )
  if (href && !disabled) {
    return (
      <Link
        href={href}
        target={target}
        aria-label={label}
        title={label}
        className={cls}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation()
          onClick?.(e)
        }}
      >
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={cls}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation()
        onClick?.(e)
      }}
    >
      {content}
    </button>
  )
}

/** Cụm nút icon canh phải trong cột "Thao tác". */
export function IconActionGroup({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex items-center justify-end gap-0.5 ${className}`}>{children}</div>
}
