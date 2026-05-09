"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Printer } from "lucide-react"
import {
  loadInventoryMovementData,
  type InventoryItemOption,
  type InventoryLotBalanceRow,
  type InventoryStockBalanceRow,
  type InventoryStockMovementRow,
  type InventoryWarehouseOption,
  type InventoryWarehouseRule,
} from "../_components/inventory-data"

type ReportKind = "on-hand" | "cards"
type MovementDocumentType = "import" | "export" | "transfer"

function formatDate(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("vi-VN")
}

function getRule(itemId: string, warehouseId: string, rules: InventoryWarehouseRule[]) {
  return rules.find((rule) => rule.item_id === itemId && rule.warehouse_id === warehouseId) || null
}

function getReportMeta(kind: ReportKind) {
  if (kind === "cards") {
    return {
      title: "Bản in thẻ kho",
      backHref: "/dashboard/inventory/cards",
    }
  }

  return {
    title: "Bản in tồn kho",
    backHref: "/dashboard/inventory/on-hand",
  }
}

function getMovementLabel(movementType: InventoryStockMovementRow["movement_type"]) {
  if (movementType === "import") return "Nhập kho"
  if (movementType === "export") return "Xuất kho"
  return movementType === "transfer_in" ? "Chuyển đến" : "Chuyển đi"
}

function getDocumentType(movementType: InventoryStockMovementRow["movement_type"]): MovementDocumentType {
  if (movementType === "transfer_in" || movementType === "transfer_out") return "transfer"
  return movementType
}

function parseCsv(value: string | null) {
  if (!value) return []
  return value.split(",").map((entry) => entry.trim()).filter(Boolean)
}

function formatSelectedLabels(labels: string[], emptyLabel: string) {
  if (labels.length === 0) return emptyLabel
  if (labels.length <= 3) return labels.join(", ")
  return `${labels.length} mục đã chọn`
}

export default function InventoryPrintReportPage() {
  const searchParams = useSearchParams()
  const kind = (searchParams.get("kind") || "on-hand") as ReportKind
  const warehouseIds = parseCsv(searchParams.get("warehouses"))
  const categoryIds = parseCsv(searchParams.get("categories"))
  const itemIds = parseCsv(searchParams.get("items"))
  const types = parseCsv(searchParams.get("types")) as MovementDocumentType[]
  const fromDate = searchParams.get("from") || ""
  const toDate = searchParams.get("to") || ""
  const search = (searchParams.get("search") || "").trim().toLowerCase()
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState<string | null>(null)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [warehouseRules, setWarehouseRules] = useState<InventoryWarehouseRule[]>([])
  const [stockBalances, setStockBalances] = useState<InventoryStockBalanceRow[]>([])
  const [lotBalances, setLotBalances] = useState<InventoryLotBalanceRow[]>([])
  const [movements, setMovements] = useState<InventoryStockMovementRow[]>([])

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventoryMovementData()
        setWarning(inventoryData.warning)
        setWarehouses(inventoryData.warehouses)
        setItems(inventoryData.items)
        setWarehouseRules(inventoryData.warehouseRules)
        setStockBalances(inventoryData.stockBalances)
        setLotBalances(inventoryData.lotBalances)
        setMovements(inventoryData.movements)
      } finally {
        setLoading(false)
      }
    }

    void bootstrap()
  }, [])

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])),
    [warehouses],
  )
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const warehouseFilterSet = useMemo(() => new Set(warehouseIds), [warehouseIds])
  const categoryFilterSet = useMemo(() => new Set(categoryIds), [categoryIds])
  const itemFilterSet = useMemo(() => new Set(itemIds), [itemIds])
  const typeFilterSet = useMemo(
    () => new Set(types.length > 0 ? types : (["import", "export", "transfer"] as MovementDocumentType[])),
    [types],
  )
  const meta = getReportMeta(kind)

  const onHandRows = useMemo(() => {
    return stockBalances
      .filter((balance) => warehouseIds.length === 0 || warehouseFilterSet.has(balance.warehouse_id))
      .map((balance) => {
        const item = itemMap.get(balance.item_id)
        const warehouse = warehouseMap.get(balance.warehouse_id)
        if (!item || !warehouse) return null
        if (categoryIds.length > 0 && !categoryFilterSet.has(item.category_id || "")) return null
        if (itemIds.length > 0 && !itemFilterSet.has(item.id)) return null

        if (
          search &&
          !item.code.toLowerCase().includes(search) &&
          !item.name.toLowerCase().includes(search)
        ) {
          return null
        }

        const matchingLots = lotBalances.filter(
          (lot) => lot.item_id === balance.item_id && lot.warehouse_id === balance.warehouse_id && lot.on_hand > 0,
        )
        const rule = getRule(item.id, balance.warehouse_id, warehouseRules)
        const minStock = Number(rule?.min_stock ?? item.min_stock ?? 0)
        const maxStock = Number(rule?.max_stock ?? item.max_stock ?? 0)

        return {
          id: `${balance.warehouse_id}-${balance.item_id}`,
          warehouse,
          item,
          categoryName: item.category_name,
          onHand: Number(balance.on_hand || 0),
          minStock,
          maxStock,
          lotCount: matchingLots.length,
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
    categoryIds.length,
    itemFilterSet,
    itemIds.length,
    itemMap,
    lotBalances,
    search,
    stockBalances,
    warehouseFilterSet,
    warehouseIds.length,
    warehouseMap,
    warehouseRules,
  ])

  const onHandLotRows = useMemo(() => {
    return lotBalances
      .filter((lot) => lot.on_hand > 0)
      .filter((lot) => warehouseIds.length === 0 || warehouseFilterSet.has(lot.warehouse_id))
      .filter((lot) => itemIds.length === 0 || itemFilterSet.has(lot.item_id))
      .map((lot) => {
        const item = itemMap.get(lot.item_id)
        const warehouse = warehouseMap.get(lot.warehouse_id)
        if (!item || !warehouse) return null
        if (categoryIds.length > 0 && !categoryFilterSet.has(item.category_id || "")) return null
        if (
          search &&
          !item.code.toLowerCase().includes(search) &&
          !item.name.toLowerCase().includes(search) &&
          !lot.lot_no.toLowerCase().includes(search)
        ) {
          return null
        }

        return {
          id: `${lot.warehouse_id}-${lot.item_id}-${lot.lot_no}-${lot.expiry_date || "na"}`,
          warehouse,
          item,
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
        const itemCompare = a.item.code.localeCompare(b.item.code, "vi")
        if (itemCompare !== 0) return itemCompare
        return (a.expiryDate || "9999-12-31").localeCompare(b.expiryDate || "9999-12-31", "vi")
      })
  }, [
    categoryFilterSet,
    categoryIds.length,
    itemFilterSet,
    itemIds.length,
    itemMap,
    lotBalances,
    search,
    warehouseFilterSet,
    warehouseIds.length,
    warehouseMap,
  ])

  const cardRows = useMemo(() => {
    return movements
      .filter((movement) => warehouseIds.length === 0 || warehouseFilterSet.has(movement.warehouse_id))
      .filter((movement) => typeFilterSet.has(getDocumentType(movement.movement_type)))
      .map((movement) => {
        const item = itemMap.get(movement.item_id)
        const warehouse = warehouseMap.get(movement.warehouse_id)
        if (!item || !warehouse) return null
        if (categoryIds.length > 0 && !categoryFilterSet.has(item.category_id || "")) return null
        if (itemIds.length > 0 && !itemFilterSet.has(item.id)) return null
        if (fromDate && movement.movement_date < fromDate) return null
        if (toDate && movement.movement_date > toDate) return null

        return {
          ...movement,
          item,
          warehouse,
          categoryName: item.category_name,
          quantity: movement.quantity_in > 0 ? Number(movement.quantity_in || 0) : Number(movement.quantity_out || 0),
          documentType: getDocumentType(movement.movement_type),
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => {
        const warehouseCompare = a.warehouse.code.localeCompare(b.warehouse.code, "vi")
        if (warehouseCompare !== 0) return warehouseCompare
        const categoryCompare = a.categoryName.localeCompare(b.categoryName, "vi")
        if (categoryCompare !== 0) return categoryCompare
        const itemCompare = a.item.code.localeCompare(b.item.code, "vi")
        if (itemCompare !== 0) return itemCompare
        return b.movement_date.localeCompare(a.movement_date, "vi")
      })
  }, [
    categoryFilterSet,
    categoryIds.length,
    fromDate,
    itemFilterSet,
    itemIds.length,
    itemMap,
    movements,
    toDate,
    typeFilterSet,
    warehouseFilterSet,
    warehouseIds.length,
    warehouseMap,
  ])

  const selectedWarehouseLabels = warehouseIds
    .map((id) => warehouseMap.get(id))
    .filter((warehouse): warehouse is InventoryWarehouseOption => Boolean(warehouse))
    .map((warehouse) => `${warehouse.code} - ${warehouse.name}`)
  const selectedCategoryLabels = categoryIds
    .map((id) => items.find((item) => item.category_id === id)?.category_name || "")
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
  const selectedItemLabels = itemIds
    .map((id) => itemMap.get(id))
    .filter((item): item is InventoryItemOption => Boolean(item))
    .map((item) => `${item.code} - ${item.name}`)

  return (
    <div className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
          body * {
            visibility: hidden;
          }
          body {
            background: white !important;
          }
          .print-sheet,
          .print-sheet * {
            visibility: visible;
          }
          .print-hidden {
            display: none !important;
          }
          .print-sheet {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            max-width: none !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
          }
        }
      `}</style>

      <div className="print-hidden mx-auto mb-4 flex max-w-6xl items-center justify-between gap-3">
        <Link
          href={meta.backHref}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700"
        >
          <ArrowLeft size={16} />
          Quay lại
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <Printer size={16} />
          In báo cáo
        </button>
      </div>

      <div className="print-sheet mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {loading ? (
          <div className="py-20 text-center text-slate-400">Đang tải dữ liệu báo cáo...</div>
        ) : (
          <>
            <div className="border-b border-slate-200 pb-6">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Quản lý kho</div>
              <h1 className="mt-2 text-2xl font-extrabold text-slate-800">{meta.title}</h1>
              <div className="mt-2 grid gap-2 text-sm text-slate-500 md:grid-cols-2">
                <span>Ngày in: {new Date().toLocaleDateString("vi-VN")}</span>
                <span>Kho: {formatSelectedLabels(selectedWarehouseLabels, "Tất cả kho")}</span>
                <span>Phân loại: {formatSelectedLabels(selectedCategoryLabels, "Tất cả phân loại")}</span>
                <span>Mã vật tư: {formatSelectedLabels(selectedItemLabels, "Tất cả mã vật tư")}</span>
                {kind === "cards" ? (
                  <>
                    <span>Loại phiếu: {formatSelectedLabels(types, "Tất cả loại phiếu")}</span>
                    <span>
                      Kỳ lọc: {fromDate ? formatDate(fromDate) : "Đầu kỳ"} - {toDate ? formatDate(toDate) : "Hiện tại"}
                    </span>
                  </>
                ) : null}
              </div>
              {warning ? <div className="mt-3 text-sm text-amber-700">Lưu ý: {warning}</div> : null}
            </div>

            {kind === "on-hand" ? (
              <>
                <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        {["Kho", "Phân loại", "Mã vật tư", "Tên vật tư", "Đơn vị", "Tồn hiện tại", "Min", "Max", "Số lô"].map((head) => (
                          <th key={head} className="px-4 py-3 text-left font-bold">
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {onHandRows.map((row) => (
                        <tr key={row.id} className="border-t border-slate-100">
                          <td className="px-4 py-3 text-slate-700">{row.warehouse.code}</td>
                          <td className="px-4 py-3 text-slate-600">{row.categoryName}</td>
                          <td className="px-4 py-3 font-bold text-slate-700">{row.item.code}</td>
                          <td className="px-4 py-3 text-slate-700">{row.item.name}</td>
                          <td className="px-4 py-3 text-slate-500">{row.item.unit}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{row.onHand.toLocaleString("vi-VN")}</td>
                          <td className="px-4 py-3 text-slate-500">{row.minStock.toLocaleString("vi-VN")}</td>
                          <td className="px-4 py-3 text-slate-500">{row.maxStock.toLocaleString("vi-VN")}</td>
                          <td className="px-4 py-3 text-slate-500">{row.lotCount.toLocaleString("vi-VN")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        {["Kho", "Phân loại", "Mã vật tư", "Tên vật tư", "Số lô", "Hạn sử dụng", "Tồn lô"].map((head) => (
                          <th key={head} className="px-4 py-3 text-left font-bold">
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {onHandLotRows.map((row) => (
                        <tr key={row.id} className="border-t border-slate-100">
                          <td className="px-4 py-3 text-slate-700">{row.warehouse.code}</td>
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
              </>
            ) : (
              <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {["Ngày", "Kho", "Phân loại", "Mã vật tư", "Tên vật tư", "Loại giao dịch", "Số lô", "Hạn sử dụng", "Số lượng", "Tồn sau"].map((head) => (
                        <th key={head} className="px-4 py-3 text-left font-bold">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cardRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 text-slate-500">{formatDate(row.movement_date)}</td>
                        <td className="px-4 py-3 text-slate-700">{row.warehouse.code}</td>
                        <td className="px-4 py-3 text-slate-600">{row.categoryName}</td>
                        <td className="px-4 py-3 font-bold text-slate-700">{row.item.code}</td>
                        <td className="px-4 py-3 text-slate-700">{row.item.name}</td>
                        <td className="px-4 py-3 text-slate-700">{getMovementLabel(row.movement_type)}</td>
                        <td className="px-4 py-3 text-slate-600">{row.lot_no || ""}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(row.expiry_date)}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{row.quantity.toLocaleString("vi-VN")}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.balance_after === null ? "" : Number(row.balance_after).toLocaleString("vi-VN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
