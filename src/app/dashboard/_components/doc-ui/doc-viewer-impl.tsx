"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCcw,
} from "lucide-react"
import { fetchSecureUrl, openSecureFile } from "@/app/dashboard/_components/secure-file-open"

/**
 * Phần thân khung xem tài liệu (Doc-UI, GĐ3). CHỈ nạp qua `doc-viewer.tsx` (next/dynamic,
 * ssr:false) — file này import pdfjs-dist.
 *
 * - Lấy Signed URL bằng `fetchSecureUrl(endpoint)` rồi tải TRỌN file 1 lần (arrayBuffer) để
 *   URL hết hạn (TTL ~120s) không làm hỏng các trang render sau. URL hết hạn/không hợp lệ
 *   (400/401/403) → xin URL mới đúng 1 lần.
 * - Render dần từng trang bằng IntersectionObserver; đổi zoom thì hủy tác vụ render cũ.
 */
export type DocViewerKind = "pdf" | "office" | "none"
export type DocViewerVariant = { key: string; label: string }

export type DocViewerImplProps = {
  /** Route mint Signed URL (vd `/api/documents/{id}/file-url`). */
  endpoint: string
  kind: DocViewerKind
  /** Nhãn file trên thanh công cụ — KHÔNG lặp tên tài liệu (vd "Bản đã ký · PDF"). */
  label: string
  /** "docx" | "xlsx"... — chỉ để chọn icon ở thẻ dự phòng. */
  fileExt?: string
  variants?: DocViewerVariant[]
  variant?: string
  onVariantChange?: (key: string) => void
  heightClass?: string
}

type PageSize = { w: number; h: number }

const ZOOM_STEP = 0.15
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.5
const MAX_CANVAS_PX = 4096
const PAGE_GAP_PAD = 16

async function fetchPdfBytes(endpoint: string): Promise<ArrayBuffer> {
  let lastStatus = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetchSecureUrl(endpoint)
    if (!r.ok) throw new Error(r.error)
    const res = await fetch(r.url)
    if (res.ok) return await res.arrayBuffer()
    lastStatus = res.status
    // Supabase trả 400 khi token của Signed URL hết hạn — xin URL mới đúng 1 lần.
    if (attempt === 0 && (res.status === 400 || res.status === 401 || res.status === 403)) continue
    break
  }
  throw new Error(`Không tải được file (HTTP ${lastStatus})`)
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] bg-white/10 text-slate-200 transition-colors hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function PdfPage({
  pdf,
  pageNum,
  size,
  scale,
  root,
}: {
  pdf: PDFDocumentProxy
  pageNum: number
  size: PageSize
  scale: number
  root: HTMLElement | null
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const taskRef = useRef<RenderTask | null>(null)
  const [visible, setVisible] = useState(false)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || !root) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.isIntersecting)
      },
      { root, rootMargin: "600px 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setRendered(false)
    const run = async () => {
      const page = await pdf.getPage(pageNum)
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      let ratio = Math.min(window.devicePixelRatio || 1, 2)
      const longEdge = Math.max(size.w, size.h) * scale
      if (longEdge * ratio > MAX_CANVAS_PX) ratio = MAX_CANVAS_PX / longEdge
      const viewport = page.getViewport({ scale: scale * ratio })
      if (taskRef.current) {
        try { taskRef.current.cancel() } catch { /* đã xong */ }
        taskRef.current = null
      }
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext("2d")
      if (ctx) {
        // Canvas mặc định trong suốt — tô trắng để trang giấy không bị đen/xám.
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      const task = page.render({ canvas, viewport })
      taskRef.current = task
      try {
        await task.promise
        if (!cancelled) setRendered(true)
      } catch (err) {
        const name = (err as { name?: string } | null)?.name
        if (name !== "RenderingCancelledException") console.error("[DocViewer] render", err)
      } finally {
        if (taskRef.current === task) taskRef.current = null
      }
    }
    void run()
    return () => {
      cancelled = true
      if (taskRef.current) {
        try { taskRef.current.cancel() } catch { /* đã xong */ }
        taskRef.current = null
      }
    }
  }, [visible, pdf, pageNum, size.w, size.h, scale])

  return (
    <div
      ref={wrapRef}
      data-page={pageNum}
      className="relative mx-auto bg-white shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
      style={{ width: size.w * scale, height: size.h * scale }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" aria-label={`Trang ${pageNum}`} />
      {!rendered && (
        <div className="absolute inset-0 grid place-items-center text-[12px] text-slate-400">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
    </div>
  )
}

export default function DocViewerImpl({
  endpoint,
  kind,
  label,
  fileExt,
  variants,
  variant,
  onVariantChange,
  heightClass = "h-[70dvh] lg:h-[min(78vh,820px)]",
}: DocViewerImplProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [zoom, setZoom] = useState<number | "fit">("fit")
  const [fitScale, setFitScale] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [nativeFs, setNativeFs] = useState(false)
  const [overlayFs, setOverlayFs] = useState(false)
  const [officeError, setOfficeError] = useState<string | null>(null)

  // ── Nạp file ──
  useEffect(() => {
    if (kind !== "pdf") return
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    setStatus("loading")
    setError(null)
    setPdf(null)
    setSizes([])
    setCurrentPage(1)
    const run = async () => {
      try {
        const bytes = await fetchPdfBytes(endpoint)
        if (cancelled) return
        const pdfjsLib = await import("pdfjs-dist")
        if ((globalThis as Record<string, unknown>).pdfjsWorker) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = ""
        } else {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.mjs", import.meta.url
          ).toString()
        }
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise
        loaded = doc
        if (cancelled) { void doc.destroy(); return }
        const list: PageSize[] = []
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p)
          if (cancelled) return
          const vp = page.getViewport({ scale: 1 })
          list.push({ w: vp.width, h: vp.height })
        }
        if (cancelled) return
        setSizes(list)
        setPdf(doc)
        setStatus("ready")
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Không mở được tài liệu")
        setStatus("error")
      }
    }
    void run()
    return () => {
      cancelled = true
      if (loaded) void loaded.destroy()
    }
  }, [endpoint, kind, reloadNonce])

  // ── Tỉ lệ "vừa bề ngang" ──
  const maxPageW = useMemo(() => sizes.reduce((m, s) => Math.max(m, s.w), 0), [sizes])
  useEffect(() => {
    if (!scrollEl || !maxPageW) return
    const update = () => {
      const avail = scrollEl.clientWidth - PAGE_GAP_PAD * 2
      if (avail > 0) setFitScale(Math.min(ZOOM_MAX, Math.max(0.25, avail / maxPageW)))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(scrollEl)
    return () => ro.disconnect()
  }, [scrollEl, maxPageW])

  const scale = zoom === "fit" ? fitScale : zoom
  const changeZoom = (delta: number) =>
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((scale + delta) * 100) / 100)))

  // ── Trang hiện tại: trang có phần hiện lớn nhất ──
  useEffect(() => {
    if (!scrollEl || !pdf) return
    const ratios = new Map<number, number>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page)
          ratios.set(n, e.isIntersecting ? e.intersectionRatio : 0)
        }
        let best = 0
        let bestRatio = 0
        ratios.forEach((r, n) => {
          if (r > bestRatio) { bestRatio = r; best = n }
        })
        if (best) setCurrentPage(best)
      },
      { root: scrollEl, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    )
    scrollEl.querySelectorAll("[data-page]").forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [scrollEl, pdf, sizes, scale])

  const goToPage = useCallback(
    (n: number) => {
      if (!scrollEl) return
      const target = scrollEl.querySelector(`[data-page="${n}"]`)
      if (target) (target as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" })
    },
    [scrollEl],
  )

  // ── Toàn màn hình ──
  useEffect(() => {
    const onChange = () => setNativeFs(document.fullscreenElement === frameRef.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  useEffect(() => {
    if (!overlayFs) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOverlayFs(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [overlayFs])

  const isFullscreen = nativeFs || overlayFs
  const toggleFullscreen = async () => {
    if (nativeFs) { await document.exitFullscreen().catch(() => {}); return }
    if (overlayFs) { setOverlayFs(false); return }
    const el = frameRef.current
    if (el && typeof el.requestFullscreen === "function" && document.fullscreenEnabled) {
      try { await el.requestFullscreen(); return } catch { /* rơi về lớp phủ */ }
    }
    setOverlayFs(true)
  }

  const numPages = sizes.length
  const hasVariants = !!variants && variants.length > 1

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/10 bg-[#0f172a] px-3 py-2 text-white sm:px-4">
      <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
        {kind === "office" && /xls/i.test(fileExt || "") ? (
          <FileSpreadsheet size={16} className="shrink-0 text-emerald-300" />
        ) : (
          <FileText size={16} className="shrink-0 text-slate-300" />
        )}
        <span className="truncate">{label}</span>
      </div>
      {kind === "pdf" && (
        <div className="flex items-center gap-1 sm:gap-1.5">
          <ToolButton label="Thu nhỏ" onClick={() => changeZoom(-ZOOM_STEP)} disabled={status !== "ready" || scale <= ZOOM_MIN}>
            <Minus size={13} />
          </ToolButton>
          <button
            type="button"
            onClick={() => setZoom("fit")}
            title="Vừa bề ngang"
            className="hidden min-w-[46px] px-1 text-center font-code text-[12px] text-slate-300 hover:text-white sm:block"
          >
            {Math.round(scale * 100)}%
          </button>
          <ToolButton label="Phóng to" onClick={() => changeZoom(ZOOM_STEP)} disabled={status !== "ready" || scale >= ZOOM_MAX}>
            <Plus size={13} />
          </ToolButton>
          <span className="px-0.5 text-slate-500 sm:px-1" aria-hidden="true">|</span>
          <ToolButton label="Trang trước" onClick={() => goToPage(currentPage - 1)} disabled={status !== "ready" || currentPage <= 1}>
            <ChevronLeft size={14} />
          </ToolButton>
          <span className="whitespace-nowrap px-1 font-code text-[12px] text-slate-300">
            {status === "ready" ? `Trang ${currentPage}/${numPages}` : "Trang –/–"}
          </span>
          <ToolButton label="Trang sau" onClick={() => goToPage(currentPage + 1)} disabled={status !== "ready" || currentPage >= numPages}>
            <ChevronRight size={14} />
          </ToolButton>
          <span className="px-0.5 text-slate-500 sm:px-1" aria-hidden="true">|</span>
          <ToolButton label={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"} onClick={() => void toggleFullscreen()}>
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </ToolButton>
        </div>
      )}
      {hasVariants && (
        <div className="flex w-full gap-1 overflow-x-auto" role="tablist" aria-label="Chọn file để xem">
          {variants!.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={v.key === variant}
              onClick={() => onVariantChange?.(v.key)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                v.key === variant ? "bg-white text-slate-900" : "bg-white/10 text-slate-200 hover:bg-white/20"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  let body: React.ReactNode
  if (kind === "office") {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-700 p-6 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-white">
          {/xls/i.test(fileExt || "") ? <FileSpreadsheet size={26} /> : <FileText size={26} />}
        </div>
        <p className="max-w-sm text-[13px] text-slate-200">
          Không xem trước được file Word/Excel trong trang. Mở file để xem nội dung.
        </p>
        <button
          type="button"
          onClick={async () => {
            setOfficeError(null)
            const r = await openSecureFile(endpoint)
            if (!r.ok) setOfficeError(r.error)
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-4 text-[13px] font-bold text-slate-900 hover:bg-slate-100"
        >
          <ExternalLink size={14} /> Mở file
        </button>
        {officeError && <p className="text-[12px] text-rose-300">{officeError}</p>}
      </div>
    )
  } else if (status === "error") {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-700 p-6 text-center">
        <AlertTriangle size={24} className="text-amber-300" />
        <p className="max-w-sm text-[13px] text-slate-200">{error || "Không mở được tài liệu"}</p>
        <button
          type="button"
          onClick={() => setReloadNonce((n) => n + 1)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-4 text-[13px] font-bold text-slate-900 hover:bg-slate-100"
        >
          <RefreshCcw size={14} /> Thử lại
        </button>
      </div>
    )
  } else {
    body = (
      <div ref={setScrollEl} className="flex-1 overflow-auto bg-slate-700 py-4" style={{ paddingInline: PAGE_GAP_PAD }}>
        {status === "loading" || !pdf ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[12.5px] text-slate-300">
            <Loader2 size={20} className="animate-spin" />
            Đang tải tài liệu...
          </div>
        ) : (
          <div className="flex w-max min-w-full flex-col items-center gap-4">
            {sizes.map((s, i) => (
              <PdfPage key={i + 1} pdf={pdf} pageNum={i + 1} size={s} scale={scale} root={scrollEl} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={frameRef}
      className={`flex flex-col overflow-hidden border border-slate-700 bg-slate-800 shadow-sm ${
        overlayFs
          ? "fixed inset-0 z-[60] rounded-none"
          : nativeFs
            ? "h-full rounded-none"
            : `${heightClass} rounded-[14px]`
      }`}
    >
      {toolbar}
      {body}
    </div>
  )
}
