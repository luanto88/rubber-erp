"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as XLSX from "xlsx"
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  PackageSearch,
  Printer,
  QrCode,
  ShieldAlert,
  Warehouse,
  X,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { QrScanButton, QrScanPortal } from "@/app/dashboard/_components/qr-scan-portal"
import { getFreshAuthSession } from "@/lib/auth"
import {
  PALLET_COMPONENT_ITEMS,
  PALLET_COMPONENT_LABEL,
  PALLET_COMPONENT_ORDER,
  palletGroupOfItemCode,
} from "@/lib/pallet-usage"
import { loadPalletFlow, type PalletFlowResult } from "../pallet-flow-actions"
import { InventoryPageShell, ScrollReveal, ScrollRevealSection } from "../_components/inventory-shell"
import {
  loadInventorySnapshotData,
  type InventoryCategoryOption,
  type InventoryItemOption,
  type InventoryLotBalanceRow,
  type InventoryStockBalanceRow,
  type InventoryWarehouseOption,
  type InventoryWarehouseRule,
} from "../_components/inventory-data"
import { InventoryActionButton, InventoryActionLink, MultiSelectField } from "../_components/inventory-ui"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"

function SummaryCard({
  icon,
  label,
  value,
  note,
  tone = "text-slate-800",
}: {
  icon: React.ReactNode
  label: string
  value: string
  note: string
  tone?: string
}) {
  const [iconBg, borderAccent] = tone.includes("amber")
    ? ["bg-amber-50 text-amber-600", "border-l-amber-400"]
    : tone.includes("rose")
      ? ["bg-rose-50 text-rose-600", "border-l-rose-400"]
      : tone.includes("blue")
        ? ["bg-blue-50 text-blue-600", "border-l-blue-400"]
        : tone.includes("violet")
          ? ["bg-violet-50 text-violet-600", "border-l-violet-400"]
          : ["bg-emerald-50 text-emerald-600", "border-l-emerald-400"]

  return (
    <div
      className={`rounded-2xl border border-slate-200 border-l-4 ${borderAccent} bg-white p-5 shadow-sm hover-lift`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-xl p-3 ${iconBg}`}>{icon}</div>
        <div className="text-right">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
          <div className={`mt-2 text-2xl font-extrabold ${tone}`}>{value}</div>
        </div>
      </div>
      <div className="mt-3 text-sm leading-relaxed text-slate-500">{note}</div>
    </div>
  )
}

function formatDate(value: string | null) {
  if (!value) return "Chưa có"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("vi-VN")
}

function getRule(itemId: string, warehouseId: string, rules: InventoryWarehouseRule[]) {
  return rules.find((rule) => rule.item_id === itemId && rule.warehouse_id === warehouseId) || null
}

type PeriodMovement = {
  warehouse_id: string
  item_id: string
  quantity_in: number
  quantity_out: number
  movement_date: string
}

/** Phát sinh kho từ `fromDate` (hoặc toàn bộ nếu trống) — phân trang, PostgREST cắt 1000 dòng/lần. */
async function fetchPeriodMovements(factoryId: string, fromDate: string): Promise<PeriodMovement[]> {
  const PAGE = 1000
  const all: PeriodMovement[] = []
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("inventory_stock_movements")
      .select("id, warehouse_id, item_id, quantity_in, quantity_out, movement_date")
      .eq("factory_id", factoryId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (fromDate) query = query.gte("movement_date", fromDate)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    const rows = (data || []) as (PeriodMovement & { id: string })[]
    for (const row of rows) {
      all.push({
        warehouse_id: row.warehouse_id,
        item_id: row.item_id,
        quantity_in: Number(row.quantity_in || 0),
        quantity_out: Number(row.quantity_out || 0),
        movement_date: String(row.movement_date || "").slice(0, 10),
      })
    }
    if (rows.length < PAGE) break
  }
  return all
}

/**
 * QR thẻ kho trỏ `/dashboard/inventory/item?code=…&warehouseId=…`; QR bồn dầu chỉ có `warehouseId`.
 * Chấp nhận cả mã vật tư trần.
 */
function parseItemQr(text: string): { code: string | null; warehouseId: string | null } {
  const raw = text.trim()
  try {
    const url = new URL(raw)
    if (url.pathname.includes("/dashboard/inventory/item")) {
      return { code: url.searchParams.get("code"), warehouseId: url.searchParams.get("warehouseId") }
    }
  } catch {
    // không phải URL ⇒ coi là mã vật tư
  }
  return { code: raw || null, warehouseId: null }
}

export default function InventoryOnHandPage() {
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState<string | null>(null)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [categories, setCategories] = useState<InventoryCategoryOption[]>([])
  const [warehouseRules, setWarehouseRules] = useState<InventoryWarehouseRule[]>([])
  const [stockBalances, setStockBalances] = useState<InventoryStockBalanceRow[]>([])
  const [lotBalances, setLotBalances] = useState<InventoryLotBalanceRow[]>([])
  const [selectedWarehouseIds, setSelectedWarehouseIds] = useState<string[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [periodMovements, setPeriodMovements] = useState<PeriodMovement[]>([])
  const [periodLoading, setPeriodLoading] = useState(false)
  const [periodError, setPeriodError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanKey, setScanKey] = useState(0)
  const [scanLog, setScanLog] = useState<{ id: number; ok: boolean; text: string }[]>([])
  const lastScanRef = useRef<{ text: string; at: number } | null>(null)

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventorySnapshotData()
        setFactoryId(inventoryData.factoryId || null)
        setWarning(inventoryData.warning)
        setWarehouses(inventoryData.warehouses)
        setItems(inventoryData.items)
        setCategories(inventoryData.categories || [])
        setWarehouseRules(inventoryData.warehouseRules)
        setStockBalances(inventoryData.stockBalances)
        setLotBalances(inventoryData.lotBalances)
      } finally {
        setLoading(false)
      }
    }

    void bootstrap()
  }, [])

  const periodActive = Boolean(fromDate || toDate)
  const periodInvalid = Boolean(fromDate && toDate && fromDate > toDate)

  // Tải phát sinh từ ngày bắt đầu kỳ (trống ⇒ toàn bộ lịch sử) để tính tồn đầu/nhập/xuất/tồn cuối.
  useEffect(() => {
    // Khi tắt kỳ, dữ liệu cũ không được dùng (mọi chỗ đọc đều kiểm `periodReady`).
    if (!factoryId || !periodActive || periodInvalid) return
    let alive = true
    const run = async () => {
      try {
        setPeriodLoading(true)
        setPeriodError(null)
        const rows = await fetchPeriodMovements(factoryId, fromDate)
        if (alive) setPeriodMovements(rows)
      } catch (err) {
        if (alive) {
          setPeriodMovements([])
          setPeriodError(err instanceof Error ? err.message : "Không tải được phát sinh kho")
        }
      } finally {
        if (alive) setPeriodLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [factoryId, fromDate, periodActive, periodInvalid])

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])),
    [warehouses],
  )
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const periodReady = periodActive && !periodInvalid && !periodLoading && !periodError

  // Dầu dùng chung bồn: tồn tính theo cả bồn của kho ⇒ phát sinh cũng gộp theo bồn.
  const periodKey = useCallback(
    (warehouseId: string, itemId: string) =>
      itemMap.get(itemId)?.uses_shared_oil_stock ? `${warehouseId}::pool` : `${warehouseId}::${itemId}`,
    [itemMap],
  )

  /** Theo khoá: nhập/xuất TRONG kỳ và phần thay đổi ròng SAU ngày cuối kỳ (để lùi tồn hiện tại về cuối kỳ). */
  const periodTotals = useMemo(() => {
    const map = new Map<string, { inQty: number; outQty: number; netAfter: number }>()
    if (!periodReady) return map
    const end = toDate || getFactoryTodayISO()
    for (const m of periodMovements) {
      const key = periodKey(m.warehouse_id, m.item_id)
      const entry = map.get(key) || { inQty: 0, outQty: 0, netAfter: 0 }
      if (m.movement_date > end) entry.netAfter += m.quantity_in - m.quantity_out
      else if (!fromDate || m.movement_date >= fromDate) {
        entry.inQty += m.quantity_in
        entry.outQty += m.quantity_out
      }
      map.set(key, entry)
    }
    return map
  }, [fromDate, periodKey, periodMovements, periodReady, toDate])
  const warehouseFilterSet = useMemo(() => new Set(selectedWarehouseIds), [selectedWarehouseIds])
  const categoryFilterSet = useMemo(() => new Set(selectedCategoryIds), [selectedCategoryIds])
  const itemFilterSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])

  const availableCategories = useMemo(() => {
    const relevantBalances =
      selectedWarehouseIds.length === 0
        ? stockBalances
        : stockBalances.filter((balance) => warehouseFilterSet.has(balance.warehouse_id))

    const presentItemIds = new Set(relevantBalances.map((balance) => balance.item_id))
    const presentCategoryIds = new Set(
      items
        .filter((item) => presentItemIds.has(item.id))
        .map((item) => item.category_id)
        .filter(Boolean),
    )

    return categories.filter((category) => presentCategoryIds.has(category.id))
  }, [categories, items, selectedWarehouseIds.length, stockBalances, warehouseFilterSet])

  const availableItems = useMemo(() => {
    const stockedItemIds = new Set(
      stockBalances
        .filter((balance) => selectedWarehouseIds.length === 0 || warehouseFilterSet.has(balance.warehouse_id))
        .map((balance) => balance.item_id),
    )

    return items.filter((item) => {
      if (!stockedItemIds.has(item.id)) return false
      if (selectedCategoryIds.length > 0 && !categoryFilterSet.has(item.category_id || "")) return false
      return true
    })
  }, [categoryFilterSet, items, selectedCategoryIds.length, selectedWarehouseIds.length, stockBalances, warehouseFilterSet])

  // Chế độ pallet: chỉ bật khi người dùng chọn phân loại có vật tư pallet hoặc chọn mã pallet cụ thể.
  // Khi bật, dòng pallet không tách theo kho mà gộp 1 dòng/nhóm (pallet dùng theo TỔNG mọi kho).
  const palletMode = useMemo(() => {
    if (selectedCategoryIds.length === 0 && selectedItemIds.length === 0) return false
    return items.some(
      (item) =>
        palletGroupOfItemCode(item.code) &&
        (selectedCategoryIds.length === 0 || categoryFilterSet.has(item.category_id || "")) &&
        (selectedItemIds.length === 0 || itemFilterSet.has(item.id)),
    )
  }, [categoryFilterSet, itemFilterSet, items, selectedCategoryIds.length, selectedItemIds.length])

  const onHandRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return stockBalances
      .filter((balance) => selectedWarehouseIds.length === 0 || warehouseFilterSet.has(balance.warehouse_id))
      .map((balance) => {
        const item = itemMap.get(balance.item_id)
        const warehouse = warehouseMap.get(balance.warehouse_id)
        if (!item || !warehouse) return null
        if (selectedCategoryIds.length > 0 && !categoryFilterSet.has(item.category_id || "")) return null
        if (selectedItemIds.length > 0 && !itemFilterSet.has(item.id)) return null
        if (palletMode && palletGroupOfItemCode(item.code)) return null

        const rule = getRule(item.id, balance.warehouse_id, warehouseRules)
        const minStock = Number(rule?.min_stock ?? item.min_stock ?? 0)
        const maxStock = Number(rule?.max_stock ?? item.max_stock ?? 0)
        const matchingLots = lotBalances.filter(
          (lot) => lot.item_id === balance.item_id && lot.warehouse_id === balance.warehouse_id && lot.on_hand > 0,
        )
        const nearestExpiry = matchingLots
          .filter((lot) => lot.expiry_date)
          .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)))[0]?.expiry_date
        const totalOnHand = Number(balance.on_hand || 0)

        if (
          normalizedSearch &&
          !item.code.toLowerCase().includes(normalizedSearch) &&
          !item.name.toLowerCase().includes(normalizedSearch)
        ) {
          return null
        }

        const totals = periodTotals.get(periodKey(balance.warehouse_id, item.id))
        const closing = totalOnHand - (totals?.netAfter || 0)
        const period = periodReady
          ? {
              opening: closing - (totals?.inQty || 0) + (totals?.outQty || 0),
              inQty: totals?.inQty || 0,
              outQty: totals?.outQty || 0,
              closing,
            }
          : null

        return {
          id: `${balance.warehouse_id}-${balance.item_id}`,
          item,
          warehouse,
          categoryName: item.category_name,
          onHand: totalOnHand,
          period,
          minStock,
          maxStock,
          lotCount: matchingLots.length,
          nearestExpiry: nearestExpiry || null,
          status:
            minStock > 0 && totalOnHand < minStock
              ? "low"
              : maxStock > 0 && totalOnHand > maxStock
                ? "high"
                : "safe",
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => {
        const warehouseCompare = a.warehouse.code.localeCompare(b.warehouse.code, "vi")
        if (warehouseCompare !== 0) return warehouseCompare
        const categoryCompare = a.categoryName.localeCompare(b.categoryName, "vi")
        if (categoryCompare !== 0) return categoryCompare
        return a.item.code.localeCompare(b.item.code, "vi")
      })
  }, [
    categoryFilterSet,
    itemFilterSet,
    itemMap,
    lotBalances,
    palletMode,
    periodKey,
    periodReady,
    periodTotals,
    search,
    selectedCategoryIds.length,
    selectedItemIds.length,
    selectedWarehouseIds.length,
    stockBalances,
    warehouseFilterSet,
    warehouseMap,
    warehouseRules,
  ])

  const lotRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return lotBalances
      .filter((lot) => lot.on_hand > 0)
      .filter((lot) => selectedWarehouseIds.length === 0 || warehouseFilterSet.has(lot.warehouse_id))
      .filter((lot) => selectedItemIds.length === 0 || itemFilterSet.has(lot.item_id))
      .map((lot) => {
        const item = itemMap.get(lot.item_id)
        const warehouse = warehouseMap.get(lot.warehouse_id)
        if (!item || !warehouse) return null
        if (selectedCategoryIds.length > 0 && !categoryFilterSet.has(item.category_id || "")) return null

        if (
          normalizedSearch &&
          !item.code.toLowerCase().includes(normalizedSearch) &&
          !item.name.toLowerCase().includes(normalizedSearch) &&
          !lot.lot_no.toLowerCase().includes(normalizedSearch)
        ) {
          return null
        }

        return {
          id: `${lot.warehouse_id}-${lot.item_id}-${lot.lot_no}-${lot.expiry_date || "na"}`,
          item,
          warehouse,
          categoryName: item.category_name,
          lotNo: lot.lot_no,
          expiryDate: lot.expiry_date,
          onHand: Number(lot.on_hand || 0),
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => {
        const warehouseCompare = a.warehouse.code.localeCompare(b.warehouse.code, "vi")
        if (warehouseCompare !== 0) return warehouseCompare
        const categoryCompare = a.categoryName.localeCompare(b.categoryName, "vi")
        if (categoryCompare !== 0) return categoryCompare
        const codeCompare = a.item.code.localeCompare(b.item.code, "vi")
        if (codeCompare !== 0) return codeCompare
        return (a.expiryDate || "9999-12-31").localeCompare(b.expiryDate || "9999-12-31", "vi")
      })
  }, [
    categoryFilterSet,
    itemFilterSet,
    itemMap,
    lotBalances,
    search,
    selectedCategoryIds.length,
    selectedItemIds.length,
    selectedWarehouseIds.length,
    warehouseFilterSet,
    warehouseMap,
  ])

  // ── Pallet: tồn sổ sách + đang lưu dưới kiện TP + luồng trong kỳ (chỉ tính, không ghi phiếu) ──
  const [palletFlow, setPalletFlow] = useState<PalletFlowResult | null>(null)
  const [palletLoading, setPalletLoading] = useState(false)
  const palletPeriodFrom = periodReady ? fromDate : ""
  const palletPeriodTo = periodReady ? toDate || getFactoryTodayISO() : ""

  useEffect(() => {
    if (!factoryId || !palletMode) return
    let alive = true
    const run = async () => {
      try {
        setPalletLoading(true)
        const session = await getFreshAuthSession()
        const result = await loadPalletFlow(factoryId, session?.access_token || null, palletPeriodFrom, palletPeriodTo)
        if (alive) setPalletFlow(result)
      } catch (err) {
        if (alive) setPalletFlow({ success: false, error: err instanceof Error ? err.message : "Lỗi tính pallet" })
      } finally {
        if (alive) setPalletLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [factoryId, palletPeriodFrom, palletPeriodTo, palletMode])

  const palletReady = palletMode && !palletLoading && Boolean(palletFlow?.success)
  const palletError = palletMode && !palletLoading && palletFlow && !palletFlow.success ? palletFlow.error : null

  // 1 dòng / nhóm pallet, gộp MỌI kho (không theo bộ lọc Kho): Tổng sở hữu = sổ sách − mất XK từ mốc;
  // Tồn trống = Tổng sở hữu − Đang lưu dưới kiện TP.
  const palletTableRows = useMemo(() => {
    if (!palletMode) return []
    const normalizedSearch = search.trim().toLowerCase()
    const flow = palletFlow?.success ? palletFlow.byGroup : null
    const categorySelected = selectedCategoryIds.length > 0
    const itemSelected = selectedItemIds.length > 0

    return PALLET_COMPONENT_ORDER.map((c) => {
      const { groupCode, itemCodes } = PALLET_COMPONENT_ITEMS[c]
      const label = PALLET_COMPONENT_LABEL[c]
      const codeSet = new Set(itemCodes.map((x) => x.toUpperCase()))
      const groupItems = items.filter((item) => codeSet.has(item.code.trim().toUpperCase()))
      const matched = groupItems.filter(
        (item) =>
          (!categorySelected || categoryFilterSet.has(item.category_id || "")) &&
          (!itemSelected || itemFilterSet.has(item.id)),
      )
      const f = flow?.[groupCode]
      if (matched.length === 0) {
        // Nhóm chưa có mã trong kho (vd PMB4): chỉ hiện khi lọc theo phân loại và có luồng pallet.
        if (groupItems.length > 0 || !categorySelected || itemSelected) return null
        if (!f || !(f.dangLuu || f.xuatLuu || f.traVe || f.matXuatKhau)) return null
      }
      if (normalizedSearch) {
        const hay = [groupCode, label, ...itemCodes, ...groupItems.map((item) => item.name)].map((s) => s.toLowerCase())
        if (!hay.some((s) => s.includes(normalizedSearch))) return null
      }

      const itemIdSet = new Set(groupItems.map((item) => item.id))
      const byWarehouse = new Map<string, number>()
      let localBook = 0
      let closing = 0
      let inQty = 0
      let outQty = 0
      for (const balance of stockBalances) {
        if (!itemIdSet.has(balance.item_id)) continue
        const qty = Number(balance.on_hand || 0)
        localBook += qty
        byWarehouse.set(balance.warehouse_id, (byWarehouse.get(balance.warehouse_id) || 0) + qty)
        const totals = periodTotals.get(periodKey(balance.warehouse_id, balance.item_id))
        closing += qty - (totals?.netAfter || 0)
        inQty += totals?.inQty || 0
        outQty += totals?.outQty || 0
      }
      const warehouseNote = [...byWarehouse]
        .filter(([, qty]) => qty !== 0)
        .map(([id, qty]) => `${warehouseMap.get(id)?.code || "?"} ${qty.toLocaleString("vi-VN")}`)
        .join(" · ")

      const soSach = f ? f.soSach : localBook
      const matTuMoc = f?.matTuMoc || 0
      const dangLuu = f?.dangLuu || 0
      const tongSoHuu = soSach - matTuMoc
      return {
        id: `pallet-${groupCode}`,
        groupCode,
        label,
        note: itemCodes.length > 1 ? `Gồm ${itemCodes.join(", ")}` : "",
        hasBook: groupItems.length > 0,
        itemIds: groupItems.map((item) => item.id),
        linkCode: groupItems[0]?.code || null,
        unit: groupItems[0]?.unit || "",
        categoryName: groupItems[0]?.category_name || "Pallet",
        warehouseNote,
        period: periodReady ? { opening: closing - inQty + outQty, inQty, outQty, closing } : null,
        soSach,
        mocNgay: f?.mocNgay || null,
        matTuMoc,
        tongSoHuu,
        dangLuu,
        trong: tongSoHuu - dangLuu,
        xuatLuu: f?.xuatLuu || 0,
        traVe: f?.traVe || 0,
        matXuatKhau: f?.matXuatKhau || 0,
      }
    }).filter((row): row is NonNullable<typeof row> => Boolean(row))
  }, [
    categoryFilterSet,
    itemFilterSet,
    items,
    palletFlow,
    palletMode,
    periodKey,
    periodReady,
    periodTotals,
    search,
    selectedCategoryIds.length,
    selectedItemIds.length,
    stockBalances,
    warehouseMap,
  ])

  const searchSuggestions = useMemo(() => {
    const values = new Set<string>()

    onHandRows.forEach((row) => {
      values.add(row.item.code)
      values.add(row.item.name)
    })

    lotRows.forEach((row) => {
      values.add(row.lotNo)
    })

    return [...values].slice(0, 80)
  }, [lotRows, onHandRows])

  const stats = useMemo(() => {
    const lowCount = onHandRows.filter((row) => row.status === "low").length
    const highCount = onHandRows.filter((row) => row.status === "high").length
    const lotManagedCount = onHandRows.filter((row) => row.item.manages_lot || row.item.manages_expiry).length

    return {
      trackedCount: onHandRows.length + palletTableRows.length,
      lowCount,
      highCount,
      lotManagedCount,
      lotCount: lotRows.length,
    }
  }, [lotRows.length, onHandRows, palletTableRows.length])

  // ── Quét QR mã vật tư: quét liên tục, mỗi mã hợp lệ thêm vào bộ lọc "Mã vật tư" ──
  const handleScanDecoded = (text: string) => {
    const trimmed = (text || "").trim()
    const now = Date.now()
    const last = lastScanRef.current
    if (last && last.text === trimmed && now - last.at < 2500) {
      setScanKey((k) => k + 1)
      return
    }
    lastScanRef.current = { text: trimmed, at: now }

    const { code, warehouseId } = parseItemQr(trimmed)
    let matched: InventoryItemOption[] = []
    if (code) {
      const norm = code.trim().toLowerCase()
      matched = items.filter((item) => item.code.trim().toLowerCase() === norm)
    } else if (warehouseId) {
      // QR bồn dầu: mọi mã dầu dùng chung bồn có tồn tại kho đó
      const ids = new Set(stockBalances.filter((b) => b.warehouse_id === warehouseId).map((b) => b.item_id))
      matched = items.filter((item) => item.uses_shared_oil_stock && ids.has(item.id))
    }

    if (matched.length === 0) {
      setScanLog((prev) => [{ id: now, ok: false, text: `Không nhận ra mã: ${code || trimmed}` }, ...prev].slice(0, 30))
    } else {
      const ids = matched.map((item) => item.id)
      setSelectedItemIds((prev) => [...new Set([...prev, ...ids])])
      // Bộ lọc khác đang loại vật tư vừa quét ⇒ gỡ để vật tư hiện ra trong bảng
      if (selectedCategoryIds.length > 0 && matched.some((item) => !categoryFilterSet.has(item.category_id || ""))) {
        setSelectedCategoryIds([])
      }
      if (
        selectedWarehouseIds.length > 0 &&
        !stockBalances.some((b) => ids.includes(b.item_id) && warehouseFilterSet.has(b.warehouse_id))
      ) {
        setSelectedWarehouseIds([])
      }
      setSearch("")
      setScanLog((prev) =>
        [{ id: now, ok: true, text: matched.map((item) => `${item.code} — ${item.name}`).join(", ") }, ...prev].slice(0, 30),
      )
    }
    setScanKey((k) => k + 1)
  }

  const exportStockCount = () => {
    const today = getFactoryTodayISO()
    const fmt = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "")
    const periodText = periodReady
      ? `Kỳ: ${fromDate ? fmt(fromDate) : "đầu kỳ"} – ${fmt(toDate || today)}`
      : `Tồn tại ngày ${fmt(today)}`
    const withPallet = palletMode && palletTableRows.length > 0
    const head = ["STT", "Kho", "Phân loại", "Mã vật tư", "Tên vật tư", "ĐVT"]
    if (periodReady) head.push("Tồn đầu kỳ", "Nhập trong kỳ", "Xuất trong kỳ")
    head.push("Tồn sổ sách")
    if (withPallet) {
      head.push("Đang lưu dưới kiện TP", "Mất XK từ mốc", "Tổng sở hữu", "Tồn trống")
      if (periodReady) head.push("Xuất lưu trong kỳ", "Trả về (xuất rời)", "Mất do xuất khẩu")
    }
    head.push("Tồn thực tế", "Chênh lệch", "Ghi chú")

    const aoa: (string | number)[][] = [
      ["PHIẾU KIỂM TỒN KHO VẬT TƯ"],
      [periodText],
      [],
      head,
    ]
    const bookCol = head.indexOf("Tồn sổ sách")
    const emptyCol = head.indexOf("Tồn trống")
    const actualCol = head.indexOf("Tồn thực tế")
    const colLetter = (index: number) => XLSX.utils.encode_col(index)
    // Cột đối chiếu của từng dòng: pallet so với Tồn trống (đếm pallet trống thực tế), còn lại so sổ sách.
    const compareCols: number[] = []
    let stt = 0
    for (const row of palletTableRows) {
      const line: (string | number)[] = [
        ++stt,
        `Tổng mọi kho${row.warehouseNote ? ` (${row.warehouseNote})` : ""}`,
        row.categoryName,
        row.groupCode,
        `${row.label}${row.note ? ` — ${row.note}` : ""}`,
        row.unit,
      ]
      if (row.period) line.push(row.period.opening, row.period.inQty, row.period.outQty)
      else if (periodReady) line.push("", "", "")
      line.push(row.period ? row.period.closing : row.soSach, row.dangLuu, row.matTuMoc, row.tongSoHuu, row.trong)
      if (periodReady) line.push(row.xuatLuu, row.traVe, row.matXuatKhau)
      line.push("", "", "Đối chiếu với Tồn trống")
      aoa.push(line)
      compareCols.push(emptyCol)
    }
    for (const row of onHandRows) {
      const line: (string | number)[] = [
        ++stt,
        `${row.warehouse.code} - ${row.warehouse.name}`,
        row.categoryName,
        row.item.code,
        row.item.name,
        row.item.unit,
      ]
      if (row.period) line.push(row.period.opening, row.period.inQty, row.period.outQty)
      line.push(row.period ? row.period.closing : row.onHand)
      if (withPallet) line.push(...Array(periodReady ? 7 : 4).fill(""))
      line.push("", "", "")
      aoa.push(line)
      compareCols.push(bookCol)
    }

    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    // Chênh lệch = Thực tế − cột đối chiếu (chỉ tính khi đã nhập số thực tế)
    compareCols.forEach((col, index) => {
      const r = index + 5 // dòng Excel (1-based): 4 dòng đầu là tiêu đề
      const ref = `${colLetter(col)}${r}`
      const actual = `${colLetter(actualCol)}${r}`
      sheet[`${colLetter(actualCol + 1)}${r}`] = { t: "n", f: `IF(${actual}="","",${actual}-${ref})` }
    })
    sheet["!cols"] = head.map((h) =>
      ({ wch: h === "Tên vật tư" ? 36 : h === "Kho" ? 28 : h === "Phân loại" ? 20 : h === "Ghi chú" ? 24 : 12 }),
    )
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, "Kiem ton")
    XLSX.writeFile(book, `kiem-ton-kho-${today}.xlsx`)
  }

  const hasSelection = selectedItemIds.length > 0
  const needSelectionHint = "Chọn ít nhất 1 mã vật tư (bấm dòng trong bảng, chọn ở ô Mã vật tư hoặc quét QR)"

  return (
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title="Tồn kho"
      description="Theo dõi tồn hiện tại theo kho, vật tư, số lô và hạn sử dụng để phục vụ xuất kho, chuyển kho và cảnh báo tồn an toàn."
      action={
        <>
          <InventoryActionButton
            icon={FileSpreadsheet}
            label="Xuất file kiểm tồn"
            tone="emerald"
            title="Xuất Excel kiểm tồn theo bộ lọc hiện tại (có cột Tồn thực tế + Chênh lệch)"
            disabled={
              loading ||
              (onHandRows.length === 0 && palletTableRows.length === 0) ||
              (periodActive && !periodReady) ||
              (palletMode && !palletReady)
            }
            onClick={exportStockCount}
          />
          {hasSelection ? (
            <InventoryActionLink
              icon={QrCode}
              label="In nhãn QR"
              tone="violet"
              title="In nhãn QR dán tại vị trí lưu vật tư (Thẻ kho) cho các vật tư đã chọn"
              href={`/dashboard/inventory/cards?warehouses=${encodeURIComponent(selectedWarehouseIds.join(","))}&items=${encodeURIComponent(selectedItemIds.join(","))}`}
            />
          ) : (
            <InventoryActionButton icon={QrCode} label="In nhãn QR" tone="violet" disabled title={needSelectionHint} />
          )}
          {hasSelection ? (
            <InventoryActionLink
              icon={Printer}
              label="In tồn kho"
              tone="slate"
              title="In tồn kho các vật tư đã chọn"
              href={`/dashboard/inventory/print-report?kind=on-hand&warehouses=${encodeURIComponent(selectedWarehouseIds.join(","))}&categories=${encodeURIComponent(selectedCategoryIds.join(","))}&items=${encodeURIComponent(selectedItemIds.join(","))}&search=${encodeURIComponent(search)}`}
            />
          ) : (
            <InventoryActionButton icon={Printer} label="In tồn kho" tone="slate" disabled title={needSelectionHint} />
          )}
        </>
      }
    >
      {warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-bold">Đang dùng dữ liệu mẫu</div>
          <div className="mt-1 leading-6">{warning}</div>
        </div>
      ) : null}

      <ScrollReveal className="stagger-cards grid gap-4 xl:grid-cols-5">
        <SummaryCard
          icon={<Boxes size={18} />}
          label="Vật tư theo dõi"
          value={stats.trackedCount.toLocaleString("vi-VN")}
          note="Số vật tư đang có tồn trong phạm vi bộ lọc hiện tại."
        />
        <SummaryCard
          icon={<AlertTriangle size={18} />}
          label="Tồn thấp"
          value={stats.lowCount.toLocaleString("vi-VN")}
          note="Các vật tư đang thấp hơn giới hạn dưới."
          tone="text-amber-600"
        />
        <SummaryCard
          icon={<ShieldAlert size={18} />}
          label="Tồn cao"
          value={stats.highCount.toLocaleString("vi-VN")}
          note="Các vật tư đang vượt giới hạn trên."
          tone="text-rose-700"
        />
        <SummaryCard
          icon={<PackageSearch size={18} />}
          label="Theo dõi lô"
          value={stats.lotManagedCount.toLocaleString("vi-VN")}
          note="Số vật tư có quản lý số lô hoặc hạn sử dụng."
          tone="text-blue-700"
        />
        <SummaryCard
          icon={<Clock3 size={18} />}
          label="Lô còn tồn"
          value={stats.lotCount.toLocaleString("vi-VN")}
          note="Tổng số lô còn tồn để chọn khi xuất kho hoặc chuyển kho."
          tone="text-violet-700"
        />
      </ScrollReveal>

      <ScrollRevealSection className="relative z-40 mb-4 grid grid-cols-1 items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-12">
        <div className="sm:col-span-2 lg:col-span-6">
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Tìm vật tư hoặc số lô</label>
          <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white pl-3 pr-1.5 transition-colors focus-within:border-emerald-500">
            <input
              list="inventory-on-hand-suggestions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Mã, tên vật tư hoặc số lô"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Xóa ô tìm"
              >
                <X size={14} />
              </button>
            ) : null}
            <QrScanButton
              onClick={() => {
                setScanLog([])
                lastScanRef.current = null
                setScanKey((k) => k + 1)
                setScanning(true)
              }}
              title="Quét QR mã vật tư (quét 1 hoặc nhiều mã)"
            />
          </div>
          <datalist id="inventory-on-hand-suggestions">
            {searchSuggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </div>

        <div className="lg:col-span-3">
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Từ ngày</label>
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(event) => setFromDate(event.target.value)}
            className={`${INPUT_CLASS} h-10`}
          />
        </div>
        <div className="lg:col-span-3">
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Đến ngày</label>
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(event) => setToDate(event.target.value)}
            className={`${INPUT_CLASS} h-10`}
          />
        </div>

        <div className="lg:col-span-4">
          <MultiSelectField
            label="Kho"
            options={warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: warehouse.code,
              meta: warehouse.name,
            }))}
            selectedValues={selectedWarehouseIds}
            onChange={(values) => {
              setSelectedWarehouseIds(values)
              setSelectedCategoryIds([])
              setSelectedItemIds([])
            }}
            placeholder="Tất cả kho"
          />
        </div>

        <div className="lg:col-span-4">
          <MultiSelectField
            label="Phân loại"
            options={availableCategories.map((category) => ({
              value: category.id,
              label: category.name,
              meta: category.code,
            }))}
            selectedValues={selectedCategoryIds}
            onChange={(values) => {
              setSelectedCategoryIds(values)
              setSelectedItemIds([])
            }}
            placeholder="Tất cả phân loại"
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-4">
          <MultiSelectField
            label="Mã vật tư"
            options={availableItems.map((item) => ({
              value: item.id,
              label: item.code,
              meta: item.name,
            }))}
            selectedValues={selectedItemIds}
            onChange={setSelectedItemIds}
            placeholder="Tất cả mã vật tư"
          />
        </div>

        {periodActive ? (
          <div className="col-span-full text-xs">
            {periodInvalid ? (
              <span className="font-semibold text-rose-600">Từ ngày phải trước hoặc bằng Đến ngày.</span>
            ) : periodLoading ? (
              <span className="text-slate-500">Đang tính phát sinh trong kỳ...</span>
            ) : periodError ? (
              <span className="font-semibold text-rose-600">Không tính được kỳ: {periodError}</span>
            ) : (
              <span className="text-slate-500">
                Bảng tồn có thêm cột Tồn đầu kỳ / Nhập / Xuất / Tồn cuối kỳ. Đến ngày để trống = hôm nay.
              </span>
            )}
          </div>
        ) : null}
      </ScrollRevealSection>

      <QrScanPortal
        open={scanning}
        onClose={() => setScanning(false)}
        onDecoded={handleScanDecoded}
        scanKey={scanKey}
        hintText="Đưa QR thẻ kho vào khung — quét liên tục nhiều mã"
        header={
          <div className="sticky top-0 z-10 space-y-2 bg-slate-900 p-3 text-white">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold">
                Đã chọn {selectedItemIds.length} mã vật tư · quét {scanLog.filter((s) => s.ok).length} mã hợp lệ
              </div>
              <button
                type="button"
                onClick={() => setScanning(false)}
                className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-slate-800"
              >
                Xong
              </button>
            </div>
            {scanLog.length > 0 ? (
              <ul className="max-h-28 space-y-1 overflow-y-auto text-xs">
                {scanLog.map((s) => (
                  <li key={s.id} className={`flex items-start gap-1.5 ${s.ok ? "text-emerald-300" : "text-rose-300"}`}>
                    {s.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <X size={13} className="mt-0.5 shrink-0" />}
                    <span className="min-w-0 break-words">{s.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        }
      />

      <ScrollRevealSection className="relative z-0">
        <ResponsiveTableWrapper>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-slate-800">Bảng tồn hiện tại</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Kiểm tra tồn theo kho, phân loại, mã vật tư và trạng thái min-max ngay trên lưới.
            </p>
          </div>
        </div>

        {palletMode ? (
          <div className="space-y-1 border-b border-slate-100 bg-violet-50/50 px-4 py-2 text-xs text-slate-600">
            <div>
              <span className="font-bold text-violet-700">Pallet dùng theo tổng mọi kho</span> (không theo bộ lọc
              Kho) — mỗi loại 1 dòng. Tổng sở hữu = sổ sách mọi kho − pallet mất do xuất khẩu kể từ mốc (phiếu nhập
              đầu tiên). Tồn trống = Tổng sở hữu − đang lưu dưới kiện thành phẩm; pallet xuất rời / PE trả về tự quay
              lại phần trống. Hình thức xuất cấu hình ở Cài đặt → Cấu hình nhà máy → Loại pallet xuất. Chỉ tính, không
              tự tạo phiếu kho.
            </div>
            {palletLoading ? <div className="text-slate-500">Đang tính pallet...</div> : null}
            {palletError ? <div className="font-semibold text-rose-600">Không tính được pallet: {palletError}</div> : null}
            {palletReady && palletFlow?.success && palletFlow.unknownKien > 0 ? (
              <div className="text-amber-700">
                {palletFlow.unknownKien} kiện còn tồn chưa quy đổi được pallet ({palletFlow.unknownLabels.join(", ")}).
              </div>
            ) : null}
            {palletReady && palletFlow?.success && palletFlow.unknownExportTypes.length > 0 ? (
              <div className="text-amber-700">
                Loại pallet xuất chưa khai báo (tạm tính như xuất khẩu dạng kiện): {palletFlow.unknownExportTypes.join(", ")}.
              </div>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : onHandRows.length === 0 && palletTableRows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Warehouse size={40} className="mx-auto mb-3 opacity-30" />
            <p>Không có dữ liệu tồn kho phù hợp</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {[
                    "Kho",
                    "Phân loại",
                    "Mã",
                    "Vật tư",
                    "Đơn vị",
                    ...(periodReady ? ["Tồn đầu kỳ", "Nhập trong kỳ", "Xuất trong kỳ", "Tồn cuối kỳ"] : []),
                    "Tồn hiện tại",
                    ...(palletMode
                      ? [
                          "Đang lưu dưới kiện TP",
                          "Mất XK từ mốc",
                          "Tổng sở hữu",
                          "Tồn trống",
                          ...(periodReady ? ["Xuất lưu trong kỳ", "Trả về (xuất rời)", "Mất do xuất khẩu"] : []),
                        ]
                      : []),
                    "Min",
                    "Max",
                    "Số lô",
                    "Hạn gần nhất",
                    "Trạng thái",
                  ].map(
                    (head) => (
                      <th key={head} className="px-4 py-3 text-left font-bold">
                        {head}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {palletTableRows.map((row) => {
                  const selected = row.itemIds.length > 0 && row.itemIds.every((id) => selectedItemIds.includes(id))
                  const num = (n: number) => (palletReady ? n.toLocaleString("vi-VN") : "Đang tính…")
                  return (
                    <tr
                      key={row.id}
                      className={`border-t border-slate-100 transition-colors duration-150 ${
                        row.itemIds.length > 0 ? "cursor-pointer" : ""
                      } ${selected ? "bg-emerald-50 hover:bg-emerald-100" : "bg-violet-50/30 hover:bg-violet-50"}`}
                      onClick={() => {
                        if (row.itemIds.length === 0) return
                        setSelectedItemIds((prev) =>
                          selected ? prev.filter((id) => !row.itemIds.includes(id)) : [...new Set([...prev, ...row.itemIds])],
                        )
                      }}
                      title={selected ? "Bấm để bỏ lọc nhóm pallet" : "Bấm để thêm nhóm pallet vào bộ lọc"}
                    >
                      <td className="px-4 py-3 text-slate-600">
                        <div className="font-semibold text-slate-700">Tổng mọi kho</div>
                        <div className="text-xs text-slate-500">{row.warehouseNote || "Chưa có tồn sổ sách"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.categoryName}</td>
                      <td className="px-4 py-3">
                        {row.linkCode && row.itemIds.length === 1 ? (
                          <Link
                            href={`/dashboard/inventory/item?code=${encodeURIComponent(row.linkCode)}`}
                            onClick={(event) => event.stopPropagation()}
                            className="font-bold text-slate-700 transition hover:text-emerald-700"
                          >
                            {row.groupCode}
                          </Link>
                        ) : (
                          <span className="font-bold text-slate-700">{row.groupCode}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.label}
                        {row.note ? <div className="text-[11px] text-slate-400">{row.note}</div> : null}
                        {!row.hasBook ? <div className="text-[11px] text-amber-600">Chưa có mã trong kho vật tư</div> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{row.unit || "—"}</td>
                      {periodReady ? (
                        row.period ? (
                          <>
                            <td className="px-4 py-3 text-right text-slate-600">{row.period.opening.toLocaleString("vi-VN")}</td>
                            <td className="px-4 py-3 text-right text-emerald-700">{row.period.inQty.toLocaleString("vi-VN")}</td>
                            <td className="px-4 py-3 text-right text-amber-700">{row.period.outQty.toLocaleString("vi-VN")}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-800">{row.period.closing.toLocaleString("vi-VN")}</td>
                          </>
                        ) : (
                          <td colSpan={4} />
                        )
                      ) : null}
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {row.soSach.toLocaleString("vi-VN")}
                        <div className="text-[11px] font-normal text-slate-400">sổ sách</div>
                      </td>
                      <td className="px-4 py-3 text-right text-violet-700">{num(row.dangLuu)}</td>
                      <td className="px-4 py-3 text-right text-rose-700">
                        {num(row.matTuMoc)}
                        <div className="text-[11px] text-slate-400">
                          {row.mocNgay ? `từ ${row.mocNgay.split("-").reverse().join("/")}` : "chưa có phiếu nhập"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{num(row.tongSoHuu)}</td>
                      <td
                        className={`px-4 py-3 text-right font-bold ${
                          palletReady && row.trong < 0 ? "text-rose-600" : "text-emerald-700"
                        }`}
                      >
                        {num(row.trong)}
                      </td>
                      {periodReady ? (
                        <>
                          <td className="px-4 py-3 text-right text-amber-700">{num(row.xuatLuu)}</td>
                          <td className="px-4 py-3 text-right text-emerald-700">{num(row.traVe)}</td>
                          <td className="px-4 py-3 text-right text-rose-700">{num(row.matXuatKhau)}</td>
                        </>
                      ) : null}
                      <td className="px-4 py-3 text-slate-400">—</td>
                      <td className="px-4 py-3 text-slate-400">—</td>
                      <td className="px-4 py-3 text-slate-400">—</td>
                      <td className="px-4 py-3 text-slate-400">—</td>
                      <td className="px-4 py-3">
                        {palletReady ? (
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${
                              row.trong < 0 ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {row.trong < 0 ? "Cần kiểm kê" : "An toàn"}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {onHandRows.map((row) => (
                  <tr
                    key={row.id}
                    className={`cursor-pointer border-t border-slate-100 transition-colors duration-150 ${
                      selectedItemIds.includes(row.item.id) ? "bg-emerald-50 hover:bg-emerald-100" : "hover:bg-slate-50"
                    }`}
                    onClick={() =>
                      setSelectedItemIds((prev) =>
                        prev.includes(row.item.id) ? prev.filter((id) => id !== row.item.id) : [...prev, row.item.id],
                      )
                    }
                    title={selectedItemIds.includes(row.item.id) ? "Bấm để bỏ lọc vật tư" : "Bấm để thêm vật tư vào bộ lọc"}
                  >
                    <td className="px-4 py-3 text-slate-600">
                      <div className="font-semibold text-slate-700">{row.warehouse.code}</div>
                      <div className="text-xs text-slate-500">{row.warehouse.name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.categoryName}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/inventory/item?code=${encodeURIComponent(row.item.code)}`}
                        className="font-bold text-slate-700 transition hover:text-emerald-700"
                      >
                        {row.item.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.item.name}
                      {palletGroupOfItemCode(row.item.code) ? (
                        <div className="text-[11px] text-slate-400">
                          Sổ sách theo kho — chọn phân loại Pallet các loại để xem tồn trống
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{row.item.unit}</td>
                    {row.period ? (
                      <>
                        <td className="px-4 py-3 text-right text-slate-600">{row.period.opening.toLocaleString("vi-VN")}</td>
                        <td className="px-4 py-3 text-right text-emerald-700">{row.period.inQty.toLocaleString("vi-VN")}</td>
                        <td className="px-4 py-3 text-right text-amber-700">{row.period.outQty.toLocaleString("vi-VN")}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{row.period.closing.toLocaleString("vi-VN")}</td>
                      </>
                    ) : null}
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.onHand.toLocaleString("vi-VN")}</td>
                    {palletMode
                      ? Array.from({ length: periodReady ? 7 : 4 }, (_, i) => (
                          <td key={`pl-${i}`} className="px-4 py-3 text-right text-slate-300">
                            —
                          </td>
                        ))
                      : null}
                    <td className="px-4 py-3 text-slate-500">{row.minStock.toLocaleString("vi-VN")}</td>
                    <td className="px-4 py-3 text-slate-500">{row.maxStock.toLocaleString("vi-VN")}</td>
                    <td className="px-4 py-3 text-slate-500">{row.lotCount.toLocaleString("vi-VN")}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(row.nearestExpiry)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold ${
                          row.status === "low"
                            ? "bg-amber-100 text-amber-700"
                            : row.status === "high"
                              ? "bg-red-100 text-red-600"
                              : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {row.status === "low" ? "Tồn thấp" : row.status === "high" ? "Tồn cao" : "An toàn"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ResponsiveTableWrapper>
      </ScrollRevealSection>

      <ScrollRevealSection className="relative z-0">
        <ResponsiveTableWrapper>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            {selectedItemIds.length > 0 ? (
              <>
                <h2 className="text-base font-bold text-slate-800">
                  Lô của{" "}
                  <span className="text-emerald-700">
                    {selectedItemIds.length === 1
                      ? items.find((item) => item.id === selectedItemIds[0])?.name || selectedItemIds[0]
                      : `${selectedItemIds.length} vật tư đã chọn`}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">Đang lọc theo mã vật tư đã chọn ở bảng trên.</p>
              </>
            ) : (
              <>
                <h2 className="text-base font-bold text-slate-800">Tồn theo số lô và hạn sử dụng</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Theo dõi số lô còn tồn để phục vụ chọn lô khi xuất kho và chuyển kho.
                </p>
              </>
            )}
          </div>
          {selectedItemIds.length > 0 ? (
            <button
              type="button"
              onClick={() => setSelectedItemIds([])}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
            >
              Xem tất cả
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : lotRows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <PackageSearch size={40} className="mx-auto mb-3 opacity-30" />
            <p>Không có dữ liệu lô còn tồn</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {["Kho", "Phân loại", "Mã", "Vật tư", "Số lô", "Hạn sử dụng", "Tồn lô"].map((head) => (
                    <th key={head} className="px-4 py-3 text-left font-bold">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lotRows.map((row) => (
                  <tr key={row.id} className="row-hover border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-600">
                      <div className="font-semibold text-slate-700">{row.warehouse.code}</div>
                      <div className="text-xs text-slate-500">{row.warehouse.name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.categoryName}</td>
                    <td className="px-4 py-3 font-bold text-slate-700">{row.item.code}</td>
                    <td className="px-4 py-3 text-slate-700">{row.item.name}</td>
                    <td className="px-4 py-3 text-slate-700">{row.lotNo}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(row.expiryDate)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.onHand.toLocaleString("vi-VN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ResponsiveTableWrapper>
      </ScrollRevealSection>
    </InventoryPageShell>
  )
}
