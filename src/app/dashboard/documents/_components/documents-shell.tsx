"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { FileText, Upload, PenLine, ClipboardList, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

type NavTab = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefixes?: string[]
  excludePrefixes?: string[]
}

const tabs: NavTab[] = [
  {
    href: "/dashboard/documents",
    label: "Văn bản",
    icon: FileText,
    matchPrefixes: [],
  },
  {
    href: "/dashboard/documents/new",
    label: "Soạn thảo mới",
    icon: PenLine,
    matchPrefixes: ["/dashboard/documents/new"],
    excludePrefixes: ["/dashboard/documents/new/upload"],
  },
  {
    href: "/dashboard/documents/new/upload",
    label: "Upload ký tay",
    icon: Upload,
    matchPrefixes: ["/dashboard/documents/new/upload"],
  },
  {
    href: "/dashboard/documents/my-tasks",
    label: "Việc của tôi",
    icon: ClipboardList,
    matchPrefixes: ["/dashboard/documents/my-tasks"],
  },
]

function isActive(pathname: string, tab: NavTab) {
  if (tab.excludePrefixes?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return false
  }
  if (tab.matchPrefixes && tab.matchPrefixes.length > 0) {
    return tab.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  }
  return pathname === tab.href
}

type DocumentsShellProps = {
  children?: ReactNode
}

export function DocumentsShell({ children }: DocumentsShellProps) {
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
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700")
                }
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
      {children}
    </div>
  )
}
