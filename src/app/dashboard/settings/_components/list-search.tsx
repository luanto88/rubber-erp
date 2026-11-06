"use client"

import { Search, X } from "lucide-react"

/** Ô tìm nhanh dùng chung cho các danh sách trong Cài đặt — lọc ở client (bỏ dấu, xem
 *  `matchesSearchQuery` trong src/lib/text-normalize.ts). Hiện "N/M" khi đang có từ khoá. */
export function ListSearch({
  value,
  onChange,
  placeholder = "Tìm nhanh...",
  shown,
  total,
  className = "",
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  shown: number
  total: number
  className?: string
}) {
  const active = value.trim().length > 0
  return (
    <div className={"flex items-center gap-2 " + className}>
      <div className="relative w-full sm:w-72">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && active) { e.stopPropagation(); onChange("") } }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-8 text-sm text-slate-700 outline-none transition-colors focus:border-slate-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {active && (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Xoá tìm kiếm"
            aria-label="Xoá tìm kiếm"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <span className={"shrink-0 text-xs tabular-nums " + (active ? "font-bold text-slate-600" : "text-slate-400")}>
        {active ? `${shown}/${total}` : total}
      </span>
    </div>
  )
}

/** Dòng "không khớp" thay cho câu "Chưa có …" khi đang có từ khoá. */
export function noSearchMatchText(query: string) {
  return `Không có kết quả khớp «${query.trim()}»`
}
