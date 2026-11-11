"use client"

// Định mức KTKT — vài helper giao diện dùng chung cho các tab GĐ2+ (Nhập liệu…). Rule 30.

import { useCallback, useState, type ReactNode } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { getErrorMessage } from "@/lib/error-message"
import { normDbErrorText } from "@/lib/norms/types"

export const inputCls =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-mod-600 focus:ring-2 focus:ring-mod-200 disabled:bg-slate-50 disabled:text-slate-500"
export const cellInputCls =
  "h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-right text-sm tabular-nums outline-none focus:border-mod-600 focus:ring-2 focus:ring-mod-200 disabled:bg-slate-50 disabled:text-slate-500"
export const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
export const btnPrimaryCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
export const btnDangerCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ""
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

export const errText = (e: unknown, fallback: string) => normDbErrorText(getErrorMessage(e, fallback))

/** "1.234,5" / "1234.5" → số; rỗng ⇒ null; sai ⇒ NaN. Số đồng hồ có thể dùng dấu chấm ngăn nghìn. */
export function parseQtyInput(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "")
  if (!s) return null
  let normalized = s
  if (s.includes(",")) normalized = s.replace(/\./g, "").replace(",", ".")
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, "")
  const n = Number(normalized)
  return Number.isFinite(n) ? n : Number.NaN
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  )
}

export type ToastState = { kind: "ok" | "err"; text: string } | null

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null)
  const showToast = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), kind === "ok" ? 3500 : 8000)
  }, [])
  const node = toast ? (
    <div
      className={`fixed left-1/2 top-4 z-[70] flex max-w-xl -translate-x-1/2 items-start gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-2xl ${
        toast.kind === "ok" ? "bg-emerald-600" : "bg-red-600"
      }`}
    >
      {toast.kind === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
      <span className="whitespace-pre-line">{toast.text}</span>
      <button type="button" className="ml-2 opacity-80 hover:opacity-100" onClick={() => setToast(null)}>
        ✕
      </button>
    </div>
  ) : null
  return { showToast, toastNode: node }
}
