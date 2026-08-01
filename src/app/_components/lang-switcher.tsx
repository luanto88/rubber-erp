"use client"

import { LANG_OPTIONS, type Lang } from "@/lib/homepage-i18n"

export function LangSwitcher({
  lang,
  onChange,
  className = "",
}: {
  lang: Lang
  onChange: (lang: Lang) => void
  className?: string
}) {
  return (
    <div
      className={`flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-100/80 p-0.5 ${className}`}
      role="group"
      aria-label="Chọn ngôn ngữ / Language / ភាសា"
    >
      {LANG_OPTIONS.map((option) => (
        <button
          key={option.code}
          type="button"
          onClick={() => onChange(option.code)}
          aria-pressed={lang === option.code}
          className={`min-w-[30px] rounded-full px-2 py-1 text-[11px] font-bold transition-all sm:px-2.5 sm:py-1.5 sm:text-xs ${
            lang === option.code
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
