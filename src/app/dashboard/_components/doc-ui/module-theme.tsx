// Doc-UI — MÀU ĐIỀU HƯỚNG theo module (U0, phương án C "lai", người dùng chốt 2026-10-14).
//
// - Phần ĐIỀU HƯỚNG (tab đang chọn, ô nhập khi focus, icon thẻ số liệu, viền nhóm ngày) dùng utility
//   `*-mod-50/200/600/800` → lấy màu banner của module.
// - Phần HÀNH ĐỘNG (nút chính, Ký ngay, link mã, Gửi ký duyệt) LUÔN `brand-*` ở mọi module.
// - Badge trạng thái luôn theo tông nghĩa (status-registry) — không theo module.
//
// Bọc vùng module bằng <ModuleThemeScope theme="ocean"> (hoặc thêm class `moduleThemeClass(theme)`
// vào shell). Không bọc ⇒ utility `mod-*` rơi về brand (Văn bản/ISO giữ nguyên).
// Bộ màu định nghĩa ở globals.css (`.mod-theme-*`), khớp tay với PAGE_THEME_BANNER.

import type { ReactNode } from "react"
import type { PageBannerTheme } from "@/app/dashboard/_components/page-header-banner"

// Literal để Tailwind/CSS quét đủ — KHÔNG ghép chuỗi động.
const THEME_CLASS: Record<PageBannerTheme, string> = {
  forest: "mod-theme-forest",
  ocean: "mod-theme-ocean",
  mint: "mod-theme-mint",
  moss: "mod-theme-moss",
  amber: "mod-theme-amber",
  slate: "mod-theme-slate",
  violet: "mod-theme-violet",
  rose: "mod-theme-rose",
  orange: "mod-theme-orange",
  teal: "mod-theme-teal",
  indigo: "mod-theme-indigo",
  cyan: "mod-theme-cyan",
  rubber: "mod-theme-rubber",
}

export function moduleThemeClass(theme: PageBannerTheme): string {
  return THEME_CLASS[theme] ?? ""
}

export function ModuleThemeScope({
  theme,
  className = "",
  children,
}: {
  theme: PageBannerTheme
  className?: string
  children: ReactNode
}) {
  return <div className={`${moduleThemeClass(theme)} ${className}`}>{children}</div>
}
