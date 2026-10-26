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
  const showPalletSection = useMemo(
    () => items.some((item) => palletGroupOfItemCode(item.code)),
    [items],
  )
  const [palletFlow, setPalletFlow] = useState<PalletFlowResult | null>(null)
  const [palletLoading, setPalletLoading] = useState(false)
  const palletPeriodFrom = periodReady ? fromDate : ""
  const palletPeriodTo = periodReady ? toDate || getFactoryTodayISO() : ""

  useEffect(() => {
    if (!factoryId || !showPalletSection) return
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
  }, [factoryId, palletPeriodFrom, palletPeriodTo, showPalletSection])

  // Pallet dùng theo TỔNG (mọi kho), không theo bộ lọc: Tổng sở hữu = sổ sách − mất XK từ mốc;
  // Trống = Tổng sở hữu − Đang lưu dưới kiện TP.
  const palletRows = useMemo(() => {
    const hasItem = new Set<string>()
    for (const item of items) {
      const g = palletGroupOfItemCode(item.code)
      if (g) hasItem.add(g.groupCode)
    }
    const flow = palletFlow?.success ? palletFlow.byGroup : {}
    return PALLET_COMPONENT_ORDER.map((c) => {
      const { groupCode, itemCodes } = PALLET_COMPONENT_ITEMS[c]
      const f = flow[groupCode]
      const soSach = f?.soSach || 0
      const matTuMoc = f?.matTuMoc || 0
      const dangLuu = f?.dangLuu || 0
      const tongSoHuu = soSach - matTuMoc
      return {
        groupCode,
        label: PALLET_COMPONENT_LABEL[c],
        note: itemCodes.length > 1 ? `Gồm ${itemCodes.join(", ")}` : "",
        hasBook: hasItem.has(groupCode),
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
    }).filter((r) => r.hasBook || r.soSach || r.dangLuu || r.xuatLuu || r.traVe || r.matXuatKhau)
  }, [items, palletFlow])

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
      trackedCount: onHandRows.length,
      lowCount,
      highCount,
      lotManagedCount,
      lotCount: lotRows.length,
    }
  }, [lotRows.length, onHandRows])

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
    const head = ["STT", "Kho", "Phân loại", "Mã vật tư", "Tên vật tư", "ĐVT"]
    if (periodReady) head.push("Tồn đầu kỳ", "Nhập trong kỳ", "Xuất trong kỳ")
    head.push("Tồn sổ sách", "Tồn thực tế", "Chênh lệch", "Ghi chú")

    const aoa: (string | number)[][] = [
      ["PHIẾU KIỂM TỒN KHO VẬT TƯ"],
      [periodText],
      [],
      head,
    ]
    const bookCol = head.indexOf("Tồn sổ sách")
    const colLetter = (index: number) => XLSX.utils.encode_col(index)
    onHandRows.forEach((row, index) => {
      const line: (string | number)[] = [
        index + 1,
        `${row.warehouse.code} - ${row.warehouse.name}`,
        row.categoryName,
        row.item.code,
        row.item.name,
        row.item.unit,
      ]
      if (row.period) line.push(row.period.opening, row.period.inQty, row.period.outQty)
      line.push(row.period ? row.period.closing : row.onHand, "", "", "")
      aoa.push(line)
    })

    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    // Chênh lệch = Thực tế − Sổ sách (chỉ tính khi đã nhập số thực tế)
    onHandRows.forEach((_, index) => {
      const r = index + 5 // dòng Excel (1-based): 4 dòng đầu là tiêu đề
      const book = `${colLetter(bookCol)}${r}`
      const actual = `${colLetter(bookCol + 1)}${r}`
      sheet[`${colLetter(bookCol + 2)}${r}`] = { t: "n", f: `IF(${actual}="","",${actual}-${book})` }
    })
    sheet["!cols"] = head.map((h) =>
      ({ wch: h === "Tên vật tư" ? 36 : h === "Kho" ? 22 : h === "Phân loại" ? 20 : h === "Ghi chú" ? 24 : 12 }),
    )
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, "Kiem ton")
    if (showPalletSection && palletFlow?.success && palletRows.length > 0) {
      const pHead = [
        "Mã",
        "Pallet",
        "Ghi chú",
        "Sổ sách (mọi kho)",
        "Mốc kiểm kê",
        "Mất XK từ mốc",
        "Tổng sở hữu",
        "Đang lưu dưới kiện TP",
        "Trống trong kho",
      ]
      if (periodReady) pHead.push("Xuất lưu trong kỳ", "Trả về (xuất rời)", "Mất do xuất khẩu")
      const pAoa: (string | number)[][] = [["TỒN PALLET"], [periodText], [], pHead]
      for (const r of palletRows) {
        const line: (string | number)[] = [
          r.groupCode,
          r.label,
          r.note,
          r.soSach,
          r.mocNgay ? fmt(r.mocNgay) : "",
          r.matTuMoc,
          r.tongSoHuu,
          r.dangLuu,
          r.trong,
        ]
        if (periodReady) line.push(r.xuatLuu, r.traVe, r.matXuatKhau)
        pAoa.push(line)
      }
      const pSheet = XLSX.utils.aoa_to_sheet(pAoa)
      pSheet["!cols"] = pHead.map((h) => ({ wch: h === "Pallet" ? 22 : h === "Ghi chú" ? 18 : 16 }))
      XLSX.utils.book_append_sheet(book, pSheet, "Pallet")
    }
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
            disabled={loading || onHandRows.length === 0 || (periodActive && !periodReady)}
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

      {showPalletSection ? (
        <ScrollRevealSection className="relative z-0">
          <ResponsiveTableWrapper>
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-bold text-slate-800">Tồn pallet (tính theo tổng mọi kho)</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Pallet dùng theo tổng, không theo kho — không phụ thuộc bộ lọc Kho/Phân loại/Mã vật tư. Tổng sở hữu = sổ
                sách mọi kho − pallet mất do xuất khẩu kể từ mốc (phiếu nhập đầu tiên). Trống trong kho = Tổng sở hữu −
                đang lưu dưới kiện thành phẩm; pallet xuất rời / PE trả về tự quay lại phần trống. Hình thức xuất cấu
                hình ở Cài đặt → Cấu hình nhà máy → Loại pallet xuất. Số liệu chỉ tính, không tự tạo phiếu kho.
              </p>
            </div>
            {palletLoading && !palletFlow ? (
              <div className="p-8 text-center text-sm text-slate-400">Đang tính pallet...</div>
            ) : palletFlow && !palletFlow.success ? (
              <div className="p-4 text-sm font-semibold text-rose-600">Không tính được pallet: {palletFlow.error}</div>
            ) : (
              <>
                <table className="enterprise-table dense min-w-[900px]">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Pallet</th>
                      <th className="text-right">Sổ sách (mọi kho)</th>
                      <th className="text-right">Mất XK từ mốc</th>
                      <th className="text-right">Tổng sở hữu</th>
                      <th className="text-right">Đang lưu dưới kiện TP</th>
                      <th className="text-right">Trống trong kho</th>
                      {periodReady ? (
                        <>
                          <th className="text-right">Xuất lưu trong kỳ</th>
                          <th className="text-right">Trả về (xuất rời)</th>
                          <th className="text-right">Mất do xuất khẩu</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {palletRows.map((r) => (
                      <tr key={r.groupCode}>
                        <td className="font-bold text-slate-700">{r.groupCode}</td>
                        <td>
                          <div className="text-slate-700">{r.label}</div>
                          {r.note ? <div className="text-xs text-slate-400">{r.note}</div> : null}
                          {!r.hasBook ? <div className="text-xs text-amber-600">Chưa có mã trong kho vật tư</div> : null}
                        </td>
                        <td className="text-right">{r.soSach.toLocaleString("vi-VN")}</td>
                        <td className="text-right text-rose-700">
                          {r.matTuMoc.toLocaleString("vi-VN")}
                          <div className="text-[11px] text-slate-400">
                            {r.mocNgay ? `từ ${r.mocNgay.split("-").reverse().join("/")}` : "chưa có phiếu nhập"}
                          </div>
                        </td>
                        <td className="text-right font-semibold text-slate-800">{r.tongSoHuu.toLocaleString("vi-VN")}</td>
                        <td className="text-right text-violet-700">{r.dangLuu.toLocaleString("vi-VN")}</td>
                        <td className={`text-right font-bold ${r.trong < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                          {r.trong.toLocaleString("vi-VN")}
                          {r.trong < 0 ? (
                            <div className="text-[11px] font-semibold text-rose-500">Sổ sách thiếu — cần kiểm kê</div>
                          ) : null}
                        </td>
                        {periodReady ? (
                          <>
                            <td className="text-right text-amber-700">{r.xuatLuu.toLocaleString("vi-VN")}</td>
                            <td className="text-right text-emerald-700">{r.traVe.toLocaleString("vi-VN")}</td>
                            <td className="text-right text-rose-700">{r.matXuatKhau.toLocaleString("vi-VN")}</td>
                          </>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {palletFlow?.success && (palletFlow.unknownKien > 0 || palletFlow.unknownExportTypes.length > 0) ? (
                  <div className="space-y-1 border-t border-slate-100 px-4 py-2 text-xs text-amber-700">
                    {palletFlow.unknownKien > 0 ? (
                      <div>
                        {palletFlow.unknownKien} kiện còn tồn chưa quy đổi được pallet ({palletFlow.unknownLabels.join(", ")}).
                      </div>
                    ) : null}
                    {palletFlow.unknownExportTypes.length > 0 ? (
                      <div>
                        Loại pallet xuất chưa khai báo (tạm tính như xuất khẩu dạng kiện):{" "}
                        {palletFlow.unknownExportTypes.join(", ")}.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </ResponsiveTableWrapper>
        </ScrollRevealSection>
      ) : null}

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

        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : onHandRows.length === 0 ? (
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
                          Sổ sách theo kho — tồn trống thật xem khối Tồn pallet
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
