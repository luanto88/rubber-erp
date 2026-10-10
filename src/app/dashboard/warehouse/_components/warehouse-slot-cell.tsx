"use client"

import { useState } from "react"
import { X, Eye, ExternalLink, Trash2 } from "lucide-react"
import {
  type WarehouseSlot,
  type WarehousePlacement,
  type DragKienData,
  getCsrColor,
  getMaxBanh,
  findNextStackLevel,
} from "./warehouse-types"

type Props = {
  slot: WarehouseSlot
  placements: WarehousePlacement[]          // active
  exportedPlacements: WarehousePlacement[]  // đã xuất
  onDrop: (data: DragKienData, slotCode: string) => Promise<void>
  onRemovePlacement: (placementId: string) => Promise<void>
  onClearExported: (placementId: string) => Promise<void>
  dimmed?: boolean    // true = opacity-30 khi filter active
  expanded?: boolean  // true = frame đang hover → ô phóng to
}

export default function WarehouseSlotCell({
  slot,
  placements,
  exportedPlacements,
  onDrop,
  onRemovePlacement,
  onClearExported,
  dimmed = false,
  expanded = false,
}: Props) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [showPopup, setShowPopup] = useState(false)
  const [hovering, setHovering] = useState(false)

  const activePlacements = placements.filter(p => !p.removed_at)
  const isFull = activePlacements.length >= slot.max_stack

  // Top active item (highest stack_level) — dùng cho drag-back
  const topActivePlacement = activePlacements.length > 0
    ? activePlacements.reduce((a, b) => b.stack_level > a.stack_level ? b : a)
    : null

  const handleCellDragStart = (e: React.DragEvent) => {
    if (!topActivePlacement) { e.preventDefault(); return }
    const lot = topActivePlacement.lots
    const kienBanh = lot
      ? (topActivePlacement.kien_label === "A" ? lot.kien_a
        : topActivePlacement.kien_label === "B" ? lot.kien_b
        : topActivePlacement.kien_label === "C" ? lot.kien_c
        : lot.kien_d)
      : 0
    const dragData: DragKienData = {
      lotId: topActivePlacement.lot_id,
      maLo: lot?.ma_lo || "",
      kienLabel: topActivePlacement.kien_label,
      kienBanh: kienBanh,
      loaiCsr: lot?.loai_csr || "",
      dayChuyen: lot?.day_chuyen || "",
      placementId: topActivePlacement.id,
    }
    e.dataTransfer.setData("kien", JSON.stringify(dragData))
    e.dataTransfer.effectAllowed = "move"
    e.stopPropagation()
  }

  const handleDragOver = (e: React.DragEvent) => {
    // Chỉ nhận kiện đơn — lot drop được xử lý ở frame level
    const types = e.dataTransfer.types
    if (!types.includes("kien")) return
    e.preventDefault()
    if (!isFull) setIsDragOver(true)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const raw = e.dataTransfer.getData("kien")
    if (!raw) return
    try {
      const data: DragKienData = JSON.parse(raw)
      await onDrop(data, slot.slot_code)
    } catch { /* ignore */ }
  }

  // Tất cả kiện để render (active + exported), sort by level
  const allItems = [
    ...activePlacements.map(p => ({ ...p, isExported: false })),
    ...exportedPlacements.map(p => ({ ...p, isExported: true })),
  ].sort((a, b) => a.stack_level - b.stack_level)

  const isEmpty = allItems.length === 0

  // Màu tổng hợp của cell (theo kiện trên cùng)
  const topItem = allItems[allItems.length - 1]
  const topColor = topItem ? getCsrColor(topItem.lots?.loai_csr || "") : null

  const cellSize = expanded ? 52 : 22

  return (
    <div
      className={`relative transition-all duration-150 select-none overflow-hidden
        ${dimmed ? "opacity-30" : ""}
        ${slot.is_restricted
          ? "border border-dashed border-red-300 bg-red-50/50 rounded-sm"
          : "border border-slate-200 bg-white rounded-sm"
        }
        ${isDragOver && !isFull ? "border-emerald-400 bg-emerald-50 scale-110 z-10" : ""}
        ${isFull && isDragOver ? "border-red-300 bg-red-50" : ""}
        ${activePlacements.length > 0 ? "cursor-grab active:cursor-grabbing" : ""}
      `}
      style={{ width: cellSize, height: cellSize, position: "relative" }}
      draggable={activePlacements.length > 0}
      onDragStart={handleCellDragStart}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={e => {
        if (allItems.length > 0) { e.stopPropagation(); setShowPopup(true) }
      }}
    >
      {/* Nội dung ô: colored fill + stack indicator */}
      {!isEmpty && (
        <>
          {/* Màu nền theo stack layers (từ dưới lên) */}
          <div className="absolute inset-0.5 flex flex-col gap-px rounded-sm overflow-hidden">
            {allItems.map((item) => {
              const c = getCsrColor(item.lots?.loai_csr || "")
              return (
                <div
                  key={item.id}
                  className={`flex-1 flex items-center justify-center ${item.isExported ? "opacity-30 grayscale" : ""} ${c.bgDark}`}
                >
                  {/* Khi expanded: hiện text ngắn */}
                  {expanded && (
                    <span className={`text-[7px] font-bold text-white/90 leading-none truncate px-0.5`}>
                      {item.lots?.ma_lo?.slice(-4)}{item.kien_label}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {/* Stack count badge */}
          {activePlacements.length > 0 && (
            <span className="absolute bottom-0 right-0 text-[5px] leading-none font-bold text-white bg-black/40 px-px rounded-tl-sm">
              {activePlacements.length}
            </span>
          )}
        </>
      )}

      {/* Tooltip khi hover */}
      {hovering && allItems.length > 0 && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 pointer-events-none z-[200]
          bg-sky-100 border border-sky-300 text-[9px] rounded-lg px-2 py-1.5 whitespace-nowrap shadow-xl">
          <div className="font-bold text-sky-700 mb-0.5">{slot.slot_code}</div>
          {allItems.map(item => {
            const kienBanh = item.lots
              ? (item.kien_label === "A" ? item.lots.kien_a
                : item.kien_label === "B" ? item.lots.kien_b
                : item.kien_label === "C" ? item.lots.kien_c
                : item.lots.kien_d)
              : null
            return (
              <div key={item.id} className="text-orange-500 leading-relaxed">
                <span className="font-semibold">{item.lots?.ma_lo}</span>
                {" · "}{item.kien_label}
                {" · T"}{item.stack_level}
                {item.lots?.loai_csr && <span className="font-semibold"> · {item.lots.loai_csr}</span>}
                {kienBanh != null && kienBanh > 0 && <span> · {kienBanh} bánh</span>}
                {item.lots?.boc && <span> · {item.lots.boc}</span>}
                {item.isExported && <span className="text-slate-400"> (Xuất)</span>}
              </div>
            )
          })}
        </div>
      )}
      {hovering && allItems.length === 0 && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 pointer-events-none z-[200]
          bg-sky-50 border border-sky-200 text-sky-500 text-[9px] rounded-lg px-2 py-1 whitespace-nowrap shadow-xl">
          {slot.slot_code}
          {slot.is_restricted && <span className="ml-1 text-red-400">⚠ Khuyến cáo</span>}
        </div>
      )}

      {/* Popup chi tiết khi click */}
      {showPopup && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setShowPopup(false)} />
          <div
            className="absolute z-[200] bottom-full left-1/2 -translate-x-1/2 mb-1 bg-white rounded-xl border border-slate-200 shadow-2xl p-3 w-52 text-xs"
            style={{ transform: "translateX(-50%)" }}
            onClick={e => e.stopPropagation()}
          >
            <button
              className="absolute top-1.5 right-1.5 text-slate-400 hover:text-slate-600"
              onClick={() => setShowPopup(false)}
            >
              <X size={12} />
            </button>
            <div className="font-extrabold text-slate-700 mb-2 text-[10px]">{slot.slot_code}</div>

            {allItems.map(item => {
              const lot = item.lots
              const banh = lot
                ? (item.kien_label === "A" ? lot.kien_a : item.kien_label === "B" ? lot.kien_b : item.kien_label === "C" ? lot.kien_c : lot.kien_d)
                : 0
              const c = getCsrColor(lot?.loai_csr || "")
              return (
                <div key={item.id} className={`mb-2 pb-2 border-b border-slate-100 last:border-0 last:mb-0 last:pb-0`}>
                  <div className={`font-bold ${c.text} mb-0.5`}>{lot?.ma_lo} · Kiện {item.kien_label}</div>
                  <div className="text-slate-500 space-y-px">
                    <div>CSR: <span className="font-bold text-slate-700">{lot?.loai_csr}</span></div>
                    <div>Bành: <span className="font-bold text-slate-700">{banh}</span></div>
                    {lot?.boc && <div>Bọc: <span className="font-bold text-slate-700">{lot.boc}</span></div>}
                    <div>Tầng: <span className="font-bold text-slate-700">T{item.stack_level}</span></div>
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    {!item.isExported ? (
                      <>
                        <button
                          className="flex-1 flex items-center justify-center gap-1 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 font-bold text-[10px] transition-colors"
                          onClick={async () => { await onRemovePlacement(item.id); setShowPopup(false) }}
                        >
                          <Trash2 size={10} /> Di chuyển
                        </button>
                        <a
                          href="/dashboard/product"
                          className="flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 rounded-lg text-emerald-700 font-bold text-[10px] transition-colors"
                        >
                          <Eye size={10} /> Lô
                        </a>
                      </>
                    ) : (
                      <>
                        <button
                          className="flex-1 flex items-center justify-center gap-1 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 font-bold text-[10px] transition-colors"
                          onClick={async () => { await onClearExported(item.id); setShowPopup(false) }}
                        >
                          <X size={10} /> Dọn
                        </button>
                        {item.export_order_id && (
                          <a
                            href="/dashboard/export"
                            className="flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded-lg text-blue-700 font-bold text-[10px] transition-colors"
                          >
                            <ExternalLink size={10} /> Đơn
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
