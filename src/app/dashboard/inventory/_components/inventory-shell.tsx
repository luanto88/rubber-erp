"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowRightLeft, BarChart3, Boxes, Layers, PackageMinus, PackagePlus, ScrollText, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useScrollReveal } from "@/lib/useScrollReveal"

type PrimaryTab = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefixes: string[]
}

type SecondaryTab = {
  href: string
  label: string
  icon: LucideIcon
}

type InventoryPageShellProps = {
  title: string
  description: string
  eyebrow?: string
  action?: ReactNode
  children?: ReactNode
}

const primaryTabs: PrimaryTab[] = [
  {
    href: "/dashboard/inventory/receipts",
    label: "Nhập xuất tồn",
    icon: Layers,
    matchPrefixes: [
      "/dashboard/inventory",
      "/dashboard/inventory/receipts",
      "/dashboard/inventory/issues",
      "/dashboard/inventory/transfers",
      "/dashboard/inventory/on-hand",
      "/dashboard/inventory/cards",
    ],
  },
  {
    href: "/dashboard/inventory/analytics",
    label: "Thống kê",
    icon: BarChart3,
    matchPrefixes: ["/dashboard/inventory/analytics"],
  },
]

const operationalTabs: SecondaryTab[] = [
  { href: "/dashboard/inventory/receipts", label: "Nhập kho", icon: PackagePlus },
  { href: "/dashboard/inventory/issues", label: "Xuất kho", icon: PackageMinus },
  { href: "/dashboard/inventory/transfers", label: "Chuyển kho", icon: ArrowRightLeft },
  { href: "/dashboard/inventory/on-hand", label: "Tồn kho", icon: Boxes },
  { href: "/dashboard/inventory/cards", label: "Thẻ kho", icon: ScrollText },
]

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function matchesAnyPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => isActivePath(pathname, prefix))
}

export function InventoryPageShell({
  title,
  description,
  eyebrow = "Quản lý kho",
  action,
  children,
}: InventoryPageShellProps) {
  const pathname = usePathname()
  const revealRef = useScrollReveal()
  const inOperationalArea = matchesAnyPrefix(pathname, primaryTabs[0].matchPrefixes)

  return (
    <div className="space-y-4">
      <section
        ref={revealRef}
        className="scroll-reveal rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              {eyebrow}
            </div>
            <h1 className="mt-2 text-2xl font-extrabold text-slate-800">{title}</h1>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          {action ? <div className="flex items-center gap-2">{action}</div> : null}
        </div>

        <div className="mt-6 flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-1.5">
          {primaryTabs.map((tab) => {
            const active = matchesAnyPrefix(pathname, tab.matchPrefixes)
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={
                  "flex items-center gap-2 rounded-2xl px-6 py-2 text-sm font-bold transition-all " +
                  (active
                    ? "bg-white text-slate-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-800")
                }
              >
                <Icon size={16} />
                {tab.label}
              </Link>
            )
          })}
        </div>

        {inOperationalArea ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {operationalTabs.map((tab) => {
              const active = isActivePath(pathname, tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={
                    "flex items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold transition-all " +
                    (active
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-800")
                  }
                >
                  <tab.icon size={15} />
                  {tab.label}
                </Link>
              )
            })}
          </div>
        ) : null}
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
