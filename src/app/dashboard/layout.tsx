"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Activity,
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Factory,
  FileOutput,
  FileText,
  Home,
  LogOut,
  Map,
  Menu,
  NotebookPen,
  Package,
  Settings,
  Shield,
  Truck,
  Warehouse,
  Wrench,
  X,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import {
  authBlockReason,
  getFreshAuthSession,
  hasPermission,
  hydrateActiveSession,
  isAuthSessionError,
  signOutEverywhere,
  type AppRole,
  type SessionUser,
} from "@/lib/auth"
import { getModuleTasks, type ModuleTaskSummary } from "./_components/module-tasks"

interface AppNotification {
  id: string
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

type NavLeaf = {
  key: string
  label: string
  icon: typeof Home
  permission?: string
  // Ẩn mục này hẳn với các role liệt kê, kể cả khi không cần permission (vd "Dashboard"
  // nội bộ không phù hợp cho role="customer" — họ chỉ được thấy "Đơn hàng của tôi").
  hiddenForRoles?: AppRole[]
  // Chỉ hiện mục này cho đúng các role liệt kê — dùng cho mục dành riêng cho customer
  // ("Đơn hàng của tôi"), vì `hasPermission()` cho admin bypass mọi permission check nên
  // chỉ dùng `permission` không đủ để ẩn khỏi admin/manager/user.
  onlyForRoles?: AppRole[]
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
  { key: "/dashboard", label: "Dashboard", icon: Home, hiddenForRoles: ["customer"] },
  {
    key: "/dashboard/customer-portal",
    label: "Đơn hàng của tôi",
    icon: FileOutput,
    permission: "export.view_own",
    onlyForRoles: ["customer"],
  },
  { key: "/dashboard/notes", label: "Ghi chú nhanh", icon: NotebookPen, permission: "notes.view" },
  { key: "/dashboard/map", label: "Bản đồ lô", icon: Map, hiddenForRoles: ["customer"] },
  { key: "/dashboard/eudr", label: "EUDR / Truy xuất", icon: Shield, hiddenForRoles: ["customer"] },
  {
    key: "production",
    label: "Quản lý sản xuất",
    icon: Factory,
    children: [
      { key: "/dashboard/dispatch", label: "Điều xe", icon: Truck, permission: "dispatch.view" },
      { key: "/dashboard/output", label: "Sản lượng", icon: BarChart3, permission: "output.view" },
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
      { key: "/dashboard/warehouse", label: "Kho thành phẩm", icon: Warehouse, permission: "warehouse.view" },
      {
        key: "/dashboard/quality",
        label: "Chất lượng",
        icon: ClipboardCheck,
        permission: "quality.view",
      },
      { key: "/dashboard/export", label: "Xuất hàng", icon: FileOutput, permission: "export.view" },
      { key: "/dashboard/maintenance", label: "Bảo trì", icon: Wrench, permission: "maintenance.view" },
      { key: "/dashboard/process", label: "Kiểm soát quá trình", icon: Activity, permission: "process.view" },
    ],
  },
  {
    key: "iso-vanban",
    label: "ISO & Văn bản",
    icon: FileText,
    children: [
      { key: "/dashboard/iso", label: "Quản lý ISO", icon: FileText, permission: "iso.view" },
      { key: "/dashboard/documents", label: "Văn bản nội bộ", icon: FileOutput, permission: "documents.view" },
    ],
  },
  { key: "/dashboard/settings", label: "Cài đặt", icon: Settings, permission: "settings.view" },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isPublicStorageLookup = pathname.startsWith("/dashboard/storage/")
  const [user, setUser] = useState<SessionUser | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ production: true })
  const [loading, setLoading] = useState(true)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const isLoggingOutRef = useRef(false)
  const userDropdownRef = useRef<HTMLDivElement>(null)

  // Notifications
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const unreadCount = notifications.filter((n) => !n.is_read).length

  // Việc cần làm theo module hiện tại (live-computed theo route, xem module-tasks.ts) —
  // độc lập với bảng notifications, không cần migration.
  const [moduleTasks, setModuleTasks] = useState<ModuleTaskSummary | null>(null)
  const moduleRoutePrefix = pathname.split("/").slice(0, 3).join("/") // "/dashboard/xxx"

  useEffect(() => {
    if (isPublicStorageLookup) {
      setLoading(false)
      return
    }

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
  }, [isPublicStorageLookup])

  // Load notifications when user is available
  useEffect(() => {
    if (isPublicStorageLookup) return
    if (!user?.id || !user?.factory_id) return
    const load = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, link, is_read, created_at")
        .eq("factory_id", user.factory_id as string)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15)
      setNotifications((data ?? []) as AppNotification[])
    }
    void load()
  }, [isPublicStorageLookup, user?.id, user?.factory_id])

  // Realtime: append new notifications live
  useEffect(() => {
    if (isPublicStorageLookup) return
    if (!user?.id) return
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          setNotifications((prev) => [payload.new as AppNotification, ...prev].slice(0, 15))
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [isPublicStorageLookup, user?.id])

  // Việc cần làm theo module hiện tại — chỉ tính lại khi đổi MODULE (không phải mỗi lần
  // đổi sub-tab trong cùng module), dùng moduleRoutePrefix làm dependency.
  useEffect(() => {
    if (isPublicStorageLookup) return
    if (!user?.id || !user?.factory_id) { setModuleTasks(null); return }
    let alive = true
    void getModuleTasks(pathname, user.factory_id as string, user)
      .then((summary) => { if (alive) setModuleTasks(summary) })
      .catch(() => { if (alive) setModuleTasks(null) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublicStorageLookup, user?.id, user?.factory_id, moduleRoutePrefix])

  // count > 0 ở module hiện tại → chỉ hiện section module, ẩn "Thông báo chung" (quyết định đã chốt)
  const hasModuleTasks = !!moduleTasks && moduleTasks.items.some((i) => i.count > 0)

  const goToNotification = (link: string | null) => {
    setNotifOpen(false)
    if (link) router.push(link)
  }

  const visibleNav: NavItem[] = NAV.flatMap((item) => {
    if (isNavGroup(item)) {
      const children = item.children.filter((child) => hasPermission(user, child.permission || ""))
      return children.length ? [{ ...item, children }] : []
    }

    if (item.hiddenForRoles?.includes(user?.role as AppRole)) return []
    if (item.onlyForRoles && !item.onlyForRoles.includes(user?.role as AppRole)) return []
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

  useEffect(() => {
    if (isPublicStorageLookup) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false)
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("touchstart", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("touchstart", handleClickOutside)
    }
  }, [isPublicStorageLookup])

  // Khi bootstrap xong nhưng không có user (lỗi mạng tạm thời / session hết hạn không phải auth error)
  // → redirect về login thay vì để spinner treo vô hạn
  useEffect(() => {
    if (isPublicStorageLookup) return
    if (!loading && !user) {
      window.location.replace("/login")
    }
  }, [isPublicStorageLookup, loading, user])

  // Tài khoản role="customer" chỉ được dùng "Đơn hàng của tôi" — đây chỉ là UX điều hướng,
  // KHÔNG phải lớp bảo vệ chính. Bảo mật thật nằm ở RESTRICTIVE RLS + API route tự verify
  // quyền (xem supabase/migrations/20260708_customer_portal_export_grants.sql).
  useEffect(() => {
    if (isPublicStorageLookup) return
    if (loading || !user) return
    if (user.role === "customer" && !pathname.startsWith("/dashboard/customer-portal")) {
      router.replace("/dashboard/customer-portal")
    }
  }, [isPublicStorageLookup, loading, user, pathname, router])

  // Đóng drawer menu mobile khi bấm phím Escape
  useEffect(() => {
    if (!mobileNavOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [mobileNavOpen])

  if (isPublicStorageLookup) {
    return <>{children}</>
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
      </div>
    )
  }

  // Print pages và trang xác nhận quét QR (full-screen, không sidebar) bypass layout entirely
  if (pathname.includes("/print") || pathname.startsWith("/dashboard/product/confirm")) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-shrink-0 flex-col bg-slate-900 text-white transition-transform duration-300 md:relative md:z-auto md:w-auto md:translate-x-0 md:transition-all " +
          (mobileNavOpen ? "translate-x-0" : "-translate-x-full") +
          " " +
          (collapsed ? "md:w-16" : "md:w-64")
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
          <button onClick={() => setCollapsed(!collapsed)} className="hidden text-slate-400 hover:text-white md:flex">
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
                          onClick={() => {
                            router.push(child.key)
                            setMobileNavOpen(false)
                          }}
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
                onClick={() => {
                  router.push(item.key)
                  setMobileNavOpen(false)
                }}
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

      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur-sm md:px-6">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 transition-colors md:hidden"
            aria-label="Mở menu điều hướng"
          >
            <Menu size={18} />
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {/* Bell notifications */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative flex h-10 w-10 items-center justify-center rounded-xl hover:bg-slate-100 transition-colors"
              title="Thông báo"
            >
              <Bell size={17} className="text-slate-500" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <>
                {/* Backdrop — chỉ trên mobile, biến panel bên dưới thành bottom-sheet */}
                <div
                  className="fixed inset-0 z-40 bg-black/50 md:hidden"
                  onClick={() => setNotifOpen(false)}
                  aria-hidden="true"
                />
                <div
                  className={
                    "fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl overflow-hidden " +
                    "md:absolute md:inset-x-auto md:bottom-auto md:right-2 md:top-full md:z-auto md:mt-2 md:w-80 md:rounded-2xl md:border md:border-slate-200 md:shadow-xl md:ring-1 md:ring-black/5"
                  }
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                    <span className="text-sm font-bold text-slate-700">
                      {hasModuleTasks ? `Việc cần làm — ${moduleTasks!.moduleLabel}` : "Thông báo"}
                    </span>
                    <div className="flex items-center gap-3">
                      {!hasModuleTasks && unreadCount > 0 && (
                        <button
                          onClick={async () => {
                            const ids = notifications.filter((n) => !n.is_read).map((n) => n.id)
                            if (ids.length === 0) return
                            await supabase.from("notifications").update({ is_read: true }).in("id", ids)
                            setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
                          }}
                          className="text-[11px] font-bold text-emerald-600 hover:text-emerald-800"
                        >
                          Đánh dấu tất cả đã đọc
                        </button>
                      )}
                      <button
                        onClick={() => setNotifOpen(false)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:hidden"
                        aria-label="Đóng"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[65dvh] overflow-y-auto md:max-h-80">
                    {hasModuleTasks ? (
                      moduleTasks!.items.map((item) => (
                        <button
                          key={item.label}
                          onClick={() => goToNotification(item.link)}
                          disabled={item.count === 0}
                          className="w-full flex items-center justify-between gap-3 text-left px-4 py-3 border-b border-slate-50 transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          <span className="text-sm font-semibold text-slate-700">{item.label}</span>
                          <span
                            className={
                              "shrink-0 min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-bold " +
                              (item.count > 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-400")
                            }
                          >
                            {item.count}
                          </span>
                        </button>
                      ))
                    ) : notifications.length === 0 ? (
                      <div className="py-8 text-center text-sm text-slate-400">Không có thông báo</div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          onClick={async () => {
                            if (!n.is_read) {
                              await supabase.from("notifications").update({ is_read: true }).eq("id", n.id)
                              setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true } : x))
                            }
                            goToNotification(n.link)
                          }}
                          className={
                            "w-full text-left px-4 py-3 border-b border-slate-50 transition-colors hover:bg-slate-50 " +
                            (n.is_read ? "opacity-60" : "")
                          }
                        >
                          <div className="flex items-start gap-2">
                            {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
                            <div className={!n.is_read ? "" : "pl-4"}>
                              <p className="text-xs font-bold text-slate-800 line-clamp-1">{n.title}</p>
                              {n.body && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>}
                              <p className="text-[10px] text-slate-400 mt-1">
                                {new Date(n.created_at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div ref={userDropdownRef} className="relative">
            <button
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              className="flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-1.5 transition-all duration-200 hover:bg-slate-100 active:scale-95"
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white shadow-sm">
                {user.full_name?.[0] || "U"}
              </div>
              <span className="hidden max-w-[8rem] truncate text-sm font-semibold text-slate-700 sm:inline sm:max-w-[10rem] md:max-w-[14rem]">
                {user.full_name}
              </span>
              <ChevronDown
                size={14}
                className={
                  "text-slate-400 transition-transform duration-200 " +
                  (userDropdownOpen ? "rotate-180" : "")
                }
              />
            </button>

            {userDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-slate-200 bg-white py-2 shadow-xl ring-1 ring-black/5">
                <div className="border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                      {user.full_name?.[0] || "U"}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-800">{user.full_name}</div>
                      <div className="truncate text-xs capitalize text-slate-500">{user.role}</div>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                >
                  <LogOut size={15} />
                  Đăng xuất
                </button>
              </div>
            )}
          </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
