"use client"
// Ô Nắp cho 1 kiện (màn quét QR, sửa nháp, sửa lịch sử ca). Caller tự kiểm palletNeedsNap trước khi render.
import { napOptions } from "@/lib/pallet-nap"
import type { PalletComponentsConfig } from "@/lib/pallet-components"

export function NapSelect({
  components,
  value,
  onChange,
  label = "Nắp pallet",
  noneLabel = "Không nắp",
  hint,
}: {
  components: PalletComponentsConfig
  value: string
  onChange: (code: string) => void
  label?: string
  noneLabel?: string
  hint?: string
}) {
  const opts = napOptions(components, value)
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-slate-600">{label}</label>
      <div className="flex flex-wrap gap-2">
        {[{ code: "", ten: noneLabel }, ...opts].map((o) => {
          const active = value === o.code
          return (
            <button
              key={o.code || "none"}
              type="button"
              onClick={() => onChange(o.code)}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                active
                  ? "border-sky-500 bg-sky-100 text-sky-800"
                  : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
              }`}
            >
              {active ? "✓ " : ""}
              {o.ten}
            </button>
          )
        })}
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )
}
