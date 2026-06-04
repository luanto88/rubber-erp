"use client"

import { useState } from "react"
import { Plus, X, Eye, ExternalLink, Trash2 } from "lucide-react"
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
  placements: WarehousePlacement[]        // active
  exportedPlacements: WarehousePlacement[] // đã xuất, hiện mờ
  onDrop: (data: DragKienData, slotCode: string) => Promise<void>
  onRemovePlacement: (placementId: string) => Promise<void>
  onClearExported: (placementId: string) => Promise<void>
}

export default function WarehouseSlotCell({
  slot,
  placements,
  exportedPlacements,
  onDrop,
  onRemovePlacement,
  onClearExported,
}: Props) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [popupPlacementId, setPopupPlacementId] = useState<string | null>(null)
  const [hovering, setHovering] = useState(false)

  const activePlacements = placements.filter(p => !p.removed_at)
  const isFull = activePlacements.length >= slot.max_stack
  const nextLevel = findNextStackLevel(placements, slot.max_stack)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!isFull) setIsDragOver(true)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const raw = e.dataTransfer.getData("kien")
    if (!raw) return
    try {
      const data: DragKienData = JSON.parse(raw)
      await onDrop(data, slot.slot_code)
    } catch {
      // invalid data
    }
  }

  const isEmpty = activePlacements.length === 0 && exportedPlacements.length === 0

  // Tất cả kiện để render (active + exported)
  const allItems = [
    ...activePlacements.map(p => ({ ...p, isExported: false })),
    ...exportedPlacements.map(p => ({ ...p, isExported: true })),
  ].sort((a, b) => a.stack_level - b.stack_level)

  return (
    <div
      className={`
        relative rounded-lg border-2 transition-all duration-150 select-none
        ${slot.is_restricted
          ? "border-dashed border-red-300 bg-red-50/60"
          : "border-slate-200 bg-white"
        }
        ${isDragOver && !isFull ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200 scale-[1.02]" : ""}
        ${isFull && isDragOver ? "border-red-300 bg-red-50" : ""}
      `}
      style={{ minWidth: 72, minHeight: 56 }}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Header: slot code + badge */}
      <div className={`flex items-center justify-between px-1.5 pt-1 pb-0.5`}>
        <span className={`text-[10px] font-extrabold ${slot.is_restricted ? "text-red-500" : "text-slate-500"}`}>
          {slot.slot_code}
        </span>
        <span className={`text-[9px] font-bold px-1 rounded-full ${
          activePlacements.length >= slot.max_stack
            ? "bg-red-100 text-red-600"
            : activePlacements.length > 0
            ? "bg-amber-100 text-amber-700"
            : "bg-slate-100 text-slate-400"
        }`}>
          {activePlacements.length}/{slot.max_stack}
        </span>
      </div>

      {/* Cảnh báo restricted */}
      {slot.is_restricted && hovering && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-red-600 text-white text-[10px] rounded-lg whitespace-nowrap z-50 shadow-lg pointer-events-none">
          Khu vực khuyến cáo — chỉ dùng khi kho đầy
        </div>
      )}

      {/* Nội dung: empty state hoặc stack 3D */}
      <div className="px-1 pb-1">
        {isEmpty ? (
          <div className={`flex items-center justify-center h-8 rounded border border-dashed ${
            isDragOver ? "border-emerald-400" : "border-slate-200"
          }`}>
            <Plus size={10} className="text-slate-300" />
          </div>
        ) : (
          <div
            className={`relative transition-all duration-200 ${hovering ? "pb-2" : ""}`}
            style={{ minHeight: 32 }}
          >
            {/* 3D Layer Slices effect */}
            {allItems.map((item, idx) => {
              const lot = item.lots
              const c = getCsrColor(lot?.loai_csr || "")
              const maxB = getMaxBanh(lot?.loai_banh || 35)
              const banh = lot ? (
                item.kien_label === "A" ? lot.kien_a :
                item.kien_label === "B" ? lot.kien_b :
                item.kien_label === "C" ? lot.kien_c : lot.kien_d
              ) : 0
              const isPartial = banh > 0 && banh < maxB

              // Offset 3D per level
              const totalLevels = allItems.length
              const offsetY = hovering
                ? idx * 26   // expand khi hover: tách rõ từng tầng
                : idx * 5    // compact: chồng nhau, lộ 5px
              const offsetX = hovering ? 0 : idx * 2
              const shadowStr = idx === totalLevels - 1
                ? "shadow-[2px_3px_8px_rgba(0,0,0,0.18)]"
                : "shadow-[1px_2px_4px_rgba(0,0,0,0.10)]"
              const zIndex = hovering ? idx : totalLevels - idx

              return (
                <div
                  key={item.id}
                  className={`
                    absolute left-0 right-0 rounded transition-all duration-200 cursor-pointer
                    ${item.isExported ? "opacity-40 grayscale" : ""}
                    ${c.bg} ${c.border} border
                    ${shadowStr}
                  `}
                  style={{
                    top: offsetY,
                    left: offsetX,
                    right: -offsetX,
                    zIndex,
                    padding: "2px 4px",
                  }}
                  onClick={() => setPopupPlacementId(popupPlacementId === item.id ? null : item.id)}
                >
                  {/* Badge tầng */}
                  <span className={`absolute bottom-0.5 left-0.5 text-[7px] font-bold ${c.text} opacity-70`}>
                    T{item.stack_level}
                  </span>

                  {/* Nội dung kiện */}
                  <div className={`text-[9px] font-bold ${c.text} leading-tight truncate`}>
                    {lot?.loai_csr || "—"}
                  </div>
                  <div className="text-[8px] text-slate-600 truncate">
                    {lot?.ma_lo} · {item.kien_label}
                  </div>
                  {isPartial && (
                    <span className="text-[7px] text-amber-600 font-bold">{banh}🍂</span>
                  )}
                  {item.isExported && (
                    <div className="absolute inset-0 flex items-center justify-center rounded">
                      <span className="text-[8px] font-extrabold text-slate-500 bg-white/80 px-1 rounded">Xuất</span>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Spacer để slot đủ cao theo số kiện */}
            <div style={{ height: hovering ? allItems.length * 26 + 16 : Math.max(32, allItems.length * 5 + 18) }} />
          </div>
        )}
      </div>

      {/* Popup khi click vào kiện */}
      {popupPlacementId && (() => {
        const item = allItems.find(i => i.id === popupPlacementId)
        if (!item) return null
        const lot = item.lots
        const banh = lot ? (
          item.kien_label === "A" ? lot.kien_a :
          item.kien_label === "B" ? lot.kien_b :
          item.kien_label === "C" ? lot.kien_c : lot.kien_d
        ) : 0
        return (
          <div
            className="absolute z-[100] bottom-full left-1/2 -translate-x-1/2 mb-1 bg-white rounded-xl border border-slate-200 shadow-2xl p-3 w-52 text-xs"
            onClick={e => e.stopPropagation()}
          >
            <button
              className="absolute top-1.5 right-1.5 text-slate-400 hover:text-slate-600"
              onClick={() => setPopupPlacementId(null)}
            >
              <X size={12} />
            </button>
            <div className="font-extrabold text-slate-800 mb-1">{lot?.ma_lo} · Kiện {item.kien_label}</div>
            <div className="space-y-0.5 text-slate-600">
              <div>CSR: <span className="font-bold">{lot?.loai_csr}</span></div>
              <div>Số bành: <span className="font-bold">{banh}</span></div>
              <div>Bọc: <span className="font-bold">{lot?.boc || "—"}</span></div>
              <div>Ngày sx: <span className="font-bold">{lot?.ngay_ht || lot?.ngay_sx || "—"}</span></div>
              <div>Tầng: <span className="font-bold">T{item.stack_level}</span></div>
            </div>
            <div className="flex gap-1.5 mt-2">
              {!item.isExported ? (
                <>
                  <button
                    className="flex-1 flex items-center justify-center gap-1 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-bold transition-colors"
                    onClick={async () => { await onRemovePlacement(item.id); setPopupPlacementId(null) }}
                    title="Di chuyển kiện về panel"
                  >
                    <Trash2 size={10} />Di chuyển
                  </button>
                  <a
                    href="/dashboard/product"
                    className="flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 rounded-lg text-emerald-700 font-bold transition-colors"
                    title="Xem lô"
                  >
                    <Eye size={10} />Lô
                  </a>
                </>
              ) : (
                <>
                  <button
                    className="flex-1 flex items-center justify-center gap-1 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-bold transition-colors"
                    onClick={async () => { await onClearExported(item.id); setPopupPlacementId(null) }}
                  >
                    <X size={10} />Dọn
                  </button>
                  {item.export_order_id && (
                    <a
                      href="/dashboard/export"
                      className="flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded-lg text-blue-700 font-bold transition-colors"
                      title="Xem đơn xuất"
                    >
                      <ExternalLink size={10} />Đơn
                    </a>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })()}

      {/* Đóng popup khi click ngoài */}
      {popupPlacementId && (
        <div className="fixed inset-0 z-[99]" onClick={() => setPopupPlacementId(null)} />
      )}
    </div>
  )
}
