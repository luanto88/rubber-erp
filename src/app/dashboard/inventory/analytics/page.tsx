"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Clock3,
  Download,
  FileSpreadsheet,
  PackageMinus,
  PackagePlus,
  PackageSearch,
  Save,
  Settings2,
  ShieldAlert,
} from "lucide-react"
import { InventoryPageShell, InventoryPlaceholderSection, ScrollReveal, ScrollRevealSection } from "../_components/inventory-shell"
import {
  loadInventoryMovementData,
  type InventoryItemOption,
  type InventoryLotBalanceRow,
  type InventoryStockBalanceRow,
  type InventoryStockMovementRow,
  type InventoryWarehouseOption,
  type InventoryWarehouseRule,
} from "../_components/inventory-data"
import { supabase } from "@/lib/supabase"
import { hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"

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

type AlertRow = {
  id: string
  warehouseCode: string
  itemCode: string
  itemName: string
  stock: number
  minStock: number
  maxStock: number
  lotNo: string | null
  expiryDate: string | null
  daysToExpiry: number | null
  level: "critical" | "warning" | "info"
  message: string
}

type ChartRow = {
  label: string
  value: number
  width: string
  colorClass: string
}

type RecentTxRow = {
  id: string
  movementType: "import" | "export" | "transfer_in" | "transfer_out"
  documentCode: string | null
  documentId: string | null
  itemId: string
  warehouseId: string
  quantity: number
  actorName: string | null
  movementDate: string
  isAnomaly: boolean
  anomalyPct?: number
}

function getDaysToExpiry(expiryDate: string | null) {
  if (!expiryDate) {
    return null
  }

  const today = new Date()
  const expiry = new Date(expiryDate)
  if (Number.isNaN(expiry.getTime())) {
    return null
  }

  const millisecondsPerDay = 1000 * 60 * 60 * 24
  return Math.ceil((expiry.getTime() - today.getTime()) / millisecondsPerDay)
}

export default function InventoryAnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState<string | null>(null)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [warehouseRules, setWarehouseRules] = useState<InventoryWarehouseRule[]>([])
  const [stockBalances, setStockBalances] = useState<InventoryStockBalanceRow[]>([])
  const [lotBalances, setLotBalances] = useState<InventoryLotBalanceRow[]>([])
  const [movements, setMovements] = useState<InventoryStockMovementRow[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("all")
  const [selectedFocus, setSelectedFocus] = useState("all")
  const [downloading, setDownloading] = useState(false)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [transactionDays, setTransactionDays] = useState<7 | 30>(7)
  const [recentTx, setRecentTx] = useState<RecentTxRow[]>([])
  const [loadingTx, setLoadingTx] = useState(false)
  const [thresholds, setThresholds] = useState({ export_pct: 50, transfer_pct: 70 })
  const [savingThresholds, setSavingThresholds] = useState(false)
  const [thresholdError, setThresholdError] = useState<string | null>(null)
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

        if (inventoryData.factoryId) {
          setFactoryId(inventoryData.factoryId)
        }

        const activeSession = await hydrateActiveSession().catch(() => ({ user: null }))
        if (activeSession.user) setCurrentUser(activeSession.user)

        if (inventoryData.factoryId) {
          const { data: threshData } = await supabase
            .from("inventory_alert_thresholds")
            .select("code, value")
            .eq("factory_id", inventoryData.factoryId)
          if (threshData && threshData.length > 0) {
            const exportRow = threshData.find((r) => r.code === "export_pct")
            const transferRow = threshData.find((r) => r.code === "transfer_pct")
            setThresholds({
              export_pct: exportRow ? Number(exportRow.value) : 50,
              transfer_pct: transferRow ? Number(transferRow.value) : 70,
            })
          }
        }
      } finally {
        setLoading(false)
      }
    }

    void bootstrap()
  }, [])

  useEffect(() => {
    if (!factoryId) return
    const loadRecentTransactions = async () => {
      setLoadingTx(true)
      try {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - transactionDays)
        const { data: movData, error: movErr } = await supabase
          .from("inventory_stock_movements")
          .select("id, movement_type, warehouse_id, item_id, quantity_in, quantity_out, balance_after, movement_date, document_id")
          .eq("factory_id", factoryId)
          .gte("movement_date", cutoff.toISOString().slice(0, 10))
          .order("movement_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(100)

        if (movErr || !movData) { setRecentTx([]); return }

        const docIds = [...new Set(movData.map((m) => m.document_id).filter(Boolean))]
        const docMap = new Map<string, { document_code: string; requester_name: string | null }>()
        if (docIds.length > 0) {
          const { data: docData } = await supabase
            .from("inventory_documents")
            .select("id, document_code, requester_name")
            .in("id", docIds)
          if (docData) {
            for (const d of docData) docMap.set(d.id, d)
          }
        }

        const rows: RecentTxRow[] = movData.map((mov) => {
          const qOut = Number(mov.quantity_out || 0)
          const qIn = Number(mov.quantity_in || 0)
          const balAfter = mov.balance_after !== null ? Number(mov.balance_after) : null
          let isAnomaly = false
          let anomalyPct: number | undefined
          if ((mov.movement_type === "export" || mov.movement_type === "transfer_out") && qOut > 0 && balAfter !== null) {
            const stockBefore = balAfter + qOut
            const pct = stockBefore > 0 ? (qOut / stockBefore) * 100 : 0
            const limit = mov.movement_type === "export" ? thresholds.export_pct : thresholds.transfer_pct
            if (pct > limit) { isAnomaly = true; anomalyPct = Math.round(pct) }
          }
          return {
            id: mov.id,
            movementType: mov.movement_type as RecentTxRow["movementType"],
            documentCode: docMap.get(mov.document_id)?.document_code ?? null,
            documentId: mov.document_id,
            itemId: mov.item_id,
            warehouseId: mov.warehouse_id,
            quantity: qIn > 0 ? qIn : qOut,
            actorName: docMap.get(mov.document_id)?.requester_name ?? null,
            movementDate: mov.movement_date,
            isAnomaly,
            anomalyPct,
          }
        })
        setRecentTx(rows)
      } finally {
        setLoadingTx(false)
      }
    }
    void loadRecentTransactions()
  }, [factoryId, transactionDays, thresholds.export_pct, thresholds.transfer_pct])

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])),
    [warehouses],
  )
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const scopedBalances = useMemo(() => {
    return stockBalances.filter((balance) => selectedWarehouseId === "all" || balance.warehouse_id === selectedWarehouseId)
  }, [selectedWarehouseId, stockBalances])

  const scopedMovements = useMemo(() => {
    return movements.filter((movement) => selectedWarehouseId === "all" || movement.warehouse_id === selectedWarehouseId)
  }, [movements, selectedWarehouseId])

  const alertRows = useMemo(() => {
    const rows: AlertRow[] = []

    scopedBalances.forEach((balance) => {
      const item = itemMap.get(balance.item_id)
      const warehouse = warehouseMap.get(balance.warehouse_id)

      if (!item || !warehouse) {
        return
      }

      const rule = getRule(item.id, balance.warehouse_id, warehouseRules)
      const minStock = Number(rule?.min_stock ?? item.min_stock ?? 0)
      const maxStock = Number(rule?.max_stock ?? item.max_stock ?? 0)
      const stock = Number(balance.on_hand || 0)

      if (minStock > 0 && stock < minStock) {
        rows.push({
          id: `low-${warehouse.id}-${item.id}`,
          warehouseCode: warehouse.code,
          itemCode: item.code,
          itemName: item.name,
          stock,
          minStock,
          maxStock,
          lotNo: null,
          expiryDate: null,
          daysToExpiry: null,
          level: "critical",
          message: "Tồn hiện tại đang thấp hơn giới hạn dưới.",
        })
      }

      if (maxStock > 0 && stock > maxStock) {
        rows.push({
          id: `high-${warehouse.id}-${item.id}`,
          warehouseCode: warehouse.code,
          itemCode: item.code,
          itemName: item.name,
          stock,
          minStock,
          maxStock,
          lotNo: null,
          expiryDate: null,
          daysToExpiry: null,
          level: "warning",
          message: "Tồn hiện tại đang vượt giới hạn trên.",
        })
      }
    })

    lotBalances
      .filter((lot) => lot.on_hand > 0)
      .filter((lot) => selectedWarehouseId === "all" || lot.warehouse_id === selectedWarehouseId)
      .forEach((lot) => {
        const item = itemMap.get(lot.item_id)
        const warehouse = warehouseMap.get(lot.warehouse_id)
        if (!item || !warehouse || !item.manages_expiry) {
          return
        }

        const daysToExpiry = getDaysToExpiry(lot.expiry_date)
        if (daysToExpiry === null || daysToExpiry > 30) {
          return
        }

        rows.push({
          id: `expiry-${warehouse.id}-${item.id}-${lot.lot_no}`,
          warehouseCode: warehouse.code,
          itemCode: item.code,
          itemName: item.name,
          stock: Number(lot.on_hand || 0),
          minStock: Number(item.min_stock || 0),
          maxStock: Number(item.max_stock || 0),
          lotNo: lot.lot_no,
          expiryDate: lot.expiry_date,
          daysToExpiry,
          level: daysToExpiry <= 0 ? "critical" : "info",
          message:
            daysToExpiry <= 0
              ? "Lô đã hết hạn, cần xử lý ngay."
              : `Lô sắp hết hạn trong ${daysToExpiry} ngày, cần ưu tiên sử dụng.`,
        })
      })

    return rows
      .filter((row) => {
        if (selectedFocus === "alerts") {
          return row.level === "critical" || row.level === "warning"
        }

        if (selectedFocus === "lot-expiry") {
          return row.lotNo !== null
        }

        return true
      })
      .sort((a, b) => {
        const levelOrder = { critical: 0, warning: 1, info: 2 }
        return levelOrder[a.level] - levelOrder[b.level]
      })
  }, [itemMap, lotBalances, scopedBalances, selectedFocus, selectedWarehouseId, warehouseMap, warehouseRules])

  const chartRows = useMemo<ChartRow[]>(() => {
    const importValue = scopedMovements.reduce((sum, movement) => sum + Number(movement.quantity_in || 0), 0)
    const exportValue = scopedMovements.reduce((sum, movement) => sum + Number(movement.quantity_out || 0), 0)
    const transferValue = scopedMovements
      .filter((movement) => movement.movement_type.startsWith("transfer"))
      .reduce((sum, movement) => sum + Math.max(Number(movement.quantity_in || 0), Number(movement.quantity_out || 0)), 0)
    const alertValue = alertRows.length

    const base = [
      { label: "Nhập kho", value: importValue, colorClass: "bg-emerald-500" },
      { label: "Xuất kho", value: exportValue, colorClass: "bg-amber-500" },
      { label: "Chuyển kho", value: transferValue, colorClass: "bg-blue-500" },
      { label: "Cảnh báo", value: alertValue, colorClass: "bg-rose-500" },
    ]
    const maxValue = Math.max(...base.map((row) => row.value), 1)

    return base.map((row) => ({
      ...row,
      width: `${Math.max(12, Math.round((row.value / maxValue) * 100))}%`,
    }))
  }, [alertRows.length, scopedMovements])

  const stats = useMemo(() => {
    const trackedItems = new Set(scopedBalances.map((balance) => balance.item_id)).size
    const lowCount = alertRows.filter((row) => row.level === "critical" && row.lotNo === null).length
    const highCount = alertRows.filter((row) => row.level === "warning").length
    const expiryCount = alertRows.filter((row) => row.lotNo !== null).length

    return {
      trackedItems,
      lowCount,
      highCount,
      expiryCount,
    }
  }, [alertRows, scopedBalances])

  const topItems = useMemo(() => {
    const totals = new Map<string, { item: InventoryItemOption; totalIn: number; totalOut: number }>()

    scopedMovements.forEach((movement) => {
      const item = itemMap.get(movement.item_id)
      if (!item) {
        return
      }

      const current = totals.get(item.id) || { item, totalIn: 0, totalOut: 0 }
      current.totalIn += Number(movement.quantity_in || 0)
      current.totalOut += Number(movement.quantity_out || 0)
      totals.set(item.id, current)
    })

    return Array.from(totals.values())
      .sort((a, b) => b.totalOut + b.totalIn - (a.totalOut + a.totalIn))
      .slice(0, 6)
  }, [itemMap, scopedMovements])

  const handleExportCheckFile = async () => {
    setDownloading(true)
    try {
      const XLSX = await import("xlsx")

      const alertSheet = XLSX.utils.json_to_sheet(
        alertRows.map((row) => ({
          Kho: row.warehouseCode,
          "Mã vật tư": row.itemCode,
          "Tên vật tư": row.itemName,
          "Tồn hiện tại": row.stock,
          Min: row.minStock,
          Max: row.maxStock,
          "Số lô": row.lotNo || "",
          "Hạn sử dụng": row.expiryDate ? formatDate(row.expiryDate) : "",
          "Số ngày tới hạn": row.daysToExpiry ?? "",
          "Mức cảnh báo": row.level,
          "Nội dung": row.message,
        })),
      )

      const movementSheet = XLSX.utils.json_to_sheet(
        scopedMovements.map((movement) => {
          const item = itemMap.get(movement.item_id)
          const warehouse = warehouseMap.get(movement.warehouse_id)

          return {
            Ngày: formatDate(movement.movement_date),
            Kho: warehouse ? `${warehouse.code} - ${warehouse.name}` : movement.warehouse_id,
            "Mã vật tư": item?.code || movement.item_id,
            "Tên vật tư": item?.name || "",
            "Loại giao dịch":
              movement.movement_type === "import"
                ? "Nhập kho"
                : movement.movement_type === "export"
                  ? "Xuất kho"
                  : movement.movement_type === "transfer_in"
                    ? "Chuyển đến"
                    : "Chuyển đi",
            "Số lô": movement.lot_no || "",
            "Hạn sử dụng": movement.expiry_date ? formatDate(movement.expiry_date) : "",
            "Số lượng nhập": Number(movement.quantity_in || 0),
            "Số lượng xuất": Number(movement.quantity_out || 0),
            "Tồn sau": movement.balance_after ?? "",
          }
        }),
      )

      const balanceSheet = XLSX.utils.json_to_sheet(
        scopedBalances.map((balance) => {
          const item = itemMap.get(balance.item_id)
          const warehouse = warehouseMap.get(balance.warehouse_id)
          const rule = item ? getRule(item.id, balance.warehouse_id, warehouseRules) : null

          return {
            Kho: warehouse ? `${warehouse.code} - ${warehouse.name}` : balance.warehouse_id,
            "Mã vật tư": item?.code || balance.item_id,
            "Tên vật tư": item?.name || "",
            "Tồn hiện tại": Number(balance.on_hand || 0),
            Min: Number(rule?.min_stock ?? item?.min_stock ?? 0),
            Max: Number(rule?.max_stock ?? item?.max_stock ?? 0),
            "Quản lý lô": item?.manages_lot ? "Có" : "Không",
            "Quản lý hạn": item?.manages_expiry ? "Có" : "Không",
          }
        }),
      )

      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, balanceSheet, "Ton_hien_tai")
      XLSX.utils.book_append_sheet(workbook, alertSheet, "Canh_bao")
      XLSX.utils.book_append_sheet(workbook, movementSheet, "Nhap_xuat_chuyen")
      XLSX.writeFile(workbook, `bao_cao_kiem_tra_kho_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } finally {
      setDownloading(false)
    }
  }

  const handleSaveThreshold = async (code: "export_pct" | "transfer_pct", value: number) => {
    if (!factoryId) return
    setSavingThresholds(true)
    setThresholdError(null)
    try {
      const label = code === "export_pct" ? "Ngưỡng cảnh báo xuất lớn" : "Ngưỡng cảnh báo chuyển kho"
      const { error } = await supabase.from("inventory_alert_thresholds").upsert(
        { factory_id: factoryId, code, label, value, unit: "%", updated_at: new Date().toISOString() },
        { onConflict: "factory_id,code" },
      )
      if (error) setThresholdError(error.message)
    } finally {
      setSavingThresholds(false)
    }
  }

  return (
    <InventoryPageShell
      eyebrow="Thống kê"
      title="Thống kê kho"
      description="Theo dõi cảnh báo, nhịp nhập xuất tồn và xuất file kiểm tra để phục vụ quản lý nội bộ."
      action={
        <button
          type="button"
          onClick={() => void handleExportCheckFile()}
          disabled={downloading}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download size={16} />
          {downloading ? "Đang xuất file..." : "Xuất file kiểm tra"}
        </button>
      }
    >
      {warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-bold">Đang dùng dữ liệu mẫu</div>
          <div className="mt-1 leading-6">{warning}</div>
        </div>
      ) : null}

      <ScrollReveal className="stagger-cards grid gap-4 xl:grid-cols-4">
        <SummaryCard
          icon={<Boxes size={18} />}
          label="Vật tư theo dõi"
          value={stats.trackedItems.toLocaleString("vi-VN")}
          note="Số vật tư đang có tồn trong phạm vi báo cáo hiện tại."
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
          icon={<Clock3 size={18} />}
          label="Sắp hết hạn"
          value={stats.expiryCount.toLocaleString("vi-VN")}
          note="Các lô còn tồn cần theo dõi hạn sử dụng."
          tone="text-blue-700"
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

        <div className="min-w-[220px] flex-1">
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Trọng tâm theo dõi</label>
          <select
            value={selectedFocus}
            onChange={(event) => setSelectedFocus(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="all">Tất cả</option>
            <option value="alerts">Chỉ cảnh báo tồn kho</option>
            <option value="lot-expiry">Chỉ lô và hạn sử dụng</option>
          </select>
        </div>
      </ScrollRevealSection>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <ScrollRevealSection className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-bold text-slate-800">Cảnh báo ưu tiên</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Gom nhanh các vật tư và số lô cần xử lý sớm theo tồn kho hoặc hạn sử dụng.
            </p>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400">Đang tải...</div>
          ) : alertRows.length === 0 ? (
            <div className="p-12 text-center text-slate-400">Chưa có cảnh báo trong phạm vi đang chọn.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {alertRows.slice(0, 10).map((row) => (
                <div key={row.id} className="flex items-start gap-3 px-4 py-4">
                  <div
                    className={`mt-0.5 rounded-xl p-2 ${
                      row.level === "critical"
                        ? "bg-amber-100 text-amber-700"
                        : row.level === "warning"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    <AlertTriangle size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-800">{row.itemCode}</span>
                      <span className="text-sm text-slate-600">{row.itemName}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                        {row.warehouseCode}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{row.message}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-1">Tồn: {row.stock.toLocaleString("vi-VN")}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">Min: {row.minStock.toLocaleString("vi-VN")}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">Max: {row.maxStock.toLocaleString("vi-VN")}</span>
                      {row.lotNo ? (
                        <span className="rounded-full bg-slate-100 px-2 py-1">Lô: {row.lotNo}</span>
                      ) : null}
                      {row.expiryDate ? (
                        <span className="rounded-full bg-slate-100 px-2 py-1">
                          Hạn dùng: {formatDate(row.expiryDate)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollRevealSection>

        <ScrollRevealSection className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-bold text-slate-800">Biểu đồ quản lý</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Tổng hợp nhanh khối lượng nhập, xuất, chuyển và số lượng cảnh báo hiện có.
            </p>
          </div>

          <div className="space-y-4 p-4">
            {chartRows.map((row) => (
              <div key={row.label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-700">{row.label}</span>
                  <span className="text-slate-500">{row.value.toLocaleString("vi-VN")}</span>
                </div>
                <div className="h-3 rounded-full bg-slate-100">
                  <div className={`h-3 rounded-full transition-all duration-500 ${row.colorClass}`} style={{ width: row.width }} />
                </div>
              </div>
            ))}
          </div>
        </ScrollRevealSection>
      </div>

      <ScrollRevealSection className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-slate-800">Giao dịch gần đây</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Các phát sinh nhập / xuất / chuyển kho gần nhất; ⚠️ đánh dấu giao dịch bất thường theo ngưỡng cấu hình.
            </p>
          </div>
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            {([7, 30] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setTransactionDays(days)}
                className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
                  transactionDays === days
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {days} ngày
              </button>
            ))}
          </div>
        </div>

        {loadingTx ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : recentTx.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Không có giao dịch trong {transactionDays} ngày qua.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                <tr>
                  {["Thời gian", "Loại", "Mã phiếu", "Vật tư", "Số lượng", "Kho", "Người thực hiện", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentTx.slice(0, 50).map((row) => {
                  const item = itemMap.get(row.itemId)
                  const warehouse = warehouseMap.get(row.warehouseId)
                  const typeConfig =
                    row.movementType === "import"
                      ? { icon: <PackagePlus size={14} />, label: "Nhập", bg: "bg-emerald-100 text-emerald-700" }
                      : row.movementType === "export"
                        ? { icon: <PackageMinus size={14} />, label: "Xuất", bg: "bg-amber-100 text-amber-700" }
                        : row.movementType === "transfer_in"
                          ? { icon: <PackagePlus size={14} />, label: "Chuyển đến", bg: "bg-blue-100 text-blue-700" }
                          : { icon: <PackageMinus size={14} />, label: "Chuyển đi", bg: "bg-sky-100 text-sky-700" }
                  return (
                    <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500">{formatDate(row.movementDate)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${typeConfig.bg}`}>
                          {typeConfig.icon}{typeConfig.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.documentCode || "—"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="font-semibold">{item?.code || row.itemId}</div>
                        {item?.name ? <div className="text-xs text-slate-400">{item.name}</div> : null}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-800">{row.quantity.toLocaleString("vi-VN")}</td>
                      <td className="px-4 py-3 text-slate-500">{warehouse?.code || row.warehouseId}</td>
                      <td className="px-4 py-3 text-slate-500">{row.actorName || "—"}</td>
                      <td className="px-4 py-3">
                        {row.isAnomaly ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700" title={`Xuất ${row.anomalyPct}% tồn kho`}>
                            <AlertTriangle size={12} />
                            {row.anomalyPct}%
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </ScrollRevealSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <ScrollRevealSection className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-bold text-slate-800">Vật tư biến động nhiều</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Nhóm vật tư có tổng phát sinh cao để quản lý nhịp tiêu hao và bổ sung.
            </p>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400">Đang tải...</div>
          ) : topItems.length === 0 ? (
            <div className="p-12 text-center text-slate-400">Chưa có dữ liệu phát sinh.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {topItems.map((row) => (
                <div key={row.item.id} className="flex items-center justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800">
                      {row.item.code} - {row.item.name}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">{row.item.unit}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 text-xs font-semibold text-slate-600">
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">
                      Nhập: {row.totalIn.toLocaleString("vi-VN")}
                    </span>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                      Xuất: {row.totalOut.toLocaleString("vi-VN")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollRevealSection>

        <InventoryPlaceholderSection
          title="Xuất file kiểm tra"
          description="File xuất hiện tại đã gồm tồn hiện tại, cảnh báo và lịch sử nhập xuất chuyển trong phạm vi bộ lọc đang chọn."
          icon={<FileSpreadsheet size={18} />}
          bullets={[
            "Xuất bảng tồn hiện tại theo kho và vật tư.",
            "Xuất danh sách cảnh báo tồn thấp, tồn cao và hạn sử dụng.",
            "Xuất lịch sử nhập, xuất, chuyển để kiểm tra đối chiếu.",
          ]}
        />

        <InventoryPlaceholderSection
          title="Phân tích xu hướng"
          description="Bước tiếp theo có thể mở rộng sang biểu đồ theo kỳ, theo tháng và theo nhóm vật tư để hỗ trợ quyết định bổ sung hàng."
          icon={<BarChart3 size={18} />}
          bullets={[
            "So sánh nhịp nhập kho, xuất kho và chuyển kho theo thời gian.",
            "Tách riêng vật tư hóa chất để theo dõi số lô và hạn dùng rõ hơn.",
            "Drill-down từ thống kê xuống thẻ kho và chứng từ liên quan.",
          ]}
        />

        <InventoryPlaceholderSection
          title="Theo dõi vật tư hóa chất"
          description="Ưu tiên riêng cho nhóm hóa chất có quản lý số lô và hạn sử dụng để phục vụ cảnh báo gần hạn và điều phối sử dụng."
          icon={<PackageSearch size={18} />}
          bullets={[
            "Rà soát nhanh các lô sắp hết hạn trong phạm vi kho đang chọn.",
            "Kết hợp tồn kho và hạn dùng để ưu tiên xuất đúng lô.",
            "Làm nền cho cảnh báo FEFO ở bước tiếp theo.",
          ]}
        />
      </div>
      {hasPermission(currentUser, "inventory.settings") && (
        <ScrollRevealSection className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-slate-700">
            <Settings2 size={16} />
            <h2 className="text-base font-bold">Cấu hình ngưỡng cảnh báo</h2>
          </div>
          {thresholdError && (
            <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">{thresholdError}</div>
          )}
          <div className="grid gap-6 sm:grid-cols-2">
            {(["export_pct", "transfer_pct"] as const).map((code) => {
              const label = code === "export_pct" ? "Ngưỡng cảnh báo xuất lớn" : "Ngưỡng cảnh báo chuyển kho"
              const desc =
                code === "export_pct"
                  ? "Cảnh báo khi 1 lần xuất vượt X% tồn hiện tại của vật tư đó"
                  : "Cảnh báo khi 1 lần chuyển kho vượt X% tồn kho nguồn"
              return (
                <div key={code}>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">{label}</label>
                  <p className="mb-2 text-xs text-slate-400">{desc}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={thresholds[code]}
                      onChange={(e) =>
                        setThresholds((prev) => ({ ...prev, [code]: Number(e.target.value) }))
                      }
                      className="w-24 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                    <span className="text-sm text-slate-500">% tồn</span>
                    <button
                      type="button"
                      disabled={savingThresholds}
                      onClick={() => void handleSaveThreshold(code, thresholds[code])}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <Save size={12} />
                      Lưu
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollRevealSection>
      )}
    </InventoryPageShell>
  )
}
