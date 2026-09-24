"use client"

import { useCallback, useEffect, useRef, useState, Fragment } from "react"
import type { CSSProperties, RefObject } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft, Download, Upload, Eye, EyeOff, CheckCircle2, X,
  AlertTriangle, Loader2, FileText, Send, Pen, PenLine,
  RotateCcw, Settings, Clock, User, RefreshCcw, Info,
  ChevronLeft, ChevronRight, ChevronDown, Plus, LayoutTemplate,
  ArrowUp, ArrowDown, Trash2, Save, UserCheck, Share2,
  ShieldCheck, Bell,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import Draggable from "react-draggable"
import { Resizable } from "re-resizable"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession, hydrateActiveSession, hasPermission, type SessionUser } from "@/lib/auth"
import { fetchSecureUrl, openSecureFile } from "../../../_components/secure-file-open"
import { formatFactoryDateVN, formatFactoryDateTimeVN } from "@/lib/date-utils"
import {
  ResizeHandleIcon,
  RESIZE_HANDLE_CLASS,
  RESIZE_HANDLE_STYLE,
} from "../../../_components/resize-handle-icon"
import {
  SIGN_TEXT_FONT_FAMILY,
  SIGN_TEXT_FONT_SIZE_PT,
  SIGN_TEXT_MIN_FONT_SIZE_PT,
  computeDefaultSubLayout,
  computeDefaultNoteLayout,
  clampRectToBox,
  findRoleBoxForStep,
  type LayoutRect,
  type NoteSubLayout,
} from "@/lib/signing/template-layout"
import { computeSnugBoxSize } from "@/lib/signing/text-fit"
import { IsoShell } from "../../_components/iso-shell"
import { DistributionModal } from "../../_components/distribution-modal"
import { ModalShell } from "../../../_components/modal-shell"
import {
  fmtDate,
  fmtDateTime,
  formatIsoLogAction,
  cleanLogNote,
  LOAI_TAI_LIEU_LABEL,
  FORM_INSTANCE_STATUS_LABEL,
  FORM_INSTANCE_STATUS_COLOR,
  SIGN_AS_OPTIONS,
  SIGN_AS_LABEL,
  PHONG_BAN_OPTIONS,
  type IsoFormInstance,
  type IsoFormInstanceStatus,
  type IsoDocument,
  type SignAsType,
  type ThuTuKyStep,
  stepSignerUserId,
  stepDisplayLabel,
} from "../../_components/iso-types"

// ─── Types ───────────────────────────────────────────────────────────────────
type ProfileOption = { id: string; full_name: string | null; username: string | null }
type LogRow = { id: string; user_id: string; action: string; note: string | null; created_at: string }

type FullPlacement = {
  page: number
  x: number; y: number; width: number; height: number
  showSignature: boolean; showSignerName: boolean
  nameX: number; nameY: number; nameWidth: number; nameHeight: number
  // Khối CHỨC VỤ — khối kéo-thả thứ 3, độc lập hoàn toàn với chữ ký và tên (công tắc riêng,
  // vị trí riêng). `chucVuText` được lưu THẲNG vào placement thay vì tra lại lúc stamp: bước
  // `phe_duyet` của finalize/route.ts vẽ lại CẢ 3 placement (soạn thảo + xem xét + phê duyệt)
  // từ file gốc, nên chức vụ của 2 bước trước phải tự mang theo dữ liệu của chính nó.
  showChucVu?: boolean
  chucVuText?: string | null
  cvX?: number; cvY?: number; cvWidth?: number; cvHeight?: number
  // Ngày ký / Ghi chú — nội dung tự điền theo mẫu, mỗi thứ CHỈ gắn vào placement của ĐÚNG một
  // bước (ngày ký: phê duyệt; ghi chú: soạn thảo) để bước phê duyệt vẽ lại không chồng 3 lớp.
  ngayKyText?: string | null
  ngayKyX?: number; ngayKyY?: number; ngayKyWidth?: number; ngayKyHeight?: number
  ghiChuTat?: boolean
  ghiChuText?: string | null
  ghiChuX?: number; ghiChuY?: number; ghiChuWidth?: number; ghiChuHeight?: number
  kyNhayX?: number; kyNhayY?: number; kyNhayWidth?: number; kyNhayHeight?: number
  qrX?: number; qrY?: number; qrWidth?: number; qrHeight?: number
  // Hộp tiền tố ký thay (KT./TM./TL./TUQ.) — chỉ dùng ở bước Phê duyệt, chỉ áp
  // dụng cho PDF (không có khái niệm tương đương cho DOCX/XLSX).
  showPrefix?: boolean
  prefixX?: number; prefixY?: number; prefixWidth?: number; prefixHeight?: number
  extraPlacements?: Array<{
    page: number
    x: number; y: number; width: number; height: number
    showSignature: boolean; showSignerName: boolean
    nameX: number; nameY: number; nameWidth: number; nameHeight: number
  }>
}

type ElemState = { x: number; y: number; w: number; h: number }

// Đọc tiền tố ký thay để hiển thị trên timeline.
function signAsPrefixLabel(signAs: SignAsType | null | undefined): string {
  return signAs && signAs !== "none" ? `${signAs}. ` : ""
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function profileLabel(p: ProfileOption) { return p.full_name || p.username || p.id }

function urlIsPdf(url: string | null): boolean {
  if (!url) return false
  return url.split("?")[0].toLowerCase().endsWith(".pdf")
}

function StatusBadge({ status, inst }: { status: IsoFormInstanceStatus; inst?: IsoFormInstance | null }) {
  let label = FORM_INSTANCE_STATUS_LABEL[status] ?? status
  let color = FORM_INSTANCE_STATUS_COLOR[status] ?? "bg-slate-100 text-slate-600"

  if (inst) {
    const steps = Array.isArray(inst.thu_tu_ky_json) && inst.thu_tu_ky_json.length > 0 ? inst.thu_tu_ky_json : null
    const cur = inst.buoc_hien_tai ?? 0

    if (status === "da_phe_duyet") {
      const lastStepTen = steps ? steps[steps.length - 1]?.ten?.trim() : undefined
      label = lastStepTen
        ? (lastStepTen.toLowerCase().startsWith("phê duyệt") ? "Đã phê duyệt" : `Đã ${lastStepTen.toLowerCase()}`)
        : "Đã phê duyệt"
      color = "bg-emerald-100 text-emerald-700"
    } else if (status === "tra_ve") {
      label = "Bị trả về"
      color = "bg-rose-100 text-rose-700"
    } else if (status === "draft") {
      label = "Bản nháp"
      color = "bg-slate-100 text-slate-600"
    } else if (steps) {
      const currentStep = steps[cur]
      const stepName = currentStep?.ten?.trim()
      const isLast = cur >= steps.length - 1
      if (isLast) {
        label = stepName ? `Chờ ${stepName.toLowerCase()}` : "Chờ phê duyệt"
        color = "bg-emerald-100 text-emerald-800 border border-emerald-200"
      } else {
        label = stepName ? `Chờ ${stepName}` : `Chờ ký bước ${cur + 1}`
        color = "bg-amber-100 text-amber-800 border border-amber-200"
      }
    } else if (status === "cho_xem_xet") {
      label = "Chờ xem xét"
      color = "bg-amber-100 text-amber-800"
    } else if (status === "cho_phe_duyet") {
      label = "Chờ phê duyệt"
      color = "bg-emerald-100 text-emerald-800"
    }
  }

  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${color}`}>{label}</span>
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50/80 border border-slate-100 px-3 py-2">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-sm font-semibold text-slate-800 break-words">{value || "—"}</dd>
    </div>
  )
}

function TimelineStep({
  label,
  sublabel,
  done,
  pending,
  isMyTurn,
  at,
  stepNo,
  accentColor,
  isLast,
}: {
  label: string
  sublabel: string
  done: boolean
  pending?: boolean
  isMyTurn?: boolean
  at?: string | null
  stepNo?: number
  accentColor?: string
  isLast?: boolean
}) {
  const accent = accentColor || "#10b981"
  const connector = done
    ? "#a7f3d0"
    : pending
      ? "repeating-linear-gradient(to bottom,#fcd34d 0 4px,transparent 4px 8px)"
      : "#e2e8f0"

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!isLast && (
        <span
          className="absolute left-4 top-9 bottom-0 w-0.5 -translate-x-1/2 rounded"
          style={done || !pending ? { background: connector } : { backgroundImage: connector }}
        />
      )}

      <span
        className={`relative z-10 w-8 h-8 shrink-0 rounded-full grid place-items-center ring-4 ${
          done
            ? "bg-emerald-500 text-white ring-emerald-100"
            : isMyTurn
              ? "bg-amber-500 text-white ring-amber-200 animate-pulse"
              : pending
                ? "bg-white text-slate-500 border-2 border-slate-300 ring-slate-100"
                : "bg-white text-slate-300 border-2 border-dashed border-slate-200 ring-transparent"
        }`}
      >
        {done ? (
          <CheckCircle2 size={16} />
        ) : isMyTurn ? (
          <Bell size={14} />
        ) : stepNo ? (
          <span className="text-[11px] font-extrabold">{stepNo}</span>
        ) : (
          <Clock size={14} />
        )}
      </span>

      <div
        className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 ${
          done
            ? "border-emerald-100 bg-emerald-50/60"
            : isMyTurn
              ? "border-amber-200 bg-amber-50 shadow-sm"
              : pending
                ? "border-slate-200 bg-white"
                : "border-slate-200 border-dashed bg-slate-50/60"
        }`}
        style={{ borderLeft: `3px solid ${done || pending ? accent : `${accent}55`}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-bold ${done || isMyTurn ? "text-slate-800" : "text-slate-500"}`}>
            {label}
          </p>
          {done && (
            <span className="shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
              Đã ký
            </span>
          )}
          {pending && (
            <span
              className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isMyTurn ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              {isMyTurn ? "🔔 Đến lượt bạn" : "Đang chờ"}
            </span>
          )}
        </div>
        {sublabel && (
          <p className={`text-[13px] mt-0.5 ${done ? "text-slate-600" : isMyTurn ? "text-amber-700 font-semibold" : "text-slate-400"}`}>
            {sublabel}
          </p>
        )}
        {at && (
          <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            <Clock size={11} /> {fmtDate(at)}
          </p>
        )}
      </div>
    </li>
  )
}

// ─── WorkflowStepper ─────────────────────────────────────────────────────────
function WorkflowStepper({
  cap_tl,
  trang_thai,
  so_buoc_tong,
  buoc_hien_tai,
  thu_tu_ky_json,
}: {
  cap_tl: string
  trang_thai: IsoFormInstanceStatus
  so_buoc_tong?: number
  buoc_hien_tai?: number
  thu_tu_ky_json?: ThuTuKyStep[]
}) {
  const isReturned = trang_thai === "tra_ve"
  const isApproved = trang_thai === "da_phe_duyet"

  if ((so_buoc_tong || 0) > 0 && Array.isArray(thu_tu_ky_json) && thu_tu_ky_json.length > 0) {
    const curIdx = buoc_hien_tai ?? 0
    const stepItems = [
      ...thu_tu_ky_json.map((s, idx) => ({
        key: `step_${idx + 1}`,
        label: stepDisplayLabel(s) || `Bước ${idx + 1}`,
      })),
      { key: "da_phe_duyet", label: "Đã phê duyệt" },
    ]

    return (
      <div className="flex items-center gap-0 text-xs min-w-max">
        {stepItems.map((step, i) => {
          const isDone = isApproved || (!isReturned && i < curIdx)
          const isActive = !isReturned && !isApproved && (trang_thai === "draft" ? i === 0 : i === curIdx)
          return (
            <div key={step.key} className="flex items-center gap-0">
              <div className="flex flex-col items-center gap-0.5">
                <div
                  className={
                    "w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] border-2 " +
                    (isDone
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : isActive
                        ? "bg-violet-600 border-violet-600 text-white"
                        : "bg-white border-slate-300 text-slate-400")
                  }
                >
                  {isDone ? "✓" : i + 1}
                </div>
                <span
                  className={
                    "whitespace-nowrap " +
                    (isActive
                      ? "text-violet-700 font-bold"
                      : isDone
                        ? "text-emerald-600 font-semibold"
                        : "text-slate-400")
                  }
                >
                  {step.label}
                </span>
              </div>
              {i < stepItems.length - 1 && (
                <div className={"h-0.5 w-6 mb-3.5 " + (isDone ? "bg-emerald-400" : "bg-slate-200")} />
              )}
            </div>
          )
        })}
        {isReturned && (
          <div className="ml-2 px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-[10px] font-bold">
            Trả về
          </div>
        )}
      </div>
    )
  }

  // Legacy fallback (so_buoc_tong === 0)
  const stepsC1: { key: IsoFormInstanceStatus; label: string }[] = [
    { key: "draft", label: "Nháp" },
    { key: "cho_xem_xet", label: "Chờ xem xét" },
    { key: "cho_phe_duyet", label: "Chờ phê duyệt" },
    { key: "da_phe_duyet", label: "Đã phê duyệt" },
  ]
  const stepsC2: { key: IsoFormInstanceStatus; label: string }[] = [
    { key: "draft", label: "Nháp" },
    { key: "cho_phe_duyet", label: "Chờ phê duyệt" },
    { key: "da_phe_duyet", label: "Đã phê duyệt" },
  ]
  const steps = cap_tl === "Cấp 2" ? stepsC2 : stepsC1
  const activeIdx = steps.findIndex((s) => s.key === trang_thai)
  const effectiveIdx = activeIdx >= 0 ? activeIdx : (isReturned ? 0 : steps.length - 1)

  return (
    <div className="flex items-center gap-0 text-xs min-w-max">
      {steps.map((step, i) => {
        const isDone = i < effectiveIdx
        const isActive = i === effectiveIdx && !isReturned
        return (
          <div key={step.key} className="flex items-center gap-0">
            <div className="flex flex-col items-center gap-0.5">
              <div className={
                "w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] border-2 " +
                (isDone ? "bg-emerald-500 border-emerald-500 text-white" :
                  isActive ? "bg-violet-600 border-violet-600 text-white" :
                    "bg-white border-slate-300 text-slate-400")
              }>
                {isDone ? "✓" : i + 1}
              </div>
              <span className={
                "whitespace-nowrap " +
                (isActive ? "text-violet-700 font-bold" : isDone ? "text-emerald-600 font-semibold" : "text-slate-400")
              }>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={"h-0.5 w-6 mb-3.5 " + (isDone ? "bg-emerald-400" : "bg-slate-200")} />
            )}
          </div>
        )
      })}
      {isReturned && (
        <div className="ml-2 px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-[10px] font-bold">Trả về</div>
      )}
    </div>
  )
}

// ─── Return Modal ─────────────────────────────────────────────────────────────
function ReturnModal({ onConfirm, onClose }: { onConfirm: (lyDo: string) => void; onClose: () => void }) {
  const [lyDo, setLyDo] = useState("")
  const [err, setErr] = useState("")
  return (
    <ModalShell
      title="Trả về hồ sơ"
      onClose={onClose}
      maxWidth="sm"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
          <button
            onClick={() => { if (!lyDo.trim()) { setErr("Vui lòng nhập lý do"); return } onConfirm(lyDo) }}
            className="flex items-center gap-2 px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl"
          >
            Xác nhận trả về
          </button>
        </>
      }
    >
      <label className="text-xs font-bold text-slate-600 block mb-1.5">Lý do trả về</label>
      <textarea
        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-rose-400 resize-none mb-3"
        rows={3}
        value={lyDo}
        onChange={(e) => { setLyDo(e.target.value); setErr("") }}
        placeholder="Nhập lý do..."
        autoFocus
      />
      {err && <div className="mb-3 text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={12} />{err}</div>}
    </ModalShell>
  )
}

// ─── Đổi người ký Modal ───────────────────────────────────────────────────────
function DoiNguoiKyModal({
  steps,
  currentStepIndex,
  factoryId,
  allProfiles,
  onConfirm,
  onClose,
  saving,
}: {
  steps: ThuTuKyStep[]
  currentStepIndex: number
  factoryId: string
  allProfiles: ProfileOption[]
  onConfirm: (stepIndex: number, newUserId: string, newName: string, reason: string) => Promise<void>
  onClose: () => void
  saving: boolean
}) {
  // Chỉ cho phép đổi các bước từ currentStepIndex trở đi
  const editableSteps = steps
    .map((s, idx) => ({ step: s, idx }))
    .filter(({ idx }) => idx >= currentStepIndex)

  const [selectedStepIdx, setSelectedStepIdx] = useState<number>(editableSteps[0]?.idx ?? currentStepIndex)
  const [selectedDept, setSelectedDept] = useState<string>("")
  const [deptProfiles, setDeptProfiles] = useState<ProfileOption[]>([])
  const [loadingDept, setLoadingDept] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string>("")
  const [reason, setReason] = useState<string>("")
  const [err, setErr] = useState<string>("")

  // Khi selectedDept đổi, fetch nhân sự phòng ban đó
  useEffect(() => {
    if (!selectedDept) {
      setDeptProfiles(allProfiles)
      return
    }
    let alive = true
    setLoadingDept(true)
    fetch(`/api/documents/dept-users?factoryId=${factoryId}&dept=${encodeURIComponent(selectedDept)}&leadership=false`)
      .then((res) => res.json())
      .then((data: ProfileOption[]) => {
        if (alive && Array.isArray(data)) {
          setDeptProfiles(data)
        }
      })
      .catch((e) => console.error("Lỗi tải danh sách theo phòng ban:", e))
      .finally(() => {
        if (alive) setLoadingDept(false)
      })
    return () => { alive = false }
  }, [factoryId, selectedDept, allProfiles])

  const targetStep = steps[selectedStepIdx]
  const currentSignerName = targetStep?.ten || (targetStep?.user_id ? (allProfiles.find((p) => p.id === targetStep.user_id)?.full_name || targetStep.user_id) : "Chưa chỉ định")

  const handleSubmit = async () => {
    if (!selectedUserId) {
      setErr("Vui lòng chọn người ký thay thế")
      return
    }
    if (!reason.trim()) {
      setErr("Vui lòng nhập lý do thay đổi người ký")
      return
    }
    const profile = deptProfiles.find((p) => p.id === selectedUserId) || allProfiles.find((p) => p.id === selectedUserId)
    const newName = profile ? profileLabel(profile) : "Người ký mới"
    await onConfirm(selectedStepIdx, selectedUserId, newName, reason.trim())
  }

  return (
    <ModalShell
      title="Đổi người ký duyệt"
      onClose={onClose}
      maxWidth="md"
      footer={
        <>
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
            Hủy
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
            {saving ? "Đang xử lý..." : "Xác nhận đổi người ký"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {err && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium flex items-center gap-2">
            <AlertTriangle size={13} className="shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {/* Chọn bước muốn thay đổi */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">Bước ký cần thay đổi</label>
          <select
            value={selectedStepIdx}
            onChange={(e) => {
              const idx = Number(e.target.value)
              setSelectedStepIdx(idx)
              setSelectedUserId("")
            }}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
          >
            {editableSteps.map(({ step, idx }) => (
              <option key={idx} value={idx}>
                {stepDisplayLabel(step)} (Bước {idx + 1}) — Hiện tại: {step.ten || "Chưa có"}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            Người ký hiện tại: <span className="font-semibold text-slate-700">{currentSignerName}</span>
          </p>
        </div>

        {/* Chọn phòng ban */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">Lọc theo phòng ban</label>
          <select
            value={selectedDept}
            onChange={(e) => {
              setSelectedDept(e.target.value)
              setSelectedUserId("")
            }}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
          >
            <option value="">— Tất cả phòng ban —</option>
            {PHONG_BAN_OPTIONS.map((dept) => (
              <option key={dept} value={dept}>Phòng ban {dept}</option>
            ))}
          </select>
        </div>

        {/* Chọn người ký mới */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Người ký thay thế {loadingDept && <span className="text-[11px] text-violet-600 font-normal">(Đang tải danh sách...)</span>}
          </label>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            disabled={loadingDept}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:border-violet-500 disabled:opacity-50"
          >
            <option value="">— Chọn nhân sự thay thế —</option>
            {deptProfiles
              .filter((p) => p.id !== targetStep?.user_id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {profileLabel(p)} {p.username ? `(@${p.username})` : ""}
                </option>
              ))}
          </select>
        </div>

        {/* Lý do thay đổi */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Lý do thay đổi người ký <span className="text-rose-500">*</span>
          </label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Nhập lý do thay đổi (ví dụ: Người ký đi vắng, ủy quyền xử lý gấp...)"
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-800 outline-none focus:border-violet-500 resize-none"
          />
        </div>
      </div>
    </ModalShell>
  )
}

function ExtraDraggableBox({
  position,
  onDrag,
  onStop,
  zIndex = 12,
  children,
}: {
  position: { x: number; y: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDrag?: (e: any, d: { x: number; y: number }) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onStop?: (e: any, d: { x: number; y: number }) => void
  zIndex?: number
  children: React.ReactNode
}) {
  const nodeRef = useRef<HTMLDivElement>(null)
  return (
    <Draggable
      nodeRef={nodeRef as RefObject<HTMLElement>}
      position={position}
      onDrag={onDrag}
      onStop={onStop}
      bounds="parent"
      cancel={`.${RESIZE_HANDLE_CLASS},button,button *,a,.no-drag`}
    >
      <div ref={nodeRef} style={{ position: "absolute", top: 0, left: 0, zIndex, cursor: "move" }}>
        {children}
      </div>
    </Draggable>
  )
}

// ─── Sign Placement Modal ─────────────────────────────────────────────────────
function SignPlacementModal({
  action,
  stepIndex,
  totalSteps,
  stepName,
  sourceFileUrl,
  fileType,
  autoConvertPdf,
  signatureUrl,
  userName,
  userChucVu,
  ghiChuText,
  factoryId,
  templateMa,
  templateLoai,
  hasTemplate,
  instanceId,
  userId,
  acting,
  errorMessage,
  onConfirm,
  onClose,
}: {
  action: "soan_thao" | "xem_xet" | "phe_duyet" | "ky_buoc"
  stepIndex?: number
  totalSteps?: number
  stepName?: string
  sourceFileUrl: string | null
  fileType: string | null
  autoConvertPdf: boolean
  signatureUrl: string | null
  userName: string
  userChucVu: string
  ghiChuText: string
  factoryId: string | null
  templateMa: string | null
  templateLoai: string | null
  hasTemplate?: boolean
  instanceId: string
  userId: string
  acting: boolean
  errorMessage?: string | null
  onConfirm: (pin: string, placement: FullPlacement, signAs: SignAsType, note?: string) => Promise<{ success: boolean; error?: string } | void> | void
  onClose: () => void
}) {
  const isPdf = fileType === "pdf" || urlIsPdf(sourceFileUrl)
  const showCanvas = isPdf && !!sourceFileUrl

  const isFirstStep = typeof stepIndex === "number" ? stepIndex === 0 : action === "soan_thao"
  const isFinalStep = typeof totalSteps === "number" && typeof stepIndex === "number"
    ? stepIndex + 1 >= totalSteps
    : action === "phe_duyet"
  const stepKey = typeof stepIndex === "number" ? `buoc_${stepIndex + 1}` : action

  // Luồng ký chia 2 bước: PIN phải xác thực đúng (chặn, gọi /api/sign/verify)
  // TRƯỚC khi hiện canvas PDF đặt vị trí chữ ký — mirror iso/documents/[id]/page.tsx
  // (pinModal/placementModal) và documents/[id]/page.tsx (Cập nhật 2026-07-24).
  const [step, setStep] = useState<"pin" | "placement">("pin")
  const [pin, setPin] = useState("")
  const [pinError, setPinError] = useState("")
  const [showPin, setShowPin] = useState(false)
  const [pinVerifying, setPinVerifying] = useState(false)
  const [signAs, setSignAs] = useState<SignAsType>("none")
  // Cờ ghi nhận mẫu đã định vị vai trò này hay chưa. Khi ĐÃ CÓ MẪU: tiền tố ký thay do mẫu
  // quyết định (ẩn nhóm radio); khi CHƯA CÓ MẪU: người ký tự chọn qua nhóm radio (tương thích ngược).
  // Khởi tạo từ `hasTemplate` và chỉ hiển thị sau khi đã tải/kiểm tra xong mẫu (`templateLoaded`),
  // tránh nháy banner ký thay cũ 0.5s rồi mới ẩn đi.
  const [hasTemplateForRole, setHasTemplateForRole] = useState(hasTemplate ?? false)
  const [templateLoaded, setTemplateLoaded] = useState(hasTemplate ?? false)
  const showSignAsPicker = templateLoaded && !hasTemplateForRole && isFinalStep && showCanvas

  // Quy tắc 2 tầng hiển thị: mẫu quyết định "CHO PHÉP hiện", người ký quyết định "có hiện không".
  // Mặc định true khi CHƯA có mẫu để giữ nguyên chế độ kéo-thả tự do cũ.
  const [tmplAllowName, setTmplAllowName] = useState(true)
  const [tmplAllowChucVu, setTmplAllowChucVu] = useState(true)

  // Canvas + PDF state
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null)
  const pdfPageDimsRef = useRef<Record<number, { w: number; h: number }>>({})
  const [currentPage, setCurrentPage] = useState(1)
  const [numPages, setNumPages] = useState(1)
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({})
  const [thumbnailsLoading, setThumbnailsLoading] = useState(false)
  const [userNote, setUserNote] = useState(ghiChuText || "")
  const [pdfPageH, setPdfPageH] = useState(841.89) // A4 default
  const [pdfScale, setPdfScale] = useState(1.5)
  const [canvasReady, setCanvasReady] = useState(false)
  const [canvasError, setCanvasError] = useState<string | null>(null)

  // Element states (canvas pixels) — tính toán kích thước vừa khít text (Auto-Fit Snug Box)
  const initialSnugName = computeSnugBoxSize(userName, "name", 1.0)
  const initialSnugCv = computeSnugBoxSize(userChucVu, "chuc_vu", 1.0)
  const [sigState, setSigState] = useState<ElemState>({ x: 60, y: 200, w: 140, h: 60 })
  const [nameState, setNameState] = useState<ElemState>({ x: 60, y: 270, w: initialSnugName.w, h: initialSnugName.h })
  const [cvState, setCvState] = useState<ElemState>({ x: 60, y: 298, w: initialSnugCv.w, h: initialSnugCv.h })
  const [qrState, setQrState] = useState<ElemState>({ x: 0, y: 10, w: 80, h: 80 })
  const [prefixState, setPrefixState] = useState<ElemState>({ x: 220, y: 270, w: 60, h: 24 })
  const [showName, setShowName] = useState(true)
  // Chức vụ mặc định TẮT: nhiều biểu mẫu ISO đã in sẵn chức danh dưới ô ký, bật mặc định sẽ
  // đè chữ lên nhau. Người ký tự bật khi cần (hoặc mẫu vị trí ký bật sẵn hộ).
  const [showChucVu, setShowChucVu] = useState(false)
  // Mẫu vị trí ký đã nạp được cho biểu mẫu này (nếu có) — chỉ để hiển thị nhãn cho người ký
  // biết vị trí đang là "theo mẫu" hay mặc định.
  const [templateApplied, setTemplateApplied] = useState<string | null>(null)
  // VÙNG CHO PHÉP lấy từ mẫu vị trí ký (pixel canvas), theo đúng mô hình của module Văn bản:
  // khung mẫu KHÔNG khoá cứng vị trí — 3 khối chữ ký / tên / chức vụ vẫn kéo và co giãn được,
  // nhưng không ra khỏi khung. Nhờ vậy mẫu giữ được bố cục chung mà người ký vẫn căn chỉnh
  // được cho vừa ô ký in sẵn trên từng biểu mẫu.
  // `null` = biểu mẫu chưa có mẫu vị trí → kéo-thả tự do toàn trang như trước.
  const [templateBox, setTemplateBox] = useState<ElemState | null>(null)
  const [templateQrBox, setTemplateQrBox] = useState<ElemState | null>(null)
  // Khung "Ngày ký" / "Ghi chú" của mẫu — nội dung tự điền, vị trí do người soạn thảo đã đặt nên
  // người ký KHÔNG chỉnh (khác 3 khối chữ ký/tên/chức vụ). `null` = mẫu không đặt khung này.
  const [ngayKyBox, setNgayKyBox] = useState<ElemState | null>(null)
  const [ghiChuBox, setGhiChuBox] = useState<ElemState | null>(null)
  const [ghiChuOff, setGhiChuOff] = useState(false)
  const [noteLayout, setNoteLayout] = useState<{
    text: ElemState
    ky_nhay: ElemState | null
  } | null>(null)
  const [confirmError, setConfirmError] = useState("")
  // Ngày đóng dấu chuẩn ISO: tick xanh + "Hồ sơ được ký dd/mm/yyyy hh:mm:ss"
  const [ngayKyPreview] = useState(() => `Hồ sơ được ký ${formatFactoryDateTimeVN(new Date())}`)
  const [mainBoxPage, setMainBoxPage] = useState<number>(1)
  const [extraSigBoxes, setExtraSigBoxes] = useState<Array<{
    id: number
    page: number
    sigX: number; sigY: number; sigW: number; sigH: number
    nameX: number; nameY: number; nameW: number; nameH: number
    showSignature: boolean; showSignerName: boolean
  }>>([])

  // Cập nhật toạ độ và kích thước 2 khối con bên trong khung Ghi chú (ô text và chữ ký nháy)
  const setNoteRect = (which: "text" | "ky_nhay", x: number, y: number, w: number, h: number) => {
    if (!ghiChuBox) return
    const minW = which === "text" ? 40 : 20
    const minH = which === "text" ? 12 : 10
    const clampedW = Math.min(Math.max(w, minW), ghiChuBox.w)
    const clampedH = Math.min(Math.max(h, minH), ghiChuBox.h)
    const clampedX = Math.min(Math.max(x, ghiChuBox.x), ghiChuBox.x + ghiChuBox.w - clampedW)
    const clampedY = Math.min(Math.max(y, ghiChuBox.y), ghiChuBox.y + ghiChuBox.h - clampedH)
    setNoteLayout((prev) => {
      if (!prev) return null
      return {
        ...prev,
        [which]: { x: clampedX, y: clampedY, w: clampedW, h: clampedH },
      }
    })
  }

  // nodeRefs for react-draggable (React 19 requirement)
  const sigNodeRef = useRef<HTMLDivElement>(null)
  const nameNodeRef = useRef<HTMLDivElement>(null)
  const cvNodeRef = useRef<HTMLDivElement>(null)
  const qrNodeRef = useRef<HTMLDivElement>(null)
  const prefixNodeRef = useRef<HTMLDivElement>(null)

  // Render 1 trang PDF lên canvas — tách riêng để gọi lại khi đổi trang, không
  // phải load lại toàn bộ file. Tính lại viewport/scale mỗi lần vì kích thước
  // trang có thể khác nhau giữa các trang.
  // Trả về thông số trang vừa render để nơi gọi dùng NGAY, không phải đợi setState commit —
  // cần cho việc quy đổi toạ độ mẫu vị trí ký (point) sang pixel canvas ngay trong cùng lượt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderPdfPage = async (pdf: any, pageNum: number): Promise<{ scale: number; pageH: number } | null> => {
    const page = await pdf.getPage(pageNum)
    const scale = 1.5
    const viewport = page.getViewport({ scale })
    const cW = Math.floor(viewport.width)
    const cH = Math.floor(viewport.height)

    const canvas = canvasRef.current
    if (!canvas) return null
    canvas.width = cW
    canvas.height = cH

    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx, viewport } as any).promise

    const unscaledViewport = page.getViewport({ scale: 1 })
    setPdfScale(scale)
    setPdfPageH(unscaledViewport.height)
    return { scale, pageH: unscaledViewport.height }
  }

  // Load PDF and render to canvas — chỉ chạy khi đã sang bước "placement" (PIN đã
  // xác thực đúng), tránh tải file lãng phí nếu người dùng hủy ngay ở bước nhập PIN.
  useEffect(() => {
    if (!showCanvas || !sourceFileUrl || step !== "placement") return
    let cancelled = false

    /**
     * Nạp mẫu vị trí ký của biểu mẫu đang thực hiện và đặt sẵn 3 khối (chữ ký / tên / chức vụ)
     * cùng khung QR vào đúng chỗ người soạn thảo đã vẽ 1 lần ở màn "Cài đặt vị trí ký".
     *
     * Khác "vị trí CỨNG" của module Văn bản: ở đây mẫu chỉ ĐẶT SẴN, người ký vẫn kéo/chỉnh và
     * bật/tắt tự do trước khi ký. Không có mẫu → giữ nguyên vị trí mặc định như trước.
     */
    const applyTemplate = async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pdf: any,
      scale: number,
      pageH: number,
      pageDims: Record<number, { w: number; h: number }>,
      isCancelled: () => boolean,
    ) => {
      if (!factoryId) {
        if (!isCancelled()) setHasTemplateForRole(false)
        return
      }
      try {
        const keys: string[] = []
        if (templateMa) keys.push(`iso:code:${templateMa}`, `iso:loai:${templateMa}`, templateMa)
        if (templateLoai) keys.push(`iso:loai:${templateLoai}`, `iso:${templateLoai}`, templateLoai)
        if (!keys.length) {
          if (!isCancelled()) setHasTemplateForRole(false)
          return
        }

        const { data: rows } = await supabase
          .from("mau_vi_tri")
          .select("khung, loai_tai_lieu, phien_ban")
          .eq("factory_id", factoryId)
          .in("loai_tai_lieu", keys)
          .order("phien_ban", { ascending: false })
        if (isCancelled() || !rows || rows.length === 0) {
          if (!isCancelled()) setHasTemplateForRole(false)
          return
        }

        // Ưu tiên mẫu đặt riêng cho ĐÚNG mã biểu mẫu; chỉ khi không có mới dùng mẫu chung theo loại.
        const codeRow = templateMa
          ? rows.find((r) => r.loai_tai_lieu === `iso:code:${templateMa}`
              || r.loai_tai_lieu === `iso:loai:${templateMa}`
              || r.loai_tai_lieu === templateMa)
          : null
        const best = codeRow ?? rows[0]
        const khung = Array.isArray(best?.khung)
          ? (best.khung as Array<Record<string, unknown>>)
          : []
        if (khung.length === 0) return

        const num = (v: unknown, fb: number) => (typeof v === "number" && Number.isFinite(v) ? v : fb)

        // Tìm roleBox khớp với bước ký hiện tại (dùng chung helper findRoleBoxForStep với backend)
        const roleBox = findRoleBoxForStep(khung, {
          stepIndex: typeof stepIndex === "number" ? stepIndex : (action === "soan_thao" ? 0 : 1),
          totalSteps: typeof totalSteps === "number" ? totalSteps : (action === "phe_duyet" ? 3 : 2),
          stepName,
          stepKey,
          action,
        })
        const qrBox = khung.find((k) => k.vai_tro === "qr" || k.loai === "qr")
        if (!roleBox && !qrBox) {
          if (!isCancelled()) setHasTemplateForRole(false)
          return
        }

        let curScale = scale
        let curPageH = pageH
        const wantedPage = num(roleBox?.so_trang, 0) || num(qrBox?.so_trang, 0) || 1
        const effectiveMainPage = (roleBox?.neo_trang === "cuoi" && pdf.numPages) ? pdf.numPages : (wantedPage > 0 ? wantedPage : 1)
        setMainBoxPage(effectiveMainPage)
        if (effectiveMainPage > 1 && effectiveMainPage <= pdf.numPages) {
          const d = await renderPdfPage(pdf, effectiveMainPage)
          if (isCancelled()) return
          if (d) {
            curScale = d.scale
            curPageH = d.pageH
            setCurrentPage(effectiveMainPage)
          }
        }

        // Mẫu lưu theo point, gốc dưới-trái (hệ pdf-lib); canvas là pixel, gốc trên-trái.
        const toCanvas = (r: { x: number; y: number; width: number; height: number }): ElemState => ({
          x: r.x * curScale,
          y: (curPageH - r.y - r.height) * curScale,
          w: r.width * curScale,
          h: r.height * curScale,
        })

        if (roleBox) {
          setHasTemplateForRole(true)
          const tmplShowName = typeof roleBox.show_name === "boolean" ? roleBox.show_name : true
          // Mẫu cũ (trước 2026-09-04) chỉ có `show_name` gộp chung — fallback theo đúng quy ước
          // đã ghi ở `SignTemplateBox.show_chuc_vu`.
          const tmplShowCv = typeof roleBox.show_chuc_vu === "boolean"
            ? roleBox.show_chuc_vu
            : tmplShowName
          const tmplSignAs = (typeof roleBox.sign_as === "string" && roleBox.sign_as && roleBox.sign_as !== "none")
            ? (roleBox.sign_as as SignAsType)
            : null
          const withPrefix = isFinalStep && !!tmplSignAs

          // Tầng 1: Mẫu quyết định CHO PHÉP hiển thị
          setTmplAllowName(tmplShowName)
          setTmplAllowChucVu(tmplShowCv)
          // Tầng 2: Trạng thái bật/tắt ban đầu của người ký
          setShowName(tmplShowName)
          setShowChucVu(tmplShowCv && !!userChucVu)
          if (isFinalStep) {
            setSignAs(tmplSignAs ?? "none")
          }

          const roleBoxPt = {
            x: num(roleBox.x_pt, 0),
            y: num(roleBox.y_pt, 0),
            width: num(roleBox.w_pt, 160),
            height: num(roleBox.h_pt, 75),
          }

          // Tính bố cục theo cờ mẫu
          const activeSub = computeDefaultSubLayout(
            roleBoxPt,
            { withName: tmplShowName, withChucVu: tmplShowCv, withPrefix },
          )
          // Bố cục đầy đủ làm toạ độ an toàn dự phòng nếu khối nào bị tắt cờ,
          // đảm bảo toạ độ ban đầu LUÔN nằm trong khung mẫu, kẹp chặt clampRectToBox,
          // tuyệt đối không để rơi ra góc dưới-trái (Lỗi 3).
          const fullSub = computeDefaultSubLayout(
            roleBoxPt,
            { withName: true, withChucVu: true, withPrefix },
          )

          const sigPt = clampRectToBox(activeSub.sig, roleBoxPt)
          const namePt = clampRectToBox(activeSub.name ?? fullSub.name ?? activeSub.sig, roleBoxPt)
          const cvPt = clampRectToBox(activeSub.chuc_vu ?? fullSub.chuc_vu ?? activeSub.sig, roleBoxPt)

          const roleCanvas = toCanvas(roleBoxPt)
          const nameCanvas = toCanvas(namePt)
          const cvCanvas = toCanvas(cvPt)

          const snugName = computeSnugBoxSize(userName, "name", 1.0)
          const snugCv = computeSnugBoxSize(userChucVu, "chuc_vu", 1.0)

          const snugNameW = Math.min(roleCanvas.w, snugName.w)
          const snugCvW = Math.min(roleCanvas.w, snugCv.w)

          const snugNameX = Math.max(roleCanvas.x, roleCanvas.x + Math.round((roleCanvas.w - snugNameW) / 2))
          const snugCvX = Math.max(roleCanvas.x, roleCanvas.x + Math.round((roleCanvas.w - snugCvW) / 2))

          setSigState(toCanvas(sigPt))
          setNameState({
            x: snugNameX,
            y: nameCanvas.y,
            w: snugNameW,
            h: snugName.h,
          })
          setCvState({
            x: snugCvX,
            y: cvCanvas.y,
            w: snugCvW,
            h: snugCv.h,
          })

          if (withPrefix && (activeSub.prefix || fullSub.prefix)) {
            const prefixPt = clampRectToBox((activeSub.prefix ?? fullSub.prefix)!, roleBoxPt)
            setPrefixState(toCanvas(prefixPt))
          }

          // Vùng cho phép = CHÍNH khung mẫu của vai trò này. Chỉ đặt khi mẫu có khung cho ĐÚNG
          // vai trò đang ký — mẫu chỉ có khung QR (hoặc chỉ có vai trò khác) thì vai trò này
          // chưa được định vị, giữ kéo-thả tự do toàn trang.
          setTemplateBox(toCanvas(roleBoxPt))

          // Tự động quét và nạp tất cả các khung nhân bản (clones) thuộc về bước này
          const roleBaseKey = String(roleBox.vai_tro || "")
          const stepKeyVal = typeof stepIndex === "number" ? `buoc_${stepIndex + 1}` : action
          const cloneBoxes = khung.filter((k) => {
            if (k === roleBox) return false
            const vt = String(k.vai_tro || "")
            const cloneOf = String(k.clone_of || "")
            const l = String(k.loai || "")
            if (l === "qr" || l === "ngay_ky" || l === "ghi_chu" || vt === "qr" || vt === "ngay_ky" || vt === "ghi_chu") return false
            return (
              cloneOf === roleBaseKey ||
              cloneOf === stepKeyVal ||
              (roleBox.clone_of && cloneOf === String(roleBox.clone_of)) ||
              vt.startsWith(`${roleBaseKey}__ban`) ||
              vt.startsWith(`${stepKeyVal}__ban`) ||
              (action && (cloneOf === action || vt.startsWith(`${action}__ban`))) ||
              (roleBox.nhan && k.nhan && String(k.nhan).trim().toLowerCase().startsWith(String(roleBox.nhan).trim().toLowerCase()) && vt.includes("__ban"))
            )
          })

          if (cloneBoxes.length > 0) {
            const extraBoxes = cloneBoxes.map((cBox, idx) => {
              const cBoxPt = {
                x: num(cBox.x_pt, 0),
                y: num(cBox.y_pt, 0),
                width: num(cBox.w_pt, 160),
                height: num(cBox.h_pt, 75),
              }
              const cShowName = typeof cBox.show_name === "boolean" ? cBox.show_name : true
              const cShowCv = typeof cBox.show_chuc_vu === "boolean" ? cBox.show_chuc_vu : cShowName
              const cSub = computeDefaultSubLayout(cBoxPt, { withName: cShowName, withChucVu: cShowCv })
              const cFull = computeDefaultSubLayout(cBoxPt, { withName: true, withChucVu: true })
              const cSigPt = clampRectToBox(cSub.sig, cBoxPt)
              const cNamePt = clampRectToBox(cSub.name ?? cFull.name ?? cSub.sig, cBoxPt)

              const cPage = num(cBox.so_trang, 0) || (cBox.neo_trang === "cuoi" ? (pdf.numPages || 1) : 1)
              const cDim = pageDims[cPage] || pageDims[1] || { w: 595.28, h: curPageH }
              const cPageH = cDim.h

              const cToCanvas = (r: { x: number; y: number; width: number; height: number }): ElemState => ({
                x: r.x * curScale,
                y: (cPageH - r.y - r.height) * curScale,
                w: r.width * curScale,
                h: r.height * curScale,
              })

              const cSigCanvas = cToCanvas(cSigPt)
              const cNameCanvas = cToCanvas(cNamePt)
              const cRoleCanvas = cToCanvas(cBoxPt)
              const cSnugName = computeSnugBoxSize(userName, "name", 1.0)
              const cSnugNameW = Math.min(cRoleCanvas.w, cSnugName.w)
              const cSnugNameX = Math.max(cRoleCanvas.x, cRoleCanvas.x + Math.round((cRoleCanvas.w - cSnugNameW) / 2))

              let finalSigX = cSigCanvas.x
              let finalSigY = cSigCanvas.y
              let finalNameX = cSnugNameX
              let finalNameY = cNameCanvas.y

              // Nếu cùng trang và toạ độ trùng với khung chính, tự động offset hiển thị để không bị che khuất
              const mainSigCanvas = toCanvas(sigPt)
              if (cPage === effectiveMainPage && Math.abs(finalSigX - mainSigCanvas.x) < 8 && Math.abs(finalSigY - mainSigCanvas.y) < 8) {
                const offset = 30 * (idx + 1)
                finalSigX += offset
                finalSigY += offset
                finalNameX += offset
                finalNameY += offset
              }

              return {
                id: Date.now() + Math.random() + idx,
                page: cPage,
                sigX: finalSigX,
                sigY: finalSigY,
                sigW: cSigCanvas.w,
                sigH: cSigCanvas.h,
                nameX: finalNameX,
                nameY: finalNameY,
                nameW: cSnugNameW,
                nameH: cNameCanvas.h,
                showSignature: true,
                showSignerName: cShowName,
              }
            })
            setExtraSigBoxes(extraBoxes)
          }
        }

        // QR chỉ đặt ở bước đầu tiên (các bước sau dùng lại QR đã chốt của bước đầu).
        if (qrBox && isFirstStep) {
          const qrRegion = toCanvas({
            x: num(qrBox.x_pt, 0),
            y: num(qrBox.y_pt, 0),
            width: num(qrBox.w_pt, 54),
            height: num(qrBox.h_pt, 54),
          })
          setQrState(qrRegion)
          setTemplateQrBox(qrRegion)
        }

        // Ngày ký chỉ vẽ ở bước PHÊ DUYỆT (ngày ban hành / bước cuối), Ghi chú chỉ vẽ ở lượt đóng dấu ĐẦU
        // TIÊN — bước cuối vẽ lại cả N placement từ file gốc, gắn vào mọi bước sẽ thành chồng chữ lên nhau.
        const ngayKyTmpl = khung.find((k) => k.vai_tro === "ngay_ky" || k.loai === "ngay_ky")
        if (ngayKyTmpl && isFinalStep) {
          setNgayKyBox(toCanvas({
            x: num(ngayKyTmpl.x_pt, 0), y: num(ngayKyTmpl.y_pt, 0),
            width: num(ngayKyTmpl.w_pt, 120), height: num(ngayKyTmpl.h_pt, 18),
          }))
        }
        const ghiChuTmpl = khung.find((k) => k.vai_tro === "ghi_chu" || k.loai === "ghi_chu")
        if (ghiChuTmpl && isFinalStep) {
          const gBoxPt = {
            x: num(ghiChuTmpl.x_pt, 0), y: num(ghiChuTmpl.y_pt, 0),
            width: num(ghiChuTmpl.w_pt, 200), height: num(ghiChuTmpl.h_pt, 50),
          }
          setGhiChuBox(toCanvas(gBoxPt))
          const defNoteSub = computeDefaultNoteLayout(gBoxPt, { withKyNhay: true })
          setNoteLayout({
            text: toCanvas(defNoteSub.text),
            ky_nhay: defNoteSub.ky_nhay ? toCanvas(defNoteSub.ky_nhay) : null,
          })
        }

        setTemplateApplied(String(best.loai_tai_lieu ?? ""))
      } catch {
        // Không có mẫu / lỗi mạng → giữ nguyên vị trí mặc định, KHÔNG chặn luồng ký.
        if (!isCancelled()) setHasTemplateForRole(false)
      } finally {
        if (!isCancelled()) {
          setTemplateLoaded(true)
        }
      }
    }

    const loadPdf = async () => {
      const pdfjsLib = await import("pdfjs-dist")
      if ((globalThis as Record<string, unknown>).pdfjsWorker) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = ""
      } else {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs", import.meta.url
        ).toString()
      }

      const freshUrl = sourceFileUrl.includes("?")
        ? `${sourceFileUrl}&_nocache=${Date.now()}`
        : `${sourceFileUrl}?_nocache=${Date.now()}`
      const task = pdfjsLib.getDocument({
        url: freshUrl,
        httpHeaders: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
        },
      })
      const pdf = await task.promise
      if (cancelled) return

      pdfDocRef.current = pdf
      setNumPages(pdf.numPages)
      if (pdf.numPages > 1) {
        setThumbnailsLoading(true)
        void (async () => {
          try {
            const thumbMap: Record<number, string> = {}
            for (let p = 1; p <= pdf.numPages; p++) {
              if (cancelled) return
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const page: any = await pdf.getPage(p)
                const vp1 = page.getViewport({ scale: 1 })
                const thumbW = 90
                const scale = thumbW / (vp1.width || thumbW)
                const vp = page.getViewport({ scale })
                const thumbCanvas = document.createElement("canvas")
                thumbCanvas.width = Math.floor(vp.width)
                thumbCanvas.height = Math.floor(vp.height)
                const ctx = thumbCanvas.getContext("2d")
                if (ctx) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  await page.render({ canvasContext: ctx, viewport: vp } as any).promise
                  thumbMap[p] = thumbCanvas.toDataURL("image/webp", 0.7)
                }
              } catch (e) {
                console.warn(`Render thumb p${p} failed`, e)
              }
            }
            if (!cancelled) {
              setThumbnails(thumbMap)
              setThumbnailsLoading(false)
            }
          } catch (e) {
            console.warn("Lỗi generate thumbnails:", e)
            if (!cancelled) setThumbnailsLoading(false)
          }
        })()
      }
      const dims = await renderPdfPage(pdf, 1)
      if (cancelled) return

      // Lưu kích thước thật (pt) của từng trang để quy đổi toạ độ chính xác cho các khung bản sao
      const pageDims: Record<number, { w: number; h: number }> = {}
      for (let p = 1; p <= pdf.numPages; p++) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pg: any = await pdf.getPage(p)
          const vp1 = pg.getViewport({ scale: 1 })
          pageDims[p] = { w: vp1.width, h: vp1.height }
        } catch {
          // ignore
        }
      }
      pdfPageDimsRef.current = pageDims

      const cH = canvasRef.current?.height || 0
      const cW = canvasRef.current?.width || 0

      // Set default positions based on canvas size (Chức danh ở TRÊN, Tên ở DƯỚI)
      setSigState({ x: 60, y: cH - 150, w: 140, h: 60 })
      setCvState({ x: 60, y: cH - 85, w: 140, h: 22 })
      setNameState({ x: 60, y: cH - 57, w: 140, h: 24 })
      setQrState({ x: cW - 100, y: 10, w: 80, h: 80 })
      setPrefixState({ x: 220, y: cH - 85, w: 60, h: 24 })
      setCanvasReady(true)

      // ── Áp mẫu vị trí ký (nếu biểu mẫu này đã có mẫu) ──────────────────────
      // Mẫu chỉ GỢI Ý vị trí ban đầu — người ký vẫn kéo/chỉnh tự do trước khi ký, khác
      // "vị trí CỨNG" của module Văn bản. Lỗi nạp mẫu không được chặn luồng ký.
      if (dims) {
        await applyTemplate(pdf, dims.scale, dims.pageH, pageDims, () => cancelled)
      } else {
        if (!cancelled) setTemplateLoaded(true)
      }
    }

    loadPdf().catch(() => {
      if (!cancelled) {
        setCanvasError("Không tải được file PDF để hiển thị. Chữ ký sẽ đặt ở vị trí mặc định.")
        setTemplateLoaded(true)
      }
    })
    return () => { cancelled = true }
    // `action`/`factoryId`/`templateMa`/`templateLoai`/`userChucVu` phục vụ việc nạp mẫu vị trí
    // ký bên trong effect. Modal ký chỉ mở SAU khi trang cha đã nạp xong hồ sơ + biểu mẫu +
    // phiên đăng nhập, nên trong suốt vòng đời một lần mở modal chúng không đổi — không gây tải
    // lại PDF ngoài ý muốn.
  }, [showCanvas, sourceFileUrl, step, action, factoryId, templateMa, templateLoai, userChucVu, isFinalStep, isFirstStep, stepIndex, stepKey, stepName])

  const goToPage = (p: number) => {
    if (p < 1 || p > numPages || !pdfDocRef.current) return
    setCurrentPage(p)
    void renderPdfPage(pdfDocRef.current, p)
  }

  /**
   * Cỡ chữ xem trước phải khớp cỡ chữ SẼ đóng dấu, nếu không người ký căn khung theo một đằng
   * mà PDF ra một nẻo. Bản đóng dấu dùng Times New Roman 13pt, tự thu nhỏ dần tới 9pt khi chữ
   * rộng hơn khung (`ISO_SIGNER_NAME_STYLE` / `drawTextFit`); canvas thì đang phóng `pdfScale`
   * lần so với khổ PDF thật nên phải nhân lại.
   *
   * Ước lượng bề rộng theo số ký tự (Times New Roman ~0.5em/ký tự) thay vì đo thật — đủ để xem
   * trước, không cần chính xác từng pixel.
   */
  const previewTextStyle = (text: string, boxW: number): CSSProperties => {
    const maxPx = SIGN_TEXT_FONT_SIZE_PT
    const minPx = SIGN_TEXT_MIN_FONT_SIZE_PT
    const fitted = text ? (boxW - 4) / (text.length * 0.5) : maxPx
    return {
      fontFamily: SIGN_TEXT_FONT_FAMILY,
      fontSize: Math.max(minPx, Math.min(maxPx, fitted)),
      lineHeight: 1.15,
    }
  }

  /**
   * Giới hạn kéo của 1 khối vào trong vùng cho phép của mẫu (pixel canvas).
   * Không có mẫu → `"parent"` như cũ (kéo tự do toàn trang).
   *
   * `bounds` của react-draggable tính theo vị trí GÓC TRÁI-TRÊN của khối, nên biên phải/dưới
   * phải trừ đi đúng kích thước khối, nếu không khối sẽ thò ra ngoài khung.
   */
  const boundsIn = (region: ElemState | null, w: number, h: number) =>
    region
      ? {
          left: region.x,
          top: region.y,
          right: Math.max(region.x, region.x + region.w - w),
          bottom: Math.max(region.y, region.y + region.h - h),
        }
      : ("parent" as const)

  /** Cỡ tối đa khi co giãn để khối không tràn khỏi vùng cho phép. */
  const maxSizeIn = (region: ElemState | null, s: ElemState) =>
    region
      ? { maxWidth: Math.max(16, region.x + region.w - s.x), maxHeight: Math.max(10, region.y + region.h - s.y) }
      : {}

  // Convert canvas coords to PDF coords
  const toPdf = (canX: number, canY: number, w: number, h: number) => ({
    x: canX / pdfScale,
    y: pdfPageH - (canY + h) / pdfScale,
    width: w / pdfScale,
    height: h / pdfScale,
  })

  // Xác thực PIN thật qua server TRƯỚC khi mở bước đặt vị trí chữ ký — bắt lỗi PIN
  // sai ngay, không cần đợi tới lúc bấm "Ký xác nhận" ở cuối. onConfirm() bên dưới
  // vẫn gửi lại pin để handleSignConfirm (trang cha) tự verify lại lấy token thật
  // cho finalize — không đổi cơ chế đó, gọi ở đây chỉ để early-fail.
  const handleVerifyPin = async () => {
    if (!pin.trim()) { setPinError("Vui lòng nhập PIN"); return }
    setPinVerifying(true)
    setPinError("")
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        setPinError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
        return
      }
      const res = await fetch("/api/sign/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId, pin, docId: instanceId, docType: "iso_form" }),
      })
      const json = await res.json() as { error?: string }
      if (!res.ok) { setPinError(json.error ?? "PIN không đúng"); return }
      setStep("placement")
    } catch {
      setPinError("Không thể xác thực PIN, vui lòng thử lại")
    } finally {
      setPinVerifying(false)
    }
  }

  const handleConfirm = async () => {
    if (!pin.trim()) { setStep("pin"); setPinError("Vui lòng nhập lại PIN"); return }

    if (isFinalStep && ghiChuBox && !ghiChuOff && !userNote.trim()) {
      setConfirmError("Mẫu hồ sơ này có khung Ghi chú. Vui lòng nhập ý kiến chỉ đạo, hoặc bấm “Không ghi ý kiến” nếu không cần.")
      return
    }

    let placement: FullPlacement
    if (showCanvas && canvasReady) {
      // Kẹp lại vào vùng cho phép bằng ĐÚNG hàm mà module Văn bản và server dùng
      // (`clampRectToBox`) — bounds/maxSize của UI đã chặn rồi, đây là lưới an toàn cuối cho
      // các trường hợp biên (đổi trang giữa chừng, khung mẫu nhỏ hơn cỡ tối thiểu của khối...).
      const boxPdf = templateBox
        ? toPdf(templateBox.x, templateBox.y, templateBox.w, templateBox.h)
        : null
      const fit = (r: { x: number; y: number; width: number; height: number }) =>
        boxPdf ? clampRectToBox(r, boxPdf) : r

      // Ngày ký / Ghi chú: vẽ NGUYÊN khung mẫu (không kẹp theo `templateBox` của khối ký — đó
      // là 2 khung độc lập của mẫu).
      const ngayKyPdf = ngayKyBox ? toPdf(ngayKyBox.x, ngayKyBox.y, ngayKyBox.w, ngayKyBox.h) : null
      const ghiChuPdf = ghiChuBox ? toPdf(ghiChuBox.x, ghiChuBox.y, ghiChuBox.w, ghiChuBox.h) : null

      const sigPdf = fit(toPdf(sigState.x, sigState.y, sigState.w, sigState.h))
      const namePdf = fit(toPdf(nameState.x, nameState.y, nameState.w, nameState.h))
      const cvPdf = fit(toPdf(cvState.x, cvState.y, cvState.w, cvState.h))
      const cvOn = tmplAllowChucVu && showChucVu && !!userChucVu

      placement = {
        page: mainBoxPage,
        x: sigPdf.x, y: sigPdf.y, width: sigPdf.width, height: sigPdf.height,
        showSignature: true,
        showSignerName: tmplAllowName && showName,
        nameX: namePdf.x, nameY: namePdf.y, nameWidth: namePdf.width, nameHeight: namePdf.height,
        // Chỉ gửi khối chức vụ khi mẫu cho phép, người ký bật VÀ có nội dung
        showChucVu: cvOn,
        chucVuText: cvOn ? userChucVu : null,
        cvX: cvPdf.x, cvY: cvPdf.y, cvWidth: cvPdf.width, cvHeight: cvPdf.height,
        ...(ngayKyPdf ? {
          ngayKyText: ngayKyPreview,
          ngayKyX: ngayKyPdf.x, ngayKyY: ngayKyPdf.y,
          ngayKyWidth: ngayKyPdf.width, ngayKyHeight: ngayKyPdf.height,
        } : {}),
        ...(isFinalStep && ghiChuBox ? {
          ghiChuTat: ghiChuOff,
          ...(ghiChuOff ? {} : (() => {
            const textPdf = noteLayout?.text ? toPdf(noteLayout.text.x, noteLayout.text.y, noteLayout.text.w, noteLayout.text.h) : ghiChuPdf
            const kyNhayPdf = noteLayout?.ky_nhay ? toPdf(noteLayout.ky_nhay.x, noteLayout.ky_nhay.y, noteLayout.ky_nhay.w, noteLayout.ky_nhay.h) : null
            return {
              ghiChuText: userNote.trim(),
              ghiChuX: textPdf?.x,
              ghiChuY: textPdf?.y,
              ghiChuWidth: textPdf?.width,
              ghiChuHeight: textPdf?.height,
              kyNhayX: kyNhayPdf?.x,
              kyNhayY: kyNhayPdf?.y,
              kyNhayWidth: kyNhayPdf?.width,
              kyNhayHeight: kyNhayPdf?.height,
            }
          })()),
        } : {}),
      }

      if (extraSigBoxes.length > 0) {
        placement.extraPlacements = extraSigBoxes.map((box) => {
          const bPage = box.page || currentPage
          const bDim = pdfPageDimsRef.current[bPage] || pdfPageDimsRef.current[1] || { w: 595.28, h: pdfPageH }
          const sX = box.sigX / pdfScale
          const sW = box.sigW / pdfScale
          const sH = box.sigH / pdfScale
          const sY = bDim.h - (box.sigY + box.sigH) / pdfScale
          const nX = box.nameX / pdfScale
          const nW = box.nameW / pdfScale
          const nH = box.nameH / pdfScale
          const nY = bDim.h - (box.nameY + box.nameH) / pdfScale
          return {
            page: bPage,
            x: sX, y: sY, width: sW, height: sH,
            showSignature: true,
            showSignerName: box.showSignerName,
            nameX: nX, nameY: nY, nameWidth: nW, nameHeight: nH,
          }
        })
      }

      if (isFirstStep) {
        const qrPdf = toPdf(qrState.x, qrState.y, qrState.w, qrState.h)
        placement.qrX = qrPdf.x
        placement.qrY = qrPdf.y
        placement.qrWidth = qrPdf.width
        placement.qrHeight = qrPdf.height
      }

      if (isFinalStep && signAs !== "none") {
        const prefixPdf = fit(toPdf(prefixState.x, prefixState.y, prefixState.w, prefixState.h))
        placement.showPrefix = true
        placement.prefixX = prefixPdf.x
        placement.prefixY = prefixPdf.y
        placement.prefixWidth = prefixPdf.width
        placement.prefixHeight = prefixPdf.height
      }
    } else {
      // Office mode: no real coordinates needed, tags will be replaced
      placement = {
        page: 1,
        x: 0, y: 0, width: 0, height: 0,
        showSignature: true, showSignerName: true,
        nameX: 0, nameY: 0, nameWidth: 0, nameHeight: 0,
      }
    }

    const finalNote = isFinalStep ? (!ghiChuOff ? (userNote || ghiChuText).trim() : "") : undefined
    const res = await onConfirm(pin, placement, signAs, finalNote || undefined)
    if (res && !res.success && res.error) {
      setConfirmError(res.error)
    }
  }

  const stepTagMap: Record<string, { nameTag: string; sigTag: string }> = {
    soan_thao: { nameTag: "{{TEN_SOAN_THAO}}", sigTag: "{{CHU_KY_SOAN_THAO}}" },
    xem_xet: { nameTag: "{{TEN_XEM_XET}}", sigTag: "{{CHU_KY_XEM_XET}}" },
    phe_duyet: { nameTag: "{{TEN_PHE_DUYET}}", sigTag: "{{CHU_KY_PHE_DUYET}}" },
  }
  const tagInfo = stepTagMap[action] ?? {
    nameTag: `{{TEN_BUOC_${(stepIndex ?? 0) + 1}}}`,
    sigTag: `{{CHU_KY_BUOC_${(stepIndex ?? 0) + 1}}}`,
  }
  const { nameTag, sigTag } = tagInfo
  const stepLabel = typeof stepIndex === "number" && typeof totalSteps === "number"
    ? `Ký bước ${stepIndex + 1}/${totalSteps}${isFirstStep ? " (Người lập)" : isFinalStep ? " (Phê duyệt)" : ""}`
    : action === "soan_thao" ? "Ký và gửi hồ sơ" : action === "xem_xet" ? "Ký xem xét" : "Ký phê duyệt"

  // Bước 1: chỉ hiện PIN, chưa tải/hiện PDF. Đúng PIN mới chuyển sang bước 2.
  if (step === "pin") {
    return (
      <ModalShell
        title={
          <span className="flex items-center gap-3">
            <span className="p-2 bg-violet-100 rounded-xl"><Pen size={18} className="text-violet-600" /></span>
            <span>
              <span className="font-extrabold text-slate-800 block">{stepLabel}</span>
              <span className="text-xs text-slate-500 font-normal">Nhập PIN chữ ký để xác nhận</span>
            </span>
          </span>
        }
        onClose={onClose}
        maxWidth="sm"
        footer={
          <>
            <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
            <button
              onClick={() => void handleVerifyPin()}
              disabled={pinVerifying}
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl"
            >
              {pinVerifying ? <Loader2 size={13} className="animate-spin" /> : <Pen size={13} />}
              {pinVerifying ? "Đang xác thực..." : "Xác nhận"}
            </button>
          </>
        }
      >
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">PIN chữ ký</label>
          <div className="relative">
            <input
              type={showPin ? "text" : "password"}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setPinError("") }}
              onKeyDown={(e) => e.key === "Enter" && void handleVerifyPin()}
              placeholder="4–6 chữ số"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 pr-9 font-mono tracking-widest text-center text-lg"
            />
            <button
              type="button"
              onClick={() => setShowPin((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {pinError && (
            <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
              <AlertTriangle size={11} /> {pinError}
            </p>
          )}
        </div>
      </ModalShell>
    )
  }

  // Bước 2: PIN đã xác thực đúng — overlay toàn màn hình để đặt vị trí chữ ký,
  // chỉ còn cuộn dọc thay vì hộp thoại max-w-3xl/55vh cũ (2 thanh cuộn ngang+dọc).
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 bg-white border-b border-slate-100 shrink-0">
        <div>
          <h3 className="font-extrabold text-slate-800">{stepLabel}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {showCanvas
              ? templateBox
                ? "Đặt sẵn theo mẫu của biểu mẫu — kéo/co giãn được nhưng chỉ trong khung đã cài đặt"
                : templateApplied
                  ? "Đã đặt sẵn theo mẫu vị trí ký của biểu mẫu"
                  : "Kéo và thay đổi kích thước để đặt vị trí chữ ký trên PDF"
              : autoConvertPdf
                ? "Tag chữ ký sẽ được thay tại mỗi bước; file sẽ convert sang PDF khi phê duyệt"
                : "Tag trong file Office sẽ được thay tự động khi ký"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {showCanvas && numPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-bold text-slate-600">Trang {currentPage} / {numPages}</span>
              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= numPages}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={14} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-row bg-slate-100 min-h-0">
        {/* Left Thumbnail Rail */}
        {showCanvas && numPages > 1 && (
          <div className="w-28 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto p-2 gap-2 select-none z-10">
            <div className="text-[10px] uppercase font-bold text-slate-400 text-center tracking-wider mb-1">
              {numPages} trang
            </div>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
              const isCurrent = pageNum === currentPage
              const thumbUrl = thumbnails[pageNum]
              const hasMainSig = pageNum === mainBoxPage
              const extraCountOnPage = extraSigBoxes.filter((b) => (b.page || 1) === pageNum).length
              const totalSigsOnPage = (hasMainSig ? 1 : 0) + extraCountOnPage
              const hasSigningOnPage = totalSigsOnPage > 0
              return (
                <button
                  key={`thumb-${pageNum}`}
                  type="button"
                  onClick={() => goToPage(pageNum)}
                  className={`relative w-full rounded-lg border-2 transition-all p-1 flex flex-col items-center bg-white ${
                    isCurrent
                      ? "border-violet-600 shadow-md ring-2 ring-violet-200"
                      : hasSigningOnPage
                        ? "border-emerald-400 bg-emerald-50/30 hover:border-emerald-500"
                        : "border-slate-200 hover:border-slate-400"
                  }`}
                >
                  <div className="relative w-full overflow-hidden rounded">
                    {thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl} alt={`Trang ${pageNum}`} className="w-full h-auto object-contain rounded shadow-2xs pointer-events-none block" />
                    ) : (
                      <div className={`w-full aspect-[1/1.4] bg-slate-50 border border-slate-100 rounded flex items-center justify-center text-xs font-bold text-slate-400 ${thumbnailsLoading ? "animate-pulse" : ""}`}>
                        {pageNum}
                      </div>
                    )}
                    {hasSigningOnPage && (
                      <span className="absolute top-1 right-1 px-1 py-0.5 bg-emerald-600 text-white text-[9px] font-extrabold rounded shadow flex items-center gap-0.5">
                        ✍️ {totalSigsOnPage}
                      </span>
                    )}
                    {isCurrent && canvasRef.current && canvasRef.current.width > 0 && canvasRef.current.height > 0 && hasSigningOnPage && (
                      <span
                        className="absolute pointer-events-none rounded-[1px] border border-violet-600 bg-violet-600/30"
                        style={{
                          left: `${Math.max(0, Math.min(100, ((templateBox ? templateBox.x : sigState.x) / canvasRef.current.width) * 100))}%`,
                          top: `${Math.max(0, Math.min(100, ((templateBox ? templateBox.y : sigState.y) / canvasRef.current.height) * 100))}%`,
                          width: `${Math.max(4, Math.min(100, ((templateBox ? templateBox.w : sigState.w) / canvasRef.current.width) * 100))}%`,
                          height: `${Math.max(3, Math.min(100, ((templateBox ? templateBox.h : sigState.h) / canvasRef.current.height) * 100))}%`,
                        }}
                      />
                    )}
                  </div>
                  <span className={`text-[10px] font-bold mt-1 flex items-center gap-1 ${isCurrent ? "text-violet-700" : hasSigningOnPage ? "text-emerald-700" : "text-slate-500"}`}>
                    Trang {pageNum}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex-1 overflow-auto flex items-start p-4">
          {showCanvas ? (
            <div ref={containerRef} className="relative inline-block shadow-2xl bg-white select-none mx-auto">
              <canvas ref={canvasRef} className="block" />

            {!canvasReady && !canvasError && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
                <Loader2 size={24} className="animate-spin text-violet-500" />
              </div>
            )}
            {canvasError && (
              <div className="absolute inset-0 flex items-center justify-center bg-amber-50 p-4">
                <div className="text-center">
                  <AlertTriangle size={24} className="text-amber-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-amber-800">Không tải được PDF</p>
                  <p className="text-xs text-amber-600 mt-1">Chữ ký sẽ đặt ở vị trí mặc định</p>
                </div>
              </div>
            )}

            {canvasReady && (
              <>
                {/* Vùng cho phép của mẫu — người ký kéo/co giãn 3 khối tự do BÊN TRONG viền này.
                    Vẽ dưới các khối (zIndex thấp hơn) và `pointer-events-none` để không nuốt
                    thao tác kéo. */}
                {currentPage === mainBoxPage && templateBox && (
                  <div
                    className="absolute rounded pointer-events-none"
                    style={{
                      left: templateBox.x,
                      top: templateBox.y,
                      width: templateBox.w,
                      height: templateBox.h,
                      border: "2px dashed #0ea5e9",
                      background: "rgba(14,165,233,.07)",
                      zIndex: 9,
                    }}
                  >
                    <span className="absolute -top-5 left-0 text-[10px] font-bold px-1 rounded bg-white/90 text-sky-700 whitespace-nowrap">
                      Khung theo mẫu — chỉ đặt chữ ký trong vùng này
                    </span>
                  </div>
                )}

                {/* Ngày ký — tick xanh và text theo chuẩn ISO: "✓ Hồ sơ được ký dd/mm/yyyy hh:mm:ss" */}
                {currentPage === (numPages || 1) && ngayKyBox && (
                  <div
                    className="absolute rounded flex items-center justify-center pointer-events-none border border-dashed border-emerald-400 bg-emerald-50/60 px-1 overflow-hidden"
                    style={{ left: ngayKyBox.x, top: ngayKyBox.y, width: ngayKyBox.w, height: ngayKyBox.h, zIndex: 10 }}
                  >
                    <span className="flex items-center gap-1 text-[10px] text-slate-600 font-medium whitespace-nowrap">
                      <svg className="w-3 h-3 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      {ngayKyPreview}
                    </span>
                  </div>
                )}

                {/* Ghi chú — vùng cho phép chứa 2 khối con (text ý kiến + chữ ký nháy) kéo/co giãn được */}
                {currentPage === (numPages || 1) && isFinalStep && ghiChuBox && (() => {
                  const off = ghiChuOff || !userNote.trim()
                  const textCan = noteLayout?.text
                  const kyNhayCan = noteLayout?.ky_nhay
                  return (
                    <div
                      className={`absolute border-2 border-dashed rounded ${off ? "border-slate-300 bg-slate-100/50" : "border-teal-500 bg-teal-50/25"}`}
                      style={{ left: ghiChuBox.x, top: ghiChuBox.y, width: ghiChuBox.w, height: ghiChuBox.h, zIndex: 8 }}
                    >
                      <span className="absolute -top-5 left-0 text-[10px] font-bold text-teal-700 bg-white/90 px-1 rounded whitespace-nowrap">
                        Vùng ý kiến chỉ đạo / Ghi chú
                      </span>

                      {off ? (
                        <p className="text-[9px] text-slate-400 italic p-1">
                          {ghiChuOff ? "Không ghi ý kiến" : "Nhập ý kiến ở khung bên dưới..."}
                        </p>
                      ) : (
                        <>
                          {textCan && (
                            <ExtraDraggableBox
                              position={{ x: textCan.x - ghiChuBox.x, y: textCan.y - ghiChuBox.y }}
                              onStop={(_, d) => setNoteRect("text", ghiChuBox.x + d.x, ghiChuBox.y + d.y, textCan.w, textCan.h)}
                              zIndex={12}
                            >
                              <Resizable
                                size={{ width: textCan.w, height: textCan.h }}
                                onResizeStop={(_, __, ___, delta) =>
                                  setNoteRect("text", textCan.x, textCan.y, textCan.w + delta.width, textCan.h + delta.height)}
                                enable={{ right: true, bottom: true, bottomRight: true }}
                                minWidth={40} minHeight={12}
                                handleComponent={{ bottomRight: <ResizeHandleIcon color="#0d9488" title="Kéo để co giãn ô ý kiến chỉ đạo" /> }}
                                handleClasses={{ bottomRight: RESIZE_HANDLE_CLASS }}
                                handleStyles={{ bottomRight: RESIZE_HANDLE_STYLE }}
                              >
                                <div className="w-full h-full border border-teal-600 bg-teal-50/90 rounded overflow-hidden px-1 py-0.5">
                                  <p className="text-[9px] leading-tight text-slate-800 whitespace-pre-wrap break-words">
                                    {userNote}
                                  </p>
                                </div>
                              </Resizable>
                            </ExtraDraggableBox>
                          )}

                          {kyNhayCan && (
                            <ExtraDraggableBox
                              position={{ x: kyNhayCan.x - ghiChuBox.x, y: kyNhayCan.y - ghiChuBox.y }}
                              onStop={(_, d) => setNoteRect("ky_nhay", ghiChuBox.x + d.x, ghiChuBox.y + d.y, kyNhayCan.w, kyNhayCan.h)}
                              zIndex={13}
                            >
                              <Resizable
                                size={{ width: kyNhayCan.w, height: kyNhayCan.h }}
                                onResizeStop={(_, __, ___, delta) =>
                                  setNoteRect("ky_nhay", kyNhayCan.x, kyNhayCan.y, kyNhayCan.w + delta.width, kyNhayCan.h + delta.height)}
                                enable={{ right: true, bottom: true, bottomRight: true }}
                                minWidth={20} minHeight={10}
                                handleComponent={{ bottomRight: <ResizeHandleIcon color="#d97706" title="Kéo để co giãn chữ ký nháy" /> }}
                                handleClasses={{ bottomRight: RESIZE_HANDLE_CLASS }}
                                handleStyles={{ bottomRight: RESIZE_HANDLE_STYLE }}
                              >
                                <div className="w-full h-full border border-amber-500 bg-amber-50/85 rounded flex items-center justify-center overflow-hidden">
                                  {signatureUrl ? (
                                    <img src={signatureUrl} alt="Chữ ký nháy" className="w-full h-full object-contain" />
                                  ) : (
                                    <span className="text-[9px] text-amber-700 font-bold">Ký nháy</span>
                                  )}
                                </div>
                              </Resizable>
                            </ExtraDraggableBox>
                          )}
                        </>
                      )}
                    </div>
                  )
                })()}

                {/* QR — only first step, page 1 */}
                {currentPage === 1 && isFirstStep && (
                  <Draggable
                    nodeRef={qrNodeRef as RefObject<HTMLElement>}
                    position={{ x: qrState.x, y: qrState.y }}
                    onStop={(_, d) => setQrState((p) => ({ ...p, x: d.x, y: d.y }))}
                    bounds={boundsIn(templateQrBox, qrState.w, qrState.h)}
                    cancel={`.${RESIZE_HANDLE_CLASS},button,button *,a,.no-drag`}
                  >
                    <div
                      ref={qrNodeRef}
                      className="absolute top-0 left-0 cursor-move"
                      style={{ zIndex: 12 }}
                    >
                      <Resizable
                        size={{ width: qrState.w, height: qrState.h }}
                        onResizeStop={(_, __, ___, delta) =>
                          setQrState((p) => ({ ...p, w: p.w + delta.width, h: p.h + delta.height }))}
                        enable={{ right: true, bottom: true, bottomRight: true }}
                        minWidth={32} minHeight={32}
                        {...maxSizeIn(templateQrBox, qrState)}
                        handleComponent={{ bottomRight: <ResizeHandleIcon color="#7c3aed" title="Kéo để co giãn mã QR" /> }}
                        handleClasses={{ bottomRight: RESIZE_HANDLE_CLASS }}
                        handleStyles={{ bottomRight: RESIZE_HANDLE_STYLE }}
                      >
                        <div className="w-full h-full border-2 border-dashed border-blue-400 bg-white/80 rounded flex items-center justify-center select-none overflow-hidden p-0.5">
                          <QRCodeSVG
                            value={`${typeof window !== "undefined" ? window.location.origin : "https://qlsxkpt.vercel.app"}/dashboard/iso/forms/${instanceId}`}
                            size={Math.max(24, qrState.h - 6)}
                            level="L"
                          />
                        </div>
                      </Resizable>
                    </div>
                  </Draggable>
                )}

                {/* Signature — strictly locked to mainBoxPage */}
                {currentPage === mainBoxPage && (
                  <Draggable
                    nodeRef={sigNodeRef as RefObject<HTMLElement>}
                    position={{ x: sigState.x, y: sigState.y }}
                    onStop={(_, d) => setSigState((p) => ({ ...p, x: d.x, y: d.y }))}
                    bounds={boundsIn(templateBox, sigState.w, sigState.h)}
                    cancel={`.${RESIZE_HANDLE_CLASS},button,button *,a,.no-drag`}
                  >
                    <div
                      ref={sigNodeRef}
                      className="absolute top-0 left-0 cursor-move"
                      style={{ zIndex: 11 }}
                    >
                      <Resizable
                        size={{ width: sigState.w, height: sigState.h }}
                        onResizeStop={(_, __, ___, delta) =>
                          setSigState((p) => ({ ...p, w: p.w + delta.width, h: p.h + delta.height }))}
                        enable={{ right: true, bottom: true, bottomRight: true }}
                        minWidth={40} minHeight={20}
                        {...maxSizeIn(templateBox, sigState)}
                        handleComponent={{ bottomRight: <ResizeHandleIcon color="#059669" title="Kéo để co giãn khung chữ ký" /> }}
                        handleClasses={{ bottomRight: RESIZE_HANDLE_CLASS }}
                        handleStyles={{ bottomRight: RESIZE_HANDLE_STYLE }}
                      >
                        <div className="w-full h-full border border-dashed border-emerald-400 bg-emerald-50/60 rounded relative select-none">
                          {signatureUrl ? (
                            <img src={signatureUrl} alt="Chữ ký" className="w-full h-full object-contain opacity-90" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-[10px] text-slate-400">Chữ ký</span>
                            </div>
                          )}
                        </div>
                      </Resizable>
                    </div>
                  </Draggable>
                )}

                {/* Name — strictly locked to mainBoxPage */}
                {currentPage === mainBoxPage && tmplAllowName && (
                  <Draggable
                    nodeRef={nameNodeRef as RefObject<HTMLElement>}
                    position={{ x: nameState.x, y: nameState.y }}
                    onStop={(_, d) => setNameState((p) => ({ ...p, x: d.x, y: d.y }))}
                    bounds={boundsIn(templateBox, nameState.w, nameState.h)}
                    cancel={`.${RESIZE_HANDLE_CLASS},button,button *,a,.no-drag`}
                  >
                    <div
                      ref={nameNodeRef}
                      className="absolute top-0 left-0 cursor-move"
                      style={{ zIndex: 11 }}
                    >
                      <Resizable
                        size={{ width: nameState.w, height: nameState.h }}
                        onResizeStop={(_, __, ___, delta) =>
                          setNameState((p) => ({ ...p, w: p.w + delta.width, h: p.h + delta.height }))}
                        enable={{ right: true, bottom: true, bottomRight: true }}
                        minWidth={50} minHeight={16}
                        {...maxSizeIn(templateBox, nameState)}
                        handleComponent={{ bottomRight: <ResizeHandleIcon color="#7c3aed" title="Kéo để co giãn khung họ tên" /> }}
                        handleClasses={{ bottomRight: RESIZE_HANDLE_CLASS }}
                        handleStyles={{ bottomRight: RESIZE_HANDLE_STYLE }}
                      >
                        <div className="w-full h-full border border-dashed border-violet-400 bg-violet-50/60 rounded relative select-none flex items-center justify-center">
                          {showName ? (
                            <span
                              className="font-bold text-violet-700 truncate px-1"
                              style={previewTextStyle(userName || "Người ký", nameState.w)}
                            >
                              {userName || "Người ký"}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">Ẩn tên</span>
                          )}
                          <div className="absolute -top-3 -right-3 flex items-center gap-1" style={{ zIndex: 20 }}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              onTouchEnd={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); setShowName((v) => !v) }}
                              className="w-7 h-7 sm:w-5 sm:h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600 active:scale-95 transition-transform"
                              title={showName ? "Ẩn tên" : "Hiện tên"}
                            >
                              {showName ? <Eye size={12} /> : <EyeOff size={12} />}
                            </button>
                          </div>
                        </div>
                      </Resizable>
                    </div>
                  </Draggable>
                )}

                {/* Chức vụ — khối kéo-thả thứ 3, ĐỘC LẬP với chữ ký và tên (vị trí riêng, công
                    tắc riêng). Chỉ dựng khi mẫu CHO PHÉP và người ký đã khai chức vụ trong Nhân sự bảo trì. */}
                {currentPage === mainBoxPage && tmplAllowChucVu && !!userChucVu && (
                  <Draggable
                    nodeRef={cvNodeRef as RefObject<HTMLElement>}
                    position={{ x: cvState.x, y: cvState.y }}
                    onStop={(_, d) => setCvState((p) => ({ ...p, x: d.x, y: d.y }))}
                    bounds={boundsIn(templateBox, cvState.w, cvState.h)}
                    cancel={`.${RESIZE_HANDLE_CLASS},button,button *,a,.no-drag`}
                  >
                    <div
                      ref={cvNodeRef}
                      className="absolute top-0 left-0 cursor-move"
                      style={{ zIndex: 11 }}
                    >
                      <Resizable
                        size={{ width: cvState.w, height: cvState.h }}
                        onResizeStop={(_, __, ___, delta) =>
                          setCvState((p) => ({ ...p, w: p.w + delta.width, h: p.h + delta.height }))}
                        enable={{ right: true, bottom: true, bottomRight: true }}
                        minWidth={45} minHeight={14}
                        {...maxSizeIn(templateBox, cvState)}
                        handleComponent={{ bottomRight: <ResizeHandleIcon color="#0284c7" title="Kéo để co giãn khung chức vụ" /> }}
                        handleClasses={{ bottomRight: RESIZE_HANDLE_CLASS }}
                        handleStyles={{ bottomRight: RESIZE_HANDLE_STYLE }}
                      >
                        <div className="w-full h-full border border-dashed border-sky-400 bg-sky-50/60 rounded relative select-none flex items-center justify-center">
                          {showChucVu ? (
                            <span
                              className="text-sky-700 truncate px-1"
                              style={previewTextStyle(userChucVu, cvState.w)}
                            >
                              {userChucVu}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">Ẩn chức vụ</span>
                          )}
                          <div className="absolute -top-3 -right-3 flex items-center gap-1" style={{ zIndex: 20 }}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              onTouchEnd={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); setShowChucVu((v) => !v) }}
                              className="w-7 h-7 sm:w-5 sm:h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600 active:scale-95 transition-transform"
                              title={showChucVu ? "Ẩn chức vụ" : "Hiện chức vụ"}
                            >
                              {showChucVu ? <Eye size={12} /> : <EyeOff size={12} />}
                            </button>
                          </div>
                        </div>
                      </Resizable>
                    </div>
                  </Draggable>
                )}

                {/* Tiền tố ký thay (KT./TM./TL./TUQ.) — chỉ bước cuối Phê duyệt, chỉ hiện khi đã chọn */}
                {currentPage === mainBoxPage && isFinalStep && signAs !== "none" && (
                  <Draggable
                    nodeRef={prefixNodeRef as RefObject<HTMLElement>}
                    position={{ x: prefixState.x, y: prefixState.y }}
                    onStop={(_, d) => setPrefixState((p) => ({ ...p, x: d.x, y: d.y }))}
                    bounds={boundsIn(templateBox, prefixState.w, prefixState.h)}
                    cancel={`.${RESIZE_HANDLE_CLASS},button,button *,a,.no-drag`}
                  >
                    <div ref={prefixNodeRef} className="absolute top-0 left-0 cursor-move" style={{ zIndex: 11 }}>
                      <Resizable
                        size={{ width: prefixState.w, height: prefixState.h }}
                        onResizeStop={(_, __, ___, delta) =>
                          setPrefixState((p) => ({ ...p, w: p.w + delta.width, h: p.h + delta.height }))}
                        enable={{ right: true, bottom: true, bottomRight: true }}
                        minWidth={36} minHeight={16}
                        handleComponent={{ bottomRight: <ResizeHandleIcon color="#059669" title="Kéo để co giãn khung tiền tố ký thay" /> }}
                        handleClasses={{ bottomRight: RESIZE_HANDLE_CLASS }}
                        handleStyles={{ bottomRight: RESIZE_HANDLE_STYLE }}
                      >
                        <div className="w-full h-full border border-dashed border-emerald-400 bg-emerald-50/60 rounded relative select-none flex items-center justify-center">
                          <span className="text-[10px] font-bold text-emerald-700 truncate px-1">{signAs}.</span>
                        </div>
                      </Resizable>
                    </div>
                  </Draggable>
                )}

                {/* Extra duplicate signature and name boxes (hiển thị theo đúng trang được đặt) */}
                {extraSigBoxes
                  .filter((box) => (box.page || 1) === currentPage)
                  .map((box, idx) => (
                  <Fragment key={box.id}>
                    <ExtraDraggableBox
                      position={{ x: box.sigX, y: box.sigY }}
                      onStop={(_, d) => setExtraSigBoxes((prev) => prev.map((b) => b.id === box.id ? { ...b, sigX: d.x, sigY: d.y } : b))}
                    >
                      <Resizable
                        size={{ width: box.sigW, height: box.sigH }}
                        onResizeStop={(_, __, ___, delta) =>
                          setExtraSigBoxes((prev) => prev.map((b) => b.id === box.id ? { ...b, sigW: b.sigW + delta.width, sigH: b.sigH + delta.height } : b))}
                        enable={{ right: true, bottom: true, bottomRight: true }}
                        minWidth={40} minHeight={20}
                        handleComponent={{ bottomRight: <ResizeHandleIcon color="#059669" title="Kéo để co giãn khung chữ ký bản sao" /> }}
                        handleClasses={{ bottomRight: RESIZE_HANDLE_CLASS }}
                        handleStyles={{ bottomRight: RESIZE_HANDLE_STYLE }}
                      >
                        <div className="w-full h-full border border-dashed border-emerald-500 bg-emerald-50/70 rounded relative select-none">
                          {box.showSignature && signatureUrl && (
                            <img src={signatureUrl} alt="Chữ ký bản sao" className="w-full h-full object-contain opacity-90" />
                          )}
                          {box.showSignature && !signatureUrl && (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-[10px] text-slate-400">Chữ ký bản sao {idx + 1}</span>
                            </div>
                          )}
                          {!box.showSignature && (
                            <div className="w-full h-full flex items-center justify-center bg-slate-100/80">
                              <span className="text-[10px] text-slate-400">Ẩn chữ ký bản sao</span>
                            </div>
                          )}
                          <div className="absolute -top-3 -right-3 flex items-center gap-1" style={{ zIndex: 20 }}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              onTouchEnd={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); setExtraSigBoxes((prev) => prev.filter((b) => b.id !== box.id)) }}
                              className="w-7 h-7 sm:w-5 sm:h-5 bg-red-500 border border-red-600 text-white rounded-full shadow flex items-center justify-center hover:bg-red-600 text-xs font-bold active:scale-95 transition-transform"
                              title="Tắt / Xóa bản sao này"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      </Resizable>
                    </ExtraDraggableBox>

                    <ExtraDraggableBox
                      position={{ x: box.nameX, y: box.nameY }}
                      onStop={(_, d) => setExtraSigBoxes((prev) => prev.map((b) => b.id === box.id ? { ...b, nameX: d.x, nameY: d.y } : b))}
                    >
                      <Resizable
                        size={{ width: box.nameW, height: box.nameH }}
                        onResizeStop={(_, __, ___, delta) =>
                          setExtraSigBoxes((prev) => prev.map((b) => b.id === box.id ? { ...b, nameW: b.nameW + delta.width, nameH: b.nameH + delta.height } : b))}
                        enable={{ right: true, bottom: true, bottomRight: true }}
                        minWidth={50} minHeight={16}
                        handleComponent={{ bottomRight: <ResizeHandleIcon color="#7c3aed" title="Kéo để co giãn khung họ tên bản sao" /> }}
                        handleClasses={{ bottomRight: RESIZE_HANDLE_CLASS }}
                        handleStyles={{ bottomRight: RESIZE_HANDLE_STYLE }}
                      >
                        <div className="w-full h-full border border-dashed border-violet-400 bg-violet-50/70 rounded relative select-none flex items-center justify-center">
                          {box.showSignerName ? (
                            <span
                              className="font-bold text-violet-700 truncate px-1"
                              style={previewTextStyle(userName || "Người ký", box.nameW)}
                            >
                              {userName || "Người ký"}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">Ẩn tên bản sao</span>
                          )}
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setExtraSigBoxes((prev) => prev.map((b) => b.id === box.id ? { ...b, showSignerName: !b.showSignerName } : b)) }}
                            className="absolute -top-3 -right-3 w-7 h-7 sm:w-5 sm:h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600 active:scale-95 transition-transform"
                            style={{ zIndex: 20 }}
                            title={box.showSignerName ? "Ẩn tên bản sao" : "Hiện tên bản sao"}
                          >
                            {box.showSignerName ? <Eye size={12} /> : <EyeOff size={12} />}
                          </button>
                        </div>
                      </Resizable>
                    </ExtraDraggableBox>
                  </Fragment>
                ))}
              </>
            )}
          </div>
        ) : autoConvertPdf ? (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl max-w-md">
            <p className="text-sm font-bold text-amber-800 mb-2">File Office — ký theo tag, convert PDF khi phê duyệt</p>
            <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
              <li>Mỗi bước ký sẽ thay thế tag chữ ký tương ứng trong file</li>
              <li>Sau bước phê duyệt cuối, CloudConvert sẽ tạo PDF từ file đã ký</li>
            </ul>
          </div>
        ) : (
          <div className="p-4 bg-sky-50 border border-sky-200 rounded-xl max-w-md">
            <p className="text-sm font-bold text-sky-800 mb-2">File Office — tag sẽ được thay tự động</p>
            <div className="space-y-1 text-xs text-sky-700">
              <div className="flex items-center gap-2">
                <span className="font-mono bg-sky-100 px-1.5 py-0.5 rounded">{sigTag}</span>
                <span>→ chữ ký của bạn (PNG)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono bg-sky-100 px-1.5 py-0.5 rounded">{nameTag}</span>
                <span>→ tên người ký</span>
              </div>
              {isFirstStep && (
                <div className="flex items-center gap-2">
                  <span className="font-mono bg-sky-100 px-1.5 py-0.5 rounded">{"{{QR}}"}</span>
                  <span>→ mã QR liên kết hồ sơ</span>
                </div>
              )}
              <p className="text-sky-500 mt-1">Tag không có trong file sẽ được bỏ qua.</p>
            </div>
          </div>
        )}
        </div>
      </div>

      <div className="border-t border-slate-100 bg-white px-5 py-4 space-y-3 shrink-0">
        {showSignAsPicker && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ký thay (tùy chọn)</label>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
                <input
                  type="radio"
                  name="iso-form-sign-as"
                  checked={signAs === "none"}
                  onChange={() => setSignAs("none")}
                />
                Ký trực tiếp
              </label>
              {SIGN_AS_OPTIONS.map((opt) => (
                <label key={opt} className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="radio"
                    name="iso-form-sign-as"
                    checked={signAs === opt}
                    onChange={() => setSignAs(opt)}
                  />
                  {SIGN_AS_LABEL[opt]}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Khung nhập Ghi chú / Ý kiến xử lý khi mẫu có khung ghi_chu (chỉ ở bước phê duyệt) */}
        {isFinalStep && ghiChuBox && (
          <div className={`rounded-xl border px-3 py-2.5 ${ghiChuOff ? "border-slate-200 bg-slate-50" : "border-teal-200 bg-teal-50/60"}`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                Ý kiến chỉ đạo / Ghi chú <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => { setGhiChuOff((v) => !v); setConfirmError("") }}
                className={`text-[11px] font-bold px-2 py-1 rounded-lg border transition-colors ${ghiChuOff ? "bg-white border-teal-300 text-teal-700 hover:bg-teal-50" : "bg-white border-slate-300 text-slate-500 hover:bg-slate-50"}`}
              >
                {ghiChuOff ? "Bật lại khung Ghi chú" : "Không ghi ý kiến"}
              </button>
            </div>
            {ghiChuOff ? (
              <p className="text-[11px] text-slate-500 italic">
                Khung Ghi chú sẽ bị bỏ trống — không đóng dấu ý kiến lẫn chữ ký nháy lên hồ sơ.
              </p>
            ) : (
              <>
                <textarea
                  rows={2}
                  value={userNote}
                  onChange={(e) => { setUserNote(e.target.value); setConfirmError("") }}
                  placeholder="Nhập ý kiến chỉ đạo hoặc ghi chú xử lý..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-800 outline-none focus:border-teal-500 resize-y"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Nội dung sẽ được đóng vào khung Ghi chú trên hồ sơ, kèm chữ ký nháy của bạn ở góc trên-phải khung.
                </p>
              </>
            )}
          </div>
        )}

        {(confirmError || errorMessage) && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" /> <span>{confirmError || errorMessage}</span>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
          <button
            onClick={handleConfirm}
            disabled={acting}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl"
          >
            {acting ? <Loader2 size={13} className="animate-spin" /> : <Pen size={13} />}
            {acting ? "Đang xử lý..." : "Ký xác nhận"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function IsoFormInstancePage() {
  const params = useParams()
  const instanceId = params.id as string
  const router = useRouter()
  const searchParams = useSearchParams()

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [userName, setUserName] = useState("")
  const [userRole, setUserRole] = useState<string | null>(null)
  const [userChucVu, setUserChucVu] = useState("")
  // Biểu mẫu này đã có mẫu vị trí ký chưa — nguồn sự thật là bảng `mau_vi_tri`, KHÔNG dùng cờ
  // tạm trong state hay query param: người ký có thể vào trang từ link trực tiếp, F5 giữa
  // chừng, hoặc mẫu do người khác vẽ từ hồ sơ khác của cùng biểu mẫu.
  // `null` = đang kiểm tra (chưa biết) → chưa chặn vội, tránh nháy nút.
  const [templateExists, setTemplateExists] = useState<boolean | null>(null)

  useEffect(() => {
    if (searchParams?.get("confirmedSignTemplate") === "1") {
      setTemplateExists(true)
    }
  }, [searchParams])
  const [loading, setLoading] = useState(true)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [rightTab, setRightTab] = useState<"timeline" | "config">("timeline")

  const [instance, setInstance] = useState<IsoFormInstance | null>(null)
  const [template, setTemplate] = useState<Pick<IsoDocument, "id" | "ten_tai_lieu" | "ma_tai_lieu" | "loai_tai_lieu" | "phong_ban" | "lan_ban_hanh"> & { file_signed_pdf_url?: string | null; file_goc_url?: string | null; mo_ta_tim_kiem?: string | null } | null>(null)
  const [logs, setLogs] = useState<LogRow[]>([])
  const [logUserNames, setLogUserNames] = useState<Record<string, string>>({})

  // Config state (editable when draft/tra_ve)
  const [cap_tl, setCapTl] = useState("Cấp 1")
  const [xemXetUserId, setXemXetUserId] = useState("")
  const [pheDuyetUserId, setPheDuyetUserId] = useState("")
  const [autoConvertPdf, setAutoConvertPdf] = useState(false)
  const [ghiChu, setGhiChu] = useState("")
  const [profilesXemXet, setProfilesXemXet] = useState<ProfileOption[]>([])
  const [profilesPheDuyet, setProfilesPheDuyet] = useState<ProfileOption[]>([])
  const [allApproverProfiles, setAllApproverProfiles] = useState<ProfileOption[]>([])
  const [steps, setSteps] = useState<ThuTuKyStep[]>([])
  const stepsRef = useRef<ThuTuKyStep[]>(steps)
  stepsRef.current = steps

  // Cache danh sách nhân sự theo phòng ban
  const [deptUsersCache, setDeptUsersCache] = useState<Record<string, ProfileOption[]>>({})
  const [deptUsersLoading, setDeptUsersLoading] = useState<Record<string, boolean>>({})

  // Đổi người ký
  const [doiNguoiKyOpen, setDoiNguoiKyOpen] = useState(false)
  const [doiNguoiKySaving, setDoiNguoiKySaving] = useState(false)

  // File upload
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [docxPreviewHtml, setDocxPreviewHtml] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Action states
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [signModal, setSignModal] = useState<{
    action: "soan_thao" | "xem_xet" | "phe_duyet" | "ky_buoc"
    stepIndex?: number
    totalSteps?: number
    sourceFileUrl: string | null
  } | null>(null)
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [showDistributeModal, setShowDistributeModal] = useState(false)
  const [signLoading, setSignLoading] = useState(false)

  // Bootstrap
  useEffect(() => {
    const bootstrap = async () => {
      try {
        const fid = await getActiveFactoryId()
        if (!fid) { setLoading(false); return }
        const { session, user: authUser } = await hydrateActiveSession()
        const uid = session?.user?.id
        if (!uid) { setLoading(false); return }
        setFactoryId(fid)
        setUserId(uid)
        setCurrentUser(authUser)
        // Load user profile for full name & role
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, username, role")
          .eq("id", uid)
          .single()
        if (profile) {
          setUserName((profile.full_name as string) || (profile.username as string) || "")
          setUserRole((profile.role as string) || null)
        }
        // Chức vụ để đóng dấu — nguồn chuẩn của toàn app là hồ sơ Nhân sự bảo trì (liên kết
        // tài khoản qua `profile_id`), KHÔNG phải `profiles`. Ưu tiên chức vụ chính quyền,
        // đúng thứ tự đang dùng ở module Văn bản và Soạn thảo ISO.
        const { data: staff } = await supabase
          .from("maintenance_staff")
          .select("chuc_vu, chuc_vu_chinh_quyen")
          .eq("factory_id", fid)
          .eq("profile_id", uid)
          .eq("active", true)
          .maybeSingle()
        if (staff) {
          setUserChucVu(
            (staff.chuc_vu_chinh_quyen as string) || (staff.chuc_vu as string) || "",
          )
        }
        // Load user's signature URL — vá bảo mật 2026-09-20: mint Signed URL thay vì
        // getPublicUrl() trực tiếp (bucket iso-documents sẽ chuyển private).
        const sigResult = await fetchSecureUrl(`/api/account/signature-url?userId=${encodeURIComponent(uid)}`)
        if (sigResult.ok) setSignatureUrl(sigResult.url)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  const loadDeptUsers = useCallback(async (deptCode: string) => {
    if (!factoryId || !deptCode) return
    setDeptUsersLoading((prev) => ({ ...prev, [deptCode]: true }))
    try {
      const res = await fetch(`/api/documents/dept-users?factoryId=${factoryId}&dept=${encodeURIComponent(deptCode)}&leadership=false`)
      if (res.ok) {
        const data = await res.json() as ProfileOption[]
        if (Array.isArray(data)) {
          setDeptUsersCache((prev) => ({ ...prev, [deptCode]: data }))
        }
      }
    } catch (err) {
      console.error("Lỗi tải nhân sự theo phòng ban:", err)
    } finally {
      setDeptUsersLoading((prev) => ({ ...prev, [deptCode]: false }))
    }
  }, [factoryId])

  const loadInstance = useCallback(async (fid: string): Promise<IsoFormInstance | null> => {
    const { data: inst } = await supabase
      .from("iso_form_instances")
      .select("*")
      .eq("id", instanceId)
      .eq("factory_id", fid)
      .single()
    if (!inst) return null

    const row = inst as IsoFormInstance
    setInstance(row)
    setCapTl(row.cap_tl)
    setXemXetUserId(row.xem_xet_user_id ?? "")
    setPheDuyetUserId(row.phe_duyet_user_id ?? "")
    setAutoConvertPdf(row.auto_convert_pdf)
    setGhiChu(row.ghi_chu ?? "")

    const isDraftState = row.trang_thai === "draft" || row.trang_thai === "tra_ve" || ((row.buoc_hien_tai ?? 0) === 0 && !row.ky_soan_thao_at)
    setRightTab(isDraftState ? "config" : "timeline")

    if ((row.so_buoc_tong ?? 0) > 0 && Array.isArray(row.thu_tu_ky_json) && row.thu_tu_ky_json.length > 0) {
      setSteps(row.thu_tu_ky_json as ThuTuKyStep[])
      const depts = Array.from(new Set(row.thu_tu_ky_json.map((s: ThuTuKyStep) => s.phong_ban_code).filter(Boolean))) as string[]
      depts.forEach((d) => void loadDeptUsers(d))
    } else if (stepsRef.current.length > 0) {
      // Đang có danh sách bước hợp lệ trên state (ví dụ vừa upload file hoặc đang chỉnh dở) -> bảo lưu, không reset về defaultSteps
    } else if (row.trang_thai === "draft" || row.trang_thai === "tra_ve") {
      const creatorId = row.nguoi_tao || userId || ""
      const defaultSteps: ThuTuKyStep[] = [
        { step: 1, type: "ca_nhan", user_id: creatorId, ten: "Người lập" },
      ]
      if (row.cap_tl === "Cấp 1" && row.xem_xet_user_id) {
        defaultSteps.push({ step: 2, type: "ca_nhan", user_id: row.xem_xet_user_id, ten: "Xem xét" })
      }
      defaultSteps.push({
        step: defaultSteps.length + 1,
        type: "ca_nhan",
        user_id: row.phe_duyet_user_id || "",
        ten: "Phê duyệt",
      })
      setSteps(defaultSteps)
    }

    const { data: tmpl } = await supabase
      .from("iso_documents")
      .select("id, ten_tai_lieu, ma_tai_lieu, loai_tai_lieu, phong_ban, lan_ban_hanh, file_signed_pdf_url, file_goc_url, mo_ta_tim_kiem")
      .eq("id", row.template_doc_id)
      .single()
    if (tmpl) setTemplate(tmpl as typeof template)

    const { data: logData } = await supabase
      .from("iso_form_instance_logs")
      .select("id, user_id, action, note, created_at")
      .eq("instance_id", instanceId)
      .order("created_at", { ascending: false })
    const rows = (logData ?? []) as LogRow[]
    setLogs(rows)

    const stepUids = Array.isArray(row.thu_tu_ky_json)
      ? (row.thu_tu_ky_json as ThuTuKyStep[]).map((s) => s.user_id).filter(Boolean)
      : []
    const uids = Array.from(new Set([
      ...rows.map((r) => r.user_id),
      row.nguoi_tao,
      row.xem_xet_user_id,
      row.phe_duyet_user_id,
      ...stepUids,
    ].filter(Boolean))) as string[]

    if (uids.length > 0) {
      void (async () => {
        try {
          const map: Record<string, string> = {}
          if (row.nguoi_tao && row.soan_thao) map[row.nguoi_tao] = row.soan_thao
          if (row.xem_xet_user_id && row.xem_xet) map[row.xem_xet_user_id] = row.xem_xet
          if (row.phe_duyet_user_id && row.phe_duyet) map[row.phe_duyet_user_id] = row.phe_duyet

          const { data: profs } = await supabase
            .from("profiles")
            .select("id, full_name, username")
            .in("id", uids)
          if (profs && profs.length > 0) {
            for (const p of profs) {
              map[p.id] = (p.full_name as string) || (p.username as string) || ""
            }
          }
          if (Object.keys(map).length > 0) {
            setLogUserNames((prev) => ({ ...prev, ...map }))
          }
        } catch {
          // ignore
        }
      })()
    }
    return row
  }, [instanceId, userId, loadDeptUsers])

  const loadProfiles = useCallback(async (fid: string) => {
    const [resX, resP] = await Promise.all([
      fetch(`/api/iso/profiles-by-permission?factoryId=${fid}&permCode=iso.forms.approve`),
      fetch(`/api/iso/profiles-by-permission?factoryId=${fid}&permCode=iso.forms.approve`),
    ])
    const dataX = resX.ok ? (await resX.json() as { profiles?: ProfileOption[] }) : {}
    const dataP = resP.ok ? (await resP.json() as { profiles?: ProfileOption[] }) : {}
    const px = Array.isArray(dataX.profiles) ? dataX.profiles : []
    const pp = Array.isArray(dataP.profiles) ? dataP.profiles : []
    setProfilesXemXet(px)
    setProfilesPheDuyet(pp)

    const map = new Map<string, ProfileOption>()
    px.forEach((p) => map.set(p.id, p))
    pp.forEach((p) => map.set(p.id, p))
    setAllApproverProfiles(Array.from(map.values()))
  }, [])

  const getLogUserName = useCallback((uid: string) => {
    if (!uid) return ""
    if (logUserNames[uid]) return logUserNames[uid]
    const found = allApproverProfiles.find((p) => p.id === uid)
    if (found?.full_name) return found.full_name
    if (uid === instance?.nguoi_tao && instance?.soan_thao) return instance.soan_thao
    if (uid === instance?.xem_xet_user_id && instance?.xem_xet) return instance.xem_xet
    if (uid === instance?.phe_duyet_user_id && instance?.phe_duyet) return instance.phe_duyet
    return ""
  }, [logUserNames, allApproverProfiles, instance])

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        step: prev.length + 1,
        type: "ca_nhan",
        user_id: "",
        ten: `Bước ${prev.length + 1}`,
      },
    ])
  }

  const removeStep = (index: number) => {
    if (steps.length <= 1) return
    setSteps((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, step: i + 1 })))
  }

  const moveStep = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= steps.length) return
    setSteps((prev) => {
      const next = [...prev]
      const temp = next[index]
      next[index] = next[targetIndex]
      next[targetIndex] = temp
      return next.map((s, i) => ({ ...s, step: i + 1 }))
    })
  }

  const updateStep = (index: number, patch: Partial<ThuTuKyStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  const handleStepDeptChange = (index: number, deptCode: string) => {
    updateStep(index, {
      phong_ban_code: deptCode || undefined,
      type: deptCode ? "phong_ban" : "ca_nhan",
    })
    if (deptCode) {
      void loadDeptUsers(deptCode)
    }
  }

  const handleStepSignerChange = (index: number, newUserId: string) => {
    const step = steps[index]
    const deptList = step?.phong_ban_code ? deptUsersCache[step.phong_ban_code] : undefined
    const profile = (deptList && deptList.find((p) => p.id === newUserId))
      || allApproverProfiles.find((p) => p.id === newUserId)
      || (newUserId === userId ? { id: newUserId, full_name: userName, username: userName } : null)

    const currentTen = (step?.ten || "").trim()
    updateStep(index, {
      user_id: newUserId,
      ten: currentTen ? currentTen : (profile ? profileLabel(profile) : undefined),
    })
  }

  useEffect(() => {
    if (factoryId) {
      void loadInstance(factoryId)
      void loadProfiles(factoryId)
    }
  }, [factoryId, loadInstance, loadProfiles])

  // Kiểm tra biểu mẫu đã có mẫu vị trí ký chưa (dùng CHÍNH bộ khoá mà modal ký nạp mẫu, để
  // "có mẫu" ở đây đúng bằng "modal sẽ đặt được vị trí").
  useEffect(() => {
    const ma = template?.ma_tai_lieu
    const loai = template?.loai_tai_lieu
    if (!factoryId || (!ma && !loai)) return
    let alive = true
    const run = async () => {
      const keys: string[] = []
      if (ma) keys.push(`iso:code:${ma}`, `iso:loai:${ma}`, ma)
      if (loai) keys.push(`iso:loai:${loai}`, `iso:${loai}`, loai)
      try {
        const { data } = await supabase
          .from("mau_vi_tri")
          .select("id, khung")
          .eq("factory_id", factoryId)
          .in("loai_tai_lieu", keys)
          .limit(1)
        if (alive) {
          const hasValidKhung = (data?.length ?? 0) > 0 && Array.isArray((data as any)[0]?.khung) && (data as any)[0].khung.length > 0
          setTemplateExists(hasValidKhung)
        }
      } catch {
        // Lỗi mạng → để `null`, KHÔNG chặn gửi ký (thà cho gửi còn hơn khoá cứng người dùng
        // ngoài hiện trường vì một lần query hỏng).
        if (alive) setTemplateExists(null)
      }
    }
    void run()
    return () => { alive = false }
  }, [factoryId, template?.ma_tai_lieu, template?.loai_tai_lieu])

  // ── Upload file ──────────────────────────────────────────────────────────
  const handleUpload = async (file?: File) => {
    const fileToUpload = file ?? uploadFile
    if (!fileToUpload || !factoryId || !instance) return
    setUploading(true)
    setUploadError(null)
    try {
      const ext = fileToUpload.name.split(".").pop()?.toLowerCase() ?? "docx"
      const shouldAutoConvert = true
      setAutoConvertPdf(shouldAutoConvert)
      // Đặt storage path versioned kèm timestamp để loại trừ triệt để lỗi dính HTTP Cache của trình duyệt / CDN
      const timestamp = Date.now()
      const storagePath = `${factoryId}/iso/instances/${instanceId}/draft_${timestamp}.${ext}`
      const { error } = await supabase.storage.from("iso-documents").upload(storagePath, fileToUpload, { upsert: true })
      if (error) { setUploadError(error.message); return }
      const { data: urlData } = supabase.storage.from("iso-documents").getPublicUrl(storagePath)
      const freshDraftUrl = `${urlData.publicUrl}?v=${timestamp}`

      // Khi thay file mới: BẮT BUỘC reset toàn bộ các trường file đã ký và con dấu của lần trước
      // để modal ký và màn cài đặt vị trí không bị nạp nhầm file cũ.
      const updateData: Record<string, unknown> = {
        draft_file_url: freshDraftUrl,
        draft_file_type: ext,
        soan_thao_signed_url: null,
        final_pdf_url: null,
        final_office_url: null,
        placement_ky: {},
        nguoi_ky: {},
        buoc_hien_tai: 0,
      }
      updateData.auto_convert_pdf = shouldAutoConvert

      // Đóng gói toàn bộ cấu hình phê duyệt hiện có trên UI để không bị reset khi nạp lại
      updateData.ghi_chu = ghiChu || null
      const currentSteps = stepsRef.current.length > 0 ? stepsRef.current : steps
      if (currentSteps.length > 0) {
        const formattedSteps: ThuTuKyStep[] = currentSteps.map((s, idx) => {
          const uid = stepSignerUserId(s) || ""
          const deptList = s.phong_ban_code ? deptUsersCache[s.phong_ban_code] : undefined
          const profile = (deptList && deptList.find((p) => p.id === uid))
            || (uid && allApproverProfiles.find((p) => p.id === uid))
            || (uid && profilesPheDuyet.find((p) => p.id === uid))
            || (uid && profilesXemXet.find((p) => p.id === uid))
            || (uid && userId && uid === userId ? { id: uid, full_name: userName, username: userName } : null)
          return {
            step: idx + 1,
            type: s.phong_ban_code ? "phong_ban" : "ca_nhan",
            phong_ban_code: s.phong_ban_code,
            phong_ban_name: s.phong_ban_name,
            user_id: uid,
            ten: s.ten?.trim() || (profile ? profileLabel(profile) : (idx === 0 ? "Người lập" : idx === currentSteps.length - 1 ? "Phê duyệt" : `Xem xét ${idx}`)),
            chuc_vu: s.chuc_vu,
          }
        })
        updateData.thu_tu_ky_json = formattedSteps
        updateData.so_buoc_tong = formattedSteps.length
        if (formattedSteps.length > 0) {
          const lastStep = formattedSteps[formattedSteps.length - 1]
          const lastUid = stepSignerUserId(lastStep) || null
          updateData.phe_duyet_user_id = lastUid
          const lastProfile = lastUid ? allApproverProfiles.find((p) => p.id === lastUid) : null
          updateData.phe_duyet = lastProfile ? profileLabel(lastProfile) : lastStep.ten || null
          if (formattedSteps.length > 2) {
            updateData.cap_tl = "Cấp 1"
            const revStep = formattedSteps[1]
            const revUid = stepSignerUserId(revStep) || null
            updateData.xem_xet_user_id = revUid
            const revProfile = revUid ? allApproverProfiles.find((p) => p.id === revUid) : null
            updateData.xem_xet = revProfile ? profileLabel(revProfile) : revStep.ten || null
          } else {
            updateData.cap_tl = "Cấp 2"
            updateData.xem_xet_user_id = null
            updateData.xem_xet = null
          }
        }
      } else {
        updateData.cap_tl = cap_tl
        updateData.phe_duyet_user_id = pheDuyetUserId || null
        updateData.phe_duyet = pheDuyetUserId ? profileLabel(profilesPheDuyet.find((p) => p.id === pheDuyetUserId) ?? { id: "", full_name: null, username: null }) : null
        if (cap_tl === "Cấp 1") {
          updateData.xem_xet_user_id = xemXetUserId || null
          updateData.xem_xet = xemXetUserId ? profileLabel(profilesXemXet.find((p) => p.id === xemXetUserId) ?? { id: "", full_name: null, username: null }) : null
        } else {
          updateData.xem_xet_user_id = null
          updateData.xem_xet = null
        }
      }

      const { error: upErr } = await supabase.from("iso_form_instances")
        .update(updateData)
        .eq("id", instanceId)
      if (upErr) { setUploadError(upErr.message); return }
      setUploadFile(null)
      setInstance((prev) => prev ? {
        ...prev,
        draft_file_url: freshDraftUrl,
        draft_file_type: ext,
        soan_thao_signed_url: null,
        final_pdf_url: null,
        final_office_url: null,
        placement_ky: null,
        nguoi_ky: null,
        buoc_hien_tai: 0,
      } : null)
      await loadInstance(factoryId)
      if (ext === "docx") void loadDocxPreview(fileToUpload)
    } finally {
      setUploading(false)
    }
  }

  const handleDownload = async () => {
    if (!fileUrl || !instance) return
    // Vá bảo mật 2026-09-20: `fileUrl` giờ chỉ là URL public CŨ lưu trong DB, không còn tải
    // được trực tiếp khi bucket private — mint Signed URL qua route riêng (server tự set
    // Content-Disposition theo tiêu đề hồ sơ), rồi mở URL đó thay vì tự fetch/blob.
    const result = await openSecureFile(`/api/iso/forms/${instanceId}/file-url?download=1`)
    if (!result.ok) setUploadError(result.error)
  }

  const loadDocxPreview = async (file: File) => {
    try {
      const mammoth = await import("mammoth")
      const arrayBuffer = await file.arrayBuffer()
      const result = await mammoth.convertToHtml({ arrayBuffer })
      setDocxPreviewHtml(result.value)
    } catch {
      setDocxPreviewHtml(null)
    }
  }

  // ── Send notify (fire-and-forget) ────────────────────────────────────────
  const sendNotify = (action: string, recipientUserIds: string[], lyDo?: string) => {
    if (!factoryId || !userId) return
    const ids = recipientUserIds.filter(Boolean)
    if (!ids.length) return
    void fetch("/api/iso/forms/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, factoryId, action, recipientUserIds: ids, lyDo, actorUserId: userId }),
    }).catch(() => {})
  }

  // ── Save config ──────────────────────────────────────────────────────────
  // ── Open sign modal ──────────────────────────────────────────────────────
  /**
   * Lưu cấu hình phê duyệt xuống DB rồi nạp lại hồ sơ.
   *
   * ⚠️ BẮT BUỘC gọi trước MỌI thao tác rời khỏi trang (mở modal ký, hoặc điều hướng sang màn
   * "Cài đặt vị trí ký").
   *
   * Trả về `null` nếu validate/ghi DB thất bại — nơi gọi phải dừng lại, KHÔNG đi tiếp.
   */
  const persistApprovalConfig = async (): Promise<IsoFormInstance | null> => {
    if (!instance || !factoryId) return null
    if (isNStep) {
      if (steps.length === 0) {
        setActionError("Vui lòng thiết lập ít nhất 1 bước ký")
        return null
      }
      const hasEmpty = steps.some((s) => !stepSignerUserId(s))
      if (hasEmpty) {
        setActionError("Vui lòng chọn người ký cho tất cả các bước")
        return null
      }
    } else {
      if (cap_tl === "Cấp 1" && !xemXetUserId) { setActionError("Vui lòng chọn người xem xét"); return null }
      if (!pheDuyetUserId) { setActionError("Vui lòng chọn người phê duyệt"); return null }
    }

    setSaving(true)
    setActionError(null)
    try {
      const updates: Record<string, unknown> = {
        auto_convert_pdf: autoConvertPdf,
        ghi_chu: ghiChu || null,
      }
      if (instance.trang_thai === "tra_ve" || instance.trang_thai === "draft") {
        updates.buoc_hien_tai = 0
      }

      if (isNStep) {
        const formattedSteps: ThuTuKyStep[] = steps.map((s, idx) => {
          const uid = stepSignerUserId(s) || ""
          const deptList = s.phong_ban_code ? deptUsersCache[s.phong_ban_code] : undefined
          const profile = (deptList && deptList.find((p) => p.id === uid))
            || (uid && allApproverProfiles.find((p) => p.id === uid))
            || (uid && profilesPheDuyet.find((p) => p.id === uid))
            || (uid && profilesXemXet.find((p) => p.id === uid))
            || (uid && userId && uid === userId ? { id: uid, full_name: userName, username: userName } : null)
          return {
            step: idx + 1,
            type: s.phong_ban_code ? "phong_ban" : "ca_nhan",
            phong_ban_code: s.phong_ban_code,
            phong_ban_name: s.phong_ban_name,
            user_id: uid,
            ten: s.ten?.trim() || (profile ? profileLabel(profile) : (idx === 0 ? "Người lập" : idx === steps.length - 1 ? "Phê duyệt" : `Xem xét ${idx}`)),
            chuc_vu: s.chuc_vu,
          }
        })
        updates.thu_tu_ky_json = formattedSteps
        updates.so_buoc_tong = formattedSteps.length
        if (formattedSteps.length > 0) {
          const lastStep = formattedSteps[formattedSteps.length - 1]
          const lastUid = stepSignerUserId(lastStep) || null
          updates.phe_duyet_user_id = lastUid
          const lastProfile = lastUid ? allApproverProfiles.find((p) => p.id === lastUid) : null
          updates.phe_duyet = lastProfile ? profileLabel(lastProfile) : lastStep.ten || null
          if (formattedSteps.length > 2) {
            updates.cap_tl = "Cấp 1"
            const revStep = formattedSteps[1]
            const revUid = stepSignerUserId(revStep) || null
            updates.xem_xet_user_id = revUid
            const revProfile = revUid ? allApproverProfiles.find((p) => p.id === revUid) : null
            updates.xem_xet = revProfile ? profileLabel(revProfile) : revStep.ten || null
          } else {
            updates.cap_tl = "Cấp 2"
            updates.xem_xet_user_id = null
            updates.xem_xet = null
          }
        }
      } else {
        updates.cap_tl = cap_tl
        updates.phe_duyet_user_id = pheDuyetUserId || null
        updates.phe_duyet = pheDuyetUserId ? profileLabel(profilesPheDuyet.find((p) => p.id === pheDuyetUserId) ?? { id: "", full_name: null, username: null }) : null
        if (cap_tl === "Cấp 1") {
          updates.xem_xet_user_id = xemXetUserId || null
          updates.xem_xet = xemXetUserId ? profileLabel(profilesXemXet.find((p) => p.id === xemXetUserId) ?? { id: "", full_name: null, username: null }) : null
        } else {
          updates.xem_xet_user_id = null
          updates.xem_xet = null
        }
      }

      const { error } = await supabase.from("iso_form_instances").update(updates).eq("id", instanceId)
      if (error) { setActionError(error.message); return null }

      // Gửi thông báo phân công cho Người soạn thảo (bước 1) nếu được gán cho người khác
      if (instance.trang_thai === "draft" && isNStep && Array.isArray(updates.thu_tu_ky_json)) {
        const fSteps = updates.thu_tu_ky_json as ThuTuKyStep[]
        const newStep1Uid = fSteps[0]?.user_id
        const prevStep1Uid = (instance.thu_tu_ky_json as ThuTuKyStep[])?.[0]?.user_id
        if (newStep1Uid && newStep1Uid !== userId && (newStep1Uid !== prevStep1Uid || !prevStep1Uid)) {
          sendNotify("phan_cong_soan_thao", [newStep1Uid])
        }
      }

      return await loadInstance(factoryId)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Lỗi lưu cài đặt")
      return null
    } finally {
      setSaving(false)
    }
  }

  const handleManualSaveConfig = async () => {
    const reloaded = await persistApprovalConfig()
    if (reloaded) {
      setActionSuccess("Đã lưu cấu hình phê duyệt thành công")
      setTimeout(() => setActionSuccess(null), 3000)
    }
  }

  const handleConfirmDoiNguoiKy = async (stepIndex: number, newUserId: string, newName: string, reason: string) => {
    if (!instance || !factoryId || !userId) return
    setDoiNguoiKySaving(true)
    setActionError(null)
    try {
      const curSteps: ThuTuKyStep[] = Array.isArray(instance.thu_tu_ky_json) && instance.thu_tu_ky_json.length > 0
        ? [...instance.thu_tu_ky_json]
        : [...steps]

      if (stepIndex < 0 || stepIndex >= curSteps.length) {
        setActionError("Bước ký không hợp lệ")
        return
      }

      const prevStep = curSteps[stepIndex]
      const prevName = prevStep.ten || prevStep.user_id || "Người ký cũ"

      curSteps[stepIndex] = {
        ...prevStep,
        user_id: newUserId,
        ten: newName,
      }

      const updates: Record<string, unknown> = {
        thu_tu_ky_json: curSteps,
      }

      if (stepIndex === curSteps.length - 1) {
        updates.phe_duyet_user_id = newUserId
        updates.phe_duyet = newName
      }
      if (curSteps.length > 2 && stepIndex === 1) {
        updates.xem_xet_user_id = newUserId
        updates.xem_xet = newName
      }

      const { error: upErr } = await supabase
        .from("iso_form_instances")
        .update(updates)
        .eq("id", instanceId)

      if (upErr) {
        setActionError(upErr.message)
        return
      }

      await supabase.from("iso_form_instance_logs").insert({
        instance_id: instanceId,
        factory_id: factoryId,
        user_id: userId,
        action: "doi_nguoi_ky",
        note: `Đổi người ký bước ${stepIndex + 1} (${stepDisplayLabel(prevStep)}) từ "${prevName}" sang "${newName}". Lý do: ${reason}`,
      })

      sendNotify("ky_buoc", [newUserId])

      setDoiNguoiKyOpen(false)
      setActionSuccess(`Đã đổi người ký bước ${stepIndex + 1} thành công`)
      setTimeout(() => setActionSuccess(null), 3500)
      void loadInstance(factoryId)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Lỗi đổi người ký")
    } finally {
      setDoiNguoiKySaving(false)
    }
  }

  // Vá bảo mật 2026-09-20: bucket `iso-documents` sẽ chuyển private — `SignPlacementModal` tự
  // `pdfjs.getDocument({url: sourceFileUrl})` trong trình duyệt, nên `sourceFileUrl` bắt buộc
  // phải là Signed URL, không còn được là URL public thô đọc thẳng từ cột DB. Route
  // `/api/iso/forms/[id]/file-url` tự tính đúng priority (draft khi đang editable, ưu tiên
  // final_pdf/final_office/soan_thao_signed khi đã gửi đi) — thay thế toàn bộ logic tự chọn
  // `draft_file_url`/`final_pdf_url`/`soan_thao_signed_url` từng viết tay ở mỗi hàm dưới đây
  // (đã đối chiếu: hội tụ về đúng cùng kết quả cho mọi trạng thái thực tế các hàm này chạy tới).
  // Signed URL luôn khác nhau mỗi lần mint nên tự thay thế được vai trò "cache-busting" của các
  // query param `?_ts=`/`?_nocache=` cũ, không cần giữ lại.
  const mintInstanceFileUrl = async (): Promise<string | null> => {
    const result = await fetchSecureUrl(`/api/iso/forms/${instanceId}/file-url`)
    if (!result.ok) {
      setUploadError(result.error)
      return null
    }
    return result.url
  }

  const openSendModal = async () => {
    if (!instance || !factoryId) return
    const reloaded = await persistApprovalConfig()
    if (!reloaded) return
    const fileSrc = await mintInstanceFileUrl()
    if (!fileSrc) return

    if ((reloaded.so_buoc_tong ?? 0) > 0) {
      setSignModal({
        action: (reloaded.so_buoc_tong ?? 1) === 1 ? "phe_duyet" : "ky_buoc",
        stepIndex: 0,
        totalSteps: reloaded.so_buoc_tong ?? 1,
        sourceFileUrl: fileSrc,
      })
    } else {
      setSignModal({ action: "soan_thao", sourceFileUrl: fileSrc })
    }
  }

  /** Lưu cấu hình TRƯỚC rồi mới sang màn cài đặt vị trí ký — xem cảnh báo ở `persistApprovalConfig`. */
  const goToTemplateSetup = async () => {
    const reloaded = await persistApprovalConfig()
    if (!reloaded || !templateSignSetupKey) return
    const useInstanceDraft = urlIsPdf(reloaded.draft_file_url)
    const templatePdfOk = !useInstanceDraft && !!template && (urlIsPdf(template.file_signed_pdf_url ?? null) || urlIsPdf(template.file_goc_url ?? null))
    if (!useInstanceDraft && !templatePdfOk) return
    const endpoint = useInstanceDraft
      ? `/api/iso/forms/${instanceId}/file-url`
      : `/api/iso/documents/${template!.id}/file-url?variant=main`
    const result = await fetchSecureUrl(endpoint)
    if (!result.ok) {
      setUploadError(result.error)
      return
    }
    const targetUrl = `/dashboard/ky/mau-vi-tri?modun=iso&loai=${encodeURIComponent(templateSignSetupKey)}`
      + `&pdfUrl=${encodeURIComponent(result.url)}`
      + `&docLabel=${encodeURIComponent(template?.ma_tai_lieu || template?.ten_tai_lieu || reloaded.tieu_de)}`
      + `&formInstanceId=${encodeURIComponent(instanceId)}`
      + `&returnTo=${encodeURIComponent(`/dashboard/iso/forms/${instanceId}?confirmedSignTemplate=1`)}`
    router.push(targetUrl)
  }

  const openSignStepModal = async () => {
    if (!instance) return
    const curIdx = instance.buoc_hien_tai ?? 0
    const total = instance.so_buoc_tong ?? 1
    const isFinalStep = curIdx + 1 >= total
    const src = await mintInstanceFileUrl()
    setSignModal({
      action: isFinalStep ? "phe_duyet" : "ky_buoc",
      stepIndex: curIdx,
      totalSteps: total,
      sourceFileUrl: src,
    })
  }

  const openXemXetModal = async () => {
    if (!instance) return
    const src = await mintInstanceFileUrl()
    setSignModal({ action: "xem_xet", sourceFileUrl: src })
  }

  const openPheDuyetModal = async () => {
    if (!instance) return
    const src = await mintInstanceFileUrl()
    setSignModal({ action: "phe_duyet", sourceFileUrl: src })
  }

  // ── Return ───────────────────────────────────────────────────────────────
  const handleReturn = async (lyDo: string) => {
    if (!factoryId || !instance) return
    const prevTrangThai = instance.trang_thai
    const prevCapTl = instance.cap_tl
    setShowReturnModal(false)
    setSaving(true)
    setActionError(null)
    try {
      const { error } = await supabase.from("iso_form_instances")
        .update({
          trang_thai: "tra_ve" as IsoFormInstanceStatus,
          ly_do_tra_ve: lyDo,
          buoc_hien_tai: 0,
          nguoi_ky: {},
          soan_thao_signed_url: null,
          final_pdf_url: null,
          final_office_url: null,
        })
        .eq("id", instanceId)
      if (error) { setActionError(error.message); return }
      await supabase.from("iso_form_instance_logs").insert({
        instance_id: instanceId, factory_id: factoryId, user_id: userId,
        action: "tra_ve", note: lyDo,
      })
      setActionSuccess("Đã trả về")
      setTimeout(() => setActionSuccess(null), 3000)

      const recipients: string[] = []
      if ((instance.so_buoc_tong ?? 0) > 0) {
        if (instance.nguoi_tao) recipients.push(instance.nguoi_tao)
      } else if (prevTrangThai === "cho_xem_xet") {
        if (instance.nguoi_tao) recipients.push(instance.nguoi_tao)
      } else if (prevTrangThai === "cho_phe_duyet") {
        if (prevCapTl === "Cấp 1" && instance.xem_xet_user_id) recipients.push(instance.xem_xet_user_id)
        else if (instance.nguoi_tao) recipients.push(instance.nguoi_tao)
      }
      sendNotify("tra_ve", recipients, lyDo)
      void loadInstance(factoryId)
    } finally {
      setSaving(false)
    }
  }

  // ── Sign confirm ─────────────────────────────────────────────────────────
  const handleSignConfirm = async (
    pin: string,
    placement: FullPlacement,
    signAs: SignAsType,
    note?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!factoryId || !userId || !signModal || !instance) {
      return { success: false, error: "Thiếu thông tin người ký hoặc hồ sơ" }
    }

    setSignLoading(true)
    setActionError(null)
    try {
      if (note && note !== instance.ghi_chu) {
        await supabase.from("iso_form_instances").update({ ghi_chu: note }).eq("id", instanceId)
        setGhiChu(note)
      }
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        const err = "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại"
        setActionError(err)
        return { success: false, error: err }
      }
      // 1. Verify PIN
      const verifyRes = await fetch("/api/sign/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId, pin, docId: instanceId, docType: "iso_form" }),
      })
      const verifyJson = await verifyRes.json() as { token?: string; error?: string }
      if (!verifyRes.ok) {
        const err = verifyJson.error ?? "PIN không đúng"
        setActionError(err)
        return { success: false, error: err }
      }

      // 2. Finalize
      const finalizeRes = await fetch(`/api/iso/forms/${instanceId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: verifyJson.token,
          action: signModal.action,
          step_index: signModal.stepIndex,
          placement,
          cap_tl: instance.cap_tl,
          sign_as: signAs,
        }),
      })
      const finalizeJson = await finalizeRes.json() as { success?: boolean; trang_thai?: string; error?: string }
      if (!finalizeRes.ok) {
        const err = finalizeJson.error ?? "Lỗi ký số"
        setActionError(err)
        return { success: false, error: err }
      }

      const completedAction = signModal.action
      const isNStepCompleted = typeof signModal.stepIndex === "number" && (instance.so_buoc_tong ?? 0) > 0
      const isFinal = isNStepCompleted
        ? (signModal.stepIndex! + 1 >= (instance.so_buoc_tong ?? 0))
        : completedAction === "phe_duyet"

      setSignModal(null)
      const successMsg = isFinal
        ? "Đã phê duyệt hồ sơ"
        : isNStepCompleted
          ? `Đã ký bước ${(signModal.stepIndex ?? 0) + 1}`
          : completedAction === "xem_xet"
            ? "Đã ký xem xét"
            : "Đã ký và gửi hồ sơ"
      setActionSuccess(successMsg)
      setTimeout(() => setActionSuccess(null), 4000)

      if (isNStepCompleted) {
        const nextIdx = signModal.stepIndex! + 1
        if (nextIdx < (instance.so_buoc_tong ?? 0)) {
          const nextStep = instance.thu_tu_ky_json?.[nextIdx]
          const nextSigner = nextStep ? stepSignerUserId(nextStep) : null
          if (nextSigner) sendNotify("ky_buoc", [nextSigner])
        } else {
          if (instance.nguoi_tao) sendNotify("phe_duyet", [instance.nguoi_tao])
        }
      } else {
        const notifyRecipients: string[] = []
        if (completedAction === "soan_thao") {
          if (instance.cap_tl === "Cấp 1" && instance.xem_xet_user_id) notifyRecipients.push(instance.xem_xet_user_id)
          else if (instance.phe_duyet_user_id) notifyRecipients.push(instance.phe_duyet_user_id)
        } else if (completedAction === "xem_xet") {
          if (instance.phe_duyet_user_id) notifyRecipients.push(instance.phe_duyet_user_id)
        } else if (completedAction === "phe_duyet") {
          if (instance.nguoi_tao) notifyRecipients.push(instance.nguoi_tao)
          if (instance.xem_xet_user_id) notifyRecipients.push(instance.xem_xet_user_id)
        }
        sendNotify(completedAction, notifyRecipients)
      }
      void loadInstance(factoryId)
      return { success: true }
    } catch (e) {
      const err = e instanceof Error ? e.message : "Lỗi hệ thống khi ký số"
      setActionError(err)
      return { success: false, error: err }
    } finally {
      setSignLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <IsoShell>
        <div className="p-12 text-center text-slate-400">
          <Loader2 size={32} className="animate-spin mx-auto mb-3 opacity-50" />
          <p>Đang tải...</p>
        </div>
      </IsoShell>
    )
  }

  if (!instance) {
    return (
      <IsoShell>
        <div className="p-12 text-center text-slate-400">
          <AlertTriangle size={32} className="mx-auto mb-3 opacity-50" />
          <p>Không tìm thấy hồ sơ</p>
          <button onClick={() => router.push("/dashboard/iso/forms")} className="mt-3 text-sm text-violet-600 hover:underline">
            ← Quay lại danh sách
          </button>
        </div>
      </IsoShell>
    )
  }

  const isEditable = instance.trang_thai === "draft" || instance.trang_thai === "tra_ve"
  const isNStepRecord = (instance.so_buoc_tong ?? 0) > 0
  const isNStep = isNStepRecord || (isEditable && steps.length > 0)
  const buocHienTai = instance.buoc_hien_tai ?? 0
  const currentStep = isNStepRecord && Array.isArray(instance.thu_tu_ky_json)
    ? instance.thu_tu_ky_json[buocHienTai]
    : null
  const currentStepSignerId = currentStep ? stepSignerUserId(currentStep) : null
  const canSignCurrentStep = isNStepRecord
    ? (instance.trang_thai === "cho_xem_xet" || instance.trang_thai === "cho_phe_duyet") && currentStepSignerId === userId
    : false

  const isXemXet = !isNStepRecord && instance.trang_thai === "cho_xem_xet" && instance.xem_xet_user_id === userId
  const isPheDuyet = !isNStepRecord && instance.trang_thai === "cho_phe_duyet" && instance.phe_duyet_user_id === userId
  const canReturn = isNStepRecord
    ? canSignCurrentStep && buocHienTai > 0
    : ((instance.trang_thai === "cho_xem_xet" && instance.xem_xet_user_id === userId) ||
       (instance.trang_thai === "cho_phe_duyet" && instance.phe_duyet_user_id === userId))
  const isDone = instance.trang_thai === "da_phe_duyet"
  const fileUrl = isEditable
    ? instance.draft_file_url
    : (instance.final_pdf_url || instance.final_office_url || instance.soan_thao_signed_url || instance.draft_file_url)
  const isNguoiTao = instance.nguoi_tao === userId

  // Kiểm tra vai trò soạn thảo / tạo lập / admin
  const firstStep = (isNStepRecord && Array.isArray(instance.thu_tu_ky_json) && instance.thu_tu_ky_json.length > 0)
    ? instance.thu_tu_ky_json[0]
    : (steps.length > 0 ? steps[0] : null)
  const firstStepSignerId = firstStep ? stepSignerUserId(firstStep) : null
  const isDrafter = firstStepSignerId === userId
  const isStep1Signer = isDrafter || isNguoiTao
  const hasSignPerm = hasPermission(currentUser, "iso.sign") || hasPermission(currentUser, "iso.create") || hasPermission(currentUser, "iso.signature") || userRole === "admin"
  const canManageDraft = isEditable && (isNguoiTao || isDrafter || hasPermission(currentUser, "iso.create") || userRole === "admin")
  const canSignStep1 = isEditable && hasSignPerm && (isStep1Signer || userRole === "admin")
  const canChangeSigner = !isEditable && !isDone && instance.trang_thai !== "tra_ve" && (
    isNguoiTao || isDrafter || hasPermission(currentUser, "iso.create") || userRole === "admin"
  )

  // Hồ sơ PDF mới có khái niệm "vị trí ký"; file Office thay tag nên không cần mẫu.
  const needsSignTemplate = instance.draft_file_type === "pdf" || urlIsPdf(instance.draft_file_url)
  const mustSetupTemplate = needsSignTemplate && templateExists !== true

  const signStepsReady = isNStep
    ? steps.length > 0 && steps.every((s) => !!stepSignerUserId(s))
    : (cap_tl === "Cấp 1" ? !!xemXetUserId && !!pheDuyetUserId : !!pheDuyetUserId)

  // ── Link sang màn "Cài đặt vị trí ký" ─────────────────────────────────────────
  const templateSignSetupPdf = [
    urlIsPdf(instance.draft_file_url) ? instance.draft_file_url : null,
    urlIsPdf(template?.file_signed_pdf_url ?? null) ? template?.file_signed_pdf_url ?? null : null,
    urlIsPdf(template?.file_goc_url ?? null) ? template?.file_goc_url ?? null : null,
  ].find(Boolean) ?? null
  const templateSignSetupKey = template?.ma_tai_lieu
    ? `iso:code:${template.ma_tai_lieu}`
    : template?.loai_tai_lieu
      ? `iso:loai:${template.loai_tai_lieu}`
      : null
  const templateSignSetupUrl = templateSignSetupPdf && templateSignSetupKey
    ? `/dashboard/ky/mau-vi-tri?modun=iso&loai=${encodeURIComponent(templateSignSetupKey)}`
      + `&pdfUrl=${encodeURIComponent(templateSignSetupPdf)}`
      + `&docLabel=${encodeURIComponent(template?.ma_tai_lieu || template?.ten_tai_lieu || instance.tieu_de)}`
      + `&formInstanceId=${encodeURIComponent(instanceId)}`
      + `&returnTo=${encodeURIComponent(`/dashboard/iso/forms/${instanceId}?confirmedSignTemplate=1`)}`
    : null

  return (
    <IsoShell>
      <div className="space-y-6">
        {/* ── Top Bar: Header + Action buttons (đồng bộ 100% với UI Văn bản) ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <button
              onClick={() => router.push("/dashboard/iso/forms")}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0 mt-0.5"
              title="Quay lại danh sách"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-extrabold text-slate-800 break-words">{instance.tieu_de}</h1>
                <StatusBadge status={instance.trang_thai} inst={instance} />
              </div>
              <p className="text-sm text-slate-400 mt-0.5 font-mono">
                {template?.ma_tai_lieu || "Chưa có mã"}
                {template?.ten_tai_lieu && ` · ${template.ten_tai_lieu}`}
              </p>
            </div>
          </div>

          {/* Action buttons trên Top bar */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-shrink-0 sm:justify-end">
            {/* Nút Xem file (màu xanh lam như Ảnh 1) */}
            {fileUrl && (
              <button
                type="button"
                onClick={() => void openSecureFile(`/api/iso/forms/${instanceId}/file-url`)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-all shadow-2xs"
              >
                <Eye size={15} />
                Xem file
              </button>
            )}

            {/* Nút Phân phối (màu tím như Ảnh 1) */}
            {isDone && (
              <button
                onClick={() => setShowDistributeModal(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition-all"
                title="Phân phối hồ sơ này đến người nhận / phòng ban"
              >
                <Share2 size={15} />
                Phân phối
              </button>
            )}

            {/* Nút Ký & Gửi: Ẩn hoàn toàn khi chưa có mẫu vị trí ký (mustSetupTemplate) */}
            {canSignStep1 && (!needsSignTemplate || templateExists === true) && (
              <button
                onClick={openSendModal}
                disabled={saving || !instance.draft_file_url}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-md transition-all"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {isNStepRecord || steps.length > 0
                  ? (steps.length === 2 ? "Ký & Gửi phê duyệt" : steps.length > 2 ? "Ký & Gửi xem xét" : "Ký & Gửi hồ sơ")
                  : (cap_tl === "Cấp 1" ? "Ký & Gửi xem xét" : "Ký & Gửi phê duyệt")}
              </button>
            )}

            {isNStepRecord && canSignCurrentStep && (
              <button
                onClick={openSignStepModal}
                disabled={signLoading}
                className={`flex items-center gap-2 px-4 py-2 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-md transition-all ${
                  buocHienTai + 1 >= (instance.so_buoc_tong ?? 0)
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-amber-600 hover:bg-amber-700"
                }`}
              >
                {signLoading ? <Loader2 size={15} className="animate-spin" /> : <Pen size={15} />}
                {buocHienTai + 1 >= (instance.so_buoc_tong ?? 0)
                  ? "Ký phê duyệt"
                  : `Ký bước ${buocHienTai + 1}: ${stepDisplayLabel(currentStep)}`}
              </button>
            )}

            {!isNStepRecord && isXemXet && (
              <button
                onClick={openXemXetModal}
                disabled={signLoading}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-md transition-all"
              >
                {signLoading ? <Loader2 size={15} className="animate-spin" /> : <Pen size={15} />}
                Ký xem xét
              </button>
            )}

            {!isNStepRecord && isPheDuyet && (
              <button
                onClick={openPheDuyetModal}
                disabled={signLoading}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-md transition-all"
              >
                {signLoading ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                Phê duyệt
              </button>
            )}

            {canReturn && (
              <button
                onClick={() => setShowReturnModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-sm font-bold rounded-xl border border-rose-200 transition-all"
              >
                <RotateCcw size={15} /> Trả về
              </button>
            )}

            {canChangeSigner && (
              <button
                onClick={() => setDoiNguoiKyOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-bold rounded-xl border border-amber-300 transition-all"
                title="Thay đổi người ký nếu người ký hiện tại vắng mặt"
              >
                <UserCheck size={15} /> Đổi người ký
              </button>
            )}

            {/* Nút Cài đặt vị trí ký: nổi bật rực rỡ khi hồ sơ chưa có mẫu vị trí ký */}
            {isEditable && canManageDraft && templateSignSetupUrl && (
              <button
                onClick={() => void goToTemplateSetup()}
                disabled={!signStepsReady || saving}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl transition-all ${
                  mustSetupTemplate
                    ? "bg-violet-600 hover:bg-violet-700 text-white border border-violet-600 shadow-md ring-2 ring-violet-300 animate-pulse"
                    : "bg-sky-50 hover:bg-sky-100 disabled:opacity-40 disabled:cursor-not-allowed text-sky-700 border border-sky-200"
                }`}
                title={signStepsReady
                  ? (mustSetupTemplate ? "Cần cài đặt vị trí ký trước khi ký & gửi hồ sơ" : "Vẽ sẵn vị trí chữ ký cho biểu mẫu này — các hồ sơ sau tự áp dụng")
                  : "Chọn đủ người ký ở 'Cấu hình phê duyệt' trước khi cài đặt vị trí ký"}
              >
                <LayoutTemplate size={15} /> Cài đặt vị trí ký
              </button>
            )}

            <button
              onClick={() => factoryId && void loadInstance(factoryId)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-xs rounded-xl transition-colors shrink-0"
              title="Làm mới"
            >
              <RefreshCcw size={15} />
            </button>
          </div>
        </div>

        {/* Thông báo trả về nếu có */}
        {instance.trang_thai === "tra_ve" && instance.ly_do_tra_ve && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <RotateCcw size={15} className="text-rose-600" />
              <span className="text-sm font-bold text-rose-700">Hồ sơ bị trả về</span>
            </div>
            <p className="text-sm text-rose-600">{instance.ly_do_tra_ve}</p>
          </div>
        )}

        {/* Cảnh báo thiếu mẫu vị trí ký */}
        {isEditable && canManageDraft && mustSetupTemplate && (
          <div className="flex items-start gap-3 p-4 bg-sky-50 border border-sky-200 rounded-2xl">
            <LayoutTemplate size={18} className="text-sky-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-bold text-sky-800">Biểu mẫu này chưa có mẫu vị trí ký</p>
              <p className="text-xs text-sky-700 mt-0.5">
                {signStepsReady
                  ? "Bấm \"Cài đặt vị trí ký\" để vẽ vị trí chữ ký một lần cho biểu mẫu — mọi hồ sơ lập sau của cùng biểu mẫu sẽ tự áp dụng."
                  : "Chọn đủ người ký ở \"Cấu hình phê duyệt\", sau đó bấm \"Cài đặt vị trí ký\"."}
              </p>
            </div>
          </div>
        )}

        {/* Toasts */}
        {actionError && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-600 text-white rounded-2xl shadow-lg text-sm font-bold">
            <AlertTriangle size={15} className="shrink-0" />
            {actionError}
            <button onClick={() => setActionError(null)} className="ml-auto hover:opacity-70"><X size={14} /></button>
          </div>
        )}
        {actionSuccess && (
          <div className="flex items-center gap-3 px-4 py-3 bg-emerald-600 text-white rounded-2xl shadow-lg text-sm font-bold">
            <CheckCircle2 size={15} className="shrink-0" />
            {actionSuccess}
          </div>
        )}

        {/* Cột trái 3/5 — cột phải 2/5, `items-stretch` + `flex-1` để 2 card LUÔN cao bằng nhau */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
          {/* ── Cột trái: Thông tin hồ sơ (3/5) ── */}
          <div className="lg:col-span-3 flex flex-col">
            <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2.5 px-5 py-3.5 bg-mint-50 border-b border-mint-100">
                <span className="w-8 h-8 rounded-full bg-mint-100 grid place-items-center text-[#1f6a58] shrink-0">
                  <FileText size={16} />
                </span>
                <h2 className="text-sm font-extrabold text-slate-800">Thông tin hồ sơ</h2>
              </div>

              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <InfoRow label="Biểu mẫu gốc" value={template?.ten_tai_lieu || "—"} />
                    <InfoRow label="Mã biểu mẫu" value={template?.ma_tai_lieu || "—"} />
                    <InfoRow
                      label="Loại hồ sơ"
                      value={template?.loai_tai_lieu ? (LOAI_TAI_LIEU_LABEL[template.loai_tai_lieu] || template.loai_tai_lieu) : "Biểu mẫu"}
                    />
                    <InfoRow label="Phòng ban" value={template?.phong_ban || "—"} />
                    <InfoRow
                      label="Người lập hồ sơ"
                      value={instance.soan_thao || (instance.nguoi_tao ? (allApproverProfiles.find((p) => p.id === instance.nguoi_tao)?.full_name || instance.nguoi_tao) : "—")}
                    />
                    <InfoRow label="Ngày lập hồ sơ" value={fmtDate(instance.created_at)} />
                    <InfoRow
                      label="Cấp hồ sơ"
                      value={
                        isNStepRecord
                          ? `${instance.so_buoc_tong || steps.length} bước ký`
                          : instance.cap_tl || "—"
                      }
                    />
                    <InfoRow
                      label="Ngày phê duyệt"
                      value={instance.ky_phe_duyet_at ? fmtDate(instance.ky_phe_duyet_at) : (isDone ? fmtDate(instance.updated_at) : "Chưa duyệt")}
                    />
                    {template?.mo_ta_tim_kiem && (
                      <div className="sm:col-span-2 rounded-xl bg-slate-50/80 border border-slate-100 px-3 py-2">
                        <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Mô tả biểu mẫu</dt>
                        <dd className="text-sm text-slate-700 italic">{template.mo_ta_tim_kiem}</dd>
                      </div>
                    )}
                  </div>

                  {instance.ghi_chu && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Ghi chú</p>
                      <p className="text-sm text-slate-700">{instance.ghi_chu}</p>
                    </div>
                  )}
                </div>

                {/* Phân vùng File hồ sơ nằm gọn gàng bên trong thẻ Thông tin hồ sơ */}
                <div className="mt-5 pt-4 border-t border-slate-100 space-y-3">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Tệp hồ sơ</dt>

                  {/* Banner hướng dẫn khi biểu mẫu gốc chỉ có PDF */}
                  {!instance.draft_file_url && (template?.file_signed_pdf_url || template?.file_goc_url) && (
                    <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                      <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1 text-xs">
                        <p className="font-semibold text-amber-800">Biểu mẫu gốc chỉ có dạng PDF</p>
                        <p className="text-slate-600 mt-0.5">Tải PDF về làm mẫu → điền nội dung → upload lại file (.docx, .xlsx, hoặc .pdf).</p>
                        <button
                          type="button"
                          onClick={() => void openSecureFile(`/api/iso/documents/${template.id}/file-url?variant=main&download=1`)}
                          className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-bold rounded-lg"
                        >
                          <Download size={12} /> Tải PDF mẫu
                        </button>
                      </div>
                    </div>
                  )}

                  {/* File đã ký duyệt (khi hoàn thành) */}
                  {isDone && (instance.final_pdf_url || instance.final_office_url) && (
                    <div className="flex items-center gap-2.5 p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl">
                      <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-emerald-900 truncate">
                          {instance.tieu_de || "File đã ký duyệt"}
                        </p>
                        <p className="text-[10px] text-emerald-600 font-semibold uppercase">
                          {instance.final_pdf_url ? "PDF ĐÃ KÝ DUYỆT" : instance.draft_file_type?.toUpperCase()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void openSecureFile(`/api/iso/forms/${instanceId}/file-url`)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-white hover:bg-emerald-100 border border-emerald-200 rounded-lg shadow-2xs transition-all"
                        >
                          <Eye size={13} /> Xem
                        </button>
                        <button
                          onClick={handleDownload}
                          className="p-1.5 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors"
                          title="Tải về"
                        >
                          <Download size={14} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* File nháp / file đang xử lý */}
                  {instance.draft_file_url && !uploading && !isDone && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <FileText size={20} className="text-violet-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">
                            {instance.tieu_de || "File hồ sơ"}
                          </p>
                          <span className="text-[10px] font-bold uppercase text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">
                            {instance.draft_file_type ?? "file"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => void openSecureFile(`/api/iso/forms/${instanceId}/file-url`)}
                            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors"
                            title="Xem file"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            onClick={handleDownload}
                            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors"
                            title="Tải về"
                          >
                            <Download size={15} />
                          </button>
                          {canManageDraft && (
                            <button
                              onClick={() => fileInputRef.current?.click()}
                              disabled={uploading}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-50 rounded-lg transition-colors"
                              title="Thay file"
                            >
                              <RotateCcw size={12} /> Thay file
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Công tắc / checkbox Tự động chuyển sang PDF sau phê duyệt cho file DOCX/XLSX */}
                      {instance.draft_file_type !== "pdf" && (
                        <label
                          className={`flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-white transition-all ${
                            canManageDraft ? "cursor-pointer hover:bg-slate-50 hover:border-violet-300" : "cursor-default opacity-80"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={autoConvertPdf}
                            disabled={!canManageDraft}
                            onChange={async (e) => {
                              if (!canManageDraft) return
                              const val = e.target.checked
                              setAutoConvertPdf(val)
                              setInstance((prev) => prev ? { ...prev, auto_convert_pdf: val } : prev)
                              await supabase.from("iso_form_instances").update({ auto_convert_pdf: val }).eq("id", instanceId)
                            }}
                            className="mt-0.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500 disabled:cursor-default"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-bold text-slate-700">Tự động chuyển sang PDF sau khi phê duyệt</span>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {autoConvertPdf
                                ? "Đang bật — hồ sơ DOCX/XLSX sẽ tự động chuyển sang file PDF hoàn chỉnh sau khi ký duyệt."
                                : "Đang tắt — giữ nguyên định dạng file Office gốc sau khi ký duyệt."}
                            </p>
                          </div>
                        </label>
                      )}
                    </div>
                  )}

                  {/* Hidden file input dùng chung cho cả Tải lên lần đầu và Thay file */}
                  {canManageDraft && (
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".docx,.xlsx,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) {
                          setUploadFile(f)
                          setDocxPreviewHtml(null)
                          if (f.name.toLowerCase().endsWith(".docx")) void loadDocxPreview(f)
                          void handleUpload(f)
                        }
                        e.target.value = ""
                      }}
                    />
                  )}

                  {/* Upload spinner */}
                  {uploading && (
                    <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                      <Loader2 size={16} className="text-amber-500 animate-spin shrink-0" />
                      <span className="text-xs text-amber-700 flex-1 truncate">{uploadFile?.name ?? "Đang tải lên..."}</span>
                    </div>
                  )}

                  {/* Upload zone khi chưa có file */}
                  {canManageDraft && !uploading && !instance.draft_file_url && (
                    <div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-3 border-2 border-dashed border-slate-300 hover:border-violet-300 hover:bg-violet-50 rounded-xl text-xs text-slate-500 hover:text-violet-600 transition-colors flex items-center justify-center gap-2 font-medium"
                      >
                        <Upload size={14} />
                        Tải lên file hồ sơ (.docx, .xlsx, .pdf)
                      </button>
                    </div>
                  )}

                  {uploadError && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={11} />{uploadError}</p>
                  )}

                  {/* DOCX preview */}
                  {docxPreviewHtml && (
                    <div className="mt-2">
                      <button
                        onClick={() => setShowPreview((p) => !p)}
                        className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-violet-600"
                      >
                        {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
                        {showPreview ? "Ẩn xem trước" : "Xem trước nội dung DOCX"}
                      </button>
                      {showPreview && (
                        <div
                          className="mt-2 p-3 border border-slate-200 rounded-xl bg-white max-h-60 overflow-y-auto text-xs prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: docxPreviewHtml }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Cột phải: Tiến trình ký xác nhận & phê duyệt (2/5) ── */}
          <div className="lg:col-span-2 flex flex-col">
            <div className="flex-1 w-full flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Header đồng bộ ảnh 1 */}
              <div className="flex items-center justify-between gap-2.5 px-5 py-3.5 bg-amber-50 border-b border-amber-100">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-full bg-amber-100 grid place-items-center text-amber-700 shrink-0">
                    <ShieldCheck size={16} />
                  </span>
                  <h2 className="text-sm font-extrabold text-slate-800">
                    {canManageDraft && rightTab === "config"
                      ? "Cấu hình phê duyệt"
                      : "Tiến trình ký xác nhận & phê duyệt"}
                  </h2>
                </div>
                {canManageDraft && (
                  <div className="flex items-center gap-2">
                    {rightTab === "config" && (
                      <button
                        type="button"
                        onClick={handleManualSaveConfig}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors disabled:opacity-50"
                        title="Lưu cấu hình phê duyệt"
                      >
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Lưu cấu hình
                      </button>
                    )}
                    <div className="flex items-center gap-1 bg-amber-100/70 p-0.5 rounded-lg text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setRightTab("timeline")}
                        className={`px-2 py-1 rounded-md transition-all ${rightTab === "timeline" ? "bg-white text-slate-800 shadow-2xs" : "text-amber-800 hover:text-amber-900"}`}
                      >
                        Tiến trình
                      </button>
                      <button
                        type="button"
                        onClick={() => setRightTab("config")}
                        className={`px-2 py-1 rounded-md transition-all ${rightTab === "config" ? "bg-white text-slate-800 shadow-2xs" : "text-amber-800 hover:text-amber-900"}`}
                      >
                        Cấu hình
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Body: Config tab khi soạn thảo */}
              {canManageDraft && rightTab === "config" ? (
                <div className="p-5 space-y-3">
                  {/* Header with step count and add button */}
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-600">
                      Thứ tự ký ({steps.length} bước)
                    </label>
                    <button
                      type="button"
                      onClick={addStep}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg border border-violet-200 transition-colors"
                    >
                      <Plus size={12} /> Thêm bước
                    </button>
                  </div>

                  {/* Steps list */}
                  <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
                    {steps.map((s, idx) => {
                      const isFirst = idx === 0
                      const isLast = idx === steps.length - 1
                      const signerId = stepSignerUserId(s)
                      return (
                        <div
                          key={`step_${s.step || idx + 1}_${idx}`}
                          className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                {idx + 1}
                              </span>
                              <input
                                type="text"
                                value={s.ten || ""}
                                onChange={(e) => updateStep(idx, { ten: e.target.value })}
                                placeholder={isFirst ? "Người lập" : isLast ? "Phê duyệt" : `Bước ${idx + 1}`}
                                className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 outline-none focus:border-violet-400"
                              />
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => moveStep(idx, "up")}
                                disabled={idx <= 1}
                                className="p-1 hover:bg-slate-200 disabled:opacity-30 rounded text-slate-600"
                                title="Di chuyển lên"
                              >
                                <ArrowUp size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveStep(idx, "down")}
                                disabled={idx === 0 || idx >= steps.length - 1}
                                className="p-1 hover:bg-slate-200 disabled:opacity-30 rounded text-slate-600"
                                title="Di chuyển xuống"
                              >
                                <ArrowDown size={11} />
                              </button>
                              {!isFirst && !isLast && (
                                <button
                                  type="button"
                                  onClick={() => removeStep(idx)}
                                  className="p-1 hover:bg-red-50 text-red-500 rounded"
                                  title="Xoá bước"
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Phòng ban</label>
                              <select
                                value={s.phong_ban_code || ""}
                                onChange={(e) => handleStepDeptChange(idx, e.target.value)}
                                className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs outline-none focus:border-violet-400 font-medium"
                              >
                                <option value="">Tất cả phòng ban</option>
                                {PHONG_BAN_OPTIONS.map((pb) => (
                                  <option key={pb} value={pb}>{pb}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                                Người ký đích danh {s.phong_ban_code && deptUsersLoading[s.phong_ban_code] && <span className="text-violet-600 font-normal">(đang tải...)</span>}
                              </label>
                              <select
                                value={signerId || ""}
                                onChange={(e) => handleStepSignerChange(idx, e.target.value)}
                                className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs outline-none focus:border-violet-400 font-medium"
                              >
                                <option value="">— Chọn người ký —</option>
                                {(() => {
                                  const list = s.phong_ban_code ? (deptUsersCache[s.phong_ban_code] || []) : allApproverProfiles
                                  const listWithCurrent = (signerId && !list.some((p) => p.id === signerId))
                                    ? [...list, allApproverProfiles.find((p) => p.id === signerId) || { id: signerId, full_name: s.ten || signerId, username: null }]
                                    : list

                                  return listWithCurrent.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {profileLabel(p)} {p.id === userId ? "(Bạn)" : ""}
                                    </option>
                                  ))
                                })()}
                              </select>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Auto convert PDF */}
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-xs font-bold text-slate-600">Tự convert sang PDF khi duyệt</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {instance.draft_file_type === "pdf" ? "File PDF không cần convert" : "Dùng CloudConvert (DOCX/XLSX → PDF)"}
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        if (instance.draft_file_type !== "pdf") {
                          const val = !autoConvertPdf
                          setAutoConvertPdf(val)
                          setInstance((prev) => prev ? { ...prev, auto_convert_pdf: val } : prev)
                          await supabase.from("iso_form_instances").update({ auto_convert_pdf: val }).eq("id", instanceId)
                        }
                      }}
                      disabled={instance.draft_file_type === "pdf"}
                      title={instance.draft_file_type === "pdf" ? "File PDF tự động bật" : undefined}
                      className={
                        "w-10 h-5.5 rounded-full transition-colors relative " +
                        (autoConvertPdf ? "bg-emerald-500" : "bg-slate-300") +
                        (instance.draft_file_type === "pdf" ? " opacity-60 cursor-not-allowed" : "")
                      }
                    >
                      <span
                        className={
                          "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " +
                          (autoConvertPdf ? "translate-x-5" : "translate-x-0.5")
                        }
                      />
                    </button>
                  </div>

                  {/* Ghi chú */}
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
                    <textarea
                      rows={2}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-400 resize-none"
                      value={ghiChu}
                      onChange={(e) => setGhiChu(e.target.value)}
                    />
                  </div>

                  {/* Ghi chú chân trang */}
                  <div className="pt-2 text-right border-t border-slate-100">
                    <p className="text-[11px] text-slate-400">Tự động lưu khi ký &amp; gửi</p>
                  </div>
                </div>
              ) : (
                /* Body: Timeline Stepper theo đúng ảnh 1 */
                <div className="flex-1 flex flex-col justify-between">
                  <ol className="relative p-5 pb-2">
                    {/* Render N-step timeline */}
                    {isNStepRecord && Array.isArray(instance.thu_tu_ky_json) && instance.thu_tu_ky_json.length > 0 ? (
                      instance.thu_tu_ky_json.map((step, i) => {
                        const stepKey = `buoc_${i}`
                        const signerInfo = instance.nguoi_ky?.[stepKey]
                        const signedAt = signerInfo?.ky_at || (i === 0 && instance.ky_soan_thao_at ? instance.ky_soan_thao_at : null)
                        const isDoneStep = isDone || (instance.buoc_hien_tai != null && i < instance.buoc_hien_tai) || !!signedAt
                        const isCurrent = !isDone && instance.trang_thai !== "tra_ve" && instance.buoc_hien_tai === i
                        const isMyTurn = isCurrent && canSignCurrentStep
                        const displayName =
                          signerInfo?.ten ||
                          getLogUserName(step.user_id || "") ||
                          (step.user_id === instance.nguoi_tao && instance.soan_thao ? instance.soan_thao : null) ||
                          (step.user_id ? allApproverProfiles.find((p) => p.id === step.user_id)?.full_name : null) ||
                          step.ten ||
                          (i === 0 ? "Người lập" : "Chưa chọn")
                        const isLastStep = i === (instance.thu_tu_ky_json?.length ?? 1) - 1

                        return (
                          <TimelineStep
                            key={`tl_${step.step || i + 1}_${i}`}
                            label={step.ten?.trim() || (i === 0 ? "Người lập" : isLastStep ? "Phê duyệt" : `Bước ${i + 1}: ${stepDisplayLabel(step)}`)}
                            sublabel={displayName}
                            done={isDoneStep}
                            pending={isCurrent}
                            isMyTurn={isMyTurn}
                            at={signedAt || (i === 0 ? instance.created_at : null)}
                            stepNo={i + 1}
                            accentColor={i === 0 ? "#0284c7" : isLastStep ? "#10b981" : "#f59e0b"}
                            isLast={isLastStep}
                          />
                        )
                      })
                    ) : (
                      /* Legacy 2-step / 3-step */
                      <>
                        <TimelineStep
                          label="Soạn thảo"
                          sublabel={instance.soan_thao || (instance.nguoi_tao ? (allApproverProfiles.find((p) => p.id === instance.nguoi_tao)?.full_name || instance.nguoi_tao) : "Người lập")}
                          done={true}
                          at={instance.ky_soan_thao_at || instance.created_at}
                          accentColor="#94a3b8"
                          isLast={false}
                        />
                        {instance.cap_tl !== "Cấp 2" && (
                          <TimelineStep
                            label="Xem xét"
                            sublabel={instance.xem_xet || "Chờ xem xét"}
                            done={isDone || instance.trang_thai === "cho_phe_duyet" || !!instance.ky_xem_xet_at}
                            pending={instance.trang_thai === "cho_xem_xet"}
                            isMyTurn={instance.trang_thai === "cho_xem_xet" && isXemXet}
                            at={instance.ky_xem_xet_at}
                            stepNo={2}
                            accentColor="#f59e0b"
                            isLast={false}
                          />
                        )}
                        <TimelineStep
                          label="Phê duyệt"
                          sublabel={instance.phe_duyet ? `${signAsPrefixLabel(instance.phe_duyet_sign_as)}${instance.phe_duyet}` : "Chờ phê duyệt"}
                          done={isDone || !!instance.ky_phe_duyet_at}
                          pending={instance.trang_thai === "cho_phe_duyet"}
                          isMyTurn={instance.trang_thai === "cho_phe_duyet" && isPheDuyet}
                          at={instance.ky_phe_duyet_at}
                          stepNo={instance.cap_tl === "Cấp 2" ? 2 : 3}
                          accentColor="#10b981"
                          isLast={true}
                        />
                      </>
                    )}
                  </ol>

                  {/* Lịch sử thao tác (thu gọn dạng dropdown collapsible) */}
                  {logs.length > 0 && (
                    <div className="px-5 pb-3">
                      <details open className="group border-t border-slate-100 pt-3 text-xs">
                        <summary className="flex items-center justify-between cursor-pointer font-bold text-slate-500 hover:text-slate-800 list-none select-none">
                          <span className="flex items-center gap-1.5">
                            <Clock size={12} className="text-slate-400" />
                            Lịch sử thao tác ({logs.length})
                          </span>
                          <ChevronDown size={14} className="group-open:rotate-180 transition-transform text-slate-400" />
                        </summary>
                        <div className="mt-2.5 space-y-2 max-h-52 overflow-y-auto pr-1">
                          {logs.map((log) => {
                            const meta = formatIsoLogAction(log.action)
                            const actor = getLogUserName(log.user_id)
                            const note = cleanLogNote(log.note)
                            return (
                              <div
                                key={log.id}
                                className="flex items-start gap-2.5 text-xs text-slate-600 bg-slate-50/80 hover:bg-slate-100/80 transition-colors p-2.5 rounded-lg border border-slate-100"
                              >
                                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${meta.dotCls}`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${meta.badgeCls}`}>
                                      {meta.label}
                                    </span>
                                    {actor && (
                                      <span className="font-semibold text-slate-800 text-xs">
                                        {actor}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-slate-400 ml-auto shrink-0 flex items-center gap-1">
                                      <Clock size={10} />
                                      {fmtDateTime(log.created_at)}
                                    </span>
                                  </div>
                                  {note && (
                                    <div className="text-[11px] text-slate-500 mt-1 pl-0.5 break-words">
                                      {note}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </details>
                    </div>
                  )}

                  {/* Khối tiến độ ở đáy — mirror 100% Ảnh 1 */}
                  {(() => {
                    const total = isNStepRecord
                      ? (instance.so_buoc_tong || instance.thu_tu_ky_json?.length || 1)
                      : (instance.cap_tl === "Cấp 2" ? 2 : 3)
                    const doneCount = isDone
                      ? total
                      : isNStepRecord
                        ? (instance.buoc_hien_tai ?? 0)
                        : (instance.trang_thai === "cho_phe_duyet" ? (instance.cap_tl === "Cấp 2" ? 1 : 2) : instance.trang_thai === "cho_xem_xet" ? 1 : 0)
                    const pct = Math.round((doneCount / total) * 100)
                    const allDone = isDone

                    return (
                      <div className="mt-auto px-5 py-4 border-t border-slate-100 bg-slate-50/60">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Tiến độ ký</span>
                          <span className={`text-xs font-extrabold ${allDone ? "text-emerald-600" : "text-amber-600"}`}>
                            {doneCount}/{total} bước
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${allDone ? "bg-emerald-500" : "bg-amber-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sign Placement Modal */}
      {signModal && userId && (
        <SignPlacementModal
          action={signModal.action}
          stepIndex={signModal.stepIndex}
          totalSteps={signModal.totalSteps}
          stepName={
            typeof signModal.stepIndex === "number" && Array.isArray(instance.thu_tu_ky_json)
              ? instance.thu_tu_ky_json[signModal.stepIndex]?.ten
              : undefined
          }
          sourceFileUrl={signModal.sourceFileUrl}
          fileType={instance.draft_file_type}
          autoConvertPdf={instance.auto_convert_pdf}
          signatureUrl={signatureUrl}
          userName={userName}
          userChucVu={userChucVu}
          ghiChuText={instance.ghi_chu ?? ""}
          factoryId={factoryId}
          templateMa={template?.ma_tai_lieu ?? null}
          templateLoai={template?.loai_tai_lieu ?? null}
          hasTemplate={templateExists === true}
          instanceId={instanceId}
          userId={userId}
          acting={signLoading}
          errorMessage={actionError}
          onConfirm={handleSignConfirm}
          onClose={() => setSignModal(null)}
        />
      )}

      {/* Return Modal */}
      {showReturnModal && (
        <ReturnModal
          onConfirm={handleReturn}
          onClose={() => setShowReturnModal(false)}
        />
      )}

      {/* Doi Nguoi Ky Modal */}
      {doiNguoiKyOpen && factoryId && (
        <DoiNguoiKyModal
          steps={Array.isArray(instance.thu_tu_ky_json) && instance.thu_tu_ky_json.length > 0 ? instance.thu_tu_ky_json : steps}
          currentStepIndex={instance.buoc_hien_tai ?? 0}
          factoryId={factoryId}
          allProfiles={allApproverProfiles}
          onConfirm={handleConfirmDoiNguoiKy}
          onClose={() => setDoiNguoiKyOpen(false)}
          saving={doiNguoiKySaving}
        />
      )}

      {/* Distribution Modal */}
      {showDistributeModal && factoryId && userId && (
        <DistributionModal
          factoryId={factoryId}
          userId={userId}
          initialDocIds={[instanceId]}
          itemType="form"
          formTitle={instance.tieu_de || template?.ten_tai_lieu || undefined}
          formCode={template?.ma_tai_lieu || undefined}
          onClose={() => setShowDistributeModal(false)}
          onSuccess={(distributed) => {
            setActionSuccess(`Đã phân phối hồ sơ đến ${distributed} người nhận!`)
            setTimeout(() => setActionSuccess(null), 4000)
          }}
        />
      )}
    </IsoShell>
  )
}
