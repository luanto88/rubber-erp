"use client"

// Shell điều hướng module "Quản lý công việc & Đánh giá KPI nhân viên".
// Xem kiến trúc đầy đủ + roadmap từng phase tại .claude/rules/27-kpi-module.md.
//
// Phase 1a (2026-07-24): thêm tab "Công việc" (giao việc, A + B). Các tab còn lại (Đánh giá
// 5S, Chấm điểm chuyên môn, Bảng điểm KPI) sẽ được thêm dần theo đúng phase — KHÔNG liệt kê
// link tới route chưa tồn tại ở đây để tránh 404 khi bấm nhầm.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ClipboardList, LayoutDashboard, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

type NavTab = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefixes?: string[]
}

const tabs: NavTab[] = [
  {
    href: "/dashboard/kpi",
    label: "Tổng quan",
    icon: LayoutDashboard,
    matchPrefixes: [],
  },
  {
    href: "/dashboard/kpi/tasks",
    label: "Công việc",
    icon: ClipboardList,
    matchPrefixes: ["/dashboard/kpi/tasks"],
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
        <div className="flex gap-1 p-2 overflow-x-auto">
          {tabs.map((tab) => {
            const active = isActive(pathname, tab)
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all border " +
                  (active
                    ? "bg-violet-50 text-violet-700 border-violet-200"
                    : "bg-white text-slate-600 border-transparent hover:bg-slate-50")
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
