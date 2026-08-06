"use client"
/* eslint-disable @next/next/no-img-element */

// Chi tiết công việc — flow xử lý (thành viên: Cập nhật tiến độ/Nộp; người giao/admin:
// Nghiệm thu/Điều chỉnh/Trả về/Yêu cầu bổ sung) + timeline log bất biến.
// Xem đầy đủ kiến trúc/roadmap tại .claude/rules/27-kpi-module.md.

import { use, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardEdit,
  ExternalLink,
  FileText,
  Flag,
  Link2,
  MapPin,
  PenSquare,
  RotateCcw,
  Send,
  Sparkles,
  UserX,
  X,
} from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { KpiShell } from "@/app/dashboard/kpi/_components/kpi-shell"
import { KpiEvidencePicker } from "../_components/kpi-evidence-picker"
import { KpiProgressBar } from "@/app/dashboard/kpi/_components/kpi-progress-bar"
import { createKpiAppealForTask, getKpiAppealErrorMessage } from "@/lib/kpi-appeals"
import { fetchKpi5sLocation, type Kpi5sLocation } from "@/lib/kpi-5s"
import { sendKpiNotify } from "@/lib/kpi-notify"
import { useScrollReveal } from "@/lib/useScrollReveal"
import {
  averageTaskProgress,
  cancelKpiTask,
  cancelKpiTaskTransfer,
  computeChinhThreshold,
  evaluateKpiTask,
  extendKpiTaskDeadline,
  fetchKpiTaskDetail,
  fetchKpiTaskEvidenceLinks,
  fetchTaskTransfers,
  formatKpiDateTime,
  getKpiErrorMessage,
  daysOverdue,
  isTaskDueSoon,
  isTaskOpen,
  isTaskOverdue,
  KPI_ACTION_LABEL,
  KPI_REPORT_REQ_LABEL,
  KPI_STATUS_BADGE_CLASS,
  KPI_STATUS_LABEL,
  loadKpiTaskCandidates,
  requestKpiTaskTransfer,
  respondKpiTaskTransfer,
  submitKpiTaskProgress,
  type KpiTask,
  type KpiTaskCandidate,
  type KpiTaskEvidenceLink,
  type KpiTaskLog,
  type KpiTaskLogAction,
  type KpiTaskMember,
  type KpiTaskTransfer,
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
  chuyen_giao: ArrowRightLeft,
  gia_han: CalendarClock,
}

function ProgressForm({
  factoryId,
  taskId,
  member,
  task,
  actorName,
  onDone,
}: {
  factoryId: string
  taskId: string
  member: KpiTaskMember
  task: KpiTask
  actorName: string
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
      sendKpiNotify({
        factoryId,
        title: hanhDong === "nop" ? "Công việc đã được nộp" : "Cập nhật tiến độ công việc",
        lines: [
          `📋 ${task.tieu_de}${task.ma_cong_viec ? ` (${task.ma_cong_viec})` : ""}`,
          `👤 ${actorName} — tiến độ ${tienDo}%${noiDung.trim() ? `: ${noiDung.trim()}` : ""}`,
        ],
        link: `/dashboard/kpi/tasks/${taskId}`,
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
  factoryId,
  taskId,
  taskLabel,
  action,
  memberUserId,
  memberName,
  currentTienDo,
  onClose,
  onDone,
}: {
  factoryId: string
  taskId: string
  taskLabel: string
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
      sendKpiNotify({
        factoryId,
        title: `${titleMap[action]}: ${memberName}`,
        lines: [
          `📋 ${taskLabel}`,
          needsScore ? `📊 Điểm: ${tienDo}%` : null,
          noiDung.trim() ? `📝 ${noiDung.trim()}` : null,
        ].filter((l): l is string => !!l),
        link: `/dashboard/kpi/tasks/${taskId}`,
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

function TransferModal({
  factoryId,
  taskId,
  taskLabel,
  actorName,
  candidates,
  excludeUserIds,
  onClose,
  onDone,
}: {
  factoryId: string
  taskId: string
  taskLabel: string
  actorName: string
  candidates: KpiTaskCandidate[]
  excludeUserIds: string[]
  onClose: () => void
  onDone: () => void
}) {
  const options = useMemo(
    () => candidates.filter((c) => !excludeUserIds.includes(c.userId)),
    [candidates, excludeUserIds],
  )
  const [denNguoiId, setDenNguoiId] = useState("")
  const [ghiChu, setGhiChu] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    if (!denNguoiId) {
      setError("Vui lòng chọn người nhận.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await requestKpiTaskTransfer({ taskId, denNguoiId, ghiChu })
      const denNguoiName = options.find((o) => o.userId === denNguoiId)?.ten || denNguoiId
      sendKpiNotify({
        factoryId,
        title: "Yêu cầu chuyển giao công việc",
        lines: [`📋 ${taskLabel}`, `🔁 ${actorName} muốn chuyển giao cho ${denNguoiName}${ghiChu.trim() ? ` — "${ghiChu.trim()}"` : ""}`],
        link: `/dashboard/kpi/tasks/${taskId}`,
      })
      onDone()
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không gửi được yêu cầu chuyển giao."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Chuyển giao công việc"
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
            {saving ? "Đang gửi..." : "Gửi yêu cầu"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Người nhận phải chủ động chấp nhận thì việc mới thực sự chuyển — bạn vẫn là người phụ
          trách cho tới lúc đó. Mỗi việc chỉ chuyển giao được đúng 1 lần.
        </p>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Chuyển cho *</label>
          <select
            value={denNguoiId}
            onChange={(e) => setDenNguoiId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="">-- Chọn người nhận --</option>
            {options.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.ten}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú (tuỳ chọn)</label>
          <textarea
            value={ghiChu}
            onChange={(e) => setGhiChu(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            placeholder="VD: Mình đi công tác từ mai, nhờ bạn tiếp tục..."
          />
        </div>
        {error && <div className="text-xs font-semibold text-red-600">{error}</div>}
      </div>
    </ModalShell>
  )
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ExtendDeadlineModal({
  factoryId,
  taskId,
  taskLabel,
  currentDeadline,
  onClose,
  onDone,
}: {
  factoryId: string
  taskId: string
  taskLabel: string
  currentDeadline: string
  onClose: () => void
  onDone: () => void
}) {
  const [value, setValue] = useState(toDatetimeLocalValue(currentDeadline))
  const [lyDo, setLyDo] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    if (!value) {
      setError("Vui lòng chọn hạn hoàn thành mới.")
      return
    }
    if (!lyDo.trim()) {
      setError("Vui lòng nhập lý do đổi hạn.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const newIso = new Date(value).toISOString()
      await extendKpiTaskDeadline({ taskId, newHanHoanThanh: newIso, lyDo })
      sendKpiNotify({
        factoryId,
        title: "Gia hạn công việc",
        lines: [
          `📋 ${taskLabel}`,
          `⏰ Hạn cũ: ${formatKpiDateTime(currentDeadline)} → Hạn mới: ${formatKpiDateTime(newIso)}`,
          `📝 Lý do: ${lyDo.trim()}`,
        ],
        link: `/dashboard/kpi/tasks/${taskId}`,
      })
      onDone()
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không đổi được hạn hoàn thành."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Gia hạn công việc"
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
            {saving ? "Đang lưu..." : "Xác nhận gia hạn"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Hạn hiện tại: <strong>{formatKpiDateTime(currentDeadline)}</strong>. Mọi thành viên đang
          thực hiện sẽ thấy thay đổi này trong dòng thời gian của họ.
        </p>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Hạn hoàn thành mới *</label>
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Lý do đổi hạn *</label>
          <textarea
            value={lyDo}
            onChange={(e) => setLyDo(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            placeholder="VD: Chờ nguyên liệu, phát sinh sự cố..."
          />
        </div>
        {error && <div className="text-xs font-semibold text-red-600">{error}</div>}
      </div>
    </ModalShell>
  )
}

function AppealModal({
  factoryId,
  taskId,
  taskLabel,
  userId,
  actorName,
  onClose,
  onDone,
}: {
  factoryId: string
  taskId: string
  taskLabel: string
  userId: string
  actorName: string
  onClose: () => void
  onDone: () => void
}) {
  const [noiDung, setNoiDung] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    if (!noiDung.trim()) {
      setError("Vui lòng nhập nội dung khiếu nại.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createKpiAppealForTask({ factoryId, taskId, nguoiKhieuNaiId: userId, noiDung })
      sendKpiNotify({
        factoryId,
        title: "Khiếu nại mới",
        lines: [`📋 ${taskLabel}`, `👤 ${actorName}: ${noiDung.trim()}`],
        link: "/dashboard/kpi/appeals",
      })
      onDone()
    } catch (err) {
      setError(getKpiAppealErrorMessage(err, "Không gửi được khiếu nại."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Khiếu nại về công việc này"
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
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
          >
            {saving ? "Đang gửi..." : "Gửi khiếu nại"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Khiếu nại sẽ được gửi tới người quản trị để xem xét — bạn có thể theo dõi trạng thái ở
          mục &quot;Khiếu nại&quot; trong menu KPI.
        </p>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Nội dung *</label>
          <textarea
            value={noiDung}
            onChange={(e) => setNoiDung(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-rose-500"
            placeholder="Mô tả cụ thể vấn đề bạn muốn khiếu nại..."
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
  const revealRef = useScrollReveal()

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [task, setTask] = useState<KpiTask | null>(null)
  const [members, setMembers] = useState<KpiTaskMember[]>([])
  const [logs, setLogs] = useState<KpiTaskLog[]>([])
  const [evidenceLinks, setEvidenceLinks] = useState<KpiTaskEvidenceLink[]>([])
  const [candidates, setCandidates] = useState<KpiTaskCandidate[]>([])
  const [transfers, setTransfers] = useState<KpiTaskTransfer[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const [evaluateTarget, setEvaluateTarget] = useState<{ action: EvaluateAction; memberUserId: string; memberName: string } | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferBusyId, setTransferBusyId] = useState<string | null>(null)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [showExtendModal, setShowExtendModal] = useState(false)
  const [showAppealModal, setShowAppealModal] = useState(false)
  // Việc đột xuất 5S — resolve tên vị trí liên quan (nếu có) để hiện badge/link ở trang chi tiết.
  const [linkedLocation, setLinkedLocation] = useState<Kpi5sLocation | null>(null)
  // Nút "Nhắc nhở" thủ công — chỉ Telegram, không có cơ chế tự động (repo không có hạ tầng
  // cron). Khoá tạm 45s sau khi bấm (chỉ state cục bộ, không ghi DB) để tránh gửi trùng do
  // double-click, không phải chống spam thật sự.
  const [remindCooldown, setRemindCooldown] = useState(false)

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
      const [detail, candidateData, evidence, transferRows] = await Promise.all([
        fetchKpiTaskDetail(taskId),
        loadKpiTaskCandidates(fid),
        fetchKpiTaskEvidenceLinks(taskId),
        fetchTaskTransfers(taskId),
      ])
      setTask(detail.task)
      setMembers(detail.members)
      setLogs(detail.logs)
      setCandidates(candidateData.people)
      setEvidenceLinks(evidence)
      setTransfers(transferRows)
    } catch (err) {
      setDataError(getKpiErrorMessage(err, "Không tải được công việc."))
    } finally {
      setDataLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  useEffect(() => {
    let alive = true
    if (!task?.kpi_5s_location_id) {
      setLinkedLocation(null)
      return
    }
    fetchKpi5sLocation(task.kpi_5s_location_id)
      .then((loc) => { if (alive) setLinkedLocation(loc) })
      .catch(() => { if (alive) setLinkedLocation(null) })
    return () => { alive = false }
  }, [task?.kpi_5s_location_id])

  // Bằng chứng có thể được gắn từ MODULE KHÁC (Điều xe/Sản lượng/Kiểm nghiệm...), không phải
  // từ chính trang này — nếu người xem để tab này mở nền rồi quay lại, dữ liệu cũ trong state
  // sẽ không tự đổi trừ khi refetch. Refetch nhẹ mỗi khi tab quay lại visible/focus.
  useEffect(() => {
    if (!factoryId) return
    const handleFocus = () => {
      if (document.visibilityState === "visible") void loadData(factoryId)
    }
    document.addEventListener("visibilitychange", handleFocus)
    window.addEventListener("focus", handleFocus)
    return () => {
      document.removeEventListener("visibilitychange", handleFocus)
      window.removeEventListener("focus", handleFocus)
    }
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
  const overdueDays = daysOverdue(task)
  const open = isTaskOpen(task.trang_thai)

  // Việc mục tiêu số lượng chung — xem migration 20260725_kpi_task_quantity_target.sql.
  const evidenceCountByUser: Record<string, number> = {}
  for (const link of evidenceLinks) {
    evidenceCountByUser[link.member_user_id] = (evidenceCountByUser[link.member_user_id] || 0) + 1
  }
  const chinhThreshold = task.muc_tieu_so_luong ? computeChinhThreshold(task.muc_tieu_so_luong) : null

  // Phase 1b — Chuyển giao việc: mỗi task có thể có nhiều yêu cầu đang chờ song song (mỗi
  // thành viên tự chuyển phần việc của mình), nhưng RPC chỉ cho tối đa 1 yêu cầu chưa xử lý
  // /1 thành viên. Map theo tu_nguoi_id để hiện đúng badge trên đúng dòng người đó.
  const pendingTransfers = transfers.filter((t) => t.trang_thai === "cho_duyet")
  const outgoingTransferByMember = new Map(pendingTransfers.map((t) => [t.tu_nguoi_id, t]))
  const myIncomingTransfer = pendingTransfers.find((t) => t.den_nguoi_id === user?.id)

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

  const handleRespondTransfer = async (transferId: string, chapNhan: boolean) => {
    setTransferBusyId(transferId)
    setTransferError(null)
    try {
      await respondKpiTaskTransfer({ transferId, chapNhan })
      sendKpiNotify({
        factoryId: factoryId || undefined,
        title: chapNhan ? "Đã nhận chuyển giao công việc" : "Đã từ chối chuyển giao công việc",
        lines: [
          `📋 ${task.tieu_de}${task.ma_cong_viec ? ` (${task.ma_cong_viec})` : ""}`,
          `👤 ${user?.full_name || user?.username || "Người dùng"} ${chapNhan ? "đã chấp nhận" : "đã từ chối"} lời mời chuyển giao.`,
        ],
        link: `/dashboard/kpi/tasks/${task.id}`,
      })
      if (factoryId) void loadData(factoryId)
    } catch (err) {
      setTransferError(getKpiErrorMessage(err, "Không xử lý được yêu cầu chuyển giao."))
    } finally {
      setTransferBusyId(null)
    }
  }

  const handleRemind = () => {
    sendKpiNotify({
      factoryId: factoryId || undefined,
      title: "Nhắc nhở công việc",
      lines: [
        `📋 ${task.tieu_de}${task.ma_cong_viec ? ` (${task.ma_cong_viec})` : ""}`,
        `👥 Người thực hiện: ${members.filter((m) => m.is_active).map((m) => resolveName(m.user_id)).join(", ") || "—"}`,
        `⏰ Hạn: ${formatKpiDateTime(task.han_hoan_thanh)}${overdue ? " — ĐÃ QUÁ HẠN" : ""}`,
      ],
      link: `/dashboard/kpi/tasks/${task.id}`,
    })
    setRemindCooldown(true)
    setTimeout(() => setRemindCooldown(false), 45_000)
  }

  const handleCancelTransfer = async (transferId: string) => {
    setTransferBusyId(transferId)
    setTransferError(null)
    try {
      await cancelKpiTaskTransfer(transferId)
      if (factoryId) void loadData(factoryId)
    } catch (err) {
      setTransferError(getKpiErrorMessage(err, "Không hủy được yêu cầu chuyển giao."))
    } finally {
      setTransferBusyId(null)
    }
  }

  return (
    <KpiShell>
      <div className="space-y-4">
        <button onClick={() => router.push("/dashboard/kpi/tasks")} className="flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Quay lại danh sách
        </button>

        <div ref={revealRef} className="scroll-reveal bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
            <div>
              <span className="text-xs font-bold text-slate-400">{task.ma_cong_viec || "—"}</span>
              <h1 className="text-xl font-extrabold text-slate-800">{task.tieu_de}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-3 py-1 rounded-xl text-xs font-bold ${KPI_STATUS_BADGE_CLASS[task.trang_thai]}`}>{KPI_STATUS_LABEL[task.trang_thai]}</span>
              {!!myMember && <span className="px-2.5 py-1 rounded-xl text-xs font-bold bg-sky-100 text-sky-700">Việc được giao cho bạn</span>}
              {isOwner && task.nguoi_giao_id === user?.id && (
                <span className="px-2.5 py-1 rounded-xl text-xs font-bold bg-violet-100 text-violet-700">Bạn là người giao</span>
              )}
              {!!user && (isOwner || !!myMember) && (
                <button
                  onClick={() => setShowAppealModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-xs font-bold text-slate-500"
                >
                  <Flag size={12} /> Khiếu nại
                </button>
              )}
              {isOwner && open && (
                <button
                  onClick={handleRemind}
                  disabled={remindCooldown}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 hover:bg-amber-50 hover:text-amber-600 text-xs font-bold text-slate-500 disabled:opacity-50"
                >
                  <Bell size={12} /> {remindCooldown ? "Đã gửi nhắc nhở" : "Nhắc nhở ngay"}
                </button>
              )}
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

          {task.mo_ta && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">Ghi chú / Hướng dẫn thực hiện</div>
              <p className="text-sm text-amber-900 whitespace-pre-wrap">{task.mo_ta}</p>
            </div>
          )}

          {linkedLocation && (
            <Link
              href={`/dashboard/kpi/5s/location/${linkedLocation.id}`}
              className="mb-3 inline-flex items-center gap-1.5 rounded-xl bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-200"
            >
              <MapPin size={12} /> Vị trí 5S liên quan: {linkedLocation.ma_vi_tri} — {linkedLocation.ten_vi_tri}
            </Link>
          )}

          {!!task.before_image_urls?.length && (
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Ảnh hiện trạng lúc giao việc (before)
              </div>
              <div className="flex flex-wrap gap-2">
                {task.before_image_urls.map((url, i) => (
                  <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={`Ảnh before ${i + 1}`} loading="lazy" className="h-16 w-16 rounded-lg object-cover shadow-sm" />
                  </a>
                ))}
              </div>
            </div>
          )}

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
              <div className={`font-semibold flex items-center gap-1 flex-wrap ${overdue ? "text-red-600" : dueSoon ? "text-amber-600" : "text-slate-700"}`}>
                {(overdue || dueSoon) && <AlertTriangle size={12} />}
                {formatKpiDateTime(task.han_hoan_thanh)}
                {overdueDays !== null && overdueDays > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                    Quá hạn {overdueDays} ngày
                  </span>
                )}
              </div>
              {isOwner && open && (
                <button
                  onClick={() => setShowExtendModal(true)}
                  className="mt-1 flex items-center gap-1 text-[11px] font-bold text-violet-600 hover:text-violet-700"
                >
                  <CalendarClock size={11} /> Gia hạn
                </button>
              )}
            </div>
            <div>
              <div className="text-xs text-slate-400">Yêu cầu báo cáo</div>
              <div className="font-semibold text-slate-700">
                {task.yeu_cau_bao_cao.length ? task.yeu_cau_bao_cao.map((r) => KPI_REPORT_REQ_LABEL[r]).join(", ") : "—"}
              </div>
            </div>
          </div>
        </div>

        {myIncomingTransfer && (
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-sm font-extrabold text-violet-800 mb-1.5">
              <ArrowRightLeft size={14} /> Lời mời chuyển giao công việc
            </div>
            <p className="text-sm text-violet-700">
              <strong>{resolveName(myIncomingTransfer.tu_nguoi_id)}</strong> muốn chuyển giao công
              việc này cho bạn, giữ nguyên tiến độ hiện tại{" "}
              <strong>{myIncomingTransfer.tien_do_luc_chuyen}%</strong>.
              {myIncomingTransfer.ghi_chu && (
                <>
                  {" "}
                  Ghi chú: <span className="italic">&quot;{myIncomingTransfer.ghi_chu}&quot;</span>
                </>
              )}
            </p>
            {transferError && <p className="text-xs font-semibold text-red-600 mt-2">{transferError}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => void handleRespondTransfer(myIncomingTransfer.id, true)}
                disabled={transferBusyId === myIncomingTransfer.id}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-60"
              >
                <CheckCircle2 size={14} /> {transferBusyId === myIncomingTransfer.id ? "Đang xử lý..." : "Chấp nhận"}
              </button>
              <button
                onClick={() => void handleRespondTransfer(myIncomingTransfer.id, false)}
                disabled={transferBusyId === myIncomingTransfer.id}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 text-sm font-bold disabled:opacity-60"
              >
                <X size={14} /> Từ chối
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-sm font-extrabold text-slate-700">Người thực hiện</div>
            {task.muc_tieu_so_luong !== null && (
              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${evidenceLinks.length >= task.muc_tieu_so_luong ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                Việc chung: {evidenceLinks.length}/{task.muc_tieu_so_luong}
              </span>
            )}
          </div>
          {task.muc_tieu_so_luong !== null && (
            <>
              {/* Thanh tiến độ TỔNG, cùng 1 số cho MỌI người xem (giao/chính/choàng) — tính từ
                  averageTaskProgress() (SUM tien_do các thành viên active), khớp đúng
                  evidenceLinks.length/muc_tieu_so_luong. Hiển thị độc lập với ProgressForm
                  (form đó chỉ dành cho thành viên tự cập nhật, đã ẩn ở task mục tiêu số lượng). */}
              <div className="mb-1">
                <KpiProgressBar percent={averageTaskProgress(task, members)} size="md" />
              </div>
              <p className="text-xs text-slate-400 mb-3">
                {averageTaskProgress(task, members)}% hoàn thành chung — Việc chung Hoàn thành
                khi tổng bằng chứng đạt đủ mục tiêu, không quan tâm ai đóng góp. Riêng người
                &quot;Chính&quot; có ngưỡng tối thiểu {chinhThreshold} — không đạt sẽ bị trừ điểm
                cá nhân dù việc chung đã xong.
              </p>
            </>
          )}
          <div className="space-y-2">
            {members.map((m) => {
              const isMe = m.user_id === user?.id
              const myEvidenceCount = evidenceCountByUser[m.user_id] || 0
              const outTransfer = outgoingTransferByMember.get(m.user_id)
              const canTransferOut = isMe && m.is_active && open && !task.da_chuyen_giao && !outTransfer
              return (
                <div key={m.id} className={`hover-lift rounded-xl border p-3 ${m.is_active ? "border-slate-100" : "border-slate-100 opacity-50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-700">{resolveName(m.user_id)}</span>
                      {isMe && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">Bạn</span>}
                      {m.phan_loai === "chinh" && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Chính</span>}
                      {m.phan_loai === "choang" && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">Choàng</span>}
                      {!m.is_active && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500">Đã chuyển giao</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {task.muc_tieu_so_luong !== null ? (
                        <span className="text-slate-500">
                          Đóng góp: <strong className="text-slate-700">{myEvidenceCount}</strong>
                          {m.phan_loai === "chinh" && chinhThreshold !== null && (
                            <span className="text-slate-400"> / {chinhThreshold} tối thiểu</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-500">Tự báo cáo: <strong className="text-slate-700">{m.tien_do}%</strong></span>
                      )}
                      {m.tien_do_nghiem_thu !== null && (
                        <span className={m.phan_loai === "chinh" && m.tien_do_nghiem_thu < 100 ? "text-red-600" : "text-emerald-600"}>
                          Điểm A: <strong>{m.tien_do_nghiem_thu}%</strong>
                        </span>
                      )}
                      {m.da_nop_luc && <span className="text-slate-400">Nộp lúc {formatKpiDateTime(m.da_nop_luc)}</span>}
                    </div>
                  </div>

                  {outTransfer && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-violet-600">
                      <ArrowRightLeft size={11} />
                      Đang chờ <strong>{resolveName(outTransfer.den_nguoi_id)}</strong> phản hồi lời mời chuyển giao
                      {isMe && (
                        <button
                          onClick={() => void handleCancelTransfer(outTransfer.id)}
                          disabled={transferBusyId === outTransfer.id}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-violet-200 hover:bg-violet-50 text-violet-600 font-bold disabled:opacity-60"
                        >
                          <UserX size={10} /> {transferBusyId === outTransfer.id ? "Đang hủy..." : "Hủy yêu cầu"}
                        </button>
                      )}
                    </div>
                  )}

                  {canTransferOut && (
                    <div className="mt-2">
                      <button
                        onClick={() => setShowTransferModal(true)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-[11px] font-bold"
                      >
                        <ArrowRightLeft size={11} /> Chuyển giao
                      </button>
                    </div>
                  )}

                  {isOwner && open && m.is_active && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {task.muc_tieu_so_luong === null ? (
                        <>
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
                        </>
                      ) : (
                        <span className="text-[11px] italic text-slate-400">
                          Điểm tự tính qua gắn bằng chứng — không nghiệm thu/điều chỉnh tay
                        </span>
                      )}
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

        {open && myMember && factoryId && task.muc_tieu_so_luong === null && (
          <ProgressForm
            factoryId={factoryId}
            taskId={task.id}
            member={myMember}
            task={task}
            actorName={user?.full_name || user?.username || "Thành viên"}
            onDone={() => factoryId && loadData(factoryId)}
          />
        )}

        {open && myMember && task.muc_tieu_so_luong !== null && (
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 text-sm text-violet-800">
            Việc này tính theo mục tiêu số lượng chung — không cần tự nhập %. Cứ thao tác bình
            thường ở đúng module nghiệp vụ rồi bấm &quot;Gắn &amp; hoàn thành&quot; ở banner xuất
            hiện sau khi lưu — tiến độ và điểm ở đây sẽ tự cập nhật theo.
          </div>
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

      {evaluateTarget && factoryId && (
        <EvaluateModal
          factoryId={factoryId}
          taskId={task.id}
          taskLabel={`${task.tieu_de}${task.ma_cong_viec ? ` (${task.ma_cong_viec})` : ""}`}
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

      {showTransferModal && factoryId && (
        <TransferModal
          factoryId={factoryId}
          taskId={task.id}
          taskLabel={`${task.tieu_de}${task.ma_cong_viec ? ` (${task.ma_cong_viec})` : ""}`}
          actorName={user?.full_name || user?.username || "Thành viên"}
          candidates={candidates}
          excludeUserIds={members.filter((m) => m.is_active).map((m) => m.user_id)}
          onClose={() => setShowTransferModal(false)}
          onDone={() => {
            setShowTransferModal(false)
            if (factoryId) void loadData(factoryId)
          }}
        />
      )}

      {showAppealModal && factoryId && user && (
        <AppealModal
          factoryId={factoryId}
          taskId={task.id}
          taskLabel={`${task.tieu_de}${task.ma_cong_viec ? ` (${task.ma_cong_viec})` : ""}`}
          userId={user.id}
          actorName={user.full_name || user.username || "Người dùng"}
          onClose={() => setShowAppealModal(false)}
          onDone={() => setShowAppealModal(false)}
        />
      )}

      {showExtendModal && factoryId && (
        <ExtendDeadlineModal
          factoryId={factoryId}
          taskId={task.id}
          taskLabel={`${task.tieu_de}${task.ma_cong_viec ? ` (${task.ma_cong_viec})` : ""}`}
          currentDeadline={task.han_hoan_thanh}
          onClose={() => setShowExtendModal(false)}
          onDone={() => {
            setShowExtendModal(false)
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
