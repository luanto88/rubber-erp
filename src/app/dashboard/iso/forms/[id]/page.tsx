"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, Download, Upload, Eye, EyeOff, CheckCircle2, X,
  AlertTriangle, Loader2, FileText, Send, Pen,
  RotateCcw, Settings, Clock, User, RefreshCcw, Info,
  ChevronLeft, ChevronRight,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import Draggable from "react-draggable"
import { Resizable } from "re-resizable"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession } from "@/lib/auth"
import { IsoShell } from "../../_components/iso-shell"
import { ModalShell } from "../../../_components/modal-shell"
import {
  fmtDate,
  LOAI_TAI_LIEU_LABEL,
  FORM_INSTANCE_STATUS_LABEL,
  FORM_INSTANCE_STATUS_COLOR,
  SIGN_AS_OPTIONS,
  SIGN_AS_LABEL,
  type IsoFormInstance,
  type IsoFormInstanceStatus,
  type IsoDocument,
  type SignAsType,
} from "../../_components/iso-types"

// ─── Types ───────────────────────────────────────────────────────────────────
type ProfileOption = { id: string; full_name: string | null; username: string | null }
type LogRow = { id: string; user_id: string; action: string; note: string | null; created_at: string }

type FullPlacement = {
  page: number
  x: number; y: number; width: number; height: number
  showSignature: boolean; showSignerName: boolean
  nameX: number; nameY: number; nameWidth: number; nameHeight: number
  qrX?: number; qrY?: number; qrWidth?: number; qrHeight?: number
  // Hộp tiền tố ký thay (KT./TM./TL./TUQ.) — chỉ dùng ở bước Phê duyệt, chỉ áp
  // dụng cho PDF (không có khái niệm tương đương cho DOCX/XLSX).
  showPrefix?: boolean
  prefixX?: number; prefixY?: number; prefixWidth?: number; prefixHeight?: number
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

function StatusBadge({ status }: { status: IsoFormInstanceStatus }) {
  const label = FORM_INSTANCE_STATUS_LABEL[status] ?? status
  const color = FORM_INSTANCE_STATUS_COLOR[status] ?? "bg-slate-100 text-slate-600"
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${color}`}>{label}</span>
}

// ─── WorkflowStepper ─────────────────────────────────────────────────────────
function WorkflowStepper({ cap_tl, trang_thai }: { cap_tl: string; trang_thai: IsoFormInstanceStatus }) {
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
  const isReturned = trang_thai === "tra_ve"
  const activeIdx = steps.findIndex((s) => s.key === trang_thai)
  const effectiveIdx = activeIdx >= 0 ? activeIdx : (isReturned ? 0 : steps.length - 1)

  return (
    <div className="flex items-center gap-0 text-xs">
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

// ─── Sign Placement Modal ─────────────────────────────────────────────────────
function SignPlacementModal({
  action,
  sourceFileUrl,
  fileType,
  autoConvertPdf,
  signatureUrl,
  userName,
  instanceId,
  userId,
  acting,
  onConfirm,
  onClose,
}: {
  action: "soan_thao" | "xem_xet" | "phe_duyet"
  sourceFileUrl: string | null
  fileType: string | null
  autoConvertPdf: boolean
  signatureUrl: string | null
  userName: string
  instanceId: string
  userId: string
  acting: boolean
  onConfirm: (pin: string, placement: FullPlacement, signAs: SignAsType) => void
  onClose: () => void
}) {
  const isPdf = fileType === "pdf" || urlIsPdf(sourceFileUrl)
  const showCanvas = isPdf && !!sourceFileUrl
  // Ký thay (KT./TM./TL./TUQ.) chỉ áp dụng cho bước Phê duyệt, chỉ có ý nghĩa trên
  // PDF (vẽ hộp riêng) — DOCX/XLSX không cần (đã xác nhận với người dùng).
  const showSignAsPicker = action === "phe_duyet" && showCanvas

  // Luồng ký chia 2 bước: PIN phải xác thực đúng (chặn, gọi /api/sign/verify)
  // TRƯỚC khi hiện canvas PDF đặt vị trí chữ ký — mirror iso/documents/[id]/page.tsx
  // (pinModal/placementModal) và documents/[id]/page.tsx (Cập nhật 2026-07-24).
  const [step, setStep] = useState<"pin" | "placement">("pin")
  const [pin, setPin] = useState("")
  const [pinError, setPinError] = useState("")
  const [showPin, setShowPin] = useState(false)
  const [pinVerifying, setPinVerifying] = useState(false)
  const [signAs, setSignAs] = useState<SignAsType>("none")

  // Canvas + PDF state
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [numPages, setNumPages] = useState(1)
  const [pdfPageH, setPdfPageH] = useState(841.89) // A4 default
  const [pdfScale, setPdfScale] = useState(1.5)
  const [canvasReady, setCanvasReady] = useState(false)
  const [canvasError, setCanvasError] = useState<string | null>(null)

  // Element states (canvas pixels)
  const [sigState, setSigState] = useState<ElemState>({ x: 60, y: 200, w: 140, h: 60 })
  const [nameState, setNameState] = useState<ElemState>({ x: 60, y: 270, w: 140, h: 24 })
  const [qrState, setQrState] = useState<ElemState>({ x: 0, y: 10, w: 80, h: 80 })
  const [prefixState, setPrefixState] = useState<ElemState>({ x: 220, y: 270, w: 60, h: 24 })
  const [showSig, setShowSig] = useState(true)
  const [showName, setShowName] = useState(true)

  // nodeRefs for react-draggable (React 19 requirement)
  const sigNodeRef = useRef<HTMLDivElement>(null)
  const nameNodeRef = useRef<HTMLDivElement>(null)
  const qrNodeRef = useRef<HTMLDivElement>(null)
  const prefixNodeRef = useRef<HTMLDivElement>(null)

  // Render 1 trang PDF lên canvas — tách riêng để gọi lại khi đổi trang, không
  // phải load lại toàn bộ file. Tính lại viewport/scale mỗi lần vì kích thước
  // trang có thể khác nhau giữa các trang.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderPdfPage = async (pdf: any, pageNum: number) => {
    const page = await pdf.getPage(pageNum)
    const scale = 1.5
    const viewport = page.getViewport({ scale })
    const cW = Math.floor(viewport.width)
    const cH = Math.floor(viewport.height)

    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = cW
    canvas.height = cH

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx, viewport } as any).promise

    const unscaledViewport = page.getViewport({ scale: 1 })
    setPdfScale(scale)
    setPdfPageH(unscaledViewport.height)
  }

  // Load PDF and render to canvas — chỉ chạy khi đã sang bước "placement" (PIN đã
  // xác thực đúng), tránh tải file lãng phí nếu người dùng hủy ngay ở bước nhập PIN.
  useEffect(() => {
    if (!showCanvas || !sourceFileUrl || step !== "placement") return
    let cancelled = false

    const loadPdf = async () => {
      const pdfjsLib = await import("pdfjs-dist")
      if ((globalThis as Record<string, unknown>).pdfjsWorker) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = ""
      } else {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs", import.meta.url
        ).toString()
      }

      const task = pdfjsLib.getDocument(sourceFileUrl)
      const pdf = await task.promise
      if (cancelled) return

      pdfDocRef.current = pdf
      setNumPages(pdf.numPages)
      await renderPdfPage(pdf, 1)
      if (cancelled) return

      const cH = canvasRef.current?.height || 0
      const cW = canvasRef.current?.width || 0

      // Set default positions based on canvas size
      setSigState({ x: 60, y: cH - 120, w: 140, h: 60 })
      setNameState({ x: 60, y: cH - 55, w: 140, h: 24 })
      setQrState({ x: cW - 100, y: 10, w: 80, h: 80 })
      setPrefixState({ x: 220, y: cH - 55, w: 60, h: 24 })
      setCanvasReady(true)
    }

    loadPdf().catch(() => {
      if (!cancelled) setCanvasError("Không tải được file PDF để hiển thị. Chữ ký sẽ đặt ở vị trí mặc định.")
    })
    return () => { cancelled = true }
  }, [showCanvas, sourceFileUrl, step])

  const goToPage = (p: number) => {
    if (p < 1 || p > numPages || !pdfDocRef.current) return
    setCurrentPage(p)
    void renderPdfPage(pdfDocRef.current, p)
  }

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

  const handleConfirm = () => {
    if (!pin.trim()) { setStep("pin"); setPinError("Vui lòng nhập lại PIN"); return }

    let placement: FullPlacement
    if (showCanvas && canvasReady) {
      const sigPdf = toPdf(sigState.x, sigState.y, sigState.w, sigState.h)
      const namePdf = toPdf(nameState.x, nameState.y, nameState.w, nameState.h)

      placement = {
        page: currentPage,
        x: sigPdf.x, y: sigPdf.y, width: sigPdf.width, height: sigPdf.height,
        showSignature: showSig,
        showSignerName: showName,
        nameX: namePdf.x, nameY: namePdf.y, nameWidth: namePdf.width, nameHeight: namePdf.height,
      }

      if (action === "soan_thao") {
        const qrPdf = toPdf(qrState.x, qrState.y, qrState.w, qrState.h)
        placement.qrX = qrPdf.x
        placement.qrY = qrPdf.y
        placement.qrWidth = qrPdf.width
        placement.qrHeight = qrPdf.height
      }

      if (showSignAsPicker && signAs !== "none") {
        const prefixPdf = toPdf(prefixState.x, prefixState.y, prefixState.w, prefixState.h)
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

    onConfirm(pin, placement, showSignAsPicker ? signAs : "none")
  }

  const stepTagMap: Record<string, { nameTag: string; sigTag: string }> = {
    soan_thao: { nameTag: "{{TEN_SOAN_THAO}}", sigTag: "{{CHU_KY_SOAN_THAO}}" },
    xem_xet: { nameTag: "{{TEN_XEM_XET}}", sigTag: "{{CHU_KY_XEM_XET}}" },
    phe_duyet: { nameTag: "{{TEN_PHE_DUYET}}", sigTag: "{{CHU_KY_PHE_DUYET}}" },
  }
  const { nameTag, sigTag } = stepTagMap[action] ?? { nameTag: "", sigTag: "" }
  const stepLabel = action === "soan_thao" ? "Ký và gửi hồ sơ" : action === "xem_xet" ? "Ký xem xét" : "Ký phê duyệt"

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
              ? "Kéo và thay đổi kích thước để đặt vị trí chữ ký trên PDF"
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

      <div className="flex-1 overflow-auto flex items-start p-4 bg-slate-100">
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
                {/* QR — only soan_thao */}
                {action === "soan_thao" && (
                  <Draggable
                    nodeRef={qrNodeRef as RefObject<HTMLElement>}
                    position={{ x: qrState.x, y: qrState.y }}
                    onStop={(_, d) => setQrState((p) => ({ ...p, x: d.x, y: d.y }))}
                    bounds="parent"
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

                {/* Signature */}
                <Draggable
                  nodeRef={sigNodeRef as RefObject<HTMLElement>}
                  position={{ x: sigState.x, y: sigState.y }}
                  onStop={(_, d) => setSigState((p) => ({ ...p, x: d.x, y: d.y }))}
                  bounds="parent"
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
                    >
                      <div className="w-full h-full border border-dashed border-emerald-400 bg-emerald-50/60 rounded relative select-none">
                        {showSig && signatureUrl && (
                          <img src={signatureUrl} alt="Chữ ký" className="w-full h-full object-contain opacity-90" />
                        )}
                        {showSig && !signatureUrl && (
                          <div className="w-full h-full flex items-center justify-center">
                            <span className="text-[10px] text-slate-400">Chữ ký</span>
                          </div>
                        )}
                        {!showSig && (
                          <div className="w-full h-full flex items-center justify-center bg-slate-100/80">
                            <span className="text-[10px] text-slate-400">Ẩn chữ ký</span>
                          </div>
                        )}
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => setShowSig((v) => !v)}
                          className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50"
                          style={{ zIndex: 20 }}
                          title={showSig ? "Ẩn chữ ký" : "Hiện chữ ký"}
                        >
                          {showSig ? <EyeOff size={10} /> : <Eye size={10} />}
                        </button>
                      </div>
                    </Resizable>
                  </div>
                </Draggable>

                {/* Name */}
                <Draggable
                  nodeRef={nameNodeRef as RefObject<HTMLElement>}
                  position={{ x: nameState.x, y: nameState.y }}
                  onStop={(_, d) => setNameState((p) => ({ ...p, x: d.x, y: d.y }))}
                  bounds="parent"
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
                      minWidth={60} minHeight={16}
                    >
                      <div className="w-full h-full border border-dashed border-violet-400 bg-violet-50/60 rounded relative select-none flex items-center justify-center">
                        {showName ? (
                          <span className="text-[10px] font-bold text-violet-700 truncate px-1">{userName || "Người ký"}</span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Ẩn tên</span>
                        )}
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => setShowName((v) => !v)}
                          className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50"
                          style={{ zIndex: 20 }}
                          title={showName ? "Ẩn tên" : "Hiện tên"}
                        >
                          {showName ? <EyeOff size={10} /> : <Eye size={10} />}
                        </button>
                      </div>
                    </Resizable>
                  </div>
                </Draggable>

                {/* Tiền tố ký thay (KT./TM./TL./TUQ.) — chỉ bước Phê duyệt, chỉ hiện khi đã chọn */}
                {showSignAsPicker && signAs !== "none" && (
                  <Draggable
                    nodeRef={prefixNodeRef as RefObject<HTMLElement>}
                    position={{ x: prefixState.x, y: prefixState.y }}
                    onStop={(_, d) => setPrefixState((p) => ({ ...p, x: d.x, y: d.y }))}
                    bounds="parent"
                  >
                    <div ref={prefixNodeRef} className="absolute top-0 left-0 cursor-move" style={{ zIndex: 11 }}>
                      <Resizable
                        size={{ width: prefixState.w, height: prefixState.h }}
                        onResizeStop={(_, __, ___, delta) =>
                          setPrefixState((p) => ({ ...p, w: p.w + delta.width, h: p.h + delta.height }))}
                        enable={{ right: true, bottom: true, bottomRight: true }}
                        minWidth={36} minHeight={16}
                      >
                        <div className="w-full h-full border border-dashed border-emerald-400 bg-emerald-50/60 rounded relative select-none flex items-center justify-center">
                          <span className="text-[10px] font-bold text-emerald-700 truncate px-1">{signAs}.</span>
                        </div>
                      </Resizable>
                    </div>
                  </Draggable>
                )}
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
              {action === "soan_thao" && (
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

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState("")
  const [loading, setLoading] = useState(true)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)

  const [instance, setInstance] = useState<IsoFormInstance | null>(null)
  const [template, setTemplate] = useState<Pick<IsoDocument, "id" | "ten_tai_lieu" | "ma_tai_lieu" | "loai_tai_lieu" | "phong_ban" | "lan_ban_hanh"> & { file_signed_pdf_url?: string | null; file_goc_url?: string | null; mo_ta_tim_kiem?: string | null } | null>(null)
  const [logs, setLogs] = useState<LogRow[]>([])

  // Config state (editable when draft/tra_ve)
  const [cap_tl, setCapTl] = useState("Cấp 1")
  const [xemXetUserId, setXemXetUserId] = useState("")
  const [pheDuyetUserId, setPheDuyetUserId] = useState("")
  const [autoConvertPdf, setAutoConvertPdf] = useState(false)
  const [ghiChu, setGhiChu] = useState("")
  const [profilesXemXet, setProfilesXemXet] = useState<ProfileOption[]>([])
  const [profilesPheDuyet, setProfilesPheDuyet] = useState<ProfileOption[]>([])

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
    action: "soan_thao" | "xem_xet" | "phe_duyet"
    sourceFileUrl: string | null
  } | null>(null)
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [signLoading, setSignLoading] = useState(false)

  // Bootstrap
  useEffect(() => {
    const bootstrap = async () => {
      try {
        const fid = await getActiveFactoryId()
        if (!fid) { setLoading(false); return }
        const session = await getFreshAuthSession()
        const uid = session?.user?.id
        if (!uid) { setLoading(false); return }
        setFactoryId(fid)
        setUserId(uid)
        // Load user profile for full name
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, username")
          .eq("id", uid)
          .single()
        if (profile) {
          setUserName((profile.full_name as string) || (profile.username as string) || "")
        }
        // Load user's signature URL
        const { data: sigUrlData } = supabase.storage
          .from("iso-documents")
          .getPublicUrl(`signatures/${fid}/${uid}/chu_ky.png`)
        setSignatureUrl(sigUrlData.publicUrl)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

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
    setLogs((logData ?? []) as LogRow[])
    return row
  }, [instanceId])

  const loadProfiles = useCallback(async (fid: string) => {
    const [resX, resP] = await Promise.all([
      fetch(`/api/iso/profiles-by-permission?factoryId=${fid}&permCode=iso.forms.approve`),
      fetch(`/api/iso/profiles-by-permission?factoryId=${fid}&permCode=iso.forms.approve`),
    ])
    const dataX = resX.ok ? (await resX.json() as { profiles?: ProfileOption[] }) : {}
    const dataP = resP.ok ? (await resP.json() as { profiles?: ProfileOption[] }) : {}
    setProfilesXemXet(Array.isArray(dataX.profiles) ? dataX.profiles : [])
    setProfilesPheDuyet(Array.isArray(dataP.profiles) ? dataP.profiles : [])
  }, [])

  useEffect(() => {
    if (factoryId) {
      void loadInstance(factoryId)
      void loadProfiles(factoryId)
    }
  }, [factoryId, loadInstance, loadProfiles])

  // ── Upload file ──────────────────────────────────────────────────────────
  const handleUpload = async (file?: File) => {
    const fileToUpload = file ?? uploadFile
    if (!fileToUpload || !factoryId || !instance) return
    setUploading(true)
    setUploadError(null)
    try {
      const ext = fileToUpload.name.split(".").pop()?.toLowerCase() ?? "docx"
      if (ext === "pdf") {
        setAutoConvertPdf(true)
      } else {
        setAutoConvertPdf(false)
      }
      const storagePath = `${factoryId}/iso/instances/${instanceId}/draft.${ext}`
      const { error } = await supabase.storage.from("iso-documents").upload(storagePath, fileToUpload, { upsert: true })
      if (error) { setUploadError(error.message); return }
      const { data: urlData } = supabase.storage.from("iso-documents").getPublicUrl(storagePath)
      const updateData: Record<string, unknown> = { draft_file_url: urlData.publicUrl, draft_file_type: ext }
      updateData.auto_convert_pdf = ext === "pdf"
      const { error: upErr } = await supabase.from("iso_form_instances")
        .update(updateData)
        .eq("id", instanceId)
      if (upErr) { setUploadError(upErr.message); return }
      setUploadFile(null)
      void loadInstance(factoryId)
      if (ext === "docx") void loadDocxPreview(fileToUpload)
    } finally {
      setUploading(false)
    }
  }

  const handleDownload = async () => {
    if (!fileUrl || !instance) return
    const urlExt = fileUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? ""
    const ext = ["docx", "xlsx", "pdf"].includes(urlExt) ? urlExt : (instance.draft_file_type || "docx")
    const filename = `${instance.tieu_de || "ho_so"}.${ext}`
    try {
      const res = await fetch(fileUrl)
      const blob = await res.blob()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    } catch {
      window.open(fileUrl, "_blank")
    }
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

  // ── Save config ──────────────────────────────────────────────────────────
  // ── Open sign modal ──────────────────────────────────────────────────────
  const openSendModal = async () => {
    if (!instance || !factoryId) return
    if (cap_tl === "Cấp 1" && !xemXetUserId) { setActionError("Vui lòng chọn người xem xét"); return }
    if (!pheDuyetUserId) { setActionError("Vui lòng chọn người phê duyệt"); return }
    setSaving(true)
    setActionError(null)
    let reloaded: IsoFormInstance | null = null
    try {
      const updates: Record<string, unknown> = {
        cap_tl,
        phe_duyet_user_id: pheDuyetUserId || null,
        phe_duyet: pheDuyetUserId ? profileLabel(profilesPheDuyet.find((p) => p.id === pheDuyetUserId) ?? { id: "", full_name: null, username: null }) : null,
        auto_convert_pdf: autoConvertPdf,
        ghi_chu: ghiChu || null,
      }
      if (cap_tl === "Cấp 1") {
        updates.xem_xet_user_id = xemXetUserId || null
        updates.xem_xet = xemXetUserId ? profileLabel(profilesXemXet.find((p) => p.id === xemXetUserId) ?? { id: "", full_name: null, username: null }) : null
      } else {
        updates.xem_xet_user_id = null
        updates.xem_xet = null
      }
      const { error } = await supabase.from("iso_form_instances").update(updates).eq("id", instanceId)
      if (error) { setActionError(error.message); return }
      reloaded = await loadInstance(factoryId)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Lỗi lưu cài đặt")
      return
    } finally {
      setSaving(false)
    }
    // Dùng URL từ kết quả reload (fresh) thay vì closure cũ để tránh URL cũ (VD: .pdf) khi user vừa thay file
    const freshFileUrl = reloaded?.draft_file_url ?? instance.draft_file_url
    setSignModal({ action: "soan_thao", sourceFileUrl: freshFileUrl })
  }

  const openXemXetModal = () => {
    if (!instance) return
    const src = instance.soan_thao_signed_url || instance.draft_file_url
    setSignModal({ action: "xem_xet", sourceFileUrl: src })
  }

  const openPheDuyetModal = () => {
    if (!instance) return
    const isDraftPdf = instance.draft_file_type === "pdf"
    const src = isDraftPdf
      ? (instance.final_pdf_url || instance.soan_thao_signed_url || instance.draft_file_url)
      : (instance.soan_thao_signed_url || instance.draft_file_url)
    setSignModal({ action: "phe_duyet", sourceFileUrl: src })
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
        .update({ trang_thai: "tra_ve" as IsoFormInstanceStatus, ly_do_tra_ve: lyDo })
        .eq("id", instanceId)
      if (error) { setActionError(error.message); return }
      await supabase.from("iso_form_instance_logs").insert({
        instance_id: instanceId, factory_id: factoryId, user_id: userId,
        action: "tra_ve", note: lyDo,
      })
      setActionSuccess("Đã trả về")
      setTimeout(() => setActionSuccess(null), 3000)
      // Notify phù hợp theo trạng thái và cấp
      const recipients: string[] = []
      if (prevTrangThai === "cho_xem_xet") {
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
  const handleSignConfirm = async (pin: string, placement: FullPlacement, signAs: SignAsType) => {
    if (!factoryId || !userId || !signModal || !instance) return

    setSignLoading(true)
    setActionError(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        setActionError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
        return
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
        setActionError(verifyJson.error ?? "PIN không đúng")
        return
      }

      // 2. Finalize
      const finalizeRes = await fetch(`/api/iso/forms/${instanceId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: verifyJson.token,
          action: signModal.action,
          placement,
          cap_tl: instance.cap_tl,
          sign_as: signAs,
        }),
      })
      const finalizeJson = await finalizeRes.json() as { success?: boolean; trang_thai?: string; error?: string }
      if (!finalizeRes.ok) {
        setActionError(finalizeJson.error ?? "Lỗi ký số")
        return
      }

      const completedAction = signModal.action
      setSignModal(null)
      const successMsg = completedAction === "phe_duyet"
        ? "Đã phê duyệt hồ sơ"
        : completedAction === "xem_xet"
          ? "Đã ký xem xét"
          : "Đã ký và gửi hồ sơ"
      setActionSuccess(successMsg)
      setTimeout(() => setActionSuccess(null), 4000)
      // Notify theo từng action
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
      void loadInstance(factoryId)
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
  const isXemXet = instance.trang_thai === "cho_xem_xet" && instance.xem_xet_user_id === userId
  const isPheDuyet = instance.trang_thai === "cho_phe_duyet" && instance.phe_duyet_user_id === userId
  const canReturn =
    (instance.trang_thai === "cho_xem_xet" && instance.xem_xet_user_id === userId) ||
    (instance.trang_thai === "cho_phe_duyet" && instance.phe_duyet_user_id === userId)
  const isDone = instance.trang_thai === "da_phe_duyet"
  // Khi hồ sơ đang ở draft/tra_ve, file ký (soan_thao_signed_url/final_pdf_url...) của vòng ký
  // TRƯỚC đó (đã bị trả về) không còn hiệu lực — luôn ưu tiên draft_file_url mới nhất (kể cả
  // sau khi người soạn thảo thay file khác), tránh "Xem file"/"Tải xuống" hiện nhầm PDF cũ.
  const fileUrl = isEditable
    ? instance.draft_file_url
    : (instance.final_pdf_url || instance.final_office_url || instance.soan_thao_signed_url || instance.draft_file_url)
  const isNguoiTao = instance.nguoi_tao === userId

  return (
    <IsoShell>
      <div className="space-y-5">
        {/* ── Back + Header ── */}
        <div className="flex items-start gap-3">
          <button
            onClick={() => router.push("/dashboard/iso/forms")}
            className="mt-1 p-2 rounded-xl hover:bg-slate-100 text-slate-500 shrink-0"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-extrabold text-slate-800 line-clamp-2">{instance.tieu_de}</h1>
              <StatusBadge status={instance.trang_thai} />
            </div>
            {instance.ly_do_tra_ve && (
              <div className="mt-1 text-sm text-rose-600 flex items-start gap-1">
                <Info size={13} className="mt-0.5 shrink-0" />
                <span>{instance.ly_do_tra_ve}</span>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-1">
              Tạo: {fmtDate(instance.created_at)} &middot; Cập nhật: {fmtDate(instance.updated_at)}
            </p>
          </div>
        </div>

        {/* ── Workflow stepper + Actions inline ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <WorkflowStepper cap_tl={cap_tl} trang_thai={instance.trang_thai} />
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {isEditable && isNguoiTao && (
                <button
                  onClick={openSendModal}
                  disabled={saving || !instance.draft_file_url}
                  className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {cap_tl === "Cấp 1" ? "Ký & Gửi xem xét" : "Ký & Gửi phê duyệt"}
                </button>
              )}
              {isXemXet && (
                <button
                  onClick={openXemXetModal}
                  disabled={signLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors"
                >
                  {signLoading ? <Loader2 size={13} className="animate-spin" /> : <Pen size={13} />}
                  Ký xem xét
                </button>
              )}
              {isPheDuyet && (
                <button
                  onClick={openPheDuyetModal}
                  disabled={signLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors"
                >
                  {signLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Phê duyệt
                </button>
              )}
              {canReturn && (
                <button
                  onClick={() => setShowReturnModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-sm font-bold rounded-xl border border-rose-200 transition-colors"
                >
                  <RotateCcw size={13} /> Trả về
                </button>
              )}
              <button
                onClick={() => factoryId && void loadInstance(factoryId)}
                className="flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-slate-600 text-xs rounded-xl hover:bg-slate-50"
                title="Làm mới"
              >
                <RefreshCcw size={12} />
              </button>
            </div>
          </div>
          {isEditable && isNguoiTao && !instance.draft_file_url && (
            <div className="mt-2 flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>Cần tải lên file hồ sơ trước khi gửi.</span>
            </div>
          )}
        </div>

        {/* ── Toast notifications ── */}
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ── Left column (2/3) ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* Template info */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-700 mb-3 flex items-center gap-2">
                <FileText size={14} className="text-violet-500" />
                Biểu mẫu gốc (read-only)
              </h2>
              {template ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-slate-400">Tên</span>
                    <p className="font-semibold text-slate-800 mt-0.5">{template.ten_tai_lieu}</p>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400">Mã</span>
                    <p className="font-semibold text-slate-800 mt-0.5">{template.ma_tai_lieu}</p>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400">Loại</span>
                    <p className="font-semibold text-slate-800 mt-0.5">
                      {LOAI_TAI_LIEU_LABEL[template.loai_tai_lieu ?? ""] ?? template.loai_tai_lieu}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400">Phòng ban</span>
                    <p className="font-semibold text-slate-800 mt-0.5">{template.phong_ban}</p>
                  </div>
                  {template.mo_ta_tim_kiem && (
                    <div className="col-span-2">
                      <span className="text-xs text-slate-400">Mô tả tìm kiếm AI</span>
                      <p className="text-sm text-slate-600 mt-0.5 italic">{template.mo_ta_tim_kiem}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Đang tải thông tin biểu mẫu...</p>
              )}
            </div>

            {/* File section */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-700 mb-3 flex items-center gap-2">
                <Upload size={14} className="text-slate-500" />
                File hồ sơ
              </h2>

              {/* PDF-only template banner */}
              {!instance.draft_file_url && (template?.file_signed_pdf_url || template?.file_goc_url) && (
                <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl mb-3">
                  <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 text-sm">
                    <p className="font-semibold text-amber-800">Biểu mẫu gốc chỉ có dạng PDF</p>
                    <p className="text-xs text-amber-600 mt-0.5">Tải PDF về làm mẫu → điền nội dung → upload lại file (.docx, .xlsx, hoặc .pdf).</p>
                    <a
                      href={(template.file_signed_pdf_url || template.file_goc_url) ?? ""}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-bold rounded-lg"
                    >
                      <Download size={12} /> Tải PDF mẫu
                    </a>
                  </div>
                </div>
              )}

              {/* Current file */}
              {instance.draft_file_url && !uploading && (
                <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl mb-3">
                  <FileText size={20} className="text-violet-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {instance.tieu_de ?? (isDone ? "File đã phê duyệt" : "File nháp")}
                    </p>
                    <span className="text-[10px] font-bold uppercase text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded">{instance.draft_file_type ?? "file"}</span>
                  </div>
                  <a
                    href={fileUrl ?? ""}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500"
                    title="Xem file"
                  >
                    <Eye size={14} />
                  </a>
                  <button
                    onClick={handleDownload}
                    className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500"
                    title="Tải về"
                  >
                    <Download size={14} />
                  </button>
                  {isEditable && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-50 rounded-lg"
                    >
                      <RotateCcw size={11} /> Thay file
                    </button>
                  )}
                </div>
              )}
              {/* Uploading progress indicator */}
              {uploading && (
                <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl mb-3">
                  <Loader2 size={16} className="text-amber-500 animate-spin shrink-0" />
                  <span className="text-sm text-amber-700 flex-1 truncate">{uploadFile?.name ?? "Đang tải lên..."}</span>
                </div>
              )}

              {/* Final file (after approval) */}
              {isDone && (instance.final_pdf_url || instance.final_office_url) && (
                <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl mb-3 border border-emerald-100">
                  <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-emerald-800">File đã ký duyệt</p>
                    <p className="text-xs text-emerald-500">{instance.final_pdf_url ? "PDF" : instance.draft_file_type?.toUpperCase()}</p>
                  </div>
                  <a
                    href={(instance.final_pdf_url || instance.final_office_url) ?? ""}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 rounded-lg"
                  >
                    <Eye size={12} /> Xem
                  </a>
                </div>
              )}

              {/* Upload zone (only when editable and not currently uploading) */}
              {isEditable && !uploading && (
                <div>
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
                    }}
                  />
                  {!instance.draft_file_url && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-3 border-2 border-dashed border-slate-300 hover:border-violet-300 hover:bg-violet-50 rounded-xl text-sm text-slate-500 hover:text-violet-600 transition-colors flex items-center justify-center gap-2"
                    >
                      <Upload size={14} />
                      Tải lên file hồ sơ (.docx, .xlsx, .pdf)
                    </button>
                  )}
                  {uploadError && (
                    <p className="mt-2 text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={11} />{uploadError}</p>
                  )}
                </div>
              )}

              {/* DOCX preview */}
              {docxPreviewHtml && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowPreview((p) => !p)}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-violet-600"
                  >
                    {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showPreview ? "Ẩn xem trước" : "Xem trước nội dung DOCX"}
                  </button>
                  {showPreview && (
                    <div
                      className="mt-2 p-4 border border-slate-200 rounded-xl bg-white max-h-80 overflow-y-auto text-sm prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: docxPreviewHtml }}
                    />
                  )}
                </div>
              )}
            </div>

          </div>

          {/* ── Right column (1/3) ── */}
          <div className="space-y-5">

            {/* Config panel (editable only) */}
            {isEditable && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-sm font-extrabold text-slate-700 mb-3 flex items-center gap-2">
                  <Settings size={14} className="text-slate-500" />
                  Cấu hình phê duyệt
                </h2>

                <div className="space-y-3">
                  {/* Cấp phê duyệt */}
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Cấp phê duyệt</label>
                    <div className="flex gap-2">
                      {["Cấp 1", "Cấp 2"].map((cap) => (
                        <button
                          key={cap}
                          onClick={() => setCapTl(cap)}
                          className={
                            "flex-1 py-2 rounded-xl text-xs font-bold border transition-colors " +
                            (cap_tl === cap
                              ? "bg-violet-100 text-violet-700 border-violet-300"
                              : "text-slate-500 border-slate-200 hover:bg-slate-50")
                          }
                        >
                          {cap}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Người xem xét (Cấp 1) */}
                  {cap_tl === "Cấp 1" && (
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Người xem xét</label>
                      <select
                        value={xemXetUserId}
                        onChange={(e) => setXemXetUserId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-400"
                      >
                        <option value="">— Chọn người xem xét —</option>
                        {profilesXemXet.filter((p) => p.id !== userId).map((p) => (
                          <option key={p.id} value={p.id}>{profileLabel(p)}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Người phê duyệt */}
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Người phê duyệt</label>
                    <select
                      value={pheDuyetUserId}
                      onChange={(e) => setPheDuyetUserId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-400"
                    >
                      <option value="">— Chọn người phê duyệt —</option>
                      {profilesPheDuyet.filter((p) => p.id !== userId && p.id !== xemXetUserId).map((p) => (
                        <option key={p.id} value={p.id}>{profileLabel(p)}</option>
                      ))}
                    </select>
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
                      onClick={() => { if (instance.draft_file_type !== "pdf") setAutoConvertPdf((v) => !v) }}
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

                  <p className="text-[11px] text-slate-400 text-center">Cài đặt sẽ được lưu tự động khi ký &amp; gửi</p>
                </div>
              </div>
            )}

            {/* Tiến trình & Lịch sử (always shown when there is data) */}
            {(instance.soan_thao || instance.xem_xet || instance.phe_duyet || logs.length > 0) && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-sm font-extrabold text-slate-700 mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-slate-400" />
                  Tiến trình &amp; Lịch sử
                </h2>

                {/* Signing timeline */}
                {(instance.soan_thao || instance.xem_xet || instance.phe_duyet) && (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Cấp</span>
                      <span className="font-semibold text-slate-700">{instance.cap_tl}</span>
                    </div>
                    {instance.soan_thao && (
                      <div className="flex justify-between items-start">
                        <span className="text-slate-400 shrink-0 mr-2">Soạn thảo</span>
                        <div className="text-right">
                          <span className={`font-semibold ${instance.ky_soan_thao_at ? "text-emerald-600" : "text-slate-700"}`}>
                            {instance.soan_thao}{instance.ky_soan_thao_at ? " ✓" : ""}
                          </span>
                          {instance.ky_soan_thao_at && (
                            <div className="text-[10px] text-slate-400">{fmtDate(instance.ky_soan_thao_at)}</div>
                          )}
                        </div>
                      </div>
                    )}
                    {instance.xem_xet && (
                      <div className="flex justify-between items-start">
                        <span className="text-slate-400 shrink-0 mr-2">Xem xét</span>
                        <div className="text-right">
                          <span className={`font-semibold ${instance.ky_xem_xet_at ? "text-emerald-600" : "text-slate-700"}`}>
                            {instance.xem_xet}{instance.ky_xem_xet_at ? " ✓" : ""}
                          </span>
                          {instance.ky_xem_xet_at && (
                            <div className="text-[10px] text-slate-400">{fmtDate(instance.ky_xem_xet_at)}</div>
                          )}
                        </div>
                      </div>
                    )}
                    {instance.phe_duyet && (
                      <div className="flex justify-between items-start">
                        <span className="text-slate-400 shrink-0 mr-2">Phê duyệt</span>
                        <div className="text-right">
                          <span className={`font-semibold ${instance.ky_phe_duyet_at ? "text-emerald-600" : "text-slate-700"}`}>
                            {signAsPrefixLabel(instance.phe_duyet_sign_as)}{instance.phe_duyet}{instance.ky_phe_duyet_at ? " ✓" : ""}
                          </span>
                          {instance.ky_phe_duyet_at && (
                            <div className="text-[10px] text-slate-400">{fmtDate(instance.ky_phe_duyet_at)}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Log history */}
                {logs.length > 0 && (
                  <>
                    {(instance.soan_thao || instance.xem_xet || instance.phe_duyet) && (
                      <div className="border-t border-slate-100 my-3" />
                    )}
                    <div className="space-y-2">
                      {logs.map((log) => (
                        <div key={log.id} className="flex items-start gap-3 text-xs">
                          <User size={12} className="text-slate-400 mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <span className="font-bold text-slate-700">{log.action}</span>
                            {log.note && <span className="text-slate-500 ml-1">— {log.note}</span>}
                            <span className="text-slate-300 ml-2">{fmtDate(log.created_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Sign Placement Modal */}
      {signModal && userId && (
        <SignPlacementModal
          action={signModal.action}
          sourceFileUrl={signModal.sourceFileUrl}
          fileType={instance.draft_file_type}
          autoConvertPdf={instance.auto_convert_pdf}
          signatureUrl={signatureUrl}
          userName={userName}
          instanceId={instanceId}
          userId={userId}
          acting={signLoading}
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
    </IsoShell>
  )
}
