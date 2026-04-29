"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  Home,
  Truck,
  Warehouse,
  Package,
  ClipboardCheck,
  FileOutput,
  Settings,
  LogOut,
  ChevronRight,
  Menu,
  Factory,
  Map,
  Shield,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { authBlockReason, hasPermission, hydrateActiveSession, signOutEverywhere, type SessionUser } from "@/lib/auth"

type NavLeaf = {
  key: string
  label: string
  icon: typeof Home
  permission?: string
}

type NavGroup = {
  key: string
  label: string
  icon: typeof Home
  children: NavLeaf[]
}

type NavItem = NavLeaf | NavGroup

function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item
}

const NAV: NavItem[] = [
  { key: "/dashboard", label: "Dashboard", icon: Home },
  { key: "/dashboard/map", label: "Ban do lo", icon: Map },
  { key: "/dashboard/eudr", label: "EUDR / Truy xuat", icon: Shield },
  {
    key: "production",
    label: "Quan ly San xuat",
    icon: Factory,
    children: [
      { key: "/dashboard/dispatch", label: "Dieu xe", icon: Truck, permission: "dispatch.view" },
      { key: "/dashboard/storage", label: "Kho nguyen lieu", icon: Warehouse, permission: "storage.view" },
      { key: "/dashboard/product", label: "Thanh pham", icon: Package, permission: "product.view" },
      { key: "/dashboard/quality", label: "Chat luong", icon: ClipboardCheck, permission: "quality.view" },
      { key: "/dashboard/export", label: "Xuat hang", icon: FileOutput, permission: "export.view" },
    ],
  },
  { key: "/dashboard/settings", label: "Cai dat", icon: Settings, permission: "settings.view" },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ production: true })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    const bootstrap = async () => {
      try {
        const { user: sessionUser } = await hydrateActiveSession()
        const blocked = authBlockReason(sessionUser)

        if (!sessionUser || blocked) {
          await signOutEverywhere()
          if (alive) router.replace(`/login${blocked ? `?reason=${blocked}` : ""}`)
          return
        }

        if (alive) setUser(sessionUser)
      } finally {
        if (alive) setLoading(false)
      }
    }

    bootstrap()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        setUser(null)
        router.replace("/login")
        return
      }

      const { user: sessionUser } = await hydrateActiveSession()
      const blocked = authBlockReason(sessionUser)
      if (!sessionUser || blocked) {
        await signOutEverywhere()
        router.replace(`/login${blocked ? `?reason=${blocked}` : ""}`)
        return
      }

      setUser(sessionUser)
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [router])

  const visibleNav: NavItem[] = NAV.flatMap((item) => {
    if (isNavGroup(item)) {
      const children = item.children.filter((child) => hasPermission(user, child.permission || ""))
      return children.length ? [{ ...item, children }] : []
    }

    if (item.permission && !hasPermission(user, item.permission)) return []
    return [item]
  })

  const handleLogout = async () => {
    try {
      await signOutEverywhere()
    } finally {
      window.location.replace("/login")
    }
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={(collapsed ? "w-16" : "w-64") + " bg-slate-900 text-white transition-all duration-300 flex flex-col flex-shrink-0"}
      >
        <div className="p-4 flex items-center gap-3 border-b border-slate-700">
          {!collapsed && (
            <>
              <span className="text-2xl">🏭</span>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold text-sm truncate">PTCS Phuoc Hoa</div>
                <div className="text-[10px] text-emerald-400 truncate">Quan ly San xuat v2.0</div>
              </div>
            </>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="text-slate-400 hover:text-white">
            <Menu size={18} />
          </button>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto">
          {visibleNav.map((item) => {
            if (isNavGroup(item)) {
              const isOpen = expanded[item.key]
              const isChildActive = item.children.some((child) => pathname === child.key)

              return (
                <div key={item.key}>
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                    className={
                      "w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold transition-colors " +
                      (isChildActive
                        ? "text-emerald-400"
                        : "text-slate-300 hover:text-white hover:bg-slate-800")
                    }
                  >
                    <item.icon size={18} />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronRight size={14} className={"transition-transform " + (isOpen ? "rotate-90" : "")} />
                      </>
                    )}
                  </button>

                  {isOpen &&
                    !collapsed &&
                    item.children.map((child) => (
                      <button
                        key={child.key}
                        onClick={() => router.push(child.key)}
                        className={
                          "w-full flex items-center gap-3 pl-10 pr-4 py-2 text-sm transition-colors " +
                          (pathname === child.key
                            ? "text-emerald-400 bg-slate-800 font-bold"
                            : "text-slate-400 hover:text-white hover:bg-slate-800")
                        }
                      >
                        <child.icon size={15} />
                        <span>{child.label}</span>
                      </button>
                    ))}
                </div>
              )
            }

            return (
              <button
                key={item.key}
                onClick={() => router.push(item.key)}
                className={
                  "w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold transition-colors " +
                  (pathname === item.key
                    ? "text-emerald-400 bg-slate-800"
                    : "text-slate-300 hover:text-white hover:bg-slate-800")
                }
              >
                <item.icon size={18} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            )
          })}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className={"flex items-center gap-3 " + (collapsed ? "justify-center" : "")}>
            <div className="w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
              {user.full_name?.[0] || "U"}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{user.full_name}</div>
                <div className="text-[10px] text-slate-400 truncate">
                  {user.role} · {user.username}
                </div>
              </div>
            )}
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-400" title="Dang xuat">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  )
}
