"use client"
/* eslint-disable @next/next/no-img-element */

// Chi tiết công việc — flow xử lý (thành viên: Cập nhật tiến độ/Nộp; người giao/admin:
// Nghiệm thu/Điều chỉnh/Trả về/Yêu cầu bổ sung) + timeline log bất biến.
// Xem đầy đủ kiến trúc/roadmap tại .claude/rules/27-kpi-module.md.

import { use, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ClipboardEdit,
  ExternalLink,
  FileText,
  Link2,
  MapPin,
  PenSquare,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { KpiShell } from "@/app/dashboard/kpi/_components/kpi-shell"
import { KpiEvidencePicker } from "../_components/kpi-evidence-picker"
import {
  cancelKpiTask,
  evaluateKpiTask,
  fetchKpiTaskDetail,
  fetchKpiTaskEvidenceLinks,
  formatKpiDateTime,
  getKpiErrorMessage,
  isTaskDueSoon,
  isTaskOpen,
  isTaskOverdue,
  KPI_ACTION_LABEL,
  KPI_REPORT_REQ_LABEL,
  KPI_STATUS_BADGE_CLASS,
  KPI_STATUS_LABEL,
  loadKpiTaskCandidates,
  submitKpiTaskProgress,
  type KpiTask,
  type KpiTaskCandidate,
  type KpiTaskEvidenceLink,
  type KpiTaskLog,
  type KpiTaskLogAction,
  type KpiTaskMember,
} from "@/lib/kpi-tasks"

type EvaluateAction = "nghiem_thu" | "dieu_chinh" | "tra_ve" | "yeu_cau_bo_sung"

const ACTION_ICON: Record<KpiTaskLogAction, typeof ClipboardEdit> = {
  cap_nhat_tien_do: ClipboardEdit,
  nop: Send,
  nghiem_thu: CheckCircle2,
  dieu_chinh: PenSquare,
  tra_ve: RotateCcw,
  yeu_cau_bo_sung: AlertTriangle,
  gan_ban_ghi: Link2,
}

function ProgressForm({
  factoryId,
  taskId,
  member,
  task,
  onDone,
}: {
  factoryId: string
  taskId: string
  member: KpiTaskMember
  task: KpiTask
  onDone: () => void
}) {
  const [tienDo, setTienDo] = useState(member.tien_do)
  const [noiDung, setNoiDung] = useState("")
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [fileUrls, setFileUrls] = useState<{ url: string; name: string }[]>([])
  const [viDo, setViDo] = useState<number | null>(null)
  const [kinhDo, setKinhDo] = useState<number | null>(null)
  const [diaDiemText, setDiaDiemText] = useState("")
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState<"cap_nhat_tien_do" | "nop" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const req = task.yeu_cau_bao_cao
  const missingReq =
    (req.includes("anh") && imageUrls.length === 0) ||
    (req.includes("file") && fileUrls.length === 0) ||
    (req.includes("dinh_vi") && viDo === null)

  const handleLocate = () => {
    if (!navigator.geolocation) {
      setError("Trình duyệt không hỗ trợ định vị.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setViDo(pos.coords.latitude)
        setKinhDo(pos.coords.longitude)
        setLocating(false)
      },
      () => {
        setError("Không lấy được vị trí — vui lòng cho phép quyền định vị.")
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handleSubmit = async (hanhDong: "cap_nhat_tien_do" | "nop") => {
    if (hanhDong === "cap_nhat_tien_do" && !noiDung.trim()) {
      setError("Vui lòng mô tả nội dung đã thực hiện.")
      return
    }
    setSaving(hanhDong)
    setError(null)
    try {
      await submitKpiTaskProgress({
        taskId,
        hanhDong,
        tienDo,
        noiDung,
        imageUrls,
        fileUrls: fileUrls.map((f) => f.url),
        viDo,
        kinhDo,
        diaDiemText: diaDiemText || null,
      })
      onDone()
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không lưu được."))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div className="text-sm font-extrabold text-slate-700">Cập nhật tiến độ của bạn</div>

      {req.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {req.map((r) => (
            <span key={r} className="px-2 py-0.5 rounded-lg bg-violet-50 text-violet-700 text-[11px] font-bold">
              Yêu cầu: {KPI_REPORT_REQ_LABEL[r]}
            </span>
          ))}
        </div>
      )}

      <div>
        <label className="text-xs font-bold text-slate-600 block mb-1.5">Tiến độ: {tienDo}%</label>
        <input type="range" min={0} max={100} value={tienDo} onChange={(e) => setTienDo(Number(e.target.value))} className="w-full accent-violet-600" />
      </div>

      <div>
        <label className="text-xs font-bold text-slate-600 block mb-1.5">Nội dung đã thực hiện *</label>
        <textarea
          value={noiDung}
          onChange={(e) => setNoiDung(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          placeholder="Mô tả những gì đã làm..."
        />
      </div>

      <KpiEvidencePicker
        factoryId={factoryId}
        taskId={taskId}
        imageUrls={imageUrls}
        onImagesChange={setImageUrls}
        fileUrls={fileUrls}
        onFilesChange={setFileUrls}
      />

      {req.includes("dinh_vi") && (
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Định vị</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLocate}
              disabled={locating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-600 disabled:opacity-50"
            >
              <MapPin size={12} /> {locating ? "Đang lấy..." : viDo !== null ? "Đã lấy vị trí" : "Lấy vị trí hiện tại"}
            </button>
            {viDo !== null && kinhDo !== null && (
              <span className="text-xs text-slate-500">
                {viDo.toFixed(5)}, {kinhDo.toFixed(5)}
              </span>
            )}
          </div>
          <input
            value={diaDiemText}
            onChange={(e) => setDiaDiemText(e.target.value)}
            placeholder="Ghi chú địa điểm (tuỳ chọn)"
            className="mt-1.5 w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs outline-none focus:border-violet-500"
          />
        </div>
      )}

      {missingReq && (
        <div className="text-xs font-semibold text-amber-600">
          Công việc yêu cầu kèm theo: {req.map((r) => KPI_REPORT_REQ_LABEL[r]).join(", ")} — bạn có thể vẫn lưu nhưng nên bổ sung đầy đủ.
        </div>
      )}
      {error && <div className="text-xs font-semibold text-red-600">{error}</div>}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={() => void handleSubmit("cap_nhat_tien_do")}
          disabled={saving !== null}
          className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-800 text-white text-sm font-bold disabled:opacity-60"
        >
          {saving === "cap_nhat_tien_do" ? "Đang lưu..." : "Cập nhật tiến độ"}
        </button>
        <button
          onClick={() => void handleSubmit("nop")}
          disabled={saving !== null}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-60"
        >
          <Send size={13} /> {saving === "nop" ? "Đang nộp..." : "Nộp"}
        </button>
      </div>
    </div>
  )
}

function EvaluateModal({
  taskId,
  action,
  memberUserId,
  memberName,
  currentTienDo,
  onClose,
  onDone,
}: {
  taskId: string
  action: EvaluateAction
  memberUserId: string
  memberName: string
  currentTienDo: number
  onClose: () => void
  onDone: () => void
}) {
  const [tienDo, setTienDo] = useState(currentTienDo)
  const [noiDung, setNoiDung] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsReason = action === "tra_ve" || action === "yeu_cau_bo_sung"
  const needsScore = action === "nghiem_thu" || action === "dieu_chinh"

  const titleMap: Record<EvaluateAction, string> = {
    nghiem_thu: "Nghiệm thu",
    dieu_chinh: "Điều chỉnh tiến độ",
    tra_ve: "Trả về",
    yeu_cau_bo_sung: "Yêu cầu bổ sung",
  }

  const handleConfirm = async () => {
    if (needsReason && !noiDung.trim()) {
      setError("Vui lòng nhập lý do/nội dung yêu cầu.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await evaluateKpiTask({
        taskId,
        memberUserId,
        hanhDong: action,
        tienDo: needsScore ? tienDo : null,
        noiDung,
      })
      onDone()
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không thực hiện được."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={`${titleMap[action]} — ${memberName}`}
      onClose={onClose}
      maxWidth="md"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
            Hủy
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={saving}
            className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
          >
            {saving ? "Đang lưu..." : "Xác nhận"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {needsScore && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">
              {action === "nghiem_thu" ? "Điểm nghiệm thu" : "Tiến độ điều chỉnh lại"}: {tienDo}%
            </label>
            <input type="range" min={0} max={100} value={tienDo} onChange={(e) => setTienDo(Number(e.target.value))} className="w-full accent-violet-600" />
          </div>
        )}
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">
            {needsReason ? "Lý do / nội dung yêu cầu *" : "Ghi chú (tuỳ chọn)"}
          </label>
          <textarea
            value={noiDung}
            onChange={(e) => setNoiDung(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          />
        </div>
        {error && <div className="text-xs font-semibold text-red-600">{error}</div>}
      </div>
    </ModalShell>
  )
}

export default function KpiTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = use(params)
  const router = useRouter()

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [task, setTask] = useState<KpiTask | null>(null)
  const [members, setMembers] = useState<KpiTaskMember[]>([])
  const [logs, setLogs] = useState<KpiTaskLog[]>([])
  const [evidenceLinks, setEvidenceLinks] = useState<KpiTaskEvidenceLink[]>([])
  const [candidates, setCandidates] = useState<KpiTaskCandidate[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const [evaluateTarget, setEvaluateTarget] = useState<{ action: EvaluateAction; memberUserId: string; memberName: string } | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelling, setCancelling] = useState(false)

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
      const [detail, candidateData, evidence] = await Promise.all([
        fetchKpiTaskDetail(taskId),
        loadKpiTaskCandidates(fid),
        fetchKpiTaskEvidenceLinks(taskId),
      ])
      setTask(detail.task)
      setMembers(detail.members)
      setLogs(detail.logs)
      setCandidates(candidateData.people)
      setEvidenceLinks(evidence)
    } catch (err) {
      setDataError(getKpiErrorMessage(err, "Không tải được công việc."))
    } finally {
      setDataLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const nameByUserId = useMemo(() => {
    const map: Record<string, string> = Object.fromEntries(candidates.map((c) => [c.userId, c.ten]))
    if (user) map[user.id] = user.full_name || user.username || map[user.id] || "Bạn"
    return map
  }, [candidates, user])

  const resolveName = useCallback((uid: string) => nameByUserId[uid] || `Người dùng ${uid.slice(0, 8)}`, [nameByUserId])

  if (loading || dataLoading) return <div className="p-12 text-center text-slate-400">Đang tải...</div>
  if (dataError || !task) {
    return (
      <KpiShell>
        <div className="bg-white rounded-2xl border border-red-200 p-8 text-center text-red-600">{dataError || "Không tìm thấy công việc."}</div>
      </KpiShell>
    )
  }

  const isAdmin = user?.role === "admin"
  const isOwner = !!user && (isAdmin || task.nguoi_giao_id === user.id)
  const myMember = members.find((m) => m.user_id === user?.id && m.is_active)
  const overdue = isTaskOverdue(task)
  const dueSoon = isTaskDueSoon(task)
  const open = isTaskOpen(task.trang_thai)

  const handleCancel = async () => {
    setCancelling(true)
    try {
      await cancelKpiTask(task.id)
      setShowCancelConfirm(false)
      if (factoryId) void loadData(factoryId)
    } catch (err) {
      alert(getKpiErrorMessage(err, "Không hủy được công việc."))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <KpiShell>
      <div className="space-y-4">
        <button onClick={() => router.push("/dashboard/kpi/tasks")} className="flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Quay lại danh sách
        </button>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
            <div>
              <span className="text-xs font-bold text-slate-400">{task.ma_cong_viec || "—"}</span>
              <h1 className="text-xl font-extrabold text-slate-800">{task.tieu_de}</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-xl text-xs font-bold ${KPI_STATUS_BADGE_CLASS[task.trang_thai]}`}>{KPI_STATUS_LABEL[task.trang_thai]}</span>
              {isOwner && open && (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 hover:bg-red-50 hover:text-red-600 text-xs font-bold text-slate-500"
                >
                  <Ban size={12} /> Hủy công việc
                </button>
              )}
            </div>
          </div>

          {task.mo_ta && <p className="text-sm text-slate-600 mb-3 whitespace-pre-wrap">{task.mo_ta}</p>}

          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-slate-400">Người giao</div>
              <div className="font-semibold text-slate-700">{resolveName(task.nguoi_giao_id)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Ngày giao</div>
              <div className="font-semibold text-slate-700">{task.ngay_giao}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Hạn hoàn thành</div>
              <div className={`font-semibold flex items-center gap-1 ${overdue ? "text-red-600" : dueSoon ? "text-amber-600" : "text-slate-700"}`}>
                {(overdue || dueSoon) && <AlertTriangle size={12} />}
                {formatKpiDateTime(task.han_hoan_thanh)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Yêu cầu báo cáo</div>
              <div className="font-semibold text-slate-700">
                {task.yeu_cau_bao_cao.length ? task.yeu_cau_bao_cao.map((r) => KPI_REPORT_REQ_LABEL[r]).join(", ") : "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-extrabold text-slate-700 mb-3">Người thực hiện</div>
          <div className="space-y-2">
            {members.map((m) => {
              const isMe = m.user_id === user?.id
              return (
                <div key={m.id} className={`rounded-xl border p-3 ${m.is_active ? "border-slate-100" : "border-slate-100 opacity-50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-700">{resolveName(m.user_id)}</span>
                      {isMe && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">Bạn</span>}
                      {!m.is_active && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500">Đã chuyển giao</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-500">Tự báo cáo: <strong className="text-slate-700">{m.tien_do}%</strong></span>
                      {m.tien_do_nghiem_thu !== null && (
                        <span className="text-emerald-600">Nghiệm thu: <strong>{m.tien_do_nghiem_thu}%</strong></span>
                      )}
                      {m.da_nop_luc && <span className="text-slate-400">Nộp lúc {formatKpiDateTime(m.da_nop_luc)}</span>}
                    </div>
                  </div>

                  {isOwner && open && m.is_active && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setEvaluateTarget({ action: "nghiem_thu", memberUserId: m.user_id, memberName: resolveName(m.user_id) })}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold"
                      >
                        <CheckCircle2 size={11} /> Nghiệm thu
                      </button>
                      <button
                        onClick={() => setEvaluateTarget({ action: "dieu_chinh", memberUserId: m.user_id, memberName: resolveName(m.user_id) })}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-bold"
                      >
                        <PenSquare size={11} /> Điều chỉnh
                      </button>
                      <button
                        onClick={() => setEvaluateTarget({ action: "tra_ve", memberUserId: m.user_id, memberName: resolveName(m.user_id) })}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold"
                      >
                        <RotateCcw size={11} /> Trả về
                      </button>
                      <button
                        onClick={() => setEvaluateTarget({ action: "yeu_cau_bo_sung", memberUserId: m.user_id, memberName: resolveName(m.user_id) })}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold"
                      >
                        <AlertTriangle size={11} /> Yêu cầu bổ sung
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {open && myMember && factoryId && (
          <ProgressForm factoryId={factoryId} taskId={task.id} member={myMember} task={task} onDone={() => factoryId && loadData(factoryId)} />
        )}

        {evidenceLinks.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div className="text-sm font-extrabold text-slate-700 mb-3 flex items-center gap-1.5">
              <Link2 size={14} className="text-violet-500" /> Bằng chứng gắn kèm
            </div>
            <div className="space-y-2">
              {evidenceLinks.map((link) => (
                <div key={link.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-700 truncate">{link.record_label}</div>
                    <div className="text-xs text-slate-400">
                      {resolveName(link.member_user_id)} · {formatKpiDateTime(link.created_at)} · {link.module_code}
                    </div>
                  </div>
                  {link.record_url && (
                    <a
                      href={link.record_url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold"
                    >
                      Xem <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-extrabold text-slate-700 mb-3 flex items-center gap-1.5">
            <Sparkles size={14} className="text-violet-500" /> Nhật ký xử lý
          </div>
          {logs.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">Chưa có hoạt động nào.</p>
          ) : (
            <div className="space-y-3">
              {logs.map((log) => {
                const Icon = ACTION_ICON[log.hanh_dong]
                return (
                  <div key={log.id} className="flex gap-3">
                    <div className="mt-0.5 shrink-0 h-7 w-7 rounded-full bg-violet-50 flex items-center justify-center">
                      <Icon size={13} className="text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-slate-700">{KPI_ACTION_LABEL[log.hanh_dong]}</span>
                        <span className="text-slate-400">bởi {resolveName(log.nguoi_thuc_hien_id)}</span>
                        {log.member_user_id !== log.nguoi_thuc_hien_id && (
                          <span className="text-slate-400">cho {resolveName(log.member_user_id)}</span>
                        )}
                        <span className="text-slate-300">·</span>
                        <span className="text-slate-400">{formatKpiDateTime(log.created_at)}</span>
                        {log.tien_do_sau !== null && log.tien_do_sau !== log.tien_do_truoc && (
                          <span className="text-violet-600 font-semibold">{log.tien_do_truoc ?? "—"}% → {log.tien_do_sau}%</span>
                        )}
                      </div>
                      {log.noi_dung && <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{log.noi_dung}</p>}
                      {(log.image_urls.length > 0 || log.file_urls.length > 0) && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {log.image_urls.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="" className="h-12 w-12 rounded-lg object-cover" />
                            </a>
                          ))}
                          {log.file_urls.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 text-[11px] font-semibold text-slate-600">
                              <FileText size={10} /> File {i + 1}
                            </a>
                          ))}
                        </div>
                      )}
                      {log.dia_diem_text || (log.vi_do !== null && log.kinh_do !== null) ? (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                          <MapPin size={10} />
                          {log.dia_diem_text}
                          {log.vi_do !== null && log.kinh_do !== null && ` (${log.vi_do.toFixed(5)}, ${log.kinh_do.toFixed(5)})`}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {evaluateTarget && (
        <EvaluateModal
          taskId={task.id}
          action={evaluateTarget.action}
          memberUserId={evaluateTarget.memberUserId}
          memberName={evaluateTarget.memberName}
          currentTienDo={members.find((m) => m.user_id === evaluateTarget.memberUserId)?.tien_do || 0}
          onClose={() => setEvaluateTarget(null)}
          onDone={() => {
            setEvaluateTarget(null)
            if (factoryId) void loadData(factoryId)
          }}
        />
      )}

      {showCancelConfirm && (
        <ModalShell
          title="Hủy công việc"
          onClose={() => setShowCancelConfirm(false)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setShowCancelConfirm(false)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Không
              </button>
              <button
                onClick={() => void handleCancel()}
                disabled={cancelling}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {cancelling ? "Đang hủy..." : "Xác nhận hủy"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">Công việc sẽ chuyển sang trạng thái Đã hủy và không thể tiếp tục xử lý. Bạn có chắc chắn?</p>
        </ModalShell>
      )}
    </KpiShell>
  )
}
