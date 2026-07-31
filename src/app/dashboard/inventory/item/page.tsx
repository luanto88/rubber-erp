"use client"

import Link from "next/link"
import dynamic from "next/dynamic"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowRightLeft,
  Boxes,
  Droplet,
  History,
  MapPin,
  PackageMinus,
  PackagePlus,
  PackageSearch,
  ScanLine,
  Warehouse,
} from "lucide-react"
import { InventoryPageShell } from "../_components/inventory-shell"
import { InventoryQrCard } from "../_components/inventory-qr-card"
import {
  loadInventoryMovementData,
  type InventoryItemOption,
  type InventoryLotBalanceRow,
  type InventoryStockBalanceRow,
  type InventoryStockMovementRow,
  type InventoryWarehouseOption,
  type InventoryWarehouseRule,
} from "../_components/inventory-data"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"

// html5-qrcode đụng trực tiếp navigator.mediaDevices — bắt buộc import qua next/dynamic({ssr:false}),
// tái dùng nguyên component quét QR đã có ở module Thành phẩm thay vì viết mới.
const QrScanner = dynamic(
  () => import("@/app/dashboard/product/confirm/qr-scanner").then((m) => m.QrScanner),
  { ssr: false },
)

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

function LiveBadge() {
  return (
    <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-600">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      TRỰC TUYẾN (REAL-TIME)
    </div>
  )
}

function QuickActionsBar({ onScan }: { onScan: () => void }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-slate-700">Thao tác nhanh</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link
          href="/dashboard/inventory/issues"
          className="flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-amber-700"
        >
          <PackageMinus size={16} /> Tạo phiếu xuất
        </Link>
        <Link
          href="/dashboard/inventory/receipts"
          className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <PackagePlus size={16} /> Tạo phiếu nhập
        </Link>
        <Link
          href="/dashboard/inventory/transfers"
          className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
        >
          <ArrowRightLeft size={16} /> Chuyển kho
        </Link>
        <button
          type="button"
          onClick={onScan}
          className="flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-900"
        >
          <ScanLine size={16} /> Tiếp tục quét QR
        </button>
      </div>
    </section>
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
  const router = useRouter()
  const searchParams = useSearchParams()
  const itemCode = (searchParams.get("code") || "").trim().toUpperCase()
  const warehouseIdParam = (searchParams.get("warehouseId") || "").trim()
  const revealRef = useScrollReveal()
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState<string | null>(null)
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [warehouseRules, setWarehouseRules] = useState<InventoryWarehouseRule[]>([])
  const [stockBalances, setStockBalances] = useState<InventoryStockBalanceRow[]>([])
  const [lotBalances, setLotBalances] = useState<InventoryLotBalanceRow[]>([])
  const [movements, setMovements] = useState<InventoryStockMovementRow[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventoryMovementData()
        setWarning(inventoryData.warning)
        setItems(inventoryData.items)
        setWarehouses(inventoryData.warehouses)
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

  // Nhãn Thẻ kho vật tư thường và Thẻ kho bồn dầu đều encode URL dạng
  // /dashboard/inventory/item?code=...&warehouseId=... (hoặc chỉ warehouseId= cho bồn dầu) — parse
  // lại đúng query string đó khi quét được, mirror parseScannedQr() ở product/confirm/page.tsx.
  const handleScanDecoded = useCallback(
    (text: string) => {
      const qIndex = text.indexOf("?")
      if (qIndex === -1) {
        setScanError("Mã QR không hợp lệ hoặc không phải Thẻ kho.")
        return
      }
      const params = new URLSearchParams(text.slice(qIndex + 1))
      const code = params.get("code")
      const warehouseId = params.get("warehouseId")
      if (!code && !warehouseId) {
        setScanError("Mã QR không hợp lệ hoặc không phải Thẻ kho.")
        return
      }
      setScanError(null)
      setScanning(false)
      const next = new URLSearchParams()
      if (code) next.set("code", code)
      if (warehouseId) next.set("warehouseId", warehouseId)
      router.push(`/dashboard/inventory/item?${next.toString()}`)
    },
    [router],
  )

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])),
    [warehouses],
  )
  const itemMap = useMemo(() => new Map(items.map((entry) => [entry.id, entry])), [items])

  const item = useMemo(
    () => (itemCode ? items.find((entry) => entry.code.toUpperCase() === itemCode) || null : null),
    [itemCode, items],
  )

  const isOilPoolMode = !itemCode && !!warehouseIdParam
  const oilWarehouse = useMemo(
    () => (warehouseIdParam ? warehouses.find((w) => w.id === warehouseIdParam) || null : null),
    [warehouseIdParam, warehouses],
  )
  const oilItems = useMemo(() => {
    if (!isOilPoolMode) return []
    return items.filter((entry) => entry.uses_shared_oil_stock && entry.default_warehouse_ids.includes(warehouseIdParam))
  }, [isOilPoolMode, items, warehouseIdParam])
  const oilItemIds = useMemo(() => new Set(oilItems.map((entry) => entry.id)), [oilItems])
  const oilBalance = useMemo(() => {
    if (!isOilPoolMode) return 0
    const row = stockBalances.find((balance) => balance.warehouse_id === warehouseIdParam && oilItemIds.has(balance.item_id))
    return Number(row?.on_hand || 0)
  }, [isOilPoolMode, oilItemIds, stockBalances, warehouseIdParam])
  const oilMovementRows = useMemo(() => {
    if (!isOilPoolMode) return []
    return movements
      .filter((movement) => movement.warehouse_id === warehouseIdParam && oilItemIds.has(movement.item_id))
      .slice(0, 20)
  }, [isOilPoolMode, movements, oilItemIds, warehouseIdParam])

  const itemQrPath = item
    ? `/dashboard/inventory/item?code=${encodeURIComponent(item.code)}${
        warehouseIdParam ? `&warehouseId=${encodeURIComponent(warehouseIdParam)}` : ""
      }`
    : null

  // Vị trí kho ưu tiên đúng kho đã in trên nhãn (?warehouseId=) — fallback rule chính (is_primary)
  // rồi mới tới rule đầu tiên, để vẫn hiển thị được gì đó khi mở link cũ chỉ có ?code=.
  const locationCode = useMemo(() => {
    if (!item) return null
    const rules = warehouseRules.filter((rule) => rule.item_id === item.id)
    const matched = warehouseIdParam ? rules.find((rule) => rule.warehouse_id === warehouseIdParam) : undefined
    const primary = rules.find((rule) => rule.is_primary)
    const rule = matched || primary || rules[0]
    return rule?.location_code || null
  }, [item, warehouseIdParam, warehouseRules])

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

  if (scanning) {
    return (
      <QrScanner
        onDecoded={handleScanDecoded}
        onCancel={() => setScanning(false)}
        hintText="Đưa camera vào mã QR trên Thẻ kho"
        cancelText="Hủy quét"
        cameraErrorText="Không mở được camera. Hãy cấp quyền camera hoặc tải ảnh chứa QR."
        uploadButtonText="Tải ảnh chứa QR"
        uploadScanningText="Đang xử lý ảnh..."
        uploadNotFoundText="Không tìm thấy mã QR trong ảnh."
        orDividerText="hoặc"
        scanError={scanError}
      />
    )
  }

  return (
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title={
        isOilPoolMode
          ? `Bồn dầu chung${oilWarehouse ? ` — ${oilWarehouse.code}` : ""}`
          : item
            ? `Thẻ kho điện tử: ${item.code}`
            : "Thẻ kho điện tử"
      }
      description={
        isOilPoolMode
          ? oilWarehouse
            ? `${oilWarehouse.name} — tồn chung theo bồn, dùng cho các mã vật tư Dầu gắn cùng kho.`
            : "Quét QR bồn dầu để xem tồn chung theo kho."
          : item
            ? `${item.name} — theo dõi tồn theo kho, số lô và lịch sử nhập xuất chuyển.`
            : "Quét QR trên Thẻ kho để xem chi tiết nhập xuất tồn ở từng kho."
      }
    >
      <LiveBadge />

      {warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-bold">Đang dùng dữ liệu mẫu</div>
          <div className="mt-1 leading-6">{warning}</div>
        </div>
      ) : null}

      {isOilPoolMode ? (
        loading ? (
          <section className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400 shadow-sm">
            Đang tải...
          </section>
        ) : !oilWarehouse ? (
          <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="text-lg font-bold text-slate-800">Không tìm thấy kho</div>
            <p className="mt-2 text-sm text-slate-500">Kho tương ứng với QR này chưa có trong dữ liệu hiện tại.</p>
          </section>
        ) : (
          <>
            <div ref={revealRef} className="scroll-reveal grid gap-4 xl:grid-cols-3">
              <SummaryCard
                icon={<Droplet size={18} />}
                label="Tồn bồn hiện tại"
                value={oilBalance.toLocaleString("vi-VN")}
                note="Tổng lượng dầu đang tồn chung trong bồn của kho này."
                tone="text-amber-700"
              />
              <SummaryCard
                icon={<Boxes size={18} />}
                label="Số mã dùng chung"
                value={oilItems.length.toLocaleString("vi-VN")}
                note="Số mã vật tư Dầu đang trỏ vào cùng 1 bồn."
              />
              <SummaryCard
                icon={<History size={18} />}
                label="Phát sinh gần đây"
                value={oilMovementRows.length.toLocaleString("vi-VN")}
                note="Số dòng phát sinh gần nhất của bồn."
                tone="text-emerald-700"
              />
            </div>

            <section
              ref={revealRef}
              className="scroll-reveal rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Kho</div>
                  <div className="mt-2 text-sm font-bold text-slate-800">
                    {oilWarehouse.code} — {oilWarehouse.name}
                  </div>
                  <div className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                    Các mã dùng chung bồn
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {oilItems.map((entry) => (
                      <span key={entry.id} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
                        {entry.code}
                      </span>
                    ))}
                  </div>
                </div>
                <InventoryQrCard
                  title="QR bồn dầu"
                  caption="Quét để mở nhanh bồn dầu này."
                  hrefPath={`/dashboard/inventory/item?warehouseId=${encodeURIComponent(warehouseIdParam)}`}
                  valueText={`Bồn ${oilWarehouse.code}`}
                />
              </div>
            </section>

            <section ref={revealRef} className="scroll-reveal">
              <ResponsiveTableWrapper>
                <div className="border-b border-slate-200 px-4 py-3">
                  <h2 className="text-base font-bold text-slate-800">Lịch sử nhập xuất chuyển</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        {["Ngày", "Mã vật tư", "Loại giao dịch", "Số lượng", "Tồn sau"].map((head) => (
                          <th key={head} className="px-4 py-3 text-left font-bold">
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {oilMovementRows.map((row) => (
                        <tr key={row.id} className="row-hover border-t border-slate-100">
                          <td className="px-4 py-3 text-slate-500">{formatDate(row.movement_date)}</td>
                          <td className="px-4 py-3 font-semibold text-slate-700">
                            {itemMap.get(row.item_id)?.code || row.item_id}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{getMovementLabel(row.movement_type)}</td>
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
              </ResponsiveTableWrapper>
            </section>

            <QuickActionsBar onScan={() => setScanning(true)} />
          </>
        )
      ) : !itemCode ? (
        <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-lg font-bold text-slate-800">Chưa có mã vật tư</div>
          <p className="mt-2 text-sm text-slate-500">
            Mở trang với dạng <code className="rounded bg-slate-100 px-1 py-0.5">/dashboard/inventory/item?code=AF</code>{" "}
            (vật tư) hoặc <code className="rounded bg-slate-100 px-1 py-0.5">?warehouseId=...</code> (bồn dầu chung).
          </p>
          <div className="mt-6">
            <QuickActionsBar onScan={() => setScanning(true)} />
          </div>
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
              <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                <div>
                  <div className="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                    <MapPin size={12} /> Vị trí kho
                  </div>
                  <div className="mt-2 text-sm text-slate-700">{locationCode || "Chưa cấu hình"}</div>
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
            className="scroll-reveal"
          >
            <ResponsiveTableWrapper>
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
            </ResponsiveTableWrapper>
          </section>

          <section
            ref={revealRef}
            className="scroll-reveal"
          >
            <ResponsiveTableWrapper>
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
            </ResponsiveTableWrapper>
          </section>

          <section
            ref={revealRef}
            className="scroll-reveal"
          >
            <ResponsiveTableWrapper>
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
            </ResponsiveTableWrapper>
          </section>

          <QuickActionsBar onScan={() => setScanning(true)} />

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
