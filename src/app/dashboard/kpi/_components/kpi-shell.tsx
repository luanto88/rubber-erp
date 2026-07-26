"use client"

// Shell điều hướng module "Quản lý công việc & Đánh giá KPI nhân viên".
// Xem kiến trúc đầy đủ + roadmap từng phase tại .claude/rules/27-kpi-module.md.
//
// Phase 1a (2026-07-24): thêm tab "Công việc" (giao việc, A + B). Phase 2 (2026-07-26): thêm
// tab "Đánh giá 5S". Cùng đợt: thêm tab "Khiếu nại" (kpi_appeals — xây trước lịch trong roadmap
// Phase 5 vì không phụ thuộc kpi_monthly_scores). Các tab còn lại (Chấm điểm chuyên môn, Bảng
// điểm KPI) sẽ được thêm dần theo đúng phase — KHÔNG liệt kê link tới route chưa tồn tại ở đây
// để tránh 404 khi bấm nhầm.
//
// Redesign (Part C — giao diện riêng module KPI): mỗi tab có tông pastel đậm riêng (không dùng
// 1 màu tím cho mọi tab như trước) + hover-lift, để phân biệt trực quan nhanh hơn giữa các khu
// vực chức năng khác nhau của module.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ClipboardList, Flag, LayoutDashboard, Repeat, Sparkles, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

type NavTab = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefixes?: string[]
  activeClass: string
  hoverClass: string
}

const tabs: NavTab[] = [
  {
    href: "/dashboard/kpi",
    label: "Tổng quan",
    icon: LayoutDashboard,
    matchPrefixes: [],
    activeClass: "bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-700 border-violet-200 shadow-sm",
    hoverClass: "hover:bg-violet-50 hover:text-violet-600",
  },
  {
    href: "/dashboard/kpi/tasks",
    label: "Công việc",
    icon: ClipboardList,
    matchPrefixes: ["/dashboard/kpi/tasks"],
    activeClass: "bg-gradient-to-br from-sky-100 to-blue-100 text-sky-700 border-sky-200 shadow-sm",
    hoverClass: "hover:bg-sky-50 hover:text-sky-600",
  },
  {
    href: "/dashboard/kpi/templates",
    label: "Việc định kỳ",
    icon: Repeat,
    matchPrefixes: ["/dashboard/kpi/templates"],
    activeClass: "bg-gradient-to-br from-teal-100 to-emerald-100 text-teal-700 border-teal-200 shadow-sm",
    hoverClass: "hover:bg-teal-50 hover:text-teal-600",
  },
  {
    href: "/dashboard/kpi/5s",
    label: "Đánh giá 5S",
    icon: Sparkles,
    matchPrefixes: ["/dashboard/kpi/5s"],
    activeClass: "bg-gradient-to-br from-amber-100 to-orange-100 text-amber-700 border-amber-200 shadow-sm",
    hoverClass: "hover:bg-amber-50 hover:text-amber-600",
  },
  {
    href: "/dashboard/kpi/appeals",
    label: "Khiếu nại",
    icon: Flag,
    matchPrefixes: ["/dashboard/kpi/appeals"],
    activeClass: "bg-gradient-to-br from-rose-100 to-pink-100 text-rose-700 border-rose-200 shadow-sm",
    hoverClass: "hover:bg-rose-50 hover:text-rose-600",
  },
]

function isActive(pathname: string, tab: NavTab) {
  if (tab.matchPrefixes && tab.matchPrefixes.length > 0) {
    return tab.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  }
  return pathname === tab.href
}

type KpiShellProps = {
  children?: ReactNode
}

export function KpiShell({ children }: KpiShellProps) {
  const pathname = usePathname()

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex gap-1.5 p-2 overflow-x-auto">
          {tabs.map((tab) => {
            const active = isActive(pathname, tab)
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={
                  "hover-lift flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap border transition-colors " +
                  (active ? tab.activeClass : `bg-white text-slate-600 border-transparent ${tab.hoverClass}`)
                }
              >
                <Icon size={14} />
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>

      {children}
    </div>
  )
}
