"use client"

import Link from "next/link"
import type { MouseEvent } from "react"
import { IconAction } from "./icon-action"
import { ROW_ACTIONS, type RowActionKind } from "./action-registry"

/**
 * Nút thao tác trong dòng bảng theo TỪ ĐIỂN HÀNH ĐỘNG (action-registry.ts) — icon + tông + nhãn
 * mặc định đã chốt, trang gọi chỉ cần `kind`. `label` để ghi rõ hơn ("Xem biên bản", "Tải PDF").
 * `variant="text"` cho hành động chính (Duyệt / Huỷ phiếu): nút viền có chữ, cao 32px.
 */
export function RowAction({
  kind,
  label,
  href,
  target,
  onClick,
  disabled = false,
  loading = false,
  variant = "icon",
}: {
  kind: RowActionKind
  label?: string
  href?: string
  target?: string
  onClick?: (e: MouseEvent) => void
  disabled?: boolean
  loading?: boolean
  variant?: "icon" | "text"
}) {
  const def = ROW_ACTIONS[kind]
  const text = label ?? def.label

  if (variant === "icon") {
    return (
      <IconAction
        icon={def.icon}
        label={text}
        tone={def.tone}
        href={href}
        target={target}
        onClick={onClick}
        disabled={disabled}
        loading={loading}
      />
    )
  }

  const Icon = def.icon
  const toneCls =
    def.tone === "danger"
      ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
      : "border-brand-600 bg-brand-600 text-white hover:bg-brand-700"
  const cls = `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[12.5px] font-bold transition-colors ${toneCls} ${
    disabled || loading ? "pointer-events-none opacity-50" : ""
  }`
  const content = (
    <>
      {loading ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <Icon size={15} />
      )}
      {text}
    </>
  )
  if (href && !disabled) {
    return (
      <Link
        href={href}
        target={target}
        className={cls}
        onClick={(e) => {
          e.stopPropagation()
          onClick?.(e)
        }}
      >
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cls}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
    >
      {content}
    </button>
  )
}
