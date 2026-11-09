"use client"

import { forwardRef } from "react"
import type { LucideIcon, LucideProps } from "lucide-react"

/**
 * Icon "Gia công ngoài": bánh răng cơ khí + tia lửa điện (lucide không có sẵn).
 * Vẽ theo đúng quy ước nét của lucide (lưới 24, stroke currentColor, đầu bo tròn) và nhận cùng props
 * (`size`, `strokeWidth`, `className`…) ⇒ dùng được ở mọi chỗ nhận `LucideIcon` (vd PageHeaderBanner).
 */
const GiaCongIconBase = forwardRef<SVGSVGElement, LucideProps>(function GiaCongIcon(
  { size = 24, color = "currentColor", strokeWidth = 2, absoluteStrokeWidth, className, ...rest },
  ref,
) {
  const sw = absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["lucide", className].filter(Boolean).join(" ")}
      aria-hidden="true"
      {...rest}
    >
      {/* Bánh răng: thân + lỗ trục + 8 răng */}
      <circle cx="9" cy="15" r="5.2" />
      <circle cx="9" cy="15" r="1.9" />
      <path d="M14.2 15h2.4M12.7 18.7l1.7 1.7M9 20.2v2.4M5.3 18.7l-1.7 1.7M3.8 15H1.4M5.3 11.3 3.6 9.6M9 9.8V7.4M12.7 11.3l1.7-1.7" />
      {/* Tia lửa điện */}
      <path d="M19.5 1.5 16.5 6.5h4L17.5 11.5" />
      <path d="M21.6 3.6l1.3-1.1M21.9 8H23" />
    </svg>
  )
})

export const GiaCongIcon = GiaCongIconBase as unknown as LucideIcon
