"use client"

// Tiện ích dùng chung cho các widget Dashboard (mỗi widget tự chứa, tự gate quyền,
// tự tải dữ liệu — xem plan "Cải tiến Dashboard"). Không dùng cho trang/module khác.

import type { ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"

export type WidgetProps = { factoryId: string | null; user: SessionUser | null }

export function WidgetCard({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
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

export function WidgetLoading() {
  return <div className="flex items-center justify-center py-10 text-slate-400 text-sm">Đang tải...</div>
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
