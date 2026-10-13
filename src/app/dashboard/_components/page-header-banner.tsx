"use client"

// Banner tiêu đề trang, dùng cho header đầu các trang module thật (khác `WidgetCard`
// trong widgets/widget-shared.tsx — component đó chỉ dành cho widget Dashboard).
// Mirror đúng phong cách gradient + hoa văn + icon lớn mờ đã dùng ở Dashboard, áp dụng
// cho `<h1>` cấp trang thay vì `<h2>` cấp widget. Xem .claude/rules/05-ui-components.md
// mục "Pastel Rừng Cao Su" — phạm vi mở rộng 2026-08-24: chỉ phần header/banner đầu
// trang, không đổi màu nút/bảng/filter bên dưới.

import { useState, useEffect, type ReactNode } from "react"
import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react"

export type PageBannerTheme =
  | "forest"
  | "ocean"
  | "mint"
  | "moss"
  | "amber"
  | "slate"
  | "violet"
  | "rose"
  | "orange"
  | "teal"
  | "indigo"
  | "cyan"
  | "rubber"

// Màu "from"/"to" ghi literal hex, KHÔNG dùng `var(--color-X)` — đã xác nhận bằng lỗi thật
// (banner render trắng/mờ trên trình duyệt) rằng đọc custom property của Tailwind `@theme`
// qua `var()` trong style attribute runtime không đáng tin cậy trong repo này. Khớp đúng
// pattern literal hex/rgb đã dùng an toàn ở `TILE_PATTERN_FOREST`/`TILE_PATTERN_OCEAN`
// (widget-shared.tsx). Giá trị phải khớp tay với `@theme` trong globals.css — nếu đổi token
// màu ở đó thì sửa luôn ở đây.
//
// `amber`/`slate` (Kho, Bảo trì — 2026-08-24 tiếp 5) KHÔNG có token riêng trong `@theme` —
// dùng thẳng hex chuẩn của Tailwind's built-in `amber`/`slate` palette (không cần thêm
// custom token mới vào globals.css cho 2 theme này).
const PAGE_THEME_BANNER: Record<PageBannerTheme, { pattern: string; from: string; to: string; bgSize?: string }> = {
  forest: {
    pattern:
      "repeating-linear-gradient(52deg, rgba(255,255,255,0.1) 0 2px, transparent 2px 18px), repeating-radial-gradient(circle at 100% 100%, rgba(255,255,255,0.12) 0 2px, transparent 2px 16px)",
    from: "#093719",
    to: "#166534",
  },
  ocean: {
    pattern: "repeating-linear-gradient(-8deg, rgba(255,255,255,0.14) 0 3px, transparent 3px 22px)",
    from: "#1b5590",
    to: "#144171",
  },
  mint: {
    pattern: "radial-gradient(rgba(255,255,255,0.22) 1.6px, transparent 1.7px)",
    from: "#34a68d",
    to: "#1f6a58",
    bgSize: "14px 14px",
  },
  moss: {
    pattern: "repeating-radial-gradient(circle at 100% 0%, rgba(255,255,255,0.18) 0 2px, transparent 2px 13px)",
    from: "#596532",
    to: "#444d26",
  },
  amber: {
    // Lưới kệ kho — 2 lớp repeating-linear-gradient vuông góc, gợi giá kệ/pallet xếp chồng.
    pattern:
      "repeating-linear-gradient(0deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 18px), repeating-linear-gradient(90deg, rgba(255,255,255,0.1) 0 2px, transparent 2px 28px)",
    from: "#b45309",
    to: "#78350f",
  },
  slate: {
    // Vạch chéo cảnh báo/kỹ thuật — gợi ý bảo trì/an toàn lao động.
    pattern: "repeating-linear-gradient(45deg, rgba(255,255,255,0.14) 0 6px, transparent 6px 18px)",
    from: "#475569",
    to: "#1e293b",
  },
  // 4 theme thêm 2026-08-24 (tiếp 6) — KPI/Ghi chú/Kho thành phẩm/Kiểm soát quá trình.
  // `teal` khớp đúng màu module Kiểm soát quá trình đã có sẵn (process-shell.tsx:
  // `bg-teal-50 text-teal-700 border-teal-200`). Còn lại hex Tailwind built-in.
  violet: {
    pattern: "repeating-radial-gradient(circle at 0% 100%, rgba(255,255,255,0.18) 0 2px, transparent 2px 15px)",
    from: "#7c3aed",
    to: "#4c1d95",
  },
  rose: {
    pattern: "repeating-linear-gradient(0deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 20px)",
    from: "#e11d48",
    to: "#881337",
  },
  orange: {
    // Hàng pallet thẳng tắp — lưới ngang dày hơn amber (Kho vật tư) để phân biệt rõ.
    pattern:
      "repeating-linear-gradient(0deg, rgba(255,255,255,0.16) 0 3px, transparent 3px 14px), repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 34px)",
    from: "#c2410c",
    to: "#7c2d12",
  },
  teal: {
    pattern: "repeating-radial-gradient(circle at 100% 100%, rgba(255,255,255,0.18) 0 2px, transparent 2px 14px)",
    from: "#0d9488",
    to: "#134e4a",
  },
  // 2 theme thêm 2026-08-25 — Quản lý ISO / Văn bản nội bộ (2 module cuối cùng của nhóm
  // "ISO & Văn bản"). Không dùng chung theme dù cùng 1 nhóm nav — 2 luồng ký duyệt khác nhau,
  // đã chốt với người dùng dùng 2 màu riêng biệt. Hex Tailwind built-in indigo/cyan.
  indigo: {
    // Dấu tích lặp lại — gợi chứng nhận/phê duyệt ISO
    pattern: "repeating-radial-gradient(circle at 0% 0%, rgba(255,255,255,0.16) 0 2px, transparent 2px 16px)",
    from: "#4f46e5",
    to: "#312e81",
  },
  cyan: {
    // Dòng kẻ văn bản lặp lại — gợi trang giấy/ký duyệt
    pattern: "repeating-linear-gradient(0deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 16px)",
    from: "#0891b2",
    to: "#164e63",
  },
  // Doc-UI (ISO + Văn bản), 2026-10-13 — đúng token brand (#2f5d52 → #1c3a32), KHÁC `forest`
  // (#093719 → #166534, đang dùng cho Sản lượng/Thành phẩm — không được đổi).
  rubber: {
    pattern:
      "repeating-linear-gradient(52deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 18px), repeating-radial-gradient(circle at 100% 100%, rgba(255,255,255,0.1) 0 2px, transparent 2px 16px)",
    from: "#2f5d52",
    to: "#1c3a32",
  },
}

export function PageHeaderBanner({
  title,
  subtitle,
  theme,
  icon,
  action,
  className = "",
  collapsible = false,
  storageKey,
}: {
  title: ReactNode
  subtitle?: ReactNode
  theme: PageBannerTheme
  icon?: LucideIcon
  action?: ReactNode
  className?: string
  collapsible?: boolean
  storageKey?: string
}) {
  const t = PAGE_THEME_BANNER[theme]
  const Icon = icon

  const actualKey = storageKey || `banner_collapsed_${theme}`
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!collapsible) return
    try {
      const saved = localStorage.getItem(actualKey)
      if (saved === "true") setCollapsed(true)
    } catch {
      // Ignore localStorage errors
    }
  }, [collapsible, actualKey])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(actualKey, String(next))
    } catch {
      // Ignore localStorage errors
    }
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl shadow-md transition-all duration-200 ${
        collapsed
          ? "mb-4 px-4 py-2.5 sm:px-5 sm:py-3"
          : "mb-6 px-5 py-5 sm:px-6 sm:py-6"
      } ${className}`}
      style={{
        backgroundImage: `${t.pattern}, linear-gradient(to bottom right, ${t.from}, ${t.to})`,
        backgroundSize: t.bgSize,
      }}
    >
      {Icon && (
        <Icon
          className={`absolute -right-3 pointer-events-none text-white opacity-[0.13] transition-all ${
            collapsed ? "-bottom-2 scale-75" : "-bottom-4"
          }`}
          size={120}
          strokeWidth={1.5}
        />
      )}
      <div className="relative z-10 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <span
              className={`flex shrink-0 items-center justify-center rounded-full bg-white/20 text-white transition-all ${
                collapsed ? "h-8 w-8" : "h-11 w-11"
              }`}
            >
              <Icon size={collapsed ? 16 : 22} />
            </span>
          )}
          <div className="min-w-0">
            <h1
              className={`font-extrabold text-white transition-all truncate ${
                collapsed ? "text-lg sm:text-xl" : "text-2xl"
              }`}
            >
              {title}
            </h1>
            {!collapsed && subtitle && (
              <p className="text-sm text-white/80 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {collapsible && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white/90 hover:text-white transition-all active:scale-95 flex items-center justify-center"
              title={collapsed ? "Mở rộng banner" : "Thu gọn banner để tăng không gian làm việc"}
            >
              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
