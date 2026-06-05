"use client"

import { useState, useMemo } from "react"
import { ChevronDown, ChevronRight, GripVertical, Search } from "lucide-react"
import {
  type LotInfo,
  type WarehousePlacement,
  type DragKienData,
  type DragLotData,
  type KienLabel,
  getCsrColor,
  getMaxBanh,
  getKienBanh,
} from "./warehouse-types"

type Props = {
  lots: LotInfo[]
  activePlacements: WarehousePlacement[]
  onDragKienStart: (data: DragKienData) => void
  onDragLotStart: (data: DragLotData) => void
  onDragEnd: () => void
  onRemovePlacement?: (placementId: string) => Promise<void>
}

const KIEN_LABELS: KienLabel[] = ["A", "B", "C", "D"]

export default function LotPanel({
  lots,
  activePlacements,
  onDragKienStart,
  onDragLotStart,
  onDragEnd,
  onRemovePlacement,
}: Props) {
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set())
  const [isDragBackOver, setIsDragBackOver] = useState(false)
  // Bộ lọc nội bộ cho panel (độc lập với filter sơ đồ kho)
  const [search, setSearch] = useState("")
  const [filterCsr, setFilterCsr] = useState("")
  const [filterBoc, setFilterBoc] = useState("")
  const [filterDayChuyen, setFilterDayChuyen] = useState("")

  // Build placed set + lookup
  const placedKienSet = useMemo(() => {
    const s = new Set<string>()
    for (const p of activePlacements) s.add(`${p.lot_id}:${p.kien_label}`)
    return s
  }, [activePlacements])

  const placedSlotLookup = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of activePlacements) {
      const fc = p.slot_code.includes("-R") ? p.slot_code.substring(0, p.slot_code.indexOf("-R")) : p.slot_code
      m.set(`${p.lot_id}:${p.kien_label}`, `${fc} T${p.stack_level}`)
    }
    return m
  }, [activePlacements])

  // Build options từ lots
  const opts = useMemo(() => ({
    csr: [...new Set(lots.map(l => l.loai_csr))].filter(Boolean).sort(),
    boc: [...new Set(lots.map(l => l.boc))].filter(Boolean).sort(),
    dayChuyen: [...new Set(lots.map(l => l.day_chuyen))].filter(Boolean).sort(),
  }), [lots])

  // Lọc nội bộ — HIDES non-matching lots (khác với filter sơ đồ kho dùng opacity)
  const sortedLots = useMemo(() => {
    return lots.filter(l => {
      if (search && !l.ma_lo.toLowerCase().includes(search.toLowerCase())) return false
      if (filterCsr && l.loai_csr !== filterCsr) return false
      if (filterBoc && l.boc !== filterBoc) return false
      if (filterDayChuyen && l.day_chuyen !== filterDayChuyen) return false
      return true
    })
  }, [lots, search, filterCsr, filterBoc, filterDayChuyen])

  const toggleLot = (id: string) => {
    setExpandedLots(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handlePanelDragOver = (e: React.DragEvent) => {
    if (!onRemovePlacement) return
    const types = e.dataTransfer.types
    if (!types.includes("kien")) return
    e.preventDefault()
    setIsDragBackOver(true)
  }

  const handlePanelDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragBackOver(false)
  }

  const handlePanelDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragBackOver(false)
    if (!onRemovePlacement) return
    const raw = e.dataTransfer.getData("kien")
    if (!raw) return
    try {
      const data: DragKienData = JSON.parse(raw)
      if (data.placementId) await onRemovePlacement(data.placementId)
    } catch { /* ignore */ }
  }

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm mb-3 transition-all duration-150 ${
        isDragBackOver
          ? "border-orange-400 ring-2 ring-orange-300 ring-dashed bg-orange-50/30"
          : "border-slate-200"
      }`}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
    >
      {/* Header + filter nội bộ */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 flex-wrap">
        <span className="text-xs font-extrabold text-slate-700 shrink-0">Lô cần đặt kho</span>
        <span className="text-[10px] text-slate-400 shrink-0">{sortedLots.length}/{lots.length} lô</span>
        {/* Search mã lô */}
        <div className="relative">
          <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Mã lô..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-5 pr-2 py-0.5 text-[10px] border border-slate-200 rounded-lg outline-none focus:border-emerald-500 w-20"
          />
        </div>
        {/* CSR filter */}
        <select
          value={filterCsr}
          onChange={e => setFilterCsr(e.target.value)}
          className="px-1.5 py-0.5 text-[10px] border border-slate-200 rounded-lg outline-none focus:border-emerald-500 max-w-[90px]"
        >
          <option value="">Tất cả CSR</option>
          {opts.csr.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        {/* Bọc filter */}
        <select
          value={filterBoc}
          onChange={e => setFilterBoc(e.target.value)}
          className="px-1.5 py-0.5 text-[10px] border border-slate-200 rounded-lg outline-none focus:border-emerald-500 max-w-[90px]"
        >
          <option value="">Tất cả bọc</option>
          {opts.boc.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        {isDragBackOver ? (
          <span className="text-[10px] text-orange-500 font-bold ml-auto animate-pulse">↩ Thả để hoàn trả kiện</span>
        ) : (
          <span className="text-[10px] text-slate-300 ml-auto">kéo lô/kiện vào sơ đồ →</span>
        )}
      </div>

      {/* Danh sách lô theo chiều ngang, scroll */}
      <div className="flex gap-2 overflow-x-auto px-3 py-2 items-start">
        {sortedLots.length === 0 ? (
          <div className="text-xs text-slate-400 py-3 px-2">Không có lô</div>
        ) : (
          sortedLots.map(lot => {
            const c = getCsrColor(lot.loai_csr)
            const isExpanded = expandedLots.has(lot.id)
            const maxBanh = getMaxBanh(lot.loai_banh)
            const placedCount = KIEN_LABELS.filter(k => placedKienSet.has(`${lot.id}:${k}`)).length
            const allPlaced = placedCount === 4

            // Kiện còn trong lô (kien_X > 0 && chưa đặt)
            const availableKiens = KIEN_LABELS.filter(k => getKienBanh(lot, k) > 0)
            const unplacedKiens = availableKiens.filter(k => !placedKienSet.has(`${lot.id}:${k}`))

            const lotDragData: DragLotData = {
              lotId: lot.id,
              maLo: lot.ma_lo,
              loaiCsr: lot.loai_csr,
              dayChuyen: lot.day_chuyen,
              kienLabels: unplacedKiens,
              kiensData: unplacedKiens.map(k => ({ label: k, banh: getKienBanh(lot, k) })),
            }

            return (
              <div
                key={lot.id}
                className={`shrink-0 rounded-xl border overflow-hidden transition-all duration-150 ${c.border}`}
                style={{ minWidth: 110, maxWidth: 130 }}
              >
                {/* Lot header — draggable (lot drag) + click to expand */}
                <div
                  className={`flex items-center gap-1 px-2 py-1.5 ${c.bg} cursor-grab active:cursor-grabbing`}
                  draggable={unplacedKiens.length > 0}
                  onDragStart={e => {
                    if (unplacedKiens.length === 0) { e.preventDefault(); return }
                    e.dataTransfer.setData("lot", JSON.stringify(lotDragData))
                    e.dataTransfer.effectAllowed = "move"
                    onDragLotStart(lotDragData)
                  }}
                  onDragEnd={onDragEnd}
                >
                  <GripVertical size={10} className={`${c.text} opacity-60 shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[10px] font-extrabold ${c.text} truncate`}>{lot.ma_lo}</div>
                    <div className={`text-[9px] ${c.text} opacity-70`}>{lot.loai_csr}</div>
                  </div>
                  {/* Badge */}
                  {allPlaced ? (
                    <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1 rounded-full font-bold shrink-0">✓</span>
                  ) : placedCount > 0 ? (
                    <span className="text-[8px] bg-amber-100 text-amber-700 px-1 rounded-full font-bold shrink-0">{placedCount}/4</span>
                  ) : null}
                  {/* Expand toggle */}
                  <button
                    onClick={e => { e.stopPropagation(); toggleLot(lot.id) }}
                    className={`${c.text} opacity-60 hover:opacity-100 shrink-0`}
                  >
                    {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  </button>
                </div>

                {/* Kiện A/B/C/D — chỉ hiện khi expand */}
                {isExpanded && (
                  <div className="bg-white px-1.5 py-1.5 grid grid-cols-2 gap-1">
                    {KIEN_LABELS.map(kien => {
                      const banh = getKienBanh(lot, kien)
                      if (banh === 0) return null
                      const isPlaced = placedKienSet.has(`${lot.id}:${kien}`)
                      const placedSlot = placedSlotLookup.get(`${lot.id}:${kien}`)
                      const isFull = banh >= maxBanh
                      const dragData: DragKienData = {
                        lotId: lot.id, maLo: lot.ma_lo,
                        kienLabel: kien, kienBanh: banh,
                        loaiCsr: lot.loai_csr, dayChuyen: lot.day_chuyen,
                      }
                      return (
                        <div
                          key={kien}
                          draggable={!isPlaced}
                          onDragStart={e => {
                            if (isPlaced) { e.preventDefault(); return }
                            e.dataTransfer.setData("kien", JSON.stringify(dragData))
                            e.dataTransfer.effectAllowed = "move"
                            onDragKienStart(dragData)
                          }}
                          onDragEnd={onDragEnd}
                          className={`rounded-lg border px-1.5 py-1 transition-all text-center ${
                            isPlaced
                              ? "opacity-40 cursor-default bg-slate-50 border-slate-200"
                              : `cursor-grab active:cursor-grabbing ${c.bg} ${c.border} hover:shadow-sm hover:scale-105`
                          }`}
                        >
                          <div className={`text-[9px] font-extrabold ${isPlaced ? "text-slate-400" : c.text}`}>
                            K{kien}
                          </div>
                          <div className={`text-[8px] ${!isFull ? "text-amber-600 font-bold" : isPlaced ? "text-slate-400" : "text-slate-500"}`}>
                            {banh}{!isFull ? "⚠" : ""}
                          </div>
                          {isPlaced && placedSlot && (
                            <div className="text-[7px] text-emerald-600 font-bold">→{placedSlot}</div>
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
    </div>
  )
}
