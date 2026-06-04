"use client"

import { useState, useEffect, useCallback } from "react"
import { AlertTriangle, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"
import WarehouseKpi from "./_components/warehouse-kpi"
import WarehouseFloorPlan from "./_components/warehouse-floor-plan"
import LotPanel from "./_components/lot-panel"
import {
  type WarehouseCode,
  type WarehouseSlot,
  type WarehousePlacement,
  type LotInfo,
  type DragKienData,
  findNextStackLevel,
  getRecommendedWarehouse,
  WAREHOUSE_LABELS,
} from "./_components/warehouse-types"

export default function WarehousePage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeWarehouse, setActiveWarehouse] = useState<WarehouseCode>("kho1")

  const [slots, setSlots] = useState<WarehouseSlot[]>([])
  const [placements, setPlacements] = useState<WarehousePlacement[]>([])
  const [lots, setLots] = useState<LotInfo[]>([])

  const [filterNgayFrom, setFilterNgayFrom] = useState("")
  const [filterNgayTo, setFilterNgayTo] = useState("")

  const [dragWarning, setDragWarning] = useState<string | null>(null)
  const [draggingData, setDraggingData] = useState<DragKienData | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: "error" | "success" } | null>(null)

  const showToast = (msg: string, type: "error" | "success" = "error") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  // Bootstrap
  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
    }
    void bootstrap()
  }, [])

  const loadSlots = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("warehouse_slots")
      .select("*")
      .eq("factory_id", fid)
      .eq("is_active", true)
      .order("sort_order")
    setSlots((data as WarehouseSlot[]) || [])
  }, [])

  const loadPlacements = useCallback(async (fid: string) => {
    // Load active placements + recently exported (last 7 days) để hiện mờ
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from("warehouse_lot_placements")
      .select(`
        *,
        lots (
          id, ma_lo, loai_csr, loai_banh, boc, pallet,
          kien_a, kien_b, kien_c, kien_d, tong_banh, tong_kg,
          trang_thai, ngay_sx, ngay_ht, day_chuyen, suffix
        )
      `)
      .eq("factory_id", fid)
      .or(`removed_at.is.null,removed_at.gte.${sevenDaysAgo}`)
      .order("placed_at", { ascending: false })
    setPlacements((data as WarehousePlacement[]) || [])
  }, [])

  const loadLots = useCallback(async (fid: string) => {
    // Chỉ lô "Hoàn thành" + lô tròn (tong_banh IN 144, 240)
    const { data } = await supabase
      .from("lots")
      .select("id, ma_lo, loai_csr, loai_banh, boc, pallet, kien_a, kien_b, kien_c, kien_d, tong_banh, tong_kg, trang_thai, ngay_sx, ngay_ht, day_chuyen, suffix")
      .eq("factory_id", fid)
      .eq("trang_thai", "Hoàn thành")
      .in("tong_banh", [144, 240])
      .order("ngay_ht", { ascending: false, nullsFirst: false })
    setLots((data as LotInfo[]) || [])
  }, [])

  useEffect(() => {
    if (!factoryId) return
    const load = async () => {
      setLoading(true)
      try {
        await Promise.all([
          loadSlots(factoryId),
          loadPlacements(factoryId),
          loadLots(factoryId),
        ])
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [factoryId, loadSlots, loadPlacements, loadLots])

  // Supabase Realtime: tự update khi placements thay đổi
  useEffect(() => {
    if (!factoryId) return
    let channel = supabase
      .channel(`warehouse-placements-${factoryId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "warehouse_lot_placements",
        filter: `factory_id=eq.${factoryId}`,
      }, () => {
        void loadPlacements(factoryId)
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "lots",
        filter: `factory_id=eq.${factoryId}`,
      }, () => {
        void loadLots(factoryId)
        void loadPlacements(factoryId)
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [factoryId, loadPlacements, loadLots])

  // Xử lý drop kiện vào slot
  const handleDrop = useCallback(async (
    data: DragKienData,
    slotCode: string,
    warehouseCode: WarehouseCode
  ) => {
    if (!factoryId) return

    // Cảnh báo nếu kéo sai kho
    const recommended = getRecommendedWarehouse(data.dayChuyen)
    if (recommended && recommended !== warehouseCode) {
      setDragWarning(
        `Lô "${data.maLo}" (${data.dayChuyen}) nên đặt vào ${WAREHOUSE_LABELS[recommended]}. Vẫn đặt vào ${WAREHOUSE_LABELS[warehouseCode]}?`
      )
      // Vẫn tiếp tục (chỉ cảnh báo, không chặn)
    }

    // Lấy slot config
    const slot = slots.find(s => s.warehouse_code === warehouseCode && s.slot_code === slotCode)
    if (!slot) return

    // Tìm tầng trống
    const slotPlacements = placements.filter(
      p => p.warehouse_code === warehouseCode && p.slot_code === slotCode && !p.removed_at
    )
    const nextLevel = findNextStackLevel(slotPlacements, slot.max_stack)
    if (nextLevel === null) {
      showToast(`Slot ${slotCode} đã đầy (${slot.max_stack}/${slot.max_stack} tầng)`)
      return
    }

    // Kiểm tra kiện đã có placement chưa
    const existing = placements.find(
      p => p.lot_id === data.lotId && p.kien_label === data.kienLabel && !p.removed_at
    )

    // Lấy user session
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData?.session?.user?.id || null

    if (existing) {
      // Di chuyển: soft delete placement cũ
      const { error: delErr } = await supabase
        .from("warehouse_lot_placements")
        .update({ removed_at: new Date().toISOString(), removed_by: userId })
        .eq("id", existing.id)
      if (delErr) { showToast("Lỗi di chuyển kiện: " + delErr.message); return }
    }

    // Insert placement mới
    const { error } = await supabase
      .from("warehouse_lot_placements")
      .insert({
        factory_id: factoryId,
        warehouse_code: warehouseCode,
        slot_code: slotCode,
        stack_level: nextLevel,
        lot_id: data.lotId,
        kien_label: data.kienLabel,
        placed_by: userId,
      })

    if (error) {
      showToast("Lỗi đặt kiện: " + error.message)
    } else {
      setDragWarning(null)
      showToast(`Đã đặt ${data.maLo} · Kiện ${data.kienLabel} → ${slotCode} T${nextLevel}`, "success")
      void loadPlacements(factoryId)
    }
  }, [factoryId, slots, placements, loadPlacements])

  // Xóa placement (di chuyển về panel)
  const handleRemovePlacement = useCallback(async (placementId: string) => {
    if (!factoryId) return
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData?.session?.user?.id || null
    const { error } = await supabase
      .from("warehouse_lot_placements")
      .update({ removed_at: new Date().toISOString(), removed_by: userId })
      .eq("id", placementId)
    if (error) {
      showToast("Lỗi di chuyển: " + error.message)
    } else {
      void loadPlacements(factoryId)
    }
  }, [factoryId, loadPlacements])

  // Xóa placement đã xuất (dọn kho)
  const handleClearExported = useCallback(async (placementId: string) => {
    if (!factoryId) return
    const { error } = await supabase
      .from("warehouse_lot_placements")
      .delete()
      .eq("id", placementId)
    if (error) {
      showToast("Lỗi dọn kho: " + error.message)
    } else {
      void loadPlacements(factoryId)
    }
  }, [factoryId, loadPlacements])

  const currentWarehouseSlots = slots.filter(s => s.warehouse_code === activeWarehouse)
  const currentWarehousePlacements = placements.filter(p => p.warehouse_code === activeWarehouse)
  const activePlacements = placements.filter(p => !p.removed_at)

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
    )
  }

  return (
    <div className="p-4 h-full flex flex-col">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl max-w-xl transition-all
          ${toast.type === "error" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"}`}>
          <span className="text-sm font-bold">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Kho thành phẩm</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý vị trí kiện trong kho theo sơ đồ thực tế</p>
        </div>
      </div>

      {/* KPI */}
      <WarehouseKpi
        placements={placements}
        slots={slots}
        filterNgayFrom={filterNgayFrom}
        filterNgayTo={filterNgayTo}
        onFilterNgayFrom={setFilterNgayFrom}
        onFilterNgayTo={setFilterNgayTo}
      />

      {/* Tab chọn kho */}
      <div className="flex gap-1 mb-3">
        {(["kho1", "kho2"] as WarehouseCode[]).map(wh => (
          <button
            key={wh}
            onClick={() => { setActiveWarehouse(wh); setDragWarning(null) }}
            className={`px-4 py-2 text-sm font-bold rounded-xl transition-all ${
              activeWarehouse === wh
                ? "bg-emerald-600 text-white shadow-md"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {WAREHOUSE_LABELS[wh]}
          </button>
        ))}
      </div>

      {/* Main split layout */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Sơ đồ kho ~70% */}
        <div className="flex-1 min-w-0 overflow-auto">
          <WarehouseFloorPlan
            activeWarehouse={activeWarehouse}
            slots={currentWarehouseSlots}
            allPlacements={currentWarehousePlacements}
            onDrop={handleDrop}
            onRemovePlacement={handleRemovePlacement}
            onClearExported={handleClearExported}
            dragWarning={dragWarning}
          />
        </div>

        {/* Panel lô ~30% */}
        <div className="w-72 shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <LotPanel
            lots={lots}
            activePlacements={activePlacements}
            onDragStart={setDraggingData}
            onDragEnd={() => setDraggingData(null)}
          />
        </div>
      </div>
    </div>
  )
}
