"use client"

// Danh sách vị trí 5S — Phase 2. Xem đầy đủ .claude/rules/27-kpi-module.md mục "UI" (5S).

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertCircle, AlertTriangle, Bell, History, MapPin, Settings, Shuffle, Sparkles, Users } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { formatWeekRangeLabel, getIsoWeekStart } from "@/lib/date-utils"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { KpiShell } from "../_components/kpi-shell"
import { Kpi5sAutoAssignModal } from "../_components/kpi-5s-auto-assign-modal"
import { resolveMyLeaderDepartmentId } from "@/lib/kpi-department-leaders"
import { sendKpiNotify } from "@/lib/kpi-notify"
import {
  computeKpi5sNextDeadline,
  fetchAllLocationCleanerMemberships,
  fetchKpi5sLocations,
  fetchLatestKpi5sEvaluationsByLocationIds,
  fetchRecentKpi5sEvaluations,
  formatKpi5sNextDeadlineLabel,
  getEffectiveCleanerIds,
  getKpi5sErrorMessage,
  isKpi5sDeadlineDueSoon,
  isKpi5sDeadlineOverdue,
  KPI_5S_RESULT_BADGE_CLASS,
  KPI_5S_RESULT_LABEL,
  type Kpi5sEvaluation,
  type Kpi5sLocation,
} from "@/lib/kpi-5s"
import { loadKpiTaskCandidates, type KpiTaskCandidate } from "@/lib/kpi-tasks"

// Nhãn cho ?highlight= từ Bell (module-tasks.ts's getKpi5sDueCounts) — mirror KPI_TASK_HIGHLIGHT_LABEL
// bên tasks/page.tsx nhưng riêng cho 5S (không dùng chung type vì Bell chỉ có 2 giá trị đơn giản).
const KPI_5S_HIGHLIGHT_LABEL: Record<string, string> = {
  overdue: "Vị trí 5S đã quá hạn",
  dueSoon: "Vị trí 5S sắp đến hạn (24h)",
}

export default function Kpi5sLocationListPage() {
  const revealRef = useScrollReveal()
  const router = useRouter()
  const searchParams = useSearchParams()
  const highlight = searchParams.get("highlight") // "overdue" | "dueSoon" | null — từ Bell
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [locations, setLocations] = useState<Kpi5sLocation[]>([])
  const [latestByLocation, setLatestByLocation] = useState<Map<string, Kpi5sEvaluation>>(new Map())
  const [cleanersByLocation, setCleanersByLocation] = useState<Map<string, string[]>>(new Map())
  const [candidates, setCandidates] = useState<KpiTaskCandidate[]>([])
  const [myLeaderDepartmentId, setMyLeaderDepartmentId] = useState<string | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [subTab, setSubTab] = useState<"today" | "all" | "history">("today")
  const [historyEvals, setHistoryEvals] = useState<Kpi5sEvaluation[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [showAutoAssign, setShowAutoAssign] = useState(false)
  const [assignSummary, setAssignSummary] = useState<{ userId: string; ten: string; donZones: string[]; chamZones: string[] }[] | null>(null)
  // Nút "Nhắc nhở" thủ công inline trên từng thẻ — chỉ Telegram, khoá tạm 45s/vị trí sau khi
  // bấm (state cục bộ, không ghi DB) để tránh gửi trùng do double-click.
  const [remindCooldownIds, setRemindCooldownIds] = useState<Set<string>>(new Set())

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

  const loadData = useCallback(async (fid: string, uid: string) => {
    setDataLoading(true)
    setDataError(null)
    try {
      const [locationRows, candidateData, cleanerMap, leaderDeptId] = await Promise.all([
        fetchKpi5sLocations(fid),
        loadKpiTaskCandidates(fid),
        fetchAllLocationCleanerMemberships(fid),
        resolveMyLeaderDepartmentId(uid, fid),
      ])
      setLocations(locationRows)
      setCandidates(candidateData.people)
      setCleanersByLocation(cleanerMap)
      setMyLeaderDepartmentId(leaderDeptId)
      const latest = await fetchLatestKpi5sEvaluationsByLocationIds(locationRows.map((l) => l.id))
      setLatestByLocation(latest)
    } catch (err) {
      setDataError(getKpi5sErrorMessage(err, "Không tải được danh sách vị trí."))
    } finally {
      setDataLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId && user) void loadData(factoryId, user.id)
  }, [factoryId, user, loadData])

  const nameByUserId = useMemo(() => {
    const map: Record<string, string> = Object.fromEntries(candidates.map((c) => [c.userId, c.ten]))
    if (user) map[user.id] = user.full_name || user.username || map[user.id] || "Bạn"
    return map
  }, [candidates, user])
  const resolveName = useCallback((uid: string | null) => (uid ? nameByUserId[uid] || "—" : "— Chưa gán —"), [nameByUserId])

  const currentWeekStart = useMemo(() => getIsoWeekStart(), [])

  const isAdmin = user?.role === "admin"
  const canManageLocations = isAdmin || hasPermission(user, "kpi.manage_config")
  const isDeptLeader = myLeaderDepartmentId != null
  // Riêng cho các nút hành động (KHÔNG dùng để tính visibleLocations bên dưới — biến đó phải
  // giữ đúng nghĩa "bypass hoàn toàn scoping theo phòng ban", chỉ admin/kpi.manage_config).
  // Lãnh đạo phòng ban giờ cũng quản lý được vị trí của đúng phòng ban mình (RLS đã cho phép từ
  // migration 20260807_kpi_department_scoping.sql) nên cũng cần thấy "Quản lý vị trí"/"Phân công
  // thông minh".
  const canManageAnyLocation = canManageLocations || isDeptLeader

  // Phạm vi hiển thị (Phase E): admin/kpi.manage_config thấy tất cả; lãnh đạo phòng ban thấy mọi
  // vị trí thuộc ĐÚNG phòng ban của họ; người dùng thường chỉ thấy vị trí họ thực sự liên quan
  // (thuộc đội ngũ dọn dẹp hoặc là người chấm) — không còn "công khai toàn nhà máy" như thiết kế
  // Phase 2 ban đầu.
  const visibleLocations = useMemo(() => {
    if (canManageLocations) return locations
    return locations.filter((l) => {
      if (isDeptLeader && l.phong_ban_id === myLeaderDepartmentId) return true
      if (!user) return false
      const cleanerIds = getEffectiveCleanerIds(l, cleanersByLocation)
      return cleanerIds.includes(user.id) || user.id === l.nguoi_cham_id
    })
  }, [locations, canManageLocations, isDeptLeader, myLeaderDepartmentId, user, cleanersByLocation])

  // "Việc hôm nay" — vị trí đến lượt tôi chấm điểm tuần này, nổi bật lên trước tiên.
  const todayLocations = useMemo(
    () => visibleLocations.filter((l) => user?.id === l.nguoi_cham_id && latestByLocation.get(l.id)?.tuan_bat_dau !== currentWeekStart),
    [visibleLocations, user, latestByLocation, currentWeekStart],
  )

  // Vị trí "của tôi" (đội dọn dẹp hoặc người chấm) đang quá hạn / sắp đến hạn — dùng cho
  // ?highlight= từ Bell, mirror ĐÚNG công thức getKpi5sDueCounts() (module-tasks.ts) để số đếm
  // và danh sách lọc luôn khớp nhau tuyệt đối.
  const { myOverdue, myDueSoon } = useMemo(() => {
    const overdue: Kpi5sLocation[] = []
    const dueSoon: Kpi5sLocation[] = []
    if (!user) return { myOverdue: overdue, myDueSoon: dueSoon }
    for (const loc of visibleLocations) {
      const cleanerIds = getEffectiveCleanerIds(loc, cleanersByLocation)
      const isMine = loc.nguoi_cham_id === user.id || cleanerIds.includes(user.id)
      if (!isMine) continue
      const hasEvaluatedThisWeek = latestByLocation.get(loc.id)?.tuan_bat_dau === currentWeekStart
      const deadline = computeKpi5sNextDeadline(loc)
      if (isKpi5sDeadlineOverdue(deadline, hasEvaluatedThisWeek)) overdue.push(loc)
      else if (isKpi5sDeadlineDueSoon(deadline, hasEvaluatedThisWeek)) dueSoon.push(loc)
    }
    return { myOverdue: overdue, myDueSoon: dueSoon }
  }, [visibleLocations, user, cleanersByLocation, latestByLocation, currentWeekStart])

  const highlightedLocations = highlight === "overdue" ? myOverdue : highlight === "dueSoon" ? myDueSoon : null

  const clearHighlight = () => router.replace("/dashboard/kpi/5s")

  useEffect(() => {
    if (subTab !== "history" || historyLoaded || !factoryId) return
    let alive = true
    setHistoryLoading(true)
    fetchRecentKpi5sEvaluations(factoryId)
      .then((rows) => { if (alive) { setHistoryEvals(rows); setHistoryLoaded(true) } })
      .catch(() => { if (alive) setHistoryEvals([]) })
      .finally(() => { if (alive) setHistoryLoading(false) })
    return () => { alive = false }
  }, [subTab, historyLoaded, factoryId])

  // Chỉ giữ lại lịch sử thuộc phạm vi vị trí người xem được thấy (fetchRecentKpi5sEvaluations
  // trả về toàn nhà máy — RLS đọc mở rộng, nhưng UI phải tự thu hẹp theo visibleLocations).
  const visibleLocationIds = useMemo(() => new Set(visibleLocations.map((l) => l.id)), [visibleLocations])
  const scopedHistoryEvals = useMemo(
    () => historyEvals.filter((e) => visibleLocationIds.has(e.location_id)),
    [historyEvals, visibleLocationIds],
  )
  const locationById = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l])), [locations])

  const handleRemindLocation = (loc: Kpi5sLocation) => {
    if (!factoryId) return
    sendKpiNotify({
      factoryId,
      title: "Nhắc nhở chấm điểm 5S",
      lines: [
        `🧹 Vị trí: ${loc.ma_vi_tri} — ${loc.ten_vi_tri}`,
        `👤 Người chấm: ${resolveName(loc.nguoi_cham_id)}`,
        `📅 Tuần này (${formatWeekRangeLabel(currentWeekStart)}) chưa có bản chấm.`,
      ],
      link: `/dashboard/kpi/5s/location/${loc.id}`,
    })
    setRemindCooldownIds((prev) => new Set(prev).add(loc.id))
    setTimeout(() => {
      setRemindCooldownIds((prev) => {
        const next = new Set(prev)
        next.delete(loc.id)
        return next
      })
    }, 45_000)
  }

  if (loading) return <div className="p-12 text-center text-slate-400">Đang tải...</div>

  const shownLocations = highlightedLocations ?? (subTab === "today" ? todayLocations : visibleLocations)
  // Đổi tab BẰNG TAY phải đồng thời xoá `?highlight=` khỏi URL — cùng lý do đã áp dụng ở
  // tasks/page.tsx (highlight đọc trực tiếp từ searchParams, không phải state).
  const goToSubTab = (t: "today" | "all" | "history") => {
    setSubTab(t)
    router.replace("/dashboard/kpi/5s")
  }

  return (
    <KpiShell>
      <div className="space-y-4">
        <div ref={revealRef} className="scroll-reveal flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="hover-lift shrink-0 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-200 via-orange-100 to-amber-100 shadow-sm">
              <Sparkles size={20} className="text-amber-700" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800">Đánh giá 5S</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Mỗi vị trí có 1 QR cố định — quét để xem lịch sử và chấm điểm Đạt/Không đạt hàng tuần.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {canManageAnyLocation && visibleLocations.length > 0 && (
              <button
                onClick={() => { setAssignSummary(null); setShowAutoAssign(true) }}
                className="flex w-full items-center justify-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-sm text-sm sm:w-auto"
              >
                <Shuffle size={15} /> Phân công thông minh
              </button>
            )}
            {canManageLocations && (
              <Link
                href="/dashboard/settings?tab=kpi_5s"
                className="flex w-full items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl shadow-sm text-sm sm:w-auto"
              >
                <Settings size={15} /> Quản lý vị trí
              </Link>
            )}
          </div>
        </div>

        {assignSummary && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="font-bold mb-1">Đã giao xong:</div>
            <ul className="space-y-0.5 text-xs">
              {assignSummary.map((s) => (
                <li key={s.userId}>
                  <strong>{s.ten}</strong>
                  {s.donZones.length > 0 && ` — dọn: ${s.donZones.join(", ")}`}
                  {s.chamZones.length > 0 && `${s.donZones.length > 0 ? " ·" : " —"} chấm: ${s.chamZones.join(", ")}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {highlight && highlight in KPI_5S_HIGHLIGHT_LABEL ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-violet-300 bg-violet-50 px-4 py-3">
            <span className="text-sm font-bold text-violet-800">
              Đang lọc: {KPI_5S_HIGHLIGHT_LABEL[highlight]} ({shownLocations.length})
            </span>
            <button onClick={clearHighlight} className="text-xs font-bold text-violet-600 hover:text-violet-800 underline">
              Xóa lọc — xem theo tab
            </button>
          </div>
        ) : (
          <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 w-fit">
            <button
              onClick={() => goToSubTab("today")}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold ${subTab === "today" ? "bg-amber-500 text-white" : "text-slate-600"}`}
            >
              Việc hôm nay{todayLocations.length > 0 ? ` (${todayLocations.length})` : ""}
            </button>
            <button
              onClick={() => goToSubTab("all")}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold ${subTab === "all" ? "bg-amber-500 text-white" : "text-slate-600"}`}
            >
              Tất cả vị trí
            </button>
            <button
              onClick={() => goToSubTab("history")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold ${subTab === "history" ? "bg-amber-500 text-white" : "text-slate-600"}`}
            >
              <History size={13} /> Lịch sử
            </button>
          </div>
        )}

        {!highlight && subTab === "history" ? (
          historyLoading ? (
            <div className="p-12 text-center text-slate-400">Đang tải...</div>
          ) : scopedHistoryEvals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
              Chưa có lần chấm điểm nào trong phạm vi bạn xem được.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
              {scopedHistoryEvals.map((e) => {
                const loc = locationById[e.location_id]
                return (
                  <Link
                    key={e.id}
                    href={`/dashboard/kpi/5s/location/${e.location_id}`}
                    className="row-hover flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800 truncate">{loc ? `${loc.ma_vi_tri} — ${loc.ten_vi_tri}` : e.location_id}</div>
                      <div className="text-xs text-slate-500">
                        Tuần {e.tuan_bat_dau} · Người chấm: {resolveName(e.nguoi_cham_id)}
                      </div>
                    </div>
                    <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-lg ${KPI_5S_RESULT_BADGE_CLASS[e.ket_qua]}`}>
                      {KPI_5S_RESULT_LABEL[e.ket_qua]}
                    </span>
                  </Link>
                )
              })}
            </div>
          )
        ) : dataLoading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : dataError ? (
          <div className="bg-white rounded-2xl border border-red-200 p-8 text-center text-red-600">{dataError}</div>
        ) : shownLocations.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
            {highlight
              ? "Không có vị trí nào khớp bộ lọc này."
              : subTab === "today"
                ? "Không có vị trí nào cần bạn chấm điểm tuần này."
                : `Chưa có vị trí 5S nào. ${canManageLocations ? "Vào \"Quản lý vị trí\" để thêm." : ""}`}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shownLocations.map((loc) => {
              const latest = latestByLocation.get(loc.id)
              const hasEvaluatedThisWeek = latest?.tuan_bat_dau === currentWeekStart
              const needsMyEvaluation = user?.id === loc.nguoi_cham_id && !hasEvaluatedThisWeek
              const cleanerIds = getEffectiveCleanerIds(loc, cleanersByLocation)
              const iAmCleaner = !!user && cleanerIds.includes(user.id)
              const iAmScorer = !!user && user.id === loc.nguoi_cham_id
              const deadline = computeKpi5sNextDeadline(loc)
              const overdue = isKpi5sDeadlineOverdue(deadline, hasEvaluatedThisWeek)
              const dueSoon = isKpi5sDeadlineDueSoon(deadline, hasEvaluatedThisWeek)
              const canRemindLocation = (isAdmin || user?.id === loc.assigned_by) && !!deadline && !hasEvaluatedThisWeek
              const remindSent = remindCooldownIds.has(loc.id)
              return (
                // Bọc ngoài KHÔNG còn là <Link> (tránh lồng <button> "Nhắc nhở" bên trong <a>) —
                // Link chỉ bọc phần nội dung chính có thể bấm để mở chi tiết, nút Nhắc nhở là
                // phần tử độc lập nằm ngoài Link, không cần stopPropagation vì không lồng nhau.
                <div
                  key={loc.id}
                  className={
                    "hover-lift rounded-2xl p-4 shadow-sm " +
                    (needsMyEvaluation
                      ? "border-2 border-amber-400 bg-amber-50"
                      : "border border-slate-200 bg-white hover:border-amber-200")
                  }
                >
                <Link href={`/dashboard/kpi/5s/location/${loc.id}`} className="block">
                  {needsMyEvaluation && (
                    <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-extrabold text-white shadow-sm">
                      <AlertCircle size={13} className="animate-pulse" /> Cần bạn chấm điểm tuần này
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-violet-50 text-violet-700">{loc.ma_vi_tri}</span>
                    {latest ? (
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${KPI_5S_RESULT_BADGE_CLASS[latest.ket_qua]}`}>
                        {KPI_5S_RESULT_LABEL[latest.ket_qua]} ({latest.tuan_bat_dau})
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500">Chưa chấm</span>
                    )}
                  </div>
                  {deadline && !hasEvaluatedThisWeek && (
                    <div className={`mb-1.5 flex items-center gap-1 text-xs font-semibold ${overdue ? "text-red-600" : dueSoon ? "text-amber-600" : "text-slate-500"}`}>
                      {(overdue || dueSoon) && <AlertTriangle size={12} />}
                      {overdue ? "Quá hạn — " : ""}Hạn: {formatKpi5sNextDeadlineLabel(loc)}
                    </div>
                  )}
                  <div className="text-sm font-extrabold text-slate-800">{loc.ten_vi_tri}</div>
                  {loc.mo_ta && (
                    <div className="mt-1 flex items-start gap-1 text-xs text-slate-500">
                      <MapPin size={12} className="mt-0.5 shrink-0" /> {loc.mo_ta}
                    </div>
                  )}
                  {(iAmCleaner || iAmScorer) && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {iAmCleaner && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">Bạn thuộc đội dọn dẹp</span>}
                      {iAmScorer && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Bạn là người chấm</span>}
                    </div>
                  )}
                  <div className="mt-2.5 space-y-0.5 text-xs text-slate-600">
                    <div className="flex items-start gap-1">
                      <Users size={11} className="mt-0.5 shrink-0 text-slate-400" />
                      Đội ngũ dọn: <strong className="text-slate-800">{cleanerIds.length > 0 ? cleanerIds.map((uid) => resolveName(uid)).join(", ") : "— Chưa gán —"}</strong>
                    </div>
                    <div>Người chấm: <strong className="text-slate-800">{resolveName(loc.nguoi_cham_id)}</strong></div>
                  </div>
                </Link>
                {canRemindLocation && (
                  <button
                    type="button"
                    onClick={() => handleRemindLocation(loc)}
                    disabled={remindSent}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-200 disabled:opacity-50"
                  >
                    <Bell size={11} /> {remindSent ? "Đã gửi nhắc nhở" : "Nhắc nhở ngay"}
                  </button>
                )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showAutoAssign && factoryId && (
        <Kpi5sAutoAssignModal
          factoryId={factoryId}
          locations={visibleLocations}
          onClose={() => setShowAutoAssign(false)}
          onAssigned={(summary) => {
            setShowAutoAssign(false)
            setAssignSummary(summary)
            sendKpiNotify({
              factoryId,
              title: "Phân công vị trí 5S",
              lines: summary.map((s) => {
                const parts: string[] = []
                if (s.donZones.length > 0) parts.push(`dọn: ${s.donZones.join(", ")}`)
                if (s.chamZones.length > 0) parts.push(`chấm: ${s.chamZones.join(", ")}`)
                return `👤 ${s.ten} — ${parts.join(" · ")}`
              }),
              link: "/dashboard/kpi/5s",
            })
            if (user) void loadData(factoryId, user.id)
          }}
        />
      )}
    </KpiShell>
  )
}
