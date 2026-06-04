"use client"

import { useState, useMemo } from "react"
import { ChevronDown, ChevronRight, Search } from "lucide-react"
import {
  type LotInfo,
  type WarehousePlacement,
  type DragKienData,
  type KienLabel,
  getCsrColor,
  getMaxBanh,
  getKienBanh,
  isLotFull,
} from "./warehouse-types"

type Props = {
  lots: LotInfo[]
  activePlacements: WarehousePlacement[]  // removed_at IS NULL
  onDragStart: (data: DragKienData) => void
  onDragEnd: () => void
}

const KIEN_LABELS: KienLabel[] = ["A", "B", "C", "D"]

export default function LotPanel({ lots, activePlacements, onDragStart, onDragEnd }: Props) {
  const [search, setSearch] = useState("")
  const [filterDayChuyen, setFilterDayChuyen] = useState("")
  const [filterCsr, setFilterCsr] = useState("")
  const [filterBoc, setFilterBoc] = useState("")
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set())

  // Build set của kiện đã được đặt vào kho
  const placedKienSet = useMemo(() => {
    const s = new Set<string>()
    for (const p of activePlacements) {
      s.add(`${p.lot_id}:${p.kien_label}`)
    }
    return s
  }, [activePlacements])

  // Build lookup: lot_id:kien_label → slot_code
  const placedSlotLookup = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of activePlacements) {
      m.set(`${p.lot_id}:${p.kien_label}`, `${p.slot_code} T${p.stack_level}`)
    }
    return m
  }, [activePlacements])

  // Danh mục filter
  const dayChuyenOptions = useMemo(() => [...new Set(lots.map(l => l.day_chuyen))].sort(), [lots])
  const csrOptions = useMemo(() => [...new Set(lots.map(l => l.loai_csr))].sort(), [lots])
  const bocOptions = useMemo(() => [...new Set(lots.map(l => l.boc))].sort(), [lots])

  const filteredLots = useMemo(() => {
    return lots.filter(l => {
      if (search && !l.ma_lo.toLowerCase().includes(search.toLowerCase())) return false
      if (filterDayChuyen && l.day_chuyen !== filterDayChuyen) return false
      if (filterCsr && l.loai_csr !== filterCsr) return false
      if (filterBoc && l.boc !== filterBoc) return false
      return true
    })
  }, [lots, search, filterDayChuyen, filterCsr, filterBoc])

  const toggleLot = (lotId: string) => {
    setExpandedLots(prev => {
      const next = new Set(prev)
      if (next.has(lotId)) next.delete(lotId)
      else next.add(lotId)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-100">
        <div className="text-sm font-extrabold text-slate-700 mb-2">Lô cần đặt kho</div>

        {/* Search */}
        <div className="relative mb-2">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm mã lô..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-6 pr-2 py-1.5 text-xs border border-slate-300 rounded-lg outline-none focus:border-emerald-500"
          />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 gap-1.5">
          <select
            value={filterDayChuyen}
            onChange={e => setFilterDayChuyen(e.target.value)}
            className="px-2 py-1 text-xs border border-slate-300 rounded-lg outline-none focus:border-emerald-500"
          >
            <option value="">Tất cả dây chuyền</option>
            {dayChuyenOptions.map(dc => <option key={dc} value={dc}>{dc}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={filterCsr}
              onChange={e => setFilterCsr(e.target.value)}
              className="px-2 py-1 text-xs border border-slate-300 rounded-lg outline-none focus:border-emerald-500"
            >
              <option value="">Tất cả CSR</option>
              {csrOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={filterBoc}
              onChange={e => setFilterBoc(e.target.value)}
              className="px-2 py-1 text-xs border border-slate-300 rounded-lg outline-none focus:border-emerald-500"
            >
              <option value="">Tất cả bọc</option>
              {bocOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Danh sách lô */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {filteredLots.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400">
            Không có lô nào phù hợp
          </div>
        ) : (
          filteredLots.map(lot => {
            const c = getCsrColor(lot.loai_csr)
            const isExpanded = expandedLots.has(lot.id)
            const maxBanh = getMaxBanh(lot.loai_banh)

            // Đếm kiện đã đặt
            const placedCount = KIEN_LABELS.filter(k => placedKienSet.has(`${lot.id}:${k}`)).length
            const allPlaced = placedCount === 4

            return (
              <div key={lot.id} className={`rounded-xl border ${c.border} overflow-hidden`}>
                {/* Lot header */}
                <button
                  className={`w-full flex items-center gap-2 px-3 py-2 ${c.bg} hover:opacity-90 transition-opacity`}
                  onClick={() => toggleLot(lot.id)}
                >
                  {isExpanded ? <ChevronDown size={11} className={c.text} /> : <ChevronRight size={11} className={c.text} />}
                  <span className={`flex-1 text-left text-xs font-extrabold ${c.text} truncate`}>
                    {lot.ma_lo}
                  </span>
                  <span className={`text-[10px] font-bold ${c.text} opacity-70`}>{lot.loai_csr}</span>
                  {allPlaced ? (
                    <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1 rounded-full font-bold">✓ Đã đặt</span>
                  ) : placedCount > 0 ? (
                    <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded-full font-bold">{placedCount}/4</span>
                  ) : null}
                </button>

                {/* Kiện A/B/C/D */}
                {isExpanded && (
                  <div className="bg-white px-2 py-2 grid grid-cols-2 gap-1.5">
                    {KIEN_LABELS.map(kien => {
                      const banh = getKienBanh(lot, kien)
                      if (banh === 0) return null  // kiện đã xuất hết
                      const isPlaced = placedKienSet.has(`${lot.id}:${kien}`)
                      const placedSlot = placedSlotLookup.get(`${lot.id}:${kien}`)
                      const isFull = banh >= maxBanh
                      const dragData: DragKienData = {
                        lotId: lot.id,
                        maLo: lot.ma_lo,
                        kienLabel: kien,
                        kienBanh: banh,
                        loaiCsr: lot.loai_csr,
                        dayChuyen: lot.day_chuyen,
                      }

                      return (
                        <div
                          key={kien}
                          draggable={!isPlaced}
                          onDragStart={e => {
                            e.dataTransfer.setData("kien", JSON.stringify(dragData))
                            e.dataTransfer.effectAllowed = "move"
                            onDragStart(dragData)
                          }}
                          onDragEnd={onDragEnd}
                          className={`
                            relative rounded-lg border px-2 py-1.5 transition-all
                            ${isPlaced
                              ? "opacity-50 cursor-default bg-slate-50 border-slate-200"
                              : `cursor-grab active:cursor-grabbing ${c.bg} ${c.border} hover:shadow-md hover:scale-[1.02]`
                            }
                          `}
                        >
                          <div className={`text-[10px] font-extrabold ${isPlaced ? "text-slate-400" : c.text}`}>
                            Kiện {kien}
                          </div>
                          <div className={`text-[9px] ${isFull ? (isPlaced ? "text-slate-400" : "text-slate-600") : "text-amber-600 font-bold"}`}>
                            {banh} bánh{!isFull ? " ⚠" : ""}
                          </div>
                          {isPlaced && placedSlot && (
                            <div className="text-[8px] text-emerald-600 font-bold mt-0.5">
                              → {placedSlot}
                            </div>
                          )}
                          {!isPlaced && (
                            <div className="absolute top-0.5 right-0.5 text-[8px] text-slate-300">⠿</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer: tổng */}
      <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 text-center">
        {filteredLots.length} lô · Kéo kiện vào sơ đồ kho bên trái
      </div>
    </div>
  )
}
