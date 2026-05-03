"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, ArrowRightLeft, Ban, Check, CopyPlus, Printer, Save, Trash2, X } from "lucide-react"
import { getActiveFactoryId, getFreshAuthSession, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { InventoryPageShell } from "../_components/inventory-shell"
import { InventoryImageUpload } from "../_components/inventory-image-upload"
import { fetchInventoryDocumentByReference } from "../_components/inventory-document-loader"
import { InventoryQrCard } from "../_components/inventory-qr-card"
import {
  getLineTypeLabel,
  loadInventoryAdminData,
  type InventoryCategoryOption,
  type InventoryItemOption,
  type InventoryWarehouseOption,
  type InventoryWarehouseRule,
} from "../_components/inventory-data"

type TransferLineDraft = {
  id: string
  itemId: string
  quantity: string
  lotNo: string
  expiryDate: string
  note: string
  image1Url: string
  image2Url: string
}

type TransferDraftState = {
  documentId: string | null
  documentCode: string
  sourceWarehouseId: string
  targetWarehouseId: string
  actorName: string
  documentDate: string
  note: string
  selectedItemIds: string[]
  lines: TransferLineDraft[]
}

type PersistableLine = {
  item: InventoryItemOption
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
  line: TransferLineDraft
  item: InventoryItemOption | null
  quantity: number
  currentStock: number
  currentLotStock: number | null
  projectedSource: number
  projectedTarget: number
  belowSourceMin: boolean
  exceedsTargetMax: boolean
  exceedsStock: boolean
  exceedsLotStock: boolean
  missingLot: boolean
  missingExpiry: boolean
  sourceMin: number
  targetMax: number
  availableLots: LotOption[]
}

const DRAFT_STORAGE_KEY = "inventory-transfer-draft-v3"
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

function makeLine(itemId = ""): TransferLineDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemId,
    quantity: "",
    lotNo: "",
    expiryDate: "",
    note: "",
    image1Url: "",
    image2Url: "",
  }
}

function defaultDraft(): TransferDraftState {
  return {
    documentId: null,
    documentCode: "",
    sourceWarehouseId: "",
    targetWarehouseId: "",
    actorName: "",
    documentDate: todayIso(),
    note: "",
    selectedItemIds: [],
    lines: [],
  }
}

function normalizeDraftState(value: unknown): TransferDraftState {
  const base = defaultDraft()
  if (!value || typeof value !== "object") return base

  const raw = value as Partial<TransferDraftState>
  const lines = Array.isArray(raw.lines)
    ? raw.lines
        .map((line) => {
          if (!line || typeof line !== "object") return null
          const entry = line as Partial<TransferLineDraft>
          return {
            id: entry.id || makeLine().id,
            itemId: entry.itemId || "",
            quantity: entry.quantity || "",
            lotNo: entry.lotNo || "",
            expiryDate: entry.expiryDate || "",
            note: entry.note || "",
            image1Url: entry.image1Url || "",
            image2Url: entry.image2Url || "",
          }
        })
        .filter((line): line is TransferLineDraft => Boolean(line))
    : []

  return {
    documentId: typeof raw.documentId === "string" ? raw.documentId : null,
    documentCode: typeof raw.documentCode === "string" ? raw.documentCode : "",
    sourceWarehouseId: typeof raw.sourceWarehouseId === "string" ? raw.sourceWarehouseId : "",
    targetWarehouseId: typeof raw.targetWarehouseId === "string" ? raw.targetWarehouseId : "",
    actorName: typeof raw.actorName === "string" ? raw.actorName : "",
    documentDate: typeof raw.documentDate === "string" && raw.documentDate ? raw.documentDate : base.documentDate,
    note: typeof raw.note === "string" ? raw.note : "",
    selectedItemIds: Array.isArray(raw.selectedItemIds)
      ? raw.selectedItemIds.filter((id): id is string => typeof id === "string")
      : [],
    lines,
  }
}

function formatDocCode(warehouseCode: string, date: string, sequence = 1) {
  if (!warehouseCode || !date) return "C-____-DDMMYY/001"
  const [yyyy, mm, dd] = date.split("-")
  return `C-${warehouseCode}-${dd}${mm}${yyyy.slice(2)}/${String(sequence).padStart(3, "0")}`
}

function findRule(itemId: string, warehouseId: string, rules: InventoryWarehouseRule[]) {
  return rules.find((rule) => rule.item_id === itemId && rule.warehouse_id === warehouseId) || null
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

function buildPersistableLines(lines: TransferLineDraft[], items: InventoryItemOption[]) {
  const normalized: PersistableLine[] = []

  for (const line of lines) {
    const item = items.find((entry) => entry.id === line.itemId)
    if (!item) continue

    const quantity = Number(line.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: `Vui lòng nhập số lượng hợp lệ cho vật tư ${item.code}.`, lines: [] as PersistableLine[] }
    }

    const lotNo = line.lotNo.trim() || null
    const expiryDate = line.expiryDate || null

    if (item.manages_lot && !lotNo) {
      return { error: `Vật tư ${item.code} bắt buộc chọn số lô trước khi lưu phiếu chuyển.`, lines: [] as PersistableLine[] }
    }

    if (item.manages_expiry && !expiryDate) {
      return {
        error: `Vật tư ${item.code} bắt buộc chọn hạn sử dụng trước khi lưu phiếu chuyển.`,
        lines: [] as PersistableLine[],
      }
    }

    normalized.push({
      item,
      quantity,
      lotNo,
      expiryDate,
      note: line.note.trim() || null,
      imageUrls: [line.image1Url, line.image2Url].filter(Boolean),
    })
  }

  if (normalized.length === 0) {
    return { error: "Phiếu chuyển cần ít nhất một dòng vật tư hợp lệ.", lines: [] as PersistableLine[] }
  }

  return { error: null, lines: normalized }
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

export default function InventoryTransfersPage() {
  const searchParams = useSearchParams()
  const requestedDocumentId = searchParams.get("documentId")
  const requestedCode = searchParams.get("code")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [documentStatus, setDocumentStatus] = useState<"draft" | "posted" | "cancelled" | null>(null)
  const [postedInfo, setPostedInfo] = useState<{ at: string; byName: string } | null>(null)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [cancelModal, setCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelling, setCancelling] = useState(false)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [warehouseRules, setWarehouseRules] = useState<InventoryWarehouseRule[]>([])
  const [balances, setBalances] = useState<BalanceRow[]>([])
  const [lotBalances, setLotBalances] = useState<LotBalanceRow[]>(fallbackLotBalances)
  const [categories, setCategories] = useState<InventoryCategoryOption[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState("")
  const [draft, setDraft] = useState<TransferDraftState>(defaultDraft())

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventoryAdminData()
        const activeSession = await hydrateActiveSession().catch(() => ({ user: null }))
        if (activeSession.user) setCurrentUser(activeSession.user)
        const resolvedFactoryId = inventoryData.factoryId ?? (await getActiveFactoryId())
        const actorName = activeSession.user?.full_name || activeSession.user?.username || ""

        setFactoryId(resolvedFactoryId)
        setWarning(inventoryData.warning)
        setWarehouses(inventoryData.warehouses)
        setItems(inventoryData.items)
        setWarehouseRules(inventoryData.warehouseRules)
        setCategories(inventoryData.categories)

        if (resolvedFactoryId) {
          const [balanceResult, lotBalanceResult] = await Promise.all([
            supabase
              .from("inventory_stock_balances")
              .select("warehouse_id, item_id, on_hand")
              .eq("factory_id", resolvedFactoryId),
            supabase
              .from("inventory_lot_balances")
              .select("warehouse_id, item_id, lot_no, expiry_date, on_hand")
              .eq("factory_id", resolvedFactoryId),
          ])

          if (!balanceResult.error) setBalances((balanceResult.data || []) as BalanceRow[])

          if (!lotBalanceResult.error && (lotBalanceResult.data || []).length > 0) {
            setLotBalances((lotBalanceResult.data || []) as LotBalanceRow[])
          } else if (inventoryData.warning) {
            setLotBalances(fallbackLotBalances)
          }
        }

        const fallbackSource = inventoryData.warehouses[0]?.id || ""
        const fallbackTarget = inventoryData.warehouses[1]?.id || inventoryData.warehouses[0]?.id || ""
        const loadDocumentFromQuery = async () => {
          if (!resolvedFactoryId || (!requestedDocumentId && !requestedCode)) {
            return false
          }

          const loaded = await fetchInventoryDocumentByReference(resolvedFactoryId, "transfer", {
            documentId: requestedDocumentId,
            code: requestedCode,
          })

          if (!loaded) {
            return false
          }

          const sourceWarehouseId =
            loaded.document.source_warehouse_id &&
            inventoryData.warehouses.some((warehouse) => warehouse.id === loaded.document.source_warehouse_id)
              ? loaded.document.source_warehouse_id
              : fallbackSource
          const targetWarehouseId =
            loaded.document.target_warehouse_id &&
            inventoryData.warehouses.some((warehouse) => warehouse.id === loaded.document.target_warehouse_id)
              ? loaded.document.target_warehouse_id
              : fallbackTarget

          const selectedItemIds = Array.from(new Set(loaded.lines.map((line) => line.item_id)))
          setDraft({
            documentId: loaded.document.id,
            documentCode: loaded.document.document_code,
            sourceWarehouseId,
            targetWarehouseId,
            actorName,
            documentDate: loaded.document.document_date,
            note: loaded.document.notes || "",
            selectedItemIds,
            lines: loaded.lines.map((line) => ({
              id: line.id,
              itemId: line.item_id,
              quantity: String(Number(line.quantity || 0)),
              lotNo: line.lot_no || "",
              expiryDate: line.expiry_date || "",
              note: line.line_notes || "",
              image1Url: line.image_urls?.[0] || "",
              image2Url: line.image_urls?.[1] || "",
            })),
          })
          setDocumentStatus(
            loaded.document.status === "posted" ? "posted"
            : loaded.document.status === "cancelled" ? "cancelled"
            : "draft"
          )
          return true
        }

        if (await loadDocumentFromQuery()) {
          return
        }

        const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY)

        if (stored) {
          try {
            const parsed = normalizeDraftState(JSON.parse(stored))
            setDraft({
              ...parsed,
              actorName: parsed.actorName || actorName,
              sourceWarehouseId:
                inventoryData.warehouses.some((warehouse) => warehouse.id === parsed.sourceWarehouseId)
                  ? parsed.sourceWarehouseId
                  : fallbackSource,
              targetWarehouseId:
                inventoryData.warehouses.some((warehouse) => warehouse.id === parsed.targetWarehouseId)
                  ? parsed.targetWarehouseId
                  : fallbackTarget,
            })
            setDocumentStatus(parsed.documentId ? "draft" : null)
          } catch {
            setDraft({
              ...defaultDraft(),
              actorName,
              sourceWarehouseId: fallbackSource,
              targetWarehouseId: fallbackTarget,
            })
          }
        } else {
          setDraft({
            ...defaultDraft(),
            actorName,
            sourceWarehouseId: fallbackSource,
            targetWarehouseId: fallbackTarget,
          })
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

  const sourceWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === draft.sourceWarehouseId) || null,
    [draft.sourceWarehouseId, warehouses],
  )

  const documentCode = useMemo(
    () => draft.documentCode || formatDocCode(sourceWarehouse?.code || "", draft.documentDate),
    [draft.documentCode, draft.documentDate, sourceWarehouse?.code],
  )
  const documentQrPath = draft.documentId ? `/dashboard/inventory/print?type=transfer&code=${encodeURIComponent(documentCode)}` : null

  const balanceMap = useMemo(
    () => new Map(balances.map((row) => [`${row.warehouse_id}:${row.item_id}`, Number(row.on_hand) || 0])),
    [balances],
  )

  const sourceScopedItems = useMemo(() => {
    let scoped = items.filter(
      (item) => !draft.sourceWarehouseId || item.default_warehouse_ids.includes(draft.sourceWarehouseId),
    )
    if (scoped.length === 0) scoped = items
    if (selectedCategoryId) scoped = scoped.filter((item) => item.category_id === selectedCategoryId)
    return scoped
  }, [draft.sourceWarehouseId, items, selectedCategoryId])

  const warehouseScopedCategories = useMemo(() => {
    const base = (() => {
      const scoped = items.filter(
        (item) => !draft.sourceWarehouseId || item.default_warehouse_ids.includes(draft.sourceWarehouseId),
      )
      return scoped.length > 0 ? scoped : items
    })()
    const presentIds = new Set(base.map((item) => item.category_id).filter(Boolean))
    return categories.filter((c) => presentIds.has(c.id))
  }, [categories, draft.sourceWarehouseId, items])

  useEffect(() => {
    if (loading) return

    const allowedIds = new Set(sourceScopedItems.map((item) => item.id))
    const nextSelected = draft.selectedItemIds.filter((itemId) => allowedIds.has(itemId))
    const selectedChanged = nextSelected.join("|") !== draft.selectedItemIds.join("|")

    const keptLines = draft.lines.filter((line) => nextSelected.includes(line.itemId))
    const nextLines = [...keptLines]

    nextSelected.forEach((itemId) => {
      if (!nextLines.some((line) => line.itemId === itemId)) {
        nextLines.push(makeLine(itemId))
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
  }, [draft.lines, draft.selectedItemIds, loading, sourceScopedItems])

  const lineDetails = useMemo<LineDetail[]>(() => {
    return draft.lines.map((line) => {
      const item = items.find((entry) => entry.id === line.itemId) || null
      const quantity = Number(line.quantity) || 0
      const currentStock =
        item && draft.sourceWarehouseId
          ? balanceMap.get(`${draft.sourceWarehouseId}:${item.id}`) ?? item.opening_stock ?? 0
          : item?.opening_stock ?? 0

      const sourceRule =
        item && draft.sourceWarehouseId ? findRule(item.id, draft.sourceWarehouseId, warehouseRules) : null
      const targetRule =
        item && draft.targetWarehouseId ? findRule(item.id, draft.targetWarehouseId, warehouseRules) : null

      const availableLots = item
        ? dedupeLotOptions(
            lotBalances.filter(
              (entry) =>
                entry.warehouse_id === draft.sourceWarehouseId &&
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

      const sourceMin = sourceRule?.min_stock ?? item?.min_stock ?? 0
      const targetMax = targetRule?.max_stock ?? item?.max_stock ?? 0
      const projectedSource = currentStock - quantity
      const projectedTarget = currentStock + quantity

      return {
        line,
        item,
        quantity,
        currentStock,
        currentLotStock,
        projectedSource,
        projectedTarget,
        belowSourceMin: sourceMin > 0 && projectedSource < sourceMin,
        exceedsTargetMax: targetMax > 0 && projectedTarget > targetMax,
        exceedsStock: quantity > currentStock,
        exceedsLotStock: currentLotStock !== null && quantity > currentLotStock,
        missingLot: !!item?.manages_lot && !line.lotNo.trim(),
        missingExpiry: !!item?.manages_expiry && !line.expiryDate,
        sourceMin,
        targetMax,
        availableLots,
      }
    })
  }, [balanceMap, draft.lines, draft.sourceWarehouseId, draft.targetWarehouseId, items, lotBalances, warehouseRules])

  const summary = useMemo(() => {
    const totalQty = lineDetails.reduce((sum, detail) => sum + detail.quantity, 0)
    const warningCount = lineDetails.filter(
      (detail) =>
        detail.exceedsStock ||
        detail.exceedsLotStock ||
        detail.belowSourceMin ||
        detail.exceedsTargetMax ||
        detail.missingLot ||
        detail.missingExpiry,
    ).length
    return { totalQty, warningCount }
  }, [lineDetails])

  const addAnotherLotLine = (itemId: string) => {
    setDraft((prev) => ({
      ...prev,
      lines: [...prev.lines, makeLine(itemId)],
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

  const updateLine = (lineId: string, patch: Partial<TransferLineDraft>) => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    }))
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

  const swapWarehouses = () => {
    setDraft((prev) => ({
      ...prev,
      sourceWarehouseId: prev.targetWarehouseId,
      targetWarehouseId: prev.sourceWarehouseId,
      documentId: null,
      documentCode: "",
      selectedItemIds: [],
      lines: [],
    }))
  }

  const resetDraft = () => {
    const nextDraft = {
      ...defaultDraft(),
      actorName: draft.actorName,
      sourceWarehouseId: warehouses[0]?.id || "",
      targetWarehouseId: warehouses[1]?.id || warehouses[0]?.id || "",
    }
    setDraft(nextDraft)
    setDocumentStatus(null)
    setSaveError(null)
    setSaveSuccess(null)
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(nextDraft))
  }

  const refreshBalances = async (fid: string) => {
    const [balanceResult, lotBalanceResult] = await Promise.all([
      supabase
        .from("inventory_stock_balances")
        .select("warehouse_id, item_id, on_hand")
        .eq("factory_id", fid),
      supabase
        .from("inventory_lot_balances")
        .select("warehouse_id, item_id, lot_no, expiry_date, on_hand")
        .eq("factory_id", fid),
    ])

    if (!balanceResult.error) setBalances((balanceResult.data || []) as BalanceRow[])
    if (!lotBalanceResult.error) setLotBalances((lotBalanceResult.data || []) as LotBalanceRow[])
  }

  const saveTransferDraft = async () => {
    setSaveError(null)
    setSaveSuccess(null)

    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy đang thao tác.")
      return null
    }
    if (!draft.sourceWarehouseId || !draft.targetWarehouseId) {
      setSaveError("Vui lòng chọn đầy đủ kho nguồn và kho đích.")
      return null
    }
    if (draft.sourceWarehouseId === draft.targetWarehouseId) {
      setSaveError("Kho nguồn và kho đích không được trùng nhau.")
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

    const sourceWarehouseRow = warehouses.find((entry) => entry.id === draft.sourceWarehouseId)
    if (!sourceWarehouseRow) {
      setSaveError("Không tìm thấy kho nguồn trong dữ liệu hiện tại.")
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
          .eq("document_type", "transfer")
          .eq("source_warehouse_id", draft.sourceWarehouseId)
          .eq("document_date", draft.documentDate)

        if (countResult.error) throw countResult.error
        nextDocumentCode = formatDocCode(sourceWarehouseRow.code, draft.documentDate, (countResult.count || 0) + 1)
      }

      const documentPayload = {
        factory_id: factoryId,
        document_code: nextDocumentCode,
        document_type: "transfer",
        document_date: draft.documentDate,
        source_warehouse_id: draft.sourceWarehouseId,
        target_warehouse_id: draft.targetWarehouseId,
        source_name: sourceWarehouseRow.name,
        recipient_name: null,
        requester_name: draft.actorName || null,
        created_by: session.user.id,
        status: "draft",
        qr_value: `/dashboard/inventory/transfers?code=${encodeURIComponent(nextDocumentCode)}`,
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
          throw insertResult.error || new Error("Không tạo được phiếu chuyển kho.")
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
        location_code: sourceWarehouseRow.code,
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
      setSaveSuccess(`Đã lưu phiếu chuyển ${nextDocumentCode} ở trạng thái nháp.`)
      return { documentId, documentCode: nextDocumentCode }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không lưu được phiếu chuyển kho.")
      return null
    } finally {
      setSaving(false)
    }
  }

  const postTransferDraft = async () => {
    setSaveError(null)
    setSaveSuccess(null)

    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy đang thao tác.")
      return
    }
    if (documentStatus === "posted") {
      setSaveError("Phiếu chuyển này đã được ghi sổ.")
      return
    }

    const hasBlockingWarning = lineDetails.some(
      (detail) =>
        detail.exceedsStock ||
        detail.exceedsLotStock ||
        detail.missingLot ||
        detail.missingExpiry,
    )
    if (hasBlockingWarning) {
      setSaveError("Phiếu chuyển đang có dòng vượt tồn hoặc thiếu thông tin lô - hạn. Vui lòng xử lý trước khi ghi sổ.")
      return
    }

    let targetDocumentId = draft.documentId
    let targetDocumentCode = draft.documentCode || documentCode

    if (!targetDocumentId) {
      const saved = await saveTransferDraft()
      if (!saved?.documentId) return
      targetDocumentId = saved.documentId
      targetDocumentCode = saved.documentCode
    }

    const session = await getFreshAuthSession()
    if (!session?.user) {
      setSaveError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
      return
    }

    setPosting(true)

    try {
      const postResult = await supabase.rpc("inventory_post_transfer_document", {
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
      setSaveSuccess(`Đã ghi sổ phiếu chuyển ${targetDocumentCode} với ${postedLines} dòng vật tư.`)
      await refreshBalances(factoryId)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không ghi sổ được phiếu chuyển kho.")
    } finally {
      setPosting(false)
    }
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
      setSaveSuccess(`Phiếu chuyển ${draft.documentCode} đã được hủy. Tồn kho đã được hoàn nguyên.`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể hủy phiếu.")
    } finally {
      setCancelling(false)
    }
  }

  return (
    <>
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title="Phiếu chuyển kho"
      description="Chọn kho nguồn, kho đích và nhiều vật tư cùng lúc. Mỗi dòng được hoàn thiện theo số lô và hạn dùng còn tồn ở kho nguồn."
      action={
        <button
          onClick={() => void saveTransferDraft()}
          disabled={saving || posting || loading || documentStatus === "posted"}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700 disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? "Đang lưu..." : draft.documentId ? "Cập nhật phiếu" : "Tạo phiếu chuyển"}
        </button>
      }
    >
      {warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-bold">Đang dùng dữ liệu mẫu</div>
          <div className="mt-1 leading-6">{warning}</div>
        </div>
      ) : null}

      {saveError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="font-bold">Không lưu được phiếu chuyển kho</div>
          <div className="mt-1 leading-6">{saveError}</div>
        </div>
      ) : null}

      {saveSuccess ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <div className="font-bold">Thao tác thành công</div>
          <div className="mt-1 leading-6">{saveSuccess}</div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-4">
        <SummaryBox label="Số dòng" value={String(draft.lines.length)} />
        <SummaryBox label="Tổng số lượng chuyển" value={summary.totalQty.toLocaleString("vi-VN")} tone="text-blue-700" />
        <SummaryBox label="Cảnh báo" value={String(summary.warningCount)} tone="text-amber-600" />
        <SummaryBox
          label="Trạng thái phiếu"
          value={documentStatus === "posted" ? "Đã ghi sổ" : documentStatus === "cancelled" ? "Đã hủy" : draft.documentId ? "Nháp" : "Chưa lưu"}
          tone={documentStatus === "posted" ? "text-emerald-700" : documentStatus === "cancelled" ? "text-red-600" : "text-slate-800"}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Thông tin phiếu</div>
            <h2 className="mt-1 text-xl font-bold text-slate-800">{documentCode}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Khối chọn vật tư được đặt chung với header để thủ kho thao tác liền mạch hơn.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-wrap justify-end gap-2">
              {draft.documentId ? (
                <Link
                  href={`/dashboard/inventory/print?type=transfer&documentId=${encodeURIComponent(draft.documentId)}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700"
                >
                  <Printer size={16} />
                  In phiếu
                </Link>
              ) : null}
              <button
                onClick={resetDraft}
                className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                Làm mới
              </button>
              {documentStatus !== "posted" && documentStatus !== "cancelled" ? (
                <button
                  onClick={() => void postTransferDraft()}
                  disabled={saving || posting || loading}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                >
                  {posting ? "Đang ghi sổ..." : "Ghi sổ chuyển kho"}
                </button>
              ) : null}
              {documentStatus === "posted" && hasPermission(currentUser, "inventory.cancel") ? (
                <button
                  onClick={() => setCancelModal(true)}
                  className="rounded-xl border border-red-200 bg-red-50 px-5 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-100"
                >
                  <Ban size={14} className="mr-1.5 inline" />
                  Hủy phiếu
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
            <InventoryQrCard
              title="QR phiếu chuyển"
              caption="Quét để mở nhanh phiếu chuyển theo mã."
              hrefPath={documentQrPath}
              valueText={documentCode}
              compact
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600">Kho nguồn *</label>
            <select
              value={draft.sourceWarehouseId}
              onChange={(e) => {
                setDraft((prev) => ({
                  ...prev,
                  sourceWarehouseId: e.target.value,
                  documentId: null,
                  documentCode: "",
                  selectedItemIds: [],
                  lines: [],
                }))
                setSelectedCategoryId("")
              }}
              className={INPUT_CLASS}
            >
              <option value="">Chọn kho nguồn</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} - {warehouse.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600">Kho đích *</label>
            <div className="flex items-center gap-2">
              <select
                value={draft.targetWarehouseId}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    targetWarehouseId: e.target.value,
                    documentId: null,
                    documentCode: "",
                  }))
                }
                className={INPUT_CLASS}
              >
                <option value="">Chọn kho đích</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} - {warehouse.name}
                  </option>
                ))}
              </select>
              <button
                onClick={swapWarehouses}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-600 transition-colors hover:bg-slate-100"
              >
                <ArrowRightLeft size={18} />
              </button>
            </div>
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

          {draft.sourceWarehouseId && warehouseScopedCategories.length >= 2 ? (
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">Phân loại vật tư</label>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">Tất cả phân loại</option>
                {warehouseScopedCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="xl:col-span-2">
            <label className="mb-2 block text-xs font-bold text-slate-600">Danh sách vật tư theo kho đã chọn</label>
            {!draft.sourceWarehouseId ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Vui lòng chọn kho nguồn trước khi chọn vật tư.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sourceScopedItems.map((item) => {
                  const selected = draft.selectedItemIds.includes(item.id)
                  const totalStock = warehouses.reduce(
                    (sum, w) => sum + (balanceMap.get(`${w.id}:${item.id}`) ?? 0), 0,
                  )
                  const warehouseStocks = warehouses
                    .map((w) => ({ code: w.code, stock: balanceMap.get(`${w.id}:${item.id}`) ?? 0 }))
                    .filter((w) => w.stock > 0)

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleSelectedItem(item.id)}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        selected
                          ? "border-emerald-500 bg-emerald-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800">{item.code}</div>
                          <div className="mt-1 text-sm text-slate-600">{item.name}</div>
                          <div className="mt-2 text-xs text-slate-500">
                            Tổng tồn: {totalStock.toLocaleString("vi-VN")} {item.unit}
                          </div>
                          {warehouseStocks.length > 1 &&
                            warehouseStocks.map((w) => (
                              <div key={w.code} className="text-xs text-slate-400">
                                {w.code}: {w.stock.toLocaleString("vi-VN")} {item.unit}
                              </div>
                            ))}
                        </div>
                        <div
                          className={`shrink-0 rounded-full p-1.5 ${
                            selected ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"
                          }`}
                        >
                          <Check size={14} />
                        </div>
                      </div>
                    </button>
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
              placeholder="Lý do điều chuyển, bộ phận yêu cầu, lưu ý giao nhận..."
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="border-b border-slate-200 pb-4">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Dòng vật tư</div>
          <h2 className="mt-1 text-lg font-bold text-slate-800">Danh sách vật tư điều chuyển</h2>
        </div>

        {draft.lines.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Chọn vật tư ở phần trên để tự sinh các dòng điều chuyển.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {lineDetails.map((detail, index) => {
              const expiryOptions = [
                ...new Set(detail.availableLots.map((entry) => entry.expiryDate).filter(Boolean)),
              ] as string[]

              return (
                <div key={detail.line.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-800">
                        {getLineTypeLabel(detail.item, index, lineDetails.map((d) => d.item))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {detail.item ? (
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

                  <div className="grid gap-4 md:grid-cols-2">
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
                        <AlertPill tone="blue">Tồn kho nguồn: {detail.currentStock.toLocaleString("vi-VN")}</AlertPill>
                        {detail.currentLotStock !== null ? (
                          <AlertPill tone="blue">Tồn lô: {detail.currentLotStock.toLocaleString("vi-VN")}</AlertPill>
                        ) : null}
                        <AlertPill tone="blue">Sau chuyển kho nguồn: {detail.projectedSource.toLocaleString("vi-VN")}</AlertPill>
                        <AlertPill tone="blue">Sau nhập kho đích: {detail.projectedTarget.toLocaleString("vi-VN")}</AlertPill>
                        {detail.exceedsStock ? <AlertPill tone="red">Vượt tồn kho nguồn</AlertPill> : null}
                        {detail.exceedsLotStock ? <AlertPill tone="red">Vượt tồn lô</AlertPill> : null}
                        {detail.belowSourceMin ? <AlertPill>Dưới min kho nguồn</AlertPill> : null}
                        {detail.exceedsTargetMax ? <AlertPill>Dư trên max kho đích</AlertPill> : null}
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

                    <div>
                      <InventoryImageUpload
                        factoryId={factoryId}
                        documentType="transfer"
                        label="Hình ảnh 1"
                        value={detail.line.image1Url}
                        onChange={(url) => updateLine(detail.line.id, { image1Url: url })}
                      />
                    </div>

                    <div>
                      <InventoryImageUpload
                        factoryId={factoryId}
                        documentType="transfer"
                        label="Hình ảnh 2"
                        value={detail.line.image2Url}
                        onChange={(url) => updateLine(detail.line.id, { image2Url: url })}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Ghi chú</label>
                      <textarea
                        value={detail.line.note}
                        onChange={(e) => updateLine(detail.line.id, { note: e.target.value })}
                        rows={3}
                        placeholder="Ghi chú riêng cho dòng điều chuyển này"
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {detail.missingLot ? (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        <span>Vật tư này bắt buộc chọn số lô từ phần tồn lô còn hàng của kho nguồn.</span>
                      </div>
                    ) : null}
                    {detail.missingExpiry ? (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        <span>Hạn sử dụng phải khớp đúng với số lô đã chọn.</span>
                      </div>
                    ) : null}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                      {detail.availableLots.length > 0
                        ? `Lô còn tồn: ${detail.availableLots
                            .map((entry) =>
                              `${entry.lotNo}${entry.expiryDate ? ` - ${new Date(entry.expiryDate).toLocaleDateString("vi-VN")}` : ""} (${entry.onHand.toLocaleString("vi-VN")})`,
                            )
                            .join(", ")}`
                        : "Chưa có dữ liệu lô còn tồn cho vật tư này trong kho nguồn."}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </InventoryPageShell>

    {cancelModal ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-600">
              <Ban size={18} />
              <h3 className="text-base font-bold">Hủy phiếu chuyển kho</h3>
            </div>
            <button onClick={() => { setCancelModal(false); setCancelReason("") }} className="text-slate-400 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>
          <p className="mb-3 text-sm text-slate-600">
            Hủy phiếu sẽ <strong>đảo ngược chuyển kho</strong> đã ghi sổ. Thao tác này không thể hoàn tác.
          </p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Lý do hủy phiếu (bắt buộc)..."
            rows={3}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-400"
          />
          <div className="mt-4 flex justify-end gap-2">
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
          </div>
        </div>
      </div>
    ) : null}
    </>
  )
}
