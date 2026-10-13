"use client"

import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"

export type SignAction = {
  key: string
  label: ReactNode
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  title?: string
}

/**
 * Hộp hành động ký (Doc-UI, GĐ2) — nút chính gradient brand + nút phụ + nút nguy hiểm.
 * Đây là nơi DUY NHẤT có nút ký (đã bỏ thanh cố định ở đáy mobile — trùng nút + để lại khoảng trống).
 * Mọi `onClick`/cờ quyền do trang truyền vào — component không tự quyết định gì.
 */
export function SignActionBox({
  title = "Hành động ký",
  primary,
  secondary = [],
  danger = [],
  hint,
}: {
  title?: ReactNode
  primary?: SignAction | null
  secondary?: SignAction[]
  danger?: SignAction[]
  hint?: ReactNode
}) {
  if (!primary && secondary.length === 0 && danger.length === 0) return null
  const others = [...secondary, ...danger]

  const primaryBtn = (a: SignAction) => (
    <button
      type="button"
      onClick={a.onClick}
      disabled={a.disabled || a.loading}
      title={a.title}
      className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 px-4 text-[14px] font-bold text-white shadow-md transition-all hover:from-brand-700 hover:to-brand-900 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {a.loading ? <Loader2 size={16} className="animate-spin" /> : a.icon}
      <span className="truncate">{a.label}</span>
    </button>
  )
  const otherBtn = (a: SignAction, isDanger: boolean, extraCls = "") => (
    <button
      key={a.key}
      type="button"
      onClick={a.onClick}
      disabled={a.disabled || a.loading}
      title={a.title}
      className={`inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${extraCls} ${
        isDanger
          ? "border-red-200 bg-white text-red-600 hover:bg-red-50"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
      }`}
    >
      {a.loading ? <Loader2 size={14} className="animate-spin" /> : a.icon}
      <span>{a.label}</span>
    </button>
  )

  return (
      <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <h3 className="text-[13.5px] font-bold text-slate-800">{title}</h3>
        </header>
        <div className="space-y-2.5 p-4">
          {primary && primaryBtn(primary)}
          {others.length > 0 && (
            // Một lưới 2 cột cân đối: 1 nút → trải cả hàng; số lẻ → nút cuối trải cả hàng.
            <div className="grid grid-cols-2 gap-2">
              {others.map((a, i) =>
                otherBtn(
                  a,
                  i >= secondary.length,
                  others.length % 2 === 1 && i === others.length - 1 ? "col-span-2" : "",
                ),
              )}
            </div>
          )}
          {hint && <div className="text-[11.5px] leading-relaxed text-slate-500">{hint}</div>}
        </div>
      </section>
  )
}
