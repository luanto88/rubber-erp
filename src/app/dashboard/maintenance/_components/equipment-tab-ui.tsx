"use client"

import type { LucideIcon } from "lucide-react"

// 2 tầng điều hướng của trang QR thiết bị `/tb/<token>`:
// - Tầng 1 `EquipmentMainTabs`: menu lớn (Lịch sử · Vật tư · Thống kê) — icon trên chữ, gạch chân dày, dính đầu màn hình.
// - Tầng 2 `FilterChips`: bộ lọc nhỏ trong khối nội dung (Tất cả · Sửa chữa · Bảo dưỡng) — chip tròn, rộng theo chữ.
// Cố ý KHÔNG dùng chung SegmentedTabs cho cả 2 tầng: cùng hình dạng thì người dùng không phân biệt được cấp.

export type MainTabItem<K extends string> = { key: K; label: string; icon: LucideIcon }

export function EquipmentMainTabs<K extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: MainTabItem<K>[]
  value: K
  onChange: (key: K) => void
  ariaLabel: string
}) {
  return (
    <nav className="sticky top-0 z-30 -mx-4 bg-slate-100 px-4 py-2 sm:mx-0 sm:px-0">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item, i) => {
          const active = item.key === value
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.key)}
              className={`relative flex min-h-[60px] flex-col items-center justify-center gap-1 px-2 text-sm font-bold transition-colors ${
                i > 0 ? "border-l border-slate-100" : ""
              } ${active ? "bg-mod-50 text-mod-800" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
            >
              <Icon size={22} className={active ? "text-mod-600" : "text-slate-400"} />
              <span>{item.label}</span>
              {active && <span className="absolute inset-x-3 bottom-0 h-1 rounded-t-full bg-mod-600" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export function FilterChips<K extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
  ariaLabel: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
              active
                ? "border-mod-600 bg-mod-600 text-white"
                : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800"
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
