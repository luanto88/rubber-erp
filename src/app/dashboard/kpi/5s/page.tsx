"use client"

// Danh sách vị trí 5S — Phase 2. Xem đầy đủ .claude/rules/27-kpi-module.md mục "UI" (5S).

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, MapPin, Settings, Sparkles, Users } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { getIsoWeekStart } from "@/lib/date-utils"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { KpiShell } from "../_components/kpi-shell"
import { resolveMyLeaderDepartmentId } from "@/lib/kpi-department-leaders"
import {
  fetchAllLocationCleanerMemberships,
  fetchKpi5sLocations,
  fetchLatestKpi5sEvaluationsByLocationIds,
  getEffectiveCleanerIds,
  getKpi5sErrorMessage,
  KPI_5S_RESULT_BADGE_CLASS,
  KPI_5S_RESULT_LABEL,
  type Kpi5sEvaluation,
  type Kpi5sLocation,
} from "@/lib/kpi-5s"
import { loadKpiTaskCandidates, type KpiTaskCandidate } from "@/lib/kpi-tasks"

export default function Kpi5sLocationListPage() {
  const revealRef = useScrollReveal()
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
  const [subTab, setSubTab] = useState<"today" | "all">("today")

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

  if (loading) return <div className="p-12 text-center text-slate-400">Đang tải...</div>

  const shownLocations = subTab === "today" ? todayLocations : visibleLocations

  return (
    <KpiShell user={user} factoryId={factoryId}>
      <div className="space-y-4">
        <div ref={revealRef} className="scroll-reveal flex flex-wrap items-start justify-between gap-3">
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
          {canManageLocations && (
            <Link
              href="/dashboard/settings?tab=kpi_5s"
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl shadow-sm text-sm"
            >
              <Settings size={15} /> Quản lý vị trí
            </Link>
          )}
        </div>

        <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 w-fit">
          <button
            onClick={() => setSubTab("today")}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold ${subTab === "today" ? "bg-amber-500 text-white" : "text-slate-600"}`}
          >
            Việc hôm nay{todayLocations.length > 0 ? ` (${todayLocations.length})` : ""}
          </button>
          <button
            onClick={() => setSubTab("all")}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold ${subTab === "all" ? "bg-amber-500 text-white" : "text-slate-600"}`}
          >
            Tất cả vị trí
          </button>
        </div>

        {dataLoading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : dataError ? (
          <div className="bg-white rounded-2xl border border-red-200 p-8 text-center text-red-600">{dataError}</div>
        ) : shownLocations.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
            {subTab === "today"
              ? "Không có vị trí nào cần bạn chấm điểm tuần này."
              : `Chưa có vị trí 5S nào. ${canManageLocations ? "Vào \"Quản lý vị trí\" để thêm." : ""}`}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shownLocations.map((loc) => {
              const latest = latestByLocation.get(loc.id)
              const needsMyEvaluation = user?.id === loc.nguoi_cham_id && latest?.tuan_bat_dau !== currentWeekStart
              const cleanerIds = getEffectiveCleanerIds(loc, cleanersByLocation)
              const iAmCleaner = !!user && cleanerIds.includes(user.id)
              const iAmScorer = !!user && user.id === loc.nguoi_cham_id
              return (
                <Link
                  key={loc.id}
                  href={`/dashboard/kpi/5s/location/${loc.id}`}
                  className={
                    "hover-lift block rounded-2xl p-4 shadow-sm " +
                    (needsMyEvaluation
                      ? "border-2 border-amber-400 bg-amber-50"
                      : "border border-slate-200 bg-white hover:border-amber-200")
                  }
                >
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
              )
            })}
          </div>
        )}
      </div>
    </KpiShell>
  )
}
