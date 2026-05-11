"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ClipboardList, History, LayoutDashboard, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

type NavTab = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefixes?: string[]
}

const tabs: NavTab[] = [
  {
    href: "/dashboard/maintenance",
    label: "Tổng quan",
    icon: LayoutDashboard,
    matchPrefixes: [],
  },
  {
    href: "/dashboard/maintenance/records",
    label: "Biên bản",
    icon: ClipboardList,
    matchPrefixes: ["/dashboard/maintenance/records"],
  },
  {
    href: "/dashboard/maintenance/history",
    label: "Lý lịch thiết bị",
    icon: History,
    matchPrefixes: ["/dashboard/maintenance/history"],
  },
]

function isActive(pathname: string, tab: NavTab) {
  if (tab.matchPrefixes && tab.matchPrefixes.length > 0) {
    return tab.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  }
  return pathname === tab.href
}

type MaintenanceShellProps = {
  children?: ReactNode
}

export function MaintenanceShell({ children }: MaintenanceShellProps) {
  const pathname = usePathname()

  return (
    <div className="space-y-4">
      {/* Tab navigation */}
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
                    ? "bg-orange-50 text-orange-700 border-orange-200"
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
