"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  ChevronRight,
  ClipboardCheck,
  Factory,
  FileOutput,
  Home,
  LogOut,
  Map,
  Menu,
  Package,
  Settings,
  Shield,
  Truck,
  Warehouse,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import {
  authBlockReason,
  getFreshAuthSession,
  hasPermission,
  hydrateActiveSession,
  isAuthSessionError,
  signOutEverywhere,
  type SessionUser,
} from "@/lib/auth"

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
  { key: "/dashboard/map", label: "Bản đồ lô", icon: Map },
  { key: "/dashboard/eudr", label: "EUDR / Truy xuất", icon: Shield },
  {
    key: "production",
    label: "Quản lý sản xuất",
    icon: Factory,
    children: [
      { key: "/dashboard/dispatch", label: "Điều xe", icon: Truck, permission: "dispatch.view" },
      {
        key: "/dashboard/storage",
        label: "Kho nguyên liệu",
        icon: Warehouse,
        permission: "storage.view",
      },
      {
        key: "/dashboard/inventory",
        label: "Quản lý kho",
        icon: Warehouse,
        permission: "inventory.view",
      },
      { key: "/dashboard/product", label: "Thành phẩm", icon: Package, permission: "product.view" },
      {
        key: "/dashboard/quality",
        label: "Chất lượng",
        icon: ClipboardCheck,
        permission: "quality.view",
      },
      { key: "/dashboard/export", label: "Xuất hàng", icon: FileOutput, permission: "export.view" },
    ],
  },
  { key: "/dashboard/settings", label: "Cài đặt", icon: Settings, permission: "settings.view" },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ production: true })
  const [loading, setLoading] = useState(true)
  const isLoggingOutRef = useRef(false)

  useEffect(() => {
    let alive = true
    let syncing = false
    let lastSyncTime = 0
    let bootstrapDone = false

    /**
     * fullHydration=true  → fetch profile + permissions (bootstrap / SIGNED_IN)
     * fullHydration=false → chỉ kiểm tra session token còn hợp lệ (interval / focus)
     *
     * Interval/focus dùng lightweight để tránh 4-5 DB query mỗi 60s.
     * Lỗi DB trong DB query có thể match isAuthSessionError và xóa user nhầm.
     */
    const syncSession = async (redirectBase = "/login", fullHydration = true) => {
      if (syncing) return
      syncing = true
      try {
        if (!fullHydration) {
          // Lightweight: chỉ verify token còn sống, không gọi DB
          const session = await getFreshAuthSession()
          if (!session?.user && alive) {
            setUser(null)
            window.location.replace(redirectBase)
          }
          return
        }

        // Full hydration: fetch profile + permissions
        const { session, user: sessionUser } = await hydrateActiveSession()
        if (!session?.user) {
          if (alive) {
            setUser(null)
            window.location.replace(redirectBase)
          }
          return
        }

        const blocked = authBlockReason(sessionUser)
        if (!sessionUser || blocked) {
          await signOutEverywhere()
          if (alive) window.location.replace(`/login${blocked ? `?reason=${blocked}` : ""}`)
          return
        }

        if (alive) setUser(sessionUser)
      } catch (error) {
        console.error("dashboard session sync failed", error)
        // Chỉ xóa session khi lỗi xác thực thực sự, không phải lỗi mạng tạm thời
        if (alive && isAuthSessionError(error)) {
          setUser(null)
          window.location.replace("/login")
        }
      } finally {
        syncing = false
      }
    }

    const bootstrap = async () => {
      try {
        // Timeout 10s: nếu hydrateActiveSession treo do mạng chậm,
        // vẫn hạ loading để tránh spinner treo vô hạn
        await Promise.race([
          syncSession("/login", true),
          new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
        ])
      } finally {
        bootstrapDone = true
        if (alive) setLoading(false)
      }
    }

    void bootstrap()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Chỉ xử lý SIGNED_IN / SIGNED_OUT — bỏ qua TOKEN_REFRESHED để tránh vòng lặp
      if (event === "SIGNED_OUT" || !session?.user) {
        // Bỏ qua nếu đang logout thủ công — handleLogout sẽ navigate
        if (isLoggingOutRef.current) return
        // Supabase có thể fire SIGNED_OUT khi network blip xảy ra lúc auto-refresh.
        // Thử lấy lại session trước khi redirect để tránh false-positive.
        try {
          const recovered = await getFreshAuthSession()
          if (recovered?.user && alive) return
        } catch {
          // không recover được, tiếp tục redirect
        }
        if (alive) {
          setUser(null)
          window.location.replace("/login")
        }
        return
      }
      if (event === "SIGNED_IN") {
        // Bỏ qua nếu bootstrap đã hoàn thành — tránh double full hydration
        if (!bootstrapDone) {
          await syncSession("/login", true)
        }
      }
    })

    // Interval: lightweight — chỉ verify token, không fetch DB
    const intervalId = window.setInterval(() => {
      void syncSession("/login", false)
    }, 60_000)

    const handleVisibilityOrFocus = () => {
      const now = Date.now()
      if (document.visibilityState === "visible" && now - lastSyncTime > 30_000) {
        lastSyncTime = now
        void syncSession("/login", false)
      }
    }

    window.addEventListener("focus", handleVisibilityOrFocus)
    document.addEventListener("visibilitychange", handleVisibilityOrFocus)

    return () => {
      alive = false
      subscription.unsubscribe()
      window.clearInterval(intervalId)
      window.removeEventListener("focus", handleVisibilityOrFocus)
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus)
    }
  }, [])

  const visibleNav: NavItem[] = NAV.flatMap((item) => {
    if (isNavGroup(item)) {
      const children = item.children.filter((child) => hasPermission(user, child.permission || ""))
      return children.length ? [{ ...item, children }] : []
    }

    if (item.permission && !hasPermission(user, item.permission)) return []
    return [item]
  })

  const handleLogout = async () => {
    isLoggingOutRef.current = true
    try {
      await signOutEverywhere()
    } finally {
      window.location.replace("/login")
    }
  }

  // Khi bootstrap xong nhưng không có user (lỗi mạng tạm thời / session hết hạn không phải auth error)
  // → redirect về login thay vì để spinner treo vô hạn
  useEffect(() => {
    if (!loading && !user) {
      window.location.replace("/login")
    }
  }, [loading, user])

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={
          (collapsed ? "w-16" : "w-64") +
          " flex flex-shrink-0 flex-col bg-slate-900 text-white transition-all duration-300"
        }
      >
        <div className="flex items-center gap-3 border-b border-slate-700 p-4">
          {!collapsed ? (
            <>
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-emerald-500/40 bg-white">
                <Image
                  src="/logo-nha-may-5.jpg"
                  alt="Logo nhà máy"
                  width={48}
                  height={48}
                  className="h-8 w-8 object-contain"
                  priority
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-extrabold">Nhà máy chế biến Phước Hòa KPT</div>
                <div className="truncate text-[10px] text-emerald-400">Hệ thống quản lý sản xuất</div>
              </div>
            </>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-emerald-500/40 bg-white">
              <Image
                src="/logo-nha-may-5.jpg"
                alt="Logo nhà máy"
                width={40}
                height={40}
                className="h-7 w-7 object-contain"
                priority
              />
            </div>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="text-slate-400 hover:text-white">
            <Menu size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {visibleNav.map((item) => {
            if (isNavGroup(item)) {
              const isOpen = expanded[item.key]
              const isChildActive = item.children.some(
                (child) => pathname === child.key || pathname.startsWith(`${child.key}/`),
              )

              return (
                <div key={item.key}>
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                    className={
                      "w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold transition-colors " +
                      (isChildActive
                        ? "text-emerald-400"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white")
                    }
                  >
                    <item.icon size={18} />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronRight
                          size={14}
                          className={"transition-transform " + (isOpen ? "rotate-90" : "")}
                        />
                      </>
                    )}
                  </button>

                  {isOpen &&
                    !collapsed &&
                    item.children.map((child) => {
                      const childActive = pathname === child.key || pathname.startsWith(`${child.key}/`)
                      return (
                        <button
                          key={child.key}
                          onClick={() => router.push(child.key)}
                          className={
                            "w-full flex items-center gap-3 py-2 pl-10 pr-4 text-sm transition-colors " +
                            (childActive
                              ? "bg-slate-800 font-bold text-emerald-400"
                              : "text-slate-400 hover:bg-slate-800 hover:text-white")
                          }
                        >
                          <child.icon size={15} />
                          <span>{child.label}</span>
                        </button>
                      )
                    })}
                </div>
              )
            }

            const itemActive = pathname === item.key || pathname.startsWith(`${item.key}/`)

            return (
              <button
                key={item.key}
                onClick={() => router.push(item.key)}
                className={
                  "w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold transition-colors " +
                  (itemActive
                    ? "bg-slate-800 text-emerald-400"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white")
                }
              >
                <item.icon size={18} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            )
          })}
        </nav>

        <div className="border-t border-slate-700 p-4">
          <div className={"flex items-center gap-3 " + (collapsed ? "justify-center" : "")}>
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold">
              {user.full_name?.[0] || "U"}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{user.full_name}</div>
                <div className="truncate text-[10px] text-slate-400">
                  {user.role} - {user.username}
                </div>
              </div>
            )}
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-400" title="Đăng xuất">
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
