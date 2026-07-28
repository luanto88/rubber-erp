"use client"

// Tab "Công việc" — danh sách (Việc của tôi / Tất cả công việc) + view Lịch theo hạn.
// Xem đầy đủ kiến trúc/roadmap tại .claude/rules/27-kpi-module.md.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, ArrowRightLeft, CalendarDays, List, Plus } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { getTodayISODate } from "@/lib/date-utils"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { KpiShell } from "@/app/dashboard/kpi/_components/kpi-shell"
import { KpiProgressBar } from "@/app/dashboard/kpi/_components/kpi-progress-bar"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { fetchDepartmentOptions, resolveMyLeaderDepartmentId, type DepartmentOption } from "@/lib/kpi-department-leaders"
import {
  averageTaskProgress,
  fetchKpiTaskMembersByTaskIds,
  fetchKpiTasks,
  fetchMyActiveTaskIds,
  fetchPendingIncomingTransfers,
  formatKpiDateTime,
  isTaskDueSoon,
  isTaskOverdue,
  KPI_STATUS_BADGE_CLASS,
  KPI_STATUS_LABEL,
  loadKpiTaskCandidates,
  type KpiTask,
  type KpiTaskCandidate,
  type KpiTaskCandidateGroup,
  type KpiTaskMember,
  type KpiTaskStatus,
} from "@/lib/kpi-tasks"
import { KpiTaskFormModal } from "./_components/kpi-task-form-modal"
import { KpiTaskCalendar } from "./_components/kpi-task-calendar"

const STATUS_OPTIONS: KpiTaskStatus[] = ["moi_giao", "dang_thuc_hien", "cho_nghiem_thu", "tra_ve", "hoan_thanh", "huy"]

type PrimaryGroupRow = {
  group_id: string
  personnel_groups: Array<{ name: string | null }> | null
}

export default function KpiTasksPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const revealRef = useScrollReveal()

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [tasks, setTasks] = useState<KpiTask[]>([])
  const [members, setMembers] = useState<KpiTaskMember[]>([])
  const [myActiveTaskIds, setMyActiveTaskIds] = useState<Set<string>>(new Set())
  const [pendingIncomingTaskIds, setPendingIncomingTaskIds] = useState<Set<string>>(new Set())
  const [candidates, setCandidates] = useState<{ people: KpiTaskCandidate[]; groups: KpiTaskCandidateGroup[] }>({
    people: [],
    groups: [],
  })
  const [myLeaderDepartmentId, setMyLeaderDepartmentId] = useState<string | null>(null)
  const [departments, setDepartments] = useState<DepartmentOption[]>([])

  const [tab, setTab] = useState<"today" | "mine" | "all">(() => (searchParams.get("tab") === "all" ? "all" : searchParams.get("tab") === "mine" ? "mine" : "today"))
  const [view, setView] = useState<"list" | "calendar">("list")
  const [statusFilter, setStatusFilter] = useState<KpiTaskStatus[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [primaryGroupName, setPrimaryGroupName] = useState<string | null>(null)
  const [primaryGroupChecked, setPrimaryGroupChecked] = useState(false)

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

  const isAdmin = user?.role === "admin"
  // Mặc định role "Quản lý" được cấp sẵn kpi.assign/kpi.view_all rộng rãi (xem ROLE_DEFAULTS,
  // src/lib/auth.ts) — quá rộng so với yêu cầu "chỉ Admin + lãnh đạo phòng ban". `myLeaderDepartmentId`
  // tự phát hiện qua đúng chuc_vu/chuc_vu_chinh_quyen trong maintenance_staff (xem
  // src/lib/kpi-department-leaders.ts) — chỉ admin hoặc đúng lãnh đạo phòng ban mới còn thấy nút
  // "Giao việc mới"/"Tất cả công việc", khớp đúng RLS `kpi_tasks_insert` ở DB.
  const isDeptLeader = myLeaderDepartmentId != null
  // Banner "Nhóm chính" — chuyển từ Tổng quan cũ (/dashboard/kpi) sang đây theo Fix 6 (đổi default
  // landing sang "Việc của tôi"). Lỗi/thiếu migration bị nuốt êm — chỉ là gợi ý phụ.
  const loadPrimaryGroup = useCallback(async (fid: string, userId: string) => {
    try {
      const { data } = await supabase
        .from("personnel_group_members")
        .select("group_id, personnel_groups(name), maintenance_staff!inner(profile_id)")
        .eq("factory_id", fid)
        .eq("is_primary", true)
        .eq("maintenance_staff.profile_id", userId)
        .maybeSingle()
      const row = data as PrimaryGroupRow | null
      setPrimaryGroupName(row?.personnel_groups?.[0]?.name?.trim() || null)
    } catch {
      setPrimaryGroupName(null)
    } finally {
      setPrimaryGroupChecked(true)
    }
  }, [])

  useEffect(() => {
    if (factoryId && user) void loadPrimaryGroup(factoryId, user.id)
  }, [factoryId, user, loadPrimaryGroup])

  const canViewAll = hasPermission(user, "kpi.view_all") && (isAdmin || isDeptLeader)
  const canAssign = hasPermission(user, "kpi.assign") && (isAdmin || isDeptLeader)

  useEffect(() => {
    if (!canViewAll && tab === "all") setTab("mine")
  }, [canViewAll, tab])

  const loadData = useCallback(
    async (fid: string, uid: string) => {
      setDataLoading(true)
      try {
        const [taskRows, myIds, candidateData, pendingTransfers, leaderDeptId, deptRows] = await Promise.all([
          fetchKpiTasks(fid, statusFilter.length ? { status: statusFilter } : {}),
          fetchMyActiveTaskIds(uid),
          loadKpiTaskCandidates(fid),
          fetchPendingIncomingTransfers(uid),
          resolveMyLeaderDepartmentId(uid, fid),
          fetchDepartmentOptions(),
        ])
        setTasks(taskRows)
        setMyActiveTaskIds(myIds)
        setCandidates(candidateData)
        setMyLeaderDepartmentId(leaderDeptId)
        setDepartments(deptRows)
        // Task đang có lời mời chuyển giao chờ tôi phản hồi — tôi CHƯA phải active member nên
        // không lọt qua myActiveTaskIds; vẫn phải coi là "của tôi" để thấy được lời mời (task
        // detail page tự cho phép xem qua RLS kpi_is_task_pending_transfer_target).
        setPendingIncomingTaskIds(new Set(pendingTransfers.map((t) => t.task_id)))
        const memberRows = await fetchKpiTaskMembersByTaskIds(taskRows.map((t) => t.id))
        setMembers(memberRows)
      } catch {
        // im lặng — trang vẫn hiện danh sách rỗng thay vì crash
      } finally {
        setDataLoading(false)
      }
    },
    [statusFilter],
  )

  useEffect(() => {
    if (factoryId && user) void loadData(factoryId, user.id)
  }, [factoryId, user, loadData])

  // Bằng chứng/tiến độ có thể đổi từ các module khác trong lúc tab này mở nền — refetch nhẹ khi
  // quay lại visible/focus, mirror pattern trên trang chi tiết.
  useEffect(() => {
    if (!factoryId || !user) return
    const handleFocus = () => {
      if (document.visibilityState === "visible") void loadData(factoryId, user.id)
    }
    document.addEventListener("visibilitychange", handleFocus)
    window.addEventListener("focus", handleFocus)
    return () => {
      document.removeEventListener("visibilitychange", handleFocus)
      window.removeEventListener("focus", handleFocus)
    }
  }, [factoryId, user, loadData])

  const nameByUserId = useMemo(() => Object.fromEntries(candidates.people.map((p) => [p.userId, p.ten])), [candidates.people])
  const membersByTask = useMemo(() => {
    const map = new Map<string, KpiTaskMember[]>()
    for (const m of members) map.set(m.task_id, [...(map.get(m.task_id) || []), m])
    return map
  }, [members])

  const myTasks = useMemo(
    () => tasks.filter((t) => t.nguoi_giao_id === user?.id || myActiveTaskIds.has(t.id) || pendingIncomingTaskIds.has(t.id)),
    [tasks, user, myActiveTaskIds, pendingIncomingTaskIds],
  )

  // "Việc hôm nay" — sub-tab mặc định khi vào trang: việc "của tôi" đã quá hạn, sắp đến hạn
  // (KPI_DUE_SOON_HOURS=24), hoặc giao đúng hôm nay — gộp 3 tiêu chí "cần chú ý ngay" thay vì
  // phải tự lọc lại toàn bộ "Việc của tôi" mỗi lần vào trang.
  const today = getTodayISODate()
  const todayTasks = useMemo(
    () => myTasks.filter((t) => isTaskOverdue(t) || isTaskDueSoon(t) || t.ngay_giao === today),
    [myTasks, today],
  )

  const visibleTasks = tab === "all" ? tasks : tab === "today" ? todayTasks : myTasks

  if (loading) return <div className="p-12 text-center text-slate-400">Đang tải...</div>

  return (
    <KpiShell user={user} factoryId={factoryId}>
      <div className="space-y-4">
        <div ref={revealRef} className="scroll-reveal flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Công việc</h1>
            <p className="text-sm text-slate-500 mt-0.5">Giao việc, theo dõi tiến độ và nghiệm thu.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-slate-200 bg-white p-1">
              <button
                onClick={() => setView("list")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${view === "list" ? "bg-violet-100 text-violet-700" : "text-slate-500"}`}
              >
                <List size={13} /> Danh sách
              </button>
              <button
                onClick={() => setView("calendar")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${view === "calendar" ? "bg-violet-100 text-violet-700" : "text-slate-500"}`}
              >
                <CalendarDays size={13} /> Lịch
              </button>
            </div>
            {canAssign && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md text-sm"
              >
                <Plus size={15} /> Giao việc mới
              </button>
            )}
          </div>
        </div>

        {primaryGroupChecked && !primaryGroupName && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Bạn chưa được gán <strong>&quot;Nhóm chính&quot;</strong> — nhóm chính quyết định hệ số ×10
            khi tính điểm chuyên môn (các nhóm khác bạn thuộc vẫn tính điểm đầy đủ với hệ số ×5). Liên hệ
            Admin cấu hình tại <strong>Cài đặt → Hệ thống → Nhân sự</strong>.
          </div>
        )}
        {primaryGroupName && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Nhóm chính của bạn: <strong>{primaryGroupName}</strong>
          </div>
        )}

        <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 w-fit">
          <button
            onClick={() => setTab("today")}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold ${tab === "today" ? "bg-violet-600 text-white" : "text-slate-600"}`}
          >
            Việc hôm nay{todayTasks.length > 0 ? ` (${todayTasks.length})` : ""}
          </button>
          <button
            onClick={() => setTab("mine")}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold ${tab === "mine" ? "bg-violet-600 text-white" : "text-slate-600"}`}
          >
            Việc của tôi
          </button>
          {canViewAll && (
            <button
              onClick={() => setTab("all")}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold ${tab === "all" ? "bg-violet-600 text-white" : "text-slate-600"}`}
            >
              Tất cả công việc
            </button>
          )}
        </div>

        <FilterBar activeCount={statusFilter.length}>
          <FilterMultiSelect
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onChange={(v) => setStatusFilter(v as KpiTaskStatus[])}
            labels={KPI_STATUS_LABEL}
            placeholder="Tất cả trạng thái"
            searchPlaceholder="Tìm trạng thái..."
          />
        </FilterBar>

        {dataLoading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : view === "calendar" ? (
          <KpiTaskCalendar tasks={visibleTasks} />
        ) : visibleTasks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
            {tab === "today" ? "Không có việc nào cần chú ý hôm nay — đã xong hoặc chưa tới hạn." : "Không có công việc nào."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleTasks.map((t) => {
              const taskMembers = membersByTask.get(t.id) || []
              const progress = averageTaskProgress(t, taskMembers)
              const overdue = isTaskOverdue(t)
              const dueSoon = isTaskDueSoon(t)
              const isGiver = t.nguoi_giao_id === user?.id
              const isMember = myActiveTaskIds.has(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => router.push(`/dashboard/kpi/tasks/${t.id}`)}
                  className="hover-lift text-left bg-white rounded-2xl border border-slate-200 shadow-sm p-4 hover:border-violet-200"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[11px] font-bold text-slate-400">{t.ma_cong_viec || "—"}</span>
                    <span className={`shrink-0 px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${KPI_STATUS_BADGE_CLASS[t.trang_thai]}`}>
                      {KPI_STATUS_LABEL[t.trang_thai]}
                    </span>
                  </div>
                  <div className="text-sm font-extrabold text-slate-800 mb-1 line-clamp-2">{t.tieu_de}</div>
                  {(isGiver || isMember) && (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {isMember && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">Việc được giao cho bạn</span>}
                      {isGiver && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">Bạn là người giao</span>}
                    </div>
                  )}
                  <div className="text-xs text-slate-500 mb-1 truncate">
                    Người giao: <strong className="text-slate-600">{nameByUserId[t.nguoi_giao_id] || "—"}</strong>
                  </div>
                  <div className="text-xs text-slate-500 mb-2 truncate">
                    Thực hiện: {taskMembers.map((m) => nameByUserId[m.user_id] || "—").join(", ") || "Chưa gán người"}
                  </div>
                  {t.mo_ta && (
                    <div className="mb-2 line-clamp-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                      📝 {t.mo_ta}
                    </div>
                  )}
                  {pendingIncomingTaskIds.has(t.id) && (
                    <div className="mb-2 flex items-center gap-1 text-[11px] font-bold text-violet-600">
                      <ArrowRightLeft size={11} /> Có lời mời chuyển giao chờ bạn phản hồi
                    </div>
                  )}
                  <div className="mb-2">
                    <KpiProgressBar percent={progress} size="sm" />
                  </div>
                  <div className={`flex items-center gap-1.5 text-xs font-semibold ${overdue ? "text-red-600" : dueSoon ? "text-amber-600" : "text-slate-500"}`}>
                    {(overdue || dueSoon) && <AlertTriangle size={12} />}
                    Hạn: {formatKpiDateTime(t.han_hoan_thanh)}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showCreate && factoryId && user && (
        <KpiTaskFormModal
          factoryId={factoryId}
          nguoiGiaoId={user.id}
          candidates={candidates}
          departments={departments}
          onClose={() => setShowCreate(false)}
          onCreated={(task) => {
            setShowCreate(false)
            router.push(`/dashboard/kpi/tasks/${task.id}`)
          }}
        />
      )}
    </KpiShell>
  )
}
