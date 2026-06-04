"use client"

import { useMemo } from "react"
import { Package, TrendingUp, Layers } from "lucide-react"
import { type WarehousePlacement, type WarehouseSlot, getCsrColor } from "./warehouse-types"

type Props = {
  placements: WarehousePlacement[]
  slots: WarehouseSlot[]
  filterNgayFrom: string
  filterNgayTo: string
  onFilterNgayFrom: (v: string) => void
  onFilterNgayTo: (v: string) => void
}

export default function WarehouseKpi({
  placements,
  slots,
  filterNgayFrom,
  filterNgayTo,
  onFilterNgayFrom,
  onFilterNgayTo,
}: Props) {
  const stats = useMemo(() => {
    const active = placements.filter(p => !p.removed_at)

    // Lọc theo ngày sx nếu có filter
    const filtered = active.filter(p => {
      if (!p.lots) return true
      const ngay = p.lots.ngay_ht || p.lots.ngay_sx
      if (filterNgayFrom && ngay < filterNgayFrom) return false
      if (filterNgayTo && ngay > filterNgayTo) return false
      return true
    })

    const totalKien = filtered.length

    // Theo CSR
    const csrMap: Record<string, number> = {}
    for (const p of filtered) {
      const csr = p.lots?.loai_csr || "Khác"
      csrMap[csr] = (csrMap[csr] || 0) + 1
    }

    // Theo bọc
    const bocMap: Record<string, number> = {}
    for (const p of filtered) {
      const boc = p.lots?.boc || "—"
      bocMap[boc] = (bocMap[boc] || 0) + 1
    }

    // Tỷ lệ lấp đầy (tổng capacity = số slot × max_stack)
    const totalCapacity = slots.reduce((s, sl) => s + sl.max_stack, 0)
    const fillRate = totalCapacity > 0 ? Math.round((totalKien / totalCapacity) * 100) : 0

    return { totalKien, csrMap, bocMap, fillRate }
  }, [placements, slots, filterNgayFrom, filterNgayTo])

  const csrEntries = Object.entries(stats.csrMap).sort((a, b) => b[1] - a[1])

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
      {/* Bộ lọc ngày */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Thống kê kho</span>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-slate-500">Ngày sx:</span>
          <input
            type="date"
            value={filterNgayFrom}
            onChange={e => onFilterNgayFrom(e.target.value)}
            className="px-2 py-1 text-xs border border-slate-300 rounded-lg outline-none focus:border-emerald-500"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="date"
            value={filterNgayTo}
            onChange={e => onFilterNgayTo(e.target.value)}
            className="px-2 py-1 text-xs border border-slate-300 rounded-lg outline-none focus:border-emerald-500"
          />
          {(filterNgayFrom || filterNgayTo) && (
            <button
              onClick={() => { onFilterNgayFrom(""); onFilterNgayTo("") }}
              className="text-xs text-slate-400 hover:text-slate-600 underline"
            >
              Xóa
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Tổng kiện */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200">
          <Package size={14} className="text-slate-500" />
          <span className="text-xs text-slate-500">Tổng kiện</span>
          <span className="text-sm font-extrabold text-slate-800">{stats.totalKien}</span>
        </div>

        {/* Tỷ lệ */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200">
          <TrendingUp size={14} className="text-slate-500" />
          <span className="text-xs text-slate-500">Lấp đầy</span>
          <span className={`text-sm font-extrabold ${stats.fillRate > 80 ? "text-red-600" : stats.fillRate > 50 ? "text-amber-600" : "text-emerald-600"}`}>
            {stats.fillRate}%
          </span>
        </div>

        {/* Phân theo CSR */}
        {csrEntries.slice(0, 6).map(([csr, count]) => {
          const c = getCsrColor(csr)
          return (
            <div key={csr} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border ${c.bg} ${c.border}`}>
              <span className={`w-2 h-2 rounded-full ${c.dot}`} />
              <span className={`text-xs font-bold ${c.text}`}>{csr}</span>
              <span className={`text-xs font-extrabold ${c.text}`}>{count}</span>
            </div>
          )
        })}

        {/* Phân theo bọc (compact) */}
        {Object.entries(stats.bocMap).slice(0, 3).map(([boc, count]) => (
          <div key={boc} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-xl">
            <Layers size={11} className="text-indigo-500" />
            <span className="text-xs text-indigo-700 max-w-[80px] truncate" title={boc}>{boc}</span>
            <span className="text-xs font-extrabold text-indigo-700">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
