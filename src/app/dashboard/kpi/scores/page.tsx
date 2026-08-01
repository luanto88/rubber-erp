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

import { useCallback, useEffect, useMemo, useState } from "react"
import { Award, Calculator, TrendingUp } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { KpiShell } from "@/app/dashboard/kpi/_components/kpi-shell"
import { KpiProgressBar } from "@/app/dashboard/kpi/_components/kpi-progress-bar"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { resolveMyLeaderDepartmentId } from "@/lib/kpi-department-leaders"
import { getKpiErrorMessage, loadKpiTaskCandidates, type KpiTaskCandidate } from "@/lib/kpi-tasks"
import {
  computeKpiMonthlyScores,
  fetchKpiMonthlyScores,
  fetchMyKpiMonthlyScores,
  type KpiMonthlyScore,
} from "@/lib/kpi-scores"

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
  const [dataLoading, setDataLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [computing, setComputing] = useState(false)
  const [computeMsg, setComputeMsg] = useState("")

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

  if (loading) {
    return (
      <KpiShell>
        <div className="p-12 text-center text-slate-400">Đang tải...</div>
      </KpiShell>
    )
  }

  const myScoreThisMonth = myScores.find((s) => s.nam === nam && s.thang === thang)

  return (
    <KpiShell>
      <div ref={revealRef} className="scroll-reveal space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-600">
              <Award size={18} />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-800">Bảng điểm KPI</h1>
              <p className="text-xs text-slate-500">
                KPI tháng = (A×Hoàn thành + B×Đúng hạn + C×5S + D×Chuyên môn) × Hệ số chuyên cần — bản nháp, chưa khóa sổ.
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
            {canCompute && (
              <button
                onClick={() => void handleCompute()}
                disabled={computing}
                className="hover-lift flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
              >
                <Calculator size={15} /> {computing ? "Đang tính..." : "Tính điểm tháng"}
              </button>
            )}
          </div>
        </div>

        {computeMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">{computeMsg}</div>}
        {loadError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{loadError}</div>}

        {/* Điểm của chính mình tháng đang chọn */}
        <div className="hover-lift rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-700">
            <TrendingUp size={15} className="text-violet-600" /> Điểm của bạn — Tháng {thang}/{nam}
          </div>
          {dataLoading ? (
            <div className="py-4 text-center text-sm text-slate-400">Đang tải...</div>
          ) : myScoreThisMonth ? (
            <ScoreBreakdown score={myScoreThisMonth} />
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
            <div className="mb-2 text-sm font-extrabold text-slate-700">Toàn nhà máy — Tháng {thang}/{nam}</div>
            {dataLoading ? (
              <div className="py-6 text-center text-sm text-slate-400">Đang tải...</div>
            ) : factoryScores.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-400">Chưa có điểm nào được tính cho tháng này.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase text-slate-400">
                      <th className="py-2 pr-3">Nhân sự</th>
                      <th className="px-2 py-2">A</th>
                      <th className="px-2 py-2">B</th>
                      <th className="px-2 py-2">C</th>
                      <th className="px-2 py-2">D</th>
                      <th className="px-2 py-2">Hệ số CC</th>
                      <th className="py-2 pl-2 text-right">Tổng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factoryScores.map((s) => (
                      <tr key={s.id} className="row-hover border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-3 font-semibold text-slate-700">{nameByUserId[s.user_id] || s.user_id}</td>
                        <td className="px-2 py-2 text-slate-500">{s.diem_hoan_thanh ?? "—"}</td>
                        <td className="px-2 py-2 text-slate-500">{s.diem_dung_han ?? "—"}</td>
                        <td className="px-2 py-2 text-slate-500">{s.diem_5s ?? "—"}</td>
                        <td className="px-2 py-2 text-slate-500">{s.diem_chuyen_mon ?? "—"}</td>
                        <td className="px-2 py-2 text-slate-500">{s.he_so_chuyen_can ?? "—"}</td>
                        <td className="py-2 pl-2 text-right text-base font-extrabold text-violet-700">{s.diem_tong ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
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
