"use client"

import { useState, type ReactNode } from "react"
import { Loader2, MoreHorizontal, X } from "lucide-react"

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
 * Trên mobile có thêm thanh cố định ở đáy chứa nút chính (và "…" mở các nút còn lại).
 * Mọi `onClick`/cờ quyền do trang truyền vào — component không tự quyết định gì.
 */
export function SignActionBox({
  title = "Hành động ký",
  primary,
  secondary = [],
  danger = [],
  hint,
  mobileBar = true,
}: {
  title?: ReactNode
  primary?: SignAction | null
  secondary?: SignAction[]
  danger?: SignAction[]
  hint?: ReactNode
  mobileBar?: boolean
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  if (!primary && secondary.length === 0 && danger.length === 0) return null
  const others = [...secondary, ...danger]

  const primaryBtn = (a: SignAction, extra = "") => (
    <button
      type="button"
      onClick={a.onClick}
      disabled={a.disabled || a.loading}
      title={a.title}
      className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 px-4 text-[14px] font-bold text-white shadow-md transition-all hover:from-brand-700 hover:to-brand-900 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${extra}`}
    >
      {a.loading ? <Loader2 size={16} className="animate-spin" /> : a.icon}
      <span className="truncate">{a.label}</span>
    </button>
  )
  const otherBtn = (a: SignAction, isDanger: boolean, onDone?: () => void, extraCls = "") => (
    <button
      key={a.key}
      type="button"
      onClick={() => {
        onDone?.()
        a.onClick()
      }}
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
    <>
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
                  undefined,
                  others.length % 2 === 1 && i === others.length - 1 ? "col-span-2" : "",
                ),
              )}
            </div>
          )}
          {hint && <div className="text-[11.5px] leading-relaxed text-slate-500">{hint}</div>}
        </div>
      </section>

      {mobileBar && (
        <>
          {/* Chừa chỗ để thanh cố định không che nội dung cuối trang */}
          <div className="h-16 lg:hidden" aria-hidden="true" />
          <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-2.5 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] lg:hidden">
            <div className="min-w-0 flex-1">
              {primary ? (
                primaryBtn(primary, "h-10")
              ) : (
                <p className="text-[12.5px] font-semibold text-slate-600">Thao tác khác</p>
              )}
            </div>
            {others.length > 0 && (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600"
                aria-label="Hành động khác"
              >
                <MoreHorizontal size={18} />
              </button>
            )}
          </div>
          {sheetOpen && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <button type="button" className="absolute inset-0 bg-black/40" aria-label="Đóng" onClick={() => setSheetOpen(false)} />
              <div className="absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[14px] font-bold text-slate-800">Hành động khác</p>
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                    aria-label="Đóng"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {secondary.map((a) => otherBtn(a, false, () => setSheetOpen(false)))}
                  {danger.map((a) => otherBtn(a, true, () => setSheetOpen(false)))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
