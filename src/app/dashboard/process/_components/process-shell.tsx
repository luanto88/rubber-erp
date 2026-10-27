"use client"

import { usePathname } from "next/navigation"
import { Activity, BarChart2, ClipboardCheck } from "lucide-react"
import type { ReactNode } from "react"
import { SegmentedTabs, type SegmentedTabItem } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"

type ProcessTabKey = "overview" | "params" | "measurements"

const TAB_ITEMS: SegmentedTabItem<ProcessTabKey>[] = [
  { key: "overview", label: "Tổng quan", icon: BarChart2, href: "/dashboard/process" },
  { key: "params", label: "Thông số kỹ thuật", icon: Activity, href: "/dashboard/process/params" },
  { key: "measurements", label: "Đo nhanh chỉ tiêu", icon: ClipboardCheck, href: "/dashboard/process/measurements" },
]

function activeTab(pathname: string): ProcessTabKey | null {
  if (pathname === "/dashboard/process") return "overview"
  if (pathname.startsWith("/dashboard/process/params")) return "params"
  if (pathname.startsWith("/dashboard/process/measurements")) return "measurements"
  return null
}

type ProcessShellProps = {
  children?: ReactNode
  /** Banner `PageHeaderBanner` của trang — luôn đặt trên thanh tab. */
  banner?: ReactNode
  /** Ẩn thanh tab (trang chi tiết phiếu có nút quay lại riêng). */
  hideTabs?: boolean
}

// Vỏ module Kiểm soát quá trình (rule 29): màu điều hướng teal + thanh tab chuẩn SegmentedTabs.
export function ProcessShell({ children, banner, hideTabs = false }: ProcessShellProps) {
  const pathname = usePathname()

  return (
    <div className={`${moduleThemeClass("teal")} space-y-4`}>
      {banner}
      {!hideTabs && (
        <SegmentedTabs ariaLabel="Chọn mục Kiểm soát quá trình" value={activeTab(pathname)} items={TAB_ITEMS} />
      )}
      {children}
    </div>
  )
}
