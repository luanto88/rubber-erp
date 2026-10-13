"use client"

import { TONE_CLASSES, resolveStatus, type StatusDomain, type StatusTone } from "./status-registry"

/**
 * Badge trạng thái DUY NHẤT cho Văn bản / ISO / Hồ sơ thực hiện (Doc-UI).
 * Pill có chấm 6px đầu dòng; tông `pending` có chấm nhấp nháy.
 * Truyền `domain` + `status` (đọc registry) HOẶC truyền thẳng `tone` + `label` cho trạng thái
 * phái sinh (vd "Chờ bạn ký", "PAdES nội bộ").
 */
export function StatusBadge({
  domain,
  status,
  tone,
  label,
  size = "sm",
  className = "",
  title,
}: {
  domain?: StatusDomain
  status?: string | null
  tone?: StatusTone
  label?: string
  size?: "xs" | "sm" | "md"
  className?: string
  title?: string
}) {
  const entry = domain ? resolveStatus(domain, status) : { label: label ?? "", tone: tone ?? "draft" }
  const t = TONE_CLASSES[tone ?? entry.tone]
  const text = label ?? entry.label
  const sizeCls =
    size === "xs"
      ? "gap-1 px-2 py-0.5 text-[10.5px]"
      : size === "md"
        ? "gap-1.5 px-3 py-1 text-[13px]"
        : "gap-1.5 px-2.5 py-0.5 text-xs"
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border font-semibold leading-5 ${sizeCls} ${t.badge} ${className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot} ${t.pulse ? "doc-pulse-dot" : ""}`} />
      {text}
    </span>
  )
}
