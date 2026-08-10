"use client"
/* eslint-disable @next/next/no-img-element */

// Chi tiết vị trí 5S — lịch sử Đạt/Không đạt công khai + form chấm điểm tuần này.
// Xem đầy đủ .claude/rules/27-kpi-module.md, mục "UI" (Phase 2 — Đánh giá 5S).

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { QRCodeSVG } from "qrcode.react"
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Flag,
  Loader2,
  MapPin,
  Pencil,
  Printer,
  Users,
} from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { formatWeekRangeLabel, getIsoWeekStart } from "@/lib/date-utils"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { KpiShell } from "@/app/dashboard/kpi/_components/kpi-shell"
import { Kpi5sResultPicker } from "@/app/dashboard/kpi/_components/kpi-5s-result-picker"
import {
  buildKpi5sLocationUrl,
  computeKpi5sNextDeadline,
  fetchKpi5sEvaluations,
  fetchKpi5sLocation,
  fetchLocationCleaners,
  formatKpi5sDeadlineLabel,
  getKpi5sErrorMessage,
  isKpi5sDeadlineDueSoon,
  isKpi5sDeadlineOverdue,
  KPI_5S_RESULT_BADGE_CLASS,
  KPI_5S_RESULT_LABEL,
  submitKpi5sEvaluation,
  type Kpi5sEvaluation,
  type Kpi5sLocation,
  type Kpi5sResult,
} from "@/lib/kpi-5s"
import { downloadKpi5sLocationBulkQrPdf } from "@/lib/kpi-5s-pdf"
import { loadKpiTaskCandidates, type KpiTaskCandidate } from "@/lib/kpi-tasks"
import { KPI_WEEKDAY_LABEL } from "@/lib/kpi-templates"
import { correctKpi5sEvaluationDirect, createKpiAppealForLocationEvaluation, getKpiAppealErrorMessage } from "@/lib/kpi-appeals"
import { sendKpiNotify } from "@/lib/kpi-notify"
import { Kpi5sImagePicker } from "../../_components/kpi-5s-image-picker"

export default function Kpi5sLocationDetailPage() {
  const params = useParams<{ id: string }>()
  const locationId = params.id
  const revealRef = useScrollReveal()

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [location, setLocation] = useState<Kpi5sLocation | null>(null)
  const [evaluations, setEvaluations] = useState<Kpi5sEvaluation[]>([])
  const [candidates, setCandidates] = useState<KpiTaskCandidate[]>([])
  const [cleanerIds, setCleanerIds] = useState<string[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [ketQua, setKetQua] = useState<Kpi5sResult>("dat")
  const [nguoiDonId, setNguoiDonId] = useState("")
  const [lyDo, setLyDo] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [printing, setPrinting] = useState(false)

  const [appealTarget, setAppealTarget] = useState<Kpi5sEvaluation | null>(null)
  const [appealNoiDung, setAppealNoiDung] = useState("")
  const [appealSaving, setAppealSaving] = useState(false)
  const [appealError, setAppealError] = useState("")
  const [appealSent, setAppealSent] = useState(false)

  // Bug 2: admin/kpi.manage_config tự sửa trực tiếp 1 kết quả 5S đã chấm (không qua khiếu nại
  // có sẵn) — dùng khi người chấm tự phát hiện chấm sai, báo ngoài luồng app.
  const [correctTarget, setCorrectTarget] = useState<Kpi5sEvaluation | null>(null)
  const [correctKetQua, setCorrectKetQua] = useState<Kpi5sResult>("dat")
  const [correctLyDo, setCorrectLyDo] = useState("")
  const [correctGhiChu, setCorrectGhiChu] = useState("")
  const [correctSaving, setCorrectSaving] = useState(false)
  const [correctError, setCorrectError] = useState("")

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

  const loadData = useCallback(async (fid: string) => {
    setDataLoading(true)
    setDataError(null)
    try {
      const [locationRow, evalRows, candidateData, cleanerRows] = await Promise.all([
        fetchKpi5sLocation(locationId),
        fetchKpi5sEvaluations(locationId),
        loadKpiTaskCandidates(fid),
        fetchLocationCleaners(locationId),
      ])
      setLocation(locationRow)
      setEvaluations(evalRows)
      setCandidates(candidateData.people)
      setCleanerIds(cleanerRows)
    } catch (err) {
      setDataError(getKpi5sErrorMessage(err, "Không tải được dữ liệu vị trí."))
    } finally {
      setDataLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const nameByUserId = useMemo(() => {
    const map: Record<string, string> = Object.fromEntries(candidates.map((c) => [c.userId, c.ten]))
    if (user) map[user.id] = user.full_name || user.username || map[user.id] || "Bạn"
    return map
  }, [candidates, user])
  const resolveName = useCallback((uid: string | null) => (uid ? nameByUserId[uid] || "—" : "— Chưa gán —"), [nameByUserId])

  const currentWeekStart = useMemo(() => getIsoWeekStart(), [])
  const currentWeekEvaluation = useMemo(
    () => evaluations.find((e) => e.tuan_bat_dau === currentWeekStart) || null,
    [evaluations, currentWeekStart],
  )
  const canEvaluateThisWeek = !!location?.is_active && user?.id === location?.nguoi_cham_id && !currentWeekEvaluation
  const isAdmin = user?.role === "admin"

  const deadline = useMemo(() => (location ? computeKpi5sNextDeadline(location) : null), [location])
  const hasEvaluatedThisWeek = !!currentWeekEvaluation
  const overdue = isKpi5sDeadlineOverdue(deadline, hasEvaluatedThisWeek)
  const dueSoon = isKpi5sDeadlineDueSoon(deadline, hasEvaluatedThisWeek)
  // Nhãn "Thứ X, HH:MM" hiển thị ngay cạnh QR (kể cả khi tuần này đã chấm xong) — khác badge
  // cảnh báo quá hạn/sắp hạn phía trên vốn chỉ hiện khi CHƯA chấm tuần này.
  const deadlineLabel = location ? formatKpi5sDeadlineLabel(location) : null

  // Đội ngũ dọn dẹp thực tế (Fix 4/5a) — ưu tiên bảng multi-select mới, fallback về
  // nguoi_don_id đơn nếu vị trí chưa từng được gán qua bảng mới. Khóa dropdown "chấm điểm" và
  // quyền tự báo cáo vào đúng danh sách này thay vì mở tự do cho toàn bộ nhân sự nhà máy.
  const effectiveCleanerIds = useMemo(
    () => (cleanerIds.length > 0 ? cleanerIds : location?.nguoi_don_id ? [location.nguoi_don_id] : []),
    [cleanerIds, location],
  )
  const iAmCleaner = !!user && effectiveCleanerIds.includes(user.id)
  const iAmScorer = !!user && user.id === location?.nguoi_cham_id
  const isAssigner = !!user && user.id === location?.assigned_by

  const openForm = () => {
    setKetQua("dat")
    setNguoiDonId(effectiveCleanerIds.length === 1 ? effectiveCleanerIds[0] : "")
    setLyDo("")
    setImages([])
    setSaveError("")
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!factoryId || !location || !user) return
    if (!nguoiDonId) {
      setSaveError("Vui lòng chọn người chịu trách nhiệm dọn tuần này.")
      return
    }
    if (images.length === 0) {
      setSaveError("Vui lòng chụp/tải lên ít nhất 1 ảnh minh chứng.")
      return
    }
    if (ketQua !== "dat" && !lyDo.trim()) {
      setSaveError(`Vui lòng nhập lý do khi chấm ${KPI_5S_RESULT_LABEL[ketQua]}.`)
      return
    }
    setSaving(true)
    setSaveError("")
    try {
      await submitKpi5sEvaluation({
        factory_id: factoryId,
        location_id: location.id,
        tuan_bat_dau: currentWeekStart,
        nguoi_don_id: nguoiDonId,
        nguoi_cham_id: user.id,
        ket_qua: ketQua,
        ly_do: ketQua !== "dat" ? lyDo.trim() : null,
        image_urls: images,
      })
      sendKpiNotify({
        factoryId,
        title: `Chấm điểm 5S — ${KPI_5S_RESULT_LABEL[ketQua]}`,
        lines: [
          `🧹 Vị trí: ${location.ma_vi_tri} — ${location.ten_vi_tri}`,
          `📅 Tuần ${formatWeekRangeLabel(currentWeekStart)} · Người dọn: ${resolveName(nguoiDonId)} · Người chấm: ${user.full_name || user.username || "—"}`,
          ketQua !== "dat" ? `📝 Lý do: ${lyDo.trim()}` : null,
        ].filter((l): l is string => !!l),
        link: `/dashboard/kpi/5s/location/${location.id}`,
      })
      setShowForm(false)
      void loadData(factoryId)
    } catch (err) {
      setSaveError(getKpi5sErrorMessage(err, "Không lưu được kết quả chấm điểm."))
    } finally {
      setSaving(false)
    }
  }

  const openAppeal = (e: Kpi5sEvaluation) => {
    setAppealTarget(e)
    setAppealNoiDung("")
    setAppealError("")
    setAppealSent(false)
  }

  const handleSendAppeal = async () => {
    if (!factoryId || !appealTarget || !user) return
    if (!appealNoiDung.trim()) {
      setAppealError("Vui lòng nhập nội dung khiếu nại.")
      return
    }
    setAppealSaving(true)
    setAppealError("")
    try {
      await createKpiAppealForLocationEvaluation({
        factoryId,
        locationEvaluationId: appealTarget.id,
        nguoiKhieuNaiId: user.id,
        noiDung: appealNoiDung,
      })
      sendKpiNotify({
        factoryId,
        title: "Khiếu nại mới",
        lines: [
          `🧹 Vị trí 5S: ${location?.ma_vi_tri || ""} — tuần ${formatWeekRangeLabel(appealTarget.tuan_bat_dau)}`,
          `👤 ${user.full_name || user.username || "Người dùng"}: ${appealNoiDung.trim()}`,
        ],
        link: "/dashboard/kpi/appeals",
      })
      setAppealSent(true)
    } catch (err) {
      setAppealError(getKpiAppealErrorMessage(err, "Không gửi được khiếu nại."))
    } finally {
      setAppealSaving(false)
    }
  }

  const openCorrect = (e: Kpi5sEvaluation) => {
    setCorrectTarget(e)
    setCorrectKetQua(e.ket_qua)
    setCorrectLyDo(e.ly_do || "")
    setCorrectGhiChu("")
    setCorrectError("")
  }

  const handleSaveCorrect = async () => {
    if (!correctTarget) return
    if (correctKetQua !== "dat" && !correctLyDo.trim()) {
      setCorrectError(`Vui lòng nhập lý do khi kết quả là ${KPI_5S_RESULT_LABEL[correctKetQua]}.`)
      return
    }
    setCorrectSaving(true)
    setCorrectError("")
    try {
      await correctKpi5sEvaluationDirect({
        locationEvaluationId: correctTarget.id,
        newKetQua: correctKetQua,
        newLyDo: correctLyDo,
        ghiChu: correctGhiChu,
      })
      setCorrectTarget(null)
      if (factoryId) void loadData(factoryId)
    } catch (err) {
      setCorrectError(getKpiAppealErrorMessage(err, "Không sửa được kết quả."))
    } finally {
      setCorrectSaving(false)
    }
  }

  // Nút "Nhắc nhở" thủ công — chỉ Telegram, không có cơ chế tự động (repo không có hạ tầng
  // cron). Khoá tạm 45s sau khi bấm (chỉ state cục bộ, không ghi DB) để tránh gửi trùng.
  const [remindCooldown, setRemindCooldown] = useState(false)
  const handleRemindLocation = () => {
    if (!factoryId || !location) return
    sendKpiNotify({
      factoryId,
      title: "Nhắc nhở chấm điểm 5S",
      lines: [
        `🧹 Vị trí: ${location.ma_vi_tri} — ${location.ten_vi_tri}`,
        `👤 Người chấm: ${resolveName(location.nguoi_cham_id)}`,
        `📅 Tuần này (${formatWeekRangeLabel(currentWeekStart)}) chưa có bản chấm${overdue ? " — ĐÃ QUÁ HẠN" : ""}.`,
      ],
      link: `/dashboard/kpi/5s/location/${location.id}`,
    })
    setRemindCooldown(true)
    setTimeout(() => setRemindCooldown(false), 45_000)
  }

  const handlePrintQr = async () => {
    if (!location) return
    setPrinting(true)
    try {
      await downloadKpi5sLocationBulkQrPdf([location])
    } catch {
      // Lỗi hiếm (font/QR lib) — không chặn xem trang, chỉ bỏ qua êm vì đã có QR hiển thị sẵn.
    } finally {
      setPrinting(false)
    }
  }

  if (loading) return <div className="p-12 text-center text-slate-400">Đang tải...</div>

  const canCorrectResult = user?.role === "admin" || hasPermission(user, "kpi.manage_config")

  return (
    <KpiShell>
      <div className="space-y-4">
        <Link href="/dashboard/kpi/5s" className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-violet-600">
          <ArrowLeft size={14} /> Danh sách vị trí 5S
        </Link>

        {dataLoading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : dataError ? (
          <div className="bg-white rounded-2xl border border-red-200 p-8 text-center text-red-600">{dataError}</div>
        ) : !location ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
            Không tìm thấy vị trí 5S này.
          </div>
        ) : (
          <>
            <div ref={revealRef} className="scroll-reveal hover-lift bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-violet-50 text-violet-700">{location.ma_vi_tri}</span>
                  {!location.is_active && <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-200 text-slate-500">Tạm ngưng</span>}
                  {iAmCleaner && <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-sky-100 text-sky-700">Bạn thuộc đội dọn dẹp</span>}
                  {iAmScorer && <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-700">Bạn là người chấm</span>}
                  {deadline && !hasEvaluatedThisWeek && (
                    <span
                      className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-lg ${
                        overdue ? "bg-red-100 text-red-700" : dueSoon ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {(overdue || dueSoon) && <AlertTriangle size={11} />}
                      {overdue ? "Quá hạn — " : ""}Hạn: {KPI_WEEKDAY_LABEL[location!.deadline_weekdays![0]]}, {location!.deadline_time!.slice(0, 5)}
                    </span>
                  )}
                </div>
                <h1 className="text-xl font-extrabold text-slate-800 mt-1">{location.ten_vi_tri}</h1>
                {location.mo_ta && (
                  <div className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                    <MapPin size={13} /> {location.mo_ta}
                  </div>
                )}
                <div className="mt-2 space-y-0.5 text-sm text-slate-600">
                  <div className="flex items-start gap-1">
                    <Users size={13} className="mt-0.5 shrink-0 text-slate-400" />
                    Đội ngũ dọn dẹp:{" "}
                    <strong className="text-slate-800">
                      {effectiveCleanerIds.length > 0 ? effectiveCleanerIds.map((uid) => resolveName(uid)).join(", ") : "— Chưa gán —"}
                    </strong>
                  </div>
                  <div>Người chấm hiện tại: <strong className="text-slate-800">{resolveName(location.nguoi_cham_id)}</strong></div>
                  <div>Người giao: <strong className="text-slate-800">{resolveName(location.assigned_by)}</strong></div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-2">
                <div className="hover-lift rounded-xl border border-amber-100 bg-gradient-to-br from-white to-amber-50/60 p-2">
                  <QRCodeSVG value={buildKpi5sLocationUrl(location.id)} size={96} />
                </div>
                {deadlineLabel ? (
                  <div className="flex items-center gap-1 text-[11px] font-bold text-amber-700">
                    <AlertTriangle size={11} /> Hạn chấm: {deadlineLabel}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">Chưa cấu hình hạn chấm</div>
                )}
                <button
                  onClick={() => void handlePrintQr()}
                  disabled={printing}
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-violet-600 disabled:opacity-50"
                >
                  {printing ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />} Tải QR
                </button>
                {(isAdmin || isAssigner) && deadline && !hasEvaluatedThisWeek && (
                  <button
                    onClick={handleRemindLocation}
                    disabled={remindCooldown}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-amber-600 disabled:opacity-50"
                  >
                    <Bell size={12} /> {remindCooldown ? "Đã gửi nhắc nhở" : "Nhắc nhở ngay"}
                  </button>
                )}
              </div>
            </div>

            {canEvaluateThisWeek && !showForm && (
              <div
                className={`flex flex-wrap items-center gap-2 rounded-2xl border-2 p-3 shadow-md ${
                  overdue ? "border-red-400 bg-red-50" : "border-amber-400 bg-amber-50"
                }`}
              >
                <AlertTriangle size={18} className={`shrink-0 animate-pulse ${overdue ? "text-red-600" : "text-amber-600"}`} />
                <span className={`text-sm font-extrabold ${overdue ? "text-red-800" : "text-amber-800"}`}>
                  {overdue ? "Đã quá hạn — " : "Đến lượt bạn "}chấm điểm vị trí này ({formatWeekRangeLabel(currentWeekStart)})!
                </span>
                <button
                  onClick={openForm}
                  className={`ml-auto flex items-center gap-2 px-5 py-2.5 text-white font-bold rounded-xl shadow-md text-sm ${
                    overdue ? "bg-red-500 hover:bg-red-600" : "bg-amber-500 hover:bg-amber-600"
                  }`}
                >
                  <CheckCircle2 size={16} /> Chấm điểm ngay
                </button>
              </div>
            )}

            {!location.is_active && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
                Vị trí đang tạm ngưng — không thể chấm điểm.
              </div>
            )}
            {location.is_active && !currentWeekEvaluation && user?.id !== location.nguoi_cham_id && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                Tuần này chưa có bản chấm — chỉ <strong>{resolveName(location.nguoi_cham_id)}</strong> mới được chấm vị trí này.
              </div>
            )}
            {currentWeekEvaluation && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
                Tuần này ({formatWeekRangeLabel(currentWeekStart)}) đã được chấm: <strong>{KPI_5S_RESULT_LABEL[currentWeekEvaluation.ket_qua]}</strong>.
              </div>
            )}

            {showForm && (
              <div className="bg-white rounded-2xl border border-violet-200 shadow-sm p-5 space-y-3.5">
                <h2 className="text-sm font-extrabold text-slate-700">Chấm điểm tuần {formatWeekRangeLabel(currentWeekStart)}</h2>
                {saveError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{saveError}</div>}

                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Người chịu trách nhiệm dọn tuần này *</label>
                  {effectiveCleanerIds.length === 1 ? (
                    <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                      {resolveName(effectiveCleanerIds[0])}
                    </div>
                  ) : effectiveCleanerIds.length > 1 ? (
                    <select
                      value={nguoiDonId}
                      onChange={(e) => setNguoiDonId(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500"
                    >
                      <option value="">— Chọn người trong đội ngũ dọn dẹp —</option>
                      {effectiveCleanerIds.map((uid) => (
                        <option key={uid} value={uid}>{resolveName(uid)}</option>
                      ))}
                    </select>
                  ) : isAdmin ? (
                    <>
                      <select
                        value={nguoiDonId}
                        onChange={(e) => setNguoiDonId(e.target.value)}
                        className="w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none focus:border-amber-500"
                      >
                        <option value="">— Chọn người (chưa gán đội ngũ) —</option>
                        {candidates.map((c) => (
                          <option key={c.userId} value={c.userId}>{c.ten}</option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] font-semibold text-amber-600">
                        Vị trí này chưa gán đội ngũ dọn dẹp — chỉ admin thấy được lựa chọn dự phòng
                        này. Vào Cài đặt → KPI &amp; 5S → Vị trí 5S để gán đội ngũ chính thức.
                      </p>
                    </>
                  ) : (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      Vị trí này chưa được gán đội ngũ dọn dẹp — liên hệ Admin để gán trước khi chấm điểm.
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">
                    Chỉ chọn được trong số người đã được gán làm đội ngũ dọn dẹp của vị trí này —
                    nếu người phụ trách đã đổi (đi tua/nghỉ), hãy cập nhật đội ngũ ở Cài đặt trước.
                  </p>
                </div>

                <Kpi5sResultPicker ketQua={ketQua} onKetQuaChange={setKetQua} lyDo={lyDo} onLyDoChange={setLyDo} disabled={saving} />

                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Ảnh minh chứng *</label>
                  <Kpi5sImagePicker factoryId={factoryId!} locationId={location.id} images={images} onChange={setImages} />
                  <p className="mt-1 text-[11px] text-slate-400">Bắt buộc chụp/tải lên ít nhất 1 ảnh trước khi lưu kết quả.</p>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setShowForm(false)}
                    className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={() => void handleSubmit()}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
                  >
                    {saving ? "Đang lưu..." : "Lưu kết quả"}
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 font-extrabold text-sm text-slate-700">
                Lịch sử chấm điểm ({evaluations.length})
              </div>
              {evaluations.length === 0 ? (
                <div className="p-10 text-center text-slate-400 text-sm">Chưa có lần chấm điểm nào.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {evaluations.map((e) => (
                    <div key={e.id} className="row-hover p-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-500">Tuần {formatWeekRangeLabel(e.tuan_bat_dau)}</span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${KPI_5S_RESULT_BADGE_CLASS[e.ket_qua]}`}>
                            {KPI_5S_RESULT_LABEL[e.ket_qua]}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          Người dọn: <strong className="text-slate-800">{resolveName(e.nguoi_don_id)}</strong> · Người chấm: <strong className="text-slate-800">{resolveName(e.nguoi_cham_id)}</strong>
                        </div>
                        {e.ly_do && (
                          <div className="mt-1 flex items-start gap-1 text-xs text-rose-600">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {e.ly_do}
                          </div>
                        )}
                        {e.image_urls.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {e.image_urls.map((url, i) => (
                              <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer">
                                <img src={url} alt={`Ảnh ${i + 1}`} className="h-12 w-12 rounded-lg object-cover" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {/* Bug 1 fix: chỉ người BỊ chấm (nguoi_don_id) mới khiếu nại — người chấm
                            không được khiếu nại về chính lần chấm do họ tạo ra. */}
                        {!!user && user.id === e.nguoi_don_id && (
                          <button
                            onClick={() => openAppeal(e)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-[11px] font-bold text-slate-500"
                          >
                            <Flag size={11} /> Khiếu nại
                          </button>
                        )}
                        {canCorrectResult && (
                          <button
                            onClick={() => openCorrect(e)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-violet-50 hover:text-violet-600 text-[11px] font-bold text-slate-500"
                          >
                            <Pencil size={11} /> Sửa kết quả
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {appealTarget && (
        <ModalShell
          title="Khiếu nại về lần chấm điểm này"
          onClose={() => setAppealTarget(null)}
          maxWidth="md"
          footer={
            !appealSent ? (
              <>
                <button onClick={() => setAppealTarget(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                  Hủy
                </button>
                <button
                  onClick={() => void handleSendAppeal()}
                  disabled={appealSaving}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
                >
                  {appealSaving ? "Đang gửi..." : "Gửi khiếu nại"}
                </button>
              </>
            ) : (
              <button onClick={() => setAppealTarget(null)} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md">
                Đóng
              </button>
            )
          }
        >
          {appealSent ? (
            <p className="text-sm text-emerald-700">
              Đã gửi khiếu nại — theo dõi trạng thái ở mục &quot;Khiếu nại&quot; trong menu KPI.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Về lần chấm tuần {formatWeekRangeLabel(appealTarget.tuan_bat_dau)}: <strong>{KPI_5S_RESULT_LABEL[appealTarget.ket_qua]}</strong>.
              </p>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Nội dung khiếu nại *</label>
                <textarea
                  value={appealNoiDung}
                  onChange={(e) => setAppealNoiDung(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-rose-500"
                  placeholder="Mô tả cụ thể vấn đề bạn muốn khiếu nại..."
                />
              </div>
              {appealError && <div className="text-xs font-semibold text-red-600">{appealError}</div>}
            </div>
          )}
        </ModalShell>
      )}

      {correctTarget && (
        <ModalShell
          title="Sửa kết quả lần chấm điểm này"
          onClose={() => setCorrectTarget(null)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setCorrectTarget(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                onClick={() => void handleSaveCorrect()}
                disabled={correctSaving}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {correctSaving ? "Đang lưu..." : "Lưu kết quả mới"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Tuần {formatWeekRangeLabel(correctTarget.tuan_bat_dau)} — kết quả gốc: <strong>{KPI_5S_RESULT_LABEL[correctTarget.ket_qua]}</strong>.
              Dùng khi được báo lỗi ngoài luồng app (chấm nhầm, khiếu nại đã xác minh...) — thao
              tác này tự ghi lại 1 dòng trong mục &quot;Khiếu nại&quot; làm bằng chứng.
            </p>
            <Kpi5sResultPicker
              ketQua={correctKetQua}
              onKetQuaChange={setCorrectKetQua}
              lyDo={correctLyDo}
              onLyDoChange={setCorrectLyDo}
              disabled={correctSaving}
            />
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú thêm (tuỳ chọn)</label>
              <textarea
                value={correctGhiChu}
                onChange={(e) => setCorrectGhiChu(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
                placeholder="Vd: đã xác minh qua ảnh thực tế..."
              />
            </div>
            {correctError && <div className="text-xs font-semibold text-red-600">{correctError}</div>}
          </div>
        </ModalShell>
      )}
    </KpiShell>
  )
}
