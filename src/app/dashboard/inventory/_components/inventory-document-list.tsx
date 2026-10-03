"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowRightLeft,
  Ban,
  Check,
  Eye,
  FileText,
  PackageMinus,
  PackagePlus,
  Printer,
  RotateCcw,
  type LucideIcon,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getFreshAuthSession, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { getFactoryTodayISO, getFirstDayOfMonthISO } from "@/lib/date-utils"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { InventoryPageShell } from "./inventory-shell"
import { InventoryActionButton, InventoryActionLink, MultiSelectField, type InventoryActionTone } from "./inventory-ui"
import {
  loadInventoryAdminData,
  type InventoryCategoryOption,
  type InventoryItemOption,
  type InventoryWarehouseOption,
} from "./inventory-data"
import { resolveCanApproveInventory } from "./inventory-approval"

export type InventoryDocumentKind = "import" | "export" | "transfer"

type DocStatus = "draft" | "posted" | "cancelled"

type DocumentRow = {
  id: string
  document_code: string
  document_date: string
  source_warehouse_id: string | null
  target_warehouse_id: string | null
  source_name: string | null
  recipient_name: string | null
  requester_name: string | null
  status: DocStatus
  approved_at: string | null
  approved_by_name: string | null
  created_at: string | null
}

type LineRow = {
  document_id: string
  item_id: string
  item_code: string | null
  quantity: number | null
  unit: string | null
}

type KindConfig = {
  route: string
  title: string
  description: string
  addLabel: string
  addIcon: LucideIcon
  addTone: InventoryActionTone
  partyLabel: string
  supportsApproval: boolean
}

const KIND_CONFIG: Record<InventoryDocumentKind, KindConfig> = {
  import: {
    route: "/dashboard/inventory/receipts",
    title: "Nhập kho",
    description: "Danh sách phiếu nhập kho — lọc theo ngày, kho, vật tư và trạng thái.",
    addLabel: "Thêm phiếu nhập",
    addIcon: PackagePlus,
    addTone: "emerald",
    partyLabel: "Nguồn nhập",
    supportsApproval: true,
  },
  export: {
    route: "/dashboard/inventory/issues",
    title: "Xuất kho",
    description: "Danh sách phiếu xuất kho — phê duyệt nhanh ngay trên từng dòng.",
    addLabel: "Thêm phiếu xuất",
    addIcon: PackageMinus,
    addTone: "amber",
    partyLabel: "Người nhận",
    supportsApproval: true,
  },
  transfer: {
    route: "/dashboard/inventory/transfers",
    title: "Chuyển kho",
    description: "Danh sách phiếu chuyển kho — kho đi, kho đến và trạng thái ghi sổ.",
    addLabel: "Thêm phiếu chuyển",
    addIcon: ArrowRightLeft,
    addTone: "sky",
    partyLabel: "Người đề nghị",
    supportsApproval: false,
  },
}

const STATUS_OPTIONS = [
  { value: "draft", label: "Nháp" },
  { value: "posted", label: "Đã ghi sổ" },
  { value: "cancelled", label: "Đã hủy" },
]

const APPROVAL_OPTIONS = [
  { value: "pending", label: "Chờ phê duyệt" },
  { value: "approved", label: "Đã phê duyệt" },
]

const STATUS_BADGE: Record<DocStatus, { label: string; className: string }> = {
  draft: { label: "Nháp", className: "bg-slate-100 text-slate-600" },
  posted: { label: "Đã ghi sổ", className: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Đã hủy", className: "bg-red-100 text-red-600" },
}

const PAGE_SIZE = 1000
const CHUNK_SIZE = 200
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"

function formatDate(value: string | null) {
  if (!value) return "—"
  const [y, m, d] = value.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : value
}

async function fetchDocuments(factoryId: string, kind: InventoryDocumentKind, from: string, to: string) {
  const all: DocumentRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from("inventory_documents")
      .select(
        "id, document_code, document_date, source_warehouse_id, target_warehouse_id, source_name, recipient_name, requester_name, status, approved_at, approved_by_name, created_at",
      )
      .eq("factory_id", factoryId)
      .eq("document_type", kind)
      .order("document_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (from) query = query.gte("document_date", from)
    if (to) query = query.lte("document_date", to)
    const { data, error } = await query
    if (error) throw error
    all.push(...((data || []) as DocumentRow[]))
    if (!data || data.length < PAGE_SIZE) break
  }
  return all
}

async function fetchLines(factoryId: string, documentIds: string[]) {
  const all: LineRow[] = []
  for (let i = 0; i < documentIds.length; i += CHUNK_SIZE) {
    const chunk = documentIds.slice(i, i + CHUNK_SIZE)
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("inventory_document_lines")
        .select("document_id, item_id, item_code, quantity, unit")
        .eq("factory_id", factoryId)
        .in("document_id", chunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) throw error
      all.push(...((data || []) as LineRow[]))
      if (!data || data.length < PAGE_SIZE) break
    }
  }
  return all
}

export function InventoryDocumentList({ kind }: { kind: InventoryDocumentKind }) {
  const config = KIND_CONFIG[kind]
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [canApprove, setCanApprove] = useState(false)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [categories, setCategories] = useState<InventoryCategoryOption[]>([])
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [lines, setLines] = useState<LineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null)

  const [fromDate, setFromDate] = useState(() => getFirstDayOfMonthISO(getFactoryTodayISO()))
  const [toDate, setToDate] = useState(() => getFactoryTodayISO())
  const [warehouseIds, setWarehouseIds] = useState<string[]>([])
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [itemIds, setItemIds] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [approvalStates, setApprovalStates] = useState<string[]>([])

  const [approveTarget, setApproveTarget] = useState<DocumentRow | null>(null)
  const [cancelTarget, setCancelTarget] = useState<DocumentRow | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [busy, setBusy] = useState(false)

  // Bootstrap: chỉ lấy session + danh mục, việc tải danh sách phiếu để effect bên dưới lo.
  useEffect(() => {
    let alive = true
    const bootstrap = async () => {
      try {
        const [{ user: sessionUser }, admin] = await Promise.all([
          hydrateActiveSession().catch(() => ({ user: null })),
          loadInventoryAdminData(),
        ])
        if (!alive) return
        setUser(sessionUser)
        setWarehouses(admin.warehouses)
        setCategories(admin.categories)
        setItems(admin.items)
        if (!admin.factoryId) {
          setError("Không xác định được nhà máy đang đăng nhập.")
          setLoading(false)
          return
        }
        setFactoryId(admin.factoryId)
        if (config.supportsApproval) {
          const allowed = await resolveCanApproveInventory(admin.factoryId, sessionUser).catch(() => false)
          if (alive) setCanApprove(allowed)
        }
      } catch {
        if (alive) {
          setError("Không tải được danh mục kho.")
          setLoading(false)
        }
      }
    }
    void bootstrap()
    return () => {
      alive = false
    }
  }, [config.supportsApproval])

  const loadDocuments = useCallback(async () => {
    if (!factoryId) return
    setLoading(true)
    setError(null)
    try {
      const docs = await fetchDocuments(factoryId, kind, fromDate, toDate)
      const docLines = await fetchLines(factoryId, docs.map((doc) => doc.id))
      setDocuments(docs)
      setLines(docLines)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được danh sách phiếu.")
    } finally {
      setLoading(false)
    }
  }, [factoryId, kind, fromDate, toDate])

  useEffect(() => {
    if (factoryId) void loadDocuments()
  }, [factoryId, loadDocuments])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const warehouseById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses])
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const linesByDocument = useMemo(() => {
    const map = new Map<string, LineRow[]>()
    for (const line of lines) {
      const list = map.get(line.document_id) || []
      list.push(line)
      map.set(line.document_id, list)
    }
    return map
  }, [lines])

  // Mã vật tư chỉ liệt kê theo phân loại đã chọn (lọc xếp tầng như các màn kho khác).
  const itemOptions = useMemo(
    () =>
      items
        .filter((item) => categoryIds.length === 0 || categoryIds.includes(item.category_id || ""))
        .map((item) => ({ value: item.id, label: item.code, meta: item.name })),
    [items, categoryIds],
  )

  const filteredDocuments = useMemo(() => {
    const itemSet = new Set(itemIds)
    const categorySet = new Set(categoryIds)
    return documents.filter((doc) => {
      if (statuses.length > 0 && !statuses.includes(doc.status)) return false
      if (warehouseIds.length > 0) {
        const touched = [doc.source_warehouse_id, doc.target_warehouse_id].filter(Boolean) as string[]
        if (!touched.some((id) => warehouseIds.includes(id))) return false
      }
      if (config.supportsApproval && approvalStates.length > 0) {
        // "Chờ phê duyệt" chỉ có nghĩa với phiếu đã ghi sổ.
        const state = doc.approved_at ? "approved" : doc.status === "posted" ? "pending" : null
        if (!state || !approvalStates.includes(state)) return false
      }
      if (itemSet.size > 0 || categorySet.size > 0) {
        const docLines = linesByDocument.get(doc.id) || []
        const matched = docLines.some((line) => {
          if (itemSet.size > 0) return itemSet.has(line.item_id)
          return categorySet.has(itemById.get(line.item_id)?.category_id || "")
        })
        if (!matched) return false
      }
      return true
    })
  }, [documents, statuses, warehouseIds, approvalStates, itemIds, categoryIds, linesByDocument, itemById, config.supportsApproval])

  const counts = useMemo(() => {
    const result = { total: filteredDocuments.length, draft: 0, posted: 0, cancelled: 0, pending: 0 }
    for (const doc of filteredDocuments) {
      result[doc.status] += 1
      if (doc.status === "posted" && !doc.approved_at) result.pending += 1
    }
    return result
  }, [filteredDocuments])

  const activeFilterCount =
    [warehouseIds, categoryIds, itemIds, statuses, approvalStates].filter((value) => value.length > 0).length

  const warehouseLabel = (doc: DocumentRow) => {
    const code = (id: string | null) => (id ? warehouseById.get(id)?.code || "?" : "—")
    if (kind === "import") return code(doc.target_warehouse_id)
    if (kind === "export") return code(doc.source_warehouse_id)
    return `${code(doc.source_warehouse_id)} → ${code(doc.target_warehouse_id)}`
  }

  const partyLabel = (doc: DocumentRow) => {
    if (kind === "import") return doc.source_name || "—"
    if (kind === "export") return doc.recipient_name || doc.requester_name || "—"
    return doc.requester_name || "—"
  }

  const itemSummary = (doc: DocumentRow) => {
    const docLines = linesByDocument.get(doc.id) || []
    if (docLines.length === 0) return { text: "Chưa có dòng", total: "" }
    const codes = Array.from(new Set(docLines.map((line) => line.item_code || itemById.get(line.item_id)?.code || "?")))
    const text = codes.length <= 2 ? codes.join(", ") : `${codes.slice(0, 2).join(", ")} +${codes.length - 2}`
    const units = new Set(docLines.map((line) => line.unit || ""))
    const total = docLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
    return {
      text,
      total: units.size === 1 ? `${total.toLocaleString("vi-VN")} ${[...units][0]}`.trim() : `${docLines.length} dòng`,
    }
  }

  const handleApprove = async () => {
    if (!factoryId || !approveTarget) return
    setBusy(true)
    try {
      const session = await getFreshAuthSession()
      if (!session?.user) throw new Error("Phiên đăng nhập đã hết hạn.")
      const byName = user?.full_name || user?.username || session.user.email || ""
      const { error: updateError } = await supabase
        .from("inventory_documents")
        .update({ approved_by: session.user.id, approved_by_name: byName, approved_at: new Date().toISOString() })
        .eq("id", approveTarget.id)
        .eq("factory_id", factoryId)
        .eq("status", "posted")
      if (updateError) throw updateError
      setToast({ tone: "success", text: `Đã phê duyệt phiếu ${approveTarget.document_code}.` })
      setApproveTarget(null)
      void loadDocuments()
    } catch (err) {
      setToast({ tone: "error", text: err instanceof Error ? err.message : "Không thể phê duyệt phiếu." })
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async () => {
    if (!factoryId || !cancelTarget || !cancelReason.trim()) return
    setBusy(true)
    try {
      const session = await getFreshAuthSession()
      if (!session?.user) throw new Error("Phiên đăng nhập đã hết hạn.")
      const { error: rpcError } = await supabase.rpc("inventory_cancel_document", {
        p_factory_id: factoryId,
        p_document_id: cancelTarget.id,
        p_cancelled_by: session.user.id,
        p_cancel_reason: cancelReason.trim(),
      })
      if (rpcError) throw rpcError
      setToast({ tone: "success", text: `Đã hủy phiếu ${cancelTarget.document_code}. Tồn kho đã được hoàn nguyên.` })
      setCancelTarget(null)
      setCancelReason("")
      void loadDocuments()
    } catch (err) {
      setToast({ tone: "error", text: err instanceof Error ? err.message : "Không thể hủy phiếu." })
    } finally {
      setBusy(false)
    }
  }

  const resetFilters = () => {
    setFromDate(getFirstDayOfMonthISO(getFactoryTodayISO()))
    setToDate(getFactoryTodayISO())
    setWarehouseIds([])
    setCategoryIds([])
    setItemIds([])
    setStatuses([])
    setApprovalStates([])
  }

  const canCreate = hasPermission(user, "inventory.create") || hasPermission(user, "inventory.edit") || user?.role === "admin"
  const canCancel = hasPermission(user, "inventory.cancel")

  return (
    <InventoryPageShell
      title={config.title}
      description={config.description}
      action={
        canCreate ? (
          <InventoryActionLink
            href={`${config.route}?mode=new`}
            icon={config.addIcon}
            label={config.addLabel}
            tone={config.addTone}
          />
        ) : null
      }
    >
      {toast ? (
        <div
          className={`fixed bottom-4 right-4 z-[140] max-w-sm rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-xl ${
            toast.tone === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.text}
        </div>
      ) : null}

      <div className="relative z-20 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <FilterBar activeCount={activeFilterCount} className="!m-0 !border-0 !p-0 !shadow-none">
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">Từ ngày</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={INPUT_CLASS} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">Đến ngày</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={INPUT_CLASS} />
            </div>
            <MultiSelectField
              label={kind === "transfer" ? "Kho (đi hoặc đến)" : "Kho"}
              options={warehouses.map((w) => ({ value: w.id, label: w.code, meta: w.name }))}
              selectedValues={warehouseIds}
              onChange={setWarehouseIds}
              placeholder="Tất cả kho"
            />
            <MultiSelectField
              label="Phân loại vật tư"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              selectedValues={categoryIds}
              onChange={(values) => {
                setCategoryIds(values)
                // Bỏ các mã vật tư không còn thuộc phân loại vừa chọn.
                if (values.length > 0) {
                  setItemIds((current) => current.filter((id) => values.includes(itemById.get(id)?.category_id || "")))
                }
              }}
              placeholder="Tất cả phân loại"
            />
            <MultiSelectField
              label="Mã vật tư"
              options={itemOptions}
              selectedValues={itemIds}
              onChange={setItemIds}
              placeholder="Tất cả mã vật tư"
            />
            <MultiSelectField
              label="Trạng thái"
              options={STATUS_OPTIONS}
              selectedValues={statuses}
              onChange={setStatuses}
              placeholder="Tất cả trạng thái"
            />
            {config.supportsApproval ? (
              <MultiSelectField
                label="Phê duyệt"
                options={APPROVAL_OPTIONS}
                selectedValues={approvalStates}
                onChange={setApprovalStates}
                placeholder="Tất cả"
              />
            ) : (
              <div className="flex items-end">
                <InventoryActionButton icon={RotateCcw} label="Xóa lọc" tone="slate" onClick={resetFilters} className="w-full" />
              </div>
            )}
          </div>
        </FilterBar>
        {config.supportsApproval ? (
          <div className="mt-3 flex justify-end">
            <InventoryActionButton icon={RotateCcw} label="Xóa lọc" tone="slate" onClick={resetFilters} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-bold">
        <span className="rounded-full bg-white px-3 py-1.5 text-slate-700 shadow-sm ring-1 ring-slate-200">
          {counts.total} phiếu
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-600">Nháp: {counts.draft}</span>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">Đã ghi sổ: {counts.posted}</span>
        <span className="rounded-full bg-red-50 px-3 py-1.5 text-red-600">Đã hủy: {counts.cancelled}</span>
        {config.supportsApproval ? (
          <button
            type="button"
            onClick={() => setApprovalStates(["pending"])}
            className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
          >
            Chờ phê duyệt: {counts.pending}
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {error ? (
          <div className="p-6 text-sm text-red-600">{error}</div>
        ) : loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải danh sách phiếu...</div>
        ) : filteredDocuments.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <FileText size={40} className="mx-auto mb-3 opacity-30" />
            <p>Không có phiếu phù hợp bộ lọc.</p>
          </div>
        ) : (
          <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Mã phiếu</th>
                  <th className="px-4 py-3">Ngày</th>
                  <th className="px-4 py-3">Kho</th>
                  <th className="px-4 py-3">{config.partyLabel}</th>
                  <th className="px-4 py-3">Vật tư</th>
                  <th className="px-4 py-3 text-right">Số lượng</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocuments.map((doc) => {
                  const summary = itemSummary(doc)
                  const badge = STATUS_BADGE[doc.status] || STATUS_BADGE.draft
                  const openHref = `${config.route}?documentId=${encodeURIComponent(doc.id)}`
                  const showApprove = config.supportsApproval && canApprove && doc.status === "posted" && !doc.approved_at
                  return (
                    <tr key={doc.id} className="transition-colors hover:bg-amber-50/40">
                      <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-800">
                        <a href={openHref} className="hover:text-amber-700 hover:underline">
                          {doc.document_code}
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(doc.document_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-700">{warehouseLabel(doc)}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-slate-600" title={partyLabel(doc)}>
                        {partyLabel(doc)}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-600" title={summary.text}>
                        {summary.text}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">{summary.total}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span>
                          {config.supportsApproval && doc.approved_at ? (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600"
                              title={doc.approved_by_name ? `Phê duyệt bởi ${doc.approved_by_name}` : undefined}
                            >
                              <Check size={11} /> Đã phê duyệt
                            </span>
                          ) : config.supportsApproval && doc.status === "posted" ? (
                            <span className="text-[11px] font-semibold text-amber-600">Chờ phê duyệt</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <InventoryActionLink href={openHref} icon={Eye} label={doc.status === "draft" ? "Mở / sửa phiếu" : "Xem phiếu"} tone="sky" size="icon" />
                          <InventoryActionLink
                            href={`/dashboard/inventory/print?type=${kind}&documentId=${encodeURIComponent(doc.id)}`}
                            icon={Printer}
                            label="In phiếu"
                            tone="slate"
                            size="icon"
                          />
                          {showApprove ? (
                            <InventoryActionButton icon={Check} label="Duyệt" tone="emerald" onClick={() => setApproveTarget(doc)} size="sm" />
                          ) : null}
                          {doc.status === "posted" && canCancel ? (
                            <InventoryActionButton icon={Ban} label="Hủy phiếu" tone="rose" size="icon" onClick={() => setCancelTarget(doc)} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        )}
      </div>

      {approveTarget ? (
        <ModalShell
          title="Phê duyệt phiếu"
          onClose={() => (busy ? undefined : setApproveTarget(null))}
          maxWidth="md"
          footer={
            <>
              <InventoryActionButton icon={RotateCcw} label="Đóng" tone="slate" onClick={() => setApproveTarget(null)} disabled={busy} />
              <InventoryActionButton icon={Check} label={busy ? "Đang duyệt..." : "Duyệt"} tone="emerald" onClick={() => void handleApprove()} disabled={busy} />
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xác nhận phê duyệt phiếu <strong>{approveTarget.document_code}</strong> ngày {formatDate(approveTarget.document_date)}?
          </p>
        </ModalShell>
      ) : null}

      {cancelTarget ? (
        <ModalShell
          title="Hủy phiếu"
          onClose={() => (busy ? undefined : setCancelTarget(null))}
          maxWidth="md"
          footer={
            <>
              <InventoryActionButton icon={RotateCcw} label="Đóng" tone="slate" onClick={() => setCancelTarget(null)} disabled={busy} />
              <InventoryActionButton
                icon={Ban}
                label={busy ? "Đang hủy..." : "Hủy phiếu"}
                tone="rose"
                onClick={() => void handleCancel()}
                disabled={busy || !cancelReason.trim()}
              />
            </>
          }
        >
          <p className="mb-3 text-sm text-slate-600">
            Hủy phiếu <strong>{cancelTarget.document_code}</strong> sẽ hoàn nguyên tồn kho. Bắt buộc nhập lý do.
          </p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            placeholder="Lý do hủy phiếu"
            className={INPUT_CLASS}
          />
        </ModalShell>
      ) : null}
    </InventoryPageShell>
  )
}
