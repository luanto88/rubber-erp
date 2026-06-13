"use client"

import { useEffect, useState } from "react"
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

  useEffect(() => {
    setDraft(formatDateDisplay(value))
  }, [value])

  return (
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
      className={className}
    />
  )
}
