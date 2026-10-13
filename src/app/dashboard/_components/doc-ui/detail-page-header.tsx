"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import type { ReactNode } from "react"
import { DocCodePill } from "./doc-code-pill"

/**
 * Header trang chi tiết (Doc-UI, GĐ2): nút quay lại + tiêu đề + mã + chip phụ + hành động file.
 * Cố ý KHÔNG hiện badge trạng thái — trạng thái chỉ hiện 1 lần ở `StatusSummaryBar`.
 */
export function DetailPageHeader({
  backHref,
  onBack,
  backLabel = "Quay lại",
  eyebrow,
  title,
  code,
  subtitle,
  tags,
  actions,
}: {
  backHref?: string
  onBack?: () => void
  backLabel?: string
  eyebrow?: ReactNode
  title: ReactNode
  code?: string | null
  subtitle?: ReactNode
  tags?: ReactNode
  actions?: ReactNode
}) {
  const backCls =
    "grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {backHref ? (
          <Link href={backHref} className={backCls} title={backLabel} aria-label={backLabel}>
            <ArrowLeft size={17} />
          </Link>
        ) : onBack ? (
          <button type="button" onClick={onBack} className={backCls} title={backLabel} aria-label={backLabel}>
            <ArrowLeft size={17} />
          </button>
        ) : null}
        <div className="min-w-0">
          {eyebrow && <p className="text-[11px] font-bold uppercase tracking-wide text-brand-700">{eyebrow}</p>}
          <h1 className="text-[18px] font-extrabold leading-snug text-slate-900 [overflow-wrap:anywhere] sm:text-[20px]">
            {title}
          </h1>
          {(code || tags) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {code && <DocCodePill code={code} />}
              {tags}
            </div>
          )}
          {subtitle && <div className="mt-1 text-[12.5px] text-slate-500">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  )
}

/** Nút hành động phụ trong header (nền trắng viền slate, hoặc tone brand). */
export function HeaderButton({
  icon,
  label,
  onClick,
  href,
  target,
  disabled,
  title,
  tone = "neutral",
}: {
  icon?: ReactNode
  label: ReactNode
  onClick?: () => void
  href?: string
  target?: string
  disabled?: boolean
  title?: string
  tone?: "neutral" | "brand"
}) {
  const cls = `inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    tone === "brand"
      ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700"
      : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
  }`
  if (href && !disabled) {
    return (
      <a href={href} target={target} rel={target === "_blank" ? "noopener noreferrer" : undefined} className={cls} title={title}>
        {icon}
        {label}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} title={title}>
      {icon}
      {label}
    </button>
  )
}
