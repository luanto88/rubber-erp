"use client"

// Tab "Bảng điểm KPI" — Phase 4: xem điểm tháng (A/B/C/D + hệ số chuyên cần + tổng), chạy engine
// tính điểm (kpi_compute_monthly_scores). Xem đầy đủ .claude/rules/27-kpi-module.md.
//
// Ai có kpi.view đều xem được điểm CỦA CHÍNH MÌNH (lịch sử nhiều tháng). Xem điểm TOÀN NHÀ MÁY
// (bảng theo đúng 1 tháng đang chọn) chỉ dành cho admin/kpi.view_all + lãnh đạo phòng ban, mirror
// đúng pattern canViewAll ở kpi/tasks/page.tsx. Nút "Tính điểm tháng" chỉ admin/kpi.manage_config
// (RPC tự validate lại server-side, không tin UI).
//
// Điểm luôn 'nhap' ở Phase 4 (chưa có khóa sổ) — chạy nháp quan sát vài tháng trước khi sang
// Phase 5 (khóa sổ + khiếu nại điểm tháng).
//
// Cập nhật (phiên sau Phase 4):
// 1. Lọc Phòng ban ở bảng "Toàn nhà máy" — trước đây trang này là nơi DUY NHẤT trong module KPI
//    chưa có khái niệm phòng ban (Công việc/Việc định kỳ/5S đều đã có), khiến lãnh đạo phòng ban
//    thấy điểm TOÀN NHÀ MÁY thay vì chỉ đúng phòng ban mình. Giờ: lãnh đạo phòng ban tự động chỉ
//    thấy đúng phòng ban của họ; admin có thêm dropdown lọc tùy chọn; bảng luôn có cột "Phòng ban".
// 2. Sub-tab "Chi tiết cách tính điểm" — giải thích minh bạch điểm A/B/C/D của CHÍNH người xem
//    được tính từ những bản ghi nào, cho MỌI user (không chọn xem người khác). Tính lại real-time
//    từ dữ liệu hiện tại (src/lib/kpi-score-breakdown.ts) — không đọc kpi_monthly_scores.chi_tiet
//    (chỉ lưu số tổng hợp, không đủ chi tiết từng bản ghi).
//
// Phase 5 (migration 20260814_kpi_score_lock_adjust_rank.sql):
// - Nút "Khóa" trên mỗi dòng bảng "Toàn nhà máy" (chỉ canCompute = admin/kpi.manage_config) —
//   chuyển trang_thai 'nhap' → 'da_khoa'. KHÔNG có nút "mở khóa" (xem comment đầu migration).
// - Nút "Khiếu nại điểm này" trên card "Điểm của bạn" — chỉ hiện khi điểm tháng đang chọn đã
//   'da_khoa'. Lịch sử điều chỉnh (kpi_score_adjustments) hiện ngay dưới nếu có.
// - Sub-tab thứ 3 "Bảng xếp hạng" — ẩn danh theo Nhóm chuyên môn hoặc Phòng ban, chỉ hiện
//   {Hạng, điểm, có phải bạn không} qua 2 RPC SECURITY DEFINER, không lộ tên người khác.

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Award, Calculator, Eye, Flag, History, ListTree, Lock, ListOrdered, TrendingUp } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { KpiShell } from "@/app/dashboard/kpi/_components/kpi-shell"
import { KpiProgressBar } from "@/app/dashboard/kpi/_components/kpi-progress-bar"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { fetchDepartmentOptions, resolveMyLeaderDepartmentId, type DepartmentOption } from "@/lib/kpi-department-leaders"
import { loadAllPersonnelGroups, type KpiGroupOption } from "@/lib/kpi-templates"
import { fetchDepartmentUserIds, formatKpiDateTime, getKpiErrorMessage, loadKpiTaskCandidates, type KpiTaskCandidate } from "@/lib/kpi-tasks"
import { createKpiAppealForMonthlyScore, getKpiAppealErrorMessage } from "@/lib/kpi-appeals"
import { sendKpiNotify } from "@/lib/kpi-notify"
import {
  computeKpiMonthlyScores,
  defaultKpiScoreWeights,
  fetchKpiMonthlyScores,
  fetchKpiScoreAdjustments,
  fetchKpiScoreRankingByDepartment,
  fetchKpiScoreRankingByGroup,
  fetchKpiScoreWeights,
  fetchMyKpiMonthlyScores,
  lockKpiMonthlyScore,
  type KpiMonthlyScore,
  type KpiScoreAdjustment,
  type KpiScoreRankingRow,
  type KpiScoreWeights,
} from "@/lib/kpi-scores"
import {
  computeCutoffMs,
  fetchMyPrimaryGroup,
  fetchScoreBreakdown5s,
  fetchScoreBreakdownDaily,
  fetchScoreBreakdownTasks,
  groupDailyByDay,
  type Breakdown5s,
  type BreakdownDailyEvaluation,
  type BreakdownTask,
  type MyPrimaryGroup,
} from "@/lib/kpi-score-breakdown"

const now = new Date()
const YEAR_OPTIONS = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

export default function KpiScoresPage() {
  const revealRef = useScrollReveal()

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [myLeaderDepartmentId, setMyLeaderDepartmentId] = useState<string | null>(null)

  const [nam, setNam] = useState(now.getFullYear())
  const [thang, setThang] = useState(now.getMonth() + 1)
  const [factoryScores, setFactoryScores] = useState<KpiMonthlyScore[]>([])
  const [myScores, setMyScores] = useState<KpiMonthlyScore[]>([])
  const [candidates, setCandidates] = useState<KpiTaskCandidate[]>([])
  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [userDeptMap, setUserDeptMap] = useState<Map<string, DepartmentOption>>(new Map())
  const [deptFilter, setDeptFilter] = useState("")
  const [dataLoading, setDataLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [computing, setComputing] = useState(false)
  const [computeMsg, setComputeMsg] = useState("")

  const [scoreView, setScoreView] = useState<"tong-quan" | "chi-tiet" | "xep-hang">("tong-quan")
  // Xem chi tiết cách tính điểm của NGƯỜI KHÁC (admin/lãnh đạo, từ bảng "Toàn nhà máy") — null =
  // đang xem của chính mình. RLS đã xác nhận cho phép (kpi_task_members_select có nhánh
  // kpi.view_all đọc mọi dòng, kpi_5s_evaluations/kpi_daily_evaluations SELECT rộng trong factory).
  const [detailUserId, setDetailUserId] = useState<string | null>(null)

  // Phase 5: khóa sổ, khiếu nại điểm tháng, lịch sử điều chỉnh
  const [lockingId, setLockingId] = useState<string | null>(null)
  const [myAdjustments, setMyAdjustments] = useState<KpiScoreAdjustment[]>([])
  const [appealModalOpen, setAppealModalOpen] = useState(false)
  const [appealNoiDung, setAppealNoiDung] = useState("")
  const [appealSubmitting, setAppealSubmitting] = useState(false)
  const [appealError, setAppealError] = useState("")

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const fid = await getActiveFactoryId()
        if (!fid) { setLoading(false); return }
        const { user: sessionUser } = await hydrateActiveSession()
        if (!sessionUser) { setLoading(false); return }
        setFactoryId(fid)
        setUser(sessionUser)
        const leaderDeptId = await resolveMyLeaderDepartmentId(sessionUser.id, fid)
        setMyLeaderDepartmentId(leaderDeptId)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  const isAdmin = user?.role === "admin"
  const isDeptLeader = myLeaderDepartmentId != null
  const canViewAll = hasPermission(user, "kpi.view_all") && (isAdmin || isDeptLeader)
  const canCompute = isAdmin || hasPermission(user, "kpi.manage_config")

  const loadData = useCallback(async (fid: string, userId: string, viewAll: boolean, y: number, m: number) => {
    setDataLoading(true)
    setLoadError("")
    try {
      const tasks: Promise<unknown>[] = [fetchMyKpiMonthlyScores(userId, fid).then((rows) => setMyScores(rows))]
      if (viewAll) {
        tasks.push(fetchKpiMonthlyScores(fid, y, m).then((rows) => setFactoryScores(rows)))
        tasks.push(loadKpiTaskCandidates(fid).then((c) => setCandidates(c.people)))
        tasks.push(
          fetchDepartmentOptions().then(async (depts) => {
            setDepartments(depts)
            const entries = await Promise.all(
              depts.map(async (d) => {
                const ids = await fetchDepartmentUserIds(fid, d.id)
                return [...ids].map((uid) => [uid, d] as const)
              }),
            )
            setUserDeptMap(new Map(entries.flat()))
          }),
        )
      }
      await Promise.all(tasks)
    } catch (err) {
      setLoadError(getKpiErrorMessage(err, "Không tải được bảng điểm KPI."))
    } finally {
      setDataLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId && user) void loadData(factoryId, user.id, canViewAll, nam, thang)
  }, [factoryId, user, canViewAll, nam, thang, loadData])

  const nameByUserId = useMemo(() => Object.fromEntries(candidates.map((c) => [c.userId, c.ten])), [candidates])

  // Lãnh đạo phòng ban (không phải admin) tự động chỉ thấy đúng phòng ban mình — mirror hành vi
  // đã áp dụng cho Công việc/Việc định kỳ/5S. Admin lọc tùy chọn qua dropdown (mặc định "Tất cả").
  const visibleFactoryScores = useMemo(() => {
    if (isDeptLeader && !isAdmin) {
      return factoryScores.filter((s) => userDeptMap.get(s.user_id)?.id === myLeaderDepartmentId)
    }
    if (isAdmin && deptFilter) {
      return factoryScores.filter((s) => userDeptMap.get(s.user_id)?.id === deptFilter)
    }
    return factoryScores
  }, [factoryScores, isDeptLeader, isAdmin, userDeptMap, myLeaderDepartmentId, deptFilter])

  const handleCompute = async () => {
    if (!factoryId) return
    setComputing(true)
    setComputeMsg("")
    try {
      const count = await computeKpiMonthlyScores(factoryId, nam, thang)
      setComputeMsg(`Đã tính điểm cho ${count} người (tháng ${thang}/${nam}).`)
      void loadData(factoryId, user!.id, canViewAll, nam, thang)
    } catch (err) {
      setLoadError(getKpiErrorMessage(err, "Không tính được điểm KPI tháng."))
    } finally {
      setComputing(false)
    }
  }

  const myScoreThisMonth = myScores.find((s) => s.nam === nam && s.thang === thang)

  // Khóa 1 điểm tháng (chỉ canCompute = admin/kpi.manage_config) — không có "mở khóa", mọi thay
  // đổi sau khi khóa phải qua khiếu nại + kpi_monthly_score_adjust (có audit log).
  const handleLock = async (scoreId: string) => {
    if (!factoryId || !user) return
    setLockingId(scoreId)
    setLoadError("")
    try {
      await lockKpiMonthlyScore(scoreId)
      void loadData(factoryId, user.id, canViewAll, nam, thang)
    } catch (err) {
      setLoadError(getKpiErrorMessage(err, "Không khóa được điểm này."))
    } finally {
      setLockingId(null)
    }
  }

  // Lịch sử điều chỉnh (kpi_score_adjustments) của điểm tháng đang chọn — chỉ có khi đã khóa sổ.
  useEffect(() => {
    let alive = true
    if (!myScoreThisMonth || myScoreThisMonth.trang_thai !== "da_khoa") {
      setMyAdjustments([])
      return
    }
    void fetchKpiScoreAdjustments(myScoreThisMonth.id)
      .then((rows) => { if (alive) setMyAdjustments(rows) })
      .catch(() => { if (alive) setMyAdjustments([]) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myScoreThisMonth?.id, myScoreThisMonth?.trang_thai])

  const openAppealModal = () => {
    setAppealNoiDung("")
    setAppealError("")
    setAppealModalOpen(true)
  }

  const handleSubmitAppeal = async () => {
    if (!factoryId || !user || !myScoreThisMonth) return
    if (!appealNoiDung.trim()) {
      setAppealError("Vui lòng nhập nội dung khiếu nại.")
      return
    }
    setAppealSubmitting(true)
    setAppealError("")
    try {
      await createKpiAppealForMonthlyScore({
        factoryId,
        monthlyScoreId: myScoreThisMonth.id,
        nguoiKhieuNaiId: user.id,
        noiDung: appealNoiDung,
      })
      sendKpiNotify({
        factoryId,
        title: "Khiếu nại điểm KPI tháng mới",
        lines: [
          `👤 Người khiếu nại: ${user.full_name || user.username}`,
          `📅 Tháng: ${thang}/${nam}`,
          `📝 Nội dung: ${appealNoiDung.trim()}`,
        ],
        link: "/dashboard/kpi/appeals",
      })
      setAppealModalOpen(false)
      setComputeMsg("Đã gửi khiếu nại — admin sẽ xem xét và phản hồi tại tab Khiếu nại.")
    } catch (err) {
      setAppealError(getKpiAppealErrorMessage(err, "Không gửi được khiếu nại."))
    } finally {
      setAppealSubmitting(false)
    }
  }

  if (loading) {
    return (
      <KpiShell>
        <div className="p-12 text-center text-slate-400">Đang tải...</div>
      </KpiShell>
    )
  }

  return (
    <KpiShell>
      <div ref={revealRef} className="scroll-reveal space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-600">
              <Award size={18} />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-800">Bảng điểm KPI</h1>
              <p className="text-xs text-slate-500">
                KPI tháng = (A×Hoàn thành + B×Đúng hạn + C×5S + D×Chuyên môn) × Hệ số chuyên cần.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={thang}
              onChange={(e) => setThang(Number(e.target.value))}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500"
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>Tháng {m}</option>
              ))}
            </select>
            <select
              value={nam}
              onChange={(e) => setNam(Number(e.target.value))}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500"
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {isAdmin && departments.length > 0 && (
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-violet-500"
              >
                <option value="">Tất cả phòng ban</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
            {canCompute && (
              <button
                onClick={() => void handleCompute()}
                disabled={computing}
                className="hover-lift flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60 sm:w-auto"
              >
                <Calculator size={15} /> {computing ? "Đang tính..." : "Tính điểm tháng"}
              </button>
            )}
          </div>
        </div>

        {/* Toggle Tổng quan / Chi tiết cách tính / Bảng xếp hạng */}
        <div className="flex gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
          <button
            onClick={() => setScoreView("tong-quan")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${scoreView === "tong-quan" ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:bg-slate-50"}`}
          >
            <TrendingUp size={14} /> Tổng quan
          </button>
          <button
            onClick={() => { setDetailUserId(null); setScoreView("chi-tiet") }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${scoreView === "chi-tiet" ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:bg-slate-50"}`}
          >
            <ListTree size={14} />
            <span className="hidden sm:inline">Chi tiết cách tính điểm của tôi</span>
            <span className="sm:hidden">Chi tiết</span>
          </button>
          <button
            onClick={() => setScoreView("xep-hang")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${scoreView === "xep-hang" ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:bg-slate-50"}`}
          >
            <ListOrdered size={14} /> Bảng xếp hạng
          </button>
        </div>

        {computeMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">{computeMsg}</div>}
        {loadError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{loadError}</div>}

        {scoreView === "tong-quan" ? (
          <>
            {/* Điểm của chính mình tháng đang chọn */}
            <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-extrabold text-slate-700">
                  <TrendingUp size={15} className="text-violet-600" /> Điểm của bạn — Tháng {thang}/{nam}
                </div>
                {myScoreThisMonth?.trang_thai === "da_khoa" && (
                  <button
                    onClick={openAppealModal}
                    className="flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                  >
                    <Flag size={11} /> Khiếu nại điểm này
                  </button>
                )}
              </div>
              {dataLoading ? (
                <div className="py-4 text-center text-sm text-slate-400">Đang tải...</div>
              ) : myScoreThisMonth ? (
                <>
                  <ScoreBreakdown score={myScoreThisMonth} />
                  {myAdjustments.length > 0 && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-500">
                        <History size={12} /> Lịch sử điều chỉnh
                      </div>
                      <div className="space-y-1.5">
                        {myAdjustments.map((a) => (
                          <div key={a.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                            <span className="font-semibold text-slate-700">{a.diem_truoc ?? "—"} → {a.diem_sau ?? "—"}</span>
                            {" · "}{a.ly_do}{" "}
                            <span className="text-slate-400">({formatKpiDateTime(a.created_at)})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-4 text-center text-sm text-slate-400">Chưa có điểm cho tháng này.</div>
              )}
            </div>

            {/* Lịch sử điểm cá nhân các tháng khác */}
            {myScores.length > 0 && (
              <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 text-sm font-extrabold text-slate-700">Lịch sử điểm của bạn</div>
                <div className="space-y-2">
                  {myScores.map((s) => (
                    <div key={s.id} className="row-hover flex items-center justify-between gap-3 rounded-xl px-3 py-2">
                      <div className="text-sm font-semibold text-slate-600">Tháng {s.thang}/{s.nam}</div>
                      <div className="flex items-center gap-3">
                        <div className="w-40"><KpiProgressBar percent={s.diem_tong ?? 0} size="sm" /></div>
                        <span className="w-14 text-right text-sm font-extrabold text-slate-800">{s.diem_tong ?? "—"}</span>
                        <span className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${s.trang_thai === "da_khoa" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700"}`}>
                          {s.trang_thai === "da_khoa" ? "Đã khóa" : "Nháp"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bảng toàn nhà máy — chỉ admin/kpi.view_all + lãnh đạo phòng ban */}
            {canViewAll && (
              <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-extrabold text-slate-700">Toàn nhà máy — Tháng {thang}/{nam}</div>
                </div>
                {dataLoading ? (
                  <div className="py-6 text-center text-sm text-slate-400">Đang tải...</div>
                ) : visibleFactoryScores.length === 0 ? (
                  <div className="py-6 text-center text-sm text-slate-400">Chưa có điểm nào được tính cho tháng này.</div>
                ) : (
                  <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase text-slate-400">
                          <th className="py-2 pr-3">Nhân sự</th>
                          <th className="px-2 py-2">Phòng ban</th>
                          <th className="px-2 py-2">A</th>
                          <th className="px-2 py-2">B</th>
                          <th className="px-2 py-2">C</th>
                          <th className="px-2 py-2">D</th>
                          <th className="px-2 py-2">Hệ số CC</th>
                          <th className="px-2 py-2 text-right">Tổng</th>
                          <th className="py-2 pl-2">Trạng thái</th>
                          <th className="py-2 pl-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {visibleFactoryScores.map((s) => (
                          <tr key={s.id} className="row-hover border-b border-slate-100 last:border-0">
                            <td className="py-2 pr-3 font-semibold text-slate-700">{nameByUserId[s.user_id] || s.user_id}</td>
                            <td className="px-2 py-2 text-slate-500">{userDeptMap.get(s.user_id)?.name || "—"}</td>
                            <td className="px-2 py-2 text-slate-500">{s.diem_hoan_thanh ?? "—"}</td>
                            <td className="px-2 py-2 text-slate-500">{s.diem_dung_han ?? "—"}</td>
                            <td className="px-2 py-2 text-slate-500">{s.diem_5s ?? "—"}</td>
                            <td className="px-2 py-2 text-slate-500">{s.diem_chuyen_mon ?? "—"}</td>
                            <td className="px-2 py-2 text-slate-500">{s.he_so_chuyen_can ?? "—"}</td>
                            <td className="px-2 py-2 text-right text-base font-extrabold text-violet-700">{s.diem_tong ?? "—"}</td>
                            <td className="py-2 pl-2">
                              <div className="flex items-center gap-1.5 whitespace-nowrap">
                                <span className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${s.trang_thai === "da_khoa" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700"}`}>
                                  {s.trang_thai === "da_khoa" ? "Đã khóa" : "Nháp"}
                                </span>
                                {canCompute && s.trang_thai === "nhap" && (
                                  <button
                                    onClick={() => void handleLock(s.id)}
                                    disabled={lockingId === s.id}
                                    className="flex items-center gap-1 rounded-lg bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                                  >
                                    <Lock size={10} /> {lockingId === s.id ? "..." : "Khóa"}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-2 pl-2">
                              <button
                                onClick={() => { setDetailUserId(s.user_id); setScoreView("chi-tiet") }}
                                className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 hover:bg-violet-100"
                              >
                                <Eye size={10} /> Xem chi tiết
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ResponsiveTableWrapper>
                )}
              </div>
            )}
          </>
        ) : scoreView === "chi-tiet" ? (
          user &&
          factoryId && (
            <>
              {detailUserId && detailUserId !== user.id && (
                <button
                  onClick={() => setDetailUserId(null)}
                  className="flex items-center gap-1.5 text-xs font-bold text-violet-600 hover:text-violet-800"
                >
                  <ArrowLeft size={12} /> Quay lại xem của tôi
                </button>
              )}
              <MyScoreExplain
                factoryId={factoryId}
                userId={detailUserId ?? user.id}
                subjectName={detailUserId && detailUserId !== user.id ? nameByUserId[detailUserId] || detailUserId : "bạn"}
                nam={nam}
                thang={thang}
              />
            </>
          )
        ) : (
          user && factoryId && <ScoreRankingView factoryId={factoryId} userId={user.id} nam={nam} thang={thang} />
        )}
      </div>

      {appealModalOpen && myScoreThisMonth && (
        <ModalShell
          title="Khiếu nại điểm KPI tháng"
          onClose={() => setAppealModalOpen(false)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setAppealModalOpen(false)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                onClick={() => void handleSubmitAppeal()}
                disabled={appealSubmitting}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {appealSubmitting ? "Đang gửi..." : "Gửi khiếu nại"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Điểm tháng {thang}/{nam} của bạn (hiện <strong>{myScoreThisMonth.diem_tong ?? "—"}</strong>) đã được khóa
              sổ. Nếu bạn cho rằng điểm chưa chính xác, hãy nêu rõ lý do để admin xem xét lại.
            </p>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Nội dung khiếu nại</label>
              <textarea
                value={appealNoiDung}
                onChange={(e) => setAppealNoiDung(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
              />
            </div>
            {appealError && <div className="text-xs font-semibold text-red-600">{appealError}</div>}
          </div>
        </ModalShell>
      )}
    </KpiShell>
  )
}

function ScoreBreakdown({ score }: { score: KpiMonthlyScore }) {
  return (
    <div>
      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Hoàn thành (A)" value={score.diem_hoan_thanh} color="sky" />
        <Metric label="Đúng hạn (B)" value={score.diem_dung_han} color="amber" />
        <Metric label="5S (C)" value={score.diem_5s} color="emerald" />
        <Metric label="Chuyên môn (D)" value={score.diem_chuyen_mon} color="violet" />
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1"><KpiProgressBar percent={score.diem_tong ?? 0} size="md" /></div>
        <div className="text-2xl font-extrabold text-slate-800">{score.diem_tong ?? "—"}</div>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">
        Hệ số chuyên cần: {score.he_so_chuyen_can ?? "—"} · Số ngày có chấm chuyên môn: {score.so_ngay_co_cham ?? 0}
      </div>
    </div>
  )
}

const METRIC_COLOR: Record<string, string> = {
  sky: "bg-sky-50 text-sky-700",
  amber: "bg-amber-50 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
  violet: "bg-violet-50 text-violet-700",
}

function Metric({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${METRIC_COLOR[color]}`}>
      <div className="text-[10px] font-bold uppercase opacity-70">{label}</div>
      <div className="text-lg font-extrabold">{value ?? "—"}</div>
    </div>
  )
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// Sub-tab "Chi tiết cách tính điểm" — mặc định của chính người xem, nhưng admin/lãnh đạo có thể
// mở của người khác qua nút "Xem chi tiết" ở bảng "Toàn nhà máy" (userId khi đó là user_id của
// dòng đã bấm, subjectName là tên hiển thị tương ứng). Tính lại real-time, không đọc
// kpi_monthly_scores.chi_tiet.
function MyScoreExplain({
  factoryId,
  userId,
  subjectName,
  nam,
  thang,
}: {
  factoryId: string
  userId: string
  subjectName: string
  nam: number
  thang: number
}) {
  const [loadingBd, setLoadingBd] = useState(true)
  const [bdError, setBdError] = useState("")
  const [primaryGroup, setPrimaryGroup] = useState<MyPrimaryGroup>(null)
  const [weights, setWeights] = useState<KpiScoreWeights[]>([])
  const [tasks, setTasks] = useState<BreakdownTask[]>([])
  const [evals5s, setEvals5s] = useState<Breakdown5s[]>([])
  const [daily, setDaily] = useState<BreakdownDailyEvaluation[]>([])

  useEffect(() => {
    let alive = true
    const load = async () => {
      setLoadingBd(true)
      setBdError("")
      try {
        const [pg, w, t, e5s, d] = await Promise.all([
          fetchMyPrimaryGroup(factoryId, userId),
          fetchKpiScoreWeights(factoryId),
          fetchScoreBreakdownTasks(factoryId, userId, nam, thang),
          fetchScoreBreakdown5s(factoryId, userId, nam, thang),
          fetchScoreBreakdownDaily(factoryId, userId, nam, thang),
        ])
        if (!alive) return
        setPrimaryGroup(pg)
        setWeights(w)
        setTasks(t)
        setEvals5s(e5s)
        setDaily(d)
      } catch (err) {
        if (alive) setBdError(getKpiErrorMessage(err, "Không tải được chi tiết cách tính điểm."))
      } finally {
        if (alive) setLoadingBd(false)
      }
    }
    void load()
    return () => { alive = false }
  }, [factoryId, userId, nam, thang])

  if (loadingBd) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Đang tải...</div>
  if (bdError) return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{bdError}</div>

  const d = defaultKpiScoreWeights()
  const applicable =
    (primaryGroup && weights.find((w) => w.group_id === primaryGroup.id)) ||
    weights.find((w) => w.group_id === null) ||
    null
  const wA = applicable?.trong_so_hoan_thanh ?? d.trong_so_hoan_thanh
  const wB = applicable?.trong_so_dung_han ?? d.trong_so_dung_han
  const wC = applicable?.trong_so_5s ?? d.trong_so_5s
  const wD = applicable?.trong_so_chuyen_mon ?? d.trong_so_chuyen_mon
  const ngayChuan = applicable?.ngay_chuan_chuyen_can ?? d.ngay_chuan_chuyen_can
  const heSoMin = applicable?.he_so_chuyen_can_min ?? d.he_so_chuyen_can_min
  const heSoMax = applicable?.he_so_chuyen_can_max ?? d.he_so_chuyen_can_max

  // A
  const scoreA = tasks.length === 0 ? 100 : round1(tasks.reduce((s, t) => s + (t.tien_do_nghiem_thu ?? t.tien_do), 0) / tasks.length)

  // B — chỉ task đã đến hạn
  const cutoff = computeCutoffMs(nam, thang)
  const dueTasks = tasks.filter((t) => {
    const due = new Date(t.han_hoan_thanh).getTime()
    return !Number.isNaN(due) && due <= cutoff
  })
  const onTimeCount = dueTasks.filter((t) => t.da_nop_luc && new Date(t.da_nop_luc).getTime() <= new Date(t.han_hoan_thanh).getTime()).length
  const scoreB = dueTasks.length === 0 ? 100 : round1((onTimeCount / dueTasks.length) * 100)

  // C
  const to5sPoint = (k: Breakdown5s["ket_qua"]) => (k === "dat" ? 100 : k === "tuong_doi" ? 50 : 0)
  const scoreC = evals5s.length === 0 ? 100 : round1(evals5s.reduce((s, e) => s + to5sPoint(e.ket_qua), 0) / evals5s.length)

  // D
  const dayScores = groupDailyByDay(daily)
  const scoreD = dayScores.length === 0 ? 100 : round1(dayScores.reduce((s, dsc) => s + dsc.pctNgay, 0) / dayScores.length)

  const heSoChuyenCan = Math.min(heSoMax, Math.max(heSoMin, dayScores.length / (ngayChuan || 1)))
  const diemTong = round1(((wA * scoreA + wB * scoreB + wC * scoreC + wD * scoreD) / 100) * heSoChuyenCan)

  return (
    <div className="space-y-4">
      <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-extrabold text-slate-700">Trọng số áp dụng cho {subjectName}</div>
        <p className="mb-2 text-xs text-slate-500">
          {primaryGroup
            ? <>Theo nhóm chuyên môn chính: <strong>{primaryGroup.name}</strong></>
            : `${subjectName === "bạn" ? "Bạn" : subjectName} chưa thuộc nhóm chuyên môn nào — dùng cấu hình mặc định toàn nhà máy.`}
          {applicable?.group_id == null && primaryGroup && " (nhóm này chưa có cấu hình riêng, đang dùng mặc định toàn nhà máy)"}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Hoàn thành (A)" value={wA} color="sky" />
          <Metric label="Đúng hạn (B)" value={wB} color="amber" />
          <Metric label="5S (C)" value={wC} color="emerald" />
          <Metric label="Chuyên môn (D)" value={wD} color="violet" />
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          Ngày chuẩn chuyên cần: {ngayChuan} · Hệ số chuyên cần: {heSoMin}–{heSoMax}
        </div>
      </div>

      <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between text-sm font-extrabold text-slate-700">
          <span>A — Hoàn thành</span>
          <span className="text-sky-600">Trung bình: {scoreA}%</span>
        </div>
        {tasks.length === 0 ? (
          <div className="py-3 text-center text-xs text-slate-400">Không có việc nào trong tháng → mặc định 100%.</div>
        ) : (
          <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left font-bold uppercase text-slate-400">
                  <th className="py-1.5 pr-2">Việc</th>
                  <th className="px-2 py-1.5">Ngày giao</th>
                  <th className="px-2 py-1.5">Trạng thái</th>
                  <th className="py-1.5 pl-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.task_id} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 pr-2 font-semibold text-slate-700">{t.tieu_de}</td>
                    <td className="px-2 py-1.5 text-slate-500">{t.ngay_giao}</td>
                    <td className="px-2 py-1.5 text-slate-500">{t.trang_thai}</td>
                    <td className="py-1.5 pl-2 text-right font-bold text-slate-700">{t.tien_do_nghiem_thu ?? t.tien_do}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        )}
      </div>

      <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between text-sm font-extrabold text-slate-700">
          <span>B — Đúng hạn</span>
          <span className="text-amber-600">Trung bình: {scoreB}%</span>
        </div>
        {dueTasks.length === 0 ? (
          <div className="py-3 text-center text-xs text-slate-400">Không có việc nào đã đến hạn trong tháng → mặc định 100%.</div>
        ) : (
          <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left font-bold uppercase text-slate-400">
                  <th className="py-1.5 pr-2">Việc</th>
                  <th className="px-2 py-1.5">Hạn</th>
                  <th className="px-2 py-1.5">Đã nộp lúc</th>
                  <th className="py-1.5 pl-2 text-right">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {dueTasks.map((t) => {
                  const onTime = !!t.da_nop_luc && new Date(t.da_nop_luc).getTime() <= new Date(t.han_hoan_thanh).getTime()
                  return (
                    <tr key={t.task_id} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pr-2 font-semibold text-slate-700">{t.tieu_de}</td>
                      <td className="px-2 py-1.5 text-slate-500">{new Date(t.han_hoan_thanh).toLocaleString("vi-VN")}</td>
                      <td className="px-2 py-1.5 text-slate-500">{t.da_nop_luc ? new Date(t.da_nop_luc).toLocaleString("vi-VN") : "Chưa nộp"}</td>
                      <td className={`py-1.5 pl-2 text-right font-bold ${onTime ? "text-emerald-600" : "text-red-600"}`}>{onTime ? "Đúng hạn" : "Trễ hạn"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        )}
      </div>

      <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between text-sm font-extrabold text-slate-700">
          <span>C — 5S</span>
          <span className="text-emerald-600">Trung bình: {scoreC}%</span>
        </div>
        {evals5s.length === 0 ? (
          <div className="py-3 text-center text-xs text-slate-400">Không có lượt chấm 5S nào trong tháng → mặc định 100%.</div>
        ) : (
          <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left font-bold uppercase text-slate-400">
                  <th className="py-1.5 pr-2">Vị trí</th>
                  <th className="px-2 py-1.5">Tuần</th>
                  <th className="px-2 py-1.5">Kết quả</th>
                  <th className="py-1.5 pl-2 text-right">Điểm</th>
                </tr>
              </thead>
              <tbody>
                {evals5s.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 pr-2 font-semibold text-slate-700">{e.vi_tri_ten}</td>
                    <td className="px-2 py-1.5 text-slate-500">{e.tuan_bat_dau}</td>
                    <td className="px-2 py-1.5 text-slate-500">{e.ket_qua === "dat" ? "Đạt" : e.ket_qua === "tuong_doi" ? "Tương đối" : "Không đạt"}</td>
                    <td className="py-1.5 pl-2 text-right font-bold text-slate-700">{to5sPoint(e.ket_qua)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        )}
      </div>

      <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between text-sm font-extrabold text-slate-700">
          <span>D — Chuyên môn</span>
          <span className="text-violet-600">Trung bình: {scoreD}%</span>
        </div>
        {dayScores.length === 0 ? (
          <div className="py-3 text-center text-xs text-slate-400">Không có ngày nào có chấm chuyên môn (nhóm chính) trong tháng → mặc định 100%.</div>
        ) : (
          <>
            <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left font-bold uppercase text-slate-400">
                    <th className="py-1.5 pr-2">Ngày</th>
                    <th className="px-2 py-1.5">%Chính</th>
                    <th className="px-2 py-1.5">Choàng</th>
                    <th className="px-2 py-1.5">Điểm ngày / Max</th>
                    <th className="py-1.5 pl-2 text-right">%Ngày</th>
                  </tr>
                </thead>
                <tbody>
                  {dayScores.map((dsc) => (
                    <tr key={dsc.ngay} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pr-2 font-semibold text-slate-700">{dsc.ngay}</td>
                      <td className="px-2 py-1.5 text-slate-500">{dsc.chinhPct}%</td>
                      <td className="px-2 py-1.5 text-slate-500">
                        {dsc.choangEntries.length === 0 ? "—" : dsc.choangEntries.map((c) => `${c.group_ten} (${c.pct}%)`).join(", ")}
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{round1(dsc.diemNgay)} / {dsc.maxNgay}</td>
                      <td className="py-1.5 pl-2 text-right font-bold text-slate-700">{round1(dsc.pctNgay)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTableWrapper>
            <div className="mt-2 text-[11px] text-slate-400">Số ngày có chấm chuyên môn: {dayScores.length}</div>
          </>
        )}
      </div>

      <div className="hover-lift rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
        <div className="mb-2 text-sm font-extrabold text-violet-700">Kết quả cuối cùng (tính lại real-time)</div>
        <div className="text-sm text-slate-700">
          ({wA}×{scoreA} + {wB}×{scoreB} + {wC}×{scoreC} + {wD}×{scoreD}) / 100 × {round1(heSoChuyenCan)} = <strong className="text-lg text-violet-700">{diemTong}</strong>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Số liệu tính lại real-time từ dữ liệu hiện tại — có thể khác với điểm đã lưu ở tab
          &quot;Tổng quan&quot; nếu dữ liệu thay đổi sau lần admin bấm &quot;Tính điểm tháng&quot;
          gần nhất.
        </p>
      </div>
    </div>
  )
}

const RANK_MODE_LABEL: Record<"nhom" | "phong-ban", string> = { nhom: "Theo nhóm chuyên môn", "phong-ban": "Theo phòng ban" }

// Sub-tab "Bảng xếp hạng" — ẩn danh theo Nhóm chuyên môn hoặc Phòng ban. Gọi 2 RPC SECURITY
// DEFINER (kpi_score_ranking_by_group/_by_department) — chỉ trả {rank, diem_tong, is_me}, không
// bao giờ lộ tên người khác, nên mọi kpi.view user gọi được (không cần kpi.view_all).
function ScoreRankingView({ factoryId, userId, nam, thang }: { factoryId: string; userId: string; nam: number; thang: number }) {
  const [mode, setMode] = useState<"nhom" | "phong-ban">("nhom")
  const [groups, setGroups] = useState<KpiGroupOption[]>([])
  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState("")
  const [selectedDeptId, setSelectedDeptId] = useState("")
  const [myGroupId, setMyGroupId] = useState<string | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [optionsError, setOptionsError] = useState("")
  const [rows, setRows] = useState<KpiScoreRankingRow[]>([])
  const [loadingRanking, setLoadingRanking] = useState(false)
  const [rankError, setRankError] = useState("")

  useEffect(() => {
    let alive = true
    const load = async () => {
      setLoadingOptions(true)
      setOptionsError("")
      try {
        const [g, d, pg] = await Promise.all([
          loadAllPersonnelGroups(factoryId),
          fetchDepartmentOptions(),
          fetchMyPrimaryGroup(factoryId, userId),
        ])
        if (!alive) return
        setGroups(g)
        setDepartments(d)
        setMyGroupId(pg?.id || null)
        setSelectedGroupId(pg?.id || g[0]?.id || "")
        setSelectedDeptId(d[0]?.id || "")
      } catch (err) {
        if (alive) setOptionsError(getKpiErrorMessage(err, "Không tải được danh sách nhóm/phòng ban."))
      } finally {
        if (alive) setLoadingOptions(false)
      }
    }
    void load()
    return () => { alive = false }
  }, [factoryId, userId])

  useEffect(() => {
    const targetId = mode === "nhom" ? selectedGroupId : selectedDeptId
    if (!targetId) { setRows([]); return }
    let alive = true
    const load = async () => {
      setLoadingRanking(true)
      setRankError("")
      try {
        const data =
          mode === "nhom"
            ? await fetchKpiScoreRankingByGroup(factoryId, nam, thang, targetId)
            : await fetchKpiScoreRankingByDepartment(factoryId, nam, thang, targetId)
        if (alive) setRows(data)
      } catch (err) {
        if (alive) setRankError(getKpiErrorMessage(err, "Không tải được bảng xếp hạng."))
      } finally {
        if (alive) setLoadingRanking(false)
      }
    }
    void load()
    return () => { alive = false }
  }, [factoryId, nam, thang, mode, selectedGroupId, selectedDeptId])

  return (
    <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-extrabold text-slate-700">Bảng xếp hạng ẩn danh — Tháng {thang}/{nam}</div>
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          {(["nhom", "phong-ban"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${mode === m ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {RANK_MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Chỉ hiện thứ hạng và điểm — không hiện tên người khác, để so sánh công bằng mà không lộ danh tính.
      </p>

      {optionsError && <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{optionsError}</div>}

      {loadingOptions ? (
        <div className="py-4 text-center text-sm text-slate-400">Đang tải...</div>
      ) : mode === "nhom" ? (
        groups.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-400">Chưa có nhóm chuyên môn nào.</div>
        ) : (
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="mb-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500 sm:w-72"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}{myGroupId === g.id ? " (nhóm của bạn)" : ""}
              </option>
            ))}
          </select>
        )
      ) : departments.length === 0 ? (
        <div className="py-4 text-center text-sm text-slate-400">Chưa có phòng ban nào.</div>
      ) : (
        <select
          value={selectedDeptId}
          onChange={(e) => setSelectedDeptId(e.target.value)}
          className="mb-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500 sm:w-72"
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      )}

      {rankError && <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{rankError}</div>}

      {loadingRanking ? (
        <div className="py-6 text-center text-sm text-slate-400">Đang tải...</div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-400">Chưa có điểm nào được tính cho lựa chọn này trong tháng đã chọn.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.rank}
              className={`row-hover rounded-xl px-3 py-2 text-sm ${r.is_me ? "bg-violet-50 font-extrabold text-violet-700 ring-1 ring-violet-200" : "text-slate-600"}`}
            >
              Hạng {r.rank}{r.is_me ? " (bạn)" : ""}: {r.diem_tong} điểm
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
