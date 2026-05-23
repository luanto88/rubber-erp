"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { FileText, LayoutDashboard, ListChecks, ClipboardCheck, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

type NavTab = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefixes?: string[]
}

const tabs: NavTab[] = [
  {
    href: "/dashboard/iso",
    label: "Tổng quan",
    icon: LayoutDashboard,
    matchPrefixes: [],
  },
  {
    href: "/dashboard/iso/documents",
    label: "Tài liệu ISO",
    icon: FileText,
    matchPrefixes: ["/dashboard/iso/documents"],
  },
  {
    href: "/dashboard/iso/my-tasks",
    label: "Việc của tôi",
    icon: ClipboardCheck,
    matchPrefixes: ["/dashboard/iso/my-tasks"],
  },
]

function isActive(pathname: string, tab: NavTab) {
  if (tab.matchPrefixes && tab.matchPrefixes.length > 0) {
    return tab.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  }
  return pathname === tab.href
}

type IsoShellProps = {
  children?: ReactNode
}

export function IsoShell({ children }: IsoShellProps) {
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
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all " +
                  (active
                    ? "bg-violet-50 text-violet-700"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700")
                }
              >
                <Icon size={15} />
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
