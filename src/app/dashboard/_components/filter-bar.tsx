"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, SlidersHorizontal } from "lucide-react"

type FilterBarProps = {
  children: ReactNode
  activeCount?: number
  defaultOpen?: boolean
  className?: string
  /**
   * "flex" (mặc định, giữ nguyên hành vi cũ) hoặc "grid": lưới đều cột, mỗi ô lọc nên
   * `w-full`; ô cần rộng gấp đôi dùng `sm:col-span-2`, hàng hành động dùng `col-span-full`.
   */
  layout?: "flex" | "grid"
}

/**
 * Chuẩn hóa "Filter bar" (bg-white rounded-xl border shadow-sm) nhưng có thể
 * thu gọn trên mobile thành 1 nút "Bộ lọc" để không chiếm hết màn hình trước bảng dữ liệu.
 * Trên md+ luôn hiển thị đầy đủ như trước, không đổi hành vi desktop.
 */
export function FilterBar({ children, activeCount, defaultOpen = false, className = "", layout = "flex" }: FilterBarProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`mb-4 rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-slate-700 md:hidden"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-slate-500" />
          Bộ lọc
          {!!activeCount && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">{activeCount}</span>
          )}
        </span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <div
        className={
          layout === "grid"
            ? `grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 md:grid md:pt-4 lg:grid-cols-4 xl:grid-cols-6 ${open ? "grid border-t border-slate-100 md:border-t-0" : "hidden"}`
            : `flex-wrap items-center gap-3 p-4 md:flex md:pt-4 ${open ? "flex border-t border-slate-100 md:border-t-0" : "hidden"}`
        }
      >
        {children}
      </div>
    </div>
  )
}
