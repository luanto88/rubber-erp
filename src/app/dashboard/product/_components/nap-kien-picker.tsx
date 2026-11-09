"use client"
// Ô Nắp theo từng kiện (GĐ3B). Chỉ render khi pallet cần nắp — caller tự kiểm palletNeedsNap.
import { NAP_KIENS, MAX_NAP_PER_LOT, napCount, napOptions, type NapKien, type NapMap } from "@/lib/pallet-nap"
import type { PalletComponentsConfig } from "@/lib/pallet-components"

export function NapKienPicker({
  components,
  value,
  onChange,
  enabledKiens = NAP_KIENS,
  hint,
  disabled,
}: {
  components: PalletComponentsConfig
  value: NapMap | null | undefined
  onChange: (next: NapMap) => void
  /** Kiện được chọn nắp (kiện có bành). Kiện khác hiện mờ. */
  enabledKiens?: NapKien[]
  hint?: string
  disabled?: boolean
}) {
  const v = value || {}
  const count = napCount(v)
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/60 px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-sky-800">Nắp pallet theo kiện</span>
        <span className={`text-[11px] font-bold ${count > MAX_NAP_PER_LOT ? "text-amber-700" : "text-sky-700"}`}>
          {count} nắp
          {count > MAX_NAP_PER_LOT ? ` — thường chỉ ${MAX_NAP_PER_LOT} nắp / lô` : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {NAP_KIENS.map((k) => {
          const enabled = enabledKiens.includes(k)
          return (
            <label key={k} className={`flex items-center gap-1.5 ${enabled ? "" : "opacity-40"}`}>
              <span className="w-6 shrink-0 text-center text-xs font-extrabold text-slate-600">{k.toUpperCase()}</span>
              <select
                value={enabled ? v[k] || "" : ""}
                disabled={disabled || !enabled}
                onChange={(e) => {
                  const next: NapMap = { ...v }
                  if (e.target.value) next[k] = e.target.value
                  else delete next[k]
                  onChange(next)
                }}
                className="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="">Không nắp</option>
                {napOptions(components, v[k]).map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.ten}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )
}
