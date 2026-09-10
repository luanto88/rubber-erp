"use client"

import { Fragment, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Draggable from "react-draggable"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileCheck,
  FileText,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  X,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"
import {
  SIGN_AS_LABEL,
  type IsoDocument,
  type SignAsType,
  type SignFileKind,
  type SignPlacement,
  type SignedFilePlacement,
} from "./iso-types"

function toTitleCase(str: string | null | undefined): string {
  if (!str) return ""
  return str
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (char) => char.toUpperCase())
}

// Màu sắc nhận diện vai trò
const ROLE_THEMES = {
  xem_xet: {
    name: "Người xem xét",
    actionLabel: "Ký xem xét & Gửi phê duyệt",
    headerBg: "linear-gradient(135deg, #b45309, #78350f)",
    accentFg: "#d97706",
    accentBg: "rgba(217,119,6,0.14)",
    badgeBg: "bg-amber-100 text-amber-800 border-amber-300",
  },
  phe_duyet: {
    name: "Người phê duyệt",
    actionLabel: "Phê duyệt & Ban hành",
    headerBg: "linear-gradient(135deg, #047857, #064e3b)",
    accentFg: "#059669",
    accentBg: "rgba(5,150,105,0.14)",
    badgeBg: "bg-emerald-100 text-emerald-800 border-emerald-300",
  },
}

export type BatchBox = {
  id: string
  page: number
  xPct: number
  yPct: number
  wPct: number
  hPct: number
  showName: boolean
  showChucVu: boolean
  chucVuKey?: "chinh_quyen" | "kiem_nhiem" | string | null
  signAs?: SignAsType
  sigInnerX?: number
  sigInnerY?: number
  sigInnerW?: number
  sigInnerH?: number
  nameInnerX?: number
  nameInnerY?: number
  nameInnerW?: number
  nameInnerH?: number
  cvInnerX?: number
  cvInnerY?: number
  cvInnerW?: number
  cvInnerH?: number
  boxDomW?: number
  boxDomH?: number
}

function BatchInteractiveSignBox({
  box,
  isSelected,
  theme,
  boxesOnPageCount,
  boxIndex,
  sigImgUrl,
  signerName,
  signerChucVu,
  signerChucVuByKey,
  isPheDuyet,
  onSelect,
  onUpdate,
}: {
  box: BatchBox
  isSelected: boolean
  theme: (typeof ROLE_THEMES)[keyof typeof ROLE_THEMES]
  boxesOnPageCount: number
  boxIndex: number
  sigImgUrl: string | null
  signerName: string
  signerChucVu: string
  signerChucVuByKey?: { chinh_quyen: string; kiem_nhiem: string }
  isPheDuyet: boolean
  onSelect: () => void
  onUpdate: (updates: Partial<BatchBox>) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const sigNodeRef = useRef<HTMLDivElement>(null)
  const nameNodeRef = useRef<HTMLDivElement>(null)
  const cvNodeRef = useRef<HTMLDivElement>(null)

  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  useEffect(() => {
    if (!boxRef.current) return
    const el = boxRef.current
    const updateSize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0) {
        setBoxSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
        if (box.boxDomW !== w || box.boxDomH !== h) {
          onUpdate({ boxDomW: w, boxDomH: h })
        }
      }
    }
    updateSize()
    const ro = new ResizeObserver(() => updateSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [box.boxDomW, box.boxDomH, onUpdate])

  const bw = boxSize.w || box.boxDomW || 150
  const bh = boxSize.h || box.boxDomH || 75

  const sigInnerW = Math.min(bw, Math.max(30, box.sigInnerW || Math.min(bw - 8, 100)))
  const sigInnerH = Math.min(bh, Math.max(15, box.sigInnerH || Math.min(bh * 0.55, 42)))
  const sigInnerX = Math.max(0, Math.min(bw - sigInnerW, box.sigInnerX ?? Math.max(0, (bw - sigInnerW) / 2)))
  const sigInnerY = Math.max(0, Math.min(bh - sigInnerH, box.sigInnerY ?? 4))

  const nameInnerW = Math.min(bw, Math.max(30, box.nameInnerW || Math.min(bw - 8, 105)))
  const nameInnerH = Math.min(bh, Math.max(12, box.nameInnerH || 20))
  const nameInnerX = Math.max(0, Math.min(bw - nameInnerW, box.nameInnerX ?? Math.max(0, (bw - nameInnerW) / 2)))
  const nameInnerY = Math.max(0, Math.min(bh - nameInnerH, box.nameInnerY ?? Math.max(4, bh - (box.showChucVu ? 42 : 22))))

  const cvInnerW = Math.min(bw, Math.max(30, box.cvInnerW || Math.min(bw - 8, 105)))
  const cvInnerH = Math.min(bh, Math.max(12, box.cvInnerH || 18))
  const cvInnerX = Math.max(0, Math.min(bw - cvInnerW, box.cvInnerX ?? Math.max(0, (bw - cvInnerW) / 2)))
  const cvInnerY = Math.max(0, Math.min(bh - cvInnerH, box.cvInnerY ?? Math.max(18, bh - 20)))

  const effectiveCvText =
    (box.chucVuKey === "kiem_nhiem" ? signerChucVuByKey?.kiem_nhiem : signerChucVuByKey?.chinh_quyen) ||
    signerChucVu ||
    (isPheDuyet ? "Người phê duyệt" : "Người xem xét")

  return (
    <div
      ref={boxRef}
      onClick={onSelect}
      className={`absolute rounded-md select-none transition-shadow ${
        isSelected ? "ring-2 ring-amber-400/80 shadow-md" : "hover:ring-1 hover:ring-amber-300/60 shadow-xs"
      }`}
      style={{
        left: `${box.xPct}%`,
        top: `${box.yPct}%`,
        width: `${box.wPct}%`,
        height: `${box.hPct}%`,
        border: `2px dashed ${theme.accentFg}`,
        backgroundColor: "rgba(245, 158, 11, 0.05)",
        zIndex: isSelected ? 30 : 20,
      }}
    >
      <div
        className="absolute -top-5 left-0 flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs whitespace-nowrap bg-white/95 pointer-events-none"
        style={{ color: theme.accentFg }}
      >
        <Lock size={10} className="text-emerald-600" />
        Khung của bạn {boxesOnPageCount > 1 ? `#${boxIndex + 1}` : ""}
      </div>

      <Draggable
        nodeRef={sigNodeRef as RefObject<HTMLElement>}
        position={{ x: sigInnerX, y: sigInnerY }}
        bounds="parent"
        cancel=".resize-handle"
        onStop={(_, d) => onUpdate({ sigInnerX: d.x, sigInnerY: d.y, boxDomW: bw, boxDomH: bh })}
      >
        <div
          ref={sigNodeRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: sigInnerW,
            height: sigInnerH,
            cursor: "move",
            userSelect: "none",
          }}
          className="relative group border border-dashed border-amber-400/80 bg-amber-50/30 rounded p-1 flex items-center justify-center hover:border-amber-600 touch-none"
        >
          {sigImgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sigImgUrl}
              alt="Chữ ký"
              className="w-full h-full object-contain pointer-events-none"
              draggable={false}
            />
          ) : (
            <span className="text-[10px] font-bold text-amber-700 italic text-center px-1">
              [Chữ ký {signerName}]
            </span>
          )}

          <div
            className="resize-handle absolute -bottom-2 -right-2 w-7 h-7 sm:w-5 sm:h-5 bg-amber-600 hover:bg-amber-700 text-white rounded-full flex items-center justify-center shadow-md cursor-nwse-resize z-20 hover:scale-110 transition-transform touch-none"
            title="Kéo để co giãn kích thước chữ ký trong khung"
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              const startX = e.clientX
              const startY = e.clientY
              const startW = sigInnerW
              const startH = sigInnerH
              const curX = sigInnerX
              const curY = sigInnerY

              const onMove = (ev: PointerEvent) => {
                const dx = ev.clientX - startX
                const dy = ev.clientY - startY
                const newW = Math.max(30, Math.min(bw - curX, startW + dx))
                const newH = Math.max(15, Math.min(bh - curY, startH + dy))
                onUpdate({ sigInnerW: newW, sigInnerH: newH, boxDomW: bw, boxDomH: bh })
              }
              const onUp = () => {
                window.removeEventListener("pointermove", onMove)
                window.removeEventListener("pointerup", onUp)
              }
              window.addEventListener("pointermove", onMove)
              window.addEventListener("pointerup", onUp)
            }}
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 sm:w-2.5 sm:h-2.5" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 3 3 3 3 9" />
              <polyline points="15 21 21 21 21 15" />
              <line x1="3" y1="3" x2="10" y2="10" />
              <line x1="21" y1="21" x2="14" y2="14" />
            </svg>
          </div>
        </div>
      </Draggable>

      <Draggable
        nodeRef={nameNodeRef as RefObject<HTMLElement>}
        position={{ x: nameInnerX, y: nameInnerY }}
        bounds="parent"
        onStop={(_, d) => onUpdate({ nameInnerX: d.x, nameInnerY: d.y, boxDomW: bw, boxDomH: bh })}
      >
        <div
          ref={nameNodeRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: nameInnerW,
            height: nameInnerH,
            cursor: "move",
            userSelect: "none",
            fontFamily: "'Times New Roman', Times, serif",
          }}
          className={`border py-0.5 rounded pl-1.5 pr-6 select-none shadow-xs text-center leading-none font-normal flex items-center justify-center relative transition-all touch-none ${
            box.showName
              ? "border-sky-400 bg-sky-50/95 text-sky-950 text-xs hover:border-sky-600"
              : "border-dashed border-slate-300 bg-slate-100/85 text-slate-400 text-xs opacity-60"
          }`}
          title={box.showName ? "Kéo để di chuyển vị trí tên trong khung" : "Tên đang ẩn — Bấm icon mắt để hiện lại"}
        >
          <span className={`truncate w-full ${box.showName ? "" : "line-through"}`}>
            {toTitleCase(signerName || "Người ký")}
          </span>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onUpdate({ showName: !box.showName })
            }}
            className={`absolute -top-1 -right-1 p-2 rounded-full flex items-center justify-center transition-colors z-20 touch-manipulation hover:bg-black/5 ${
              box.showName ? "text-sky-600 hover:text-sky-900" : "text-slate-400 hover:text-slate-700"
            }`}
            title={box.showName ? "Ẩn họ tên" : "Hiện lại họ tên"}
          >
            {box.showName ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </div>
      </Draggable>

      <Draggable
        nodeRef={cvNodeRef as RefObject<HTMLElement>}
        position={{ x: cvInnerX, y: cvInnerY }}
        bounds="parent"
        onStop={(_, d) => onUpdate({ cvInnerX: d.x, cvInnerY: d.y, boxDomW: bw, boxDomH: bh })}
      >
        <div
          ref={cvNodeRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: cvInnerW,
            height: cvInnerH,
            cursor: "move",
            userSelect: "none",
            fontFamily: "'Times New Roman', Times, serif",
          }}
          className={`border py-0.5 rounded pl-1.5 pr-6 select-none shadow-xs text-center leading-none font-normal flex items-center justify-center relative transition-all touch-none ${
            box.showChucVu
              ? "border-violet-400 bg-violet-50/95 text-violet-950 text-xs hover:border-violet-600"
              : "border-dashed border-slate-300 bg-slate-100/85 text-slate-400 text-xs opacity-60"
          }`}
          title={box.showChucVu ? "Kéo để di chuyển vị trí chức vụ trong khung" : "Chức vụ đang ẩn — Bấm icon mắt để hiện lại"}
        >
          <span className={`truncate w-full ${box.showChucVu ? "" : "line-through"}`}>
            {effectiveCvText}
          </span>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onUpdate({ showChucVu: !box.showChucVu })
            }}
            className={`absolute -top-1 -right-1 p-2 rounded-full flex items-center justify-center transition-colors z-20 touch-manipulation hover:bg-black/5 ${
              box.showChucVu ? "text-violet-600 hover:text-violet-900" : "text-slate-400 hover:text-slate-700"
            }`}
            title={box.showChucVu ? "Ẩn chức vụ" : "Hiện lại chức vụ"}
          >
            {box.showChucVu ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </div>
      </Draggable>
    </div>
  )
}

export type BatchSignDoc = {
  docId: string
  kind: SignFileKind
  label: string
  code: string
  typeCode: string
  url: string
  isParent: boolean
  numPages: number
  pageDims: Record<number, { w: number; h: number }>
  pageThumbs: Record<number, string>
  boxes: BatchBox[]
  requiresSign: boolean
}


type PreviewSig = {
  signerUserId: string
  signerName: string
  page: number
  x: number
  y: number
  width: number
  height: number
  nameX?: number
  nameY?: number
  nameWidth?: number
  nameHeight?: number
}

interface IsoBatchSignModalProps {
  open: boolean
  onClose: () => void
  doc: IsoDocument
  childDocs: IsoDocument[]
  action: "gui_phe_duyet" | "phe_duyet" | "gui_lai_phe_duyet"
  factoryId: string
  currentUser: SessionUser
  initialSignAs?: SignAsType
  onTransitionSuccess: (
    completedPlacements: SignedFilePlacement[],
    token: string,
    signAs: SignAsType,
  ) => Promise<void>
}

export function IsoBatchSignModal({
  open,
  onClose,
  doc,
  childDocs,
  action,
  factoryId,
  currentUser,
  initialSignAs = "none",
  onTransitionSuccess,
}: IsoBatchSignModalProps) {
  const isPheDuyet = action === "phe_duyet"
  const currentRole = isPheDuyet ? "phe_duyet" : "xem_xet"
  const theme = isPheDuyet ? ROLE_THEMES.phe_duyet : ROLE_THEMES.xem_xet

  // Danh sách tài liệu trong bộ
  const [docItems, setDocItems] = useState<BatchSignDoc[]>([])
  const [activeDocIndex, setActiveDocIndex] = useState(0)
  const [activePage, setActivePage] = useState(1)
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null)

  // Loading & Trạng thái tải PDF
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [signAs, setSignAs] = useState<SignAsType>(initialSignAs)

  // Ảnh chữ ký cá nhân của người dùng
  const [sigImgUrl, setSigImgUrl] = useState<string | null>(null)

  // Thông tin Tên thật & Chức vụ thật của người ký
  const [signerName, setSignerName] = useState(currentUser.full_name || currentUser.username || "Người ký")
  const [signerChucVu, setSignerChucVu] = useState("")
  const [signerChucVuByKey, setSignerChucVuByKey] = useState<{ chinh_quyen: string; kiem_nhiem: string }>({ chinh_quyen: "", kiem_nhiem: "" })

  // Drawer danh sách tài liệu/trang trên mobile (< 768px)
  const [showMobileDocsDrawer, setShowMobileDocsDrawer] = useState(false)

  // Canvas render
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const pdfDocsCache = useRef<Record<string, unknown>>({})
  const [canvasDims, setCanvasDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  // Modal PIN
  const [showPinModal, setShowPinModal] = useState(false)
  const [pin, setPin] = useState("")
  const [pinError, setPinError] = useState("")
  const [pinLoading, setPinLoading] = useState(false)
  const [signingProgress, setSigningProgress] = useState<{ current: number; total: number; title: string } | null>(null)

  const activeDoc = docItems[activeDocIndex] || null

  // Tra cứu URL ảnh chữ ký cá nhân của người dùng
  useEffect(() => {
    if (!factoryId || !currentUser?.id) return
    const sigPath = `signatures/${factoryId}/${currentUser.id}/chu_ky.png`
    const { data } = supabase.storage.from("iso-documents").getPublicUrl(sigPath)
    if (data?.publicUrl) {
      setSigImgUrl(data.publicUrl)
    }
  }, [factoryId, currentUser?.id])

  // Tra cứu Tên thật & Chức vụ thật của người đang đăng nhập
  useEffect(() => {
    if (!factoryId || !currentUser?.id) return
    let cancelled = false
    const fetchSignerInfo = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData.session?.access_token
        if (!token) return
        const res = await fetch(
          `/api/documents/signer-info?factoryId=${encodeURIComponent(factoryId)}&userIds=${encodeURIComponent(currentUser.id)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (!res.ok) return
        const rows = (await res.json()) as Array<{
          id: string
          full_name: string
          chuc_vu: string
          chuc_vu_chinh_quyen?: string
          chuc_vu_kim_nhiem?: string
          chuc_vu_by_key?: { chinh_quyen: string; kiem_nhiem: string }
        }>
        const info = rows.find((r) => r.id === currentUser.id)
        if (info && !cancelled) {
          if (info.full_name) setSignerName(info.full_name)
          if (info.chuc_vu) setSignerChucVu(info.chuc_vu)
          if (info.chuc_vu_by_key) {
            setSignerChucVuByKey(info.chuc_vu_by_key)
          } else {
            setSignerChucVuByKey({
              chinh_quyen: info.chuc_vu_chinh_quyen || info.chuc_vu || "",
              kiem_nhiem: info.chuc_vu_kim_nhiem || "",
            })
          }
        }
      } catch {
        // bỏ qua nếu lỗi mạng
      }
    }
    void fetchSignerInfo()
    return () => {
      cancelled = true
    }
  }, [factoryId, currentUser?.id])

  // Helper kiểm tra URL có phải PDF
  const isPdfUrl = (url: string | null | undefined): boolean => {
    if (!url) return false
    const clean = url.split("?")[0].toLowerCase()
    return clean.endsWith(".pdf")
  }

  // 1. Tải danh sách tài liệu và áp dụng mẫu vị trí từ `mau_vi_tri`
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const initBatch = async () => {
      setLoading(true)
      setError("")

      try {
        const rawDocs: Array<{
          docId: string
          kind: SignFileKind
          label: string
          code: string
          typeCode: string
          url: string
          isParent: boolean
        }> = []

        // File chính Quy trình cha
        const parentPdf = doc.file_signed_pdf_url || doc.file_goc_url
        if (isPdfUrl(parentPdf)) {
          rawDocs.push({
            docId: doc.id,
            kind: "main",
            label: `Quy trình chính · ${doc.ma_tai_lieu || "Tài liệu cha"}`,
            code: doc.ma_tai_lieu || "",
            typeCode: doc.loai_tai_lieu || "QT",
            url: parentPdf!,
            isParent: true,
          })
        }

        // File phụ soát xét nếu có
        if (doc.chon_quy_trinh === "Soát xét") {
          const changeUrl = doc.file_phieu_yeu_cau_thay_doi_signed_url || doc.file_phieu_yeu_cau_thay_doi_url
          if (isPdfUrl(changeUrl)) {
            rawDocs.push({
              docId: doc.id,
              kind: "change_request",
              label: "Phiếu yêu cầu thay đổi",
              code: `${doc.ma_tai_lieu || ""}-PYC`,
              typeCode: "PYC",
              url: changeUrl!,
              isParent: false,
            })
          }
          const reviewUrl = doc.file_de_nghi_soat_xet_signed_url || doc.file_de_nghi_soat_xet_url || doc.file_soat_xet_url
          if (isPdfUrl(reviewUrl)) {
            rawDocs.push({
              docId: doc.id,
              kind: "review_request",
              label: "Đề nghị soát xét",
              code: `${doc.ma_tai_lieu || ""}-DNSX`,
              typeCode: "DNSX",
              url: reviewUrl!,
              isParent: false,
            })
          }
        }

        // Toàn bộ Biểu mẫu con PDF
        for (const child of childDocs) {
          const childPdf = child.file_signed_pdf_url || child.file_goc_url
          if (isPdfUrl(childPdf)) {
            rawDocs.push({
              docId: child.id,
              kind: "main",
              label: `${child.ma_tai_lieu || child.ten_tai_lieu || "Biểu mẫu"}`,
              code: child.ma_tai_lieu || "",
              typeCode: child.loai_tai_lieu || "F",
              url: childPdf!,
              isParent: false,
            })
          }
        }

        if (rawDocs.length === 0) {
          setError("Không tìm thấy file PDF nào trong bộ hồ sơ để ký duyệt.")
          setLoading(false)
          return
        }

        // Tải toàn bộ mẫu vị trí liên quan từ bảng `mau_vi_tri`
        const tmplKeysToQuery = new Set<string>()
        rawDocs.forEach((d) => {
          if (d.code) tmplKeysToQuery.add(`iso:code:${d.code}`)
          if (d.typeCode) tmplKeysToQuery.add(`iso:loai:${d.typeCode}`)
        })

        const { data: tmplRows } = await supabase
          .from("mau_vi_tri")
          .select("*")
          .eq("factory_id", factoryId)
          .in("loai_tai_lieu", Array.from(tmplKeysToQuery))
          .order("phien_ban", { ascending: false })

        // Map template theo key mới nhất
        const tmplMap: Record<string, { khung: Array<Record<string, unknown>> }> = {}
        ;(tmplRows || []).forEach((row) => {
          if (!tmplMap[row.loai_tai_lieu]) {
            tmplMap[row.loai_tai_lieu] = row
          }
        })

        // Nạp pdfjs để đọc số trang & khổ giấy
        const pdfjsLib = await import("pdfjs-dist")
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.mjs",
            import.meta.url,
          ).toString()
        }

        const initializedDocs: BatchSignDoc[] = []

        for (const rDoc of rawDocs) {
          let numPages = 1
          const dims: Record<number, { w: number; h: number }> = {}

          try {
            const pdf = await pdfjsLib.getDocument({
              url: rDoc.url,
              cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.449/cmaps/",
              cMapPacked: true,
            }).promise
            pdfDocsCache.current[rDoc.url] = pdf
            numPages = pdf.numPages

            for (let p = 1; p <= numPages; p++) {
              const page = await pdf.getPage(p)
              const vp = page.getViewport({ scale: 1 })
              dims[p] = { w: vp.width, h: vp.height }
            }
          } catch (e) {
            console.warn("Không load được metadata PDF của " + rDoc.label, e)
            dims[1] = { w: 595.28, h: 841.89 }
          }

          // Đối chiếu template: ưu tiên iso:code:..., fallback iso:loai:...
          const tmpl = tmplMap[`iso:code:${rDoc.code}`] || tmplMap[`iso:loai:${rDoc.typeCode}`]
          const matchingBoxes: BatchBox[] = []

          if (tmpl && Array.isArray(tmpl.khung)) {
            tmpl.khung.forEach((k, idx) => {
              if (k.vai_tro === currentRole) {
                const pageNum = Math.min(Math.max(Number(k.so_trang) || 1, 1), numPages)
                const pageDim = dims[pageNum] || { w: 595.28, h: 841.89 }
                const xPt = Number(k.x_pt) || 100
                const yPt = Number(k.y_pt) || 100
                const wPt = Number(k.w_pt) || 120
                const hPt = Number(k.h_pt) || 60

                matchingBoxes.push({
                  id: `box-${rDoc.docId}-${idx}-${Date.now()}`,
                  page: pageNum,
                  xPct: (xPt / pageDim.w) * 100,
                  yPct: ((pageDim.h - yPt - hPt) / pageDim.h) * 100,
                  wPct: (wPt / pageDim.w) * 100,
                  hPct: (hPt / pageDim.h) * 100,
                  showName: !!k.show_name,
                  showChucVu: !!k.show_chuc_vu,
                  chucVuKey: (k.chuc_vu_key as "chinh_quyen" | "kiem_nhiem") || "chinh_quyen",
                  signAs: (k.sign_as as SignAsType) || "none",
                })
              }
            })
          }

          // Nếu là Quy trình chính mà chưa có khung trong template, tự động tạo 1 khung mặc định ở trang 1
          if (rDoc.isParent && matchingBoxes.length === 0) {
            matchingBoxes.push({
              id: `box-parent-default-${Date.now()}`,
              page: 1,
              xPct: isPheDuyet ? 66 : 37,
              yPct: 74,
              wPct: 26,
              hPct: 14,
              showName: false,
              showChucVu: false,
              signAs: initialSignAs,
            })
          }

          // Xác định tài liệu này có yêu cầu ký hay không
          // Tài liệu cha luôn requiresSign. Tài liệu con chỉ requiresSign khi có khung của người này trong template!
          const requiresSign = rDoc.isParent || matchingBoxes.length > 0

          initializedDocs.push({
            ...rDoc,
            numPages,
            pageDims: dims,
            pageThumbs: {},
            boxes: matchingBoxes,
            requiresSign,
          })
        }

        if (cancelled) return
        setDocItems(initializedDocs)
        setActiveDocIndex(0)
        setActivePage(1)
        if (initializedDocs[0]?.boxes[0]) {
          setSelectedBoxId(initializedDocs[0].boxes[0].id)
        }
        setLoading(false)

        // Render thumbnails ngầm không làm đơ giao diện
        void generateThumbnails(initializedDocs)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Không tải được bộ hồ sơ ISO")
          setLoading(false)
        }
      }
    }

    void initBatch()

    return () => {
      cancelled = true
    }
  }, [open, doc, childDocs, action, factoryId, isPheDuyet, currentRole, initialSignAs])

  // 2. Render ảnh Thumbnail thu nhỏ cho các trang
  const generateThumbnails = async (docs: BatchSignDoc[]) => {
    try {
      const pdfjsLib = await import("pdfjs-dist")

      for (let dIdx = 0; dIdx < docs.length; dIdx++) {
        const item = docs[dIdx]
        let pdf = pdfDocsCache.current[item.url] as { getPage: (p: number) => Promise<unknown> } | null
        if (!pdf) {
          pdf = await pdfjsLib.getDocument({
            url: item.url,
            cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.449/cmaps/",
            cMapPacked: true,
          }).promise
          pdfDocsCache.current[item.url] = pdf
        }

        const thumbMap: Record<number, string> = {}
        for (let p = 1; p <= item.numPages; p++) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const page: any = await pdf.getPage(p)
            const vp1 = page.getViewport({ scale: 1 })
            const thumbW = 120
            const scale = thumbW / (vp1.width || thumbW)
            const vp = page.getViewport({ scale })

            const canvas = document.createElement("canvas")
            canvas.width = Math.floor(vp.width)
            canvas.height = Math.floor(vp.height)
            const ctx = canvas.getContext("2d")
            if (ctx) {
              await page.render({ canvasContext: ctx, viewport: vp }).promise
              thumbMap[p] = canvas.toDataURL("image/webp", 0.7)
            }
          } catch (e) {
            console.warn(`Render thumb p${p} failed for ${item.label}`, e)
          }
        }

        setDocItems((prev) =>
          prev.map((d, idx) => (idx === dIdx ? { ...d, pageThumbs: { ...d.pageThumbs, ...thumbMap } } : d)),
        )
      }
    } catch (e) {
      console.warn("Lỗi render thumbnails:", e)
    }
  }

  // 3. Render trang PDF chính trên Canvas trung tâm
  const renderCurrentPage = useCallback(async () => {
    if (!activeDoc || !canvasRef.current) return
    const canvas = canvasRef.current

    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel()
      } catch {}
      renderTaskRef.current = null
    }

    try {
      const pdfjsLib = await import("pdfjs-dist")
      let pdf = pdfDocsCache.current[activeDoc.url] as { getPage: (p: number) => Promise<unknown> } | null
      if (!pdf) {
        pdf = await pdfjsLib.getDocument({
          url: activeDoc.url,
          cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.449/cmaps/",
          cMapPacked: true,
        }).promise
        pdfDocsCache.current[activeDoc.url] = pdf
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page: any = await pdf.getPage(activePage)
      // Render độ nét cao: scale = 1.35
      const renderScale = 1.35
      const vp = page.getViewport({ scale: renderScale })

      const w = Math.floor(vp.width)
      const h = Math.floor(vp.height)
      canvas.width = w
      canvas.height = h
      setCanvasDims({ w, h })

      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const task = page.render({ canvasContext: ctx, viewport: vp })
        renderTaskRef.current = task
        await task.promise
      }
    } catch (e: unknown) {
      if (e && typeof e === "object" && "name" in e && (e as { name: string }).name === "RenderingCancelledException") {
        return
      }
      console.error("Lỗi render PDF trang chính:", e)
    }
  }, [activeDoc, activePage])

  useEffect(() => {
    void renderCurrentPage()
  }, [renderCurrentPage])

  // Chuyển trang hoặc chuyển tài liệu
  const handleSelectDoc = (index: number, page = 1) => {
    setActiveDocIndex(index)
    setActivePage(page)
    const targetDoc = docItems[index]
    const boxOnPage = targetDoc?.boxes.find((b) => b.page === page) || targetDoc?.boxes[0]
    if (boxOnPage) {
      setSelectedBoxId(boxOnPage.id)
    }
  }

  // Khung tiếp theo
  const handleNextFrame = () => {
    // Tìm khung ký tiếp theo sau vị trí hiện tại
    for (let d = 0; d < docItems.length; d++) {
      const item = docItems[d]
      if (!item.requiresSign) continue

      for (const box of item.boxes) {
        if (d > activeDocIndex || (d === activeDocIndex && box.page > activePage)) {
          handleSelectDoc(d, box.page)
          setSelectedBoxId(box.id)
          return
        }
      }
    }
    // Nếu hết, quay lại khung đầu tiên
    for (let d = 0; d < docItems.length; d++) {
      const item = docItems[d]
      if (item.requiresSign && item.boxes.length > 0) {
        handleSelectDoc(d, item.boxes[0].page)
        setSelectedBoxId(item.boxes[0].id)
        return
      }
    }
  }


  // Cập nhật cấu hình khung (Hiện tên / Hiện chức vụ / Tiền tố)
  const updateBoxConfig = (boxId: string, updates: Partial<BatchBox>) => {
    setDocItems((prev) =>
      prev.map((d, idx) =>
        idx === activeDocIndex
          ? {
              ...d,
              boxes: d.boxes.map((b) => (b.id === boxId ? { ...b, ...updates } : b)),
            }
          : d,
      ),
    )
  }

  // 4. KIỂM TRA ĐIỀU KIỆN KÝ & QUY TẮC CHẶN LƯU
  const validationResult = useMemo(() => {
    if (docItems.length === 0) return { valid: false, reason: "Không có tài liệu nào" }

    const parent = docItems.find((d) => d.isParent)
    if (!parent || parent.boxes.length === 0) {
      return { valid: false, reason: "Quy trình chính chưa được đặt vị trí chữ ký" }
    }

    const childRequired = docItems.filter((d) => !d.isParent && d.requiresSign)

    // QUY TẮC LINH HOẠT CHO LÃNH ĐẠO:
    // Nếu trong toàn bộ các biểu mẫu con KHÔNG có khung ký nào của người này,
    // người duyệt ký xong Quy trình chính là được phép hoàn tất ngay mà không bắt lướt qua 18 biểu mẫu con!
    if (childRequired.length === 0) {
      return { valid: true, count: parent.boxes.length, flexibleMode: true }
    }

    // QUY TẮC RÀNG BUỘC KHI CÓ KHUNG Ở BIỂU MẪU CON:
    // Bắt buộc tất cả các biểu mẫu con cần ký phải có đủ khung!
    const missingDocs = childRequired.filter((d) => d.boxes.length === 0)
    if (missingDocs.length > 0) {
      return {
        valid: false,
        reason: `Còn thiếu vị trí ký tại các biểu mẫu con: ${missingDocs.map((d) => d.label).join(", ")}`,
        missingDocs,
      }
    }

    const totalBoxes = docItems.reduce((sum, d) => sum + (d.requiresSign ? d.boxes.length : 0), 0)
    return { valid: true, count: totalBoxes, flexibleMode: false }
  }, [docItems])

  // 5. Thao tác Ký & Hoàn tất
  const handleStartSign = () => {
    if (!validationResult.valid) {
      return
    }
    setPin("")
    setPinError("")
    setShowPinModal(true)
  }

  // Xác thực PIN và Ký hàng loạt
  const handlePinConfirm = async () => {
    if (!pin || pin.length < 4) {
      setPinError("Vui lòng nhập đầy đủ mã PIN")
      return
    }

    setPinLoading(true)
    setPinError("")

    try {
      // Lấy session token xác thực
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        setPinError("Phiên đăng nhập đã hết hạn, vui lòng tải lại trang")
        setPinLoading(false)
        return
      }

      // Xác minh PIN tại endpoint chuẩn /api/sign/verify
      const verifyRes = await fetch("/api/sign/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId: currentUser.id,
          pin,
          docId: doc.id,
          docType: "iso",
        }),
      })

      const verifyJson = await verifyRes.json()
      if (!verifyRes.ok || !verifyJson.ok || !verifyJson.token) {
        setPinError(verifyJson.error || "Mã PIN không chính xác")
        setPinLoading(false)
        return
      }

      const token = verifyJson.token as string

      // Thu thập các file cần ký
      const docsToSign = docItems.filter((d) => d.requiresSign && d.boxes.length > 0)
      const completedPlacements: SignedFilePlacement[] = []

      // Chạy vòng lặp ký từng file
      for (let i = 0; i < docsToSign.length; i++) {
        const item = docsToSign[i]
        setSigningProgress({
          current: i + 1,
          total: docsToSign.length,
          title: item.label,
        })

        const mainBox = item.boxes[0]
        const cloneBoxes = item.boxes.slice(1)
        const dim = item.pageDims[mainBox.page] || { w: 595.28, h: 841.89 }

        const calcBoxPlacement = (b: BatchBox, pDim: { w: number; h: number }) => {
          const bwPt = (b.wPct / 100) * pDim.w
          const bhPt = (b.hPct / 100) * pDim.h
          const bxPt = (b.xPct / 100) * pDim.w
          const byPtBottom = pDim.h - (b.yPct / 100) * pDim.h - bhPt

          const bDomW = b.boxDomW || 150
          const bDomH = b.boxDomH || 75

          const sInnerW = b.sigInnerW || Math.min(bDomW - 8, 100)
          const sInnerH = b.sigInnerH || Math.min(bDomH * 0.55, 42)
          const sInnerX = b.sigInnerX ?? Math.max(0, (bDomW - sInnerW) / 2)
          const sInnerY = b.sigInnerY ?? 4

          const sW_pt = Math.min(bwPt, Math.max(20, (sInnerW / bDomW) * bwPt))
          const sH_pt = Math.min(bhPt, Math.max(10, (sInnerH / bDomH) * bhPt))
          const sX_pt = bxPt + Math.max(0, Math.min(bwPt - sW_pt, (sInnerX / bDomW) * bwPt))
          const sY_pt = byPtBottom + Math.max(0, Math.min(bhPt - sH_pt, (1 - (sInnerY + sInnerH) / bDomH) * bhPt))

          // Tên
          const nInnerW = b.nameInnerW || Math.min(bDomW - 8, 105)
          const nInnerH = b.nameInnerH || 20
          const nInnerX = b.nameInnerX ?? Math.max(0, (bDomW - nInnerW) / 2)
          const nInnerY = b.nameInnerY ?? Math.max(4, bDomH - (b.showChucVu ? 42 : 22))

          const nW_pt = Math.min(bwPt, Math.max(20, (nInnerW / bDomW) * bwPt))
          const nH_pt = Math.min(bhPt, Math.max(10, (nInnerH / bDomH) * bhPt))
          const nX_pt = bxPt + Math.max(0, Math.min(bwPt - nW_pt, (nInnerX / bDomW) * bwPt))
          const nY_pt = byPtBottom + Math.max(0, Math.min(bhPt - nH_pt, (1 - (nInnerY + nInnerH) / bDomH) * bhPt + 2))

          // Chức vụ
          let cvX_pt: number | undefined
          let cvY_pt: number | undefined
          let cvW_pt: number | undefined
          let cvH_pt: number | undefined

          if (b.showChucVu) {
            const cvInnerW = b.cvInnerW || Math.min(bDomW - 8, 105)
            const cvInnerH = b.cvInnerH || 18
            const cvInnerX = b.cvInnerX ?? Math.max(0, (bDomW - cvInnerW) / 2)
            const cvInnerY = b.cvInnerY ?? Math.max(18, bDomH - 20)

            cvW_pt = Math.min(bwPt, Math.max(20, (cvInnerW / bDomW) * bwPt))
            cvH_pt = Math.min(bhPt, Math.max(10, (cvInnerH / bDomH) * bhPt))
            cvX_pt = bxPt + Math.max(0, Math.min(bwPt - cvW_pt, (cvInnerX / bDomW) * bwPt))
            // Tính toạ độ Y độc lập theo vị trí kéo thả thực tế của Chức vụ, đảm bảo dù Chức vụ ở trên hay ở dưới Tên đều in chuẩn xác
            cvY_pt = byPtBottom + Math.max(0, Math.min(bhPt - cvH_pt, (1 - (cvInnerY + cvInnerH) / bDomH) * bhPt + 2))
          }

          return {
            x: sX_pt,
            y: sY_pt,
            width: sW_pt,
            height: sH_pt,
            nameX: nX_pt,
            nameY: nY_pt,
            nameWidth: nW_pt,
            nameHeight: nH_pt,
            chucVuX: cvX_pt,
            chucVuY: cvY_pt,
            chucVuWidth: cvW_pt,
            chucVuHeight: cvH_pt,
          }
        }

        const mainPl = calcBoxPlacement(mainBox, dim)
        const mainCvText = (mainBox.chucVuKey === "kiem_nhiem" ? signerChucVuByKey.kiem_nhiem : signerChucVuByKey.chinh_quyen) || signerChucVu

        const placement: SignPlacement = {
          page: mainBox.page,
          x: mainPl.x,
          y: mainPl.y,
          width: mainPl.width,
          height: mainPl.height,
          showSignature: true,
          showSignerName: mainBox.showName,
          nameX: mainPl.nameX,
          nameY: mainPl.nameY,
          nameWidth: mainPl.nameWidth,
          nameHeight: mainPl.nameHeight,
          showChucVu: mainBox.showChucVu,
          chucVuText: mainCvText,
          chucVuKey: mainBox.chucVuKey || "chinh_quyen",
          chucVuX: mainPl.chucVuX,
          chucVuY: mainPl.chucVuY,
          chucVuWidth: mainPl.chucVuWidth,
          chucVuHeight: mainPl.chucVuHeight,
          showPrefix: isPheDuyet && (mainBox.signAs || signAs) !== "none",
          prefixX: Math.max(0, mainPl.x - 40),
          prefixY: mainPl.y + 10,
          prefixWidth: 35,
          prefixHeight: 20,
          extraPlacements:
            cloneBoxes.length > 0
              ? cloneBoxes.map((c) => {
                  const cDim = item.pageDims[c.page] || dim
                  const cPl = calcBoxPlacement(c, cDim)
                  const cCvText = (c.chucVuKey === "kiem_nhiem" ? signerChucVuByKey.kiem_nhiem : signerChucVuByKey.chinh_quyen) || signerChucVu
                  return {
                    page: c.page,
                    x: cPl.x,
                    y: cPl.y,
                    width: cPl.width,
                    height: cPl.height,
                    showSignature: true,
                    showSignerName: c.showName,
                    nameX: cPl.nameX,
                    nameY: cPl.nameY,
                    nameWidth: cPl.nameWidth,
                    nameHeight: cPl.nameHeight,
                    showChucVu: c.showChucVu,
                    chucVuText: cCvText,
                    chucVuKey: c.chucVuKey || "chinh_quyen",
                    chucVuX: cPl.chucVuX,
                    chucVuY: cPl.chucVuY,
                    chucVuWidth: cPl.chucVuWidth,
                    chucVuHeight: cPl.chucVuHeight,
                  }
                })
              : undefined,
        }

        completedPlacements.push({
          docId: item.docId,
          kind: item.kind,
          placement,
        })
      }

      // Đóng modal PIN và gọi callback chuyển trạng thái hoàn tất
      setShowPinModal(false)
      await onTransitionSuccess(completedPlacements, token, signAs)
      onClose()
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Đã xảy ra lỗi trong quá trình ký số")
    } finally {
      setPinLoading(false)
      setSigningProgress(null)
    }
  }

  // Danh sách chữ ký bước trước cần xem trước
  const previewSignatures = useMemo(() => {
    if (!doc || !activeDoc) return [] as PreviewSig[]
    const list: PreviewSig[] = []

    const nameMap: Record<string, string> = {}
    if (doc.soan_thao_user_id) nameMap[doc.soan_thao_user_id] = doc.soan_thao || "Người soạn thảo"
    if (doc.xem_xet_user_id) nameMap[doc.xem_xet_user_id] = doc.xem_xet || "Người xem xét"

    if (doc.ky_soan_thao_at && doc.soan_thao_placement && activeDoc.isParent) {
      const p = doc.soan_thao_placement
      list.push({
        signerUserId: doc.soan_thao_user_id || "",
        signerName: nameMap[doc.soan_thao_user_id || ""] || "Người soạn thảo",
        page: p.page || 1,
        x: p.x || 100,
        y: p.y || 100,
        width: p.width || 120,
        height: p.height || 60,
        nameX: p.nameX,
        nameY: p.nameY,
      })
    }

    if (isPheDuyet && doc.ky_xem_xet_at && doc.xem_xet_placement && activeDoc.isParent) {
      const p = doc.xem_xet_placement
      list.push({
        signerUserId: doc.xem_xet_user_id || "",
        signerName: nameMap[doc.xem_xet_user_id || ""] || "Người xem xét",
        page: p.page || 1,
        x: p.x || 250,
        y: p.y || 100,
        width: p.width || 120,
        height: p.height || 60,
        nameX: p.nameX,
        nameY: p.nameY,
      })
    }

    return list
  }, [doc, activeDoc, isPheDuyet])

  const defaultCanvasW = (activeDoc?.pageDims[activePage]?.w || 595.28) * 1.35
  const defaultCanvasH = (activeDoc?.pageDims[activePage]?.h || 841.89) * 1.35
  const currentCanvasW = canvasDims.w > 0 ? canvasDims.w : defaultCanvasW
  const currentCanvasH = canvasDims.h > 0 ? canvasDims.h : defaultCanvasH

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/90 backdrop-blur-xs select-none">
      {/* ── TOP HEADER ── */}
      <div
        className="flex h-13 sm:h-14 shrink-0 items-center justify-between px-3 sm:px-5 text-white shadow-md border-b border-white/10"
        style={{ background: theme.headerBg }}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 backdrop-blur-xs font-black text-xs sm:text-sm">
            ISO
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-bold text-xs sm:text-sm truncate">Ký duyệt</span>
              <span className={`rounded-full px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-[11px] font-bold shrink-0 ${theme.badgeBg}`}>
                {theme.name}
              </span>
              {doc.cap_tl && (
                <span className="hidden sm:inline rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold shrink-0">
                  {doc.cap_tl}
                </span>
              )}
            </div>
            <div className="text-[10px] sm:text-[11px] text-white/80 line-clamp-1 max-w-[150px] sm:max-w-md">
              {doc.ma_tai_lieu} · {doc.ten_tai_lieu}
            </div>
          </div>
        </div>

        {/* Action bên phải Header */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {isPheDuyet && (
            <div className="flex items-center gap-1 text-[11px] sm:text-xs bg-black/20 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-white/10">
              <span className="hidden sm:inline text-white/80">Ký thay:</span>
              <select
                value={signAs}
                onChange={(e) => setSignAs(e.target.value as SignAsType)}
                className="bg-transparent text-white font-bold outline-hidden cursor-pointer text-[11px] sm:text-xs"
              >
                <option value="none" className="bg-slate-800 text-white">Trực tiếp</option>
                <option value="KT" className="bg-slate-800 text-white">{SIGN_AS_LABEL.KT}</option>
                <option value="TM" className="bg-slate-800 text-white">{SIGN_AS_LABEL.TM}</option>
                <option value="TL" className="bg-slate-800 text-white">{SIGN_AS_LABEL.TL}</option>
                <option value="TUQ" className="bg-slate-800 text-white">{SIGN_AS_LABEL.TUQ}</option>
              </select>
            </div>
          )}

          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/20 text-white/90 transition-all"
            title="Đóng màn hình ký"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="flex flex-1 overflow-hidden bg-slate-100">
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 size={32} className="animate-spin text-emerald-600" />
            <p className="text-sm font-semibold">Đang tải bộ hồ sơ và tự động nạp mẫu vị trí...</p>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <AlertTriangle size={36} className="text-red-500" />
            <p className="text-base font-bold text-slate-800">{error}</p>
            <button
              onClick={onClose}
              className="mt-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700"
            >
              Quay lại
            </button>
          </div>
        ) : (
          <>
            {/* ── LEFT THUMBNAIL RAIL (Ẩn trên Mobile để nhường 100% không gian cho PDF) ── */}
            <div className="hidden md:flex w-28 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2 space-y-3 select-none flex-col">
              <div className="text-[10px] uppercase font-bold text-slate-400 text-center tracking-wider mb-0.5">
                {docItems.length} tài liệu
              </div>

              {docItems.map((item, dIdx) => {
                const isItemActive = dIdx === activeDocIndex
                const hasBoxes = item.boxes.length > 0

                return (
                  <div
                    key={item.docId + item.kind}
                    className={`rounded-lg border p-1.5 transition-all ${
                      isItemActive
                        ? "border-amber-400 bg-amber-50/40 shadow-xs"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    {/* Header tài liệu gọn gàng */}
                    <button
                      type="button"
                      onClick={() => handleSelectDoc(dIdx, 1)}
                      className="w-full text-left mb-1.5 focus:outline-hidden cursor-pointer"
                      title={item.label}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-[10px] text-slate-800 truncate block" title={item.code || item.label}>
                          {item.code || (item.isParent ? "Quy trình" : "Biểu mẫu")}
                        </span>
                        {item.requiresSign && hasBoxes && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Sẵn sàng ký" />
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-slate-400">
                        <span>{item.numPages} trang</span>
                        {item.requiresSign ? (
                          <span className="font-semibold text-amber-600">✍</span>
                        ) : (
                          <span className="text-slate-400">Đọc</span>
                        )}
                      </div>
                    </button>

                    {/* Danh sách Thumbnail 1 cột chuẩn màn Soạn thảo */}
                    <div className="flex flex-col gap-2">
                      {Array.from({ length: item.numPages }, (_, i) => i + 1).map((p) => {
                        const isPageSelected = isItemActive && p === activePage
                        const boxesOnPage = item.boxes.filter((b) => b.page === p)
                        const hasRequiredBox = boxesOnPage.length > 0

                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => handleSelectDoc(dIdx, p)}
                            className={`group relative w-full overflow-hidden rounded-md border-2 text-center transition-all bg-white p-0.5 flex flex-col items-center shadow-2xs cursor-pointer ${
                              isPageSelected
                                ? "border-amber-500 shadow-sm ring-2 ring-amber-200"
                                : hasRequiredBox
                                  ? "border-amber-300 hover:border-amber-400"
                                  : "border-slate-200 hover:border-slate-300"
                            }`}
                          >
                            {item.pageThumbs[p] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={item.pageThumbs[p]}
                                alt={`Trang ${p}`}
                                className="w-full h-auto object-contain rounded-xs block select-none pointer-events-none"
                              />
                            ) : (
                              <div className="w-full aspect-[1/1.4] bg-slate-50 rounded-xs flex items-center justify-center text-[10px] font-bold text-slate-400">
                                {p}
                              </div>
                            )}

                            {/* Huy hiệu ký ở góc trên */}
                            {hasRequiredBox && (
                              <div className="absolute -top-1 -right-1 flex gap-0.5 z-10 pointer-events-none">
                                <span className="bg-amber-500 text-white rounded-full px-1 py-0.2 text-[8px] font-bold shadow-xs">
                                  ✍
                                </span>
                              </div>
                            )}

                            <span className={`text-[10px] font-bold mt-0.5 ${isPageSelected ? "text-amber-700" : "text-slate-500"}`}>
                              Trang {p}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── CENTER CANVAS PREVIEW ── */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Thanh điều hướng trang bên trên Canvas */}
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-5 text-xs text-slate-600">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setShowMobileDocsDrawer(true)}
                    className="md:hidden flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-bold text-[11px] shrink-0"
                    title="Mở danh sách tài liệu và trang"
                  >
                    <Layers size={13} /> {activeDoc?.code || "Tài liệu"} ({activePage}/{activeDoc?.numPages || 1})
                  </button>
                  <span className="hidden md:inline font-bold text-slate-800 truncate">{activeDoc?.label}</span>
                  <span className="hidden md:inline text-slate-400">·</span>
                  <span className="hidden md:inline shrink-0">
                    Trang {activePage} / {activeDoc?.numPages || 1}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleNextFrame}
                    className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-all mr-0.5 sm:mr-1"
                    title="Chuyển đến khung ký tiếp theo"
                  >
                    <ArrowRight size={13} /> <span className="hidden sm:inline">Khung tiếp</span>
                  </button>
                  <button
                    onClick={() => setActivePage((p) => Math.max(1, p - 1))}
                    disabled={activePage <= 1}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => setActivePage((p) => Math.min(activeDoc?.numPages || 1, p + 1))}
                    disabled={activePage >= (activeDoc?.numPages || 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              {/* Khu vực hiển thị trang tài liệu & Khung chữ ký chuẩn màn Soạn thảo */}
              <div className="relative flex-1 overflow-auto bg-slate-200/70 p-2 sm:p-4 flex items-start justify-center">
                <div
                  className="relative inline-block rounded-lg bg-white shadow-2xl my-auto select-none"
                  style={{
                    width: currentCanvasW,
                    height: currentCanvasH,
                  }}
                >
                  <canvas ref={canvasRef} className="block rounded-lg pointer-events-none" />

                  {/* Lớp preview chữ ký các bước trước */}
                  {previewSignatures
                    .filter((sig) => sig.page === activePage)
                    .map((sig, sIdx) => {
                      const dim = activeDoc?.pageDims[activePage] || { w: 595.28, h: 841.89 }
                      const leftPct = (sig.x / dim.w) * 100
                      const topPct = ((dim.h - sig.y - sig.height) / dim.h) * 100
                      const widthPct = (sig.width / dim.w) * 100
                      const heightPct = (sig.height / dim.h) * 100

                      return (
                        <div
                          key={`prev-sig-${sIdx}`}
                          className="absolute pointer-events-none rounded border border-blue-400 bg-blue-50/60 p-1 flex flex-col justify-between"
                          style={{
                            left: `${leftPct}%`,
                            top: `${topPct}%`,
                            width: `${widthPct}%`,
                            height: `${heightPct}%`,
                          }}
                        >
                          <div className="text-[9px] font-bold text-blue-700 truncate">
                            ✓ {sig.signerName}
                          </div>
                          <div className="text-[8px] text-blue-600/70 italic text-right">
                            Đã ký
                          </div>
                        </div>
                      )
                    })}

                  {/* Khung chữ ký tương tác chuẩn của người duyệt (cố định theo mẫu, chữ ký & tên & chức vụ di chuyển độc lập) */}
                  {activeDoc?.boxes
                    .filter((b) => b.page === activePage)
                    .map((box, bIdx) => {
                      const isSelected = box.id === selectedBoxId
                      const boxesOnPage = activeDoc.boxes.filter((b) => b.page === activePage)

                      return (
                        <BatchInteractiveSignBox
                          key={box.id}
                          box={box}
                          isSelected={isSelected}
                          theme={theme}
                          boxesOnPageCount={boxesOnPage.length}
                          boxIndex={bIdx}
                          sigImgUrl={sigImgUrl}
                          signerName={signerName}
                          signerChucVu={signerChucVu}
                          signerChucVuByKey={signerChucVuByKey}
                          isPheDuyet={isPheDuyet}
                          onSelect={() => setSelectedBoxId(box.id)}
                          onUpdate={(updates) => updateBoxConfig(box.id, updates)}
                        />
                      )
                    })}
                </div>
              </div>
            </div>


          </>
        )}
      </div>

      {/* ── BOTTOM ACTION FOOTER ── */}
      <div className="flex flex-col sm:flex-row min-h-[56px] sm:h-16 shrink-0 sm:items-center justify-between border-t border-slate-200 bg-white px-3 sm:px-6 py-2 sm:py-0 shadow-xs gap-2">
        <div className="flex items-center justify-between sm:justify-start gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 font-bold text-slate-800 text-[11px] sm:text-xs">
            <FileCheck size={15} className="text-emerald-600 shrink-0" />
            <span className="hidden sm:inline">Bộ hồ sơ:</span> {docItems.length} tài liệu ({docItems.reduce((acc, d) => acc + d.numPages, 0)} tr)
          </div>
          <span className="text-slate-300">|</span>
          <div className="text-[11px] sm:text-xs">
            <span className="hidden sm:inline">Số vị trí ký: </span>
            <span className="font-extrabold text-amber-700">
              {docItems.reduce((sum, d) => sum + (d.requiresSign ? d.boxes.length : 0), 0)} vị trí
            </span>
          </div>
          {!validationResult.valid && (
            <div className="flex items-center gap-1 text-red-600 font-semibold text-[11px] sm:text-xs ml-1 sm:ml-3">
              <AlertTriangle size={13} className="shrink-0" />
              <span className="truncate max-w-[120px] sm:max-w-none">{validationResult.reason}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all"
          >
            Hủy
          </button>

          <button
            type="button"
            onClick={handleStartSign}
            disabled={!validationResult.valid || loading}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 rounded-xl px-4 sm:px-5 py-2 sm:py-2.5 text-xs font-extrabold text-white shadow-md transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: theme.headerBg }}
          >
            <CheckCircle2 size={15} /> {theme.actionLabel}
          </button>
        </div>
      </div>

      {/* ── MOBILE DOCS & PAGES DRAWER ── */}
      {showMobileDocsDrawer && (
        <div className="fixed inset-0 z-60 flex flex-col justify-end bg-black/60 backdrop-blur-xs md:hidden animate-in fade-in">
          <div className="bg-white rounded-t-2xl max-h-[75vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between p-3.5 border-b border-slate-200">
              <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
                <Layers size={16} className="text-amber-600" />
                Danh sách tài liệu & trang ({docItems.length})
              </div>
              <button
                type="button"
                onClick={() => setShowMobileDocsDrawer(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-3 space-y-3 flex-1">
              {docItems.map((item, dIdx) => {
                const isItemActive = dIdx === activeDocIndex
                const hasBoxes = item.boxes.length > 0
                return (
                  <div
                    key={item.docId + item.kind}
                    className={`rounded-xl border p-2.5 transition-all ${
                      isItemActive ? "border-amber-400 bg-amber-50/40" : "border-slate-200 bg-slate-50/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="font-bold text-xs text-slate-800 truncate">
                        {item.code ? `${item.code} · ` : ""}{item.label}
                      </div>
                      {item.requiresSign && hasBoxes && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 shrink-0">
                          ✓ Có vị trí ký
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {Array.from({ length: item.numPages }, (_, i) => i + 1).map((p) => {
                        const isPageSelected = isItemActive && p === activePage
                        const hasRequiredBox = item.boxes.some((b) => b.page === p)
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => {
                              handleSelectDoc(dIdx, p)
                              setShowMobileDocsDrawer(false)
                            }}
                            className={`relative rounded-lg border-2 p-1 flex flex-col items-center bg-white text-center transition-all ${
                              isPageSelected
                                ? "border-amber-500 ring-2 ring-amber-200"
                                : hasRequiredBox
                                  ? "border-amber-300"
                                  : "border-slate-200"
                            }`}
                          >
                            {item.pageThumbs[p] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.pageThumbs[p]} alt={`Trang ${p}`} className="w-full aspect-[1/1.4] object-contain rounded-xs" />
                            ) : (
                              <div className="w-full aspect-[1/1.4] bg-slate-100 rounded-xs flex items-center justify-center text-[10px] text-slate-400 font-bold">
                                {p}
                              </div>
                            )}
                            {hasRequiredBox && (
                              <span className="absolute -top-1 -right-1 bg-amber-500 text-white rounded-full px-1 text-[8px] font-bold">
                                ✍
                              </span>
                            )}
                            <span className={`text-[10px] font-bold mt-1 ${isPageSelected ? "text-amber-700" : "text-slate-600"}`}>
                              Trang {p}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL NHẬP MÃ PIN 1 LẦN ── */}
      {showPinModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 font-extrabold text-slate-800 text-sm">
                <KeyRound size={18} className="text-emerald-600" />
                Xác thực mã PIN ký số
              </div>
              <button
                onClick={() => !pinLoading && setShowPinModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              Nhập mã PIN cá nhân 6 số của bạn để ký số hàng loạt cho toàn bộ các tài liệu trong bộ hồ sơ này.
            </p>

            <div className="mb-4">
              <input
                type="password"
                maxLength={6}
                autoFocus
                disabled={pinLoading}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value)
                  setPinError("")
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handlePinConfirm()
                }}
                placeholder="Nhập mã PIN (6 số)"
                className="w-full text-center tracking-widest text-lg font-mono rounded-xl border border-slate-300 p-2.5 font-bold text-slate-800 outline-hidden focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
              {pinError && <p className="mt-1.5 text-xs text-red-600 font-semibold">{pinError}</p>}
            </div>

            {signingProgress && (
              <div className="mb-4 rounded-xl bg-slate-50 p-3 border border-slate-200 text-center">
                <Loader2 size={18} className="animate-spin text-emerald-600 mx-auto mb-1.5" />
                <p className="text-xs font-bold text-slate-700">
                  Đang ký số file ({signingProgress.current}/{signingProgress.total})
                </p>
                <p className="text-[10px] text-slate-400 truncate">{signingProgress.title}</p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={pinLoading}
                onClick={() => setShowPinModal(false)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={pinLoading || pin.length < 4}
                onClick={() => void handlePinConfirm()}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {pinLoading ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                Xác nhận ký
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
