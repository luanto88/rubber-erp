"use client"

import { AlertTriangle } from "lucide-react"
import WarehouseSlotCell from "./warehouse-slot-cell"
import {
  type WarehouseCode,
  type WarehouseSlot,
  type WarehousePlacement,
  type DragKienData,
  KHO1_LAYOUT,
  KHO2_LAYOUT,
  WAREHOUSE_LABELS,
} from "./warehouse-types"

type Props = {
  activeWarehouse: WarehouseCode
  slots: WarehouseSlot[]
  allPlacements: WarehousePlacement[]
  onDrop: (data: DragKienData, slotCode: string, warehouseCode: WarehouseCode) => Promise<void>
  onRemovePlacement: (placementId: string) => Promise<void>
  onClearExported: (placementId: string) => Promise<void>
  dragWarning: string | null
}

export default function WarehouseFloorPlan({
  activeWarehouse,
  slots,
  allPlacements,
  onDrop,
  onRemovePlacement,
  onClearExported,
  dragWarning,
}: Props) {
  const layout = activeWarehouse === "kho1" ? KHO1_LAYOUT : KHO2_LAYOUT

  // Build lookup: slot_code → slot config
  const slotMap = new Map(slots.map(s => [s.slot_code, s]))

  // Build placement lookup: slot_code → placements[]
  const placementsBySlot = new Map<string, { active: WarehousePlacement[]; exported: WarehousePlacement[] }>()
  for (const p of allPlacements) {
    if (!placementsBySlot.has(p.slot_code)) {
      placementsBySlot.set(p.slot_code, { active: [], exported: [] })
    }
    const bucket = placementsBySlot.get(p.slot_code)!
    if (p.removed_at) {
      bucket.exported.push(p)
    } else {
      bucket.active.push(p)
    }
  }

  const renderRow = (
    row: Array<{ code: string; restricted: boolean; gap?: boolean }>,
    rowLabel: string
  ) => (
    <div className="flex items-end gap-1 flex-wrap">
      {/* Row label */}
      <span className="text-[10px] font-extrabold text-slate-400 w-4 text-center self-start pt-1">
        {rowLabel}
      </span>
      {row.map((item, i) => {
        if (item.gap) {
          return (
            <div key={`gap-${i}`} className="w-3 flex items-center justify-center">
              <div className="w-px h-8 bg-slate-200" />
            </div>
          )
        }
        const slot = slotMap.get(item.code)
        if (!slot) {
          // Slot config chưa có (nhà máy khác) — render placeholder
          return (
            <div
              key={item.code}
              className={`rounded border-2 border-dashed flex items-center justify-center ${item.restricted ? "border-red-200 bg-red-50/30" : "border-slate-100 bg-slate-50"}`}
              style={{ minWidth: 72, minHeight: 56 }}
            >
              <span className="text-[9px] text-slate-300">{item.code}</span>
            </div>
          )
        }
        const bucket = placementsBySlot.get(item.code) || { active: [], exported: [] }
        return (
          <WarehouseSlotCell
            key={item.code}
            slot={slot}
            placements={bucket.active}
            exportedPlacements={bucket.exported}
            onDrop={(data, slotCode) => onDrop(data, slotCode, activeWarehouse)}
            onRemovePlacement={onRemovePlacement}
            onClearExported={onClearExported}
          />
        )
      })}
    </div>
  )

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      {/* Tên kho */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-extrabold text-slate-700">
          {WAREHOUSE_LABELS[activeWarehouse]}
        </h2>
        <div className="flex items-center gap-3 text-[10px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded border-2 border-slate-300 inline-block" /> Thường
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded border-2 border-dashed border-red-400 inline-block bg-red-50" /> Khuyến cáo
          </span>
        </div>
      </div>

      {/* Cảnh báo kéo sai kho */}
      {dragWarning && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
          <AlertTriangle size={13} className="shrink-0" />
          {dragWarning}
        </div>
      )}

      {/* Layout kho */}
      <div className="space-y-4 overflow-x-auto pb-1">
        {/* Hàng A */}
        <div>
          <div className="text-[10px] text-slate-400 mb-1 ml-5">Hàng A</div>
          {renderRow(layout.rowA, "A")}
        </div>

        {/* Lối đi / Cửa */}
        <div className="flex items-center gap-2 ml-5">
          <div className="flex-1 border-t-2 border-dashed border-slate-200" />
          <span className="text-[10px] text-slate-400 font-bold px-2">Lối đi</span>
          <div className="flex-1 border-t-2 border-dashed border-slate-200" />
        </div>

        {/* Hàng B */}
        <div>
          <div className="text-[10px] text-slate-400 mb-1 ml-5">Hàng B</div>
          {renderRow(layout.rowB, "B")}
        </div>
      </div>

      {/* Chú thích hướng khu sản xuất */}
      <div className="mt-3 flex justify-end">
        <span className="text-[10px] text-slate-400 border border-slate-200 rounded px-2 py-0.5">
          ← Khu sản xuất
        </span>
      </div>
    </div>
  )
}
