"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Plus } from "lucide-react"

type MultiSelectOption = {
  value: string
  label: string
  meta?: string
}

type MultiSelectFieldProps = {
  label: string
  options: MultiSelectOption[]
  selectedValues: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  disabled?: boolean
}

type CompactItemSelectorCardProps = {
  code: string
  name: string
  stockText: string
  breakdownText?: string | null
  selected: boolean
  onToggle: () => void
}

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"

function getSummaryText(options: MultiSelectOption[], selectedValues: string[], placeholder: string) {
  if (selectedValues.length === 0) return placeholder

  const selectedLabels = options
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label)

  if (selectedLabels.length <= 2) {
    return selectedLabels.join(", ")
  }

  return `${selectedLabels.length} mục đã chọn`
}

export function MultiSelectField({
  label,
  options,
  selectedValues,
  onChange,
  placeholder = "Tất cả",
  disabled = false,
}: MultiSelectFieldProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setSearchTerm("")
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [open])

  const toggleValue = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((entry) => entry !== value))
      return
    }

    onChange([...selectedValues, value])
  }

  const summaryText = getSummaryText(options, selectedValues, placeholder)
  const allSelected = options.length > 0 && selectedValues.length === options.length
  const normalizedSearch = searchTerm.trim().toLowerCase()
  const filteredOptions = useMemo(() => {
    if (!normalizedSearch) return options

    return options.filter((option) => {
      const haystacks = [option.label, option.meta || ""]
      return haystacks.some((value) => value.toLowerCase().includes(normalizedSearch))
    })
  }, [normalizedSearch, options])

  return (
    <div ref={rootRef} className="relative z-[70]">
      <label className="mb-1.5 block text-xs font-bold text-slate-600">{label}</label>
      <div className="group relative z-[70]">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            if (disabled) return
            if (open) {
              setSearchTerm("")
            }
            setOpen((currentOpen) => !currentOpen)
          }}
          className={`${INPUT_CLASS} flex cursor-pointer items-center justify-between gap-3 ${
            disabled ? "pointer-events-none bg-slate-100 text-slate-400" : "bg-white text-slate-700"
          }`}
        >
          <span className="truncate">{summaryText}</span>
          <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
        </button>

        {open ? (
          <div className="absolute z-[120] mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onChange(options.map((option) => option.value))}
                className="rounded-lg px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
              >
                Chọn tất cả
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded-lg px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Bỏ chọn
              </button>
            </div>

            <div className="mb-2">
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={`Tìm nhanh ${label.toLowerCase()}...`}
                className={INPUT_CLASS}
              />
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {options.length === 0 ? (
                <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">Chưa có dữ liệu để chọn.</div>
              ) : filteredOptions.length === 0 ? (
                <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">Không tìm thấy mục phù hợp.</div>
              ) : (
                filteredOptions.map((option) => {
                  const checked = selectedValues.includes(option.value)
                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 transition ${
                        checked ? "border-emerald-200 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleValue(option.value)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-700">{option.label}</span>
                        {option.meta ? <span className="block text-xs text-slate-500">{option.meta}</span> : null}
                      </span>
                    </label>
                  )
                })
              )}
            </div>

            {allSelected ? (
              <div className="mt-2 text-right text-xs font-semibold text-emerald-700">Đang chọn toàn bộ danh sách</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function CompactItemSelectorCard({
  code,
  name,
  stockText,
  breakdownText,
  selected,
  onToggle,
}: CompactItemSelectorCardProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative min-h-[96px] rounded-xl border p-2.5 text-left transition-all ${
        selected
          ? "border-emerald-500 bg-emerald-50 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div
        className={`absolute right-2 top-2 rounded-full p-1 ${
          selected ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"
        }`}
      >
        <Check size={11} />
      </div>

      <div className="pr-8">
        <div className="truncate text-xs font-bold text-slate-800">{code}</div>
        <div className="mt-1 line-clamp-1 text-[11px] text-slate-600">{name}</div>
        <div className="mt-1.5 text-[10px] font-semibold text-slate-500">{stockText}</div>
        {breakdownText ? <div className="mt-0.5 text-[10px] text-slate-400">{breakdownText}</div> : null}
      </div>
    </button>
  )
}

export function AddItemButton({
  disabled,
  onClick,
}: {
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus size={16} />
      Thêm mới
    </button>
  )
}
