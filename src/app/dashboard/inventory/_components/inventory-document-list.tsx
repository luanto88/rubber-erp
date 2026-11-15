"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import {
  ArrowRightLeft,
  Ban,
  BookCheck,
  Check,
  Clock,
  FilePen,
  History,
  FileText,
  PackageMinus,
  PackagePlus,
  QrCode,
  Search,
  X,
  RotateCcw,
  Scale,
  type LucideIcon,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getFreshAuthSession, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { getFactoryTodayISO, getFirstDayOfMonthISO } from "@/lib/date-utils"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action"
import { IconAction, IconActionGroup } from "@/app/dashboard/_components/doc-ui/icon-action"
import { ADJUSTMENT_LABEL } from "@/lib/inventory-adjustment"
import {
  LEGACY_LABEL,
  LEGACY_LAST_DATE,
  groupLegacyDocuments,
  loadLegacyMovements,
  makeLegacyWarehouseResolver,
  type LegacyDocument,
  type LegacyMovementRow,
} from "@/lib/inventory-legacy"
import { ExpandableRow, ExpandAllToggle, ExpandHeaderCell } from "@/app/dashboard/_components/doc-ui/expandable-row"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { InventoryPageShell } from "./inventory-shell"
import { MultiSelectField } from "./inventory-ui"
import { HeaderButton } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import {
  loadInventoryAdminData,
  type InventoryCategoryOption,
  type InventoryItemOption,
  type InventoryWarehouseOption,
} from "./inventory-data"
import { resolveCanApproveInventory } from "./inventory-approval"
import { getErrorMessage } from "@/lib/error-message"

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
  /** Phiếu điều chỉnh tồn (migration 20261126) — không tính báo cáo sử dụng / định mức. */
  la_dieu_chinh?: boolean | null
  ly_do_dieu_chinh?: string | null
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
    partyLabel: "Nguồn nhập",
    supportsApproval: true,
  },
  export: {
    route: "/dashboard/inventory/issues",
    title: "Xuất kho",
    description: "Danh sách phiếu xuất kho — phê duyệt nhanh ngay trên từng dòng.",
    addLabel: "Thêm phiếu xuất",
    addIcon: PackageMinus,
    partyLabel: "Người nhận",
    supportsApproval: true,
  },
  transfer: {
    route: "/dashboard/inventory/transfers",
    title: "Chuyển kho",
    description: "Danh sách phiếu chuyển kho — kho đi, kho đến và trạng thái ghi sổ.",
    addLabel: "Thêm phiếu chuyển",
    addIcon: ArrowRightLeft,
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

// Phiếu cũ (AppSheet, trước 31/07/2026) chỉ có ở Nhập / Xuất — chỉ xem, không có trạng thái / phê duyệt.
const docKindOptions = (kind: InventoryDocumentKind) => [
  { value: "usage", label: kind === "export" ? "Xuất sử dụng" : "Nhập thường" },
  { value: "adjustment", label: ADJUSTMENT_LABEL },
  { value: "legacy", label: LEGACY_LABEL },
]

// html5-qrcode đụng navigator.mediaDevices ⇒ chỉ chạy ở client.
const QrScanner = dynamic(
  () => import("@/app/dashboard/product/confirm/qr-scanner").then((m) => m.QrScanner),
  { ssr: false },
)

const KIND_BY_ROUTE_SEGMENT: Record<string, InventoryDocumentKind> = {
  receipts: "import",
  issues: "export",
  transfers: "transfer",
}

/** Đường dẫn trang chi tiết phiếu (QR in trên phiếu PDF cũng trỏ về đây). */
export function inventoryDocumentDetailHref(kind: InventoryDocumentKind, id: string) {
  return `/dashboard/inventory/document/${kind}/${encodeURIComponent(id)}`
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

const BASE_DOC_COLUMNS =
  "id, document_code, document_date, source_warehouse_id, target_warehouse_id, source_name, recipient_name, requester_name, status, approved_at, approved_by_name, created_at"
const ADJUSTMENT_DOC_COLUMNS = ", la_dieu_chinh, ly_do_dieu_chinh"
// Chưa chạy migration 20261126 ⇒ cột chưa có: tự rơi về bộ cột cũ (nhớ cho các lần tải sau).
let adjustmentColumnsAvailable = true

/** Ngày ISO hoàn chỉnh (ô date đang gõ dở trả "" hoặc năm 0002…) — chỉ lọc / tải khi hợp lệ. */
function isCompleteISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 2000
}

async function fetchDocuments(factoryId: string, kind: InventoryDocumentKind, from: string, to: string): Promise<DocumentRow[]> {
  try {
    return await fetchDocumentsWith(factoryId, kind, from, to, adjustmentColumnsAvailable ? BASE_DOC_COLUMNS + ADJUSTMENT_DOC_COLUMNS : BASE_DOC_COLUMNS)
  } catch (err) {
    const e = err as { code?: string; message?: string }
    if (adjustmentColumnsAvailable && (e?.code === "42703" || /la_dieu_chinh|ly_do_dieu_chinh/.test(String(e?.message || "")))) {
      adjustmentColumnsAvailable = false
      return fetchDocumentsWith(factoryId, kind, from, to, BASE_DOC_COLUMNS)
    }
    throw err
  }
}

async function fetchDocumentsWith(factoryId: string, kind: InventoryDocumentKind, from: string, to: string, columns: string) {
  const all: DocumentRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from("inventory_documents")
      .select(columns)
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
    all.push(...((data || []) as unknown as DocumentRow[]))
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
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [canApprove, setCanApprove] = useState(false)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [categories, setCategories] = useState<InventoryCategoryOption[]>([])
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [lines, setLines] = useState<LineRow[]>([])
  const [legacyRows, setLegacyRows] = useState<LegacyMovementRow[]>([])
  const [legacyTarget, setLegacyTarget] = useState<LegacyDocument | null>(null)
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

  const [docKinds, setDocKinds] = useState<string[]>([])
  // Khoảng ngày dùng để TẢI: chỉ cập nhật khi ô ngày hợp lệ và người dùng ngừng gõ 350ms (ô date gõ tay sinh nhiều giá trị dở).
  const [loadRange, setLoadRange] = useState(() => ({ from: getFirstDayOfMonthISO(getFactoryTodayISO()), to: getFactoryTodayISO() }))
  // Mỗi lượt tải có số thứ tự — kết quả của lượt cũ về muộn bị bỏ (trước đây ghi đè danh sách ⇒ trông như "không lọc ngày").
  const loadSeqRef = useRef(0)

  const [approveTarget, setApproveTarget] = useState<DocumentRow | null>(null)
  const [adjustTarget, setAdjustTarget] = useState<DocumentRow | null>(null)
  const [adjustReason, setAdjustReason] = useState("")
  const [cancelTarget, setCancelTarget] = useState<DocumentRow | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

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

  useEffect(() => {
    const from = fromDate === "" || isCompleteISODate(fromDate) ? fromDate : null
    const to = toDate === "" || isCompleteISODate(toDate) ? toDate : null
    if (from === null || to === null) return
    const timer = window.setTimeout(() => {
      setLoadRange((current) => (current.from === from && current.to === to ? current : { from, to }))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [fromDate, toDate])

  const loadDocuments = useCallback(async () => {
    if (!factoryId) return
    const seq = ++loadSeqRef.current
    setLoading(true)
    setError(null)
    try {
      const [docs, legacy] = await Promise.all([
        fetchDocuments(factoryId, kind, loadRange.from, loadRange.to),
        kind === "transfer"
          ? Promise.resolve([] as LegacyMovementRow[])
          : loadLegacyMovements(supabase, factoryId, { from: loadRange.from || undefined, to: loadRange.to || undefined, movementType: kind }),
      ])
      const docLines = await fetchLines(factoryId, docs.map((doc) => doc.id))
      if (seq !== loadSeqRef.current) return
      setDocuments(docs)
      setLines(docLines)
      setLegacyRows(legacy)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      setError(getErrorMessage(err, "Không tải được danh sách phiếu."))
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [factoryId, kind, loadRange])

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
    const keyword = search.trim().toLowerCase()
    // Lọc ngày cả ở máy (theo ô đang hiển thị) — không phụ thuộc lượt tải nào về sau cùng.
    const from = isCompleteISODate(fromDate) ? fromDate : ""
    const to = isCompleteISODate(toDate) ? toDate : ""
    return documents.filter((doc) => {
      const day = String(doc.document_date || "").slice(0, 10)
      if (from && day < from) return false
      if (to && day > to) return false
      if (docKinds.length > 0 && !docKinds.includes(doc.la_dieu_chinh ? "adjustment" : "usage")) return false
      if (keyword && !doc.document_code.toLowerCase().includes(keyword)) return false
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
  }, [documents, statuses, warehouseIds, approvalStates, itemIds, categoryIds, linesByDocument, itemById, config.supportsApproval, search, fromDate, toDate, docKinds])

  const legacyDocuments = useMemo(() => groupLegacyDocuments(legacyRows, makeLegacyWarehouseResolver(warehouses)), [legacyRows, warehouses])

  // Phiếu cũ: cùng bộ lọc ngày / tìm mã / kho / vật tư; lọc Trạng thái / Phê duyệt ⇒ ẩn (phiếu cũ không có hai thứ đó).
  const filteredLegacy = useMemo(() => {
    if (kind === "transfer") return []
    if (docKinds.length > 0 && !docKinds.includes("legacy")) return []
    if (statuses.length > 0 || approvalStates.length > 0) return []
    const itemSet = new Set(itemIds)
    const categorySet = new Set(categoryIds)
    const keyword = search.trim().toLowerCase()
    const from = isCompleteISODate(fromDate) ? fromDate : ""
    const to = isCompleteISODate(toDate) ? toDate : ""
    return legacyDocuments.filter((doc) => {
      if (from && doc.ngay < from) return false
      if (to && doc.ngay > to) return false
      if (keyword && !doc.maNx.toLowerCase().includes(keyword)) return false
      if (warehouseIds.length > 0 && !doc.warehouseIds.some((id) => warehouseIds.includes(id))) return false
      if (itemSet.size > 0 || categorySet.size > 0) {
        const matched = doc.lines.some((line) =>
          itemSet.size > 0 ? itemSet.has(line.itemId) : categorySet.has(itemById.get(line.itemId)?.category_id || ""),
        )
        if (!matched) return false
      }
      return true
    })
  }, [kind, legacyDocuments, docKinds, statuses, approvalStates, itemIds, categoryIds, search, fromDate, toDate, warehouseIds, itemById])

  // Danh sách hiển thị: phiếu thật + phiếu cũ, mới nhất trước (phiếu thật đã sắp sẵn; trộn theo ngày, giữ thứ tự cùng ngày).
  const displayRows = useMemo(() => {
    const out: Array<{ type: "doc"; doc: DocumentRow } | { type: "legacy"; doc: LegacyDocument }> = []
    let j = 0
    for (const doc of filteredDocuments) {
      const day = String(doc.document_date || "").slice(0, 10)
      while (j < filteredLegacy.length && filteredLegacy[j].ngay > day) out.push({ type: "legacy", doc: filteredLegacy[j++] })
      out.push({ type: "doc", doc })
    }
    while (j < filteredLegacy.length) out.push({ type: "legacy", doc: filteredLegacy[j++] })
    return out
  }, [filteredDocuments, filteredLegacy])

  const counts = useMemo(() => {
    const result = { total: filteredDocuments.length, draft: 0, posted: 0, cancelled: 0, pending: 0 }
    for (const doc of filteredDocuments) {
      result[doc.status] += 1
      if (doc.status === "posted" && !doc.approved_at) result.pending += 1
    }
    return result
  }, [filteredDocuments])

  const expandableIds = useMemo(
    () => [
      ...filteredDocuments.filter((doc) => (linesByDocument.get(doc.id) || []).length > 0).map((doc) => doc.id),
      ...filteredLegacy.map((doc) => doc.key),
    ],
    [filteredDocuments, filteredLegacy, linesByDocument],
  )

  const legacyWarehouseLabel = (doc: LegacyDocument) =>
    doc.warehouseIds.length
      ? doc.warehouseIds.map((id) => warehouseById.get(id)?.code || "?").join(", ")
      : doc.warehouseNames.join(", ") || "—"

  const legacySummary = (doc: LegacyDocument) => {
    const codes = Array.from(new Set(doc.lines.map((line) => line.itemCode)))
    const text = codes.length <= 2 ? codes.join(", ") : `${codes.slice(0, 2).join(", ")} +${codes.length - 2}`
    const units = new Set(doc.lines.map((line) => itemById.get(line.itemId)?.unit || ""))
    const total = doc.lines.reduce((sum, line) => sum + line.quantity, 0)
    return { text, total: units.size === 1 ? `${total.toLocaleString("vi-VN")} ${[...units][0]}`.trim() : `${doc.lines.length} dòng` }
  }

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const activeFilterCount =
    [warehouseIds, categoryIds, itemIds, statuses, approvalStates, docKinds].filter((value) => value.length > 0).length +
    (search.trim() ? 1 : 0)

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
      setToast({ tone: "error", text: getErrorMessage(err, "Không thể phê duyệt phiếu.") })
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
      setToast({ tone: "error", text: getErrorMessage(err, "Không thể hủy phiếu.") })
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
    setDocKinds([])
    setSearch("")
  }

  const handleAdjust = async () => {
    if (!adjustTarget) return
    const flag = !adjustTarget.la_dieu_chinh
    if (flag && !adjustReason.trim()) return
    setBusy(true)
    try {
      const { error: rpcError } = await supabase.rpc("inventory_document_set_adjustment", {
        p_document_id: adjustTarget.id,
        p_flag: flag,
        p_ly_do: flag ? adjustReason.trim() : null,
      })
      if (rpcError) throw rpcError
      setToast({
        tone: "success",
        text: flag
          ? `Đã đánh dấu ${adjustTarget.document_code} là phiếu điều chỉnh tồn — không tính báo cáo sử dụng / định mức.`
          : `Đã bỏ đánh dấu điều chỉnh của ${adjustTarget.document_code}.`,
      })
      setAdjustTarget(null)
      setAdjustReason("")
      void loadDocuments()
    } catch (err) {
      setToast({ tone: "error", text: getErrorMessage(err, "Không đổi được đánh dấu điều chỉnh.") })
    } finally {
      setBusy(false)
    }
  }

  // QR phiếu: trang chi tiết mới `/dashboard/inventory/document/{type}/{id}`, hoặc URL cũ
  // `/dashboard/inventory/{receipts|issues|transfers}?documentId=...|code=...`. Chuỗi khác → ô tìm.
  const handleScanDecoded = (text: string) => {
    const raw = text.trim()
    setScanning(false)
    setScanError(null)
    try {
      const url = new URL(raw, window.location.origin)
      if (url.pathname.startsWith("/dashboard/inventory/document/")) {
        router.push(url.pathname)
        return
      }
      const segment = url.pathname.split("/").filter(Boolean).pop() || ""
      const scannedKind = KIND_BY_ROUTE_SEGMENT[segment] || kind
      const documentId = url.searchParams.get("documentId")
      if (documentId) {
        router.push(inventoryDocumentDetailHref(scannedKind, documentId))
        return
      }
      const code = url.searchParams.get("code")
      if (code) {
        setSearch(code)
        return
      }
    } catch {
      // không phải URL → coi là mã phiếu
    }
    setSearch(raw)
  }

  const canCreate = hasPermission(user, "inventory.create") || hasPermission(user, "inventory.edit") || user?.role === "admin"
  const canCancel = hasPermission(user, "inventory.cancel")
  // Đánh dấu điều chỉnh: chỉ phiếu xuất (ảnh hưởng báo cáo sử dụng / định mức); RPC kiểm lại quyền.
  const canMarkAdjustment =
    kind === "export" && adjustmentColumnsAvailable && (user?.role === "admin" || hasPermission(user, "inventory.settings"))

  return (
    <InventoryPageShell
      title={config.title}
      description={config.description}
      action={
        canCreate ? (
          <HeaderButton
            tone="brand"
            href={`${config.route}?mode=new`}
            icon={<config.addIcon size={15} />}
            label={config.addLabel}
          />
        ) : null
      }
    >
      <div className={`${moduleThemeClass("amber")} space-y-4`}>
      {scanning && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[90] overflow-y-auto bg-black">
              <QrScanner
                onDecoded={handleScanDecoded}
                onCancel={() => {
                  setScanning(false)
                  setScanError(null)
                }}
                hintText="Đưa camera vào mã QR trên phiếu kho đã in"
                cancelText="Hủy quét"
                cameraErrorText="Không mở được camera. Hãy cấp quyền camera hoặc tải ảnh chứa QR."
                uploadButtonText="Tải ảnh chứa QR"
                uploadScanningText="Đang xử lý ảnh..."
                uploadNotFoundText="Không tìm thấy mã QR trong ảnh."
                orDividerText="hoặc"
                scanError={scanError}
              />
            </div>,
            document.body,
          )
        : null}
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
          <div className="mb-3 flex h-10 w-full items-center gap-2 rounded-xl border border-slate-300 bg-white pl-3 pr-1 focus-within:border-mod-600 sm:w-80">
            <Search size={15} className="shrink-0 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã phiếu..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            {search ? (
              <button
                type="button"
                aria-label="Xoá tìm kiếm"
                onClick={() => setSearch("")}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={13} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setScanError(null)
                setScanning(true)
              }}
              title="Quét QR phiếu đã in"
              aria-label="Quét QR phiếu đã in"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-mod-50 px-2.5 text-xs font-bold text-mod-800 transition-colors hover:bg-mod-200"
            >
              <QrCode size={15} />
              <span className="hidden sm:inline">Quét QR</span>
            </button>
          </div>
          <div className={`grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${kind === "transfer" ? "xl:grid-cols-7" : "xl:grid-cols-8"}`}>
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
            ) : null}
            {kind !== "transfer" ? (
              <MultiSelectField
                label="Loại phiếu"
                options={docKindOptions(kind)}
                selectedValues={docKinds}
                onChange={setDocKinds}
                placeholder="Tất cả"
              />
            ) : null}
            {config.supportsApproval ? null : (
              <div className="flex items-end">
                <HeaderButton icon={<RotateCcw size={15} />} label="Xóa lọc" onClick={resetFilters} />
              </div>
            )}
          </div>
        </FilterBar>
        {config.supportsApproval ? (
          <div className="mt-3 flex justify-end">
            <HeaderButton icon={<RotateCcw size={15} />} label="Xóa lọc" onClick={resetFilters} />
          </div>
        ) : null}
      </div>

      <StatGrid cols={4}>
        <StatCard icon={FileText} label="Tổng phiếu" value={counts.total} loading={loading} />
        <StatCard icon={FilePen} label="Nháp" value={counts.draft} loading={loading} />
        <StatCard icon={BookCheck} label="Đã ghi sổ" value={counts.posted} valueTone="good" loading={loading} />
        {config.supportsApproval ? (
          <StatCard
            icon={Clock}
            label="Chờ phê duyệt"
            value={counts.pending}
            valueTone={counts.pending > 0 ? "warn" : "default"}
            loading={loading}
            onClick={() => setApprovalStates(["pending"])}
            active={approvalStates.length === 1 && approvalStates[0] === "pending"}
          />
        ) : (
          <StatCard icon={Ban} label="Đã hủy" value={counts.cancelled} valueTone={counts.cancelled > 0 ? "danger" : "default"} loading={loading} />
        )}
      </StatGrid>

      <ResponsiveTableWrapper>
        {error ? (
          <ListState kind="error" message={error} onRetry={() => void loadDocuments()} />
        ) : loading ? (
          <ListState kind="loading" message="Đang tải danh sách phiếu..." />
        ) : displayRows.length === 0 ? (
          <ListState kind="empty" message="Không có phiếu phù hợp bộ lọc." />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <span className="text-xs text-slate-500">
                {filteredLegacy.length > 0
                  ? `Gồm ${filteredLegacy.length.toLocaleString("vi-VN")} phiếu cũ (AppSheet, đến ${formatDate(LEGACY_LAST_DATE)}) — chỉ xem, không tính tồn / thẻ kho; không đếm trong thẻ thống kê.`
                  : ""}
              </span>
              <ExpandAllToggle
                allExpanded={expandableIds.length > 0 && expandableIds.every((id) => expanded.has(id))}
                onExpandAll={() => setExpanded(new Set(expandableIds))}
                onCollapseAll={() => setExpanded(new Set())}
                disabled={expandableIds.length === 0}
              />
            </div>
            <table className="enterprise-table dense min-w-[900px]">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Ngày</th>
                  <th>Kho</th>
                  <th>{config.partyLabel}</th>
                  <th>Vật tư</th>
                  <th className="text-right">Số lượng</th>
                  <th>Trạng thái</th>
                  <ExpandHeaderCell>Thao tác</ExpandHeaderCell>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  if (row.type === "legacy") {
                    const ldoc = row.doc
                    const lsum = legacySummary(ldoc)
                    return (
                      <ExpandableRow
                        key={ldoc.key}
                        expanded={expanded.has(ldoc.key)}
                        onToggle={() => toggleExpanded(ldoc.key)}
                        canExpand
                        colSpan={8}
                        label="Xem dòng vật tư"
                        detail={<LegacyLinesTable doc={ldoc} itemById={itemById} warehouseById={warehouseById} />}
                        endCell={
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <IconActionGroup>
                              <RowAction kind="view" label="Xem chi tiết phiếu cũ" onClick={() => setLegacyTarget(ldoc)} />
                            </IconActionGroup>
                          </div>
                        }
                      >
                        <td className="whitespace-nowrap font-code font-semibold text-slate-600">{ldoc.maNx}</td>
                        <td className="whitespace-nowrap text-slate-600">{formatDate(ldoc.ngay)}</td>
                        <td className="whitespace-nowrap font-semibold text-slate-700">{legacyWarehouseLabel(ldoc)}</td>
                        <td className="max-w-[180px] truncate text-slate-600" title={ldoc.nguoi}>
                          {ldoc.nguoi || "—"}
                        </td>
                        <td className="max-w-[220px] truncate text-slate-600" title={lsum.text}>
                          {lsum.text}
                        </td>
                        <td className="whitespace-nowrap text-right font-semibold text-slate-700">{lsum.total}</td>
                        <td>
                          <span title="Dữ liệu cũ nhập từ file NXT AppSheet — chỉ xem">
                            <StatusBadge tone="draft" label="Phiếu cũ" size="xs" />
                          </span>
                        </td>
                      </ExpandableRow>
                    )
                  }
                  const doc = row.doc
                  const summary = itemSummary(doc)
                  const docLines = linesByDocument.get(doc.id) || []
                  const openHref = inventoryDocumentDetailHref(kind, doc.id)
                  const showApprove = config.supportsApproval && canApprove && doc.status === "posted" && !doc.approved_at
                  const statusKey =
                    config.supportsApproval && doc.status === "posted" && !doc.approved_at ? "cho_duyet" : doc.status
                  return (
                    <ExpandableRow
                      key={doc.id}
                      expanded={expanded.has(doc.id)}
                      onToggle={() => toggleExpanded(doc.id)}
                      canExpand={docLines.length > 0}
                      colSpan={8}
                      label="Xem dòng vật tư"
                      detail={
                        <table className="enterprise-table dense">
                          <thead>
                            <tr>
                              <th className="w-10">#</th>
                              <th>Mã vật tư</th>
                              <th>Tên vật tư</th>
                              <th className="text-right">Số lượng</th>
                              <th>ĐVT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {docLines.map((line, index) => {
                              const item = itemById.get(line.item_id)
                              return (
                                <tr key={`${line.item_id}-${index}`}>
                                  <td className="text-slate-500">{index + 1}</td>
                                  <td className="font-code font-semibold text-slate-800">{line.item_code || item?.code || "?"}</td>
                                  <td className="text-slate-600">{item?.name || "—"}</td>
                                  <td className="text-right font-semibold text-slate-700">
                                    {Number(line.quantity || 0).toLocaleString("vi-VN")}
                                  </td>
                                  <td className="text-slate-600">{line.unit || "—"}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      }
                      endCell={
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {showApprove ? (
                            <RowAction kind="approve" label="Duyệt" variant="text" onClick={() => setApproveTarget(doc)} />
                          ) : null}
                          <IconActionGroup>
                            <RowAction kind="view" label="Xem chi tiết phiếu" href={openHref} />
                            <RowAction
                              kind="print"
                              label="In phiếu"
                              href={`/dashboard/inventory/print?type=${kind}&documentId=${encodeURIComponent(doc.id)}`}
                            />
                            {doc.status === "posted" && canMarkAdjustment ? (
                              <IconAction
                                icon={Scale}
                                tone="amber"
                                label={doc.la_dieu_chinh ? "Bỏ đánh dấu phiếu điều chỉnh tồn" : "Đánh dấu phiếu điều chỉnh tồn (không tính báo cáo / định mức)"}
                                onClick={() => {
                                  setAdjustReason("")
                                  setAdjustTarget(doc)
                                }}
                              />
                            ) : null}
                            {doc.status === "posted" && canCancel ? (
                              <RowAction kind="cancel" label="Hủy phiếu" onClick={() => setCancelTarget(doc)} />
                            ) : null}
                          </IconActionGroup>
                        </div>
                      }
                    >
                      <td className="whitespace-nowrap font-bold text-slate-800">
                        <a href={openHref} onClick={(e) => e.stopPropagation()} className="hover:text-brand-700 hover:underline">
                          {doc.document_code}
                        </a>
                      </td>
                      <td className="whitespace-nowrap text-slate-600">{formatDate(doc.document_date)}</td>
                      <td className="whitespace-nowrap font-semibold text-slate-700">{warehouseLabel(doc)}</td>
                      <td className="max-w-[180px] truncate text-slate-600" title={partyLabel(doc)}>
                        {partyLabel(doc)}
                      </td>
                      <td className="max-w-[220px] truncate text-slate-600" title={summary.text}>
                        {summary.text}
                      </td>
                      <td className="whitespace-nowrap text-right font-semibold text-slate-700">{summary.total}</td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge domain="inventory" status={statusKey} />
                          {config.supportsApproval && doc.approved_at ? (
                            <span title={doc.approved_by_name ? `Phê duyệt bởi ${doc.approved_by_name}` : undefined}>
                              <StatusBadge tone="info" label="Đã phê duyệt" size="xs" />
                            </span>
                          ) : null}
                          {doc.la_dieu_chinh ? (
                            <span title={doc.ly_do_dieu_chinh || "Không tính báo cáo sử dụng / định mức"}>
                              <StatusBadge tone="warn" label={ADJUSTMENT_LABEL} size="xs" />
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </ExpandableRow>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </ResponsiveTableWrapper>

      {approveTarget ? (
        <ModalShell
          title="Phê duyệt phiếu"
          onClose={() => (busy ? undefined : setApproveTarget(null))}
          maxWidth="md"
          footer={
            <>
              <HeaderButton icon={<RotateCcw size={15} />} label="Đóng" onClick={() => setApproveTarget(null)} disabled={busy} />
              <HeaderButton tone="brand" icon={<Check size={15} />} label={busy ? "Đang duyệt..." : "Duyệt"} onClick={() => void handleApprove()} disabled={busy} />
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xác nhận phê duyệt phiếu <strong>{approveTarget.document_code}</strong> ngày {formatDate(approveTarget.document_date)}?
          </p>
        </ModalShell>
      ) : null}

      {adjustTarget ? (
        <ModalShell
          title={adjustTarget.la_dieu_chinh ? "Bỏ đánh dấu điều chỉnh tồn" : "Đánh dấu phiếu điều chỉnh tồn"}
          onClose={() => (busy ? undefined : setAdjustTarget(null))}
          maxWidth="md"
          footer={
            <>
              <HeaderButton icon={<RotateCcw size={15} />} label="Đóng" onClick={() => setAdjustTarget(null)} disabled={busy} />
              <HeaderButton
                tone="brand"
                icon={<Scale size={15} />}
                label={busy ? "Đang lưu..." : adjustTarget.la_dieu_chinh ? "Bỏ đánh dấu" : "Đánh dấu điều chỉnh"}
                onClick={() => void handleAdjust()}
                disabled={busy || (!adjustTarget.la_dieu_chinh && !adjustReason.trim())}
              />
            </>
          }
        >
          {adjustTarget.la_dieu_chinh ? (
            <p className="text-sm text-slate-600">
              Phiếu <strong>{adjustTarget.document_code}</strong> sẽ được tính lại như xuất sử dụng bình thường trong báo cáo sử
              dụng theo ngày và đối soát định mức.
              {adjustTarget.ly_do_dieu_chinh ? <span className="mt-2 block text-xs">Lý do cũ: {adjustTarget.ly_do_dieu_chinh}</span> : null}
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">
                Phiếu <strong>{adjustTarget.document_code}</strong> ngày {formatDate(adjustTarget.document_date)} là bút toán điều
                chỉnh tồn, không phải sử dụng thật. Tồn kho và thẻ kho <strong>không đổi</strong>; chỉ báo cáo sử dụng theo ngày
                (55-BC / 46-BC) và đối soát định mức bỏ phiếu này. Bắt buộc nhập lý do.
              </p>
              <textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                rows={3}
                placeholder="Lý do (vd: chốt tồn khi kiểm kê)"
                className={INPUT_CLASS}
              />
            </>
          )}
        </ModalShell>
      ) : null}

      {legacyTarget ? (
        <ModalShell
          title={`Phiếu cũ ${legacyTarget.maNx}`}
          onClose={() => setLegacyTarget(null)}
          maxWidth="lg"
          footer={<HeaderButton icon={<X size={15} />} label="Đóng" onClick={() => setLegacyTarget(null)} />}
        >
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <History size={15} className="mt-0.5 shrink-0 text-slate-500" />
              <span>
                Dữ liệu cũ nhập từ file NXT AppSheet (01/01–{formatDate(LEGACY_LAST_DATE)}) — chỉ xem. Không tính tồn / thẻ kho; được
                dùng cho báo cáo sử dụng theo ngày và đối soát định mức ở những ngày chưa có phiếu trong app.
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              <dt className="text-xs text-slate-500">Loại</dt>
              <dd className="font-semibold text-slate-800">{legacyTarget.movementType === "export" ? "Xuất kho" : "Nhập kho"}</dd>
              <dt className="text-xs text-slate-500">Ngày {legacyTarget.movementType === "export" ? "xuất" : "nhập"}</dt>
              <dd className="font-semibold text-slate-800">{formatDate(legacyTarget.ngay)}</dd>
              <dt className="text-xs text-slate-500">Ngày lập (AppSheet)</dt>
              <dd className="font-semibold text-slate-800">{formatDate(legacyTarget.ngayLap)}</dd>
              <dt className="text-xs text-slate-500">Người nhập / xuất</dt>
              <dd className="font-semibold text-slate-800">{legacyTarget.nguoi || "—"}</dd>
            </dl>
            <LegacyLinesTable doc={legacyTarget} itemById={itemById} warehouseById={warehouseById} />
          </div>
        </ModalShell>
      ) : null}

      {cancelTarget ? (
        <ModalShell
          title="Hủy phiếu"
          onClose={() => (busy ? undefined : setCancelTarget(null))}
          maxWidth="md"
          footer={
            <>
              <HeaderButton icon={<RotateCcw size={15} />} label="Đóng" onClick={() => setCancelTarget(null)} disabled={busy} />
              <HeaderButton
                tone="danger"
                icon={<Ban size={15} />}
                label={busy ? "Đang hủy..." : "Hủy phiếu"}
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
      </div>
    </InventoryPageShell>
  )
}

/** Dòng vật tư của 1 phiếu cũ (dòng xổ + hộp chi tiết). Dòng số lượng 0 = dòng trống AppSheet ⇒ làm mờ. */
function LegacyLinesTable({
  doc,
  itemById,
  warehouseById,
}: {
  doc: LegacyDocument
  itemById: Map<string, InventoryItemOption>
  warehouseById: Map<string, InventoryWarehouseOption>
}) {
  return (
    <table className="enterprise-table dense">
      <thead>
        <tr>
          <th className="w-10">#</th>
          <th>Mã vật tư</th>
          <th>Tên vật tư</th>
          <th>Kho</th>
          <th className="text-right">Số lượng</th>
          <th>ĐVT</th>
          <th>Ghi chú</th>
        </tr>
      </thead>
      <tbody>
        {doc.lines.map((line, index) => {
          const item = itemById.get(line.itemId)
          const wh = line.warehouseId ? warehouseById.get(line.warehouseId) : null
          return (
            <tr key={line.id} className={line.quantity === 0 ? "text-slate-400" : undefined}>
              <td className="text-slate-500">{index + 1}</td>
              <td className="font-code font-semibold text-slate-800">{line.itemCode}</td>
              <td className="text-slate-600">{item?.name || "—"}</td>
              <td className="text-slate-600" title={line.warehouseName}>
                {wh ? wh.code : line.warehouseName || "—"}
              </td>
              <td className="text-right font-semibold text-slate-700">{line.quantity.toLocaleString("vi-VN")}</td>
              <td className="text-slate-600">{item?.unit || "—"}</td>
              <td className="max-w-[260px] text-xs text-slate-500">{line.note}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
