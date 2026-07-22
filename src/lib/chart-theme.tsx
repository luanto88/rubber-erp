// Bảng màu & tiện ích Recharts dùng chung cho các widget Dashboard mới
// (src/app/dashboard/_components/widgets/*.tsx). Không đụng tới palette riêng của
// các trang khác (quality-analytics, process...) — mỗi trang tự quản màu của mình.

import type { ReactNode } from "react"

// Tông màu trầm hơn màu bão hòa cao mặc định — dễ đọc, chuyên nghiệp hơn khi nhiều
// series cùng hiển thị trên 1 biểu đồ.
export const CHART_PALETTE = [
  "#059669", // emerald
  "#2563eb", // blue
  "#d97706", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#e11d48", // rose
  "#65a30d", // lime
  "#ea580c", // orange
]

export const STATUS_COLORS: Record<string, string> = {
  "Dở dang": "#d97706",
  "Hoàn thành": "#059669",
  "Xuất hàng": "#2563eb",
}

export function formatKg(n: number | null | undefined) {
  const v = Number(n || 0)
  return `${v.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} kg`
}

export function formatCompact(n: number | null | undefined) {
  const v = Number(n || 0)
  return v.toLocaleString("vi-VN", { maximumFractionDigits: 0 })
}

export function formatPercent(n: number | null | undefined) {
  const v = Number(n || 0)
  return `${v.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
}

type TooltipPayloadEntry = {
  name?: string
  value?: number | string
  color?: string
  unit?: string
}

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: ReactNode
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white/95 backdrop-blur-lg rounded-xl border border-slate-200 shadow-xl px-4 py-3">
      {label != null && <p className="text-xs font-bold text-slate-500 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-sm font-bold" style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" ? p.value.toLocaleString("vi-VN") : p.value}
          {p.unit || ""}
        </p>
      ))}
    </div>
  )
}
