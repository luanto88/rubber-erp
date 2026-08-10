"use client"

// Shell điều hướng module "Quản lý công việc & Đánh giá KPI nhân viên".
// Xem kiến trúc đầy đủ + roadmap từng phase tại .claude/rules/27-kpi-module.md.
//
// Phase 1a (2026-07-24): thêm tab "Công việc" (giao việc, A + B). Phase 2 (2026-07-26): thêm
// tab "Đánh giá 5S". Cùng đợt: thêm tab "Khiếu nại" (kpi_appeals — xây trước lịch trong roadmap
// Phase 5 vì không phụ thuộc kpi_monthly_scores). Các tab còn lại (Chấm điểm chuyên môn, Bảng
// điểm KPI) sẽ được thêm dần theo đúng phase — KHÔNG liệt kê link tới route chưa tồn tại ở đây
// để tránh 404 khi bấm nhầm.
//
// Redesign (Part C — giao diện riêng module KPI): mỗi tab có tông pastel đậm riêng (không dùng
// 1 màu tím cho mọi tab như trước) + hover-lift, để phân biệt trực quan nhanh hơn giữa các khu
// vực chức năng khác nhau của module.
//
// Fix 2026-07-29: "Việc định kỳ" TRƯỚC ĐÂY bị ẩn hẳn với người không phải admin/kpi.manage_config/
// lãnh đạo phòng ban (qua canSeeKpiTemplatesTab) — đây là bug thật, vì sub-tab "Người thay thế
// tạm thời" bên trong trang đó dành cho MỌI nhân viên tự đăng ký (RLS kpi_user_substitutions_insert
// vốn đã cho phép ai cũng tự đăng ký cho chính mình). Ẩn cả tab khiến nhân viên thường không có
// cách nào vào trang để đăng ký. Tab giờ hiện cho mọi người như 3 tab còn lại — phần quản trị
// (CRUD kpi_task_templates) vẫn tự gate theo quyền NGAY TRONG trang (canManageTemplates).
//
// Phase 3 (2026-08-11): thêm tab "Chấm điểm chuyên môn" (kpi_daily_evaluations) — nộp chấm điểm
// theo ngày cho từng nhóm chuyên môn, dùng chung khung tiêu chí quản trị ở Cài đặt → KPI & 5S →
// Khung tiêu chí KPI. Trang tự gate nút "Lưu" theo quyền kpi.evaluate; ai có kpi.view cũng xem
// được lịch sử chấm điểm (RLS SELECT rộng trong factory).
//
// Phase 4: thêm tab "Bảng điểm KPI" (kpi_monthly_scores) — xem điểm tháng A/B/C/D + hệ số chuyên
// cần + tổng (bản nháp, chưa khóa sổ). Mọi kpi.view user xem điểm của chính mình; xem toàn nhà
// máy chỉ dành cho admin/kpi.view_all + lãnh đạo phòng ban.
//
// Redesign IA (2026-08-19): thêm badge số đỏ trên từng tab — Shell tự bootstrap (session +
// factory) và tự gọi getKpiTasks() độc lập với trang con (không nhận props, mirror cách Bell ở
// layout.tsx tự fetch độc lập trên mọi route) rồi nhóm items theo field `tab` (gắn sẵn trong
// getKpiTasks, xem module-tasks.ts) — không suy luận qua label. "/dashboard/kpi" cũng đổi thành
// trang chủ tổng hợp thật (xem kpi/page.tsx) thay vì chỉ redirect.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Award, ClipboardCheck, ClipboardList, Flag, Repeat, Sparkles, type LucideIcon } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { getKpiTasks } from "@/app/dashboard/_components/module-tasks"

type KpiBadgeTab = "tasks" | "5s" | "templates" | "appeals"

type NavTab = {
  href: string
  label: string
  shortLabel: string
  icon: LucideIcon
  matchPrefixes?: string[]
  activeClass: string
  hoverClass: string
  // Khớp field `tab` của ModuleTaskItem (module-tasks.ts) — tab nào không có giá trị (Chấm điểm
  // chuyên môn, Bảng điểm KPI) thì không bao giờ hiện badge, vì getKpiTasks() chưa có tín hiệu
  // "cần chú ý" nào cho 2 khu vực đó.
  badgeKey?: KpiBadgeTab
}

// "Tổng quan" (route /dashboard/kpi) không còn là tab riêng trong thanh điều hướng — nay là
// trang chủ tổng hợp thật (xem kpi/page.tsx), không active-highlight bất kỳ tab nào ở đây.
const tabs: NavTab[] = [
  {
    href: "/dashboard/kpi/tasks",
    label: "Công việc chuyên môn",
    shortLabel: "Công việc",
    icon: ClipboardList,
    matchPrefixes: ["/dashboard/kpi/tasks"],
    activeClass: "bg-gradient-to-br from-sky-100 to-blue-100 text-sky-700 border-sky-200 shadow-sm",
    hoverClass: "hover:bg-sky-50 hover:text-sky-600",
    badgeKey: "tasks",
  },
  {
    href: "/dashboard/kpi/templates",
    label: "Việc định kỳ",
    shortLabel: "Định kỳ",
    icon: Repeat,
    matchPrefixes: ["/dashboard/kpi/templates"],
    activeClass: "bg-gradient-to-br from-teal-100 to-emerald-100 text-teal-700 border-teal-200 shadow-sm",
    hoverClass: "hover:bg-teal-50 hover:text-teal-600",
    badgeKey: "templates",
  },
  {
    href: "/dashboard/kpi/5s",
    label: "Đánh giá 5S",
    shortLabel: "5S",
    icon: Sparkles,
    matchPrefixes: ["/dashboard/kpi/5s"],
    activeClass: "bg-gradient-to-br from-amber-100 to-orange-100 text-amber-700 border-amber-200 shadow-sm",
    hoverClass: "hover:bg-amber-50 hover:text-amber-600",
    badgeKey: "5s",
  },
  {
    href: "/dashboard/kpi/evaluate",
    label: "Chấm điểm chuyên môn",
    shortLabel: "Chấm điểm",
    icon: ClipboardCheck,
    matchPrefixes: ["/dashboard/kpi/evaluate"],
    activeClass: "bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-700 border-indigo-200 shadow-sm",
    hoverClass: "hover:bg-indigo-50 hover:text-indigo-600",
  },
  {
    href: "/dashboard/kpi/appeals",
    label: "Khiếu nại",
    shortLabel: "Khiếu nại",
    icon: Flag,
    matchPrefixes: ["/dashboard/kpi/appeals"],
    activeClass: "bg-gradient-to-br from-rose-100 to-pink-100 text-rose-700 border-rose-200 shadow-sm",
    hoverClass: "hover:bg-rose-50 hover:text-rose-600",
    badgeKey: "appeals",
  },
  {
    href: "/dashboard/kpi/scores",
    label: "Bảng điểm KPI",
    shortLabel: "Bảng điểm",
    icon: Award,
    matchPrefixes: ["/dashboard/kpi/scores"],
    activeClass: "bg-gradient-to-br from-fuchsia-100 to-purple-100 text-fuchsia-700 border-fuchsia-200 shadow-sm",
    hoverClass: "hover:bg-fuchsia-50 hover:text-fuchsia-600",
  },
]

function isActive(pathname: string, tab: NavTab) {
  if (tab.matchPrefixes && tab.matchPrefixes.length > 0) {
    return tab.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  }
  return pathname === tab.href
}

type KpiShellProps = {
  children?: ReactNode
}

export function KpiShell({ children }: KpiShellProps) {
  const pathname = usePathname()

  // Gradient báo hiệu còn nội dung cuộn — logic duy nhất, nhân bản có chủ đích từ
  // ResponsiveTableWrapper (không refactor thành hook dùng chung để không mở rộng blast radius
  // ra toàn app, xem plan phiên này).
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const update = () => {
      setCanScrollLeft(el.scrollLeft > 4)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
    }

    update()
    el.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(el)

    return () => {
      el.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      resizeObserver.disconnect()
    }
  }, [])

  // Badge số trên tab — Shell tự bootstrap độc lập với trang con (không nhận props), fail-silent
  // hoàn toàn (lỗi/thiếu quyền/thiếu migration chỉ khiến không có badge nào, không phá layout).
  const [session, setSession] = useState<{ factoryId: string; user: SessionUser } | null>(null)
  const [badgeByTab, setBadgeByTab] = useState<Partial<Record<KpiBadgeTab, number>>>({})

  useEffect(() => {
    const cachedUser = JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
    if (!hasPermission(cachedUser, "kpi.view")) return
    let alive = true
    void (async () => {
      try {
        const fid = await getActiveFactoryId()
        if (!fid) return
        const { user } = await hydrateActiveSession()
        if (!user || !alive) return
        setSession({ factoryId: fid, user })
      } catch {
        // im lặng — không có badge, tab bar vẫn hoạt động bình thường
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Refetch mỗi lần đổi route trong module KPI (mirror đúng cách Bell ở layout.tsx tự cập nhật
  // theo pathname) — để hoàn thành 1 việc rồi chuyển tab sẽ thấy badge giảm ngay, không cần F5.
  useEffect(() => {
    if (!session) return
    let alive = true
    void getKpiTasks(session.factoryId, session.user)
      .then((summary) => {
        if (!alive) return
        const next: Partial<Record<KpiBadgeTab, number>> = {}
        for (const it of summary.items) {
          if (!it.tab) continue
          next[it.tab] = (next[it.tab] || 0) + it.count
        }
        setBadgeByTab(next)
      })
      .catch(() => {
        // im lặng
      })
    return () => {
      alive = false
    }
  }, [session, pathname])

  return (
    <div className="space-y-4">
      <div className="relative bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div ref={scrollRef} className="flex gap-1.5 p-2 overflow-x-auto">
          {tabs.map((tab) => {
            const active = isActive(pathname, tab)
            const Icon = tab.icon
            const badgeCount = tab.badgeKey ? badgeByTab[tab.badgeKey] || 0 : 0
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={
                  "hover-lift relative flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold whitespace-nowrap border transition-colors " +
                  (active ? tab.activeClass : `bg-white text-slate-600 border-transparent ${tab.hoverClass}`)
                }
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
                {badgeCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-extrabold text-white">
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
        {canScrollLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent" />
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent" />
        )}
      </div>

      {children}
    </div>
  )
}
