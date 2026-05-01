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
  type InventoryItemOption,
  type InventoryLotBalanceRow,
  type InventoryStockBalanceRow,
  type InventoryWarehouseOption,
  type InventoryWarehouseRule,
} from "../_components/inventory-data"

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
  if (!value) {
    return "Chưa có"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

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
  const [warehouseRules, setWarehouseRules] = useState<InventoryWarehouseRule[]>([])
  const [stockBalances, setStockBalances] = useState<InventoryStockBalanceRow[]>([])
  const [lotBalances, setLotBalances] = useState<InventoryLotBalanceRow[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("all")
  const [search, setSearch] = useState("")
  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventorySnapshotData()
        setWarning(inventoryData.warning)
        setWarehouses(inventoryData.warehouses)
        setItems(inventoryData.items)
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

  const onHandRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return stockBalances
      .filter((balance) => selectedWarehouseId === "all" || balance.warehouse_id === selectedWarehouseId)
      .map((balance) => {
        const item = itemMap.get(balance.item_id)
        if (!item) {
          return null
        }

        const warehouse = warehouseMap.get(balance.warehouse_id)
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
        const status =
          minStock > 0 && totalOnHand < minStock
            ? "low"
            : maxStock > 0 && totalOnHand > maxStock
              ? "high"
              : "safe"

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
          onHand: totalOnHand,
          minStock,
          maxStock,
          lotCount: matchingLots.length,
          nearestExpiry: nearestExpiry || null,
          status,
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => a.item.code.localeCompare(b.item.code, "vi"))
  }, [itemMap, lotBalances, search, selectedWarehouseId, stockBalances, warehouseMap, warehouseRules])

  const lotRows = useMemo(() => {
    return lotBalances
      .filter((lot) => lot.on_hand > 0)
      .filter((lot) => selectedWarehouseId === "all" || lot.warehouse_id === selectedWarehouseId)
      .map((lot) => {
        const item = itemMap.get(lot.item_id)
        const warehouse = warehouseMap.get(lot.warehouse_id)
        if (!item || !warehouse) {
          return null
        }

        const normalizedSearch = search.trim().toLowerCase()
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
          lotNo: lot.lot_no,
          expiryDate: lot.expiry_date,
          onHand: Number(lot.on_hand || 0),
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => {
        const expiryA = a.expiryDate || "9999-12-31"
        const expiryB = b.expiryDate || "9999-12-31"
        return expiryA.localeCompare(expiryB, "vi")
      })
  }, [itemMap, lotBalances, search, selectedWarehouseId, warehouseMap])

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
          href={`/dashboard/inventory/print-report?kind=on-hand&warehouse=${encodeURIComponent(selectedWarehouseId)}&search=${encodeURIComponent(search)}`}
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

      <ScrollRevealSection className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Kho</label>
          <select
            value={selectedWarehouseId}
            onChange={(event) => setSelectedWarehouseId(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="all">Tất cả kho</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} - {warehouse.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[260px] flex-1">
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Tìm vật tư hoặc số lô</label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Mã vật tư, tên vật tư hoặc số lô"
            className={INPUT_CLASS}
          />
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-slate-800">Bảng tồn hiện tại</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Kiểm tra tồn theo kho, vật tư và trạng thái min-max ngay trên lưới.
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
                  {["Kho", "Mã", "Vật tư", "Đơn vị", "Tồn hiện tại", "Min", "Max", "Số lô", "Hạn gần nhất", "Trạng thái"].map(
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
                  <tr key={row.id} className="row-hover border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-600">
                      <div className="font-semibold text-slate-700">{row.warehouse?.code || "N/A"}</div>
                      <div className="text-xs text-slate-500">{row.warehouse?.name || "Chưa xác định"}</div>
                    </td>
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
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {row.onHand.toLocaleString("vi-VN")}
                    </td>
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

      <ScrollRevealSection className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-slate-800">Tồn theo số lô và hạn sử dụng</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Theo dõi số lô còn tồn để phục vụ chọn lô khi xuất kho và chuyển kho.
            </p>
          </div>
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
                  {["Kho", "Mã", "Vật tư", "Số lô", "Hạn sử dụng", "Tồn lô"].map((head) => (
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
                    <td className="px-4 py-3 font-bold text-slate-700">{row.item.code}</td>
                    <td className="px-4 py-3 text-slate-700">{row.item.name}</td>
                    <td className="px-4 py-3 text-slate-700">{row.lotNo}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(row.expiryDate)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {row.onHand.toLocaleString("vi-VN")}
                    </td>
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
