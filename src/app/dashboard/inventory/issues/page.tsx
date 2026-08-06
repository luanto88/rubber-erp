"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  CopyPlus,
  Plus,
  Printer,
  Save,
  Trash2,
  XCircle,
} from "lucide-react"
import { getActiveFactoryId, getFreshAuthSession, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { InventoryPageShell } from "../_components/inventory-shell"
import { InventoryMultiImageUpload } from "../_components/inventory-image-upload"
import { fetchInventoryDocumentByReference } from "../_components/inventory-document-loader"
import { InventoryQrCard } from "../_components/inventory-qr-card"
import { buildEffectiveStockBalances, getStockContextLabel, resolveStockThreshold } from "../_components/inventory-stock"
import { CompactItemSelectorCard, MultiSelectField } from "../_components/inventory-ui"
import { resolveCanApproveInventory } from "../_components/inventory-approval"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { KpiLinkPrompt } from "@/app/dashboard/_components/kpi-link-prompt"
import {
  sendInventoryLowStockAlert,
  sendInventoryNxtChangeNotify,
  type NxtDocumentNotifyLine,
} from "@/lib/inventory-notify"
import {
  getLineTypeLabel,
  loadInventoryAdminData,
  type InventoryOilPoolBalanceRow,
  type InventoryCategoryOption,
  type InventoryItemOption,
  type InventoryWarehouseOption,
  type InventoryWarehouseRule,
} from "../_components/inventory-data"

type IssueLineDraft = {
  id: string
  itemId: string
  // Kho xuất riêng của dòng này — bắt buộc khi vật tư tồn tại ở ≥2 kho đang chọn (đa kho), tự
  // resolve ngay khi chỉ có đúng 1 kho khớp.
  warehouseId: string
  quantity: string
  lotNo: string
  expiryDate: string
  note: string
  imageUrls: string[]
}

type IssueDraftState = {
  documentId: string | null
  documentCode: string
  warehouseIds: string[]
  recipientName: string
  documentDate: string
  note: string
  selectedItemIds: string[]
  lines: IssueLineDraft[]
}

type PersistableLine = {
  item: InventoryItemOption
  warehouseId: string
  quantity: number
  lotNo: string | null
  expiryDate: string | null
  note: string | null
  imageUrls: string[]
}

type BalanceRow = {
  warehouse_id: string
  item_id: string
  on_hand: number
}

type LotBalanceRow = {
  warehouse_id: string
  item_id: string
  lot_no: string
  expiry_date: string | null
  on_hand: number
}

type LotOption = {
  lotNo: string
  expiryDate: string | null
  onHand: number
}

type LineDetail = {
  line: IssueLineDraft
  item: InventoryItemOption | null
  quantity: number
  currentStock: number
  currentLotStock: number | null
  minStock: number
  projectedStock: number
  candidateWarehouseIds: string[]
  missingWarehouse: boolean
  exceedsStock: boolean
  exceedsLotStock: boolean
  belowMin: boolean
  missingLot: boolean
  missingExpiry: boolean
  availableLots: LotOption[]
}

type WarehouseResult = {
  warehouseId: string
  warehouseCode: string
  status: "success" | "error"
  documentId?: string
  documentCode?: string
  message?: string
}

const DRAFT_STORAGE_KEY = "inventory-issue-draft-v5"
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"

const fallbackLotBalances: LotBalanceRow[] = [
  { warehouse_id: "kb", item_id: "af", lot_no: "TA02HE31", expiry_date: "2026-06-30", on_hand: 1000 },
  { warehouse_id: "kb", item_id: "af", lot_no: "TP61HA31", expiry_date: "2026-08-30", on_hand: 500 },
  { warehouse_id: "kb", item_id: "af", lot_no: "TP71HA53", expiry_date: "2026-03-30", on_hand: 0 },
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function makeLine(itemId = "", warehouseId = ""): IssueLineDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemId,
    warehouseId,
    quantity: "",
    lotNo: "",
    expiryDate: "",
    note: "",
    imageUrls: [],
  }
}

function defaultDraft(): IssueDraftState {
  return {
    documentId: null,
    documentCode: "",
    warehouseIds: [],
    recipientName: "",
    documentDate: todayIso(),
    note: "",
    selectedItemIds: [],
    lines: [],
  }
}

function normalizeDraftState(value: unknown): IssueDraftState {
  const base = defaultDraft()
  if (!value || typeof value !== "object") return base

  const raw = value as Partial<IssueDraftState>
  const lines = Array.isArray(raw.lines)
    ? raw.lines
        .map((line) => {
          if (!line || typeof line !== "object") return null
          const entry = line as Partial<IssueLineDraft>
          return {
            id: entry.id || makeLine().id,
            itemId: entry.itemId || "",
            warehouseId: typeof entry.warehouseId === "string" ? entry.warehouseId : "",
            quantity: entry.quantity || "",
            lotNo: entry.lotNo || "",
            expiryDate: entry.expiryDate || "",
            note: entry.note || "",
            imageUrls: Array.isArray(entry.imageUrls)
              ? entry.imageUrls.filter((u): u is string => typeof u === "string")
              : [],
          }
        })
        .filter((line): line is IssueLineDraft => Boolean(line))
    : []

  return {
    documentId: typeof raw.documentId === "string" ? raw.documentId : null,
    documentCode: typeof raw.documentCode === "string" ? raw.documentCode : "",
    warehouseIds: Array.isArray(raw.warehouseIds)
      ? raw.warehouseIds.filter((id): id is string => typeof id === "string")
      : [],
    recipientName: typeof raw.recipientName === "string" ? raw.recipientName : "",
    documentDate: typeof raw.documentDate === "string" && raw.documentDate ? raw.documentDate : base.documentDate,
    note: typeof raw.note === "string" ? raw.note : "",
    selectedItemIds: Array.isArray(raw.selectedItemIds)
      ? raw.selectedItemIds.filter((id): id is string => typeof id === "string")
      : [],
    lines,
  }
}

function formatDocCode(warehouseCode: string, date: string, sequence = 1) {
  if (!warehouseCode || !date) return "X-____-DDMMYY/001"
  const [yyyy, mm, dd] = date.split("-")
  return `X-${warehouseCode}-${dd}${mm}${yyyy.slice(2)}/${String(sequence).padStart(3, "0")}`
}

function buildPersistableLines(lines: IssueLineDraft[], items: InventoryItemOption[]) {
  const normalized: PersistableLine[] = []

  for (const line of lines) {
    const item = items.find((entry) => entry.id === line.itemId)
    if (!item) continue

    if (!line.warehouseId) {
      return { error: `Vui lòng chọn kho xuất cho vật tư ${item.code}.`, lines: [] as PersistableLine[] }
    }

    const quantity = Number(line.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: `Vui lòng nhập số lượng hợp lệ cho vật tư ${item.code}.`, lines: [] as PersistableLine[] }
    }

    const lotNo = line.lotNo.trim() || null
    const expiryDate = line.expiryDate || null

    if (item.manages_lot && !lotNo) {
      return { error: `Vật tư ${item.code} bắt buộc chọn số lô trước khi lưu phiếu xuất.`, lines: [] as PersistableLine[] }
    }

    if (item.manages_expiry && !expiryDate) {
      return {
        error: `Vật tư ${item.code} bắt buộc chọn hạn sử dụng trước khi lưu phiếu xuất.`,
        lines: [] as PersistableLine[],
      }
    }

    normalized.push({
      item,
      warehouseId: line.warehouseId,
      quantity,
      lotNo,
      expiryDate,
      note: line.note.trim() || null,
      imageUrls: line.imageUrls,
    })
  }

  if (normalized.length === 0) {
    return { error: "Phiếu xuất cần ít nhất một dòng vật tư hợp lệ.", lines: [] as PersistableLine[] }
  }

  return { error: null, lines: normalized }
}

function groupLinesByWarehouse(lines: PersistableLine[]) {
  const map = new Map<string, PersistableLine[]>()
  for (const line of lines) {
    const list = map.get(line.warehouseId) || []
    list.push(line)
    map.set(line.warehouseId, list)
  }
  return map
}

function dedupeLotOptions(rows: LotBalanceRow[]) {
  const map = new Map<string, LotOption>()
  for (const row of rows) {
    const key = `${row.lot_no}::${row.expiry_date || ""}`
    if (!map.has(key)) {
      map.set(key, {
        lotNo: row.lot_no,
        expiryDate: row.expiry_date,
        onHand: Number(row.on_hand) || 0,
      })
    }
  }
  return [...map.values()]
}

function SummaryBox({
  label,
  value,
  tone = "text-slate-800",
}: {
  label: string
  value: string
  tone?: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-extrabold ${tone}`}>{value}</div>
    </div>
  )
}

function AlertPill({ children, tone = "amber" }: { children: React.ReactNode; tone?: "amber" | "red" | "blue" }) {
  const styles =
    tone === "red"
      ? "bg-red-100 text-red-700"
      : tone === "blue"
        ? "bg-blue-100 text-blue-700"
        : "bg-amber-100 text-amber-700"

  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${styles}`}>{children}</span>
}

export default function InventoryIssuesPage() {
  const searchParams = useSearchParams()
  const requestedDocumentId = searchParams.get("documentId")
  const requestedCode = searchParams.get("code")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveErrorTitle, setSaveErrorTitle] = useState("Có lỗi xảy ra")
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  // "Gắn bản ghi tại chỗ" — gợi ý gắn phiếu xuất vừa ghi sổ vào công việc KPI đang mở.
  const [kpiPrompt, setKpiPrompt] = useState<{ recordId: string; recordLabel: string } | null>(null)
  const [documentStatus, setDocumentStatus] = useState<"draft" | "posted" | "cancelled" | null>(null)
  const [postedInfo, setPostedInfo] = useState<{ at: string; byName: string } | null>(null)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [cancelModal, setCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelling, setCancelling] = useState(false)
  const [canApprove, setCanApprove] = useState(false)
  const [approvedInfo, setApprovedInfo] = useState<{ at: string; byName: string } | null>(null)
  const [approveModal, setApproveModal] = useState(false)
  const [approving, setApproving] = useState(false)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [warehouseRules, setWarehouseRules] = useState<InventoryWarehouseRule[]>([])
  const [balances, setBalances] = useState<BalanceRow[]>([])
  const [lotBalances, setLotBalances] = useState<LotBalanceRow[]>([])
  const [categories, setCategories] = useState<InventoryCategoryOption[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [draft, setDraft] = useState<IssueDraftState>(defaultDraft())
  const [multiResults, setMultiResults] = useState<WarehouseResult[] | null>(null)
  const [multiBatchId, setMultiBatchId] = useState<string | null>(null)

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventoryAdminData()
        const activeSession = await hydrateActiveSession().catch(() => ({ user: null }))
        if (activeSession.user) setCurrentUser(activeSession.user)
        const resolvedFactoryId = inventoryData.factoryId ?? (await getActiveFactoryId())

        setFactoryId(resolvedFactoryId)
        setWarning(inventoryData.warning)
        setWarehouses(inventoryData.warehouses)
        setItems(inventoryData.items)
        setWarehouseRules(inventoryData.warehouseRules)
        setCategories(inventoryData.categories)

        if (resolvedFactoryId && activeSession.user) {
          void resolveCanApproveInventory(resolvedFactoryId, activeSession.user).then(setCanApprove)
        }

        if (resolvedFactoryId) {
          const [balanceResult, lotBalanceResult, oilPoolResult] = await Promise.all([
            supabase
              .from("inventory_stock_balances")
              .select("warehouse_id, item_id, on_hand")
              .eq("factory_id", resolvedFactoryId),
            supabase
              .from("inventory_lot_balances")
              .select("warehouse_id, item_id, lot_no, expiry_date, on_hand")
              .eq("factory_id", resolvedFactoryId),
            supabase
              .from("inventory_oil_stock_pools")
              .select("warehouse_id, on_hand")
              .eq("factory_id", resolvedFactoryId),
          ])

          if (!balanceResult.error && !oilPoolResult.error) {
            const realBalances = (balanceResult.data || []) as BalanceRow[]
            const oilPoolBalances = (oilPoolResult.data || []) as InventoryOilPoolBalanceRow[]
            setBalances(
              buildEffectiveStockBalances({
                items: inventoryData.items,
                stockBalances: realBalances,
                oilPoolBalances,
              }) as BalanceRow[],
            )
          }

          if (!lotBalanceResult.error && (lotBalanceResult.data || []).length > 0) {
            setLotBalances((lotBalanceResult.data || []) as LotBalanceRow[])
          } else if (inventoryData.warning) {
            setLotBalances(fallbackLotBalances)
          }
        } else {
          setLotBalances(fallbackLotBalances)
        }

        const loadDocumentFromQuery = async () => {
          if (!resolvedFactoryId || (!requestedDocumentId && !requestedCode)) {
            return false
          }

          const loaded = await fetchInventoryDocumentByReference(resolvedFactoryId, "export", {
            documentId: requestedDocumentId,
            code: requestedCode,
          })

          if (!loaded) {
            return false
          }

          const nextWarehouseId =
            loaded.document.source_warehouse_id &&
            inventoryData.warehouses.some((warehouse) => warehouse.id === loaded.document.source_warehouse_id)
              ? loaded.document.source_warehouse_id
              : inventoryData.warehouses[0]?.id || ""

          const selectedItemIds = Array.from(new Set(loaded.lines.map((line) => line.item_id)))
          setDraft({
            documentId: loaded.document.id,
            documentCode: loaded.document.document_code,
            warehouseIds: nextWarehouseId ? [nextWarehouseId] : [],
            recipientName: loaded.document.recipient_name || "",
            documentDate: loaded.document.document_date,
            note: loaded.document.notes || "",
            selectedItemIds,
            lines: loaded.lines.map((line) => ({
              id: line.id,
              itemId: line.item_id,
              warehouseId: nextWarehouseId,
              quantity: String(Number(line.quantity || 0)),
              lotNo: line.lot_no || "",
              expiryDate: line.expiry_date || "",
              note: line.line_notes || "",
              imageUrls: line.image_urls || [],
            })),
          })
          setDocumentStatus(
            loaded.document.status === "posted" ? "posted"
            : loaded.document.status === "cancelled" ? "cancelled"
            : "draft"
          )
          if (loaded.document.approved_by_name && loaded.document.approved_at) {
            setApprovedInfo({ at: loaded.document.approved_at, byName: loaded.document.approved_by_name })
          } else {
            setApprovedInfo(null)
          }
          return true
        }

        if (await loadDocumentFromQuery()) {
          return
        }

        const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY)

        if (stored) {
          try {
            const parsed = normalizeDraftState(JSON.parse(stored))
            if (parsed.documentId) {
              // Phiếu này đã có mã (đã Lưu nháp/Ghi sổ trước đó) — không tự nạp lại qua đường vào
              // trang trần (không có ?documentId=), tránh hiện "phiếu ma" với trạng thái sai (bug
              // đã xác nhận: mở trang lại luôn hiện phiếu cũ nhưng ép cứng về "Nháp" dù thực tế đã
              // ghi sổ/hủy). Muốn tiếp tục phiếu cũ phải mở đúng qua ?documentId=.
              setDraft(defaultDraft())
            } else {
              const validWarehouseIds = parsed.warehouseIds.filter((id) =>
                inventoryData.warehouses.some((warehouse) => warehouse.id === id),
              )
              setDraft({
                ...parsed,
                warehouseIds: validWarehouseIds,
              })
              setDocumentStatus(null)
            }
          } catch {
            setDraft(defaultDraft())
          }
        } else {
          setDraft(defaultDraft())
        }
      } finally {
        setLoading(false)
      }
    }

    void bootstrap()
  }, [requestedCode, requestedDocumentId])

  useEffect(() => {
    if (loading) return
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  }, [draft, loading])

  const isMultiWarehouseMode = draft.warehouseIds.length >= 2
  const isEditingExistingDoc = !!draft.documentId

  const selectedWarehouse = useMemo(
    () => (draft.warehouseIds.length === 1 ? warehouses.find((warehouse) => warehouse.id === draft.warehouseIds[0]) || null : null),
    [draft.warehouseIds, warehouses],
  )

  const documentCode = useMemo(
    () => draft.documentCode || formatDocCode(selectedWarehouse?.code || "", draft.documentDate),
    [draft.documentCode, draft.documentDate, selectedWarehouse?.code],
  )
  const documentQrPath = draft.documentId ? `/dashboard/inventory/print?type=export&documentId=${encodeURIComponent(draft.documentId)}` : null

  const balanceMap = useMemo(
    () => new Map(balances.map((row) => [`${row.warehouse_id}:${row.item_id}`, Number(row.on_hand) || 0])),
    [balances],
  )

  const availableItems = useMemo(() => {
    let scoped =
      draft.warehouseIds.length > 0
        ? items.filter((item) => draft.warehouseIds.some((wid) => item.default_warehouse_ids.includes(wid)))
        : items
    if (scoped.length === 0) scoped = items
    if (selectedCategoryIds.length > 0) {
      scoped = scoped.filter((item) => selectedCategoryIds.includes(item.category_id || ""))
    }
    return scoped
  }, [draft.warehouseIds, items, selectedCategoryIds])

  const visibleItemCards = useMemo(() => {
    if (draft.selectedItemIds.length === 0) return availableItems
    return availableItems.filter((item) => draft.selectedItemIds.includes(item.id))
  }, [availableItems, draft.selectedItemIds])

  const warehouseScopedCategories = useMemo(() => {
    const base = (() => {
      const scoped =
        draft.warehouseIds.length > 0
          ? items.filter((item) => draft.warehouseIds.some((wid) => item.default_warehouse_ids.includes(wid)))
          : items
      return scoped.length > 0 ? scoped : items
    })()
    const presentIds = new Set(base.map((item) => item.category_id).filter(Boolean))
    return categories.filter((c) => presentIds.has(c.id))
  }, [categories, draft.warehouseIds, items])

  useEffect(() => {
    if (loading) return

    const allowedIds = new Set(availableItems.map((item) => item.id))
    const nextSelected = draft.selectedItemIds.filter((itemId) => allowedIds.has(itemId))
    const selectedChanged = nextSelected.join("|") !== draft.selectedItemIds.join("|")

    const keptLines = draft.lines.filter((line) => nextSelected.includes(line.itemId))
    const nextLines = [...keptLines]

    nextSelected.forEach((itemId) => {
      if (!nextLines.some((line) => line.itemId === itemId)) {
        const item = items.find((entry) => entry.id === itemId)
        const candidates = item ? draft.warehouseIds.filter((wid) => item.default_warehouse_ids.includes(wid)) : []
        nextLines.push(makeLine(itemId, candidates.length === 1 ? candidates[0] : ""))
      }
    })

    const linesChanged =
      nextLines.length !== draft.lines.length ||
      nextLines.some((line, index) => draft.lines[index]?.id !== line.id)

    if (!selectedChanged && !linesChanged) return

    setDraft((prev) => ({
      ...prev,
      selectedItemIds: nextSelected,
      lines: nextLines,
    }))
  }, [availableItems, draft.lines, draft.selectedItemIds, draft.warehouseIds, items, loading])

  const aggregatedQtyByKey = useMemo(() => {
    const map = new Map<string, number>()
    for (const line of draft.lines) {
      if (!line.warehouseId || !line.itemId) continue
      const qty = Number(line.quantity) || 0
      const key = `${line.warehouseId}:${line.itemId}`
      map.set(key, (map.get(key) || 0) + qty)
    }
    return map
  }, [draft.lines])

  const lineDetails = useMemo<LineDetail[]>(() => {
    return draft.lines.map((line) => {
      const item = items.find((entry) => entry.id === line.itemId) || null
      const quantity = Number(line.quantity) || 0
      const candidateWarehouseIds = item
        ? draft.warehouseIds.filter((wid) => item.default_warehouse_ids.includes(wid))
        : []
      const missingWarehouse = candidateWarehouseIds.length >= 2 && !line.warehouseId

      const currentStock =
        item && line.warehouseId
          ? (balanceMap.get(`${line.warehouseId}:${item.id}`) ?? 0)
          : 0

      const availableLots = item && line.warehouseId
        ? dedupeLotOptions(
            lotBalances.filter(
              (entry) =>
                entry.warehouse_id === line.warehouseId &&
                entry.item_id === item.id &&
                Number(entry.on_hand) > 0,
            ),
          )
        : []

      const selectedLot = availableLots.find(
        (entry) => entry.lotNo === line.lotNo && entry.expiryDate === (line.expiryDate || null),
      )
      const selectedByLotOnly = availableLots.find((entry) => entry.lotNo === line.lotNo)
      const selectedByExpiryOnly = availableLots.find((entry) => (entry.expiryDate || "") === line.expiryDate)
      const currentLotStock = selectedLot?.onHand ?? selectedByLotOnly?.onHand ?? selectedByExpiryOnly?.onHand ?? null

      const rule = warehouseRules.find(
        (entry) => entry.item_id === item?.id && entry.warehouse_id === line.warehouseId,
      )
      const minStock = rule?.min_stock ?? item?.min_stock ?? 0
      const projectedStock = currentStock - quantity

      const aggregatedQty =
        item && line.warehouseId ? aggregatedQtyByKey.get(`${line.warehouseId}:${item.id}`) ?? quantity : quantity

      return {
        line,
        item,
        quantity,
        currentStock,
        currentLotStock,
        minStock,
        projectedStock,
        candidateWarehouseIds,
        missingWarehouse,
        exceedsStock: !missingWarehouse && !!line.warehouseId && aggregatedQty > currentStock,
        exceedsLotStock: !missingWarehouse && currentLotStock !== null && quantity > currentLotStock,
        belowMin: !missingWarehouse && minStock > 0 && projectedStock < minStock,
        missingLot: !!item?.manages_lot && !line.lotNo.trim(),
        missingExpiry: !!item?.manages_expiry && !line.expiryDate,
        availableLots,
      }
    })
  }, [aggregatedQtyByKey, balanceMap, draft.lines, draft.warehouseIds, items, lotBalances, warehouseRules])

  const summary = useMemo(() => {
    const totalQty = lineDetails.reduce((sum, detail) => sum + detail.quantity, 0)
    const warningCount = lineDetails.filter(
      (detail) =>
        detail.exceedsStock ||
        detail.exceedsLotStock ||
        detail.belowMin ||
        detail.missingLot ||
        detail.missingExpiry ||
        detail.missingWarehouse,
    ).length
    return { totalQty, warningCount }
  }, [lineDetails])

  const addAnotherLotLine = (itemId: string) => {
    const item = items.find((entry) => entry.id === itemId)
    const candidates = item ? draft.warehouseIds.filter((wid) => item.default_warehouse_ids.includes(wid)) : []
    setDraft((prev) => ({
      ...prev,
      lines: [...prev.lines, makeLine(itemId, candidates.length === 1 ? candidates[0] : "")],
    }))
  }

  const updateLine = (lineId: string, patch: Partial<IssueLineDraft>) => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    }))
  }

  const toggleSelectedItem = (itemId: string) => {
    setDraft((prev) => {
      const exists = prev.selectedItemIds.includes(itemId)
      return {
        ...prev,
        selectedItemIds: exists
          ? prev.selectedItemIds.filter((entry) => entry !== itemId)
          : [...prev.selectedItemIds, itemId],
      }
    })
  }

  const removeLine = (lineId: string) => {
    setDraft((prev) => {
      const target = prev.lines.find((line) => line.id === lineId)
      const nextLines = prev.lines.filter((line) => line.id !== lineId)
      if (!target) return prev

      const stillHasItem = nextLines.some((line) => line.itemId === target.itemId)
      return {
        ...prev,
        lines: nextLines,
        selectedItemIds: stillHasItem
          ? prev.selectedItemIds
          : prev.selectedItemIds.filter((itemId) => itemId !== target.itemId),
      }
    })
  }

  const handleWarehouseIdsChange = (values: string[]) => {
    setDraft((prev) => ({
      ...prev,
      warehouseIds: values,
      documentId: null,
      documentCode: "",
      selectedItemIds: [],
      lines: [],
    }))
    setSelectedCategoryIds([])
    setDocumentStatus(null)
    setApprovedInfo(null)
    setMultiResults(null)
    setMultiBatchId(null)
  }

  const resetDraft = () => {
    const nextDraft = defaultDraft()
    setDraft(nextDraft)
    setDocumentStatus(null)
    setApprovedInfo(null)
    setSaveError(null)
    setSaveSuccess(null)
    setMultiResults(null)
    setMultiBatchId(null)
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(nextDraft))
  }

  const refreshBalances = async (fid: string): Promise<BalanceRow[]> => {
    const [balanceResult, lotBalanceResult, oilPoolResult] = await Promise.all([
      supabase
        .from("inventory_stock_balances")
        .select("warehouse_id, item_id, on_hand")
        .eq("factory_id", fid),
      supabase
        .from("inventory_lot_balances")
        .select("warehouse_id, item_id, lot_no, expiry_date, on_hand")
        .eq("factory_id", fid),
      supabase
        .from("inventory_oil_stock_pools")
        .select("warehouse_id, on_hand")
        .eq("factory_id", fid),
    ])

    let effective: BalanceRow[] = []
    if (!balanceResult.error && !oilPoolResult.error) {
      effective = buildEffectiveStockBalances({
        items,
        stockBalances: (balanceResult.data || []) as BalanceRow[],
        oilPoolBalances: (oilPoolResult.data || []) as InventoryOilPoolBalanceRow[],
      }) as BalanceRow[]
      setBalances(effective)
    }
    if (!lotBalanceResult.error) setLotBalances((lotBalanceResult.data || []) as LotBalanceRow[])
    return effective
  }

  const saveIssueDraft = async () => {
    setSaveError(null)
    setSaveSuccess(null)

    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy đang thao tác.")
      return null
    }
    if (draft.warehouseIds.length !== 1) {
      setSaveError("Vui lòng chọn đúng 1 kho xuất (chọn nhiều kho sẽ dùng nút Tạo & Ghi sổ tất cả).")
      return null
    }
    if (!draft.documentDate) {
      setSaveError("Vui lòng chọn ngày phiếu.")
      return null
    }

    const normalized = buildPersistableLines(draft.lines, items)
    if (normalized.error) {
      setSaveError(normalized.error)
      return null
    }

    const session = await getFreshAuthSession()
    if (!session?.user) {
      setSaveError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
      return null
    }

    const warehouseId = draft.warehouseIds[0]
    const warehouse = warehouses.find((entry) => entry.id === warehouseId)
    if (!warehouse) {
      setSaveError("Không tìm thấy kho xuất trong dữ liệu hiện tại.")
      return null
    }

    setSaving(true)

    try {
      let nextDocumentCode = draft.documentCode

      if (!nextDocumentCode) {
        const countResult = await supabase
          .from("inventory_documents")
          .select("id", { count: "exact", head: true })
          .eq("factory_id", factoryId)
          .eq("document_type", "export")
          .eq("source_warehouse_id", warehouseId)
          .eq("document_date", draft.documentDate)

        if (countResult.error) throw countResult.error
        nextDocumentCode = formatDocCode(warehouse.code, draft.documentDate, (countResult.count || 0) + 1)
      }

      const documentPayload = {
        factory_id: factoryId,
        document_code: nextDocumentCode,
        document_type: "export",
        document_date: draft.documentDate,
        source_warehouse_id: warehouseId,
        target_warehouse_id: null,
        source_name: warehouse.name,
        recipient_name: draft.recipientName.trim() || null,
        requester_name: currentUser?.full_name || currentUser?.username || session.user.email || null,
        created_by: session.user.id,
        status: "draft",
        qr_value: `/dashboard/inventory/print?type=export&code=${encodeURIComponent(nextDocumentCode)}`,
        notes: draft.note.trim() || null,
      }

      let documentId = draft.documentId

      if (documentId) {
        const updateResult = await supabase
          .from("inventory_documents")
          .update(documentPayload)
          .eq("id", documentId)
          .eq("factory_id", factoryId)

        if (updateResult.error) throw updateResult.error
      } else {
        const insertResult = await supabase
          .from("inventory_documents")
          .insert(documentPayload)
          .select("id, document_code")
          .single()

        if (insertResult.error || !insertResult.data?.id) {
          throw insertResult.error || new Error("Không tạo được phiếu xuất.")
        }

        documentId = insertResult.data.id as string
        nextDocumentCode = insertResult.data.document_code as string
      }

      const deleteLinesResult = await supabase
        .from("inventory_document_lines")
        .delete()
        .eq("document_id", documentId)
        .eq("factory_id", factoryId)

      if (deleteLinesResult.error) throw deleteLinesResult.error

      const linesPayload = normalized.lines.map((entry) => ({
        factory_id: factoryId,
        document_id: documentId,
        item_id: entry.item.id,
        item_code: entry.item.code,
        item_name: entry.item.name,
        unit: entry.item.unit,
        specification: entry.item.specification || null,
        quantity: entry.quantity,
        lot_no: entry.lotNo,
        expiry_date: entry.expiryDate,
        location_code: warehouse.code,
        line_notes: entry.note,
        image_urls: entry.imageUrls,
      }))

      const insertLinesResult = await supabase.from("inventory_document_lines").insert(linesPayload)
      if (insertLinesResult.error) throw insertLinesResult.error

      setDraft((prev) => ({
        ...prev,
        documentId,
        documentCode: nextDocumentCode,
      }))
      setDocumentStatus("draft")
      setSaveSuccess(`Đã lưu phiếu xuất ${nextDocumentCode} ở trạng thái nháp.`)
      return { documentId, documentCode: nextDocumentCode }
    } catch (error) {
      setSaveErrorTitle("Không lưu được phiếu xuất")
      setSaveError(error instanceof Error ? error.message : "Không lưu được phiếu xuất.")
      return null
    } finally {
      setSaving(false)
    }
  }

  const postIssueDraft = async () => {
    setSaveError(null)
    setSaveSuccess(null)

    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy đang thao tác.")
      return
    }
    if (documentStatus === "posted") {
      setSaveError("Phiếu xuất này đã được ghi sổ.")
      return
    }

    const hasBlockingWarning = lineDetails.some(
      (detail) =>
        detail.exceedsStock ||
        detail.exceedsLotStock ||
        detail.missingLot ||
        detail.missingExpiry ||
        detail.missingWarehouse,
    )
    if (hasBlockingWarning) {
      setSaveError("Phiếu xuất đang có dòng vượt tồn, thiếu thông tin lô - hạn hoặc chưa chọn kho. Vui lòng xử lý trước khi ghi sổ.")
      return
    }

    let targetDocumentId = draft.documentId
    let targetDocumentCode = draft.documentCode || documentCode

    if (!targetDocumentId) {
      const saved = await saveIssueDraft()
      if (!saved?.documentId) return
      targetDocumentId = saved.documentId
      targetDocumentCode = saved.documentCode
      setSaveSuccess(null)
    }

    const session = await getFreshAuthSession()
    if (!session?.user) {
      setSaveError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
      return
    }

    setPosting(true)

    try {
      const postResult = await supabase.rpc("inventory_post_export_document", {
        p_factory_id: factoryId,
        p_document_id: targetDocumentId,
        p_posted_by: session.user.id,
      })

      if (postResult.error) throw postResult.error

      const postedRow = Array.isArray(postResult.data) ? postResult.data[0] : null
      const postedLines =
        postedRow && typeof postedRow.posted_lines === "number" ? postedRow.posted_lines : lineDetails.length

      setDocumentStatus("posted")
      setPostedInfo({
        at: new Date().toISOString(),
        byName: currentUser?.full_name || currentUser?.username || session.user.email || "",
      })
      setDraft((prev) => ({
        ...prev,
        documentId: targetDocumentId,
        documentCode: targetDocumentCode,
      }))
      setSaveSuccess(`Đã ghi sổ phiếu xuất ${targetDocumentCode} với ${postedLines} dòng vật tư.`)
      setKpiPrompt({ recordId: targetDocumentId, recordLabel: targetDocumentCode })
      const freshBalances = await refreshBalances(factoryId)
      const freshBalanceMap = new Map(
        freshBalances.map((row) => [`${row.warehouse_id}:${row.item_id}`, Number(row.on_hand) || 0]),
      )
      const nguoiNx = currentUser?.full_name || currentUser?.username || session.user.email || ""
      const warehouseId = draft.warehouseIds[0]
      const warehouse = warehouses.find((w) => w.id === warehouseId)
      const notifyLines: NxtDocumentNotifyLine[] = []
      for (const detail of lineDetails) {
        if (!detail.item) continue
        const newStock = freshBalanceMap.get(`${warehouseId}:${detail.item.id}`) ?? 0
        notifyLines.push({
          itemName: detail.item.name,
          quantity: detail.quantity,
          unit: detail.item.unit,
          currentStock: newStock,
        })
        const { minStock } = resolveStockThreshold(detail.item.id, warehouseId, detail.item, warehouseRules)
        if (minStock > 0 && newStock < minStock) {
          sendInventoryLowStockAlert({ itemName: detail.item.name, currentStock: newStock, unit: detail.item.unit })
        }
      }
      if (notifyLines.length > 0) {
        sendInventoryNxtChangeNotify({
          loaiNxt: "Xuất",
          documentCode: targetDocumentCode,
          warehouseLabel: warehouse ? `${warehouse.code} - ${warehouse.name}` : "",
          nguoiNx,
          ghiChu: draft.note.trim() || null,
          lines: notifyLines,
          linkPath: targetDocumentId
            ? `/dashboard/inventory/issues?documentId=${encodeURIComponent(targetDocumentId)}`
            : undefined,
        })
      }
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : (error as { message?: string })?.message || "Không ghi sổ được phiếu xuất."
      setSaveErrorTitle("Không ghi sổ được phiếu xuất")
      setSaveError(msg)
    } finally {
      setPosting(false)
    }
  }

  const createAndPostMultiWarehouse = async () => {
    setSaveError(null)
    setSaveSuccess(null)
    setMultiResults(null)

    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy đang thao tác.")
      return
    }
    if (!draft.documentDate) {
      setSaveError("Vui lòng chọn ngày phiếu.")
      return
    }

    const normalized = buildPersistableLines(draft.lines, items)
    if (normalized.error) {
      setSaveError(normalized.error)
      return
    }

    const hasBlockingWarning = lineDetails.some(
      (detail) =>
        detail.exceedsStock ||
        detail.exceedsLotStock ||
        detail.missingLot ||
        detail.missingExpiry ||
        detail.missingWarehouse,
    )
    if (hasBlockingWarning) {
      setSaveError("Còn dòng chưa hợp lệ (vượt tồn, thiếu lô - hạn, hoặc chưa chọn kho). Vui lòng xử lý trước khi tạo phiếu.")
      return
    }

    const groups = groupLinesByWarehouse(normalized.lines)
    if (groups.size === 0) {
      setSaveError("Chưa có dòng vật tư hợp lệ nào để tạo phiếu.")
      return
    }

    const session = await getFreshAuthSession()
    if (!session?.user) {
      setSaveError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
      return
    }

    setSaving(true)
    const newBatchId = crypto.randomUUID()
    const nguoiNx = currentUser?.full_name || currentUser?.username || session.user.email || ""
    const nextResults: WarehouseResult[] = []
    const postedForNotify: {
      warehouseId: string
      warehouseCode: string
      documentId: string
      documentCode: string
      lines: PersistableLine[]
    }[] = []

    for (const [warehouseId, warehouseLines] of groups.entries()) {
      const warehouse = warehouses.find((w) => w.id === warehouseId)
      if (!warehouse) continue

      try {
        const countResult = await supabase
          .from("inventory_documents")
          .select("id", { count: "exact", head: true })
          .eq("factory_id", factoryId)
          .eq("document_type", "export")
          .eq("source_warehouse_id", warehouseId)
          .eq("document_date", draft.documentDate)
        if (countResult.error) throw countResult.error

        const documentCodeForWarehouse = formatDocCode(warehouse.code, draft.documentDate, (countResult.count || 0) + 1)

        const documentInsert = await supabase
          .from("inventory_documents")
          .insert({
            factory_id: factoryId,
            document_code: documentCodeForWarehouse,
            document_type: "export",
            document_date: draft.documentDate,
            source_warehouse_id: warehouseId,
            target_warehouse_id: null,
            source_name: warehouse.name,
            recipient_name: draft.recipientName.trim() || null,
            requester_name: nguoiNx || null,
            created_by: session.user.id,
            status: "draft",
            qr_value: `/dashboard/inventory/print?type=export&code=${encodeURIComponent(documentCodeForWarehouse)}`,
            notes: draft.note.trim() || null,
            batch_id: newBatchId,
          })
          .select("id, document_code")
          .single()

        if (documentInsert.error || !documentInsert.data?.id) {
          throw documentInsert.error || new Error("Không tạo được phiếu xuất.")
        }

        const documentId = documentInsert.data.id as string

        const linesPayload = warehouseLines.map((entry) => ({
          factory_id: factoryId,
          document_id: documentId,
          item_id: entry.item.id,
          item_code: entry.item.code,
          item_name: entry.item.name,
          unit: entry.item.unit,
          specification: entry.item.specification || null,
          quantity: entry.quantity,
          lot_no: entry.lotNo,
          expiry_date: entry.expiryDate,
          location_code: warehouse.code,
          line_notes: entry.note,
          image_urls: entry.imageUrls,
        }))

        const insertLinesResult = await supabase.from("inventory_document_lines").insert(linesPayload)
        if (insertLinesResult.error) throw insertLinesResult.error

        const postResult = await supabase.rpc("inventory_post_export_document", {
          p_factory_id: factoryId,
          p_document_id: documentId,
          p_posted_by: session.user.id,
        })
        if (postResult.error) throw postResult.error

        nextResults.push({
          warehouseId,
          warehouseCode: warehouse.code,
          status: "success",
          documentId,
          documentCode: documentCodeForWarehouse,
        })
        postedForNotify.push({ warehouseId, warehouseCode: warehouse.code, documentId, documentCode: documentCodeForWarehouse, lines: warehouseLines })
      } catch (error) {
        nextResults.push({
          warehouseId,
          warehouseCode: warehouse.code,
          status: "error",
          message: error instanceof Error ? error.message : "Không tạo/ghi sổ được phiếu xuất.",
        })
      }
    }

    setMultiResults(nextResults)
    const anySuccess = nextResults.some((r) => r.status === "success")
    if (anySuccess) {
      setMultiBatchId(newBatchId)
      const freshBalances = await refreshBalances(factoryId)
      const freshBalanceMap = new Map(
        freshBalances.map((row) => [`${row.warehouse_id}:${row.item_id}`, Number(row.on_hand) || 0]),
      )

      for (const posted of postedForNotify) {
        const notifyLines: NxtDocumentNotifyLine[] = posted.lines.map((entry) => ({
          itemName: entry.item.name,
          quantity: entry.quantity,
          unit: entry.item.unit,
          currentStock: freshBalanceMap.get(`${posted.warehouseId}:${entry.item.id}`) ?? 0,
        }))
        sendInventoryNxtChangeNotify({
          loaiNxt: "Xuất",
          documentCode: posted.documentCode,
          warehouseLabel: `${posted.warehouseCode} - ${warehouses.find((w) => w.id === posted.warehouseId)?.name || ""}`,
          nguoiNx,
          ghiChu: draft.note.trim() || null,
          lines: notifyLines,
          linkPath: `/dashboard/inventory/issues?documentId=${encodeURIComponent(posted.documentId)}`,
        })
        for (const entry of posted.lines) {
          const newStock = freshBalanceMap.get(`${posted.warehouseId}:${entry.item.id}`) ?? 0
          const { minStock } = resolveStockThreshold(entry.item.id, posted.warehouseId, entry.item, warehouseRules)
          if (minStock > 0 && newStock < minStock) {
            sendInventoryLowStockAlert({ itemName: entry.item.name, currentStock: newStock, unit: entry.item.unit })
          }
        }
      }

      // Đã tạo & ghi sổ xong ≥1 phiếu — dọn sạch phần đang soạn (giữ lại ngày phiếu) để tránh
      // form vẫn hiển thị các dòng vừa gửi thành công với nút "Tạo & Ghi sổ tất cả" còn sáng sẵn,
      // dễ bấm nhầm gửi trùng lần 2 trong cùng phiên.
      setDraft((prev) => ({
        ...defaultDraft(),
        documentDate: prev.documentDate,
      }))
      setSelectedCategoryIds([])
    }

    setSaving(false)
  }

  const cancelDocument = async () => {
    if (!factoryId || !draft.documentId || !cancelReason.trim()) return
    const session = await getFreshAuthSession()
    if (!session?.user) { setSaveError("Phiên đăng nhập đã hết hạn."); return }
    setCancelling(true)
    try {
      const { error } = await supabase.rpc("inventory_cancel_document", {
        p_factory_id: factoryId,
        p_document_id: draft.documentId,
        p_cancelled_by: session.user.id,
        p_cancel_reason: cancelReason.trim(),
      })
      if (error) throw error
      setDocumentStatus("cancelled")
      setCancelModal(false)
      setCancelReason("")
      setSaveSuccess(`Phiếu xuất ${draft.documentCode} đã được hủy. Tồn kho đã được hoàn nguyên.`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể hủy phiếu.")
    } finally {
      setCancelling(false)
    }
  }

  const approveDocument = async () => {
    if (!factoryId || !draft.documentId) return
    const session = await getFreshAuthSession()
    if (!session?.user) { setSaveError("Phiên đăng nhập đã hết hạn."); return }
    setApproving(true)
    try {
      const byName = currentUser?.full_name || currentUser?.username || session.user.email || ""
      const nowIso = new Date().toISOString()
      const { error } = await supabase
        .from("inventory_documents")
        .update({ approved_by: session.user.id, approved_by_name: byName, approved_at: nowIso })
        .eq("id", draft.documentId)
        .eq("factory_id", factoryId)
      if (error) throw error
      setApprovedInfo({ at: nowIso, byName })
      setApproveModal(false)
      setSaveSuccess(`Phiếu xuất ${draft.documentCode} đã được phê duyệt.`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể phê duyệt phiếu.")
    } finally {
      setApproving(false)
    }
  }

  const canSave = draft.warehouseIds.length === 1 && draft.lines.length > 0
  const canSubmitMulti =
    !loading &&
    !saving &&
    draft.lines.length > 0 &&
    !lineDetails.some(
      (detail) =>
        detail.exceedsStock ||
        detail.exceedsLotStock ||
        detail.missingLot ||
        detail.missingExpiry ||
        detail.missingWarehouse,
    )

  return (
    <>
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title="Phiếu xuất kho"
      description="Chọn 1 hoặc nhiều kho, chọn nhiều vật tư theo kho và hoàn thiện từng dòng theo cặp số lô - hạn sử dụng còn tồn."
    >
      {kpiPrompt && (
        <KpiLinkPrompt
          factoryId={factoryId}
          moduleCode="inventory:issue"
          recordId={kpiPrompt.recordId}
          recordLabel={kpiPrompt.recordLabel}
          recordUrl={`/dashboard/inventory/issues?documentId=${encodeURIComponent(kpiPrompt.recordId)}`}
          onDone={() => setKpiPrompt(null)}
        />
      )}
      {warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-bold">Đang dùng dữ liệu mẫu</div>
          <div className="mt-1 leading-6">{warning}</div>
        </div>
      ) : null}

      {saveError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="font-bold">{saveErrorTitle}</div>
          <div className="mt-1 leading-6">{saveError}</div>
        </div>
      ) : null}

      {saveSuccess ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <div className="font-bold">Thao tác thành công</div>
          <div className="mt-1 leading-6">{saveSuccess}</div>
        </div>
      ) : null}

      {multiResults ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-bold text-slate-700">Kết quả phiên xuất nhiều kho</div>
          <div className="space-y-2">
            {multiResults.map((r) => (
              <div
                key={r.warehouseId}
                className={`flex flex-col gap-1 rounded-xl px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between ${
                  r.status === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}
              >
                <span className="flex items-center gap-2 font-bold">
                  {r.status === "success" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  Kho {r.warehouseCode}
                </span>
                {r.status === "success" && r.documentId ? (
                  <Link
                    href={`/dashboard/inventory/issues?documentId=${encodeURIComponent(r.documentId)}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    {r.documentCode} — Mở phiếu để phê duyệt/hủy/sửa
                  </Link>
                ) : (
                  <span>{r.message}</span>
                )}
              </div>
            ))}
          </div>
          {multiBatchId ? (
            <Link
              href={`/dashboard/inventory/print?type=export&batchId=${encodeURIComponent(multiBatchId)}`}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-emerald-700"
            >
              <Printer size={16} />
              In tất cả (theo từng kho)
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <SummaryBox label="Tổng số dòng" value={String(draft.lines.length)} />
        <SummaryBox label="Tổng số lượng xuất" value={summary.totalQty.toLocaleString("vi-VN")} tone="text-rose-700" />
        <SummaryBox label="Cảnh báo" value={String(summary.warningCount)} tone="text-amber-600" />
        <SummaryBox
          label="Trạng thái phiếu"
          value={documentStatus === "posted" ? "Đã ghi sổ" : documentStatus === "cancelled" ? "Đã hủy" : draft.documentId ? "Nháp" : isMultiWarehouseMode ? "Phiên nhiều kho" : "Chưa lưu"}
          tone={documentStatus === "posted" ? "text-emerald-700" : documentStatus === "cancelled" ? "text-red-600" : "text-slate-800"}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Thông tin phiếu</div>
            <h2 className="mt-1 break-all text-lg font-bold text-slate-800 sm:text-xl">
              {isMultiWarehouseMode ? `Phiên xuất ${draft.warehouseIds.length} kho` : documentCode}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isMultiWarehouseMode
                ? "Đang chọn nhiều kho — mỗi kho sẽ được ghi sổ thành 1 phiếu xuất riêng, có mã và QR riêng."
                : "Chọn kho trước, sau đó chọn nhiều vật tư. Các dòng chi tiết sẽ tự sinh ngay bên dưới. Chọn thêm kho khác để xuất nhiều kho cùng lúc."}
            </p>
          </div>
          {!isMultiWarehouseMode ? (
            <div className="flex flex-col gap-3 lg:items-end">
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                {draft.documentId ? (
                  <Link
                    href={`/dashboard/inventory/print?type=export&documentId=${encodeURIComponent(draft.documentId)}`}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 sm:px-5 sm:py-2"
                  >
                    <Printer size={16} />
                    In phiếu
                  </Link>
                ) : null}
                <button
                  onClick={resetDraft}
                  className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 sm:px-5 sm:py-2"
                >
                  Làm mới
                </button>
                {documentStatus !== "posted" && documentStatus !== "cancelled" ? (
                  <>
                    <button
                      onClick={() => void saveIssueDraft()}
                      disabled={!canSave || saving || posting || loading}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 sm:px-5 sm:py-2"
                    >
                      <Save size={14} />
                      {saving ? "Đang lưu..." : draft.documentId ? "Sửa phiếu" : "Lưu nháp"}
                    </button>
                    <button
                      onClick={() => void postIssueDraft()}
                      disabled={saving || posting || loading}
                      className="col-span-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 sm:col-span-1 sm:px-5 sm:py-2"
                    >
                      {posting ? "Đang ghi sổ..." : "Ghi sổ xuất kho"}
                    </button>
                  </>
                ) : null}
                {documentStatus === "posted" && hasPermission(currentUser, "inventory.cancel") ? (
                  <button
                    onClick={() => setCancelModal(true)}
                    className="col-span-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-100 sm:col-span-1 sm:px-5 sm:py-2"
                  >
                    <Ban size={14} className="mr-1.5 inline" />
                    Hủy phiếu
                  </button>
                ) : null}
                {documentStatus === "posted" && canApprove && !approvedInfo ? (
                  <button
                    onClick={() => setApproveModal(true)}
                    className="col-span-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-700 transition-colors hover:bg-indigo-100 sm:col-span-1 sm:px-5 sm:py-2"
                  >
                    <CheckCircle2 size={14} className="mr-1.5 inline" />
                    Phê duyệt
                  </button>
                ) : null}
              </div>
              {postedInfo ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                  <Check size={13} className="shrink-0" />
                  <span>
                    Đã ghi sổ lúc {new Date(postedInfo.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                    {" "}ngày {new Date(postedInfo.at).toLocaleDateString("vi-VN")}
                    {postedInfo.byName ? ` bởi ${postedInfo.byName}` : ""}
                  </span>
                </div>
              ) : null}
              {approvedInfo ? (
                <div className="flex items-center gap-1.5 text-xs text-indigo-700">
                  <CheckCircle2 size={13} className="shrink-0" />
                  <span>
                    Đã phê duyệt lúc {new Date(approvedInfo.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                    {" "}ngày {new Date(approvedInfo.at).toLocaleDateString("vi-VN")}
                    {approvedInfo.byName ? ` bởi ${approvedInfo.byName}` : ""}
                  </span>
                </div>
              ) : documentStatus === "posted" ? (
                <div className="text-xs font-semibold text-amber-600">Chưa phê duyệt</div>
              ) : null}
              <InventoryQrCard
                title="QR phiếu xuất"
                caption="Quét để mở nhanh phiếu xuất theo mã."
                hrefPath={documentQrPath}
                valueText={documentCode}
                compact
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3 lg:items-end">
              <button
                onClick={resetDraft}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 sm:px-5 sm:py-2"
              >
                Làm mới
              </button>
              <button
                onClick={() => void createAndPostMultiWarehouse()}
                disabled={!canSubmitMulti}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? "Đang tạo & ghi sổ..."
                  : `Tạo & Ghi sổ tất cả (${draft.warehouseIds.length} kho, ${draft.lines.length} dòng)`}
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="xl:col-span-2">
            {isEditingExistingDoc ? (
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Kho xuất *</label>
                <select
                  value={draft.warehouseIds[0] || ""}
                  onChange={(e) => handleWarehouseIdsChange(e.target.value ? [e.target.value] : [])}
                  className={INPUT_CLASS}
                >
                  <option value="">Chọn kho</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.code} - {warehouse.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <MultiSelectField
                label="Kho xuất *"
                options={warehouses.map((warehouse) => ({
                  value: warehouse.id,
                  label: `${warehouse.code} - ${warehouse.name}`,
                }))}
                selectedValues={draft.warehouseIds}
                onChange={handleWarehouseIdsChange}
                placeholder="Chọn kho xuất (chọn được nhiều kho cùng lúc)"
              />
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600">Ngày phiếu *</label>
            <input
              type="date"
              value={draft.documentDate}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  documentDate: e.target.value,
                  documentId: null,
                  documentCode: "",
                }))
              }
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600">Người nhận hàng</label>
            <input
              value={draft.recipientName}
              onChange={(e) => setDraft((prev) => ({ ...prev, recipientName: e.target.value }))}
              placeholder="Người/bộ phận nhận vật tư xuất ra"
              className={INPUT_CLASS}
            />
          </div>

          <div className="relative z-30 xl:col-span-2">
            <div className="mb-2 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div>
                <MultiSelectField
                  label="Phân loại vật tư"
                  options={warehouseScopedCategories.map((category) => ({
                    value: category.id,
                    label: category.name,
                    meta: category.code,
                  }))}
                  selectedValues={selectedCategoryIds}
                  onChange={setSelectedCategoryIds}
                  placeholder="Tất cả phân loại"
                  disabled={draft.warehouseIds.length === 0}
                />
              </div>

              <div>
                <MultiSelectField
                  label="Mã vật tư"
                  options={availableItems.map((item) => ({
                    value: item.id,
                    label: item.code,
                    meta: item.name,
                  }))}
                  selectedValues={draft.selectedItemIds}
                  onChange={(values) => setDraft((prev) => ({ ...prev, selectedItemIds: values }))}
                  placeholder="Chọn nhiều mã vật tư"
                  disabled={draft.warehouseIds.length === 0}
                />
              </div>

              <div />
            </div>

            <label className="mb-2 block text-xs font-bold text-slate-600">Danh sách vật tư theo kho đã chọn</label>
            {draft.warehouseIds.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Vui lòng chọn kho trước khi chọn vật tư.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {visibleItemCards.map((item) => {
                  const selected = draft.selectedItemIds.includes(item.id)
                  const relevantWarehouses = warehouses.filter((w) => draft.warehouseIds.includes(w.id))
                  const totalStock = relevantWarehouses.reduce((sum, w) => sum + (balanceMap.get(`${w.id}:${item.id}`) ?? 0), 0)
                  const warehouseStocks = relevantWarehouses
                    .map((w) => ({ code: w.code, stock: balanceMap.get(`${w.id}:${item.id}`) ?? 0 }))
                    .filter((w) => w.stock > 0)
                  const breakdownText =
                    warehouseStocks.length > 1
                      ? warehouseStocks
                          .map((w) => `${w.code}: ${w.stock.toLocaleString("vi-VN")}`)
                          .join(" | ")
                      : null

                  return (
                    <CompactItemSelectorCard
                      key={item.id}
                      onToggle={() => toggleSelectedItem(item.id)}
                      code={item.code}
                      name={item.name}
                      stockText={`${getStockContextLabel(item, selectedWarehouse?.code)}: ${totalStock.toLocaleString("vi-VN")} ${item.unit}`}
                      breakdownText={breakdownText}
                      selected={selected}
                    />
                  )
                })}
              </div>
            )}
          </div>

          <div className="xl:col-span-2">
            <label className="mb-1.5 block text-xs font-bold text-slate-600">Ghi chú phiếu</label>
            <textarea
              value={draft.note}
              onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
              rows={3}
              placeholder="Lý do xuất, bộ phận nhận, ghi chú giao nhận..."
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="border-b border-slate-200 pb-4">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Dòng vật tư</div>
          <h2 className="mt-1 text-lg font-bold text-slate-800">Danh sách vật tư xuất</h2>
        </div>

        {draft.lines.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Chọn vật tư ở phần trên để tự sinh các dòng xuất kho.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {lineDetails.map((detail, index) => {
              const expiryOptions = [
                ...new Set(detail.availableLots.map((entry) => entry.expiryDate).filter(Boolean)),
              ] as string[]
              const lineWarehouseCode = warehouses.find((w) => w.id === detail.line.warehouseId)?.code || null

              return (
                <div key={detail.line.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words font-bold text-slate-800">
                        {getLineTypeLabel(detail.item, index, lineDetails.map((d) => d.item))}
                      </div>
                    </div>
                    <div className="flex w-full flex-col items-end gap-2 sm:w-auto">
                      {detail.candidateWarehouseIds.length >= 2 ? (
                        <div className={`w-full rounded-xl border px-3 py-2 sm:w-auto ${detail.missingWarehouse ? "border-amber-300 bg-amber-50" : "border-violet-200 bg-violet-50"}`}>
                          <label className={`mb-1 block text-[11px] font-bold ${detail.missingWarehouse ? "text-amber-700" : "text-violet-700"}`}>
                            Kho xuất *
                          </label>
                          <select
                            value={detail.line.warehouseId}
                            onChange={(e) =>
                              updateLine(detail.line.id, { warehouseId: e.target.value, lotNo: "", expiryDate: "" })
                            }
                            className="w-full rounded-lg border border-violet-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none sm:w-auto"
                          >
                            <option value="">-- Chọn kho --</option>
                            {detail.candidateWarehouseIds.map((wid) => {
                              const wh = warehouses.find((w) => w.id === wid)
                              const stock = detail.item ? balanceMap.get(`${wid}:${detail.item.id}`) ?? 0 : 0
                              return (
                                <option key={wid} value={wid}>
                                  {wh?.code}: {stock.toLocaleString("vi-VN")} {detail.item?.unit}
                                </option>
                              )
                            })}
                          </select>
                        </div>
                      ) : lineWarehouseCode ? (
                        <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                          Kho: {lineWarehouseCode}
                        </span>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {detail.candidateWarehouseIds.length >= 2 ? (
                          <button
                            type="button"
                            onClick={() => addAnotherLotLine(detail.item!.id)}
                            className="flex items-center gap-1.5 rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-200"
                          >
                            <Plus size={13} />
                            Thêm dòng (kho khác)
                          </button>
                        ) : null}
                        {detail.item?.manages_lot && detail.availableLots.length >= 2 ? (
                          <button
                            type="button"
                            onClick={() => addAnotherLotLine(detail.item!.id)}
                            className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
                          >
                            <CopyPlus size={13} />
                            Tách lô
                          </button>
                        ) : null}
                        <button
                          onClick={() => removeLine(detail.line.id)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Tên vật tư</label>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                        {detail.item ? `${detail.item.code} - ${detail.item.name}` : "Chưa có vật tư"}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Số lượng *</label>
                      <input
                        value={detail.line.quantity}
                        onChange={(e) => updateLine(detail.line.id, { quantity: e.target.value })}
                        placeholder="0"
                        className={INPUT_CLASS}
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <AlertPill tone="blue">
                          {getStockContextLabel(detail.item, lineWarehouseCode)} hiện tại: {detail.currentStock.toLocaleString("vi-VN")} {detail.item?.unit || ""}
                        </AlertPill>
                        {detail.currentLotStock !== null ? (
                          <AlertPill tone="blue">
                            Tồn lô: {detail.currentLotStock.toLocaleString("vi-VN")} {detail.item?.unit || ""}
                          </AlertPill>
                        ) : null}
                        <AlertPill>{getStockContextLabel(detail.item, lineWarehouseCode)} sau xuất: {detail.projectedStock.toLocaleString("vi-VN")}</AlertPill>
                        {detail.missingWarehouse ? <AlertPill>Chưa chọn kho xuất</AlertPill> : null}
                        {detail.exceedsStock ? <AlertPill tone="red">Vượt tồn kho nguồn</AlertPill> : null}
                        {detail.exceedsLotStock ? <AlertPill tone="red">Vượt tồn lô</AlertPill> : null}
                        {detail.belowMin ? <AlertPill>Tồn sau xuất dưới mức min</AlertPill> : null}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Số lô</label>
                      <select
                        value={detail.line.lotNo}
                        onChange={(e) => {
                          const chosenLot = detail.availableLots.find((entry) => entry.lotNo === e.target.value)
                          updateLine(detail.line.id, {
                            lotNo: e.target.value,
                            expiryDate: chosenLot?.expiryDate || "",
                          })
                        }}
                        className={INPUT_CLASS}
                        disabled={!detail.item?.manages_lot}
                      >
                        <option value="">{detail.item?.manages_lot ? "Chọn số lô" : "Không áp dụng"}</option>
                        {detail.availableLots.map((entry) => (
                          <option key={`${entry.lotNo}-${entry.expiryDate || "none"}`} value={entry.lotNo}>
                            {entry.lotNo} - còn {entry.onHand.toLocaleString("vi-VN")} {detail.item?.unit}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Hạn sử dụng</label>
                      <select
                        value={detail.line.expiryDate}
                        onChange={(e) => {
                          const chosenExpiry = e.target.value
                          const chosenLot = detail.availableLots.find((entry) => (entry.expiryDate || "") === chosenExpiry)
                          updateLine(detail.line.id, {
                            expiryDate: chosenExpiry,
                            lotNo: chosenLot?.lotNo || "",
                          })
                        }}
                        className={INPUT_CLASS}
                        disabled={!detail.item?.manages_expiry}
                      >
                        <option value="">{detail.item?.manages_expiry ? "Chọn hạn sử dụng" : "Không áp dụng"}</option>
                        {expiryOptions.map((expiryDate) => (
                          <option key={expiryDate} value={expiryDate}>
                            {new Date(expiryDate).toLocaleDateString("vi-VN")}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <InventoryMultiImageUpload
                        factoryId={factoryId}
                        documentType="export"
                        label="Hình ảnh (tối đa 6, chọn nhiều cùng lúc)"
                        images={detail.line.imageUrls}
                        onChange={(urls) => updateLine(detail.line.id, { imageUrls: urls })}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Ghi chú</label>
                      <textarea
                        value={detail.line.note}
                        onChange={(e) => updateLine(detail.line.id, { note: e.target.value })}
                        rows={3}
                        placeholder="Ghi chú riêng cho dòng vật tư này"
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {detail.missingWarehouse ? (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        <span>Vật tư này tồn tại ở nhiều kho đang chọn — vui lòng chọn đúng kho xuất ở góc trên bên phải.</span>
                      </div>
                    ) : null}
                    {detail.missingLot ? (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        <span>Vật tư này bắt buộc chọn số lô từ danh sách lô còn hàng trong kho.</span>
                      </div>
                    ) : null}
                    {detail.missingExpiry ? (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        <span>Hạn sử dụng phải đi đúng với số lô đã chọn.</span>
                      </div>
                    ) : null}
                    {detail.availableLots.length > 0 ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                        Lô còn tồn:{" "}
                        {detail.availableLots
                          .map((entry) =>
                            `${entry.lotNo}${entry.expiryDate ? ` - ${new Date(entry.expiryDate).toLocaleDateString("vi-VN")}` : ""} (${entry.onHand.toLocaleString("vi-VN")})`,
                          )
                          .join(", ")}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </InventoryPageShell>

    {cancelModal ? (
      <ModalShell
        title={<span className="flex items-center gap-2 text-red-600"><Ban size={18} /> Hủy phiếu xuất</span>}
        onClose={() => { setCancelModal(false); setCancelReason("") }}
        maxWidth="md"
        footer={
          <>
            <button
              onClick={() => { setCancelModal(false); setCancelReason("") }}
              className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
            >
              Đóng
            </button>
            <button
              onClick={() => void cancelDocument()}
              disabled={cancelling || !cancelReason.trim()}
              className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-red-700 disabled:opacity-50"
            >
              {cancelling ? "Đang hủy..." : "Xác nhận hủy phiếu"}
            </button>
          </>
        }
      >
          <p className="mb-3 text-sm text-slate-600">
            Hủy phiếu sẽ <strong>hoàn lại tồn kho</strong> đã bị xuất. Thao tác này không thể hoàn tác.
          </p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Lý do hủy phiếu (bắt buộc)..."
            rows={3}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-400"
          />
      </ModalShell>
    ) : null}

    {approveModal ? (
      <ModalShell
        title={<span className="flex items-center gap-2 text-indigo-700"><CheckCircle2 size={18} /> Phê duyệt phiếu xuất</span>}
        onClose={() => setApproveModal(false)}
        maxWidth="md"
        footer={
          <>
            <button
              onClick={() => setApproveModal(false)}
              className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
            >
              Đóng
            </button>
            <button
              onClick={() => void approveDocument()}
              disabled={approving}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {approving ? "Đang phê duyệt..." : "Xác nhận phê duyệt"}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Xác nhận phê duyệt phiếu xuất <strong>{draft.documentCode}</strong> với tư cách Ban giám đốc. Tên và thời điểm phê duyệt sẽ được in trên phiếu.
        </p>
      </ModalShell>
    ) : null}
    </>
  )
}
