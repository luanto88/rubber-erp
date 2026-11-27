"use client"

// A3 — tấm "Xếp người vào <việc>" khi chạm 1 ô Sơ đồ dây chuyền. Tick người ⇒ giao việc ô đó; bỏ tick ⇒ bỏ việc.
// Trượt từ dưới lên, portal ra document.body (như job-sheet.tsx).

import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Check, X } from "lucide-react"
import { normalizeSearchText } from "@/lib/text-normalize"
import { GenderIcon } from "./gender-icon"

export type PickerItem = {
  staffId: string
  ten: string
  gioiTinh: string | null
  note: string
  /** Đang vắng trong phiếu chủ ô ⇒ không tick được (mở thẻ người để sửa). */
  disabledNote?: string
}
export type PickerGroup = { label: string; items: PickerItem[] }

export function StationPicker({
  T,
  title,
  groups,
  initial,
  fixedNames,
  busy,
  onApply,
  onClose,
}: {
  T: (key: string, vars?: Record<string, string | number>) => string
  title: string
  groups: PickerGroup[]
  /** Người đang ở ô (tick sẵn). */
  initial: string[]
  /** Tên gõ tay "(tạm)" đang ở ô — chỉ hiển thị. */
  fixedNames: string[]
  busy: boolean
  onApply: (selected: Set<string>) => void
  onClose: () => void
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial))
  const [q, setQ] = useState("")
  const filtered = useMemo(() => {
    const k = normalizeSearchText(q)
    if (!k) return groups
    return groups.map((g) => ({ ...g, items: g.items.filter((i) => normalizeSearchText(i.ten).includes(k)) })).filter((g) => g.items.length > 0)
  }, [groups, q])
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45" onClick={onClose}>
      <div className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0 flex-1 break-words text-base font-bold text-slate-800">{title}</div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={T("close")}>
            <X size={18} />
          </button>
        </div>
        <div className="border-b border-slate-100 px-4 py-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={T("timNguoi")}
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
          />
          {fixedNames.length > 0 ? <div className="mt-1.5 text-xs italic text-slate-500">{fixedNames.join(", ")}</div> : null}
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {filtered.length === 0 ? <div className="py-6 text-center text-sm text-slate-400">{T("sdKhongCoNguoi")}</div> : null}
          {filtered.map((g) => (
            <section key={g.label}>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{g.label}</div>
              <div className="space-y-1">
                {g.items.map((i) => {
                  const on = sel.has(i.staffId)
                  const off = !!i.disabledNote && !on
                  return (
                    <button
                      key={i.staffId}
                      type="button"
                      disabled={off}
                      onClick={() => toggle(i.staffId)}
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left disabled:opacity-50 ${on ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white"}`}
                    >
                      <GenderIcon gioiTinh={i.gioiTinh} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-semibold text-slate-800">{i.ten}</span>
                        {i.disabledNote || i.note ? (
                          <span className={`block break-words text-[11px] ${i.disabledNote ? "text-rose-600" : "text-slate-500"}`}>{i.disabledNote || i.note}</span>
                        ) : null}
                      </span>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"}`}>
                        {on ? <Check size={13} strokeWidth={3} /> : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="border-t border-slate-100 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onApply(sel)}
            className="w-full rounded-xl bg-emerald-600 py-3 text-base font-bold text-white disabled:opacity-60"
          >
            {T("xong")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
