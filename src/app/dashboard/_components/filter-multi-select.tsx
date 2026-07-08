"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Search, X } from "lucide-react"

type FilterMultiSelectProps = {
  options: readonly string[] | string[]
  selected: string[]
  onChange: (next: string[]) => void
  placeholder: string
  labels?: Record<string, string>
  className?: string
  searchPlaceholder?: string
}

export function FilterMultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  labels,
  className = "",
  searchPlaceholder = "Tìm loại...",
}: FilterMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        setSearch("")
      }
    }

    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 20)
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  const filteredOptions = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return [...options]
    return options.filter((option) => (labels?.[option] || option).toLowerCase().includes(needle))
  }, [labels, options, search])

  const summary = useMemo(() => {
    if (selected.length === 0) return placeholder
    if (selected.length === 1) return labels?.[selected[0]] || selected[0]
    return `${selected.length} mục đã chọn`
  }, [labels, placeholder, selected])

  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter((item) => item !== option))
      return
    }
    onChange([...selected, option])
  }

  return (
    <div ref={rootRef} className={`relative w-full min-w-0 sm:w-auto sm:min-w-52 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition-colors hover:border-slate-400 focus:border-emerald-500"
      >
        <span className={`truncate text-left ${selected.length === 0 ? "text-slate-400" : ""}`}>{summary}</span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-full min-w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 px-2 py-1.5">
            <Search size={14} className="shrink-0 text-slate-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="mb-2 flex items-center justify-between px-1 text-xs">
            <button type="button" onClick={() => onChange([...options])} className="font-bold text-emerald-700 hover:text-emerald-800">
              Chọn tất cả
            </button>
            <button type="button" onClick={() => onChange([])} className="font-bold text-slate-500 hover:text-slate-700">
              Bỏ chọn
            </button>
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="rounded-xl px-3 py-4 text-center text-sm text-slate-400">Không có lựa chọn</div>
            ) : (
              filteredOptions.map((option) => {
                const checked = selected.includes(option)
                return (
                  <label
                    key={option}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                      checked ? "bg-emerald-50 text-emerald-700" : "hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOption(option)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>{labels?.[option] || option}</span>
                  </label>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
