"use client"

import { useMemo } from "react"
import { Filter, X } from "lucide-react"
import {
  type LotInfo,
  type FilterState,
  EMPTY_FILTER,
  isFilterActive,
  getCsrColor,
} from "./warehouse-types"

type Props = {
  lots: LotInfo[]
  filter: FilterState
  onChange: (f: FilterState) => void
}

export default function WarehouseFilterBar({ lots, filter, onChange }: Props) {
  // Build option lists từ lots
  const opts = useMemo(() => {
    const csrSet = new Set<string>()
    const banhSet = new Set<string>()
    const bocSet = new Set<string>()
    for (const l of lots) {
      if (l.loai_csr) csrSet.add(l.loai_csr)
      if (l.loai_banh) banhSet.add(String(l.loai_banh))
      if (l.boc) bocSet.add(l.boc)
    }
    return {
      csr: [...csrSet].sort(),
      banh: [...banhSet].sort((a, b) => Number(a) - Number(b)),
      boc: [...bocSet].sort(),
    }
  }, [lots])

  const active = isFilterActive(filter)

  const toggleMulti = (field: "csrTypes" | "banhValues" | "bocValues", val: string) => {
    const current = filter[field] as string[]
    onChange({
      ...filter,
      [field]: current.includes(val) ? current.filter(v => v !== val) : [...current, val],
    })
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border text-xs mb-3 transition-all
      ${active
        ? "bg-sky-50 border-sky-200 shadow-sm"
        : "bg-white border-slate-200"
      }`}>

      {/* Icon + label */}
      <div className="flex items-center gap-1.5 text-slate-500 font-bold shrink-0">
        <Filter size={13} className={active ? "text-sky-600" : "text-slate-400"} />
        <span className={active ? "text-sky-700" : ""}>Lọc lô</span>
      </div>

      {/* CSR chips */}
      {opts.csr.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {opts.csr.map(csr => {
            const c = getCsrColor(csr)
            const on = filter.csrTypes.includes(csr)
            return (
              <button
                key={csr}
                onClick={() => toggleMulti("csrTypes", csr)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all ${
                  on ? `${c.bg} ${c.border} ${c.text} shadow-sm` : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                }`}
              >
                {csr}
              </button>
            )
          })}
        </div>
      )}

      {/* Separator */}
      <div className="h-4 w-px bg-slate-200 shrink-0" />

      {/* Loại bành chips */}
      {opts.banh.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-slate-400 text-[10px] shrink-0">Bành:</span>
          {opts.banh.map(b => {
            const on = filter.banhValues.includes(b)
            return (
              <button
                key={b}
                onClick={() => toggleMulti("banhValues", b)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all ${
                  on
                    ? "bg-violet-100 border-violet-300 text-violet-700 shadow-sm"
                    : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                }`}
              >
                {b}
              </button>
            )
          })}
        </div>
      )}

      {/* Separator */}
      <div className="h-4 w-px bg-slate-200 shrink-0" />

      {/* Bọc dropdown */}
      {opts.boc.length > 0 && (
        <select
          value={filter.bocValues[0] || ""}
          onChange={e => onChange({ ...filter, bocValues: e.target.value ? [e.target.value] : [] })}
          className="px-2 py-0.5 border border-slate-200 rounded-lg text-[10px] outline-none focus:border-sky-400 max-w-[130px]"
        >
          <option value="">Tất cả bọc</option>
          {opts.boc.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      )}

      {/* Mã lô search */}
      <input
        type="text"
        placeholder="Mã lô..."
        value={filter.maLo}
        onChange={e => onChange({ ...filter, maLo: e.target.value })}
        className="px-2 py-0.5 border border-slate-200 rounded-lg text-[10px] outline-none focus:border-sky-400 w-24"
      />

      {/* Ngày */}
      <div className="flex items-center gap-1">
        <span className="text-slate-400 text-[10px]">Ngày:</span>
        <input
          type="date"
          value={filter.ngayFrom}
          onChange={e => onChange({ ...filter, ngayFrom: e.target.value })}
          className="px-1.5 py-0.5 border border-slate-200 rounded-lg text-[10px] outline-none focus:border-sky-400 w-28"
        />
        <span className="text-slate-300">–</span>
        <input
          type="date"
          value={filter.ngayTo}
          onChange={e => onChange({ ...filter, ngayTo: e.target.value })}
          className="px-1.5 py-0.5 border border-slate-200 rounded-lg text-[10px] outline-none focus:border-sky-400 w-28"
        />
      </div>

      {/* Xóa filter */}
      {active && (
        <button
          onClick={() => onChange({ ...EMPTY_FILTER })}
          className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full text-[10px] font-bold transition-colors ml-auto"
        >
          <X size={10} /> Xóa lọc
        </button>
      )}
    </div>
  )
}
