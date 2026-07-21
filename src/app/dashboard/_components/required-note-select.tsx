"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, Plus, Search, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { createRequiredNote, loadRequiredNotes } from "@/lib/required-notes"

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

// Dropdown "cứng" cho ghi_chu — chỉ cho chọn từ danh mục required_notes (Cài đặt → Danh
// mục → Ghi chú bắt buộc), không cho gõ tay giá trị khác. Kỹ thuật định vị mirror đúng
// SmartMultiSelect trong dispatch/page.tsx (position: fixed qua createPortal, tự lật lên
// nếu không đủ chỗ, bottom-sheet riêng cho mobile) để không bị cắt hình khi đặt trong
// ModalShell (overflow-y-auto) hay trong bảng cuộn ngang.
export function RequiredNoteSelect({
  factoryId,
  value,
  onChange,
  allowEmpty = true,
  emptyLabel = "Không có ghi chú",
  placeholder = "-- Chọn ghi chú --",
  showQuickAdd = true,
  disabled = false,
  className = "",
  onError,
}: RequiredNoteSelectProps) {
  const [options, setOptions] = useState<string[]>([])
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
    if (!factoryId) { setOptions([]); return }
    let alive = true
    loadRequiredNotes(supabase, factoryId)
      .then((rows) => { if (alive) setOptions(rows.map((r) => r.content)) })
      .catch(() => { if (alive) setOptions([]) })
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

  const trimmedValue = value.trim()
  // Giá trị đã lưu từ trước có thể không nằm trong danh mục (dữ liệu lịch sử, giữ nguyên
  // theo quy tắc không đụng dữ liệu cũ) — vẫn hiện nó ở đầu danh sách, chọn lại được,
  // nhưng gắn badge để phân biệt, không cho gõ giá trị khác ngoài danh mục.
  const isLegacyValue = trimmedValue.length > 0 && !options.some((o) => o.toLowerCase() === trimmedValue.toLowerCase())
  const displayOptions = useMemo(
    () => (isLegacyValue ? [trimmedValue, ...options] : options),
    [options, isLegacyValue, trimmedValue],
  )
  const filtered = displayOptions.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase()))
  const currentLabel = trimmedValue || placeholder

  const handleQuickAdd = async () => {
    if (!factoryId) return
    const input = window.prompt("Nhập ghi chú mới")
    if (!input || !input.trim()) return
    setAdding(true)
    try {
      const row = await createRequiredNote(supabase, factoryId, input)
      setOptions((prev) => (prev.includes(row.content) ? prev : [...prev, row.content].sort((a, b) => a.localeCompare(b, "vi"))))
      onChange(row.content)
      setOpen(false)
      setSearch("")
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Không thêm được ghi chú")
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
            placeholder="Tìm ghi chú..."
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
          <p className="py-5 text-center text-xs text-slate-400">Không tìm thấy ghi chú phù hợp</p>
        ) : (
          filtered.map((option) => {
            const selected = option.toLowerCase() === trimmedValue.toLowerCase()
            const isLegacyOption = isLegacyValue && option === trimmedValue
            return (
              <button
                key={option}
                type="button"
                onClick={() => { onChange(option); closeAndReset() }}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-emerald-50 ${
                  selected ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-700"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{option}</span>
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
            {adding ? "Đang thêm..." : "Thêm ghi chú mới"}
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
                <span className="text-sm font-bold text-slate-700">Chọn ghi chú</span>
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
