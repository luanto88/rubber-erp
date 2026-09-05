"use client"

import React from "react"
import { normalizeDateInput } from "@/lib/date-utils"

export type DateTextInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: string | null | undefined
  onChange: (value: string) => void
}

export function DateTextInput({
  value,
  onChange,
  className = "",
  ...rest
}: DateTextInputProps) {
  const normalizedValue = normalizeDateInput(value)

  return (
    <input
      type="date"
      value={normalizedValue}
      onChange={(e) => {
        onChange(e.target.value)
      }}
      className={className}
      {...rest}
    />
  )
}

