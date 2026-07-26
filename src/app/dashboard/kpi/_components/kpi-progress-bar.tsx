"use client"

// Thanh tiến độ "nổi khối" dùng riêng cho module KPI — màu chuyển dần từ tím (thương hiệu KPI)
// sang hổ phách rồi sang xanh lá khi tiệm cận 100%, thay cho thanh phẳng 1 màu cố định trước đây.
// Chỉ dùng trong /dashboard/kpi/* — không đụng design system chung của các module khác.

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

// 0% = tím thương hiệu KPI (262°) → 50% = hổ phách (38°) → 100% = xanh lá (152°). Bão hòa/độ
// sáng giữ cao (68%/50%) để ra tông pastel "đậm đà" thay vì nhạt màu như pastel-100 mặc định.
function progressHue(pct: number): number {
  const p = Math.max(0, Math.min(100, pct)) / 100
  return p <= 0.5 ? lerp(262, 38, p / 0.5) : lerp(38, 152, (p - 0.5) / 0.5)
}

export function kpiProgressColor(pct: number): { solid: string; soft: string } {
  const h = progressHue(pct)
  return { solid: `hsl(${h.toFixed(0)} 68% 50%)`, soft: `hsl(${h.toFixed(0)} 68% 94%)` }
}

export function KpiProgressBar({
  percent,
  size = "sm",
  showLabel = true,
}: {
  percent: number
  size?: "sm" | "md"
  showLabel?: boolean
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)))
  const { solid, soft } = kpiProgressColor(pct)
  const height = size === "md" ? "h-4" : "h-2.5"

  return (
    <div className="w-full">
      <div
        className={`relative w-full ${height} rounded-full overflow-hidden shadow-inner`}
        style={{ background: soft }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out relative overflow-hidden"
          style={{ width: `${pct}%`, background: solid, boxShadow: `0 1px 3px 0 ${solid}66` }}
        >
          {/* Highlight kính bóng phía trên — tạo cảm giác "nổi khối" cho thanh tiến độ */}
          <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/45 to-transparent" />
        </div>
        {showLabel && size === "md" && (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-extrabold text-white mix-blend-difference">
            {pct}%
          </span>
        )}
      </div>
      {showLabel && size === "sm" && (
        <div className="mt-0.5 text-right text-[10px] font-bold" style={{ color: solid }}>
          {pct}%
        </div>
      )}
    </div>
  )
}
