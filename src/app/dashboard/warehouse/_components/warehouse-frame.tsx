"use client"

import { useState } from "react"
import WarehouseSlotCell from "./warehouse-slot-cell"
import {
  type FrameConfig,
  type WarehouseSlot,
  type WarehousePlacement,
  type DragKienData,
  type DragLotData,
  type PlacementTarget,
  distributeKienToFrame,
} from "./warehouse-types"

type Props = {
  frameConfig: FrameConfig
  slots: WarehouseSlot[]                    // ô trong khung này
  activePlacements: WarehousePlacement[]    // active trong kho này
  exportedPlacements: WarehousePlacement[]  // đã xuất (hiện mờ)
  onDropKien: (data: DragKienData, slotCode: string) => Promise<void>
  onDropLot: (targets: PlacementTarget[], lotData: DragLotData) => Promise<void>
  onRemovePlacement: (placementId: string) => Promise<void>
  onClearExported: (placementId: string) => Promise<void>
  matchingLotIds: Set<string>    // lot_ids khớp filter (rỗng = không filter)
  filterActive: boolean
}

export default function WarehouseFrame({
  frameConfig,
  slots,
  activePlacements,
  exportedPlacements,
  onDropKien,
  onDropLot,
  onRemovePlacement,
  onClearExported,
  matchingLotIds,
  filterActive,
}: Props) {
  const [isLotDragOver, setIsLotDragOver] = useState(false)
  const [isHovering, setIsHovering] = useState(false)

  // Build lookup: slot_code → placements
  const placementsBySlot = new Map<string, { active: WarehousePlacement[]; exported: WarehousePlacement[] }>()
  for (const slot of slots) {
    placementsBySlot.set(slot.slot_code, { active: [], exported: [] })
  }
  for (const p of activePlacements) {
    const b = placementsBySlot.get(p.slot_code)
    if (b) b.active.push(p)
  }
  for (const p of exportedPlacements) {
    const b = placementsBySlot.get(p.slot_code)
    if (b) b.exported.push(p)
  }

  // Xác định ô có dimmed không (filter)
  const isSlotDimmed = (slotCode: string): boolean => {
    if (!filterActive || matchingLotIds.size === 0) return false
    const bucket = placementsBySlot.get(slotCode)
    if (!bucket || bucket.active.length === 0) return false
    // Dim nếu TẤT CẢ kiện trong ô không khớp filter
    return bucket.active.every(p => !matchingLotIds.has(p.lot_id))
  }

  // Xây grid cells theo frame_row, frame_col
  const cellGrid: (WarehouseSlot | null)[][] = []
  for (let r = 1; r <= frameConfig.numRows; r++) {
    const row: (WarehouseSlot | null)[] = []
    for (let c = 1; c <= frameConfig.numCols; c++) {
      const sc = `${frameConfig.code}-R${r}C${c}`
      row.push(slots.find(s => s.slot_code === sc) || null)
    }
    cellGrid.push(row)
  }

  // Handle drag over frame (lot drop)
  const handleFrameDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (types.includes("lot")) {
      e.preventDefault()
      e.stopPropagation()
      setIsLotDragOver(true)
    }
  }

  // Handle drop on frame (lot drop)
  const handleFrameDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsLotDragOver(false)
    const raw = e.dataTransfer.getData("lot")
    if (!raw) return
    try {
      const lotData: DragLotData = JSON.parse(raw)
      const targets = distributeKienToFrame(
        frameConfig.code,
        frameConfig,
        slots,
        activePlacements,
        lotData.kienLabels,
      )
      // Truyền targets (null → empty array) để page.tsx xử lý toast
      await onDropLot(targets ?? [], lotData)
    } catch { /* ignore */ }
  }

  const borderClass = frameConfig.isRestricted
    ? "border border-dashed border-red-400 bg-red-50/30"
    : "border border-slate-300 bg-white"

  const lotDragOverClass = isLotDragOver
    ? "ring-2 ring-sky-400 ring-offset-1 bg-sky-50/60"
    : ""

  const hoverClass = isHovering && !isLotDragOver
    ? "ring-1 ring-slate-300 shadow-md z-10"
    : ""

  const cellSize = isHovering ? 52 : 22

  return (
    <div
      className={`relative flex flex-col rounded-sm transition-all duration-100 ${borderClass} ${lotDragOverClass} ${hoverClass}`}
      onDragOver={handleFrameDragOver}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsLotDragOver(false)
      }}
      onDrop={handleFrameDrop}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Grid cells — rows × cols, phóng to khi hover */}
      <div
        className="grid gap-px p-px transition-all duration-150"
        style={{
          gridTemplateColumns: `repeat(${frameConfig.numCols}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${frameConfig.numRows}, ${cellSize}px)`,
        }}
      >
        {cellGrid.map((row, rowIdx) =>
          row.map((slot, colIdx) => {
            if (!slot) {
              // Placeholder cell (slot chưa load)
              return (
                <div
                  key={`empty-${rowIdx}-${colIdx}`}
                  className="border border-dashed border-slate-100 rounded-sm"
                  style={{ width: cellSize, height: cellSize }}
                />
              )
            }
            const bucket = placementsBySlot.get(slot.slot_code) || { active: [], exported: [] }
            return (
              <WarehouseSlotCell
                key={slot.slot_code}
                slot={slot}
                placements={bucket.active}
                exportedPlacements={bucket.exported}
                onDrop={onDropKien}
                onRemovePlacement={onRemovePlacement}
                onClearExported={onClearExported}
                dimmed={isSlotDimmed(slot.slot_code)}
                expanded={isHovering}
              />
            )
          })
        )}
      </div>

      {/* Label khung — bên dưới */}
      <div className={`text-center text-[9px] font-bold leading-tight pt-px pb-0.5
        ${frameConfig.isRestricted ? "text-red-400" : "text-slate-400"}`}>
        {frameConfig.code}
      </div>

      {/* Overlay khi lot hover */}
      {isLotDragOver && (
        <div className="absolute inset-0 bg-sky-100/40 rounded-sm flex items-center justify-center pointer-events-none z-10">
          <span className="text-[8px] font-bold text-sky-700 bg-white/90 px-1 rounded shadow">Thả lô</span>
        </div>
      )}
    </div>
  )
}
