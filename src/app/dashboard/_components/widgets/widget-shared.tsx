"use client"

// Tiện ích dùng chung cho các widget Dashboard (mỗi widget tự chứa, tự gate quyền,
// tự tải dữ liệu — xem plan "Cải tiến Dashboard"). Không dùng cho trang/module khác.

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { buildMonthlyQualityReport, SAN_PHAM_GROUP, TIEU_CHUAN_OPTIONS } from "@/lib/quality-stats"
import { cachedQuery } from "./dashboard-cache"
import type { SessionUser } from "@/lib/auth"

export type WidgetProps = { factoryId: string | null; user: SessionUser | null }

// Theme banner cho 3/8 khu vực Dashboard khớp đúng module đã thiết kế trong mockup
// "Pastel Rừng Cao Su" — xem .claude/rules/05-ui-components.md mục cùng tên. Không dùng
// cho widget nào khác ngoài Sản lượng (forest), Xuất hàng + Điều xe (ocean), Chất lượng (mint).
export type WidgetTheme = "forest" | "ocean" | "mint"

// Màu "from"/"to" ghi literal hex (không dùng `var(--color-X)`) — inline style bên dưới
// build background-image tại render time, còn `@theme` chỉ sinh custom property trên
// `:root` để Tailwind DÙNG NỘI BỘ khi biên dịch class (bg-X/text-X...); không có gì đảm
// bảo `var(--color-X)` luôn resolve đúng khi đọc từ style attribute runtime qua mọi trình
// duyệt/cấu hình build — đã xác nhận lỗi thật (banner render trắng/mờ) khi dùng var(),
// nên đổi sang literal để khớp đúng pattern an toàn `TILE_PATTERN_FOREST`/`TILE_PATTERN_OCEAN`
// bên dưới (vốn đã dùng rgb literal, không phải var(), và hoạt động đúng).
const THEME_BANNER: Record<WidgetTheme, { pattern: string; from: string; to: string; bgSize?: string }> = {
  forest: {
    pattern: "repeating-linear-gradient(52deg, rgba(255,255,255,0.12) 0 2px, transparent 2px 18px)",
    from: "#2f5d52",
    to: "#1c3a32",
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
}

// Hoa văn nhẹ cho tile/stat-box muốn khớp theme mà không cần cả banner — cộng thêm vào
// className hiện có của tile (không thay bg-*-50 gốc). Tự chứa trong Tailwind arbitrary-value,
// không cần thêm CSS toàn cục.
export const TILE_PATTERN_FOREST =
  "relative overflow-hidden before:content-[''] before:absolute before:inset-0 before:-z-10 before:pointer-events-none before:[background-image:repeating-linear-gradient(52deg,rgba(47,93,82,0.07)_0_2px,transparent_2px_16px)]"
export const TILE_PATTERN_OCEAN =
  "relative overflow-hidden before:content-[''] before:absolute before:inset-0 before:-z-10 before:pointer-events-none before:[background-image:repeating-linear-gradient(-8deg,rgba(27,85,144,0.07)_0_3px,transparent_3px_20px)]"

export function WidgetCard({
  title,
  subtitle,
  action,
  children,
  className = "",
  theme,
  icon,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  theme?: WidgetTheme
  icon?: LucideIcon
}) {
  if (theme) {
    const t = THEME_BANNER[theme]
    const Icon = icon
    return (
      <div className={`rounded-2xl border border-slate-200 shadow-md overflow-hidden ${className}`}>
        <div
          className="relative px-5 py-4"
          style={{
            backgroundImage: `${t.pattern}, linear-gradient(to bottom right, ${t.from}, ${t.to})`,
            backgroundSize: t.bgSize,
          }}
        >
          {Icon && <Icon className="absolute -right-2 -bottom-3 text-white opacity-15" size={80} strokeWidth={1.5} />}
          <div className="relative z-10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {Icon && (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-white">
                  <Icon size={18} />
                </span>
              )}
              <div>
                <h2 className="text-sm font-bold text-white">{title}</h2>
                {subtitle && <p className="text-xs text-white/75 mt-0.5">{subtitle}</p>}
              </div>
            </div>
            {action}
          </div>
        </div>
        <div className="bg-white p-5">{children}</div>
      </div>
    )
  }
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-md p-5 ${className}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-700">{title}</h2>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

/** Khung chờ có hình dạng (vài ô số + vùng biểu đồ) thay cho chữ "Đang tải...". */
export function WidgetLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Đang tải">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-slate-50 p-3 space-y-2">
            <div className="skeleton h-3 w-2/3 rounded" />
            <div className="skeleton h-5 w-1/2 rounded" />
          </div>
        ))}
      </div>
      <div className="skeleton h-48 w-full rounded-xl" />
    </div>
  )
}

/** Khung chờ nguyên 1 card — dùng cho khối chưa cuộn tới (LazySection). */
export function WidgetSkeleton({ height = 320 }: { height?: number }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden" style={{ minHeight: height }}>
      <div className="skeleton h-16 w-full" />
      <div className="p-5">
        <WidgetLoading />
      </div>
    </div>
  )
}

export function WidgetEmpty({ label = "Chưa có dữ liệu" }: { label?: string }) {
  return <div className="flex items-center justify-center py-10 text-slate-400 text-sm">{label}</div>
}

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

/** Khoảng ngày tháng-tới-nay và năm-tới-nay theo giờ hệ thống, dạng "YYYY-MM-DD". */
export function getCurrentRanges() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const today = `${y}-${pad2(m)}-${pad2(now.getDate())}`
  const monthStart = `${y}-${pad2(m)}-01`
  const yearStart = `${y}-01-01`
  return { nam: y, thang: m, today, monthStart, yearStart }
}

/**
 * Fetch phân trang toàn bộ dòng của 1 bảng — PostgREST mặc định cắt kết quả ở 1000 dòng
 * (xem .claude/rules/04-code-patterns.md). Dùng cho mọi widget query không chắc dưới 1000 dòng.
 * Mirror đúng pattern `fetchAll` chuẩn của rule 04 (filter callback dùng `any` vì kiểu
 * PostgrestFilterBuilder đổi generic sau mỗi lần chain — không cố ép kiểu chặt ở đây).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllPaged<T>(table: string, selectCols: string, applyFilters?: (q: any) => any): Promise<T[]> {
  const PAGE_SIZE = 1000
  let all: T[] = []
  let from = 0
  for (;;) {
    let q = supabase.from(table).select(selectCols).range(from, from + PAGE_SIZE - 1)
    if (applyFilters) q = applyFilters(q)
    const { data, error } = await q
    if (error) break
    all = all.concat(((data as T[]) || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

// ── Dữ liệu dùng chung nhiều widget (cache Promise, xem dashboard-cache.ts) ──────────

/** Tổng KL khô nguyên liệu còn trong các ngăn chưa sản xuất xong. */
export function getRawStockKho(factoryId: string): Promise<number> {
  return cachedQuery(`ton-nl:${factoryId}`, async () => {
    const rows = await fetchAllPaged<{ tong_kho: number | null }>("ngans", "tong_kho", (q) =>
      q.eq("factory_id", factoryId).neq("trang_thai", "Đã sản xuất"),
    )
    return rows.reduce((s, r) => s + Number(r.tong_kho || 0), 0)
  })
}

export type ProdKhoRow = {
  ngay: string
  mn_kho: number | null
  ct_kho: number | null
  dct_kho: number | null
  dkt_kho: number | null
  dt_kho: number | null
}

export function prodRowKho(r: ProdKhoRow) {
  return Number(r.mn_kho || 0) + Number(r.ct_kho || 0) + Number(r.dct_kho || 0) + Number(r.dkt_kho || 0) + Number(r.dt_kho || 0)
}

/** Sản lượng từ đầu năm tới hôm nay (widget tự lọc phần tháng nếu cần). */
export function getYearProductionRows(factoryId: string): Promise<ProdKhoRow[]> {
  const { yearStart, today } = getCurrentRanges()
  return cachedQuery(`sl-nam:${factoryId}:${yearStart}:${today}`, () =>
    fetchAllPaged<ProdKhoRow>("production_records", "ngay,mn_kho,ct_kho,dct_kho,dkt_kho,dt_kho", (q) =>
      q.eq("factory_id", factoryId).gte("ngay", yearStart).lte("ngay", today),
    ),
  )
}

/** Báo cáo chất lượng tháng hiện tại, tiêu chuẩn mặc định, mọi sản phẩm. */
export function getCurrentMonthQualityReport(factoryId: string) {
  const { nam, thang } = getCurrentRanges()
  return cachedQuery(`cl-thang:${factoryId}:${nam}-${thang}`, () =>
    buildMonthlyQualityReport({
      factoryId,
      nam,
      thang,
      sanPhamList: Object.keys(SAN_PHAM_GROUP),
      tieuChuan: TIEU_CHUAN_OPTIONS[0],
      chiTieuList: [],
    }),
  )
}
