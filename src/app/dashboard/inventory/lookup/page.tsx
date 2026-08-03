"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Check, Clock3, Download, FileText, History, Printer, X } from "lucide-react"
import { saveAs } from "file-saver"
import * as XLSX from "xlsx"
import { getFreshAuthSession, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { InventoryPageShell, InventoryPlaceholderSection } from "../_components/inventory-shell"
import {
  loadInventoryMovementData,
  type InventoryItemOption,
  type InventoryStockMovementRow,
  type InventoryWarehouseOption,
} from "../_components/inventory-data"
import { MultiSelectField } from "../_components/inventory-ui"
import { resolveCanApproveInventory } from "../_components/inventory-approval"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { supabase } from "@/lib/supabase"

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"

type MovementDocumentType = "import" | "export" | "transfer"

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
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("vi-VN")
}

function getMovementLabel(movementType: InventoryStockMovementRow["movement_type"]) {
  if (movementType === "import") return "Nhập kho"
  if (movementType === "export") return "Xuất kho"
  return movementType === "transfer_in" ? "Chuyển đến" : "Chuyển đi"
}

function getMovementBadgeClass(movementType: InventoryStockMovementRow["movement_type"]) {
  if (movementType === "import") return "bg-emerald-100 text-emerald-700"
  if (movementType === "export") return "bg-amber-100 text-amber-700"
  return "bg-blue-100 text-blue-700"
}

function getDocumentHref(movementType: InventoryStockMovementRow["movement_type"], documentId: string) {
  if (movementType === "import") return `/dashboard/inventory/receipts?documentId=${encodeURIComponent(documentId)}`
  if (movementType === "export") return `/dashboard/inventory/issues?documentId=${encodeURIComponent(documentId)}`
  return `/dashboard/inventory/transfers?documentId=${encodeURIComponent(documentId)}`
}

function getDocumentType(movementType: InventoryStockMovementRow["movement_type"]): MovementDocumentType {
  if (movementType === "transfer_in" || movementType === "transfer_out") return "transfer"
  return movementType
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function firstDayOfCurrentMonthIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
}

function getReportQuantity(quantity: number) {
  return Math.abs(quantity)
}

function formatSelectedLabels(labels: string[], fallback: string) {
  if (labels.length === 0) return fallback
  return labels.join(", ")
}

export default function InventoryLookupPage() {
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState<string | null>(null)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [movements, setMovements] = useState<InventoryStockMovementRow[]>([])
  const [lineNotesById, setLineNotesById] = useState<Record<string, string>>({})
  const [documentInfoById, setDocumentInfoById] = useState<
    Record<string, { requesterName: string; approved: boolean }>
  >({})
  const [selectedWarehouseIds, setSelectedWarehouseIds] = useState<string[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [selectedDocumentTypes, setSelectedDocumentTypes] = useState<MovementDocumentType[]>([
    "import",
    "export",
    "transfer",
  ])
  const [selectedApprovalStates, setSelectedApprovalStates] = useState<string[]>([])
  const [fromDate, setFromDate] = useState(firstDayOfCurrentMonthIso())
  const [toDate, setToDate] = useState(todayIso())
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [canApprove, setCanApprove] = useState(false)
  const [approvingDocumentId, setApprovingDocumentId] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  const revealRef = useScrollReveal()

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventoryMovementData()
        const activeSession = await hydrateActiveSession().catch(() => ({ user: null }))
        setWarning(inventoryData.warning)
        setWarehouses(inventoryData.warehouses)
        setItems(inventoryData.items)
        setMovements(inventoryData.movements)
        setFactoryId(inventoryData.factoryId || null)
        if (activeSession.user) setCurrentUser(activeSession.user)

        if (inventoryData.factoryId && activeSession.user) {
          void resolveCanApproveInventory(inventoryData.factoryId, activeSession.user).then(setCanApprove)
        }

        if (inventoryData.factoryId && !inventoryData.warning && inventoryData.movements.length > 0) {
          const lineIds = Array.from(
            new Set(inventoryData.movements.map((movement) => movement.document_line_id).filter(Boolean)),
          )
          const { data } = await supabase
            .from("inventory_document_lines")
            .select("id, line_notes")
            .eq("factory_id", inventoryData.factoryId)
            .in("id", lineIds)

          if (data) {
            const nextNotes = Object.fromEntries(
              data.map((row) => [row.id as string, (row.line_notes as string | null) || ""]),
            )
            setLineNotesById(nextNotes)
          }

          // Mỗi dòng phát sinh chỉ có trong bảng này khi phiếu đã Ghi sổ (đã xác nhận:
          // inventory_cancel_document XÓA HẲN dòng phát sinh khi hủy phiếu) — nên "Trạng thái" ở
          // đây chỉ có 2 giá trị thật sự xảy ra: Chờ phê duyệt / Đã phê duyệt.
          const documentIds = Array.from(new Set(inventoryData.movements.map((movement) => movement.document_id)))
          const { data: docData } = await supabase
            .from("inventory_documents")
            .select("id, requester_name, approved_by_name")
            .eq("factory_id", inventoryData.factoryId)
            .in("id", documentIds)

          if (docData) {
            const nextDocInfo = Object.fromEntries(
              docData.map((row) => [
                row.id as string,
                {
                  requesterName: (row.requester_name as string | null) || "",
                  approved: !!row.approved_by_name,
                },
              ]),
            )
            setDocumentInfoById(nextDocInfo)
          }
        }
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
  const typeFilterSet = useMemo(() => new Set(selectedDocumentTypes), [selectedDocumentTypes])
  const approvalFilterSet = useMemo(() => new Set(selectedApprovalStates), [selectedApprovalStates])

  const availableCategories = useMemo(() => {
    const ids = new Set(
      movements
        .filter((movement) => selectedWarehouseIds.length === 0 || warehouseFilterSet.has(movement.warehouse_id))
        .map((movement) => itemMap.get(movement.item_id)?.category_id || "")
        .filter(Boolean),
    )

    const seen = new Map<string, { id: string; label: string }>()
    items.forEach((item) => {
      if (ids.has(item.category_id || "")) {
        seen.set(item.category_id || "", {
          id: item.category_id || "",
          label: item.category_name,
        })
      }
    })
    return [...seen.values()]
  }, [itemMap, items, movements, selectedWarehouseIds.length, warehouseFilterSet])

  const availableItems = useMemo(() => {
    const presentItemIds = new Set(
      movements
        .filter((movement) => selectedWarehouseIds.length === 0 || warehouseFilterSet.has(movement.warehouse_id))
        .map((movement) => movement.item_id),
    )

    return items.filter((item) => {
      if (!presentItemIds.has(item.id)) return false
      if (selectedCategoryIds.length > 0 && !categoryFilterSet.has(item.category_id || "")) return false
      return true
    })
  }, [categoryFilterSet, items, movements, selectedCategoryIds.length, selectedWarehouseIds.length, warehouseFilterSet])

  const filteredMovements = useMemo(() => {
    return movements
      .filter((movement) => selectedWarehouseIds.length === 0 || warehouseFilterSet.has(movement.warehouse_id))
      .filter((movement) => typeFilterSet.has(getDocumentType(movement.movement_type)))
      .filter((movement) => {
        const item = itemMap.get(movement.item_id)
        if (!item) return false
        if (selectedCategoryIds.length > 0 && !categoryFilterSet.has(item.category_id || "")) return false
        if (selectedItemIds.length > 0 && !itemFilterSet.has(item.id)) return false
        if (fromDate && movement.movement_date < fromDate) return false
        if (toDate && movement.movement_date > toDate) return false
        if (selectedApprovalStates.length > 0) {
          const approved = documentInfoById[movement.document_id]?.approved ?? false
          const state = approved ? "da_duyet" : "cho_duyet"
          if (!approvalFilterSet.has(state)) return false
        }
        return warehouseMap.has(movement.warehouse_id)
      })
      .map((movement) => {
        const warehouse = warehouseMap.get(movement.warehouse_id)
        const item = itemMap.get(movement.item_id)
        if (!warehouse || !item) return null

        return {
          ...movement,
          warehouse,
          item,
          categoryName: item.category_name,
          quantity: movement.quantity_in > 0 ? movement.quantity_in : movement.quantity_out,
          documentType: getDocumentType(movement.movement_type),
        }
      })
      .filter((movement): movement is NonNullable<typeof movement> => Boolean(movement))
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
    approvalFilterSet,
    categoryFilterSet,
    documentInfoById,
    fromDate,
    itemFilterSet,
    itemMap,
    movements,
    selectedApprovalStates.length,
    selectedCategoryIds.length,
    selectedItemIds.length,
    selectedWarehouseIds.length,
    toDate,
    typeFilterSet,
    warehouseFilterSet,
    warehouseMap,
  ])

  const stats = useMemo(() => {
    const importCount = filteredMovements.filter((movement) => movement.documentType === "import").length
    const exportCount = filteredMovements.filter((movement) => movement.documentType === "export").length
    const transferCount = filteredMovements.filter((movement) => movement.documentType === "transfer").length
    const latestDate = filteredMovements[0]?.movement_date || null

    return {
      movementCount: filteredMovements.length,
      importCount,
      exportCount,
      transferCount,
      latestDate,
    }
  }, [filteredMovements])

  const selectedCategoryLabels = useMemo(() => {
    const categoryNameById = new Map<string, string>()
    items.forEach((item) => {
      if (item.category_id && item.category_name && !categoryNameById.has(item.category_id)) {
        categoryNameById.set(item.category_id, item.category_name)
      }
    })

    return selectedCategoryIds
      .map((categoryId) => categoryNameById.get(categoryId))
      .filter((value): value is string => Boolean(value))
  }, [items, selectedCategoryIds])

  const selectedTypeLabels = useMemo(
    () =>
      selectedDocumentTypes.map((type) =>
        type === "import" ? "Nhập kho" : type === "export" ? "Xuất kho" : "Chuyển kho",
      ),
    [selectedDocumentTypes],
  )

  const exportExcel = () => {
    const detailRows = filteredMovements.map((movement) => ({
      date: formatDate(movement.movement_date),
      code: movement.item.code,
      name: movement.item.name,
      unit: movement.item.unit,
      quantity: getReportQuantity(movement.quantity),
      note: [getMovementLabel(movement.movement_type), lineNotesById[movement.document_line_id] || ""]
        .filter(Boolean)
        .join(" | "),
    }))

    const summaryRows = Object.values(
      filteredMovements.reduce<Record<string, { code: string; name: string; unit: string; quantity: number }>>(
        (acc, movement) => {
          const key = movement.item.code
          if (!acc[key]) {
            acc[key] = {
              code: movement.item.code,
              name: movement.item.name,
              unit: movement.item.unit,
              quantity: 0,
            }
          }
          acc[key].quantity += getReportQuantity(movement.quantity)
          return acc
        },
        {},
      ),
    ).sort((a, b) => a.code.localeCompare(b.code, "vi"))

    const sheetRows: (string | number)[][] = [
      ["CÔNG TY TNHH PTCS PHƯỚC HÒA KAMPONG THOM"],
      ["NHÀ MÁY CHẾ BIẾN"],
      [],
      ["", "", "Báo cáo", "", formatSelectedLabels(selectedTypeLabels, "Tất cả loại phiếu")],
      [],
      ["Từ ngày", fromDate || "", "", "", "Người báo cáo", currentUser?.username || currentUser?.full_name || ""],
      ["Đến ngày", toDate || "", "", "", "Lúc", new Date().toLocaleString("vi-VN")],
      ["Phân loại vật tư", formatSelectedLabels(selectedCategoryLabels, "Tất cả phân loại")],
      [],
      ["", "", "", "", "", "", "", "", "Tổng hợp"],
      [],
      ["Ngày", "Mã vật tư", "Tên vật tư", "Đơn vị tính", "Số lượng", "Ghi chú", "", "", "Mã vật tư", "Tên vật tư", "Đơn vị tính", "Tổng số lượng"],
    ]

    detailRows.forEach((row, index) => {
      const summary = summaryRows[index]
      sheetRows.push([
        row.date,
        row.code,
        row.name,
        row.unit,
        row.quantity,
        row.note,
        "",
        "",
        summary?.code || "",
        summary?.name || "",
        summary?.unit || "",
        summary?.quantity ?? "",
      ])
    })

    if (summaryRows.length > detailRows.length) {
      for (let index = detailRows.length; index < summaryRows.length; index += 1) {
        const summary = summaryRows[index]
        sheetRows.push(["", "", "", "", "", "", "", "", summary.code, summary.name, summary.unit, summary.quantity])
      }
    }

    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet(sheetRows)
    sheet["!merges"] = [
      XLSX.utils.decode_range("A1:F1"),
      XLSX.utils.decode_range("A2:F2"),
      XLSX.utils.decode_range("C4:D4"),
      XLSX.utils.decode_range("E4:F4"),
      XLSX.utils.decode_range("I10:L10"),
    ]
    sheet["!cols"] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 22 },
      { wch: 12 },
      { wch: 12 },
      { wch: 24 },
      { wch: 3 },
      { wch: 3 },
      { wch: 14 },
      { wch: 22 },
      { wch: 12 },
      { wch: 14 },
    ]
    XLSX.utils.book_append_sheet(workbook, sheet, "The kho")

    const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
    saveAs(
      new Blob([output], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `the-kho-${new Date().toISOString().slice(0, 10)}.xlsx`,
    )
  }

  const handleApproveDocument = async (documentId: string) => {
    if (!factoryId || approvingDocumentId) return
    setApproveError(null)
    setApprovingDocumentId(documentId)
    try {
      const session = await getFreshAuthSession()
      if (!session?.user) {
        setApproveError("Phiên đăng nhập đã hết hạn.")
        return
      }
      const byName = currentUser?.full_name || currentUser?.username || session.user.email || ""
      const nowIso = new Date().toISOString()
      const { error } = await supabase
        .from("inventory_documents")
        .update({ approved_by: session.user.id, approved_by_name: byName, approved_at: nowIso })
        .eq("id", documentId)
        .eq("factory_id", factoryId)
      if (error) throw error
      setDocumentInfoById((prev) => ({
        ...prev,
        [documentId]: { requesterName: prev[documentId]?.requesterName || "", approved: true },
      }))
    } catch (error) {
      setApproveError(error instanceof Error ? error.message : "Không thể phê duyệt phiếu.")
    } finally {
      setApprovingDocumentId(null)
    }
  }

  return (
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title="Tra cứu"
      description="Tra cứu lịch sử nhập, xuất, chuyển theo từng vật tư và từng kho để phục vụ truy vết nghiệp vụ."
      action={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportExcel}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700"
          >
            <Download size={16} />
            Xuất Excel
          </button>
          <Link
            href={`/dashboard/inventory/print-report?kind=cards&warehouses=${encodeURIComponent(selectedWarehouseIds.join(","))}&categories=${encodeURIComponent(selectedCategoryIds.join(","))}&items=${encodeURIComponent(selectedItemIds.join(","))}&types=${encodeURIComponent(selectedDocumentTypes.join(","))}&from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <Printer size={16} />
            In thẻ kho
          </Link>
        </div>
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
        className="scroll-reveal relative z-40 mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-4"
      >
        <div className="w-full">
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

        <div className="w-full">
          <MultiSelectField
            label="Phân loại"
            options={availableCategories.map((category) => ({
              value: category.id,
              label: category.label,
            }))}
            selectedValues={selectedCategoryIds}
            onChange={(values) => {
              setSelectedCategoryIds(values)
              setSelectedItemIds([])
            }}
            placeholder="Tất cả phân loại"
          />
        </div>

        <div className="w-full">
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

        <div className="w-full">
          <MultiSelectField
            label="Loại phiếu"
            options={[
              { value: "import", label: "Nhập kho" },
              { value: "export", label: "Xuất kho" },
              { value: "transfer", label: "Chuyển kho" },
            ]}
            selectedValues={selectedDocumentTypes}
            onChange={(values) => setSelectedDocumentTypes(values as MovementDocumentType[])}
            placeholder="Tất cả loại phiếu"
          />
        </div>

        <div className="w-full">
          <MultiSelectField
            label="Trạng thái"
            options={[
              { value: "cho_duyet", label: "Chờ phê duyệt" },
              { value: "da_duyet", label: "Đã phê duyệt" },
            ]}
            selectedValues={selectedApprovalStates}
            onChange={setSelectedApprovalStates}
            placeholder="Tất cả trạng thái"
          />
        </div>

        <div className="w-full">
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Từ ngày</label>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={INPUT_CLASS} />
        </div>

        <div className="w-full">
          <label className="mb-1.5 block text-xs font-bold text-slate-600">Đến ngày</label>
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className={INPUT_CLASS} />
        </div>
      </section>

      <section
        ref={revealRef}
        className="scroll-reveal relative z-0"
      >
        <ResponsiveTableWrapper>
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
                  {["Ngày", "Kho", "Phân loại", "Mã vật tư", "Tên vật tư", "Loại giao dịch", "Trạng thái", "Người tạo", "Số lượng", "Tồn sau", "Chứng từ"].map(
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
                    <td className="px-4 py-3 text-slate-600">{movement.categoryName}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/inventory/item?code=${encodeURIComponent(movement.item.code)}&warehouseId=${encodeURIComponent(movement.warehouse.id)}`}
                        className="font-bold text-slate-700 transition hover:text-emerald-700"
                      >
                        {movement.item.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{movement.item.name}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${getMovementBadgeClass(movement.movement_type)}`}>
                        {getMovementLabel(movement.movement_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {documentInfoById[movement.document_id]?.approved ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
                          Đã phê duyệt
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">
                          Chờ phê duyệt
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {documentInfoById[movement.document_id]?.requesterName || "—"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{movement.quantity.toLocaleString("vi-VN")}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {movement.balance_after === null ? "Chưa có" : movement.balance_after.toLocaleString("vi-VN")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {canApprove &&
                          movement.documentType !== "transfer" &&
                          !documentInfoById[movement.document_id]?.approved && (
                            <button
                              type="button"
                              onClick={() => void handleApproveDocument(movement.document_id)}
                              disabled={approvingDocumentId === movement.document_id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100 disabled:opacity-60"
                              title="Phê duyệt phiếu"
                            >
                              <Check size={13} />
                              {approvingDocumentId === movement.document_id ? "Đang duyệt..." : "Duyệt"}
                            </button>
                          )}
                        <Link
                          href={getDocumentHref(movement.movement_type, movement.document_id)}
                          className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700"
                        >
                          Mở phiếu
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ResponsiveTableWrapper>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <InventoryPlaceholderSection
          title="Truy vết theo vật tư"
          description="Từ thẻ kho có thể đi ngược lại từng dòng phát sinh để kiểm tra số lô, hạn sử dụng và diễn biến tồn theo thời gian."
          icon={<History size={18} />}
          bullets={[
            "Lọc theo kho, phân loại, mã vật tư và loại phiếu để xem đúng phạm vi cần đối chiếu.",
            "Kiểm tra nhanh phát sinh nhập, xuất và điều chuyển của từng vật tư.",
            "Làm nền cho bước xuất file thẻ kho theo cùng bộ lọc.",
          ]}
        />

        <InventoryPlaceholderSection
          title="Liên kết chứng từ"
          description="Bước tiếp theo có thể mở sâu từ thẻ kho sang phiếu nhập, phiếu xuất hoặc phiếu chuyển tương ứng để truy vết đầy đủ."
          icon={<Clock3 size={18} />}
          bullets={[
            "Từ lịch sử phát sinh có thể mở chi tiết từng chứng từ khi cần.",
            "Giúp đối chiếu dữ liệu khi kiểm tra nội bộ hoặc kiểm kê.",
            "Bản in sẽ bám đúng bộ lọc nhiều lựa chọn đang xem.",
          ]}
        />
      </div>

      {approveError && (
        <div className="fixed left-1/2 top-4 z-50 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl bg-red-600 px-5 py-3 text-white shadow-2xl">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-bold">{approveError}</span>
          <button onClick={() => setApproveError(null)} className="ml-2 hover:opacity-70">
            <X size={14} />
          </button>
        </div>
      )}
    </InventoryPageShell>
  )
}
