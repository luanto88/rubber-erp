"use client"

import type { CustomerPortalLang } from "@/lib/customer-portal-i18n"

type CustomerPortalLangToggleProps = {
  lang: CustomerPortalLang
  onChange: (lang: CustomerPortalLang) => void
}

export function CustomerPortalLangToggle({ lang, onChange }: CustomerPortalLangToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold shrink-0">
      <button
        type="button"
        onClick={() => onChange("en")}
        className={
          lang === "en"
            ? "bg-emerald-600 text-white px-3 py-1.5"
            : "bg-white text-slate-500 px-3 py-1.5 hover:bg-slate-50"
        }
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => onChange("vi")}
        className={
          lang === "vi"
            ? "bg-emerald-600 text-white px-3 py-1.5"
            : "bg-white text-slate-500 px-3 py-1.5 hover:bg-slate-50"
        }
      >
        VI
      </button>
    </div>
  )
}
