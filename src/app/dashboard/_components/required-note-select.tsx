"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, Plus, Search, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { createRequiredNote, loadRequiredNotes, type RequiredNote } from "@/lib/required-notes"

type RequiredNoteSelectProps = {
  factoryId: string | null
  value: string
  onChange: (value: string) => void
  allowEmpty?: boolean
  emptyLabel?: string
  placeholder?: string
  showQuickAdd?: boolean
  disabled?: boolean
  className?: string
  onError?: (message: string) => void
}

// Dropdown chọn Ký hiệu kỹ thuật (RequiredNoteSelect) — chỉ cho chọn từ danh mục required_notes
// (Cài đặt → Danh mục → Ký hiệu kỹ thuật), không cho gõ tự do các sự cố vận hành vào đây.
export function RequiredNoteSelect({
  factoryId,
  value,
  onChange,
  allowEmpty = true,
  emptyLabel = "Không có ký hiệu KT",
  placeholder = "-- Chọn ký hiệu KT --",
  showQuickAdd = true,
  disabled = false,
  className = "",
  onError,
}: RequiredNoteSelectProps) {
  const [notes, setNotes] = useState<RequiredNote[]>([])
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [isMobile, setIsMobile] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 280, maxHeight: 280, openUp: false })
  const [adding, setAdding] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!factoryId) { setNotes([]); return }
    let alive = true
    loadRequiredNotes(supabase, factoryId)
      .then((rows) => { if (alive) setNotes(rows) })
      .catch(() => { if (alive) setNotes([]) })
    return () => { alive = false }
  }, [factoryId])

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  const updatePosition = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return }
    const viewportPadding = 12
    const preferredWidth = Math.max(rect.width, 260)
    const width = Math.min(preferredWidth, Math.max(220, window.innerWidth - viewportPadding * 2))
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
    const spaceAbove = rect.top - viewportPadding
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
    const availableHeight = Math.max(180, (openUp ? spaceAbove : spaceBelow) - 8)
    const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding)
    setPos({
      top: openUp ? rect.top - availableHeight - 8 : rect.bottom + 8,
      left,
      width,
      maxHeight: availableHeight,
      openUp,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setOpen(false); setSearch("")
      }
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setSearch("") } }
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKeyDown)
    const t = window.setTimeout(() => searchRef.current?.focus(), 20)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKeyDown)
      window.clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open || isMobile) return
    const onViewportChange = () => {
      if (rafRef.current !== null) return
      rafRef.current = window.requestAnimationFrame(() => { rafRef.current = null; updatePosition() })
    }
    onViewportChange()
    window.addEventListener("resize", onViewportChange)
    window.addEventListener("scroll", onViewportChange, true)
    return () => {
      window.removeEventListener("resize", onViewportChange)
      window.removeEventListener("scroll", onViewportChange, true)
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    }
  }, [open, isMobile, updatePosition])

  const options = useMemo(() => notes.map((r) => r.content), [notes])
  const noteByContent = useMemo(() => {
    const map = new Map<string, RequiredNote>()
    for (const n of notes) map.set(n.content.toLowerCase(), n)
    return map
  }, [notes])

  const trimmedValue = value.trim()
  const isLegacyValue = trimmedValue.length > 0 && !options.some((o) => o.toLowerCase() === trimmedValue.toLowerCase())
  const displayOptions = useMemo(
    () => (isLegacyValue ? [trimmedValue, ...options] : options),
    [options, isLegacyValue, trimmedValue],
  )
  const filtered = displayOptions.filter((o) => {
    const s = search.trim().toLowerCase()
    if (!s) return true
    if (o.toLowerCase().includes(s)) return true
    const note = noteByContent.get(o.toLowerCase())
    return note?.mo_ta?.toLowerCase().includes(s) ?? false
  })

  // Hiển thị label kèm mô tả nếu có
  const matchedNote = noteByContent.get(trimmedValue.toLowerCase())
  const currentLabel = trimmedValue
    ? (matchedNote?.mo_ta ? `${trimmedValue} (${matchedNote.mo_ta})` : trimmedValue)
    : placeholder

  const handleQuickAdd = async () => {
    if (!factoryId) return
    const input = window.prompt("Nhập mã ký hiệu kỹ thuật mới (VD: T, Tr, TM, GCTBK, TL...)")
    if (!input || !input.trim()) return
    const moTa = window.prompt(`Nhập mô tả / ý nghĩa cho ký hiệu "${input.trim()}" (tùy chọn, VD: Mủ thêm)`) ?? undefined
    setAdding(true)
    try {
      const row = await createRequiredNote(supabase, factoryId, input, moTa)
      setNotes((prev) => (prev.some((p) => p.content.toLowerCase() === row.content.toLowerCase()) ? prev : [...prev, row]))
      onChange(row.content)
      setOpen(false)
      setSearch("")
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Không thêm được ký hiệu kỹ thuật")
    } finally {
      setAdding(false)
    }
  }

  const closeAndReset = () => { setOpen(false); setSearch("") }

  const panelBody = (
    <>
      <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 p-2">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2">
          <Search size={14} className="shrink-0 text-slate-400" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm ký hiệu..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
      </div>
      <div className="overflow-y-auto p-1.5" style={isMobile ? undefined : { maxHeight: pos.maxHeight }}>
        {allowEmpty && (
          <button
            type="button"
            onClick={() => { onChange(""); closeAndReset() }}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 ${
              trimmedValue === "" ? "bg-emerald-50 font-semibold text-emerald-700" : "italic text-slate-500"
            }`}
          >
            {emptyLabel}
          </button>
        )}
        {filtered.length === 0 ? (
          <p className="py-5 text-center text-xs text-slate-400">Không tìm thấy ký hiệu phù hợp</p>
        ) : (
          filtered.map((option) => {
            const selected = option.toLowerCase() === trimmedValue.toLowerCase()
            const isLegacyOption = isLegacyValue && option === trimmedValue
            const noteObj = noteByContent.get(option.toLowerCase())
            return (
              <button
                key={option}
                type="button"
                onClick={() => { onChange(option); closeAndReset() }}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-emerald-50 ${
                  selected ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-700"
                }`}
              >
                <div className="min-w-0 flex-1 flex items-center gap-2">
                  <span className="font-medium text-slate-800">{option}</span>
                  {noteObj?.mo_ta && (
                    <span className="text-xs text-slate-500 font-normal truncate">
                      — {noteObj.mo_ta}
                    </span>
                  )}
                </div>
                {isLegacyOption && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                    giá trị cũ
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
      {showQuickAdd && (
        <div className="shrink-0 border-t border-slate-100 p-2">
          <button
            type="button"
            onClick={handleQuickAdd}
            disabled={adding || !factoryId}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
          >
            <Plus size={13} />
            {adding ? "Đang thêm..." : "Thêm ký hiệu mới"}
          </button>
        </div>
      )}
    </>
  )

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!open) updatePosition()
          setOpen((v) => !v)
          if (open) setSearch("")
        }}
        className={`flex items-center justify-between gap-2 bg-white text-left disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${trimmedValue ? "" : "italic text-slate-400"}`}>{currentLabel}</span>
        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        isMobile ? (
          <>
            <div className="fixed inset-0 z-[9998] bg-black/40" onClick={closeAndReset} />
            <div
              ref={panelRef}
              className="fixed inset-x-0 bottom-0 z-[9999] flex max-h-[75dvh] flex-col rounded-t-2xl border border-slate-200 bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.25)]"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="text-sm font-bold text-slate-700">Chọn ký hiệu kỹ thuật</span>
                <button type="button" onClick={closeAndReset} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Đóng">
                  <X size={18} />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{panelBody}</div>
            </div>
          </>
        ) : (
          <div
            ref={panelRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, width: pos.width }}
            className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
          >
            {panelBody}
          </div>
        ),
        document.body,
      )}
    </div>
  )
}
