"use client"

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react"
import type { RefObject } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
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
  Bell,
  Share2,
  Loader2,
  Upload,
  Plus,
} from "lucide-react"
import type { SessionUser } from "@/lib/auth"
import {
  clampRectToBox,
  computeDefaultNoteLayout,
  computeDefaultSubLayout,
  resolveAnchorPages,
  resolveEffectiveQrRect,
  type LayoutRect,
  type NoteSubLayout,
  type SignerSubLayout,
  type TemplateNoteBox,
  type TemplateQrBox,
  type TemplateSignBox,
  type TemplateStepPlacement,
} from "@/lib/signing/template-layout"
import { collectPreviewBoxes, groupPreviewBoxesByPage } from "@/lib/signing/placement-preview"
import { getKyBuocColor, getPlacementKeyColor, ROLE_COLORS } from "@/lib/signing/template-colors"
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
      cancel=".react-resizable-handle,button,button *,a,.no-drag"
    >
      <div ref={nodeRef} style={{ position: "absolute", top: 0, left: 0, zIndex, cursor: "move" }}>
        {children}
      </div>
    </Draggable>
  )
}

/** Bề rộng ảnh thumbnail render sẵn (px) — đủ nét cho ô ~80px, nhẹ hơn hẳn ảnh trang đầy đủ. */
const THUMB_WIDTH_PX = 160
/** Tài liệu dài hơn mức này thì bỏ render ảnh thumbnail (chỉ còn ô số trang + khung xem trước). */
const MAX_THUMB_PAGES = 80

/** Bố cục 4 khối con của 1 khung mẫu, ở dạng point (độc lập trang) — xem template-layout.ts. */
type LockedBoxLayout = SignerSubLayout

/** Khối con nào của khung ký đang được kéo/resize. */
type SignBlockKey = "sig" | "name" | "chuc_vu" | "prefix"

/**
 * Bố cục mặc định cho 1 khung mẫu.
 *
 * Quy tắc 2 TẦNG: mẫu TẮT `show_name`/`show_chuc_vu` → người ký không thấy khối đó và không có
 * cách nào bật lên; mẫu BẬT → hiện sẵn và người ký tự tắt/mở được. Khối chức danh còn cần có
 * chức vụ thật để hiển thị (chưa khai báo trong hồ sơ nhân sự thì không có gì để vẽ); khối tiền
 * tố chỉ tồn tại khi mẫu có chọn ký thay (`sign_as`) cho bước đó.
 */
function buildDefaultLockedLayout(
  box: TemplateSignBox,
  chucVu: string,
  prefixText: string,
): LockedBoxLayout {
  const withName = box.show_name
  const withChucVu = box.show_chuc_vu && !!chucVu
  const withPrefix = !!prefixText
  const d = computeDefaultSubLayout(box, { withName, withChucVu, withPrefix })
  return {
    sig: d.sig,
    name: d.name,
    chuc_vu: d.chuc_vu,
    prefix: d.prefix,
    show_name: withName,
    show_chuc_vu: withChucVu,
    show_prefix: withPrefix,
  }
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
  lockedPlacement,
  lockedEntry,
  lockedGhiChuBox,
  lockedQrBox,
  lockedQrAdjustable,
  lockedPrefixText,
  signerChucVu,
  placementAll,
  signStepKey,
  signedStepKeys,
  stepLabels,
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
  // true khi bước ký này đã được KHOÁ vị trí theo mẫu (mau_vi_tri, chốt lúc gửi ký) — khung ký
  // do người soạn thảo chốt, người ký KHÔNG đổi được khung, cũng không hỏi ký thay (tiền tố đã
  // chọn sẵn trong mẫu). Vẫn hiện canvas để ĐỌC văn bản và xê dịch 3 khối con TRONG khung.
  lockedPlacement: boolean
  /** Entry mẫu của đúng bước đang ký — nguồn để vẽ "vùng cho phép" và giới hạn kéo-thả. */
  lockedEntry: TemplateStepPlacement | null
  /** Khung "Ghi chú" của mẫu (nếu có) — chỉ dùng ở bước phê duyệt để nhập ý kiến chỉ đạo. */
  lockedGhiChuBox: TemplateNoteBox | null
  /** Khung QR của mẫu (nếu có) — hiện QR thật để người ký biết nó rơi vào đâu. */
  lockedQrBox: TemplateQrBox | null
  /**
   * QR chưa được lượt ký nào chỉnh → người ký HIỆN TẠI được xê dịch, và vị trí đó chốt cho mọi
   * lượt sau. Ngược lại chỉ xem (QR là dữ liệu cấp văn bản, không được lệch giữa các bước).
   */
  lockedQrAdjustable: boolean
  /** Tiền tố ký thay đã chọn trong mẫu (vd "KT.") — rỗng nghĩa là bước này không ký thay. */
  lockedPrefixText: string
  /** Chức vụ thật của người ký — quyết định có khối "chức danh" để kéo hay không. */
  signerChucVu: string
  /**
   * TOÀN BỘ `placement_ky` của văn bản — CHỈ để vẽ xem trước (thumbnail + lớp mờ trên canvas),
   * giúp người ký thấy khung của mình nằm ở trang nào và bố cục chữ ký chung của cả văn bản.
   * Không tham gia bất kỳ phép tính toạ độ nào khi ký thật.
   */
  placementAll: Record<string, unknown> | null
  /** Key của bước đang ký trong `placement_ky` ("1" | "2" | … | "phe_duyet"). */
  signStepKey: string
  /** Các bước đã ký xong — vẽ khung nhạt kèm dấu đã ký. */
  signedStepKeys: string[]
  /** Nhãn hiển thị của từng key khung (vd `{ "1": "Bước 1: NMCB" }`). */
  stepLabels: Record<string, string>
  userId: string
  docId: string
  onConfirm: (
    pin: string,
    placement: SignPlacement | null,
    signAs: SignAsType,
    extra?: {
      signLayout?: SignerSubLayout[]
      noteLayout?: NoteSubLayout[]
      qrLayout?: LayoutRect[]
      ghiChuPheDuyet?: string
      ghiChuTat?: boolean
    },
  ) => void
  onClose: () => void
}) {
  const isPdf = fileExt === "pdf" || urlIsPdf(sourceFileUrl)
  // Kể cả khi vị trí đã khoá theo mẫu, người ký vẫn PHẢI đọc được nội dung PDF trước khi ký —
  // trước đây bước ký khoá chỉ hiện hộp PIN, ký "mù" không nhìn thấy văn bản.
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

  // ── Rail thumbnail các trang PDF (mirror màn cài đặt vị trí `ky/mau-vi-tri`) ──
  // Ảnh từng trang render dần ở nền, KHÔNG chặn trang đang ký hiển thị.
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  /** Kích thước THẬT từng trang (point, scale 1) — cần để quy đổi khung mẫu sang % trên thumbnail. */
  const [thumbDims, setThumbDims] = useState<Record<number, { w: number; h: number }>>({})
  const [thumbsLoading, setThumbsLoading] = useState(false)
  /** Hiện khung của các bước ký KHÁC (mờ, nét đứt) trên trang đang xem — người dùng tự bật/tắt. */
  const [showOtherBoxes, setShowOtherBoxes] = useState(true)
  const thumbRunRef = useRef<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTaskRef = useRef<any>(null)



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

  // ── Chế độ "vị trí CỨNG": 3 khối con xê dịch trong khung mẫu ────────────────
  // Lưu ở hệ POINT (không phải canvas px) để không phụ thuộc trang đang xem — mỗi trang PDF có
  // thể khác khổ giấy, quy đổi sang px chỉ diễn ra lúc render.
  const [lockedLayouts, setLockedLayouts] = useState<LockedBoxLayout[]>([])
  const [noteLayout, setNoteLayout] = useState<NoteSubLayout | null>(null)
  const [qrRect, setQrRect] = useState<LayoutRect | null>(null)
  const [ghiChuText, setGhiChuText] = useState("")
  const [ghiChuOff, setGhiChuOff] = useState(false)
  const [confirmError, setConfirmError] = useState("")

  useEffect(() => {
    if (!lockedEntry) { setLockedLayouts([]); return }
    setLockedLayouts(
      lockedEntry.boxes.map((box) => buildDefaultLockedLayout(box, signerChucVu, lockedPrefixText)),
    )
  }, [lockedEntry, signerChucVu, lockedPrefixText])

  useEffect(() => {
    if (!lockedGhiChuBox) { setNoteLayout(null); return }
    setNoteLayout(computeDefaultNoteLayout(lockedGhiChuBox, { withKyNhay: !!signatureUrl }))
  }, [lockedGhiChuBox, signatureUrl])

  useEffect(() => {
    // Đã chỉnh ở lượt trước → `resolveEffectiveQrRect` trả đúng vị trí đã chốt (chỉ để xem).
    setQrRect(lockedQrBox ? resolveEffectiveQrRect(lockedQrBox) : null)
  }, [lockedQrBox])

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

    // Có rail thumbnail, người dùng bấm chuyển trang rất nhanh — pdfjs ném
    // "Cannot use the same canvas during multiple render() operations" và để lại canvas trắng nếu
    // tác vụ render cũ chưa bị hủy. Hủy trước, nuốt RenderingCancelledException.
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel() } catch { /* tác vụ đã xong */ }
      renderTaskRef.current = null
    }

    canvas.width = cW
    canvas.height = cH

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const task = page.render({ canvasContext: ctx, viewport } as any)
    renderTaskRef.current = task
    try {
      await task.promise
    } catch (err) {
      // Bị hủy vì người dùng đã chuyển sang trang khác → bỏ qua, không phải lỗi thật.
      const name = (err as { name?: string } | null)?.name
      if (name === "RenderingCancelledException") return
      throw err
    } finally {
      if (renderTaskRef.current === task) renderTaskRef.current = null
    }

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

      // ── Rail thumbnail: tái dùng đúng `pdf` vừa load, KHÔNG getDocument() lần 2 ──
      if (thumbRunRef.current === sourceFileUrl) return
      thumbRunRef.current = sourceFileUrl

      // Vòng 1 (rất nhanh, không render): lấy kích thước thật mọi trang để overlay khung mẫu
      // hoạt động được ngay cả khi ảnh thumbnail chưa kịp render xong.
      const dims: Record<number, { w: number; h: number }> = {}
      for (let p = 1; p <= pdf.numPages; p++) {
        const pg = await pdf.getPage(p)
        if (cancelled) return
        const vp = pg.getViewport({ scale: 1 })
        dims[p] = { w: vp.width, h: vp.height }
      }
      if (cancelled) return
      setThumbDims(dims)

      // Vòng 2 (nặng): render ảnh từng trang, cập nhật DẦN để người dùng thấy thumbnail hiện ra
      // ngay thay vì chờ hết tài liệu. Tài liệu quá dài thì bỏ ảnh, chỉ giữ ô số trang + overlay.
      if (pdf.numPages > MAX_THUMB_PAGES) return
      setThumbsLoading(true)
      try {
        for (let p = 1; p <= pdf.numPages; p++) {
          const pg = await pdf.getPage(p)
          if (cancelled) return
          const vp1 = pg.getViewport({ scale: 1 })
          const scale = THUMB_WIDTH_PX / (vp1.width || THUMB_WIDTH_PX)
          const vp = pg.getViewport({ scale })
          const off = document.createElement("canvas")
          off.width = Math.max(1, Math.floor(vp.width))
          off.height = Math.max(1, Math.floor(vp.height))
          const octx = off.getContext("2d")
          if (!octx) continue
          // JPEG không có kênh alpha — không tô trắng trước thì nền trong suốt thành ĐEN.
          octx.fillStyle = "#ffffff"
          octx.fillRect(0, 0, off.width, off.height)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await pg.render({ canvasContext: octx, viewport: vp } as any).promise
          if (cancelled) return
          const url = off.toDataURL("image/jpeg", 0.75)
          setThumbs((prev) => ({ ...prev, [p]: url }))
          // Nhả main thread để thao tác kéo-thả/chuyển trang không bị khựng.
          await new Promise((r) => setTimeout(r, 0))
          if (cancelled) return
        }
      } finally {
        if (!cancelled) setThumbsLoading(false)
      }
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

  // ── Khung xem trước: màu của CHÍNH bước đang ký, và toàn bộ khung của văn bản ──
  // `myColor` chính là màu người soạn thảo đã đặt cho vai trò này ở màn cài đặt vị trí (bước 1
  // amber, bước 2 sky, …, phê duyệt emerald) — dùng lại xuyên suốt: khung trên canvas, khung
  // sáng trên thumbnail, chip vai trò ở header.
  const myColor = getPlacementKeyColor(signStepKey)

  const previewBoxes = useMemo(
    () =>
      collectPreviewBoxes({
        placementKy: placementAll,
        pageCount: numPages,
        dims: thumbDims,
        myKey: signStepKey,
        signedKeys: signedStepKeys,
        stepLabels,
        qrIsMine: lockedQrAdjustable,
        ghiChuIsMine: !!lockedGhiChuBox,
      }),
    [
      placementAll,
      numPages,
      thumbDims,
      signStepKey,
      signedStepKeys,
      stepLabels,
      lockedQrAdjustable,
      lockedGhiChuBox,
    ],
  )
  const previewByPage = useMemo(() => groupPreviewBoxesByPage(previewBoxes), [previewBoxes])
  /** Trang đầu tiên có khung của người ký hiện tại — để nút "Tới khung của tôi" nhảy đúng chỗ. */
  const myFirstPage = useMemo(
    () => previewBoxes.find((b) => b.tier === "mine")?.page ?? null,
    [previewBoxes],
  )
  /** Khung của bước/vai trò KHÁC trên trang đang xem — vẽ mờ làm tham chiếu bố cục. */
  const otherBoxesOnPage = useMemo(
    () => (previewByPage[currentPage] || []).filter((b) => b.tier !== "mine"),
    [previewByPage, currentPage],
  )

  const toPdf = (canX: number, canY: number, w: number, h: number) => ({
    x: canX / pdfScale,
    y: pdfPageH - (canY + h) / pdfScale,
    width: w / pdfScale,
    height: h / pdfScale,
  })

  /** Point (gốc dưới-trái) → canvas px (gốc trên-trái) của TRANG ĐANG XEM. Nghịch đảo `toPdf`. */
  const toCanvas = (r: LayoutRect) => ({
    x: r.x * pdfScale,
    y: (pdfPageH - (r.y + r.height)) * pdfScale,
    w: r.width * pdfScale,
    h: r.height * pdfScale,
  })

  /**
   * Cập nhật 1 khối con sau khi kéo/resize. Luôn kẹp lại vào trong khung mẫu bằng ĐÚNG hàm mà
   * server dùng (`clampRectToBox`) — UI và server không thể lệch chuẩn biên.
   */
  const setLockedRect = (
    idx: number,
    key: SignBlockKey,
    canX: number,
    canY: number,
    canW: number,
    canH: number,
  ) => {
    if (!lockedEntry) return
    const box = lockedEntry.boxes[idx]
    if (!box) return
    const clamped = clampRectToBox(toPdf(canX, canY, canW, canH), box)
    setLockedLayouts((prev) => prev.map((cur, i) => (i === idx ? { ...cur, [key]: clamped } : cur)))
  }

  /**
   * Bật/tắt khối Tên / Chức danh / Tiền tố. Đổi lựa chọn sẽ ĐẶT LẠI bố cục mặc định của cả khung
   * — vì tỉ lệ chia dải phụ thuộc số khối đang hiện (tắt tên mà giữ nguyên ô chữ ký cũ sẽ để lại
   * một khoảng trống vô nghĩa). Người ký nên bật/tắt trước rồi mới xê dịch.
   */
  const toggleLockedBlock = (idx: number, key: "name" | "chuc_vu" | "prefix") => {
    if (!lockedEntry) return
    setLockedLayouts((prev) =>
      prev.map((cur, i) => {
        if (i !== idx) return cur
        const box = lockedEntry.boxes[i]
        if (!box) return cur
        const withName = key === "name" ? !cur.show_name : cur.show_name
        const withChucVu = key === "chuc_vu" ? !cur.show_chuc_vu : cur.show_chuc_vu
        const withPrefix = key === "prefix" ? !cur.show_prefix : cur.show_prefix
        const d = computeDefaultSubLayout(box, { withName, withChucVu, withPrefix })
        return {
          sig: d.sig,
          name: d.name,
          chuc_vu: d.chuc_vu,
          prefix: d.prefix,
          show_name: withName,
          show_chuc_vu: withChucVu,
          show_prefix: withPrefix,
        }
      }),
    )
  }

  /** Kéo/resize ô text hoặc chữ ký nháy trong khung Ghi chú — luôn kẹp vào khung. */
  const setNoteRect = (
    key: "text" | "ky_nhay",
    canX: number,
    canY: number,
    canW: number,
    canH: number,
  ) => {
    if (!lockedGhiChuBox) return
    const clamped = clampRectToBox(toPdf(canX, canY, canW, canH), lockedGhiChuBox)
    setNoteLayout((prev) => (prev ? { ...prev, [key]: clamped } : prev))
  }

  /** Kéo/resize QR — chỉ mở cho lượt ký đầu tiên, và luôn nằm trong khung QR của mẫu. */
  const setQrRectFromCanvas = (canX: number, canY: number, canW: number, canH: number) => {
    if (!lockedQrBox || !lockedQrAdjustable) return
    setQrRect(clampRectToBox(toPdf(canX, canY, canW, canH), lockedQrBox))
  }

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
      // Kể cả khi vị trí đã khoá theo mẫu vẫn sang bước xem PDF — người ký phải đọc được nội
      // dung văn bản và xê dịch chữ ký trong khung trước khi ký, không ký "mù" như trước.
      setStep("placement")
    } catch {
      setPinError("Không thể xác thực PIN, vui lòng thử lại")
    } finally {
      setPinVerifying(false)
    }
  }

  const handleConfirm = () => {
    if (!pin.trim()) { setStep("pin"); setPinError("Vui lòng nhập lại PIN"); return }

    // Chế độ khoá theo mẫu: khung do người soạn thảo chốt, chỉ gửi lên bố cục 3 khối con.
    // Chạy TRƯỚC nhánh kiểm tra canvas để vẫn ký được khi PDF không tải lên xem trước được
    // (khi đó dùng bố cục mặc định, server tự kẹp toạ độ).
    if (lockedEntry) {
      if (lockedGhiChuBox && !ghiChuOff && !ghiChuText.trim()) {
        setConfirmError(
          "Mẫu văn bản này có khung Ghi chú. Vui lòng nhập ý kiến chỉ đạo, hoặc bấm “Không ghi ý kiến” nếu không cần.",
        )
        return
      }
      const signLayout: SignerSubLayout[] = lockedLayouts.map((l) => ({
        sig: l.sig,
        name: l.show_name ? l.name : null,
        chuc_vu: l.show_chuc_vu ? l.chuc_vu : null,
        prefix: l.show_prefix ? l.prefix : null,
        show_name: l.show_name,
        show_chuc_vu: l.show_chuc_vu,
        show_prefix: l.show_prefix,
      }))
      onConfirm(pin, null, "none", {
        signLayout,
        // Mảng theo đúng thứ tự `boxes`; UI chỉ thao tác khung đầu tiên, các khung còn lại
        // (nếu mẫu nhân bản) giữ bố cục mặc định ở server.
        noteLayout: lockedGhiChuBox && noteLayout && !ghiChuOff ? [noteLayout] : undefined,
        qrLayout: lockedQrAdjustable && qrRect ? [qrRect] : undefined,
        ghiChuPheDuyet: lockedGhiChuBox && !ghiChuOff ? ghiChuText.trim() : undefined,
        ghiChuTat: lockedGhiChuBox ? ghiChuOff : undefined,
      })
      return
    }

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
              disabled={pinVerifying || acting}
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl"
            >
              {pinVerifying || acting ? <Loader2 size={13} className="animate-spin" /> : <PenLine size={13} />}
              {pinVerifying ? "Đang xác thực..." : acting ? "Đang ký..." : lockedPlacement ? "Xác nhận ký" : "Xác nhận"}
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
          {lockedPlacement && (
            <p className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 leading-snug">
              Vị trí khung ký đã được cố định theo mẫu do người soạn thảo cài đặt. Nhập PIN xong
              bạn sẽ xem được nội dung văn bản và xê dịch chữ ký trong khung trước khi ký.
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
    <div className="fixed inset-0 bg-[#0f172a]/70 z-50 flex flex-col">
      <div
        className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 shrink-0"
        style={{ background: "linear-gradient(135deg,#2f5d52,#1c3a32)" }}
      >
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wide">Ký số văn bản</p>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-extrabold text-white text-base truncate">{stepLabel}</h3>
            {showCanvas && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/15 border border-white/25 text-[11px] font-bold text-white">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: myColor.fg, boxShadow: `0 0 0 2px ${myColor.fg}55` }}
                />
                {stepLabels[signStepKey] || "Khung của bạn"}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {showCanvas && !lockedEntry && (
            <button
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
              className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/30 text-white transition-all font-bold text-xs flex items-center gap-1"
              title="Nhân bản chữ ký"
            >
              <Plus size={14} /> <span className="hidden sm:inline">Nhân bản chữ ký</span>
            </button>
          )}
          {showCanvas && previewBoxes.some((b) => b.tier !== "mine") && (
            <button
              onClick={() => setShowOtherBoxes((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all ${
                showOtherBoxes
                  ? "bg-white/20 border-white/40 text-white"
                  : "bg-white/5 border-white/20 text-white/60"
              }`}
              title="Hiện/ẩn khung ký của các bước khác trên trang đang xem"
            >
              {showOtherBoxes ? <Eye size={13} /> : <EyeOff size={13} />}
              <span className="hidden sm:inline">Khung bước khác</span>
            </button>
          )}
          {showCanvas && numPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="p-1.5 rounded-lg bg-white/10 border border-white/25 text-white hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-bold text-white/90 whitespace-nowrap">{currentPage} / {numPages}</span>
              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= numPages}
                className="p-1.5 rounded-lg bg-white/10 border border-white/25 text-white hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-white hover:bg-white/15"><X size={16} /></button>
        </div>
      </div>

      {/* Dải hướng dẫn + chú giải màu — thay đoạn chữ xám dài dưới tiêu đề cũ */}
      <div className="bg-mint-50 border-b border-mint-100 px-4 sm:px-5 py-2 shrink-0 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-[#1f6a58]">
          {!showCanvas
            ? "Tag chữ ký trong file Office sẽ được thay tự động khi ký"
            : lockedEntry
              ? "Đọc lại nội dung trước khi ký — bạn chỉ xê dịch chữ ký / tên / chức danh BÊN TRONG khung màu của mình."
              : allowQrPlacement
                ? "Kéo và chỉnh kích thước để đặt chữ ký, tên và mã QR — vị trí QR giữ nguyên cho các lượt ký sau."
                : "Kéo và chỉnh kích thước để đặt vị trí chữ ký trên trang."}
        </p>
        {showCanvas && previewBoxes.length > 0 && (
          <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-3.5 h-3 rounded-[3px] border"
                style={{ borderColor: myColor.fg, background: myColor.bg, borderWidth: 1.5 }}
              />
              Khung của bạn
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3 rounded-[3px] border border-dashed border-slate-400 opacity-60" />
              Bước khác
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Rail thumbnail các trang — mirror màn cài đặt vị trí; khung của người đang ký sáng lên */}
        {showCanvas && numPages > 0 && (
          <div className="flex lg:flex-col shrink-0 gap-2 overflow-x-auto lg:overflow-y-auto overscroll-x-contain w-full lg:w-28 h-[92px] lg:h-auto px-2 py-2 bg-white border-b lg:border-b-0 lg:border-r border-slate-200">
            <div className="hidden lg:block text-[10px] uppercase tracking-wide text-slate-400 font-bold text-center">
              {numPages} trang
            </div>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
              const boxes = previewByPage[p] || []
              const hasMine = boxes.some((b) => b.tier === "mine")
              return (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  title={hasMine ? `Trang ${p} — có khung ký của bạn` : `Trang ${p}`}
                  className="relative shrink-0 w-[52px] h-[72px] lg:w-20 lg:h-28 rounded-md overflow-hidden border-2 bg-white mx-auto"
                  style={{
                    borderColor: p === currentPage ? "#2f5d52" : hasMine ? myColor.fg : "#e2e8f0",
                    boxShadow: hasMine ? `0 0 0 2px ${myColor.fg}44` : undefined,
                  }}
                >
                  {thumbs[p] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[p]} alt={`Trang ${p}`} className="w-full h-full object-contain" />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center bg-slate-100 text-[10px] font-bold text-slate-400 ${thumbsLoading ? "animate-pulse" : ""}`}>
                      {p}
                    </div>
                  )}

                  {/* Khung mẫu thu nhỏ: "của tôi" sáng đúng màu vai trò, khung khác mờ */}
                  {boxes.map((b, i) => (
                    <span
                      key={`${b.key}-${i}`}
                      className="absolute pointer-events-none rounded-[2px]"
                      style={{
                        left: `${b.pct.x}%`,
                        top: `${b.pct.y}%`,
                        width: `${b.pct.w}%`,
                        height: `${b.pct.h}%`,
                        border:
                          b.tier === "mine"
                            ? `1.5px solid ${b.color.fg}`
                            : b.tier === "done"
                              ? `1px solid ${b.color.fg}`
                              : `1px dashed ${b.color.fg}`,
                        background: b.tier === "mine" ? b.color.bg : "transparent",
                        boxShadow: b.tier === "mine" ? `0 0 0 1.5px ${b.color.fg}, 0 0 6px ${b.color.fg}` : undefined,
                        opacity: b.tier === "mine" ? 1 : b.tier === "done" ? 0.55 : 0.35,
                      }}
                    />
                  ))}

                  {hasMine && (
                    <span
                      className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
                      style={{ background: myColor.fg }}
                    />
                  )}
                  <span className="absolute bottom-0 right-0 text-[9px] font-bold text-slate-500 bg-white/85 px-1 rounded-tl">
                    {p}
                  </span>
                </button>
              )
            })}
          </div>
        )}

      <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-4 bg-app-bg">
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

                {/* Khung ký của các bước/vai trò KHÁC trên đúng trang này — chỉ để tham chiếu bố
                    cục, KHÔNG bắt sự kiện chuột (pointer-events-none) và nằm dưới mọi khối kéo
                    được (z=6 < region z=9 < khối con z=12-15) nên không bao giờ cản thao tác. */}
                {canvasReady && showOtherBoxes && otherBoxesOnPage.map((b, i) => {
                  // `pct` đã tính theo kích thước THẬT của chính trang này → nhân với kích thước
                  // canvas (= khổ trang × pdfScale) là ra px. Lấy khổ trang từ state `thumbDims`
                  // thay vì đọc `canvasRef.current` trong lúc render: ref không kích hoạt render
                  // lại nên khi đổi sang trang khác khổ giấy sẽ lệch mất một nhịp.
                  const dim = thumbDims[currentPage]
                  if (!dim) return null
                  const cw = dim.w * pdfScale
                  const ch = dim.h * pdfScale
                  return (
                    <div
                      key={`ghost-${b.key}-${i}`}
                      className="absolute pointer-events-none rounded"
                      style={{
                        left: (b.pct.x / 100) * cw,
                        top: (b.pct.y / 100) * ch,
                        width: (b.pct.w / 100) * cw,
                        height: (b.pct.h / 100) * ch,
                        border: `1px dashed ${b.color.fg}${b.tier === "done" ? "99" : "66"}`,
                        zIndex: 6,
                      }}
                    >
                      <span
                        className="absolute -top-4 left-0 text-[9px] font-bold px-1 rounded bg-white/85 whitespace-nowrap"
                        style={{ color: b.color.fg }}
                      >
                        {b.label}{b.tier === "done" ? " ✓" : ""}
                      </span>
                    </div>
                  )
                })}

                {/* Luồng cũ: người ký tự do kéo-thả toàn trang (văn bản chưa chốt mẫu vị trí). */}
                {canvasReady && !lockedEntry && (
                  <>
                    {/* Chữ ký */}
                    <Draggable
                      nodeRef={sigNodeRef as RefObject<HTMLElement>}
                      position={{ x: sigState.x, y: sigState.y }}
                      onStop={(_, d) => setSigState((p) => ({ ...p, x: d.x, y: d.y }))}
                      bounds="parent"
                      cancel=".react-resizable-handle,button,button *,a,.no-drag"
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
                            <div className="absolute -top-3 -right-3 flex items-center gap-1" style={{ zIndex: 20 }}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); setShowSig((v) => !v) }}
                                className="w-7 h-7 sm:w-5 sm:h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600 active:scale-95 transition-transform"
                                title={showSig ? "Ẩn chữ ký" : "Hiện chữ ký"}
                              >
                                {showSig ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation()
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
                                className="w-7 h-7 sm:w-5 sm:h-5 bg-blue-600 border border-blue-700 text-white rounded-full shadow flex items-center justify-center hover:bg-blue-700 font-bold active:scale-95 transition-transform"
                                title="Nhân bản chữ ký và tên (+)"
                              >
                                <Plus size={12} />
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
                      cancel=".react-resizable-handle,button,button *,a,.no-drag"
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
                                {showName ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation()
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
                                className="w-7 h-7 sm:w-5 sm:h-5 bg-blue-600 border border-blue-700 text-white rounded-full shadow flex items-center justify-center hover:bg-blue-700 font-bold active:scale-95 transition-transform"
                                title="Nhân bản chữ ký và tên (+)"
                              >
                                <Plus size={12} />
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
                        cancel=".react-resizable-handle,button,button *,a,.no-drag"
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
                        cancel=".react-resizable-handle,button,button *,a,.no-drag"
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
                              <div className="absolute -top-3 -right-3 flex items-center gap-1" style={{ zIndex: 20 }}>
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  onTouchEnd={(e) => e.stopPropagation()}
                                  onClick={(e) => { e.stopPropagation(); setExtraSigBoxes((prev) => prev.map((b) => b.id === box.id ? { ...b, showSignature: !b.showSignature } : b)) }}
                                  className="w-7 h-7 sm:w-5 sm:h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600 active:scale-95 transition-transform"
                                  title={box.showSignature ? "Ẩn chữ ký bản sao" : "Hiện chữ ký bản sao"}
                                >
                                  {box.showSignature ? <EyeOff size={12} /> : <Eye size={12} />}
                                </button>
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
                                onTouchStart={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); setExtraSigBoxes((prev) => prev.map((b) => b.id === box.id ? { ...b, showSignerName: !b.showSignerName } : b)) }}
                                className="absolute -top-3 -right-3 w-7 h-7 sm:w-5 sm:h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600 active:scale-95 transition-transform"
                                style={{ zIndex: 20 }}
                                title={box.showSignerName ? "Ẩn tên bản sao" : "Hiện tên bản sao"}
                              >
                                {box.showSignerName ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                            </div>
                          </Resizable>
                        </ExtraDraggableBox>
                      </Fragment>
                    ))}
                  </>
                )}

                {/* Chế độ "vị trí CỨNG": mỗi khung mẫu là 1 VÙNG CHO PHÉP (viền đứt), bên trong
                    có 3 khối con kéo/resize độc lập nhưng không ra khỏi vùng (bounds="parent"
                    + kẹp lại bằng clampRectToBox, server kẹp lần nữa khi lưu). */}
                {canvasReady && lockedEntry && (
                  <>
                    {lockedEntry.boxes.map((box, idx) => {
                      const layout = lockedLayouts[idx]
                      if (!layout) return null
                      if (!resolveAnchorPages(box, numPages).includes(currentPage)) return null
                      const region = toCanvas({ x: box.x, y: box.y, width: box.width, height: box.height })
                      const sigCan = toCanvas(layout.sig)
                      const nameCan = layout.show_name && layout.name ? toCanvas(layout.name) : null
                      const chucVuCan = layout.show_chuc_vu && layout.chuc_vu ? toCanvas(layout.chuc_vu) : null
                      const allowChucVu = box.show_chuc_vu && !!signerChucVu
                      return (
                        <div
                          key={`locked-${idx}`}
                          className="absolute rounded"
                          style={{
                            left: region.x,
                            top: region.y,
                            width: region.w,
                            height: region.h,
                            zIndex: 9,
                            // Đúng màu người soạn thảo đã đặt cho vai trò này ở màn cài đặt vị trí
                            // (bước 1 amber, bước 2 sky, …, phê duyệt emerald).
                            border: `2px dashed ${myColor.fg}`,
                            background: myColor.bg,
                            boxShadow: `0 0 0 3px ${myColor.fg}22`,
                          }}
                        >
                          <span
                            className="absolute -top-5 left-0 text-[10px] font-bold bg-white/90 px-1 rounded whitespace-nowrap"
                            style={{ color: myColor.fg }}
                          >
                            Khung của bạn {lockedEntry.boxes.length > 1 ? `#${idx + 1}` : ""}
                          </span>

                          <ExtraDraggableBox
                            position={{ x: sigCan.x - region.x, y: sigCan.y - region.y }}
                            onStop={(_, d) => setLockedRect(idx, "sig", region.x + d.x, region.y + d.y, sigCan.w, sigCan.h)}
                            zIndex={13}
                          >
                            <Resizable
                              size={{ width: sigCan.w, height: sigCan.h }}
                              onResizeStop={(_, __, ___, delta) =>
                                setLockedRect(idx, "sig", sigCan.x, sigCan.y, sigCan.w + delta.width, sigCan.h + delta.height)}
                              enable={{ right: true, bottom: true, bottomRight: true }}
                              minWidth={20} minHeight={12}
                            >
                              <div
                                className="w-full h-full rounded flex items-center justify-center overflow-hidden bg-white/85"
                                style={{ border: `1px solid ${myColor.fg}` }}
                              >
                                {signatureUrl ? (
                                  <img src={signatureUrl} alt="Chữ ký" className="w-full h-full object-contain" />
                                ) : (
                                  <span className="text-[9px] font-bold px-1 text-center" style={{ color: myColor.fg }}>Chữ ký</span>
                                )}
                              </div>
                            </Resizable>
                          </ExtraDraggableBox>

                          {nameCan && (
                            <ExtraDraggableBox
                              position={{ x: nameCan.x - region.x, y: nameCan.y - region.y }}
                              onStop={(_, d) => setLockedRect(idx, "name", region.x + d.x, region.y + d.y, nameCan.w, nameCan.h)}
                              zIndex={14}
                            >
                              <Resizable
                                size={{ width: nameCan.w, height: nameCan.h }}
                                onResizeStop={(_, __, ___, delta) =>
                                  setLockedRect(idx, "name", nameCan.x, nameCan.y, nameCan.w + delta.width, nameCan.h + delta.height)}
                                enable={{ right: true, bottom: true, bottomRight: true }}
                                minWidth={30} minHeight={10}
                              >
                                <div className="w-full h-full border border-sky-500 bg-sky-50/85 rounded flex items-center justify-center overflow-hidden">
                                  <span className="text-[10px] font-bold text-sky-800 truncate px-1">{userName || "Người ký"}</span>
                                </div>
                              </Resizable>
                            </ExtraDraggableBox>
                          )}

                          {chucVuCan && (
                            <ExtraDraggableBox
                              position={{ x: chucVuCan.x - region.x, y: chucVuCan.y - region.y }}
                              onStop={(_, d) => setLockedRect(idx, "chuc_vu", region.x + d.x, region.y + d.y, chucVuCan.w, chucVuCan.h)}
                              zIndex={14}
                            >
                              <Resizable
                                size={{ width: chucVuCan.w, height: chucVuCan.h }}
                                onResizeStop={(_, __, ___, delta) =>
                                  setLockedRect(idx, "chuc_vu", chucVuCan.x, chucVuCan.y, chucVuCan.w + delta.width, chucVuCan.h + delta.height)}
                                enable={{ right: true, bottom: true, bottomRight: true }}
                                minWidth={30} minHeight={10}
                              >
                                <div className="w-full h-full border border-violet-500 bg-violet-50/85 rounded flex items-center justify-center overflow-hidden">
                                  <span className="text-[9px] font-semibold text-violet-800 truncate px-1">{signerChucVu}</span>
                                </div>
                              </Resizable>
                            </ExtraDraggableBox>
                          )}

                          {/* Tiền tố ký thay (KT./TM./…) — khối con thứ 4, chỉ có khi mẫu chọn
                              ký thay cho bước này. Nằm TRONG khung như 3 khối kia. */}
                          {layout.show_prefix && layout.prefix && (() => {
                            const preCan = toCanvas(layout.prefix)
                            return (
                              <ExtraDraggableBox
                                position={{ x: preCan.x - region.x, y: preCan.y - region.y }}
                                onStop={(_, d) => setLockedRect(idx, "prefix", region.x + d.x, region.y + d.y, preCan.w, preCan.h)}
                                zIndex={15}
                              >
                                <Resizable
                                  size={{ width: preCan.w, height: preCan.h }}
                                  onResizeStop={(_, __, ___, delta) =>
                                    setLockedRect(idx, "prefix", preCan.x, preCan.y, preCan.w + delta.width, preCan.h + delta.height)}
                                  enable={{ right: true, bottom: true, bottomRight: true }}
                                  minWidth={24} minHeight={10}
                                >
                                  <div className="w-full h-full border border-orange-500 bg-orange-50/85 rounded flex items-center justify-center overflow-hidden">
                                    <span className="text-[10px] font-extrabold text-orange-800 truncate px-1">{lockedPrefixText}</span>
                                  </div>
                                </Resizable>
                              </ExtraDraggableBox>
                            )
                          })()}

                          {/* Nút bật/tắt đặt NGOÀI khối (dưới vùng cho phép) để còn bật lại được
                              sau khi đã tắt. Chỉ hiện đúng những khối mẫu CHO PHÉP. */}
                          {(box.show_name || allowChucVu || !!lockedPrefixText) && (
                            <div className="absolute -bottom-6 left-0 flex items-center gap-1" style={{ zIndex: 20 }}>
                              {!!lockedPrefixText && (
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => { e.stopPropagation(); toggleLockedBlock(idx, "prefix") }}
                                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border shadow-sm ${layout.show_prefix ? "bg-white border-orange-300 text-orange-700" : "bg-slate-100 border-slate-300 text-slate-400"}`}
                                  title={layout.show_prefix ? `Tắt ký thay ${lockedPrefixText} (không đóng dấu tiền tố)` : `Bật lại ký thay ${lockedPrefixText}`}
                                >
                                  {layout.show_prefix ? <Eye size={10} /> : <EyeOff size={10} />} {lockedPrefixText}
                                </button>
                              )}
                              {box.show_name && (
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => { e.stopPropagation(); toggleLockedBlock(idx, "name") }}
                                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border shadow-sm ${layout.show_name ? "bg-white border-sky-300 text-sky-700" : "bg-slate-100 border-slate-300 text-slate-400"}`}
                                  title={layout.show_name ? "Ẩn tên (đặt lại vị trí mặc định)" : "Hiện tên"}
                                >
                                  {layout.show_name ? <Eye size={10} /> : <EyeOff size={10} />} Tên
                                </button>
                              )}
                              {allowChucVu && (
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => { e.stopPropagation(); toggleLockedBlock(idx, "chuc_vu") }}
                                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border shadow-sm ${layout.show_chuc_vu ? "bg-white border-violet-300 text-violet-700" : "bg-slate-100 border-slate-300 text-slate-400"}`}
                                  title={layout.show_chuc_vu ? "Ẩn chức danh (đặt lại vị trí mặc định)" : "Hiện chức danh"}
                                >
                                  {layout.show_chuc_vu ? <Eye size={10} /> : <EyeOff size={10} />} Chức danh
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Khung Ghi chú = VÙNG CHO PHÉP chứa 2 khối con kéo/resize được: ô ý kiến
                        chỉ đạo (chữ tự xuống dòng) và chữ ký nháy. Lãnh đạo tự né chỗ đã có chữ
                        trên văn bản. Nội dung gõ ở panel dưới. */}
                    {lockedGhiChuBox && noteLayout && resolveAnchorPages(lockedGhiChuBox, numPages).includes(currentPage) && (() => {
                      const g = toCanvas({
                        x: lockedGhiChuBox.x,
                        y: lockedGhiChuBox.y,
                        width: lockedGhiChuBox.width,
                        height: lockedGhiChuBox.height,
                      })
                      const off = ghiChuOff || !ghiChuText.trim()
                      const textCan = toCanvas(noteLayout.text)
                      const kyNhayCan = noteLayout.ky_nhay ? toCanvas(noteLayout.ky_nhay) : null
                      return (
                        <div
                          className={`absolute border-2 border-dashed rounded ${off ? "border-slate-300 bg-slate-100/50" : "border-teal-500 bg-teal-50/25"}`}
                          style={{ left: g.x, top: g.y, width: g.w, height: g.h, zIndex: 8 }}
                        >
                          <span className="absolute -top-5 left-0 text-[10px] font-bold text-teal-700 bg-white/90 px-1 rounded whitespace-nowrap">
                            Vùng ý kiến chỉ đạo
                          </span>

                          {off ? (
                            <p className="text-[9px] text-slate-400 italic p-1">Không ghi ý kiến</p>
                          ) : (
                            <>
                              <ExtraDraggableBox
                                position={{ x: textCan.x - g.x, y: textCan.y - g.y }}
                                onStop={(_, d) => setNoteRect("text", g.x + d.x, g.y + d.y, textCan.w, textCan.h)}
                                zIndex={12}
                              >
                                <Resizable
                                  size={{ width: textCan.w, height: textCan.h }}
                                  onResizeStop={(_, __, ___, delta) =>
                                    setNoteRect("text", textCan.x, textCan.y, textCan.w + delta.width, textCan.h + delta.height)}
                                  enable={{ right: true, bottom: true, bottomRight: true }}
                                  minWidth={40} minHeight={12}
                                >
                                  {/* Xem trước wrap bằng CSS nên XẤP XỈ vị trí xuống dòng thật của
                                      drawTextWrapped (pdf-lib đo theo font TimesNewRoman) — đủ để
                                      né chữ, không cam kết khớp từng dòng. */}
                                  <div className="w-full h-full border border-teal-600 bg-teal-50/90 rounded overflow-hidden px-0.5">
                                    <p className="text-[9px] leading-tight text-slate-800 whitespace-pre-wrap break-words">
                                      {ghiChuText}
                                    </p>
                                  </div>
                                </Resizable>
                              </ExtraDraggableBox>

                              {kyNhayCan && (
                                <ExtraDraggableBox
                                  position={{ x: kyNhayCan.x - g.x, y: kyNhayCan.y - g.y }}
                                  onStop={(_, d) => setNoteRect("ky_nhay", g.x + d.x, g.y + d.y, kyNhayCan.w, kyNhayCan.h)}
                                  zIndex={13}
                                >
                                  <Resizable
                                    size={{ width: kyNhayCan.w, height: kyNhayCan.h }}
                                    onResizeStop={(_, __, ___, delta) =>
                                      setNoteRect("ky_nhay", kyNhayCan.x, kyNhayCan.y, kyNhayCan.w + delta.width, kyNhayCan.h + delta.height)}
                                    enable={{ right: true, bottom: true, bottomRight: true }}
                                    minWidth={20} minHeight={10}
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

                    {/* Khung QR: người ký ĐẦU TIÊN kéo/resize được, các lượt sau chỉ xem. */}
                    {lockedQrBox && qrRect && resolveAnchorPages(lockedQrBox, numPages).includes(currentPage) && (() => {
                      const region = toCanvas({
                        x: lockedQrBox.x,
                        y: lockedQrBox.y,
                        width: lockedQrBox.width,
                        height: lockedQrBox.height,
                      })
                      const q = toCanvas(qrRect)
                      const qrValue = `${typeof window !== "undefined" ? window.location.origin : ""}/dashboard/documents/${docId}`
                      const qrInner = (
                        <div className={`w-full h-full rounded bg-white flex items-center justify-center overflow-hidden ${lockedQrAdjustable ? "border border-violet-600" : "border border-slate-400 opacity-80"}`}>
                          <QRCodeSVG value={qrValue} size={Math.max(16, Math.min(q.w, q.h) - 2)} level="L" />
                        </div>
                      )
                      return (
                        <div
                          className={`absolute rounded ${lockedQrAdjustable ? "border-2 border-dashed border-violet-500 bg-violet-50/25" : "border border-dashed border-slate-400"}`}
                          style={{ left: region.x, top: region.y, width: region.w, height: region.h, zIndex: 8 }}
                        >
                          <span className="absolute -top-5 left-0 text-[10px] font-bold bg-white/90 px-1 rounded whitespace-nowrap text-violet-700">
                            {lockedQrAdjustable ? "Vùng QR" : "QR đã chốt ở lượt ký trước"}
                          </span>
                          {lockedQrAdjustable ? (
                            <ExtraDraggableBox
                              position={{ x: q.x - region.x, y: q.y - region.y }}
                              onStop={(_, d) => setQrRectFromCanvas(region.x + d.x, region.y + d.y, q.w, q.h)}
                              zIndex={12}
                            >
                              <Resizable
                                size={{ width: q.w, height: q.h }}
                                onResizeStop={(_, __, ___, delta) =>
                                  setQrRectFromCanvas(q.x, q.y, q.w + delta.width, q.h + delta.height)}
                                enable={{ right: true, bottom: true, bottomRight: true }}
                                lockAspectRatio
                                minWidth={20} minHeight={20}
                              >
                                {qrInner}
                              </Resizable>
                            </ExtraDraggableBox>
                          ) : (
                            <div className="absolute" style={{ left: q.x - region.x, top: q.y - region.y, width: q.w, height: q.h }}>
                              {qrInner}
                            </div>
                          )}
                        </div>
                      )
                    })()}
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
      </div>

      <div className="border-t border-slate-200 bg-white px-4 sm:px-5 py-3.5 space-y-3 shrink-0">
          {showSignAsPicker && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
              <label className="text-xs font-bold text-amber-800 block mb-1.5">Ký thay (tùy chọn)</label>
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

          {/* Ô ý kiến chỉ đạo — chỉ hiện khi người soạn thảo CÓ đặt khung "Ghi chú" trong mẫu
              (quy tắc 2 tầng: mẫu không đặt khung thì lãnh đạo không có ô này, và cũng không có
              chữ ký nháy). Bắt buộc quyết định rõ: nhập nội dung, hoặc tắt hẳn. */}
          {lockedGhiChuBox && (
            <div className={`rounded-xl border px-3 py-2.5 ${ghiChuOff ? "border-slate-200 bg-slate-50" : "border-teal-200 bg-teal-50/60"}`}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  Ý kiến chỉ đạo <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => { setGhiChuOff((v) => !v); setConfirmError("") }}
                  className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${ghiChuOff ? "bg-white border-teal-300 text-teal-700" : "bg-white border-slate-300 text-slate-500 hover:bg-slate-50"}`}
                >
                  {ghiChuOff ? "Bật lại khung Ghi chú" : "Không ghi ý kiến"}
                </button>
              </div>
              {ghiChuOff ? (
                <p className="text-[11px] text-slate-500 italic">
                  Khung Ghi chú sẽ bị bỏ trống — không đóng dấu ý kiến lẫn chữ ký nháy lên văn bản.
                </p>
              ) : (
                <>
                  <textarea
                    value={ghiChuText}
                    onChange={(e) => { setGhiChuText(e.target.value); setConfirmError("") }}
                    rows={2}
                    placeholder="VD: Phòng TCHC phối hợp Nhà máy chế biến tham mưu thực hiện, hạn chót 15/9/2026"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500 resize-y"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Nội dung sẽ được đóng vào khung Ghi chú trên văn bản, kèm chữ ký nháy của bạn ở góc trên-phải khung.
                  </p>
                </>
              )}
            </div>
          )}

          {confirmError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> <span>{confirmError}</span>
            </div>
          )}

          <div className="flex items-center gap-2 justify-between">
            {/* Nhảy thẳng tới trang có khung của mình — tài liệu nhiều trang không phải lật tay */}
            {showCanvas && myFirstPage != null && myFirstPage !== currentPage ? (
              <button
                onClick={() => goToPage(myFirstPage)}
                className="text-xs font-bold px-3 py-2 rounded-xl border bg-white hover:bg-slate-50"
                style={{ color: myColor.fg, borderColor: `${myColor.fg}66` }}
              >
                Tới khung của bạn (trang {myFirstPage})
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button
                onClick={handleConfirm}
                disabled={acting}
                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-md"
              >
                <PenLine size={14} /> {acting ? "Đang xử lý..." : "Xác nhận ký"}
              </button>
            </div>
          </div>
      </div>
    </div>
  )
}

export default function DocumentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const docId = params.id as string
  // Đánh dấu đã tự động gửi ký sau khi quay lại từ màn "Cài đặt vị trí ký" — chỉ trigger
  // đúng 1 lần/lượt mount, tránh gửi lặp nếu user F5 lại trang còn giữ query param cũ.
  const autoSendTriedRef = useRef(false)

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

  // "Gửi ký" của văn bản nguồn PDF phải đi qua màn "Cài đặt vị trí ký" trước — CẢ khi
  // loại tài liệu đã có mẫu lưu sẵn (không chỉ lần đầu): người soạn thảo luôn phải xem
  // lại/xác nhận đúng vị trí mẫu (hoặc vẽ mới nếu chưa có) rồi mới thật sự gửi đi, theo
  // đúng yêu cầu đã chốt (CLAUDE.md mục "Kế hoạch phiên sau 2026-09-02"). Văn bản nguồn
  // Office (DOCX/XLSX) không có khái niệm "vị trí" (dùng tag {{...}}) nên bỏ qua màn
  // này, gửi thẳng như cũ. Đây CHỈ là điều hướng UI — chưa đụng gì tới
  // api/documents/sign/route.ts hay logic đóng dấu PDF thật.
  const handleGuiKy = () => {
    if (doc && docExt === "pdf" && docSourceUrl && doc.loai_van_ban) {
      const qs = new URLSearchParams({
        loai: doc.loai_van_ban,
        pdfUrl: docSourceUrl,
        docLabel: doc.ten_van_ban || doc.ma_van_ban || doc.loai_van_ban,
        returnTo: `/dashboard/documents/${doc.id}`,
        docId: doc.id,
      })
      router.push(`/dashboard/ky/mau-vi-tri?${qs.toString()}`)
      return
    }
    void doAction("gui_ky")
  }

  // Quay lại từ màn "Cài đặt vị trí ký" (đã xác nhận vị trí, kể cả không đổi gì) — tự
  // động gọi lại đúng hành động gửi ký, đúng 1 lần, rồi dọn query param khỏi URL.
  useEffect(() => {
    if (autoSendTriedRef.current) return
    if (!doc || !factoryId) return
    if (searchParams.get("confirmedSignTemplate") !== "1") return
    autoSendTriedRef.current = true
    router.replace(`/dashboard/documents/${doc.id}`)
    void doAction("gui_ky")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, factoryId, searchParams])

  // Chức vụ thật của chính người đang đăng nhập — quyết định khối "chức danh" có nội dung để
  // hiển thị/kéo hay không. Tái dùng đúng route mà màn "Cài đặt vị trí ký" đang dùng
  // (maintenance_staff.chuc_vu_chinh_quyen || chuc_vu qua profile_id), không tự tra kiểu khác.
  const [signerChucVu, setSignerChucVu] = useState("")

  useEffect(() => {
    const uid = user?.id
    if (!factoryId || !uid) return
    let cancelled = false
    const load = async () => {
      const token = await getAuthToken()
      if (!token) return
      const res = await fetch(
        `/api/documents/signer-info?factoryId=${encodeURIComponent(factoryId)}&userIds=${encodeURIComponent(uid)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) return
      const rows = (await res.json()) as Array<{ id: string; chuc_vu: string }>
      if (!cancelled) setSignerChucVu(rows.find((r) => r.id === uid)?.chuc_vu || "")
    }
    void load().catch(() => {})
    return () => { cancelled = true }
  }, [factoryId, user?.id])

  const handleSignConfirm = async (
    pin: string,
    placement: SignPlacement | null,
    signAs: SignAsType,
    extra?: {
      signLayout?: SignerSubLayout[]
      noteLayout?: NoteSubLayout[]
      qrLayout?: LayoutRect[]
      ghiChuPheDuyet?: string
      ghiChuTat?: boolean
    },
  ) => {
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
          sign_layout: extra?.signLayout,
          note_layout: extra?.noteLayout,
          qr_layout: extra?.qrLayout,
          ghi_chu_phe_duyet: extra?.ghiChuPheDuyet,
          ghi_chu_tat: extra?.ghiChuTat,
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

  // Dữ liệu hiển thị cho khung xem trước trong modal ký (thumbnail + lớp mờ trên canvas).
  // Cố ý KHÔNG dùng useMemo: phía trên đã có early return (loading / !doc) nên thêm hook ở đây sẽ
  // vi phạm rules of hooks. Chi phí tính lại không đáng kể và cha không re-render khi người ký
  // đang kéo-thả (state đó nằm trong chính modal).
  const signedStepKeys = [
    ...Object.keys((doc.nguoi_ky as Record<string, NguoiKyEntry> | null) || {}),
    ...(doc.trang_thai === "da_phe_duyet" ? ["phe_duyet"] : []),
  ]
  const stepLabels: Record<string, string> = {
    ...Object.fromEntries(
      (doc.thu_tu_ky_json || []).map((s: ThuTuKyStep, i) => [
        String(i + 1),
        `Bước ${i + 1}: ${s.phong_ban_code || s.ten || ""}`.trim(),
      ]),
    ),
    phe_duyet: "Phê duyệt",
    qr: "Mã QR",
    ngay_ky: "Ngày ký",
    ghi_chu: "Ý kiến chỉ đạo",
  }

  const signSigTag = signModal === "phe_duyet" ? "{{CHU_KY_PHE_DUYET}}" : `{{CHU_KY_BUOC_${signStepKey}}}`
  const signNameTag = signModal === "phe_duyet" ? "{{TEN_PHE_DUYET}}" : `{{TEN_BUOC_${signStepKey}}}`
  // QR chỉ được đặt vị trí ở lượt ký ĐẦU TIÊN của cả văn bản (chưa từng lưu
  // placement_ky.qr) — các lượt ký sau tái dùng đúng vị trí đã chọn, tránh vẽ nhiều
  // QR ở nhiều vị trí khác nhau qua các lần ký (xem sign/route.ts's performFileStamp).
  const hasQrPlacement = !!(doc.placement_ky as Record<string, unknown> | null)?.["qr"]
  // Bước ký này đã được khoá vị trí theo mẫu (chốt lúc "Gửi ký", xem buildPlacementKyFromTemplate)
  // → khung ký cố định, người ký chỉ xê dịch 3 khối con bên trong. Kiểm theo TỪNG BƯỚC (không
  // phải cả văn bản): nếu mẫu thiếu khung cho đúng bước nào, riêng bước đó vẫn rơi về canvas
  // kéo-thả tự do cũ thay vì chặn ký.
  const signStepEntry = ((doc.placement_ky as Record<string, unknown> | null)?.[signStepKey] as
    | (TemplateStepPlacement & { tu_mau?: boolean })
    | undefined) || null
  const signStepLocked =
    signStepEntry?.tu_mau === true && Array.isArray(signStepEntry.boxes) && signStepEntry.boxes.length > 0
  const signLockedEntry = signStepLocked ? (signStepEntry as TemplateStepPlacement) : null
  // Khung "Ghi chú" = ô ý kiến chỉ đạo của lãnh đạo, CHỈ xuất hiện ở bước phê duyệt và chỉ khi
  // người soạn thảo có đặt khung này trong mẫu (mẫu không đặt → không có ô, cũng không có chữ
  // ký nháy — đúng quy tắc 2 tầng).
  const ghiChuTemplateEntry = ((doc.placement_ky as Record<string, unknown> | null)?.["ghi_chu"] as
    | { tu_mau?: boolean; boxes?: TemplateNoteBox[] }
    | undefined) || null
  const signGhiChuBox =
    signModal === "phe_duyet" && signStepLocked && ghiChuTemplateEntry?.tu_mau === true
      ? ghiChuTemplateEntry.boxes?.[0] ?? null
      : null

  // QR của mẫu: hiện để người ký nhìn thấy, và cho lượt ký ĐẦU TIÊN xê dịch. Đã có `layout` ở
  // bất kỳ khung nào ⇒ lượt trước đã chốt ⇒ các lượt sau chỉ xem (mirror `mergeQrBox` luồng cũ).
  const qrTemplateEntry = ((doc.placement_ky as Record<string, unknown> | null)?.["qr"] as
    | { tu_mau?: boolean; boxes?: TemplateQrBox[] }
    | undefined) || null
  const signQrBox =
    signStepLocked && qrTemplateEntry?.tu_mau === true ? qrTemplateEntry.boxes?.[0] ?? null : null
  const signQrAdjustable = !!signQrBox && !qrTemplateEntry?.boxes?.some((b) => !!b.layout)

  // Tiền tố ký thay do người soạn thảo chọn trong mẫu. Giữ đúng rule cũ: bước `ky_buoc` chỉ áp
  // dụng cho phòng ban (ca_nhan đã đích danh 1 người, không có khái niệm "ký thay").
  const signPrefixAllowed =
    signModal === "phe_duyet" || (signModal === "ky_buoc" && currentStep?.type === "phong_ban")
  const signPrefixText =
    signStepLocked && signPrefixAllowed && signLockedEntry?.sign_as
      ? `${signLockedEntry.sign_as}.`
      : ""

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
              {/* Văn bản nguồn PDF: bấm vào là VÀO MÀN CÀI ĐẶT VỊ TRÍ, việc gửi ký chỉ xảy ra
                  sau khi xác nhận vị trí ở màn đó — nhãn phải mô tả đúng hành động ngay lập tức.
                  File Office đi thẳng (dùng tag {{…}}, không có màn vị trí). */}
              {docExt === "pdf" ? "Vào cài đặt vị trí" : "Gửi ký"}
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

      {/* Cột trái 3/5 — cột phải 2/5, `items-stretch` + `flex-1` để 2 card LUÔN cao bằng nhau
          (trước đây grid 2+1 và card con không giãn nên bên cao bên thấp). */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
        {/* Thông tin văn bản */}
        <div className="lg:col-span-3 flex flex-col gap-5">
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-mint-50 border-b border-mint-100">
              <span className="w-8 h-8 rounded-full bg-mint-100 grid place-items-center text-[#1f6a58] shrink-0">
                <FileText size={16} />
              </span>
              <h2 className="text-sm font-extrabold text-slate-800">Thông tin văn bản</h2>
            </div>
            <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <InfoRow label="Loại văn bản" value={doc.loai_van_ban ? (LOAI_VAN_BAN_LABEL[doc.loai_van_ban] || doc.loai_van_ban) : "—"} />
              <InfoRow label="Phòng ban" value={doc.phong_ban || "—"} />
              {!!doc.phong_ban_ky_display?.length && (
                <div className="sm:col-span-2 rounded-xl bg-slate-50/80 border border-slate-100 px-3 py-2">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Phòng ban đã ký</dt>
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
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Ghi chú</p>
                <p className="text-sm text-slate-700">{doc.ghi_chu}</p>
              </div>
            )}
            </div>
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
        <div className="lg:col-span-2 flex">
          <div className="flex-1 w-full flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-amber-50 border-b border-amber-100">
              <span className="w-8 h-8 rounded-full bg-amber-100 grid place-items-center text-amber-700 shrink-0">
                <ShieldCheck size={16} />
              </span>
              <h2 className="text-sm font-extrabold text-slate-800">
                {doc.is_uploaded
                  ? "Thông tin ký tay"
                  : doc.pham_vi === "Don_vi"
                    ? "Tiến trình ký xác nhận & phê duyệt"
                    : "Tiến trình ký duyệt"}
              </h2>
            </div>
            <ol className="relative p-5 pb-2">
              {/* Soạn thảo — ẩn nếu là văn bản upload ký tay không có tên người soạn */}
              {(!doc.is_uploaded || doc.nguoi_soan_thao_display) && (
                <TimelineStep
                  label="Soạn thảo"
                  sublabel={doc.nguoi_soan_thao_display || ""}
                  done={true}
                  at={doc.created_at}
                  accentColor="#94a3b8"
                />
              )}

              {/* Từng bước ký phòng ban */}
              {(doc.thu_tu_ky_json || []).map((step: ThuTuKyStep, i) => {
                const nguoiKyEntry = (doc.nguoi_ky as Record<string, NguoiKyEntry>)[String(i + 1)]
                const isCurrentStep = doc.trang_thai === "cho_ky_phong_ban" && doc.buoc_hien_tai === i
                const otherWaitLabel =
                  step.type === "ca_nhan"
                    ? `Chờ ${step.ten || "người được chỉ định"} ký`
                    : `Chờ phòng ${step.phong_ban_name || step.phong_ban_code || ""} ký`
                return (
                  <TimelineStep
                    key={i}
                    label={`Bước ${i + 1}: ${step.phong_ban_code || step.ten || ""}`}
                    sublabel={
                      nguoiKyEntry?.ten
                        ? `${signAsPrefixLabel(nguoiKyEntry.sign_as, nguoiKyEntry.is_kt)}${nguoiKyEntry.ten}`
                        : isCurrentStep
                          ? (canKyBuoc ? "Chờ BẠN ký" : otherWaitLabel)
                          : "Chờ"
                    }
                    done={!!nguoiKyEntry}
                    pending={isCurrentStep}
                    isMyTurn={isCurrentStep && canKyBuoc}
                    at={nguoiKyEntry?.ky_at}
                    stepNo={i + 1}
                    // Cùng màu với khung ký của bước đó trên PDF (modal ký + màn cài đặt vị trí)
                    accentColor={getKyBuocColor(i + 1).fg}
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
                      ? (canPheDuyet ? "Chờ BẠN phê duyệt" : "Đang chờ phê duyệt...")
                      : doc.phe_duyet || "Chờ phê duyệt"
                }
                done={doc.trang_thai === "da_phe_duyet"}
                pending={doc.trang_thai === "cho_phe_duyet"}
                isMyTurn={doc.trang_thai === "cho_phe_duyet" && canPheDuyet}
                at={doc.ngay_phe_duyet || undefined}
                accentColor={ROLE_COLORS.phe_duyet.fg}
                isLast
              />
            </ol>

            {/* Khối tiến độ ở đáy — vừa cho biết còn bao nhiêu bước, vừa lấp khoảng trắng khi
                timeline ngắn hơn cột trái (2 card đã cao bằng nhau nhờ flex-1). */}
            {!doc.is_uploaded && (() => {
              const totalSteps = (doc.thu_tu_ky_json || []).length + 1 // + bước phê duyệt cuối
              const doneSteps =
                Object.keys((doc.nguoi_ky as Record<string, NguoiKyEntry> | null) || {}).length +
                (doc.trang_thai === "da_phe_duyet" ? 1 : 0)
              const pct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0
              const allDone = doc.trang_thai === "da_phe_duyet"
              return (
                <div className="mt-auto px-5 py-4 border-t border-slate-100 bg-slate-50/60">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Tiến độ ký</span>
                    <span className={`text-xs font-extrabold ${allDone ? "text-emerald-600" : "text-amber-600"}`}>
                      {doneSteps}/{totalSteps} bước
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${allDone ? "bg-emerald-500" : "bg-amber-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })()}
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
          allowSignAs={
            !signStepLocked &&
            ((signModal === "ky_buoc" && currentStep?.type === "phong_ban") || signModal === "phe_duyet")
          }
          allowQrPlacement={!hasQrPlacement}
          lockedPlacement={signStepLocked}
          lockedEntry={signLockedEntry}
          lockedGhiChuBox={signGhiChuBox}
          lockedQrBox={signQrBox}
          lockedQrAdjustable={signQrAdjustable}
          lockedPrefixText={signPrefixText}
          signerChucVu={signerChucVu}
          placementAll={(doc.placement_ky as Record<string, unknown> | null) ?? null}
          signStepKey={signStepKey}
          signedStepKeys={signedStepKeys}
          stepLabels={stepLabels}
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
  // true khi bước đang "pending" này chính là lượt của người đang xem — tái dùng nguyên
  // canKyBuoc/canPheDuyet đã có sẵn ở component cha, chỉ đổi phần hiển thị ở đây.
  isMyTurn?: boolean
  at?: string | null
  /** Số thứ tự hiện trong badge khi bước chưa ký (bước phê duyệt/soạn thảo không truyền). */
  stepNo?: number
  /**
   * Màu vai trò của bước — CÙNG màu với khung ký của bước đó trên PDF (modal ký) và trên màn cài
   * đặt vị trí, để người dùng nối được "dòng này trên timeline = khung màu kia trên văn bản".
   */
  accentColor?: string
  isLast?: boolean
}) {
  const accent = accentColor || "#94a3b8"
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
        title="Màu tương ứng khung ký trên văn bản"
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
