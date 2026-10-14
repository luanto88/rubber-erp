"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"

export type SegmentedTabItem<K extends string = string> = {
  key: K
  label: string
  icon?: LucideIcon
  count?: number
  /** Có `href` → render <Link> (tab điều hướng module). */
  href?: string
  disabled?: boolean
  /** Badge đếm nổi bật màu đỏ (việc cần làm) thay vì xám. */
  alertCount?: boolean
}

/**
 * Segmented control dùng chung (Doc-UI): tab module, tab lọc trạng thái, bộ chọn phạm vi.
 * Track slate-100, mục đang chọn nền trắng + bóng nhẹ + chữ brand. Tự cuộn ngang khi hẹp.
 */
export function SegmentedTabs<K extends string>({
  items,
  value,
  onChange,
  size = "md",
  fullWidth = false,
  className = "",
  ariaLabel,
}: {
  items: SegmentedTabItem<K>[]
  value: K | null
  onChange?: (key: K) => void
  size?: "sm" | "md"
  fullWidth?: boolean
  className?: string
  ariaLabel?: string
}) {
  const pad = size === "sm" ? "px-3 py-1.5 text-[12.5px]" : "px-3.5 py-2 text-[13.5px]"
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 [scrollbar-width:none] ${
        fullWidth ? "w-full" : "w-fit"
      } ${className}`}
    >
      {items.map((item) => {
        const active = item.key === value
        const Icon = item.icon
        const cls = `inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-all ${pad} ${
          fullWidth ? "flex-1" : ""
        } ${
          // Màu điều hướng theo module (`mod-*`, phương án C U0) — không bọc ModuleThemeScope ⇒ brand.
          active
            ? "relative bg-white text-mod-800 shadow-sm after:absolute after:inset-x-2.5 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-mod-600"
            : "text-slate-500 hover:bg-white/60 hover:text-slate-800"
        } ${item.disabled ? "pointer-events-none opacity-50" : ""}`
        const inner = (
          <>
            {Icon && <Icon size={size === "sm" ? 14 : 15} className={active ? "text-mod-600" : ""} />}
            <span>{item.label}</span>
            {typeof item.count === "number" && item.count > 0 && (
              <span
                className={`min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] font-bold leading-[18px] ${
                  item.alertCount ? "bg-red-500 text-white" : active ? "bg-brand-100 text-brand-800" : "bg-slate-200 text-slate-600"
                }`}
              >
                {item.count > 99 ? "99+" : item.count}
              </span>
            )}
          </>
        )
        if (item.href) {
          return (
            <Link key={item.key} href={item.href} role="tab" aria-selected={active} className={cls}>
              {inner}
            </Link>
          )
        }
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange?.(item.key)}
            className={cls}
          >
            {inner}
          </button>
        )
      })}
    </div>
  )
}
