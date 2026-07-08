"use client"

import { useEffect, useRef, useState } from "react"
import { Calendar } from "lucide-react"
import { formatDateDisplay, normalizeDateInput } from "@/lib/date-utils"

type DateTextInputProps = {
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}

export function DateTextInput({
  value,
  onChange,
  className,
  placeholder = "dd/mm/yyyy",
}: DateTextInputProps) {
  const [draft, setDraft] = useState(formatDateDisplay(value))
  const nativeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(formatDateDisplay(value))
  }, [value])

  const openPicker = () => {
    const el = nativeRef.current
    if (!el) return
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker()
        return
      } catch {
        // Một số trình duyệt chặn showPicker() ngoài user gesture trực tiếp — fallback focus()
      }
    }
    el.focus()
  }

  // Neu className goc co "w-full" thi wrapper cung phai full-width de khop layout cu;
  // nguoc lai giu inline-block (shrink-to-fit) de khong lam vo cac filter bar dang flex.
  const isFullWidth = /(^|\s)w-full(\s|$)/.test(className ?? "")

  return (
    <div className={`relative ${isFullWidth ? "w-full" : "inline-block"}`}>
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          const nextDraft = e.target.value
          setDraft(nextDraft)
          if (!nextDraft.trim()) {
            onChange("")
            return
          }
          const normalized = normalizeDateInput(nextDraft)
          if (normalized) onChange(normalized)
        }}
        onBlur={() => {
          const normalized = normalizeDateInput(draft)
          if (!draft.trim()) {
            setDraft("")
            onChange("")
            return
          }
          if (!normalized) {
            setDraft(formatDateDisplay(value))
            return
          }
          setDraft(formatDateDisplay(normalized))
          if (normalized !== value) onChange(normalized)
        }}
        className={`${className ?? ""} pr-7`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={openPicker}
        aria-label="Chọn ngày từ lịch"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-emerald-600"
      >
        <Calendar size={14} />
      </button>
      <input
        ref={nativeRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={normalizeDateInput(value)}
        onChange={(e) => {
          const iso = e.target.value
          if (iso) onChange(iso)
        }}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
    </div>
  )
}
