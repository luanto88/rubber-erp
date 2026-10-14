"use client"

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

/**
 * Thẻ số liệu dùng chung (U0). Icon trái trong ô nhạt màu module (`mod-*`, phương án C),
 * nhãn chữ hoa nhỏ, số `text-2xl`. `valueTone` tô màu riêng con số (vd "Chờ duyệt" > 0 ⇒ amber).
 * `onClick` ⇒ cả thẻ là nút (vd bấm để lọc danh sách).
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  valueTone = "default",
  loading = false,
  onClick,
  active = false,
}: {
  icon?: LucideIcon
  label: string
  value: ReactNode
  sub?: ReactNode
  valueTone?: "default" | "warn" | "danger" | "good"
  loading?: boolean
  onClick?: () => void
  active?: boolean
}) {
  const valueCls =
    valueTone === "warn"
      ? "text-amber-600"
      : valueTone === "danger"
        ? "text-red-600"
        : valueTone === "good"
          ? "text-emerald-700"
          : "text-slate-900"
  const body = (
    <>
      {Icon && (
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-mod-50 text-mod-600">
          <Icon size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[11px] font-bold uppercase tracking-[0.05em] text-slate-500">{label}</span>
        {loading ? (
          <span className="mt-1.5 block h-6 w-16 animate-pulse rounded bg-slate-100" />
        ) : (
          <span className={`mt-0.5 block text-2xl font-extrabold leading-tight tabular-nums ${valueCls}`}>{value}</span>
        )}
        {sub && !loading && <span className="mt-0.5 block truncate text-xs text-slate-400">{sub}</span>}
      </span>
    </>
  )
  const cls = `flex w-full items-start gap-3 rounded-xl border bg-white p-3.5 shadow-sm ${
    active ? "border-mod-600 ring-2 ring-mod-50" : "border-slate-200"
  }`
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={`${cls} transition-colors hover:border-mod-200`}>
        {body}
      </button>
    )
  }
  return <div className={cls}>{body}</div>
}

/** Lưới thẻ số liệu: 2 cột (điện thoại) → 3 (sm) → 4 hoặc 5 (lg). */
export function StatGrid({
  cols = 4,
  className = "",
  children,
}: {
  cols?: 3 | 4 | 5
  className?: string
  children: ReactNode
}) {
  const lg = cols === 5 ? "lg:grid-cols-5" : cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"
  return <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${lg} ${className}`}>{children}</div>
}
