"use client"

// Danh sách + xử lý Khiếu nại (kpi_appeals). Người dùng thường chỉ thấy khiếu nại của chính
// mình (RLS); admin/kpi.manage_config thấy tất cả và có nút xử lý.
// Xem đầy đủ .claude/rules/27-kpi-module.md, mục "Cập nhật — Phân công thông minh + Gia hạn +
// Khiếu nại" và "Liệt kê Phase 5".
//
// Phase 5: khiếu nại điểm KPI tháng (monthly_score_id) — chỉ tạo được khi điểm đã khóa sổ (RLS
// tự chặn ở trang Bảng điểm KPI). Đóng "Đã giải quyết" cho loại này bắt buộc nhập điểm mới + lý
// do điều chỉnh (mirror đúng cơ chế Bug 2 đã có cho khiếu nại 5S) — ghi vào kpi_score_adjustments.

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Flag, ThumbsUp, XCircle } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { KpiShell } from "@/app/dashboard/kpi/_components/kpi-shell"
import { Kpi5sResultPicker } from "@/app/dashboard/kpi/_components/kpi-5s-result-picker"
import {
  decideKpi5sAppealCorrection,
  fetchKpiAppeals,
  getKpiAppealErrorMessage,
  proposeKpi5sAppealCorrection,
  KPI_APPEAL_STATUS_BADGE_CLASS,
  KPI_APPEAL_STATUS_LABEL,
  resolveKpiAppeal,
  resolveKpiMonthlyScoreAppeal,
  type KpiAppeal,
} from "@/lib/kpi-appeals"
import { resolveMyLeaderDepartmentId } from "@/lib/kpi-department-leaders"
import { KPI_5S_RESULT_LABEL, type Kpi5sResult } from "@/lib/kpi-5s"
import { sendKpiNotify } from "@/lib/kpi-notify"
import { formatKpiDateTime, loadKpiTaskCandidates, type KpiTaskCandidate } from "@/lib/kpi-tasks"

type TaskRef = { id: string; ma_cong_viec: string | null; tieu_de: string }
type LocationEvalRef = {
  id: string
  location_id: string
  tuan_bat_dau: string
  ket_qua: Kpi5sResult
  ly_do: string | null
  nguoi_cham_id: string
}
type LocationRef = { id: string; ma_vi_tri: string; ten_vi_tri: string; phong_ban_id: string | null }
type MonthlyScoreRef = { id: string; nam: number; thang: number; diem_tong: number | null; trang_thai: "nhap" | "da_khoa" }

export default function KpiAppealsPage() {
  const revealRef = useScrollReveal()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [appeals, setAppeals] = useState<KpiAppeal[]>([])
  const [candidates, setCandidates] = useState<KpiTaskCandidate[]>([])
  const [taskRefs, setTaskRefs] = useState<Record<string, TaskRef>>({})
  const [locationRefs, setLocationRefs] = useState<Record<string, { eval: LocationEvalRef; location: LocationRef | null }>>({})
  const [monthlyScoreRefs, setMonthlyScoreRefs] = useState<Record<string, MonthlyScoreRef>>({})
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const [resolveTarget, setResolveTarget] = useState<{ appeal: KpiAppeal; trangThai: "da_giai_quyet" | "tu_choi" } | null>(null)
  const [phanHoi, setPhanHoi] = useState("")
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState("")

  // Phase 5: khi đóng khiếu nại điểm KPI tháng "Đã giải quyết", cho phép điều chỉnh luôn điểm
  // tổng (ghi kpi_score_adjustments) — chỉ hiện khi appeal gắn monthly_score_id.
  const [resolveNewDiemTong, setResolveNewDiemTong] = useState(0)
  const [resolveAdjustLyDo, setResolveAdjustLyDo] = useState("")

  // Bước 3 (2026-08-19) — duyệt/từ chối ĐỀ XUẤT sửa kết quả 5S do người chấm gửi (trang_thai
  // 'cho_duyet_sua') — khác hẳn resolveTarget ở trên (đóng khiếu nại 'cho_xu_ly' của task/điểm
  // tháng, hoặc từ chối thẳng khiếu nại 5S). Chỉ admin/kpi.manage_config/lãnh đạo ĐÚNG phòng ban
  // của vị trí đó mới thấy nút này (mirror kpi_appeal_decide_correction RLS check).
  const [myLeaderDepartmentId, setMyLeaderDepartmentId] = useState<string | null>(null)
  const [decideTarget, setDecideTarget] = useState<{ appeal: KpiAppeal; approve: boolean } | null>(null)
  const [decideGhiChu, setDecideGhiChu] = useState("")
  const [deciding, setDeciding] = useState(false)
  const [decideError, setDecideError] = useState("")

  // Bước 2 — NGƯỜI CHẤM tự đề xuất sửa kết quả ngay tại danh sách khiếu nại (mirror đúng modal
  // đã có ở trang chi tiết vị trí 5S — thêm ở đây để không bắt người chấm phải bấm thêm 1 lần
  // qua link "Vị trí 5S: ..." mới thấy được nút hành động, cải thiện luôn tính khám phá của
  // thông báo mới thêm ở Bell/badge).
  const [proposeTarget, setProposeTarget] = useState<{ appeal: KpiAppeal; eval: LocationEvalRef } | null>(null)
  const [proposeKetQua, setProposeKetQua] = useState<Kpi5sResult>("dat")
  const [proposeLyDo, setProposeLyDo] = useState("")
  const [proposeSaving, setProposeSaving] = useState(false)
  const [proposeError, setProposeError] = useState("")

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
      const [appealRows, candidateData, leaderDeptId] = await Promise.all([
        fetchKpiAppeals(fid),
        loadKpiTaskCandidates(fid),
        resolveMyLeaderDepartmentId(uid, fid),
      ])
      setAppeals(appealRows)
      setCandidates(candidateData.people)
      setMyLeaderDepartmentId(leaderDeptId)

      // Nạp thêm tiêu đề công việc / tên vị trí để hiển thị — best-effort, bỏ qua êm nếu
      // người xem không có quyền đọc bản ghi gốc (vd resolver không phải thành viên task đó).
      const taskIds = Array.from(new Set(appealRows.map((a) => a.task_id).filter((v): v is string => !!v)))
      const evalIds = Array.from(new Set(appealRows.map((a) => a.location_evaluation_id).filter((v): v is string => !!v)))

      if (taskIds.length > 0) {
        const { data } = await supabase.from("kpi_tasks").select("id, ma_cong_viec, tieu_de").in("id", taskIds)
        setTaskRefs(Object.fromEntries(((data || []) as TaskRef[]).map((t) => [t.id, t])))
      } else {
        setTaskRefs({})
      }

      if (evalIds.length > 0) {
        const { data: evalData } = await supabase
          .from("kpi_5s_evaluations")
          .select("id, location_id, tuan_bat_dau, ket_qua, ly_do, nguoi_cham_id")
          .in("id", evalIds)
        const evalRows = (evalData || []) as LocationEvalRef[]
        const locationIds = Array.from(new Set(evalRows.map((e) => e.location_id)))
        let locationById: Record<string, LocationRef> = {}
        if (locationIds.length > 0) {
          const { data: locationData } = await supabase.from("kpi_5s_locations").select("id, ma_vi_tri, ten_vi_tri, phong_ban_id").in("id", locationIds)
          locationById = Object.fromEntries(((locationData || []) as LocationRef[]).map((l) => [l.id, l]))
        }
        setLocationRefs(Object.fromEntries(evalRows.map((e) => [e.id, { eval: e, location: locationById[e.location_id] || null }])))
      } else {
        setLocationRefs({})
      }

      const scoreIds = Array.from(new Set(appealRows.map((a) => a.monthly_score_id).filter((v): v is string => !!v)))
      if (scoreIds.length > 0) {
        const { data: scoreData } = await supabase.from("kpi_monthly_scores").select("id, nam, thang, diem_tong, trang_thai").in("id", scoreIds)
        setMonthlyScoreRefs(Object.fromEntries(((scoreData || []) as MonthlyScoreRef[]).map((s) => [s.id, s])))
      } else {
        setMonthlyScoreRefs({})
      }
    } catch (err) {
      setDataError(getKpiAppealErrorMessage(err, "Không tải được danh sách khiếu nại."))
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
  const resolveName = useCallback((uid: string | null) => (uid ? nameByUserId[uid] || "—" : "—"), [nameByUserId])

  const openResolve = (appeal: KpiAppeal, trangThai: "da_giai_quyet" | "tu_choi") => {
    setResolveTarget({ appeal, trangThai })
    setPhanHoi("")
    setResolveError("")
    const scoreRef = appeal.monthly_score_id ? monthlyScoreRefs[appeal.monthly_score_id] : null
    setResolveNewDiemTong(scoreRef?.diem_tong ?? 0)
    setResolveAdjustLyDo("")
  }

  // Phase 5: đóng "Đã giải quyết" cho khiếu nại điểm KPI tháng — điều chỉnh luôn điểm tổng
  // (kpi_score_adjustments), bắt buộc nhập lý do (CHECK NOT NULL ở tầng DB).
  const isMonthlyScoreAdjustment = resolveTarget?.trangThai === "da_giai_quyet" && !!resolveTarget.appeal.monthly_score_id

  const handleResolve = async () => {
    if (!resolveTarget || !user) return
    if (isMonthlyScoreAdjustment && !resolveAdjustLyDo.trim()) {
      setResolveError("Vui lòng nhập lý do điều chỉnh.")
      return
    }
    setResolving(true)
    setResolveError("")
    try {
      if (isMonthlyScoreAdjustment) {
        await resolveKpiMonthlyScoreAppeal({
          appealId: resolveTarget.appeal.id,
          monthlyScoreId: resolveTarget.appeal.monthly_score_id!,
          newDiemTong: resolveNewDiemTong,
          lyDo: resolveAdjustLyDo,
          ghiChu: phanHoi,
        })
      } else {
        await resolveKpiAppeal({
          id: resolveTarget.appeal.id,
          trangThai: resolveTarget.trangThai,
          phanHoi,
          nguoiXuLyId: user.id,
        })
      }
      sendKpiNotify({
        factoryId: factoryId || undefined,
        title: resolveTarget.trangThai === "da_giai_quyet" ? "Khiếu nại đã được giải quyết" : "Khiếu nại đã bị từ chối",
        lines: [
          `👤 Người khiếu nại: ${resolveName(resolveTarget.appeal.nguoi_khieu_nai_id)}`,
          `📝 Nội dung: ${resolveTarget.appeal.noi_dung}`,
          phanHoi.trim() ? `💬 Phản hồi: ${phanHoi.trim()}` : null,
        ].filter((l): l is string => !!l),
        link: "/dashboard/kpi/appeals",
      })
      setResolveTarget(null)
      if (factoryId && user) void loadData(factoryId, user.id)
    } catch (err) {
      setResolveError(getKpiAppealErrorMessage(err, "Không xử lý được khiếu nại."))
    } finally {
      setResolving(false)
    }
  }

  const openDecide = (appeal: KpiAppeal, approve: boolean) => {
    setDecideTarget({ appeal, approve })
    setDecideGhiChu("")
    setDecideError("")
  }

  const handleDecide = async () => {
    if (!decideTarget) return
    setDeciding(true)
    setDecideError("")
    try {
      await decideKpi5sAppealCorrection({ appealId: decideTarget.appeal.id, approve: decideTarget.approve, ghiChu: decideGhiChu })
      if (factoryId) {
        sendKpiNotify({
          factoryId,
          title: decideTarget.approve ? "Đề xuất sửa kết quả 5S đã được duyệt" : "Đề xuất sửa kết quả 5S bị từ chối",
          lines: [
            `👤 Người đề xuất: ${resolveName(decideTarget.appeal.proposed_by)}`,
            decideTarget.approve && decideTarget.appeal.proposed_ket_qua
              ? `✅ Kết quả mới: ${KPI_5S_RESULT_LABEL[decideTarget.appeal.proposed_ket_qua]}`
              : null,
            decideGhiChu.trim() ? `💬 Ghi chú: ${decideGhiChu.trim()}` : null,
          ].filter((l): l is string => !!l),
          link: "/dashboard/kpi/appeals",
        })
      }
      setDecideTarget(null)
      if (factoryId && user) void loadData(factoryId, user.id)
    } catch (err) {
      setDecideError(getKpiAppealErrorMessage(err, "Không xử lý được đề xuất."))
    } finally {
      setDeciding(false)
    }
  }

  const openPropose = (appeal: KpiAppeal, evalRef: LocationEvalRef) => {
    setProposeTarget({ appeal, eval: evalRef })
    setProposeKetQua(evalRef.ket_qua)
    setProposeLyDo(evalRef.ly_do || "")
    setProposeError("")
  }

  const handleSavePropose = async () => {
    if (!proposeTarget) return
    if (proposeKetQua !== "dat" && !proposeLyDo.trim()) {
      setProposeError(`Vui lòng nhập lý do khi kết quả đề xuất là ${KPI_5S_RESULT_LABEL[proposeKetQua]}.`)
      return
    }
    setProposeSaving(true)
    setProposeError("")
    try {
      await proposeKpi5sAppealCorrection({
        appealId: proposeTarget.appeal.id,
        newKetQua: proposeKetQua,
        newLyDo: proposeLyDo,
      })
      if (factoryId) {
        sendKpiNotify({
          factoryId,
          title: "Đề xuất sửa kết quả 5S — chờ duyệt",
          lines: [
            `📅 Tuần ${proposeTarget.eval.tuan_bat_dau} · Đề xuất: ${KPI_5S_RESULT_LABEL[proposeKetQua]}`,
          ],
          link: "/dashboard/kpi/appeals",
        })
      }
      setProposeTarget(null)
      if (factoryId && user) void loadData(factoryId, user.id)
    } catch (err) {
      setProposeError(getKpiAppealErrorMessage(err, "Không gửi được đề xuất sửa kết quả."))
    } finally {
      setProposeSaving(false)
    }
  }

  if (loading) return <div className="p-12 text-center text-slate-400">Đang tải...</div>

  const isAdmin = user?.role === "admin"
  // Mirror RLS kpi_appeals_update (migration 20260807_kpi_department_scoping.sql) — xử lý khiếu
  // nại là hành động kiểm duyệt chung, không scope theo phòng ban của bản ghi gốc.
  const canResolve = isAdmin || hasPermission(user, "kpi.manage_config")
  // Bước 3 — duyệt ĐỀ XUẤT sửa kết quả 5S: chỉ admin/kpi.manage_config HOẶC đúng lãnh đạo phòng
  // ban của vị trí đó (mirror kpi_appeal_decide_correction RLS). Trả false cho task/điểm tháng
  // (không có location_evaluation_id) — bước 2/3 chỉ áp dụng cho khiếu nại 5S.
  const canDecideAppeal = (a: KpiAppeal): boolean => {
    if (isAdmin || hasPermission(user, "kpi.manage_config")) return true
    if (!a.location_evaluation_id || !myLeaderDepartmentId) return false
    const deptId = locationRefs[a.location_evaluation_id]?.location?.phong_ban_id
    return !!deptId && deptId === myLeaderDepartmentId
  }

  return (
    <KpiShell>
      <div className="space-y-4">
        <div ref={revealRef} className="scroll-reveal flex items-center gap-3">
          <div className="hover-lift shrink-0 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-200 via-pink-100 to-rose-100 shadow-sm">
            <Flag size={20} className="text-rose-700" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Khiếu nại</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {canResolve
                ? "Toàn bộ khiếu nại trong nhà máy — xử lý bằng nút Đã giải quyết/Từ chối."
                : "Khiếu nại bạn đã gửi, hoặc khiếu nại về lần chấm điểm bạn phụ trách (đề xuất sửa kết quả tại đây)."}
            </p>
          </div>
        </div>

        {dataLoading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : dataError ? (
          <div className="bg-white rounded-2xl border border-red-200 p-8 text-center text-red-600">{dataError}</div>
        ) : appeals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">Chưa có khiếu nại nào.</div>
        ) : (
          <div className="space-y-3">
            {appeals.map((a) => {
              const taskRef = a.task_id ? taskRefs[a.task_id] : null
              const locationRef = a.location_evaluation_id ? locationRefs[a.location_evaluation_id] : null
              const scoreRef = a.monthly_score_id ? monthlyScoreRefs[a.monthly_score_id] : null
              return (
                <div key={a.id} className="hover-lift bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${KPI_APPEAL_STATUS_BADGE_CLASS[a.trang_thai]}`}>
                        {KPI_APPEAL_STATUS_LABEL[a.trang_thai]}
                      </span>
                      <div className="mt-1 text-xs text-slate-500">
                        {resolveName(a.nguoi_khieu_nai_id)} · {formatKpiDateTime(a.created_at)}
                      </div>
                    </div>
                    {a.trang_thai === "cho_xu_ly" && (
                      <div className="flex gap-1.5">
                        {/* Khiếu nại 5S ('cho_xu_ly' + location_evaluation_id): KHÔNG còn nút
                            "Đã giải quyết" tự sửa trực tiếp — phải chờ NGƯỜI CHẤM đề xuất kết quả
                            rồi mới duyệt ở đây (bước 3). Vẫn cho "Từ chối" thẳng nếu khiếu nại rõ
                            ràng không hợp lệ. */}
                        {canResolve && !a.location_evaluation_id && (
                          <button
                            onClick={() => openResolve(a, "da_giai_quyet")}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold"
                          >
                            <CheckCircle2 size={11} /> Đã giải quyết
                          </button>
                        )}
                        {/* Bước 2 — chỉ chính NGƯỜI CHẤM của đúng lần chấm đó mới thấy nút này,
                            không phụ thuộc canResolve (admin/kpi.manage_config). */}
                        {locationRef && locationRef.eval.nguoi_cham_id === user?.id && (
                          <button
                            onClick={() => openPropose(a, locationRef.eval)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-bold"
                          >
                            <ThumbsUp size={11} /> Đề xuất sửa kết quả
                          </button>
                        )}
                        {canResolve && (
                          <button
                            onClick={() => openResolve(a, "tu_choi")}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold"
                          >
                            <XCircle size={11} /> Từ chối
                          </button>
                        )}
                      </div>
                    )}
                    {a.trang_thai === "cho_duyet_sua" && canDecideAppeal(a) && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => openDecide(a, true)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold"
                        >
                          <CheckCircle2 size={11} /> Duyệt đề xuất
                        </button>
                        <button
                          onClick={() => openDecide(a, false)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold"
                        >
                          <XCircle size={11} /> Từ chối đề xuất
                        </button>
                      </div>
                    )}
                  </div>

                  {a.trang_thai === "cho_duyet_sua" && a.proposed_ket_qua && (
                    <div className="mt-2 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
                      <strong>Đề xuất của {resolveName(a.proposed_by)}:</strong> {KPI_5S_RESULT_LABEL[a.proposed_ket_qua]}
                      {a.proposed_ly_do && <> — {a.proposed_ly_do}</>}
                    </div>
                  )}

                  {(taskRef || locationRef || scoreRef) && (
                    <div className="mt-2 text-xs">
                      {taskRef && (
                        <Link href={`/dashboard/kpi/tasks/${taskRef.id}`} className="text-violet-600 hover:underline font-semibold">
                          Công việc: {taskRef.ma_cong_viec || taskRef.tieu_de}
                        </Link>
                      )}
                      {locationRef?.location && (
                        <Link href={`/dashboard/kpi/5s/location/${locationRef.location.id}`} className="text-violet-600 hover:underline font-semibold">
                          Vị trí 5S: {locationRef.location.ma_vi_tri} — tuần {locationRef.eval.tuan_bat_dau}
                        </Link>
                      )}
                      {scoreRef && (
                        <Link href="/dashboard/kpi/scores" className="text-violet-600 hover:underline font-semibold">
                          Điểm KPI tháng {scoreRef.thang}/{scoreRef.nam} (hiện {scoreRef.diem_tong ?? "—"} điểm)
                        </Link>
                      )}
                    </div>
                  )}

                  <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{a.noi_dung}</p>

                  {a.phan_hoi && (
                    <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <strong className="text-slate-700">Phản hồi từ {resolveName(a.nguoi_xu_ly_id)}:</strong> {a.phan_hoi}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {resolveTarget && (
        <ModalShell
          title={resolveTarget.trangThai === "da_giai_quyet" ? "Đánh dấu đã giải quyết" : "Từ chối khiếu nại"}
          onClose={() => setResolveTarget(null)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setResolveTarget(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                onClick={() => void handleResolve()}
                disabled={resolving}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {resolving ? "Đang lưu..." : "Xác nhận"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{resolveTarget.appeal.noi_dung}</p>
            {isMonthlyScoreAdjustment && (
              <>
                <p className="text-xs text-slate-500">
                  Xác nhận lại điểm tổng chính thức của điểm tháng này — mặc định là điểm hiện
                  tại, đổi lại nếu khiếu nại đúng. Mọi thay đổi đều được ghi lại vào lịch sử điều
                  chỉnh.
                </p>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Điểm mới</label>
                  <input
                    type="number"
                    step="0.1"
                    value={resolveNewDiemTong}
                    onChange={(e) => setResolveNewDiemTong(Number(e.target.value))}
                    disabled={resolving}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Lý do điều chỉnh</label>
                  <textarea
                    value={resolveAdjustLyDo}
                    onChange={(e) => setResolveAdjustLyDo(e.target.value)}
                    rows={2}
                    disabled={resolving}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
                  />
                </div>
              </>
            )}
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Phản hồi (tuỳ chọn)</label>
              <textarea
                value={phanHoi}
                onChange={(e) => setPhanHoi(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
              />
            </div>
            {resolveError && <div className="text-xs font-semibold text-red-600">{resolveError}</div>}
          </div>
        </ModalShell>
      )}

      {decideTarget && (
        <ModalShell
          title={decideTarget.approve ? "Duyệt đề xuất sửa kết quả" : "Từ chối đề xuất sửa kết quả"}
          onClose={() => setDecideTarget(null)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setDecideTarget(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                onClick={() => void handleDecide()}
                disabled={deciding}
                className={`px-5 py-2.5 text-white font-bold rounded-xl shadow-md disabled:opacity-60 ${
                  decideTarget.approve ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {deciding ? "Đang lưu..." : decideTarget.approve ? "Duyệt — ghi đè kết quả" : "Từ chối"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            {decideTarget.appeal.proposed_ket_qua && (
              <p className="text-sm text-slate-600">
                Đề xuất của <strong>{resolveName(decideTarget.appeal.proposed_by)}</strong>:{" "}
                <strong>{KPI_5S_RESULT_LABEL[decideTarget.appeal.proposed_ket_qua]}</strong>
                {decideTarget.appeal.proposed_ly_do && <> — {decideTarget.appeal.proposed_ly_do}</>}
              </p>
            )}
            <p className="text-xs text-slate-500">
              {decideTarget.approve
                ? "Duyệt sẽ ghi đè NGAY kết quả chính thức của lần chấm này theo đúng đề xuất trên."
                : "Từ chối sẽ giữ nguyên kết quả gốc, không thay đổi gì."}
            </p>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú (tuỳ chọn)</label>
              <textarea
                value={decideGhiChu}
                onChange={(e) => setDecideGhiChu(e.target.value)}
                rows={2}
                disabled={deciding}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
              />
            </div>
            {decideError && <div className="text-xs font-semibold text-red-600">{decideError}</div>}
          </div>
        </ModalShell>
      )}

      {proposeTarget && (
        <ModalShell
          title="Đề xuất sửa kết quả"
          onClose={() => setProposeTarget(null)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setProposeTarget(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                onClick={() => void handleSavePropose()}
                disabled={proposeSaving}
                className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {proposeSaving ? "Đang gửi..." : "Gửi đề xuất — chờ duyệt"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Tuần {proposeTarget.eval.tuan_bat_dau} — kết quả gốc:{" "}
              <strong>{KPI_5S_RESULT_LABEL[proposeTarget.eval.ket_qua]}</strong>. Đề xuất này CHƯA có hiệu lực ngay —
              lãnh đạo phòng ban (hoặc admin) sẽ duyệt/từ chối ngay tại danh sách này.
            </p>
            <Kpi5sResultPicker
              ketQua={proposeKetQua}
              onKetQuaChange={setProposeKetQua}
              lyDo={proposeLyDo}
              onLyDoChange={setProposeLyDo}
              disabled={proposeSaving}
            />
            {proposeError && <div className="text-xs font-semibold text-red-600">{proposeError}</div>}
          </div>
        </ModalShell>
      )}
    </KpiShell>
  )
}
