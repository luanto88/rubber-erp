"use client"

import { useMemo } from "react"
import { Package, TrendingUp, Layers } from "lucide-react"
import { type WarehousePlacement, type WarehouseSlot, getCsrColor } from "./warehouse-types"

type Props = {
  placements: WarehousePlacement[]
  slots: WarehouseSlot[]
}

export default function WarehouseKpi({ placements, slots }: Props) {
  const stats = useMemo(() => {
    const active = placements.filter(p => !p.removed_at)
    const totalKien = active.length

    const csrMap: Record<string, number> = {}
    for (const p of active) {
      const csr = p.lots?.loai_csr || "Khác"
      csrMap[csr] = (csrMap[csr] || 0) + 1
    }

    const bocMap: Record<string, number> = {}
    for (const p of active) {
      const boc = p.lots?.boc || "—"
      bocMap[boc] = (bocMap[boc] || 0) + 1
    }

    const totalCapacity = slots.reduce((s, sl) => s + sl.max_stack, 0)
    const fillRate = totalCapacity > 0 ? Math.round((totalKien / totalCapacity) * 100) : 0

    return { totalKien, csrMap, bocMap, fillRate, totalCapacity }
  }, [placements, slots])

  const csrEntries = Object.entries(stats.csrMap).sort((a, b) => b[1] - a[1])

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide shrink-0">Thống kê kho</span>

        {/* Tổng kiện */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200">
          <Package size={13} className="text-slate-500" />
          <span className="text-xs text-slate-500">Tổng kiện</span>
          <span className="text-sm font-extrabold text-slate-800">{stats.totalKien}</span>
        </div>

        {/* Tỷ lệ lấp đầy */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200">
          <TrendingUp size={13} className="text-slate-500" />
          <span className="text-xs text-slate-500">Lấp đầy</span>
          <span className={`text-sm font-extrabold ${
            stats.fillRate > 80 ? "text-red-600" : stats.fillRate > 50 ? "text-amber-600" : "text-emerald-600"
          }`}>
            {stats.fillRate}%
          </span>
          <span className="text-[10px] text-slate-400">({stats.totalKien}/{stats.totalCapacity})</span>
        </div>

        {/* Phân theo CSR */}
        {csrEntries.slice(0, 6).map(([csr, count]) => {
          const c = getCsrColor(csr)
          return (
            <div key={csr} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border ${c.bg} ${c.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
              <span className={`text-[10px] font-bold ${c.text}`}>{csr}</span>
              <span className={`text-xs font-extrabold ${c.text}`}>{count}</span>
            </div>
          )
        })}

        {/* Phân theo bọc */}
        {Object.entries(stats.bocMap).slice(0, 3).map(([boc, count]) => (
          <div key={boc} className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200 rounded-xl">
            <Layers size={11} className="text-indigo-500" />
            <span className="text-[10px] text-indigo-700 max-w-[80px] truncate" title={boc}>{boc}</span>
            <span className="text-[10px] font-extrabold text-indigo-700">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
