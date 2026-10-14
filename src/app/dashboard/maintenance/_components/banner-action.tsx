"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"

/**
 * Nút hành động trên banner module (nền màu đậm) — dùng chung cho các trang Bảo trì (U1).
 * - `solid`: nút CHÍNH của trang, nền trắng chữ brand (hành động luôn brand — phương án C).
 * - `ghost`: nút phụ, trong suốt viền trắng mờ.
 * Khi `disabled` (thiếu điều kiện in): giữ nguyên chỗ, mờ đi + tooltip lý do, không điều hướng.
 */
export function BannerAction({
  href,
  icon: Icon,
  label,
  variant = "ghost",
  disabled = false,
  disabledHint,
  newTab = false,
}: {
  href: string | null
  icon: LucideIcon
  label: string
  variant?: "solid" | "ghost"
  disabled?: boolean
  disabledHint?: string
  newTab?: boolean
}) {
  const off = disabled || !href
  const base =
    "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-xl px-4 text-[13.5px] font-bold tracking-tight transition-all"
  const tone = off
    ? "cursor-not-allowed border border-white/20 bg-white/5 text-white/45"
    : variant === "solid"
      ? "bg-white text-brand-800 shadow-sm hover:bg-white/90"
      : "border border-white/40 bg-white/15 text-white hover:bg-white/25"
  if (off) {
    return (
      <span role="link" aria-disabled title={disabledHint} className={`${base} ${tone}`}>
        <Icon size={16} />
        {label}
      </span>
    )
  }
  return (
    <Link href={href} target={newTab ? "_blank" : undefined} className={`${base} ${tone}`}>
      <Icon size={16} />
      {label}
    </Link>
  )
}
