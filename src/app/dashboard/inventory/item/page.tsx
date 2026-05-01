"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { Boxes, History, PackageSearch, Warehouse } from "lucide-react"
import { InventoryPageShell } from "../_components/inventory-shell"
import { InventoryQrCard } from "../_components/inventory-qr-card"
import {
  loadInventoryMovementData,
  type InventoryItemOption,
  type InventoryLotBalanceRow,
  type InventoryStockBalanceRow,
  type InventoryStockMovementRow,
  type InventoryWarehouseOption,
} from "../_components/inventory-data"
import { useScrollReveal } from "@/lib/useScrollReveal"

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
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover-lift">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl bg-slate-100 p-3 text-slate-700">{icon}</div>
        <div className="text-right">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
          <div className={`mt-2 text-2xl font-extrabold ${tone}`}>{value}</div>
        </div>
      </div>
      <div className="mt-3 text-sm leading-6 text-slate-500">{note}</div>
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

function getMovementLabel(movementType: InventoryStockMovementRow["movement_type"]) {
  if (movementType === "import") {
    return "Nhập kho"
  }

  if (movementType === "export") {
    return "Xuất kho"
  }

  return movementType === "transfer_in" ? "Chuyển đến" : "Chuyển đi"
}

export default function InventoryItemPage() {
  const searchParams = useSearchParams()
  const itemCode = (searchParams.get("code") || "").trim().toUpperCase()
  const revealRef = useScrollReveal()
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState<string | null>(null)
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [stockBalances, setStockBalances] = useState<InventoryStockBalanceRow[]>([])
  const [lotBalances, setLotBalances] = useState<InventoryLotBalanceRow[]>([])
  const [movements, setMovements] = useState<InventoryStockMovementRow[]>([])

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventoryMovementData()
        setWarning(inventoryData.warning)
        setItems(inventoryData.items)
        setWarehouses(inventoryData.warehouses)
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

  const item = useMemo(
    () => items.find((entry) => entry.code.toUpperCase() === itemCode) || null,
    [itemCode, items],
  )
  const itemQrPath = item ? `/dashboard/inventory/item?code=${encodeURIComponent(item.code)}` : null

  const warehouseRows = useMemo(() => {
    if (!item) {
      return []
    }

    return stockBalances
      .filter((balance) => balance.item_id === item.id)
      .map((balance) => ({
        warehouse: warehouseMap.get(balance.warehouse_id),
        onHand: Number(balance.on_hand || 0),
      }))
      .filter((row) => row.warehouse)
  }, [item, stockBalances, warehouseMap])

  const lotRows = useMemo(() => {
    if (!item) {
      return []
    }

    return lotBalances
      .filter((lot) => lot.item_id === item.id && lot.on_hand > 0)
      .map((lot) => ({
        warehouse: warehouseMap.get(lot.warehouse_id),
        lotNo: lot.lot_no,
        expiryDate: lot.expiry_date,
        onHand: Number(lot.on_hand || 0),
      }))
      .filter((row) => row.warehouse)
      .sort((a, b) => {
        const expiryA = a.expiryDate || "9999-12-31"
        const expiryB = b.expiryDate || "9999-12-31"
        return expiryA.localeCompare(expiryB)
      })
  }, [item, lotBalances, warehouseMap])

  const movementRows = useMemo(() => {
    if (!item) {
      return []
    }

    return movements
      .filter((movement) => movement.item_id === item.id)
      .map((movement) => ({
        ...movement,
        warehouse: warehouseMap.get(movement.warehouse_id),
      }))
      .filter((movement) => movement.warehouse)
      .slice(0, 20)
  }, [item, movements, warehouseMap])

  const stats = useMemo(() => {
    const totalOnHand = warehouseRows.reduce((sum, row) => sum + row.onHand, 0)

    return {
      warehouseCount: warehouseRows.length,
      totalOnHand,
      lotCount: lotRows.length,
      movementCount: movementRows.length,
    }
  }, [lotRows.length, movementRows.length, warehouseRows])

  return (
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title={item ? `Hồ sơ vật tư: ${item.code}` : "Hồ sơ vật tư"}
      description={
        item
          ? `${item.name} - theo dõi tồn theo kho, số lô và lịch sử nhập xuất chuyển.`
          : "Quét QR mã vật tư để xem chi tiết nhập xuất tồn ở từng kho."
      }
    >
      {warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-bold">Đang dùng dữ liệu mẫu</div>
          <div className="mt-1 leading-6">{warning}</div>
        </div>
      ) : null}

      {!itemCode ? (
        <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-lg font-bold text-slate-800">Chưa có mã vật tư</div>
          <p className="mt-2 text-sm text-slate-500">
            Mở trang với dạng <code className="rounded bg-slate-100 px-1 py-0.5">/dashboard/inventory/item?code=AF</code>.
          </p>
        </section>
      ) : loading ? (
        <section className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400 shadow-sm">
          Đang tải...
        </section>
      ) : !item ? (
        <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-lg font-bold text-slate-800">Không tìm thấy vật tư</div>
          <p className="mt-2 text-sm text-slate-500">Mã {itemCode} chưa có trong dữ liệu hiện tại.</p>
        </section>
      ) : (
        <>
          <div ref={revealRef} className="scroll-reveal grid gap-4 xl:grid-cols-4">
            <SummaryCard
              icon={<Warehouse size={18} />}
              label="Số kho đang chứa"
              value={stats.warehouseCount.toLocaleString("vi-VN")}
              note="Số kho hiện còn tồn của vật tư này."
            />
            <SummaryCard
              icon={<Boxes size={18} />}
              label="Tổng tồn hiện tại"
              value={stats.totalOnHand.toLocaleString("vi-VN")}
              note={`Tổng lượng tồn của ${item.unit}.`}
              tone="text-blue-700"
            />
            <SummaryCard
              icon={<PackageSearch size={18} />}
              label="Số lô còn tồn"
              value={stats.lotCount.toLocaleString("vi-VN")}
              note="Tổng số lô còn tồn để phục vụ xuất kho."
              tone="text-violet-700"
            />
            <SummaryCard
              icon={<History size={18} />}
              label="Phát sinh gần đây"
              value={stats.movementCount.toLocaleString("vi-VN")}
              note="Số dòng phát sinh gần nhất của vật tư."
              tone="text-emerald-700"
            />
          </div>

          <section
            ref={revealRef}
            className="scroll-reveal rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Mã vật tư</div>
                  <div className="mt-2 text-sm font-bold text-slate-800">{item.code}</div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Tên vật tư</div>
                  <div className="mt-2 text-sm text-slate-700">{item.name}</div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Đơn vị</div>
                  <div className="mt-2 text-sm text-slate-700">{item.unit}</div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Quy cách</div>
                  <div className="mt-2 text-sm text-slate-700">{item.specification || "Chưa có"}</div>
                </div>
              </div>
              <InventoryQrCard
                title="QR vật tư"
                caption="Quét để mở nhanh hồ sơ vật tư."
                hrefPath={itemQrPath}
                valueText={item.code}
                disabledNote="QR sẽ hiển thị khi tìm thấy đúng mã vật tư."
              />
            </div>
          </section>

          <section
            ref={revealRef}
            className="scroll-reveal overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-bold text-slate-800">Tồn theo từng kho</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {["Kho", "Tên kho", "Tồn hiện tại"].map((head) => (
                      <th key={head} className="px-4 py-3 text-left font-bold">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {warehouseRows.map((row) => (
                    <tr key={row.warehouse?.id} className="row-hover border-t border-slate-100">
                      <td className="px-4 py-3 font-bold text-slate-700">{row.warehouse?.code}</td>
                      <td className="px-4 py-3 text-slate-700">{row.warehouse?.name}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {row.onHand.toLocaleString("vi-VN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section
            ref={revealRef}
            className="scroll-reveal overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-bold text-slate-800">Tồn theo số lô</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {["Kho", "Số lô", "Hạn sử dụng", "Tồn lô"].map((head) => (
                      <th key={head} className="px-4 py-3 text-left font-bold">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lotRows.map((row) => (
                    <tr key={`${row.warehouse?.id}-${row.lotNo}-${row.expiryDate || "na"}`} className="row-hover border-t border-slate-100">
                      <td className="px-4 py-3 font-semibold text-slate-700">{row.warehouse?.code}</td>
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
          </section>

          <section
            ref={revealRef}
            className="scroll-reveal overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-bold text-slate-800">Lịch sử nhập xuất chuyển</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {["Ngày", "Kho", "Loại giao dịch", "Số lô", "Hạn sử dụng", "Số lượng", "Tồn sau"].map((head) => (
                      <th key={head} className="px-4 py-3 text-left font-bold">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {movementRows.map((row) => (
                    <tr key={row.id} className="row-hover border-t border-slate-100">
                      <td className="px-4 py-3 text-slate-500">{formatDate(row.movement_date)}</td>
                      <td className="px-4 py-3 text-slate-700">{row.warehouse?.code}</td>
                      <td className="px-4 py-3 text-slate-700">{getMovementLabel(row.movement_type)}</td>
                      <td className="px-4 py-3 text-slate-700">{row.lot_no || "Không áp dụng"}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {row.expiry_date ? formatDate(row.expiry_date) : "Không áp dụng"}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {Math.max(Number(row.quantity_in || 0), Number(row.quantity_out || 0)).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.balance_after === null ? "Chưa có" : Number(row.balance_after).toLocaleString("vi-VN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <Link
              href="/dashboard/inventory/on-hand"
              className="inline-flex items-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700"
            >
              Quay lại Tồn kho
            </Link>
          </div>
        </>
      )}
    </InventoryPageShell>
  )
}
