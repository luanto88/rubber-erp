"use client"

/** Mã văn bản / mã tài liệu ISO — font mono, nền brand nhạt (Doc-UI). */
export function DocCodePill({
  code,
  className = "",
  muted = false,
}: {
  code: string | null | undefined
  className?: string
  muted?: boolean
}) {
  if (!code) return <span className="text-xs text-slate-400">—</span>
  return (
    <span
      className={`font-code inline-block max-w-full truncate rounded-[6px] px-2 py-0.5 align-middle text-[12px] font-semibold ${
        muted ? "bg-slate-100 text-slate-600" : "bg-brand-50 text-brand-800"
      } ${className}`}
      title={code}
    >
      {code}
    </span>
  )
}
