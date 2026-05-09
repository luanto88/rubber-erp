"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Boxes,
  Clock3,
  PackageSearch,
  Printer,
  ShieldAlert,
  Warehouse,
} from "lucide-react"
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
import { MultiSelectField } from "../_components/inventory-ui"

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

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventorySnapshotData()
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

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])),
    [warehouses],
  )
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
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

        return {
          id: `${balance.warehouse_id}-${balance.item_id}`,
          item,
          warehouse,
          categoryName: item.category_name,
          onHand: totalOnHand,
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

  return (
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title="Tồn kho"
      description="Theo dõi tồn hiện tại theo kho, vật tư, số lô và hạn sử dụng để phục vụ xuất kho, chuyển kho và cảnh báo tồn an toàn."
      action={
        <Link
          href={`/dashboard/inventory/print-report?kind=on-hand&warehouses=${encodeURIComponent(selectedWarehouseIds.join(","))}&categories=${encodeURIComponent(selectedCategoryIds.join(","))}&items=${encodeURIComponent(selectedItemIds.join(","))}&search=${encodeURIComponent(search)}`}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <Printer size={16} />
          In tồn kho
        </Link>
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

      <ScrollRevealSection className="relative z-40 mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-[220px] flex-1">
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

        <div className="min-w-[220px] flex-1">
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

        <div className="min-w-[240px] flex-1">
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

        <div className="min-w-[220px] flex-1">
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Tìm vật tư hoặc số lô</label>
          <input
            list="inventory-on-hand-suggestions"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Mã, tên vật tư hoặc số lô"
            className={INPUT_CLASS}
          />
          <datalist id="inventory-on-hand-suggestions">
            {searchSuggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection className="relative z-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
                  {["Kho", "Phân loại", "Mã", "Vật tư", "Đơn vị", "Tồn hiện tại", "Min", "Max", "Số lô", "Hạn gần nhất", "Trạng thái"].map(
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
                    <td className="px-4 py-3 text-slate-700">{row.item.name}</td>
                    <td className="px-4 py-3 text-slate-500">{row.item.unit}</td>
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
      </ScrollRevealSection>

      <ScrollRevealSection className="relative z-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
      </ScrollRevealSection>
    </InventoryPageShell>
  )
}
