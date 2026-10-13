"use client"

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { StatusBadge } from "./status-badge"
import type { StatusDomain } from "./status-registry"

/** Thẻ trong cột phải trang chi tiết (Doc-UI): header slate-50, body trắng. */
export function InspectorCard({
  title,
  icon: Icon,
  actions,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <h3 className="flex min-w-0 items-center gap-2 text-[13.5px] font-bold text-slate-800">
          {Icon && <Icon size={15} className="shrink-0 text-brand-600" />}
          <span className="truncate">{title}</span>
        </h3>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </header>
      <div className={`p-4 ${bodyClassName}`}>{children}</div>
    </section>
  )
}

/** Dòng nhãn / giá trị trong InspectorCard. */
export function MetaRow({
  label,
  value,
  mono = false,
}: {
  label: ReactNode
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-dashed border-slate-100 py-2 last:border-0">
      <dt className="shrink-0 text-[12px] font-medium text-slate-500">{label}</dt>
      <dd className={`min-w-0 text-right text-[13px] font-semibold text-slate-800 [overflow-wrap:anywhere] ${mono ? "font-code text-[12px]" : ""}`}>
        {value ?? <span className="text-slate-400">—</span>}
      </dd>
    </div>
  )
}

export function MetaList({ children }: { children: ReactNode }) {
  return <dl>{children}</dl>
}

/**
 * Thanh tóm tắt trạng thái — nơi DUY NHẤT hiển thị trạng thái ở trang chi tiết (theo mẫu
 * Preview: không lặp badge trạng thái ở nhiều chỗ).
 */
export function StatusSummaryBar({
  domain,
  status,
  headline,
  meta,
}: {
  domain: StatusDomain
  status: string | null | undefined
  headline?: ReactNode
  meta?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] border border-brand-200 bg-brand-50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-brand-700">Trạng thái</p>
        {headline && <p className="mt-0.5 text-[13px] font-semibold text-slate-800">{headline}</p>}
        {meta && <div className="mt-0.5 text-[12px] text-slate-500">{meta}</div>}
      </div>
      <StatusBadge domain={domain} status={status} size="md" />
    </div>
  )
}
