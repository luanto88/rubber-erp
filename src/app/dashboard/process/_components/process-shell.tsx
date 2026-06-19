"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, BarChart2, ClipboardCheck, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

type NavTab = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefixes?: string[]
}

const tabs: NavTab[] = [
  {
    href: "/dashboard/process",
    label: "Tổng quan",
    icon: BarChart2,
    matchPrefixes: [],
  },
  {
    href: "/dashboard/process/params",
    label: "Thông số kỹ thuật",
    icon: Activity,
    matchPrefixes: ["/dashboard/process/params"],
  },
  {
    href: "/dashboard/process/measurements",
    label: "Đo nhanh chỉ tiêu",
    icon: ClipboardCheck,
    matchPrefixes: ["/dashboard/process/measurements"],
  },
]

function isActive(pathname: string, tab: NavTab) {
  if (tab.matchPrefixes && tab.matchPrefixes.length > 0) {
    return tab.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  }
  return pathname === tab.href
}

type ProcessShellProps = {
  children?: ReactNode
}

export function ProcessShell({ children }: ProcessShellProps) {
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
                    ? "bg-teal-50 text-teal-700 border-teal-200"
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
