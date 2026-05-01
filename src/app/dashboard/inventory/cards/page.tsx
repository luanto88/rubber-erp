"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Clock3, FileText, History, Printer } from "lucide-react"
import { InventoryPageShell, InventoryPlaceholderSection } from "../_components/inventory-shell"
import {
  loadInventoryMovementData,
  type InventoryItemOption,
  type InventoryStockMovementRow,
  type InventoryWarehouseOption,
} from "../_components/inventory-data"
import { useScrollReveal } from "@/lib/useScrollReveal"

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

function formatDate(value: string) {
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

function getMovementBadgeClass(movementType: InventoryStockMovementRow["movement_type"]) {
  if (movementType === "import") {
    return "bg-emerald-100 text-emerald-700"
  }

  if (movementType === "export") {
    return "bg-amber-100 text-amber-700"
  }

  return "bg-blue-100 text-blue-700"
}

function getDocumentHref(movementType: InventoryStockMovementRow["movement_type"], documentId: string) {
  if (movementType === "import") {
    return `/dashboard/inventory/receipts?documentId=${encodeURIComponent(documentId)}`
  }

  if (movementType === "export") {
    return `/dashboard/inventory/issues?documentId=${encodeURIComponent(documentId)}`
  }

  return `/dashboard/inventory/transfers?documentId=${encodeURIComponent(documentId)}`
}

export default function InventoryCardsPage() {
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState<string | null>(null)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [movements, setMovements] = useState<InventoryStockMovementRow[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("all")
  const [selectedItemId, setSelectedItemId] = useState("all")
  const revealRef = useScrollReveal()

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventoryMovementData()
        setWarning(inventoryData.warning)
        setWarehouses(inventoryData.warehouses)
        setItems(inventoryData.items)
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

  const filteredMovements = useMemo(() => {
    return movements
      .filter((movement) => selectedWarehouseId === "all" || movement.warehouse_id === selectedWarehouseId)
      .filter((movement) => selectedItemId === "all" || movement.item_id === selectedItemId)
      .map((movement) => {
        const warehouse = warehouseMap.get(movement.warehouse_id)
        const item = itemMap.get(movement.item_id)

        if (!warehouse || !item) {
          return null
        }

        return {
          ...movement,
          warehouse,
          item,
          quantity: movement.quantity_in > 0 ? movement.quantity_in : movement.quantity_out,
          direction: movement.quantity_in > 0 ? "in" : "out",
        }
      })
      .filter((movement): movement is NonNullable<typeof movement> => Boolean(movement))
  }, [itemMap, movements, selectedItemId, selectedWarehouseId, warehouseMap])

  const stats = useMemo(() => {
    const importCount = filteredMovements.filter((movement) => movement.movement_type === "import").length
    const exportCount = filteredMovements.filter((movement) => movement.movement_type === "export").length
    const transferCount = filteredMovements.filter((movement) => movement.movement_type.startsWith("transfer")).length
    const latestDate = filteredMovements[0]?.movement_date || null

    return {
      movementCount: filteredMovements.length,
      importCount,
      exportCount,
      transferCount,
      latestDate,
    }
  }, [filteredMovements])

  const selectableItems = useMemo(() => {
    if (selectedWarehouseId === "all") {
      return items
    }

    return items.filter((item) => item.default_warehouse_ids.includes(selectedWarehouseId))
  }, [items, selectedWarehouseId])

  return (
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title="Thẻ kho"
      description="Theo dõi lịch sử nhập, xuất, chuyển theo từng vật tư và từng kho để phục vụ truy vết nghiệp vụ."
      action={
        <Link
          href={`/dashboard/inventory/print-report?kind=cards&warehouse=${encodeURIComponent(selectedWarehouseId)}&item=${encodeURIComponent(selectedItemId)}`}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <Printer size={16} />
          In thẻ kho
        </Link>
      }
    >
      {warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-bold">Đang dùng dữ liệu mẫu</div>
          <div className="mt-1 leading-6">{warning}</div>
        </div>
      ) : null}

      <div ref={revealRef} className="scroll-reveal grid gap-4 xl:grid-cols-4">
        <SummaryCard
          icon={<History size={18} />}
          label="Phát sinh"
          value={stats.movementCount.toLocaleString("vi-VN")}
          note="Tổng số dòng phát sinh trong phạm vi thẻ kho hiện tại."
        />
        <SummaryCard
          icon={<ArrowDownLeft size={18} />}
          label="Nhập kho"
          value={stats.importCount.toLocaleString("vi-VN")}
          note="Số dòng phát sinh nhập kho."
          tone="text-emerald-700"
        />
        <SummaryCard
          icon={<ArrowUpRight size={18} />}
          label="Xuất kho"
          value={stats.exportCount.toLocaleString("vi-VN")}
          note="Số dòng phát sinh xuất kho."
          tone="text-amber-700"
        />
        <SummaryCard
          icon={<ArrowRightLeft size={18} />}
          label="Điều chuyển"
          value={stats.transferCount.toLocaleString("vi-VN")}
          note={stats.latestDate ? `Phát sinh gần nhất ngày ${formatDate(stats.latestDate)}.` : "Chưa có phát sinh."}
          tone="text-blue-700"
        />
      </div>

      <section
        ref={revealRef}
        className="scroll-reveal mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="min-w-[220px] flex-1">
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Kho</label>
          <select
            value={selectedWarehouseId}
            onChange={(event) => {
              const nextWarehouseId = event.target.value
              setSelectedWarehouseId(nextWarehouseId)
              if (nextWarehouseId !== "all" && selectedItemId !== "all") {
                const itemStillVisible = items.some(
                  (item) => item.id === selectedItemId && item.default_warehouse_ids.includes(nextWarehouseId),
                )
                if (!itemStillVisible) {
                  setSelectedItemId("all")
                }
              }
            }}
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
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Vật tư</label>
          <select
            value={selectedItemId}
            onChange={(event) => setSelectedItemId(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="all">Tất cả vật tư</option>
            {selectableItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} - {item.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section
        ref={revealRef}
        className="scroll-reveal overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-slate-800">Lịch sử phát sinh</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Theo dõi chi tiết từng dòng nhập, xuất, chuyển để đối chiếu tồn kho và truy vết chứng từ.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : filteredMovements.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <FileText size={40} className="mx-auto mb-3 opacity-30" />
            <p>Không có phát sinh phù hợp</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {["Ngày", "Kho", "Mã vật tư", "Tên vật tư", "Loại giao dịch", "Số lô", "Hạn sử dụng", "Số lượng", "Tồn sau", "Chứng từ"].map(
                    (head) => (
                      <th key={head} className="px-4 py-3 text-left font-bold">
                        {head}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredMovements.map((movement) => (
                  <tr key={movement.id} className="row-hover border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-500">{formatDate(movement.movement_date)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div className="font-semibold text-slate-700">{movement.warehouse.code}</div>
                      <div className="text-xs text-slate-500">{movement.warehouse.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/inventory/item?code=${encodeURIComponent(movement.item.code)}`}
                        className="font-bold text-slate-700 transition hover:text-emerald-700"
                      >
                        {movement.item.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{movement.item.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold ${getMovementBadgeClass(movement.movement_type)}`}
                      >
                        {getMovementLabel(movement.movement_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{movement.lot_no || "Không áp dụng"}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {movement.expiry_date ? formatDate(movement.expiry_date) : "Không áp dụng"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {movement.quantity.toLocaleString("vi-VN")}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {movement.balance_after === null ? "Chưa có" : movement.balance_after.toLocaleString("vi-VN")}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={getDocumentHref(movement.movement_type, movement.document_id)}
                        className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700"
                      >
                        Mở phiếu
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <InventoryPlaceholderSection
          title="Truy vết theo vật tư"
          description="Từ thẻ kho có thể đi ngược lại từng dòng phát sinh để kiểm tra số lô, hạn sử dụng và diễn biến tồn theo thời gian."
          icon={<History size={18} />}
          bullets={[
            "Lọc theo kho và vật tư để xem đúng phạm vi cần đối chiếu.",
            "Kiểm tra nhanh phát sinh nhập, xuất và điều chuyển của từng vật tư.",
            "Làm nền cho bước xuất file thẻ kho ở pha tiếp theo.",
          ]}
        />

        <InventoryPlaceholderSection
          title="Liên kết chứng từ"
          description="Bước tiếp theo có thể mở sâu từ thẻ kho sang phiếu nhập, phiếu xuất hoặc phiếu chuyển tương ứng để truy vết đầy đủ."
          icon={<Clock3 size={18} />}
          bullets={[
            "Từ lịch sử phát sinh có thể mở chi tiết từng chứng từ khi cần.",
            "Giúp đối chiếu dữ liệu khi kiểm tra nội bộ hoặc kiểm kê.",
            "Sẽ bổ sung xuất file thẻ kho và xem QR phiếu trong các lượt sau.",
          ]}
        />
      </div>
    </InventoryPageShell>
  )
}
