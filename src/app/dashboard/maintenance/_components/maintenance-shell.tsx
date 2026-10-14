"use client"

import { usePathname } from "next/navigation"
import { ClipboardList, History, LayoutDashboard, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ModuleThemeScope } from "@/app/dashboard/_components/doc-ui/module-theme"

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

// U1 (2026-10-14): bọc màu module "slate" (phương án C — điều hướng theo màu module, hành động
// luôn brand) + tab module bằng SegmentedTabs dùng chung.
export function MaintenanceShell({ children }: MaintenanceShellProps) {
  const pathname = usePathname()
  const activeTab = tabs.find((tab) => isActive(pathname, tab))

  return (
    <ModuleThemeScope theme="slate" className="space-y-4">
      <SegmentedTabs
        ariaLabel="Chức năng Bảo trì"
        value={activeTab?.href ?? null}
        items={tabs.map((tab) => ({ key: tab.href, label: tab.label, icon: tab.icon, href: tab.href }))}
      />

      {children}
    </ModuleThemeScope>
  )
}
