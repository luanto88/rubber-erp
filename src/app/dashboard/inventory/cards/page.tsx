"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Droplet, Printer, Tag } from "lucide-react"
import { InventoryPageShell } from "../_components/inventory-shell"
import { loadInventoryAdminData, type InventoryItemOption, type InventoryWarehouseOption, type InventoryWarehouseRule } from "../_components/inventory-data"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { downloadInventoryCardLabelsPdf, type InventoryCardEntry } from "@/lib/inventory-card-pdf"

function buildQrUrl(params: { code?: string; warehouseId: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const search = new URLSearchParams()
  if (params.code) search.set("code", params.code)
  search.set("warehouseId", params.warehouseId)
  return `${origin}/dashboard/inventory/item?${search.toString()}`
}

function buildEntries(
  items: InventoryItemOption[],
  warehouses: InventoryWarehouseOption[],
  warehouseRules: InventoryWarehouseRule[],
): InventoryCardEntry[] {
  const warehouseMap = new Map(warehouses.map((w) => [w.id, w]))
  const ruleMap = new Map(warehouseRules.map((r) => [`${r.item_id}:${r.warehouse_id}`, r]))

  const itemEntries: InventoryCardEntry[] = items
    .filter((item) => !item.uses_shared_oil_stock)
    .flatMap((item) =>
      item.default_warehouse_ids
        .map((warehouseId): InventoryCardEntry | null => {
          const warehouse = warehouseMap.get(warehouseId)
          if (!warehouse) return null
          const rule = ruleMap.get(`${item.id}:${warehouseId}`)
          return {
            kind: "item",
            key: `item:${item.id}:${warehouseId}`,
            code: item.code,
            name: item.name,
            unit: item.unit,
            warehouseCode: warehouse.code,
            warehouseName: warehouse.name,
            locationCode: rule?.location_code || null,
            qrUrl: buildQrUrl({ code: item.code, warehouseId }),
          }
        })
        .filter((entry): entry is InventoryCardEntry => entry !== null),
    )

  const oilCodesByWarehouse = new Map<string, string[]>()
  items
    .filter((item) => item.uses_shared_oil_stock)
    .forEach((item) => {
      item.default_warehouse_ids.forEach((warehouseId) => {
        const list = oilCodesByWarehouse.get(warehouseId) || []
        list.push(item.code)
        oilCodesByWarehouse.set(warehouseId, list)
      })
    })

  const oilEntries: InventoryCardEntry[] = [...oilCodesByWarehouse.entries()]
    .map(([warehouseId, itemCodes]): InventoryCardEntry | null => {
      const warehouse = warehouseMap.get(warehouseId)
      if (!warehouse) return null
      return {
        kind: "oil",
        key: `oil:${warehouseId}`,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        itemCodes,
        qrUrl: buildQrUrl({ warehouseId }),
      }
    })
    .filter((entry): entry is InventoryCardEntry => entry !== null)

  return [...itemEntries, ...oilEntries]
}

function CardTile({ entry, selected, onToggle }: { entry: InventoryCardEntry; selected: boolean; onToggle: () => void }) {
  const isOil = entry.kind === "oil"

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative min-h-[104px] rounded-xl border p-3 text-left transition-all ${
        selected ? "border-violet-500 bg-violet-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div
        className={`absolute right-2 top-2 rounded-full p-1 ${selected ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-400"}`}
      >
        <Check size={11} />
      </div>

      <div
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
          isOil ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
        }`}
      >
        {isOil ? <Droplet size={10} /> : <Tag size={10} />}
        {isOil ? "Bồn dầu" : "Vật tư"}
      </div>

      {entry.kind === "item" ? (
        <div className="mt-1.5 pr-8">
          <div className="truncate text-xs font-bold text-slate-800">{entry.code}</div>
          <div className="mt-1 line-clamp-1 text-[11px] text-slate-600">{entry.name}</div>
          <div className="mt-1.5 text-[10px] font-semibold text-slate-500">
            Kho {entry.warehouseCode} · {entry.unit}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-slate-400">
            Vị trí: {entry.locationCode || "Chưa cấu hình"}
          </div>
        </div>
      ) : (
        <div className="mt-1.5 pr-8">
          <div className="truncate text-xs font-bold text-slate-800">Kho dầu {entry.warehouseCode}</div>
          <div className="mt-1 line-clamp-1 text-[11px] text-slate-600">{entry.warehouseName}</div>
          <div className="mt-1.5 line-clamp-2 text-[10px] text-slate-400">
            Dùng chung: {entry.itemCodes.join(", ")}
          </div>
        </div>
      )}
    </button>
  )
}

export default function InventoryCardsPage() {
  const revealRef = useScrollReveal()
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState<string | null>(null)
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [warehouseRules, setWarehouseRules] = useState<InventoryWarehouseRule[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const data = await loadInventoryAdminData()
        setWarning(data.warning)
        setItems(data.items)
        setWarehouses(data.warehouses)
        setWarehouseRules(data.warehouseRules)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  const entries = useMemo(() => buildEntries(items, warehouses, warehouseRules), [items, warehouses, warehouseRules])

  const toggleEntry = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectAll = () => setSelectedKeys(new Set(entries.map((e) => e.key)))
  const clearAll = () => setSelectedKeys(new Set())

  const handlePrint = async () => {
    const selected = entries.filter((e) => selectedKeys.has(e.key))
    if (selected.length === 0) return
    setPrinting(true)
    setPrintError(null)
    try {
      await downloadInventoryCardLabelsPdf(selected)
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : "Không tạo được file in.")
    } finally {
      setPrinting(false)
    }
  }

  return (
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title="Thẻ kho"
      description="In nhãn QR dán tại vị trí lưu vật tư — quét lại ngoài hiện trường để mở Thẻ kho điện tử."
    >
      {warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-bold">Đang dùng dữ liệu mẫu</div>
          <div className="mt-1 leading-6">{warning}</div>
        </div>
      ) : null}

      {printError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{printError}</div>
      ) : null}

      <section
        ref={revealRef}
        className="scroll-reveal flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-violet-300 hover:text-violet-700"
          >
            Chọn tất cả ({entries.length})
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-slate-300"
          >
            Bỏ chọn tất cả
          </button>
          <span className="text-sm text-slate-500">Đã chọn: {selectedKeys.size}</span>
        </div>
        <button
          type="button"
          onClick={() => void handlePrint()}
          disabled={selectedKeys.size === 0 || printing}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Printer size={16} />
          {printing ? "Đang tạo file..." : `In Thẻ kho đã chọn (${selectedKeys.size})`}
        </button>
      </section>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm">
          Đang tải...
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm">
          <Tag size={40} className="mx-auto mb-3 opacity-30" />
          <p>Chưa có vật tư nào gắn kho để in thẻ.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {entries.map((entry) => (
            <CardTile key={entry.key} entry={entry} selected={selectedKeys.has(entry.key)} onToggle={() => toggleEntry(entry.key)} />
          ))}
        </div>
      )}
    </InventoryPageShell>
  )
}
