"use client"

// Trang chủ tổng hợp module "Công việc & KPI" — redesign IA (2026-08-19).
//
// Trước đây route này chỉ redirect thẳng sang /dashboard/kpi/tasks (xem lịch sử "Fix 6" trong
// .claude/rules/27-kpi-module.md). Phản hồi thực tế: 6 tab quá nhiều, người dùng không biết
// việc chuyên môn/5S cần làm hay cần chấm nằm ở đâu. Trang này giờ là 1 màn tổng hợp thật —
// tách rõ 2 khối theo vai trò, dùng LẠI ĐÚNG getKpiTasks() (đã tính counts/quyền chuẩn cho Bell
// + widget Dashboard, xem module-tasks.ts) chứ không viết lại query nào mới:
//   - "Cần bạn LÀM" (role="nhan") — luôn hiện cho mọi kpi.view user: việc/5S bạn phải tự thực
//     hiện, lời mời chuyển giao tới bạn.
//   - "Cần bạn DUYỆT / XỬ LÝ" (role="giao") — chỉ hiện nếu bạn thực sự có vai trò quản lý/lãnh
//     đạo (admin, lãnh đạo phòng ban, hoặc kpi.manage_config) — tránh nhân viên thường thấy 1
//     khối toàn số 0 gây rối mắt.
// Thanh tab bên trên (KpiShell) tự thêm badge số độc lập — 2 tín hiệu (trang chủ + badge tab)
// dùng chung 1 nguồn dữ liệu duy nhất, không trùng logic.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRightLeft, CheckCircle2, ClipboardCheck, ClipboardList, PartyPopper } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { resolveMyLeaderDepartmentId } from "@/lib/kpi-department-leaders"
import { getKpiTasks, type ModuleTaskItem } from "@/app/dashboard/_components/module-tasks"
import { KpiShell } from "./_components/kpi-shell"

type Tone = "red" | "amber" | "action"

function toneOf(item: ModuleTaskItem): Tone {
  if (item.label.includes("quá hạn")) return "red"
  if (item.label.includes("sắp đến hạn")) return "amber"
  return "action"
}

const TONE_STYLE: Record<Tone, { row: string; badge: string; icon: string }> = {
  red: { row: "border-red-100 bg-red-50 hover:bg-red-100", badge: "bg-red-600 text-white", icon: "text-red-500" },
  amber: { row: "border-amber-100 bg-amber-50 hover:bg-amber-100", badge: "bg-amber-500 text-white", icon: "text-amber-500" },
  action: { row: "border-violet-100 bg-violet-50 hover:bg-violet-100", badge: "bg-violet-600 text-white", icon: "text-violet-500" },
}

function ItemRow({ item }: { item: ModuleTaskItem }) {
  const tone = TONE_STYLE[toneOf(item)]
  const Icon = item.label.includes("chuyển giao") ? ArrowRightLeft : item.label.includes("quá hạn") || item.label.includes("sắp đến hạn") ? AlertTriangle : ClipboardCheck
  return (
    <Link
      href={item.link}
      className={`hover-lift flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${tone.row}`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Icon size={14} className={tone.icon} />
        {item.label}
      </span>
      <span className={`shrink-0 min-w-7 rounded-full px-2 py-0.5 text-center text-xs font-extrabold ${tone.badge}`}>
        {item.count}
      </span>
    </Link>
  )
}

function SectionCard({
  title,
  subtitle,
  icon: Icon,
  accent,
  items,
  emptyLabel,
}: {
  title: string
  subtitle: string
  icon: typeof ClipboardList
  accent: string
  items: ModuleTaskItem[]
  emptyLabel: string
}) {
  const visible = items.filter((i) => i.count > 0)
  const total = visible.reduce((s, i) => s + i.count, 0)
  return (
    <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accent}`}>
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-extrabold text-slate-800">{title}</h2>
            {total > 0 && (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-extrabold text-white">{total}</span>
            )}
          </div>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm font-semibold text-emerald-700">
          <CheckCircle2 size={16} /> {emptyLabel}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => (
            <ItemRow key={item.label} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function KpiHomePage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [nhanItems, setNhanItems] = useState<ModuleTaskItem[]>([])
  const [giaoItems, setGiaoItems] = useState<ModuleTaskItem[]>([])
  const [showGiaoSection, setShowGiaoSection] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  useEffect(() => {
    const bootstrap = async () => {
      const cachedUser = JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
      if (!hasPermission(cachedUser, "kpi.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      try {
        const fid = await getActiveFactoryId()
        if (!fid) { setLoading(false); return }
        const { user: sessionUser } = await hydrateActiveSession()
        if (!sessionUser) { setLoading(false); return }
        setFactoryId(fid)
        setUser(sessionUser)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  const loadData = useCallback(async (fid: string, sessionUser: SessionUser) => {
    setDataLoading(true)
    setDataError(null)
    try {
      const isAdmin = sessionUser.role === "admin"
      const [summary, leaderDeptId] = await Promise.all([
        getKpiTasks(fid, sessionUser),
        isAdmin ? Promise.resolve(null) : resolveMyLeaderDepartmentId(sessionUser.id, fid),
      ])
      setNhanItems(summary.items.filter((i) => i.role === "nhan"))
      setGiaoItems(summary.items.filter((i) => i.role === "giao"))
      setShowGiaoSection(isAdmin || leaderDeptId != null || hasPermission(sessionUser, "kpi.manage_config"))
    } catch (err) {
      setDataError(err instanceof Error ? err.message : "Không tải được dữ liệu tổng hợp.")
    } finally {
      setDataLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId && user) void loadData(factoryId, user)
  }, [factoryId, user, loadData])

  if (loading) return <div className="p-12 text-center text-slate-400">Đang tải...</div>

  const allEmpty = !dataLoading && !dataError && [...nhanItems, ...giaoItems].every((i) => i.count === 0)

  return (
    <KpiShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Công việc & KPI</h1>
          <p className="mt-0.5 text-sm text-slate-500">Tổng hợp việc bạn cần làm và cần xử lý — bấm vào 1 dòng để đi thẳng tới đúng chỗ.</p>
        </div>

        {dataLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-400">Đang tải...</div>
        ) : dataError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">{dataError}</div>
        ) : allEmpty ? (
          <div className="hover-lift flex flex-col items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center">
            <PartyPopper size={28} className="text-emerald-500" />
            <div className="text-base font-extrabold text-emerald-700">Không có việc gì cần chú ý ngay bây giờ</div>
            <div className="text-sm text-emerald-600">Bạn đã xử lý hết — ghé qua các tab bên trên nếu muốn xem chi tiết từng khu vực.</div>
          </div>
        ) : (
          <div className={`grid grid-cols-1 gap-4 ${showGiaoSection ? "lg:grid-cols-2" : ""}`}>
            <SectionCard
              title="Cần bạn LÀM"
              subtitle="Việc/5S bạn phải tự thực hiện, lời mời chuyển giao tới bạn"
              icon={ClipboardList}
              accent="bg-sky-100 text-sky-600"
              items={nhanItems}
              emptyLabel="Không có việc nào bạn cần tự làm ngay bây giờ."
            />
            {showGiaoSection && (
              <SectionCard
                title="Cần bạn DUYỆT / XỬ LÝ"
                subtitle="Việc bạn giao cần nghiệm thu, đăng ký thay thế cần duyệt, khiếu nại cần xử lý"
                icon={ClipboardCheck}
                accent="bg-violet-100 text-violet-600"
                items={giaoItems}
                emptyLabel="Không có gì cần bạn duyệt/xử lý ngay bây giờ."
              />
            )}
          </div>
        )}
      </div>
    </KpiShell>
  )
}
