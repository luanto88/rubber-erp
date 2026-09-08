"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Image from "next/image"
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RotateCcw,
} from "lucide-react"
import { type Lang, HOME_STRINGS } from "@/lib/homepage-i18n"

export interface LightboxItem {
  id?: string
  src: string
  alt?: string
  title: string
  category?: string
  desc?: string
}

interface ImageLightboxProps {
  items: LightboxItem[]
  currentIndex: number | null
  onClose: () => void
  onNavigate: (newIndex: number) => void
  lang?: Lang
}

export function ImageLightbox({
  items,
  currentIndex,
  onClose,
  onNavigate,
  lang = "vi",
}: ImageLightboxProps) {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isFullscreen, setIsFullscreen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const lb = HOME_STRINGS.lightbox

  const isOpen = currentIndex !== null && currentIndex >= 0 && currentIndex < items.length
  const currentItem = isOpen ? items[currentIndex] : null

  // Reset zoom & pan when image changes
  const resetTransform = useCallback(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
    setRotation(0)
  }, [])

  useEffect(() => {
    resetTransform()
  }, [currentIndex, resetTransform])

  // Prevent background scroll when lightbox is open
  useEffect(() => {
    if (!isOpen) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen])

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.35, 4))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale((prev) => {
      const next = Math.max(prev - 0.35, 0.5)
      if (next <= 1) setPosition({ x: 0, y: 0 })
      return next
    })
  }, [])

  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360)
  }, [])

  const handleToggleZoom = useCallback(() => {
    setScale((prev) => {
      if (prev > 1) {
        setPosition({ x: 0, y: 0 })
        return 1
      }
      return 2
    })
  }, [])

  // Fullscreen toggle
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    } catch {
      // Fullscreen API may not be permitted in some contexts
    }
  }, [])

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener("fullscreenchange", handleFsChange)
    return () => document.removeEventListener("fullscreenchange", handleFsChange)
  }, [])

  // Navigation
  const handlePrev = useCallback(() => {
    if (currentIndex === null || items.length <= 1) return
    const nextIdx = (currentIndex - 1 + items.length) % items.length
    onNavigate(nextIdx)
  }, [currentIndex, items.length, onNavigate])

  const handleNext = useCallback(() => {
    if (currentIndex === null || items.length <= 1) return
    const nextIdx = (currentIndex + 1) % items.length
    onNavigate(nextIdx)
  }, [currentIndex, items.length, onNavigate])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        handlePrev()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        handleNext()
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault()
        handleZoomIn()
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault()
        handleZoomOut()
      } else if (e.key === "0") {
        e.preventDefault()
        resetTransform()
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault()
        handleRotate()
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault()
        toggleFullscreen()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    isOpen,
    onClose,
    handlePrev,
    handleNext,
    handleZoomIn,
    handleZoomOut,
    resetTransform,
    handleRotate,
    toggleFullscreen,
  ])

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (e.deltaY < 0) {
      handleZoomIn()
    } else {
      handleZoomOut()
    }
  }

  // Dragging / panning
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  if (!isOpen || !currentItem) return null

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950/95 backdrop-blur-xl text-white select-none animate-fadeIn"
      onWheel={handleWheel}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* ── Top Header Toolbar ── */}
      <div className="relative z-20 flex items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-slate-800/80 backdrop-blur-md">
        {/* Left: Info & Counter */}
        <div className="flex items-center gap-3 min-w-0 pr-2">
          {currentItem.category && (
            <span className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              {currentItem.category}
            </span>
          )}
          <h2 className="text-sm sm:text-base font-bold text-slate-100 truncate">
            {currentItem.title}
          </h2>
          {items.length > 1 && (
            <span className="shrink-0 text-xs font-medium text-slate-400 bg-slate-800 px-2.5 py-1 rounded-full border border-slate-700">
              {currentIndex + 1} / {items.length}
            </span>
          )}
        </div>

        {/* Right: Actions Toolbar */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-1 bg-slate-800/80 border border-slate-700/80 rounded-xl p-1">
            <button
              onClick={handleZoomIn}
              title={lb.zoomIn[lang]}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700/80 rounded-lg transition-colors cursor-pointer"
            >
              <ZoomIn size={18} />
            </button>
            <span className="text-[11px] font-mono font-medium text-slate-300 px-1 min-w-[42px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomOut}
              title={lb.zoomOut[lang]}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700/80 rounded-lg transition-colors cursor-pointer"
            >
              <ZoomOut size={18} />
            </button>
            <button
              onClick={resetTransform}
              title={lb.resetZoom[lang]}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700/80 rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw size={16} />
            </button>
          </div>

          <button
            onClick={handleRotate}
            title={lb.rotate[lang]}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <RotateCw size={18} />
          </button>

          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? lb.exitFullscreen[lang] : lb.fullscreen[lang]}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer hidden md:flex"
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>

          <a
            href={currentItem.src}
            target="_blank"
            rel="noreferrer"
            title={lb.openOriginal[lang]}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <ExternalLink size={18} />
          </a>

          <div className="w-px h-6 bg-slate-800 mx-1" />

          <button
            onClick={onClose}
            title={lb.close[lang]}
            className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white border border-red-500/20 rounded-xl transition-all duration-200 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* ── Main Canvas ── */}
      <div
        className="relative flex-1 flex items-center justify-center overflow-hidden p-2 sm:p-6"
        onClick={(e) => {
          // Close if clicking on background
          if (e.target === e.currentTarget) {
            onClose()
          }
        }}
      >
        {/* Previous Button */}
        {items.length > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handlePrev()
            }}
            title={lb.prev[lang]}
            className="absolute left-3 sm:left-6 z-20 p-3 sm:p-3.5 bg-slate-900/80 hover:bg-emerald-600 text-white border border-slate-700/80 hover:border-emerald-500 rounded-full shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {/* Next Button */}
        {items.length > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleNext()
            }}
            title={lb.next[lang]}
            className="absolute right-3 sm:right-6 z-20 p-3 sm:p-3.5 bg-slate-900/80 hover:bg-emerald-600 text-white border border-slate-700/80 hover:border-emerald-500 rounded-full shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer"
          >
            <ChevronRight size={24} />
          </button>
        )}

        {/* The Image */}
        <div
          className={`relative max-w-full max-h-full transition-transform duration-100 ease-out ${
            scale > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
          }`}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: "center center",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onDoubleClick={handleToggleZoom}
        >
          <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-slate-800/80 bg-white/5 backdrop-blur-sm">
            {/* Using standard img element for unrestricted natural size display in lightbox */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentItem.src}
              alt={currentItem.alt || currentItem.title}
              draggable={false}
              className="max-w-[90vw] max-h-[75vh] object-contain rounded-xl select-none"
            />
          </div>
        </div>
      </div>

      {/* ── Bottom Caption Bar ── */}
      {(currentItem.title || currentItem.desc) && (
        <div className="relative z-20 px-4 sm:px-8 py-3 bg-slate-900/90 border-t border-slate-800/80 backdrop-blur-md text-center max-w-4xl mx-auto rounded-t-2xl shadow-2xl mb-0 w-full">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4">
            <span className="text-sm sm:text-base font-bold text-white">
              {currentItem.title}
            </span>
            {currentItem.desc && (
              <>
                <span className="hidden sm:inline text-slate-500">•</span>
                <span className="text-xs sm:text-sm text-slate-300 leading-relaxed font-normal">
                  {currentItem.desc}
                </span>
              </>
            )}
          </div>
          <div className="mt-1 flex items-center justify-center gap-4 text-[11px] text-slate-400">
            <span>{lb.hintZoom[lang]}</span>
            <span>•</span>
            <span>{lb.hintNav[lang]}</span>
            <span>•</span>
            <span>{lb.hintClose[lang]}</span>
          </div>
        </div>
      )}
    </div>
  )
}
