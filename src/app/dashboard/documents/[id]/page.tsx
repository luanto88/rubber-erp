"use client"

import { useCallback, useEffect, useRef, useState, Fragment } from "react"
import type { RefObject } from "react"
import { useParams, useRouter } from "next/navigation"
import Draggable from "react-draggable"
import { Resizable } from "re-resizable"
import { QRCodeSVG } from "qrcode.react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hydrateActiveSession, hasPermission } from "@/lib/auth"
import { DocumentsShell } from "../_components/documents-shell"
import {
  LOAI_VAN_BAN_LABEL,
  TRANG_THAI_COLOR,
  TRANG_THAI_LABEL,
  PHAN_LOAI_LABEL,
  PHAN_LOAI_COLOR,
  SIGN_AS_OPTIONS,
  SIGN_AS_LABEL,
  fmtDate,
  sanitizeStorageFileName,
  type VanBanDocument,
  type ThuTuKyStep,
  type SignAsType,
} from "../_components/documents-types"
import { Lock } from "lucide-react"
import {
  AlertTriangle,
  X,
  CheckCircle2,
  Clock,
  FileText,
  Send,
  RotateCcw,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  PenLine,
  ShieldCheck,
  Printer,
  Share2,
  Loader2,
  Upload,
  Plus,
} from "lucide-react"
import type { SessionUser } from "@/lib/auth"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"

const STORAGE_BUCKET = "iso-documents"

type NguoiKyEntry = { ten: string; chuc_vu: string; ky_at: string; is_kt?: boolean; sign_as?: SignAsType }
type DistUser = { id: string; full_name: string; department: string; role: string; alreadyReceived: string[] }

type SignPlacement = {
  page: number
  x: number; y: number; width: number; height: number
  showSignature: boolean; showSignerName: boolean
  nameX: number; nameY: number; nameWidth: number; nameHeight: number
  showPrefix?: boolean
  prefixX?: number; prefixY?: number; prefixWidth?: number; prefixHeight?: number
  showQr?: boolean
  qrX?: number; qrY?: number; qrWidth?: number; qrHeight?: number
  extraPlacements?: Array<{
    page: number
    x: number; y: number; width: number; height: number
    showSignature: boolean; showSignerName: boolean
    nameX: number; nameY: number; nameWidth: number; nameHeight: number
  }>
}
type ElemState = { x: number; y: number; w: number; h: number }

// Đọc tiền tố ký thay để hiển thị trên timeline — ưu tiên sign_as (cơ chế mới,
// chọn lúc ký), fallback is_kt/phe_duyet_is_kt (cơ chế cũ, chỉ có "KT.") cho dữ
// liệu lịch sử trước 2026-07-06.
function signAsPrefixLabel(signAs: SignAsType | null | undefined, legacyIsKt: boolean | null | undefined): string {
  if (signAs && signAs !== "none") return `${signAs}. `
  if (legacyIsKt) return "KT. "
  return ""
}

function urlIsPdf(url: string | null): boolean {
  if (!url) return false
  return url.split("?")[0].toLowerCase().endsWith(".pdf")
}

function getDocFileExt(url: string | null, officeType: string | null): string | null {
  if (!url) return officeType || null
  const clean = url.split("?")[0].toLowerCase()
  if (clean.endsWith(".pdf")) return "pdf"
  if (clean.endsWith(".docx")) return "docx"
  if (clean.endsWith(".xlsx")) return "xlsx"
  return officeType || null
}

// Modal ký duyệt: hiển thị canvas PDF cho kéo-thả vị trí chữ ký/tên khi file nguồn
// là PDF (mirror SignPlacementModal của module ISO forms — iso/forms/[id]/page.tsx);
// với file Office chỉ hiển thị thông tin tag sẽ được thay tự động, không có canvas.
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
      cancel=".react-resizable-handle,button"
    >
      <div ref={nodeRef} style={{ position: "absolute", top: 0, left: 0, zIndex, cursor: "move" }}>
        {children}
      </div>
    </Draggable>
  )
}

function SignPlacementModal({
  stepLabel,
  sourceFileUrl,
  fileExt,
  signatureUrl,
  userName,
  sigTag,
  nameTag,
  acting,
  allowSignAs,
  allowQrPlacement,
  userId,
  docId,
  onConfirm,
  onClose,
}: {
  stepLabel: string
  sourceFileUrl: string | null
  fileExt: string | null
  signatureUrl: string | null
  userName: string
  sigTag: string
  nameTag: string
  acting: boolean
  allowSignAs: boolean
  // true khi văn bản CHƯA từng có QR được đặt vị trí (lượt ký đầu tiên) — hiện hộp
  // QR kéo-thả để chọn vị trí; các lượt ký sau tái dùng đúng vị trí đã lưu, không
  // hiện hộp QR nữa (tránh vẽ chồng nhiều QR ở nhiều vị trí khác nhau qua các lần ký).
  allowQrPlacement: boolean
  userId: string
  docId: string
  onConfirm: (pin: string, placement: SignPlacement | null, signAs: SignAsType) => void
  onClose: () => void
}) {
  const isPdf = fileExt === "pdf" || urlIsPdf(sourceFileUrl)
  const showCanvas = isPdf && !!sourceFileUrl
  // Ký thay (KT./TM./TL./TUQ.) chỉ có ý nghĩa trên PDF (vẽ hộp riêng) — DOCX/XLSX
  // không cần tính năng này (đã xác nhận với người dùng), nên chỉ hiện picker khi
  // action cho phép VÀ file đang ký là PDF.
  const showSignAsPicker = allowSignAs && showCanvas

  // Luồng ký chia 2 bước, mirror iso/documents/[id]/page.tsx: PIN phải xác thực đúng
  // (chặn, gọi /api/sign/verify) TRƯỚC khi hiện canvas PDF đặt vị trí chữ ký — tránh vừa
  // tốn công đặt vị trí vừa phải nhập lại PIN nếu gõ sai, và không tải PDF lãng phí nếu
  // người dùng hủy ngay ở bước nhập PIN.
  const [step, setStep] = useState<"pin" | "placement">("pin")
  const [pin, setPin] = useState("")
  const [pinError, setPinError] = useState("")
  const [showPin, setShowPin] = useState(false)
  const [pinVerifying, setPinVerifying] = useState(false)
  const [signAs, setSignAs] = useState<SignAsType>("none")

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



  const [sigState, setSigState] = useState<ElemState>({ x: 60, y: 200, w: 140, h: 60 })
  const [nameState, setNameState] = useState<ElemState>({ x: 60, y: 270, w: 140, h: 24 })
  const [prefixState, setPrefixState] = useState<ElemState>({ x: 220, y: 270, w: 60, h: 24 })
  const [qrState, setQrState] = useState<ElemState>({ x: 20, y: 20, w: 70, h: 70 })
  const [showSig, setShowSig] = useState(true)
  const [showName, setShowName] = useState(true)
  const [extraSigBoxes, setExtraSigBoxes] = useState<Array<{
    id: number
    sigX: number; sigY: number; sigW: number; sigH: number
    nameX: number; nameY: number; nameW: number; nameH: number
    showSignature: boolean; showSignerName: boolean
  }>>([])

  const sigNodeRef = useRef<HTMLDivElement>(null)
  const nameNodeRef = useRef<HTMLDivElement>(null)
  const prefixNodeRef = useRef<HTMLDivElement>(null)
  const qrNodeRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    // Chỉ tải PDF khi đã sang bước "placement" (PIN đã xác thực đúng) — tránh tải file
    // lãng phí nếu người dùng hủy ngay ở bước nhập PIN.
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

      const cW = canvasRef.current?.width || 0
      const cH = canvasRef.current?.height || 0
      setSigState({ x: 60, y: cH - 120, w: 140, h: 60 })
      setNameState({ x: 60, y: cH - 55, w: 140, h: 24 })
      setPrefixState({ x: 220, y: cH - 55, w: 60, h: 24 })
      setQrState({ x: Math.max(20, cW - 90), y: 20, w: 70, h: 70 })
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

  const toPdf = (canX: number, canY: number, w: number, h: number) => ({
    x: canX / pdfScale,
    y: pdfPageH - (canY + h) / pdfScale,
    width: w / pdfScale,
    height: h / pdfScale,
  })

  // Xác thực PIN thật qua server (mirror handlePinConfirm của
  // iso/documents/[id]/page.tsx) TRƯỚC khi mở bước đặt vị trí chữ ký — bắt lỗi PIN sai
  // ngay, không cần đợi tới lúc bấm "Xác nhận ký" ở cuối. /api/documents/sign vẫn tự
  // verify lại PIN một lần nữa khi ký thật (không đổi), gọi ở đây chỉ để early-fail.
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
        body: JSON.stringify({ userId, pin, docId, docType: "van_ban" }),
      })
      const json = await res.json()
      if (!res.ok) { setPinError(json.error || "PIN không đúng"); return }
      setStep("placement")
    } catch {
      setPinError("Không thể xác thực PIN, vui lòng thử lại")
    } finally {
      setPinVerifying(false)
    }
  }

  const handleConfirm = () => {
    if (!pin.trim()) { setStep("pin"); setPinError("Vui lòng nhập lại PIN"); return }
    if (!showCanvas || !canvasReady) {
      onConfirm(pin, null, "none")
      return
    }
    const sigPdf = toPdf(sigState.x, sigState.y, sigState.w, sigState.h)
    const namePdf = toPdf(nameState.x, nameState.y, nameState.w, nameState.h)
    const showPrefix = signAs !== "none"
    const prefixPdf = showPrefix ? toPdf(prefixState.x, prefixState.y, prefixState.w, prefixState.h) : null
    const qrPdf = allowQrPlacement ? toPdf(qrState.x, qrState.y, qrState.w, qrState.h) : null
    const placementObj: SignPlacement = {
      page: currentPage,
      x: sigPdf.x, y: sigPdf.y, width: sigPdf.width, height: sigPdf.height,
      showSignature: showSig,
      showSignerName: showName,
      nameX: namePdf.x, nameY: namePdf.y, nameWidth: namePdf.width, nameHeight: namePdf.height,
      showPrefix,
      ...(prefixPdf
        ? { prefixX: prefixPdf.x, prefixY: prefixPdf.y, prefixWidth: prefixPdf.width, prefixHeight: prefixPdf.height }
        : {}),
      showQr: allowQrPlacement,
      ...(qrPdf
        ? { qrX: qrPdf.x, qrY: qrPdf.y, qrWidth: qrPdf.width, qrHeight: qrPdf.height }
        : {}),
    }
    if (extraSigBoxes.length > 0) {
      placementObj.extraPlacements = extraSigBoxes.map((box) => {
        const sPdf = toPdf(box.sigX, box.sigY, box.sigW, box.sigH)
        const nPdf = toPdf(box.nameX, box.nameY, box.nameW, box.nameH)
        return {
          page: currentPage,
          x: sPdf.x, y: sPdf.y, width: sPdf.width, height: sPdf.height,
          showSignature: box.showSignature,
          showSignerName: box.showSignerName,
          nameX: nPdf.x, nameY: nPdf.y, nameWidth: nPdf.width, nameHeight: nPdf.height,
        }
      })
    }
    onConfirm(pin, placementObj, signAs)
  }

  // Bước 1: chỉ hiện PIN, chưa tải/hiện PDF — mirror pinModal của
  // iso/documents/[id]/page.tsx (icon + tiêu đề + phụ đề, ô PIN có nút ẩn/hiện, footer
  // Hủy/Xác nhận). Đúng PIN mới chuyển sang bước 2.
  if (step === "pin") {
    return (
      <ModalShell
        title={
          <span className="flex items-center gap-3">
            <span className="p-2 bg-amber-100 rounded-xl"><ShieldCheck size={18} className="text-amber-600" /></span>
            <span>
              <span className="font-extrabold text-slate-800 block">{stepLabel}</span>
              <span className="text-xs text-slate-500 font-normal">Nhập PIN ký duyệt để xác nhận</span>
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
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl"
            >
              {pinVerifying ? <Loader2 size={13} className="animate-spin" /> : <PenLine size={13} />}
              {pinVerifying ? "Đang xác thực..." : "Xác nhận"}
            </button>
          </>
        }
      >
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">PIN ký duyệt</label>
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
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-amber-500 pr-9 font-mono tracking-widest text-center text-lg"
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

  // Bước 2: PIN đã xác thực đúng — hiện canvas PDF toàn màn hình để đặt vị trí chữ ký,
  // mirror layout placementModal của iso/documents/[id]/page.tsx (fixed inset-0 flex-col,
  // vùng canvas flex-1 overflow-auto căn giữa) thay vì hộp thoại max-w-3xl/55vh cũ vốn
  // làm trang A4 phóng to tràn cả 2 chiều, sinh 2 thanh cuộn khó thao tác.
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 py-3 bg-white border-b border-slate-100 shrink-0">
        <div>
          <h3 className="font-extrabold text-slate-800">{stepLabel}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {showCanvas
              ? allowQrPlacement
                ? "Kéo và thay đổi kích thước để đặt vị trí chữ ký, tên và mã QR trên PDF — vị trí QR sẽ giữ nguyên cho các lượt ký sau"
                : "Kéo và thay đổi kích thước để đặt vị trí chữ ký trên PDF"
              : "Tag chữ ký trong file Office sẽ được thay tự động khi ký"}
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
                    <Loader2 size={24} className="animate-spin text-amber-500" />
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
                    {/* Chữ ký */}
                    <Draggable
                      nodeRef={sigNodeRef as RefObject<HTMLElement>}
                      position={{ x: sigState.x, y: sigState.y }}
                      onStop={(_, d) => setSigState((p) => ({ ...p, x: d.x, y: d.y }))}
                      bounds="parent"
                    >
                      <div ref={sigNodeRef} className="absolute top-0 left-0 cursor-move" style={{ zIndex: 11 }}>
                        <Resizable
                          size={{ width: sigState.w, height: sigState.h }}
                          onResizeStop={(_, __, ___, delta) =>
                            setSigState((p) => ({ ...p, w: p.w + delta.width, h: p.h + delta.height }))}
                          enable={{ right: true, bottom: true, bottomRight: true }}
                          minWidth={40} minHeight={20}
                        >
                          <div className="w-full h-full border border-dashed border-amber-400 bg-amber-50/60 rounded relative select-none">
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
                            <div className="absolute -top-2.5 -right-2.5 flex items-center gap-1" style={{ zIndex: 20 }}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => setShowSig((v) => !v)}
                                className="w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600"
                                title={showSig ? "Ẩn chữ ký" : "Hiện chữ ký"}
                              >
                                {showSig ? <EyeOff size={10} /> : <Eye size={10} />}
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => {
                                  const offset = 30 * (extraSigBoxes.length + 1)
                                  setExtraSigBoxes((prev) => [
                                    ...prev,
                                    {
                                      id: Date.now() + Math.random(),
                                      sigX: sigState.x + offset,
                                      sigY: sigState.y + offset,
                                      sigW: sigState.w,
                                      sigH: sigState.h,
                                      nameX: nameState.x + offset,
                                      nameY: nameState.y + offset,
                                      nameW: nameState.w,
                                      nameH: nameState.h,
                                      showSignature: true,
                                      showSignerName: true,
                                    },
                                  ])
                                }}
                                className="w-5 h-5 bg-blue-600 border border-blue-700 text-white rounded-full shadow flex items-center justify-center hover:bg-blue-700 font-bold"
                                title="Nhân bản chữ ký và tên (+)"
                              >
                                <Plus size={10} />
                              </button>
                            </div>
                          </div>
                        </Resizable>
                      </div>
                    </Draggable>

                    {/* Tên người ký */}
                    <Draggable
                      nodeRef={nameNodeRef as RefObject<HTMLElement>}
                      position={{ x: nameState.x, y: nameState.y }}
                      onStop={(_, d) => setNameState((p) => ({ ...p, x: d.x, y: d.y }))}
                      bounds="parent"
                    >
                      <div ref={nameNodeRef} className="absolute top-0 left-0 cursor-move" style={{ zIndex: 11 }}>
                        <Resizable
                          size={{ width: nameState.w, height: nameState.h }}
                          onResizeStop={(_, __, ___, delta) =>
                            setNameState((p) => ({ ...p, w: p.w + delta.width, h: p.h + delta.height }))}
                          enable={{ right: true, bottom: true, bottomRight: true }}
                          minWidth={60} minHeight={16}
                        >
                          <div className="w-full h-full border border-dashed border-blue-400 bg-blue-50/60 rounded relative select-none flex items-center justify-center">
                            {showName ? (
                              <span className="text-[10px] font-bold text-blue-700 truncate px-1">{userName || "Người ký"}</span>
                            ) : (
                              <span className="text-[10px] text-slate-400">Ẩn tên</span>
                            )}
                            <div className="absolute -top-2.5 -right-2.5 flex items-center gap-1" style={{ zIndex: 20 }}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => setShowName((v) => !v)}
                                className="w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600"
                                title={showName ? "Ẩn tên" : "Hiện tên"}
                              >
                                {showName ? <EyeOff size={10} /> : <Eye size={10} />}
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => {
                                  const offset = 30 * (extraSigBoxes.length + 1)
                                  setExtraSigBoxes((prev) => [
                                    ...prev,
                                    {
                                      id: Date.now() + Math.random(),
                                      sigX: sigState.x + offset,
                                      sigY: sigState.y + offset,
                                      sigW: sigState.w,
                                      sigH: sigState.h,
                                      nameX: nameState.x + offset,
                                      nameY: nameState.y + offset,
                                      nameW: nameState.w,
                                      nameH: nameState.h,
                                      showSignature: true,
                                      showSignerName: true,
                                    },
                                  ])
                                }}
                                className="w-5 h-5 bg-blue-600 border border-blue-700 text-white rounded-full shadow flex items-center justify-center hover:bg-blue-700 font-bold"
                                title="Nhân bản chữ ký và tên (+)"
                              >
                                <Plus size={10} />
                              </button>
                            </div>
                          </div>
                        </Resizable>
                      </div>
                    </Draggable>

                    {/* Tiền tố ký thay (KT./TM./TL./TUQ.) — chỉ hiện khi đã chọn ở dưới */}
                    {signAs !== "none" && (
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

                    {/* QR — chỉ hiện ở lượt ký đầu tiên của cả văn bản (allowQrPlacement),
                        vị trí đặt ở đây được server lưu lại và tái dùng cho mọi lượt ký sau */}
                    {allowQrPlacement && (
                      <Draggable
                        nodeRef={qrNodeRef as RefObject<HTMLElement>}
                        position={{ x: qrState.x, y: qrState.y }}
                        onStop={(_, d) => setQrState((p) => ({ ...p, x: d.x, y: d.y }))}
                        bounds="parent"
                      >
                        <div ref={qrNodeRef} className="absolute top-0 left-0 cursor-move" style={{ zIndex: 11 }}>
                          <Resizable
                            size={{ width: qrState.w, height: qrState.h }}
                            onResizeStop={(_, __, ___, delta) =>
                              setQrState((p) => ({ ...p, w: p.w + delta.width, h: p.h + delta.height }))}
                            enable={{ right: true, bottom: true, bottomRight: true }}
                            lockAspectRatio
                            minWidth={30} minHeight={30}
                          >
                            <div className="w-full h-full border-2 border-dashed border-violet-400 bg-white rounded flex items-center justify-center select-none p-1">
                              <QRCodeSVG
                                value={`${typeof window !== "undefined" ? window.location.origin : ""}/dashboard/documents/${docId}`}
                                size={Math.max(20, Math.min(qrState.w, qrState.h) - 8)}
                                level="L"
                              />
                            </div>
                          </Resizable>
                        </div>
                      </Draggable>
                    )}
                    {/* Extra duplicate signature and name boxes */}
                    {extraSigBoxes.map((box, idx) => (
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
                          >
                            <div className="w-full h-full border border-dashed border-blue-500 bg-blue-50/70 rounded relative select-none">
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
                              <div className="absolute -top-2.5 -right-2.5 flex items-center gap-1" style={{ zIndex: 20 }}>
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={() => setExtraSigBoxes((prev) => prev.map((b) => b.id === box.id ? { ...b, showSignature: !b.showSignature } : b))}
                                  className="w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600"
                                  title={box.showSignature ? "Ẩn chữ ký bản sao" : "Hiện chữ ký bản sao"}
                                >
                                  {box.showSignature ? <EyeOff size={10} /> : <Eye size={10} />}
                                </button>
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={() => setExtraSigBoxes((prev) => prev.filter((b) => b.id !== box.id))}
                                  className="w-5 h-5 bg-red-500 border border-red-600 text-white rounded-full shadow flex items-center justify-center hover:bg-red-600 text-xs font-bold"
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
                            minWidth={60} minHeight={16}
                          >
                            <div className="w-full h-full border border-dashed border-blue-400 bg-blue-50/70 rounded relative select-none flex items-center justify-center">
                              {box.showSignerName ? (
                                <span className="text-[10px] font-bold text-blue-700 truncate px-1">{userName || "Người ký"}</span>
                              ) : (
                                <span className="text-[10px] text-slate-400">Ẩn tên bản sao</span>
                              )}
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => setExtraSigBoxes((prev) => prev.map((b) => b.id === box.id ? { ...b, showSignerName: !b.showSignerName } : b))}
                                className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600"
                                style={{ zIndex: 20 }}
                                title={box.showSignerName ? "Ẩn tên bản sao" : "Hiện tên bản sao"}
                              >
                                {box.showSignerName ? <EyeOff size={10} /> : <Eye size={10} />}
                              </button>
                            </div>
                          </Resizable>
                        </ExtraDraggableBox>
                      </Fragment>
                    ))}
                  </>
                )}
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
                    name="sign-as"
                    checked={signAs === "none"}
                    onChange={() => setSignAs("none")}
                  />
                  Ký trực tiếp
                </label>
                {SIGN_AS_OPTIONS.map((opt) => (
                  <label key={opt} className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
                    <input
                      type="radio"
                      name="sign-as"
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
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl"
            >
              <PenLine size={13} /> {acting ? "Đang xử lý..." : "Xác nhận ký"}
            </button>
          </div>
      </div>
    </div>
  )
}

export default function DocumentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const docId = params.id as string

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [userDeptCode, setUserDeptCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [doc, setDoc] = useState<VanBanDocument | null>(null)

  const [actionError, setActionError] = useState<string | null>(null)
  const [actionOk, setActionOk] = useState<string | null>(null)
  const [acting, setActing] = useState(false)

  // Modal ký duyệt (canvas PDF kéo-thả chữ ký hoặc info tag Office)
  const [signModal, setSignModal] = useState<"ky_buoc" | "phe_duyet" | null>(null)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)

  // Trả về modal
  const [traVeModal, setTraVeModal] = useState(false)
  const [traVeLyDo, setTraVeLyDo] = useState("")

  // Distribution modal
  const [distModal, setDistModal] = useState(false)
  const [distUsers, setDistUsers] = useState<DistUser[]>([])
  const [distLoading, setDistLoading] = useState(false)
  const [distSelected, setDistSelected] = useState<Set<string>>(new Set())
  const [distGhiChu, setDistGhiChu] = useState("")
  const [distSending, setDistSending] = useState(false)

  // Thay file đính kèm — chỉ khả dụng khi văn bản còn đang draft/tra_ve (canGuiKy)
  const fileReplaceInputRef = useRef<HTMLInputElement>(null)
  const [replacingFile, setReplacingFile] = useState(false)

  // Fetch department code via admin API — PHẢI gắn Authorization, nếu không
  // requireAuthUser() ở route sẽ throw và route trả về { code: null } với status 200,
  // khiến userDeptCode luôn là null và canKyBuoc luôn sai cho mọi người dùng.
  const resolveUserDeptCode = useCallback(async (uid: string) => {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token || ""
      const res = await fetch(`/api/documents/dept-code?userId=${uid}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = (await res.json()) as { code: string | null }
        setUserDeptCode(json.code)
      }
    } catch { /* ignore */ }
  }, [])

  const loadDoc = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("van_ban_documents")
      .select("*")
      .eq("id", docId)
      .eq("factory_id", fid)
      .single()
    setDoc(data as VanBanDocument | null)
  }, [docId])

  // Thay file đính kèm — chỉ gọi được khi canGuiKy (isSoanThao && draft/tra_ve). Bắt buộc
  // null hóa file_signed_pdf_url/file_signed_office_url/file_signed_office_type vì
  // fileUrl/docSourceUrl luôn ưu tiên các cột đã ký này trước file_goc_url — nếu không null
  // hóa, file mới vừa upload sẽ vô hình (mirror đúng pattern đã có sẵn ở ISO Tài liệu).
  const handleReplaceFile = async (file: File) => {
    if (!factoryId || !doc) return
    setReplacingFile(true)
    setActionError(null)
    try {
      const filePath = `${factoryId}/vanban/drafts/${Date.now()}_${sanitizeStorageFileName(file.name)}`
      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, { upsert: false })
      if (uploadErr) throw new Error(`Upload file thất bại: ${uploadErr.message}`)
      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath)

      const { error: updateErr } = await supabase
        .from("van_ban_documents")
        .update({
          file_goc_url: urlData.publicUrl,
          file_signed_pdf_url: null,
          file_signed_office_url: null,
          file_signed_office_type: null,
        })
        .eq("id", doc.id)
      if (updateErr) throw new Error(updateErr.message)

      setActionOk("Đã thay file thành công!")
      setTimeout(() => setActionOk(null), 3000)
      await loadDoc(factoryId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setReplacingFile(false)
    }
  }

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)

      const { user: sessionUser } = await hydrateActiveSession()
      if (sessionUser) {
        setUser(sessionUser)
        void resolveUserDeptCode(sessionUser.id)
        const { data: sigUrlData } = supabase.storage
          .from("iso-documents")
          .getPublicUrl(`signatures/${fid}/${sessionUser.id}/chu_ky.png`)
        setSignatureUrl(sigUrlData.publicUrl)
      }
      setLoading(false)
    }
    void bootstrap()
  }, [resolveUserDeptCode])

  useEffect(() => {
    if (factoryId) {
      setLoading(true)
      void loadDoc(factoryId).finally(() => setLoading(false))
    }
  }, [factoryId, loadDoc])

  const getAuthToken = async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token || ""
  }

  const doAction = async (action: string, extra?: Record<string, string>) => {
    if (!factoryId || !doc) return
    setActing(true)
    setActionError(null)
    try {
      const token = await getAuthToken()
      const res = await fetch("/api/documents/sign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ docId: doc.id, factoryId, action, ...extra }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string; trang_thai?: string }
      if (!res.ok || !json.ok) throw new Error(json.error || "Lỗi thực hiện")
      setActionOk(`Thao tác thành công!`)
      setTimeout(() => setActionOk(null), 3000)
      void loadDoc(factoryId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setActing(false)
    }
  }

  const handleGuiKy = () => void doAction("gui_ky")

  const handleSignConfirm = async (pin: string, placement: SignPlacement | null, signAs: SignAsType) => {
    if (!factoryId || !doc || !signModal) return
    const action = signModal
    setActing(true)
    setActionError(null)
    try {
      const token = await getAuthToken()
      const res = await fetch("/api/documents/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          docId: doc.id,
          factoryId,
          action,
          pin,
          placement,
          sign_as: signAs === "none" ? undefined : signAs,
        }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setActionError(json.error || (action === "phe_duyet" ? "Lỗi phê duyệt" : "Lỗi ký"))
        return
      }
      setSignModal(null)
      setActionOk(action === "phe_duyet" ? "Phê duyệt thành công!" : "Ký thành công!")
      setTimeout(() => setActionOk(null), 3000)
      if (action === "phe_duyet") {
        // Cập nhật AI embedding sau khi phê duyệt (fire-and-forget)
        void fetch("/api/documents/embed-doc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId: doc.id, factoryId }),
        }).catch(() => {})
      }
      void loadDoc(factoryId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setActing(false)
    }
  }

  const handleTraVe = () => void doAction("tra_ve", { ly_do: traVeLyDo }).then(() => {
    setTraVeModal(false)
    setTraVeLyDo("")
  })

  const openDistModal = useCallback(async () => {
    if (!factoryId || !doc) return
    setDistModal(true)
    setDistLoading(true)
    setDistSelected(new Set())
    setDistGhiChu("")
    try {
      const token = await getAuthToken()
      const res = await fetch(`/api/documents/distribute?factoryId=${factoryId}&docIds=${doc.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json()) as { users?: DistUser[] }
      setDistUsers(json.users || [])
    } catch { setDistUsers([]) }
    finally { setDistLoading(false) }
  }, [factoryId, doc])

  const handleDistSend = async () => {
    if (!factoryId || !doc || !user || distSelected.size === 0) return
    setDistSending(true)
    try {
      const token = await getAuthToken()
      const res = await fetch("/api/documents/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          factoryId,
          docIds: [doc.id],
          recipientUserIds: [...distSelected],
          ghiChu: distGhiChu || undefined,
        }),
      })
      if (res.ok || res.status === 207) {
        setDistModal(false)
        setActionOk(`Đã phân phối đến ${distSelected.size} người nhận!`)
        setTimeout(() => setActionOk(null), 3000)
      } else {
        const json = (await res.json()) as { error?: string }
        setActionError(json.error || "Lỗi phân phối")
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setDistSending(false)
    }
  }

  if (loading) {
    return (
      <DocumentsShell>
        <div className="p-12 text-center text-slate-400">Đang tải...</div>
      </DocumentsShell>
    )
  }

  if (!doc) {
    return (
      <DocumentsShell>
        <div className="p-12 text-center text-slate-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p>Không tìm thấy văn bản</p>
          <button onClick={() => router.push("/dashboard/documents")} className="mt-4 text-blue-600 underline text-sm">
            Quay lại danh sách
          </button>
        </div>
      </DocumentsShell>
    )
  }

  const isAdmin = user?.role === "admin"

  // Determine actions
  const isSoanThao = doc.soan_thao_user_id === user?.id || isAdmin
  const canGuiKy = isSoanThao && (doc.trang_thai === "draft" || doc.trang_thai === "tra_ve")

  // Ký bước: kiểm tra bước hiện tại có thuộc phòng ban của user không
  let canKyBuoc = false
  let currentStep: ThuTuKyStep | null = null
  if (doc.trang_thai === "cho_ky_phong_ban" && user) {
    const stepIndex = doc.buoc_hien_tai
    currentStep = (doc.thu_tu_ky_json || [])[stepIndex] || null
    if (currentStep) {
      if (isAdmin) {
        canKyBuoc = true
      } else if (currentStep.type === "phong_ban" && userDeptCode === currentStep.phong_ban_code) {
        canKyBuoc = true
      } else if (currentStep.type === "ca_nhan" && currentStep.user_id === user.id) {
        canKyBuoc = true
      }
    }
  }

  // Chỉ đúng người được chỉ định phe_duyet_user_id (hoặc admin) mới được Phê duyệt /
  // Trả về ở bước phê duyệt — không gate theo quyền chung documents.phe_duyet, vì
  // quyền đó thường cấp rộng cho nhiều lãnh đạo/trưởng phòng khác không phải người
  // được chỉ định trên chính văn bản này.
  const isPheDuyetNguoi = isAdmin || (!!user && doc.phe_duyet_user_id === user.id)

  const canPheDuyet = doc.trang_thai === "cho_phe_duyet" && isPheDuyetNguoi

  const canTraVe =
    (doc.trang_thai === "cho_ky_phong_ban" && (canKyBuoc || isPheDuyetNguoi)) ||
    (doc.trang_thai === "cho_phe_duyet" && isPheDuyetNguoi)

  const canDistribute = doc.trang_thai === "da_phe_duyet" && hasPermission(user, "documents.distribute")

  const fileUrl = doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url

  // Nguồn file sẽ được ký — PHẢI khớp đúng thứ tự ưu tiên sourceUrl trong performFileStamp()
  // của sign/route.ts, để canvas đặt chữ ký hiển thị đúng file thật sự bị stamp.
  const docSourceUrl = doc.file_signed_office_url || doc.file_signed_pdf_url || doc.file_goc_url
  const docExt = getDocFileExt(docSourceUrl, doc.file_signed_office_url ? doc.file_signed_office_type : null)

  const signStepLabel = signModal === "ky_buoc"
    ? (currentStep?.type === "ca_nhan" ? "Ký xác nhận" : "Ký phòng ban")
    : "Phê duyệt văn bản"
  const signStepKey = signModal === "phe_duyet" ? "phe_duyet" : String(doc.buoc_hien_tai + 1)
  const signSigTag = signModal === "phe_duyet" ? "{{CHU_KY_PHE_DUYET}}" : `{{CHU_KY_BUOC_${signStepKey}}}`
  const signNameTag = signModal === "phe_duyet" ? "{{TEN_PHE_DUYET}}" : `{{TEN_BUOC_${signStepKey}}}`
  // QR chỉ được đặt vị trí ở lượt ký ĐẦU TIÊN của cả văn bản (chưa từng lưu
  // placement_ky.qr) — các lượt ký sau tái dùng đúng vị trí đã chọn, tránh vẽ nhiều
  // QR ở nhiều vị trí khác nhau qua các lần ký (xem sign/route.ts's performFileStamp).
  const hasQrPlacement = !!(doc.placement_ky as Record<string, unknown> | null)?.["qr"]

  return (
    <DocumentsShell>
      {/* Toasts */}
      {actionError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-bold">{actionError}</span>
          <button onClick={() => setActionError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}
      {actionOk && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-emerald-600 text-white rounded-2xl shadow-2xl">
          <CheckCircle2 size={16} />
          <span className="text-sm font-bold">{actionOk}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={() => router.push("/dashboard/documents")}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all shrink-0"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-extrabold text-slate-800 break-words">{doc.ten_van_ban}</h1>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${TRANG_THAI_COLOR[doc.trang_thai]}`}>
                {TRANG_THAI_LABEL[doc.trang_thai]}
              </span>
              {doc.phan_loai && doc.phan_loai !== "Thuong" && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${PHAN_LOAI_COLOR[doc.phan_loai] || "bg-red-100 text-red-700 border border-red-200"}`}>
                  <Lock size={10} />
                  {PHAN_LOAI_LABEL[doc.phan_loai] || doc.phan_loai}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-400 mt-0.5 font-mono">{doc.ma_van_ban || "Chưa có số văn bản"}</p>
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-shrink-0 sm:justify-end">
          {fileUrl && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-all"
            >
              <Eye size={15} />
              Xem file
            </a>
          )}
          {canGuiKy && (
            <>
              <input
                ref={fileReplaceInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ""
                  if (f) void handleReplaceFile(f)
                }}
              />
              <button
                onClick={() => fileReplaceInputRef.current?.click()}
                disabled={replacingFile}
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-all disabled:opacity-50"
              >
                {replacingFile ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {replacingFile ? "Đang tải lên..." : "Thay file"}
              </button>
            </>
          )}
          <a
            href={`/dashboard/documents/print/?docId=${doc.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl transition-all"
          >
            <Printer size={15} />
            In
          </a>
          {canDistribute && (
            <button
              onClick={() => void openDistModal()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition-all"
            >
              <Share2 size={15} />
              Phân phối
            </button>
          )}
          {canGuiKy && (
            <button
              onClick={handleGuiKy}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl shadow-md transition-all"
            >
              <Send size={15} />
              Gửi ký
            </button>
          )}
          {canKyBuoc && (
            <button
              onClick={() => setSignModal("ky_buoc")}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl shadow-md transition-all"
            >
              <PenLine size={15} />
              {currentStep?.type === "ca_nhan" ? "Ký xác nhận" : "Ký phòng ban"}
            </button>
          )}
          {canPheDuyet && (
            <button
              onClick={() => setSignModal("phe_duyet")}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-md transition-all"
            >
              <ShieldCheck size={15} />
              Phê duyệt
            </button>
          )}
          {canTraVe && (
            <button
              onClick={() => { setTraVeModal(true); setTraVeLyDo("") }}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl shadow-md transition-all"
            >
              <RotateCcw size={15} />
              Trả về
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Thông tin văn bản */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-sm font-bold text-slate-700 mb-4">Thông tin văn bản</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoRow label="Loại văn bản" value={doc.loai_van_ban ? (LOAI_VAN_BAN_LABEL[doc.loai_van_ban] || doc.loai_van_ban) : "—"} />
              <InfoRow label="Phòng ban" value={doc.phong_ban || "—"} />
              {!!doc.phong_ban_ky_display?.length && (
                <div className="col-span-2">
                  <dt className="text-xs font-bold text-slate-400 mb-1">Phòng ban đã ký</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {doc.phong_ban_ky_display.map((pb) => (
                      <span key={pb} className="px-2 py-0.5 text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg">
                        {pb}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              <InfoRow label="Cấp văn bản" value={doc.cap_tl || "—"} />
              <InfoRow label="Phân loại" value={doc.phan_loai ? (PHAN_LOAI_LABEL[doc.phan_loai] || doc.phan_loai) : "Thường"} />
              <InfoRow label="Người soạn thảo" value={doc.nguoi_soan_thao_display || "—"} />
              <InfoRow label="Người phê duyệt" value={doc.phe_duyet || "—"} />
              <InfoRow label="Ngày phê duyệt" value={fmtDate(doc.ngay_phe_duyet)} />
            </div>
            {doc.ghi_chu && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-500 mb-1">Ghi chú</p>
                <p className="text-sm text-slate-700">{doc.ghi_chu}</p>
              </div>
            )}
          </div>

          {/* Trả về info */}
          {doc.trang_thai === "tra_ve" && doc.tra_ve_ly_do && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <RotateCcw size={14} className="text-rose-600" />
                <span className="text-sm font-bold text-rose-700">Văn bản bị trả về</span>
              </div>
              <p className="text-sm text-rose-600">
                <strong>{doc.tra_ve_nguoi}</strong> trả về bước {doc.tra_ve_step != null ? doc.tra_ve_step + 1 : ""}: {doc.tra_ve_ly_do}
              </p>
              {doc.tra_ve_at && (
                <p className="text-xs text-rose-400 mt-1">{fmtDate(doc.tra_ve_at)}</p>
              )}
            </div>
          )}
        </div>

        {/* Timeline ký */}
        <div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-bold text-slate-700 mb-4">
              {doc.is_uploaded
                ? "Thông tin ký tay"
                : doc.pham_vi === "Don_vi"
                  ? "Tiến trình ký xác nhận & phê duyệt"
                  : "Tiến trình ký duyệt"}
            </h2>
            <div className="space-y-3">
              {/* Soạn thảo — ẩn nếu là văn bản upload ký tay không có tên người soạn */}
              {(!doc.is_uploaded || doc.nguoi_soan_thao_display) && (
                <TimelineStep
                  label="Soạn thảo"
                  sublabel={doc.nguoi_soan_thao_display || ""}
                  done={true}
                  at={doc.created_at}
                />
              )}

              {/* Từng bước ký phòng ban */}
              {(doc.thu_tu_ky_json || []).map((step: ThuTuKyStep, i) => {
                const nguoiKyEntry = (doc.nguoi_ky as Record<string, NguoiKyEntry>)[String(i + 1)]
                const isCurrentStep = doc.trang_thai === "cho_ky_phong_ban" && doc.buoc_hien_tai === i
                return (
                  <TimelineStep
                    key={i}
                    label={`Bước ${i + 1}: ${step.phong_ban_code || step.ten || ""}`}
                    sublabel={
                      nguoiKyEntry?.ten
                        ? `${signAsPrefixLabel(nguoiKyEntry.sign_as, nguoiKyEntry.is_kt)}${nguoiKyEntry.ten}`
                        : (isCurrentStep ? "Đang chờ ký..." : "Chờ")
                    }
                    done={!!nguoiKyEntry}
                    pending={isCurrentStep}
                    at={nguoiKyEntry?.ky_at}
                  />
                )
              })}

              {/* Phê duyệt cuối */}
              <TimelineStep
                label="Phê duyệt"
                sublabel={
                  doc.trang_thai === "da_phe_duyet"
                    ? `${signAsPrefixLabel(doc.phe_duyet_sign_as as SignAsType | null, doc.phe_duyet_is_kt)}${doc.phe_duyet || "Đã phê duyệt"}`
                    : doc.trang_thai === "cho_phe_duyet"
                      ? "Đang chờ phê duyệt..."
                      : doc.phe_duyet || "Chờ phê duyệt"
                }
                done={doc.trang_thai === "da_phe_duyet"}
                pending={doc.trang_thai === "cho_phe_duyet"}
                at={doc.ngay_phe_duyet || undefined}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Modal ký duyệt — canvas PDF kéo-thả chữ ký/tên (PDF) hoặc info tag (Office) */}
      {signModal && (
        <SignPlacementModal
          stepLabel={signStepLabel}
          sourceFileUrl={docSourceUrl}
          fileExt={docExt}
          signatureUrl={signatureUrl}
          userName={user?.full_name || user?.username || "Người ký"}
          sigTag={signSigTag}
          nameTag={signNameTag}
          acting={acting}
          allowSignAs={(signModal === "ky_buoc" && currentStep?.type === "phong_ban") || signModal === "phe_duyet"}
          allowQrPlacement={!hasQrPlacement}
          userId={user?.id || ""}
          docId={doc.id}
          onConfirm={handleSignConfirm}
          onClose={() => setSignModal(null)}
        />
      )}

      {/* Distribution Modal */}
      {distModal && (
        <ModalShell
          title="Phân phối văn bản"
          onClose={() => setDistModal(false)}
          maxWidth="lg"
          footer={
            <>
              <button
                onClick={() => void handleDistSend()}
                disabled={distSending || distSelected.size === 0}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl transition-all"
              >
                {distSending ? (
                  <><Loader2 size={14} className="animate-spin" />Đang gửi...</>
                ) : (
                  <><Share2 size={14} />Phân phối ({distSelected.size})</>
                )}
              </button>
              <button
                onClick={() => setDistModal(false)}
                disabled={distSending}
                className="px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                Hủy
              </button>
            </>
          }
        >
            <p className="text-xs text-slate-400 -mt-2 mb-2">{doc.ma_van_ban} — {doc.ten_van_ban}</p>
            <div className="space-y-4">
              {distLoading ? (
                <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-sm">Đang tải danh sách...</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-700">
                      Đã chọn {distSelected.size}/{distUsers.filter(u => !u.alreadyReceived.includes(doc.id)).length} người chưa nhận
                    </span>
                    <button
                      onClick={() => {
                        const eligible = distUsers.filter(u => !u.alreadyReceived.includes(doc.id)).map(u => u.id)
                        setDistSelected(new Set(eligible))
                      }}
                      className="text-xs text-blue-600 hover:underline font-bold"
                    >
                      Chọn tất cả
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {distUsers.map(u => {
                      const hasAlready = u.alreadyReceived.includes(doc.id)
                      const selected = distSelected.has(u.id)
                      return (
                        <label
                          key={u.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${hasAlready ? "opacity-50 cursor-default border-slate-100 bg-slate-50" : selected ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-blue-200 hover:bg-blue-50/50"}`}
                        >
                          <input
                            type="checkbox"
                            disabled={hasAlready}
                            checked={selected}
                            onChange={() => {
                              if (hasAlready) return
                              setDistSelected(prev => {
                                const next = new Set(prev)
                                if (next.has(u.id)) next.delete(u.id)
                                else next.add(u.id)
                                return next
                              })
                            }}
                            className="rounded"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-700 truncate">{u.full_name || u.id}</p>
                            <p className="text-xs text-slate-400">{u.department || u.role}</p>
                          </div>
                          {hasAlready && (
                            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold shrink-0">Đã nhận</span>
                          )}
                        </label>
                      )
                    })}
                    {distUsers.length === 0 && (
                      <p className="text-sm text-slate-400 text-center py-6">Không có người dùng nào</p>
                    )}
                  </div>
                </>
              )}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú kèm theo (tùy chọn)</label>
                <textarea
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500 resize-none"
                  rows={2}
                  placeholder="Ghi chú..."
                  value={distGhiChu}
                  onChange={e => setDistGhiChu(e.target.value)}
                />
              </div>
            </div>
        </ModalShell>
      )}

      {/* Trả về Modal */}
      {traVeModal && (
        <ModalShell
          title="Trả về văn bản"
          onClose={() => setTraVeModal(false)}
          maxWidth="sm"
          footer={
            <>
              <button
                onClick={handleTraVe}
                disabled={acting}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl transition-all"
              >
                {acting ? "Đang xử lý..." : "Trả về"}
              </button>
              <button
                onClick={() => setTraVeModal(false)}
                disabled={acting}
                className="px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                Hủy
              </button>
            </>
          }
        >
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Lý do trả về (tùy chọn)</label>
              <textarea
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500 resize-none"
                rows={3}
                placeholder="Nhập lý do hoặc yêu cầu chỉnh sửa..."
                value={traVeLyDo}
                onChange={(e) => setTraVeLyDo(e.target.value)}
                autoFocus
              />
            </div>
        </ModalShell>
      )}
    </DocumentsShell>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-slate-700">{value || "—"}</dd>
    </div>
  )
}

function TimelineStep({
  label,
  sublabel,
  done,
  pending,
  at,
}: {
  label: string
  sublabel: string
  done: boolean
  pending?: boolean
  at?: string | null
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 mt-0.5">
        {done ? (
          <CheckCircle2 size={18} className="text-emerald-500" />
        ) : pending ? (
          <Clock size={18} className="text-amber-500" />
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-slate-200" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-bold ${done ? "text-slate-800" : pending ? "text-amber-700" : "text-slate-400"}`}>
          {label}
        </p>
        {sublabel && (
          <p className={`text-xs ${done ? "text-slate-500" : pending ? "text-amber-500" : "text-slate-300"}`}>
            {sublabel}
          </p>
        )}
        {at && <p className="text-xs text-slate-300 mt-0.5">{fmtDate(at)}</p>}
      </div>
    </div>
  )
}
