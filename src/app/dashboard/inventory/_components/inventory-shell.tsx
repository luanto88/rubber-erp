"use client"

import { usePathname } from "next/navigation"
import { ArrowRightLeft, BarChart3, Boxes, Layers, LayoutDashboard, PackageMinus, PackagePlus, ScrollText, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { InventoryActionBar } from "./inventory-ui"

type SubTab = {
  href: string
  label: string
  icon: LucideIcon
  /** Route phụ (không phải thẻ) vẫn được coi là thuộc thẻ này — vd /cards thuộc Tồn. */
  extraPrefixes?: string[]
}

type TabGroup = {
  key: string
  label: string
  icon: LucideIcon
  tabs: SubTab[]
}

type InventoryPageShellProps = {
  title: string
  description: string
  eyebrow?: string
  /** Nút thao tác — hiển thị bên phải hàng thẻ con, ngay trên nội dung mà nó tác động. */
  action?: ReactNode
  children?: ReactNode
}

// Cấu trúc 2 nhóm (2026-10-03):
//  - "Nhập xuất tồn": 4 thẻ nghiệp vụ, mỗi thẻ là 1 danh sách có bộ lọc + nút Thêm.
//  - "Báo cáo": Tổng quan (thống kê, cảnh báo) + Sổ chi tiết (tra cứu phát sinh, xuất file).
// "Thẻ kho" (in nhãn QR) không còn là thẻ — mở từ nút "In nhãn QR" trên thẻ Tồn.
const TAB_GROUPS: TabGroup[] = [
  {
    key: "operations",
    label: "Nhập xuất tồn",
    icon: Layers,
    tabs: [
      { href: "/dashboard/inventory/receipts", label: "Nhập", icon: PackagePlus },
      { href: "/dashboard/inventory/issues", label: "Xuất", icon: PackageMinus },
      { href: "/dashboard/inventory/transfers", label: "Chuyển", icon: ArrowRightLeft },
      { href: "/dashboard/inventory/on-hand", label: "Tồn", icon: Boxes, extraPrefixes: ["/dashboard/inventory/cards"] },
    ],
  },
  {
    key: "reports",
    label: "Báo cáo",
    icon: BarChart3,
    tabs: [
      { href: "/dashboard/inventory/analytics", label: "Tổng quan", icon: LayoutDashboard },
      { href: "/dashboard/inventory/lookup", label: "Sổ chi tiết", icon: ScrollText },
    ],
  },
]

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function isTabActive(pathname: string, tab: SubTab) {
  return [tab.href, ...(tab.extraPrefixes || [])].some((prefix) => isActivePath(pathname, prefix))
}

export function InventoryPageShell({
  title,
  description,
  action,
  children,
}: InventoryPageShellProps) {
  const pathname = usePathname()
  const revealRef = useScrollReveal()
  const activeGroup = TAB_GROUPS.find((group) => group.tabs.some((tab) => isTabActive(pathname, tab))) || TAB_GROUPS[0]
  const activeTab = activeGroup.tabs.find((tab) => isTabActive(pathname, tab))

  return (
    <div className={`${moduleThemeClass("amber")} space-y-4`}>
      <PageBackgroundMotif theme="amber" />
      <PageHeaderBanner title={title} subtitle={description} theme="amber" icon={Boxes} />

      <section
        ref={revealRef}
        className="scroll-reveal rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
      >
        <SegmentedTabs
          ariaLabel="Nhóm chức năng kho"
          fullWidth
          className="sm:w-fit"
          value={activeGroup.key}
          items={TAB_GROUPS.map((group) => ({
            key: group.key,
            label: group.label,
            icon: group.icon,
            href: group.tabs[0].href,
          }))}
        />

        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SegmentedTabs
            ariaLabel="Thẻ chức năng kho"
            value={activeTab?.href ?? null}
            items={activeGroup.tabs.map((tab) => ({
              key: tab.href,
              label: tab.label,
              icon: tab.icon,
              href: tab.href,
            }))}
          />
          {action ? <InventoryActionBar className="lg:shrink-0">{action}</InventoryActionBar> : null}
        </div>
      </section>

      {children}
    </div>
  )
}

export function ScrollReveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useScrollReveal()
  return (
    <div ref={ref} className={`scroll-reveal${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  )
}

export function ScrollRevealSection({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useScrollReveal()
  return (
    <section ref={ref} className={`scroll-reveal section-hover${className ? ` ${className}` : ""}`}>
      {children}
    </section>
  )
}

export function InventoryPlaceholderSection({
  title,
  description,
  bullets,
  icon,
}: {
  title: string
  description: string
  bullets: string[]
  icon?: ReactNode
}) {
  const revealRef = useScrollReveal()

  return (
    <section
      ref={revealRef}
      className="scroll-reveal rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        {icon ? <div className="rounded-xl bg-slate-100 p-3 text-slate-700">{icon}</div> : null}
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-800">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {bullets.map((bullet) => (
          <div key={bullet} className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {bullet}
          </div>
        ))}
      </div>
    </section>
  )
}
