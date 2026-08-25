"use client"

// Hoa văn nền rất nhẹ phủ toàn trang, dùng cho các trang module đã có
// `PageHeaderBanner` (Điều xe, Xuất hàng, Chất lượng, EUDR, Sản lượng, Thành phẩm, Kho,
// Bảo trì) — xem quyết định phạm vi tại .claude/rules/05-ui-components.md mục "Pastel
// Rừng Cao Su". 4 theme đầu (ocean/mint/moss) tái dùng nguyên path icon
// (truck/flask/testtube/leaf) đã có sẵn trong
// cung_cap_dl/thiet_ke_moi_pastel_rung_cao_su.html (bộ <symbol> dùng chung của mockup),
// chỉ đổi cách dùng: từ "1 motif lớn cố định trong banner" sang "tile lặp lại rất mờ,
// phủ toàn bộ chiều cao trang" — vì banner có kích thước cố định, còn nền trang có
// chiều cao thay đổi theo nội dung nên cần pattern lặp qua SVG <pattern>, không phải 1
// hình cố định. 3 theme sau (forest/amber/slate — 2026-08-24 tiếp 5) không có tiền lệ
// trong mockup nên chỉ dùng đường nét hình học (không icon), khớp đúng phong cách motif
// Sản lượng gốc trong mockup (`motif-tap` — chỉ có đường chéo, không icon).
//
// Dùng position:fixed (không đụng position/className của bất kỳ ancestor nào trong các
// trang gọi component này) để tránh lặp lại landmine containing-block đã ghi ở
// .claude/rules/24-notification-bell-module-tasks.md (filter/backdrop-filter/transform
// trên ancestor phá vỡ position:fixed của hậu duệ) — ở đây ta hoàn toàn không thêm gì
// vào cây ancestor, chỉ chèn 1 sibling mới.

import { BadgeCheck, FileSignature, Forklift, Gauge, StickyNote, Target } from "lucide-react"
import type { PageBannerTheme } from "./page-header-banner"

// Literal hex — KHÔNG dùng var(--color-X) trong SVG/style inline. Bài học 2026-08-24
// (mục 6, CLAUDE.md): banner từng render trắng/mờ vì đọc custom property Tailwind
// `@theme` qua var() tại runtime không đáng tin cậy trong repo này. Giá trị khớp tay
// với `--color-brand`/`--color-ocean-600`/`--color-mint-600`/`--color-moss-600` trong
// globals.css; `amber`/`slate` dùng hex chuẩn Tailwind (không có token riêng).
const MOTIF_COLOR: Record<PageBannerTheme, string> = {
  forest: "#2f5d52",
  ocean: "#1b5590",
  mint: "#34a68d",
  moss: "#596532",
  amber: "#b45309",
  slate: "#475569",
  violet: "#7c3aed",
  rose: "#e11d48",
  orange: "#c2410c",
  teal: "#0d9488",
  indigo: "#4f46e5",
  cyan: "#0891b2",
}

const TILE_SIZE: Record<PageBannerTheme, { width: number; height: number }> = {
  forest: { width: 160, height: 160 },
  ocean: { width: 320, height: 200 },
  mint: { width: 280, height: 260 },
  moss: { width: 260, height: 260 },
  amber: { width: 140, height: 140 },
  slate: { width: 120, height: 120 },
  violet: { width: 180, height: 180 },
  rose: { width: 190, height: 170 },
  orange: { width: 220, height: 150 },
  teal: { width: 190, height: 190 },
  indigo: { width: 170, height: 170 },
  cyan: { width: 190, height: 190 },
}

export function PageBackgroundMotif({ theme }: { theme: PageBannerTheme }) {
  const color = MOTIF_COLOR[theme]
  const { width, height } = TILE_SIZE[theme]
  const patternId = `page-motif-${theme}`

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: 0.06 }}
    >
      <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width={width} height={height}>
            {theme === "forest" && (
              <g fill="none" stroke={color} strokeWidth={1.4}>
                {/* Rãnh cạo mủ — đường chéo lặp lại, mirror motif-tap (Sản lượng) */}
                <path d="M20 -10 L60 170 M60 -10 L100 170 M100 -10 L140 170" />
              </g>
            )}
            {theme === "amber" && (
              <g fill="none" stroke={color} strokeWidth={1.3}>
                {/* Lưới kệ kho — gợi giá kệ/pallet xếp chồng */}
                <path d="M0 40 H140 M0 100 H140" />
                <path d="M40 0 V140 M100 0 V140" opacity={0.6} />
              </g>
            )}
            {theme === "slate" && (
              <g fill="none" stroke={color} strokeWidth={2.2}>
                {/* Vạch chéo cảnh báo/kỹ thuật — gợi bảo trì, an toàn lao động */}
                <path d="M-10 30 L30 -10 M-10 90 L90 -10 M30 130 L130 30 M90 130 L130 90" />
              </g>
            )}
            {theme === "ocean" && (
              <g fill="none" stroke={color} strokeWidth={1.6}>
                {/* Sóng đường + đường đứt nét — mirror motif banner Điều xe/Xuất hàng */}
                <path d="M-20 40 Q 40 15 100 40 T 220 40 T 340 40" />
                <path d="M-20 90 Q 40 68 100 90 T 220 90 T 340 90" opacity={0.55} />
                <path d="M40 170 L280 60" strokeDasharray="5 7" opacity={0.4} />
                {/* i-truck (viewBox 24x24), scale ~2.3 */}
                <g transform="translate(220,110) scale(2.3)">
                  <path d="M3 7h11v9H3z" />
                  <path d="M14 11h4l3 3v2h-7z" />
                  <circle cx="7" cy="18" r="1.6" />
                  <circle cx="17.5" cy="18" r="1.6" />
                </g>
              </g>
            )}
            {theme === "mint" && (
              <g fill="none" stroke={color} strokeWidth={1.4}>
                {/* Xoáy tròn + vòng tròn mờ — mirror motif banner Chất lượng */}
                <path d="M220 66 C220 53 208 44 194 47 C176 51 167 68 176 83 C183 96 202 100 212 90 C218 83 216 71 207 68" />
                <circle cx="204" cy="66" r="30" opacity={0.4} />
                {/* i-flask (viewBox 24x24), scale ~1.7 */}
                <g transform="translate(24,150) scale(1.7)">
                  <path d="M9 2h6" />
                  <path d="M10 2v6.2c0 .7-.2 1.4-.6 2L4.9 18a2 2 0 001.7 3h10.8a2 2 0 001.7-3l-4.5-7.8a4 4 0 01-.6-2V2" />
                  <path d="M7.2 15h9.6" />
                </g>
                {/* i-testtube (viewBox 24x24), scale ~1.3 */}
                <g transform="translate(150,16) scale(1.3)">
                  <path d="M9 2h6" />
                  <path d="M10 2v13.6a2 2 0 004 0V2" />
                  <path d="M9.6 13h4.8" />
                </g>
              </g>
            )}
            {theme === "moss" && (
              <g fill="none" stroke={color} strokeWidth={1.4}>
                {/* Vòng tròn đồng mức — mirror motif banner EUDR */}
                <circle cx="180" cy="120" r="12" />
                <circle cx="180" cy="120" r="24" />
                <circle cx="180" cy="120" r="38" />
                <circle cx="180" cy="120" r="52" />
                {/* i-leaf (viewBox 24x24), scale ~1.8 */}
                <g transform="translate(160,86) scale(1.8)">
                  <path d="M4 20c8 0 16-6 16-16-10 0-16 8-16 16z" />
                  <path d="M6 18c3-4 7-7 12-9" />
                </g>
              </g>
            )}
            {/* 4 theme thêm 2026-08-24 (tiếp 6) — render thẳng component Lucide bên trong
                <pattern> thay vì copy path tay: <svg> lồng trong <svg> hợp lệ theo spec,
                cho icon chính xác pixel-perfect và khớp 100% bộ icon UI đang dùng khắp app,
                thay vì hình học trừu tượng thuần túy như 6 theme trên. */}
            {theme === "violet" && (
              <g fill="none" stroke={color} strokeWidth={1.4}>
                {/* Vòng tròn mục tiêu mờ phía sau icon Target */}
                <circle cx="140" cy="40" r="20" opacity={0.5} />
                <circle cx="140" cy="40" r="32" opacity={0.3} />
                <g transform="translate(15,95)">
                  <Target color={color} size={42} strokeWidth={1.3} />
                </g>
              </g>
            )}
            {theme === "rose" && (
              <g fill="none" stroke={color} strokeWidth={1.2}>
                {/* Dòng kẻ ghi chú — gợi giấy note có dòng kẻ */}
                <path d="M0 130 H190 M0 150 H190" opacity={0.5} />
                <g transform="translate(115,15)">
                  <StickyNote color={color} size={38} strokeWidth={1.3} />
                </g>
              </g>
            )}
            {theme === "orange" && (
              <g fill="none" stroke={color} strokeWidth={1.3}>
                {/* Hàng pallet thẳng tắp — dãy ô chữ nhật lặp lại theo hàng ngang */}
                <path d="M6 20h26v16H6zM46 20h26v16H46zM86 20h26v16H86zM126 20h26v16H126zM166 20h26v16H166z" opacity={0.85} />
                <path d="M6 96h26v16H6zM46 96h26v16H46zM86 96h26v16H86zM126 96h26v16H126zM166 96h26v16H166z" opacity={0.85} />
                <g transform="translate(70,55)">
                  <Forklift color={color} size={40} strokeWidth={1.4} />
                </g>
              </g>
            )}
            {theme === "teal" && (
              <g fill="none" stroke={color} strokeWidth={1.4}>
                {/* Vạch chia đồng hồ đo — gợi kiểm soát thông số kỹ thuật */}
                <path d="M95 30 A60 60 0 0 1 155 90" strokeDasharray="3 8" opacity={0.6} />
                <g transform="translate(115,115)">
                  <Gauge color={color} size={40} strokeWidth={1.3} />
                </g>
              </g>
            )}
            {/* 2 theme thêm 2026-08-25 — Quản lý ISO / Văn bản nội bộ */}
            {theme === "indigo" && (
              <g fill="none" stroke={color} strokeWidth={1.3}>
                {/* Vòng cung con dấu chứng nhận mờ phía sau icon BadgeCheck */}
                <circle cx="130" cy="45" r="22" strokeDasharray="4 5" opacity={0.5} />
                <circle cx="130" cy="45" r="34" strokeDasharray="2 6" opacity={0.3} />
                <g transform="translate(15,95)">
                  <BadgeCheck color={color} size={38} strokeWidth={1.3} />
                </g>
              </g>
            )}
            {theme === "cyan" && (
              <g fill="none" stroke={color} strokeWidth={1.2}>
                {/* Dòng kẻ trang giấy/dòng ký duyệt mờ phía sau icon FileSignature */}
                <path d="M0 130 H190 M0 148 H190 M0 166 H140" opacity={0.5} />
                <g transform="translate(120,20)">
                  <FileSignature color={color} size={38} strokeWidth={1.3} />
                </g>
              </g>
            )}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  )
}
