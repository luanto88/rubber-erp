"use client"

import { useState, useEffect, useCallback } from "react"
import { X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import WarehouseKpi from "./_components/warehouse-kpi"
import WarehouseFloorPlan from "./_components/warehouse-floor-plan"
import LotPanel from "./_components/lot-panel"
import WarehouseFilterBar from "./_components/warehouse-filter-bar"
import {
  type WarehouseCode,
  type WarehouseSlot,
  type WarehousePlacement,
  type LotInfo,
  type DragKienData,
  type DragLotData,
  type PlacementTarget,
  type FilterState,
  EMPTY_FILTER,
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

  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [dragWarning, setDragWarning] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: "error" | "success" } | null>(null)

  const showToast = (msg: string, type: "error" | "success" = "error") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  // Bootstrap
  useEffect(() => {
    const bootstrap = async () => {
      const cachedUser = JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
      if (!hasPermission(cachedUser, "warehouse.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
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
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from("warehouse_lot_placements")
      .select(`
        *,
        lots (
          id, ma_lo, loai_csr, loai_banh, boc, pallet,
          kien_a, kien_b, kien_c, kien_d, tong_banh, tong_kg,
          trang_thai, ngay_sx, ngay_ht, day_chuyen, suffix, ghi_chu
        )
      `)
      .eq("factory_id", fid)
      .or(`removed_at.is.null,removed_at.gte.${sevenDaysAgo}`)
      .order("placed_at", { ascending: false })
    setPlacements((data as WarehousePlacement[]) || [])
  }, [])

  const loadLots = useCallback(async (fid: string) => {
    // Chấp nhận tất cả lô Hoàn thành (kể cả dở dang)
    const { data } = await supabase
      .from("lots")
      .select("id, ma_lo, loai_csr, loai_banh, boc, pallet, kien_a, kien_b, kien_c, kien_d, tong_banh, tong_kg, trang_thai, ngay_sx, ngay_ht, day_chuyen, suffix, ghi_chu")
      .eq("factory_id", fid)
      .in("trang_thai", ["Hoàn thành", "Xuất hàng"])
      .order("ngay_ht", { ascending: false, nullsFirst: false })
    // Lọc: phải có ít nhất 1 kiện còn bánh
    const filtered = (data as LotInfo[] || []).filter(l =>
      l.kien_a > 0 || l.kien_b > 0 || l.kien_c > 0 || l.kien_d > 0
    )
    setLots(filtered)
  }, [])

  useEffect(() => {
    if (!factoryId) return
    const load = async () => {
      setLoading(true)
      try {
        await Promise.all([loadSlots(factoryId), loadPlacements(factoryId), loadLots(factoryId)])
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [factoryId, loadSlots, loadPlacements, loadLots])

  // Realtime subscribe
  useEffect(() => {
    if (!factoryId) return
    const channel = supabase
      .channel(`warehouse-${factoryId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "warehouse_lot_placements",
        filter: `factory_id=eq.${factoryId}`,
      }, () => void loadPlacements(factoryId))
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "lots",
        filter: `factory_id=eq.${factoryId}`,
      }, () => { void loadLots(factoryId); void loadPlacements(factoryId) })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [factoryId, loadPlacements, loadLots])

  // Lấy userId session
  const getUserId = async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id || null
  }

  // Drop kiện đơn vào slot cụ thể
  const handleDropKien = useCallback(async (
    data: DragKienData,
    slotCode: string,
    warehouseCode: WarehouseCode
  ) => {
    if (!factoryId) return

    const recommended = getRecommendedWarehouse(data.dayChuyen)
    if (recommended && recommended !== warehouseCode) {
      setDragWarning(`Lô "${data.maLo}" nên đặt vào ${WAREHOUSE_LABELS[recommended]}`)
    }

    const slot = slots.find(s => s.warehouse_code === warehouseCode && s.slot_code === slotCode)
    if (!slot) return

    const slotPlacements = placements.filter(
      p => p.warehouse_code === warehouseCode && p.slot_code === slotCode && !p.removed_at
    )
    const nextLevel = findNextStackLevel(slotPlacements, slot.max_stack)
    if (nextLevel === null) {
      showToast(`Ô ${slotCode} đã đầy (${slot.max_stack} tầng)`); return
    }

    const existing = placements.find(
      p => p.lot_id === data.lotId && p.kien_label === data.kienLabel && !p.removed_at
    )
    const userId = await getUserId()

    if (existing) {
      const { error } = await supabase
        .from("warehouse_lot_placements")
        .update({ removed_at: new Date().toISOString(), removed_by: userId })
        .eq("id", existing.id)
      if (error) { showToast("Lỗi di chuyển: " + error.message); return }
    }

    const { error } = await supabase
      .from("warehouse_lot_placements")
      .insert({
        factory_id: factoryId, warehouse_code: warehouseCode,
        slot_code: slotCode, stack_level: nextLevel,
        lot_id: data.lotId, kien_label: data.kienLabel, placed_by: userId,
      })

    if (error) {
      showToast("Lỗi đặt kiện: " + error.message)
    } else {
      setDragWarning(null)
      showToast(`Đã đặt ${data.maLo} · Kiện ${data.kienLabel} → ${slotCode} T${nextLevel}`, "success")
      void loadPlacements(factoryId)
    }
  }, [factoryId, slots, placements, loadPlacements])

  // Drop cả lô vào khung — auto-phân bổ 4 kiện theo sap_kien
  const handleDropLot = useCallback(async (
    targets: PlacementTarget[],
    lotData: DragLotData,
    warehouseCode: WarehouseCode
  ) => {
    if (!factoryId) return
    if (targets.length === 0) {
      showToast(`Khung không đủ chỗ để đặt lô "${lotData.maLo}"`)
      return
    }

    const recommended = getRecommendedWarehouse(lotData.dayChuyen)
    if (recommended && recommended !== warehouseCode) {
      setDragWarning(`Lô "${lotData.maLo}" nên đặt vào ${WAREHOUSE_LABELS[recommended]}`)
    }

    const userId = await getUserId()

    // Di chuyển các kiện đang có placement active
    const toRemove = placements.filter(
      p => p.lot_id === lotData.lotId &&
           lotData.kienLabels.includes(p.kien_label) &&
           !p.removed_at
    )
    for (const p of toRemove) {
      await supabase
        .from("warehouse_lot_placements")
        .update({ removed_at: new Date().toISOString(), removed_by: userId })
        .eq("id", p.id)
    }

    // Insert placements mới
    const inserts = targets.map(t => ({
      factory_id: factoryId,
      warehouse_code: warehouseCode,
      slot_code: t.slotCode,
      stack_level: t.stackLevel,
      lot_id: lotData.lotId,
      kien_label: t.kienLabel,
      placed_by: userId,
    }))

    const { error } = await supabase
      .from("warehouse_lot_placements")
      .insert(inserts)

    if (error) {
      showToast("Lỗi đặt lô: " + error.message)
    } else {
      setDragWarning(null)
      showToast(`Đã đặt ${lotData.maLo} (${targets.length} kiện) vào kho`, "success")
      void loadPlacements(factoryId)
    }
  }, [factoryId, placements, loadPlacements])

  // Di chuyển kiện về panel
  const handleRemovePlacement = useCallback(async (placementId: string) => {
    if (!factoryId) return
    const userId = await getUserId()
    const { error } = await supabase
      .from("warehouse_lot_placements")
      .update({ removed_at: new Date().toISOString(), removed_by: userId })
      .eq("id", placementId)
    if (error) showToast("Lỗi di chuyển: " + error.message)
    else void loadPlacements(factoryId)
  }, [factoryId, loadPlacements])

  // Dọn placement đã xuất
  const handleClearExported = useCallback(async (placementId: string) => {
    if (!factoryId) return
    const { error } = await supabase
      .from("warehouse_lot_placements")
      .delete()
      .eq("id", placementId)
    if (error) showToast("Lỗi dọn kho: " + error.message)
    else void loadPlacements(factoryId)
  }, [factoryId, loadPlacements])

  const currentSlots = slots.filter(s => s.warehouse_code === activeWarehouse)
  const currentPlacements = placements.filter(p => p.warehouse_code === activeWarehouse)
  const activePlacements = placements.filter(p => !p.removed_at)

  if (loading) {
    return <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
  }

  return (
    <div className="p-4 h-full flex flex-col">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl max-w-xl
          ${toast.type === "error" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"}`}>
          <span className="text-sm font-bold">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Kho thành phẩm</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý vị trí kiện trong kho theo sơ đồ thực tế</p>
        </div>
        {/* Tab chọn kho */}
        <div className="flex gap-1">
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
      </div>

      {/* KPI */}
      <WarehouseKpi placements={placements} slots={slots} />

      {/* Panel lô — horizontal strip bên dưới KPI */}
      <LotPanel
        lots={lots}
        activePlacements={activePlacements}
        onDragKienStart={() => {}}
        onDragLotStart={() => {}}
        onDragEnd={() => setDragWarning(null)}
        onRemovePlacement={handleRemovePlacement}
      />

      {/* Filter bar */}
      <WarehouseFilterBar lots={lots} filter={filter} onChange={setFilter} />

      {/* Sơ đồ kho — full width, scroll nếu rộng */}
      <div className="flex-1 min-h-0 overflow-auto">
        <WarehouseFloorPlan
          activeWarehouse={activeWarehouse}
          slots={currentSlots}
          allPlacements={currentPlacements}
          onDropKien={handleDropKien}
          onDropLot={handleDropLot}
          onRemovePlacement={handleRemovePlacement}
          onClearExported={handleClearExported}
          dragWarning={dragWarning}
          filter={filter}
          lots={lots}
        />
      </div>
    </div>
  )
}
