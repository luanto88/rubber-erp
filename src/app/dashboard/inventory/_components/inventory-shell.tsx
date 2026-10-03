"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowRightLeft, BarChart3, Boxes, Layers, LayoutDashboard, PackageMinus, PackagePlus, ScrollText, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"

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

  return (
    <div className="space-y-4">
      <PageBackgroundMotif theme="amber" />
      <PageHeaderBanner title={title} subtitle={description} theme="amber" icon={Boxes} />

      <section
        ref={revealRef}
        className="scroll-reveal rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
      >
        <div className="flex gap-1.5 rounded-2xl bg-slate-100 p-1.5">
          {TAB_GROUPS.map((group) => {
            const active = group.key === activeGroup.key
            const Icon = group.icon
            return (
              <Link
                key={group.key}
                href={group.tabs[0].href}
                className={
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all sm:flex-none sm:px-6 " +
                  (active ? "bg-white text-amber-800 shadow-sm" : "text-slate-500 hover:text-slate-800")
                }
              >
                <Icon size={16} />
                {group.label}
              </Link>
            )
          })}
        </div>

        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {activeGroup.tabs.map((tab) => {
              const active = isTabActive(pathname, tab)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={
                    "flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all " +
                    (active
                      ? "bg-amber-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-amber-50 hover:text-amber-800")
                  }
                >
                  <tab.icon size={15} />
                  {tab.label}
                </Link>
              )
            })}
          </div>
          {action ? <div className="flex flex-wrap items-center gap-2 lg:justify-end">{action}</div> : null}
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
