"use client"

import { AlertTriangle } from "lucide-react"
import WarehouseFrame from "./warehouse-frame"
import {
  type WarehouseCode,
  type WarehouseSlot,
  type WarehousePlacement,
  type DragKienData,
  type DragLotData,
  type PlacementTarget,
  type FilterState,
  type LotInfo,
  KHO1_FRAMES,
  KHO2_FRAMES,
  WAREHOUSE_LABELS,
  isLotMatching,
  isFilterActive,
} from "./warehouse-types"

type Props = {
  activeWarehouse: WarehouseCode
  slots: WarehouseSlot[]
  allPlacements: WarehousePlacement[]
  onDropKien: (data: DragKienData, slotCode: string, wh: WarehouseCode) => Promise<void>
  onDropLot: (targets: PlacementTarget[], lotData: DragLotData, wh: WarehouseCode) => Promise<void>
  onRemovePlacement: (placementId: string) => Promise<void>
  onClearExported: (placementId: string) => Promise<void>
  dragWarning: string | null
  filter: FilterState
  lots: LotInfo[]
}

export default function WarehouseFloorPlan({
  activeWarehouse,
  slots,
  allPlacements,
  onDropKien,
  onDropLot,
  onRemovePlacement,
  onClearExported,
  dragWarning,
  filter,
  lots,
}: Props) {
  const frames = activeWarehouse === "kho1" ? KHO1_FRAMES : KHO2_FRAMES
  const filterOn = isFilterActive(filter)

  // Build matchingLotIds set
  const matchingLotIds = new Set(
    filterOn ? lots.filter(l => isLotMatching(l, filter)).map(l => l.id) : []
  )

  // Get slots belonging to a frame — match by slot_code prefix to work even if frame_code is null in DB
  const getFrameSlots = (frameCode: string): WarehouseSlot[] =>
    slots.filter(s => s.slot_code.startsWith(`${frameCode}-R`))

  const getFrameActivePlacements = (frameCode: string): WarehousePlacement[] => {
    const prefix = `${frameCode}-R`
    return allPlacements.filter(p => !p.removed_at && p.slot_code.startsWith(prefix))
  }

  const getFrameExportedPlacements = (frameCode: string): WarehousePlacement[] => {
    const prefix = `${frameCode}-R`
    return allPlacements.filter(p => !!p.removed_at && p.slot_code.startsWith(prefix))
  }

  // Render một hàng (A hoặc B)
  const renderRow = (rowLabel: "A" | "B") => {
    const rowFrames = frames.filter(f => f.rowLabel === rowLabel)
    return (
      <div className="flex items-end gap-1 flex-wrap">
        {rowFrames.map((fc, idx) => (
          <div key={fc.code} className="flex items-end gap-1">
            <WarehouseFrame
              frameConfig={fc}
              slots={getFrameSlots(fc.code)}
              activePlacements={getFrameActivePlacements(fc.code)}
              exportedPlacements={getFrameExportedPlacements(fc.code)}
              onDropKien={(data, sc) => onDropKien(data, sc, activeWarehouse)}
              onDropLot={(targets, lotData) => onDropLot(targets, lotData, activeWarehouse)}
              onRemovePlacement={onRemovePlacement}
              onClearExported={onClearExported}
              matchingLotIds={matchingLotIds}
              filterActive={filterOn}
            />
            {/* Lối đi nhỏ sau khung */}
            {fc.aisleAfterThis && (
              <div className="flex flex-col items-center justify-end" style={{ width: 12, height: fc.numRows * 19 + 14 }}>
                <div className="flex-1 border-l border-dashed border-slate-200 mx-auto" style={{ width: 1 }} />
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  const isKho1 = activeWarehouse === "kho1"

  return (
    <div className="relative bg-white rounded-xl border-2 border-amber-500 shadow-sm overflow-hidden">
      {/* Header kho + legend */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-amber-100 bg-amber-50/40">
        <div>
          <span className="text-sm font-extrabold text-slate-700">{WAREHOUSE_LABELS[activeWarehouse]}</span>
        </div>
        <div className="flex items-center gap-3 text-[9px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 border border-slate-300 rounded-sm inline-block" /> Thường
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 border border-dashed border-red-400 rounded-sm inline-block bg-red-50" /> Khuyến cáo
          </span>
          {filterOn && (
            <span className="flex items-center gap-1 text-sky-600 font-bold">
              <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" /> Filter đang bật
            </span>
          )}
        </div>
      </div>

      {/* Cảnh báo drag sai kho */}
      {dragWarning && (
        <div className="flex items-center gap-2 mx-3 mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
          <AlertTriangle size={13} className="shrink-0" />
          {dragWarning}
        </div>
      )}

      {/* Main body — relative để đặt label Cửa/Khu sản xuất */}
      <div className="relative flex">
        {/* Floor plan area */}
        <div className="flex-1 p-3 overflow-x-auto">
          {/* Label hàng A mờ nhỏ */}
          <div className="text-[9px] text-slate-300 italic mb-1 ml-1">Hàng A</div>

          {/* Cửa — top right (giữa hàng A và viền phải) */}
          <div className="relative">
            {renderRow("A")}
            {isKho1 && (
              <span className="absolute -top-1 right-0 text-[9px] text-slate-300 font-normal">Cửa</span>
            )}
          </div>

          {/* Lối đi chính giữa 2 hàng */}
          <div className="flex items-center gap-2 my-2 ml-1">
            <div className="flex-1 border-t border-dashed border-slate-200" />
            <span className="text-[9px] text-slate-300 italic px-1">Lối đi</span>
            <div className="flex-1 border-t border-dashed border-slate-200" />
          </div>

          {/* Label hàng B mờ nhỏ */}
          <div className="text-[9px] text-slate-300 italic mb-1 ml-1">Hàng B</div>

          {/* Hàng B + Cửa bottom-left */}
          <div className="relative">
            <span className="absolute -left-1 -bottom-1 text-[9px] text-slate-300 font-normal">Cửa</span>
            {renderRow("B")}
          </div>

          {/* Cửa bottom-center */}
          <div className="flex justify-center mt-1">
            <span className="text-[9px] text-slate-300 font-normal">Cửa</span>
          </div>
        </div>

        {/* KHU SẢN XUẤT — dải nhỏ màu cam */}
        <div className="flex items-center justify-center w-5 shrink-0 border-l border-orange-200 bg-orange-500/10">
          <span
            className="text-[8px] text-orange-500 font-semibold"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", letterSpacing: 1 }}
          >
            Khu SX
          </span>
        </div>
      </div>

      {/* Legend bottom */}
      <div className="px-3 pb-2 flex gap-3 text-[9px] text-slate-300 italic">
        <span>⬛ = 1 kiện · chồng max 3 tầng</span>
        <span>Kéo từng kiện hoặc cả lô vào ô/khung</span>
      </div>
    </div>
  )
}
