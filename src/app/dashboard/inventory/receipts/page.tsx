"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, Ban, Check, CopyPlus, Printer, Save, Trash2, X } from "lucide-react"
import { getFreshAuthSession, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { InventoryPageShell } from "../_components/inventory-shell"
import { InventoryImageUpload } from "../_components/inventory-image-upload"
import { fetchInventoryDocumentByReference } from "../_components/inventory-document-loader"
import { InventoryQrCard } from "../_components/inventory-qr-card"
import { getStockContextLabel } from "../_components/inventory-stock"
import { AddItemButton, CompactItemSelectorCard, MultiSelectField } from "../_components/inventory-ui"
import {
  getLineTypeLabel,
  loadInventoryAdminData,
  type InventoryCategoryOption,
  type InventoryItemOption,
  type InventoryWarehouseOption,
  type InventoryWarehouseRule,
} from "../_components/inventory-data"

type ReceiptLineDraft = {
  id: string
  itemId: string
  quantity: string
  lotNo: string
  expiryDate: string
  note: string
  image1Url: string
  image2Url: string
}

type DraftState = {
  documentId: string | null
  documentCode: string
  warehouseId: string
  sourceName: string
  actorName: string
  documentDate: string
  note: string
  selectedItemIds: string[]
  lines: ReceiptLineDraft[]
}

type PersistableLine = {
  item: InventoryItemOption
  quantity: number
  lotNo: string | null
  expiryDate: string | null
  note: string | null
  imageUrls: string[]
}

type LineDetail = {
  line: ReceiptLineDraft
  item: InventoryItemOption | null
  quantity: number
  minStock: number
  maxStock: number
  currentStock: number
  projectedStock: number
  exceedsMax: boolean
  belowMin: boolean
  missingLot: boolean
  missingExpiry: boolean
}

type QuickModalType = "category" | "item" | null

type QuickCategoryForm = {
  code: string
  name: string
  sort_order: string
  is_active: boolean
}

type QuickItemForm = {
  category_id: string
  code: string
  name: string
  unit: string
  specification: string
  min_stock: string
  max_stock: string
  manages_lot: boolean
  manages_expiry: boolean
  is_active: boolean
}

const DRAFT_STORAGE_KEY = "inventory-receipt-draft-v5"
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function makeLine(itemId = ""): ReceiptLineDraft {
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

function defaultDraft(): DraftState {
  return {
    documentId: null,
    documentCode: "",
    warehouseId: "",
    sourceName: "",
    actorName: "",
    documentDate: todayIso(),
    note: "",
    selectedItemIds: [],
    lines: [],
  }
}

function emptyQuickCategoryForm(nextSortOrder = 0): QuickCategoryForm {
  return {
    code: "",
    name: "",
    sort_order: String(nextSortOrder),
    is_active: true,
  }
}

function emptyQuickItemForm(categoryId = ""): QuickItemForm {
  return {
    category_id: categoryId,
    code: "",
    name: "",
    unit: "",
    specification: "",
    min_stock: "0",
    max_stock: "0",
    manages_lot: false,
    manages_expiry: false,
    is_active: true,
  }
}

function normalizeDraftState(value: unknown): DraftState {
  const base = defaultDraft()
  if (!value || typeof value !== "object") return base

  const raw = value as Partial<DraftState>
  const lines = Array.isArray(raw.lines)
    ? raw.lines
        .map((line) => {
          if (!line || typeof line !== "object") return null
          const entry = line as Partial<ReceiptLineDraft>
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
        .filter((line): line is ReceiptLineDraft => Boolean(line))
    : []

  return {
    documentId: typeof raw.documentId === "string" ? raw.documentId : null,
    documentCode: typeof raw.documentCode === "string" ? raw.documentCode : "",
    warehouseId: typeof raw.warehouseId === "string" ? raw.warehouseId : "",
    sourceName: typeof raw.sourceName === "string" ? raw.sourceName : "",
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
  if (!warehouseCode || !date) return "N-____-DDMMYY/001"
  const [yyyy, mm, dd] = date.split("-")
  return `N-${warehouseCode}-${dd}${mm}${yyyy.slice(2)}/${String(Math.max(sequence, 1)).padStart(3, "0")}`
}

function findRule(itemId: string, warehouseId: string, rules: InventoryWarehouseRule[]) {
  return rules.find((rule) => rule.item_id === itemId && rule.warehouse_id === warehouseId) || null
}

function buildPersistableLines(lines: ReceiptLineDraft[], items: InventoryItemOption[]) {
  const persisted: PersistableLine[] = []

  for (const line of lines) {
    const item = items.find((entry) => entry.id === line.itemId)
    if (!item) continue

    const quantity = Number(line.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { lines: [] as PersistableLine[], error: `Vui lòng nhập số lượng hợp lệ cho vật tư ${item.code}.` }
    }
    if (item.manages_lot && !line.lotNo.trim()) {
      return { lines: [] as PersistableLine[], error: `Vật tư ${item.code} bắt buộc nhập số lô.` }
    }
    if (item.manages_expiry && !line.expiryDate) {
      return { lines: [] as PersistableLine[], error: `Vật tư ${item.code} bắt buộc nhập hạn sử dụng.` }
    }

    persisted.push({
      item,
      quantity,
      lotNo: line.lotNo.trim() || null,
      expiryDate: line.expiryDate || null,
      note: line.note.trim() || null,
      imageUrls: [line.image1Url, line.image2Url].filter(Boolean),
    })
  }

  if (persisted.length === 0) {
    return { lines: [] as PersistableLine[], error: "Cần ít nhất 1 dòng hợp lệ để lưu phiếu." }
  }

  return { lines: persisted, error: null }
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

export default function InventoryReceiptsPage() {
  const searchParams = useSearchParams()
  const requestedDocumentId = searchParams.get("documentId")
  const requestedCode = searchParams.get("code")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveErrorTitle, setSaveErrorTitle] = useState("Có lỗi xảy ra")
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [documentStatus, setDocumentStatus] = useState<"draft" | "posted" | "cancelled" | null>(null)
  const [postedInfo, setPostedInfo] = useState<{ at: string; byName: string } | null>(null)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [cancelModal, setCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelling, setCancelling] = useState(false)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [items, setItems] = useState<InventoryItemOption[]>([])
  const [warehouseRules, setWarehouseRules] = useState<InventoryWarehouseRule[]>([])
  const [balances, setBalances] = useState<{ warehouse_id: string; item_id: string; on_hand: number }[]>([])
  const [categories, setCategories] = useState<InventoryCategoryOption[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [sourceSuggestions, setSourceSuggestions] = useState<string[]>([])
  const [draft, setDraft] = useState<DraftState>(defaultDraft())
  const [quickModal, setQuickModal] = useState<QuickModalType>(null)
  const [quickSaving, setQuickSaving] = useState(false)
  const [quickFormError, setQuickFormError] = useState<string | null>(null)
  const [quickCategoryForm, setQuickCategoryForm] = useState<QuickCategoryForm>(() =>
    emptyQuickCategoryForm(),
  )
  const [quickItemForm, setQuickItemForm] = useState<QuickItemForm>(() => emptyQuickItemForm())

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      try {
        const inventoryData = await loadInventoryAdminData()
        const activeSession = await hydrateActiveSession().catch(() => ({ user: null }))
        const actorName = activeSession.user?.full_name || activeSession.user?.username || ""
        if (activeSession.user) setCurrentUser(activeSession.user)
        const fallbackWarehouseId = inventoryData.warehouses[0]?.id || ""

        setWarning(inventoryData.warning)
        setFactoryId(inventoryData.factoryId)
        setWarehouses(inventoryData.warehouses)
        setItems(inventoryData.items)
        setWarehouseRules(inventoryData.warehouseRules)
        setCategories(inventoryData.categories)

        if (inventoryData.factoryId) {
          const balanceResult = await supabase
            .from("inventory_stock_balances")
            .select("warehouse_id, item_id, on_hand")
            .eq("factory_id", inventoryData.factoryId)
          if (!balanceResult.error) {
            setBalances((balanceResult.data || []) as { warehouse_id: string; item_id: string; on_hand: number }[])
          }
        }

        const loadDocumentFromQuery = async () => {
          if (!inventoryData.factoryId || (!requestedDocumentId && !requestedCode)) {
            return false
          }

          const loaded = await fetchInventoryDocumentByReference(inventoryData.factoryId, "import", {
            documentId: requestedDocumentId,
            code: requestedCode,
          })

          if (!loaded) {
            return false
          }

          const nextWarehouseId =
            loaded.document.target_warehouse_id &&
            inventoryData.warehouses.some((warehouse) => warehouse.id === loaded.document.target_warehouse_id)
              ? loaded.document.target_warehouse_id
              : fallbackWarehouseId

          const selectedItemIds = Array.from(new Set(loaded.lines.map((line) => line.item_id)))
          setDraft({
            documentId: loaded.document.id,
            documentCode: loaded.document.document_code,
            warehouseId: nextWarehouseId,
            sourceName: loaded.document.source_name || "",
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
            const nextWarehouseId = inventoryData.warehouses.some((warehouse) => warehouse.id === parsed.warehouseId)
              ? parsed.warehouseId
              : fallbackWarehouseId
            setDraft({
              ...parsed,
              warehouseId: nextWarehouseId,
              actorName: parsed.actorName || actorName,
            })
            setDocumentStatus(parsed.documentId ? "draft" : null)
          } catch {
            setDraft({
              ...defaultDraft(),
              warehouseId: fallbackWarehouseId,
              actorName,
            })
            setDocumentStatus(null)
          }
        } else {
          setDraft({
            ...defaultDraft(),
            warehouseId: fallbackWarehouseId,
            actorName,
          })
          setDocumentStatus(null)
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

  useEffect(() => {
    const loadSourceSuggestions = async () => {
      if (!factoryId) {
        setSourceSuggestions([])
        return
      }

      const { data, error } = await supabase
        .from("inventory_documents")
        .select("source_name")
        .eq("factory_id", factoryId)
        .eq("document_type", "import")
        .not("source_name", "is", null)
        .order("document_date", { ascending: false })
        .limit(100)

      if (error || !data) {
        setSourceSuggestions([])
        return
      }

      setSourceSuggestions(
        Array.from(
          new Set(
            data
              .map((row) => row.source_name?.trim() || "")
              .filter(Boolean),
          ),
        ),
      )
    }

    void loadSourceSuggestions()
  }, [factoryId])

  const selectedWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === draft.warehouseId) || null,
    [draft.warehouseId, warehouses],
  )

  const documentCode = useMemo(
    () => draft.documentCode || formatDocCode(selectedWarehouse?.code || "", draft.documentDate),
    [draft.documentCode, draft.documentDate, selectedWarehouse?.code],
  )
  const documentQrPath = draft.documentId ? `/dashboard/inventory/print?type=import&documentId=${encodeURIComponent(draft.documentId)}` : null

  const balanceMap = useMemo(
    () => new Map(balances.map((row) => [`${row.warehouse_id}:${row.item_id}`, Number(row.on_hand) || 0])),
    [balances],
  )

  const warehouseScopedItems = useMemo(() => {
    let scoped = items.filter((item) => !draft.warehouseId || item.default_warehouse_ids.includes(draft.warehouseId))
    if (scoped.length === 0) scoped = items
    if (selectedCategoryIds.length > 0) {
      scoped = scoped.filter((item) => selectedCategoryIds.includes(item.category_id || ""))
    }
    return scoped
  }, [draft.warehouseId, items, selectedCategoryIds])

  const visibleItemCards = useMemo(() => {
    if (draft.selectedItemIds.length === 0) return warehouseScopedItems
    return warehouseScopedItems.filter((item) => draft.selectedItemIds.includes(item.id))
  }, [draft.selectedItemIds, warehouseScopedItems])

  const warehouseScopedCategories = useMemo(() => {
    const base = (() => {
      const scoped = items.filter(
        (item) => !draft.warehouseId || item.default_warehouse_ids.includes(draft.warehouseId),
      )
      return scoped.length > 0 ? scoped : items
    })()
    const presentIds = new Set(base.map((item) => item.category_id).filter(Boolean))
    return categories.filter((c) => presentIds.has(c.id))
  }, [categories, draft.warehouseId, items])

  useEffect(() => {
    if (loading) return

    const allowedIds = new Set(warehouseScopedItems.map((item) => item.id))
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
  }, [draft.lines, draft.selectedItemIds, loading, warehouseScopedItems])

  const lineDetails = useMemo<LineDetail[]>(() => {
    return draft.lines.map((line) => {
      const item = items.find((entry) => entry.id === line.itemId) || null
      const quantity = Number(line.quantity) || 0
      const rule = item && draft.warehouseId ? findRule(item.id, draft.warehouseId, warehouseRules) : null
      const minStock = rule?.min_stock ?? item?.min_stock ?? 0
      const maxStock = rule?.max_stock ?? item?.max_stock ?? 0
      const currentStock =
        item && draft.warehouseId
          ? (balanceMap.get(`${draft.warehouseId}:${item.id}`) ?? 0)
          : 0
      const projectedStock = currentStock + quantity

      return {
        line,
        item,
        quantity,
        minStock,
        maxStock,
        currentStock,
        projectedStock,
        exceedsMax: maxStock > 0 && projectedStock > maxStock,
        belowMin: minStock > 0 && projectedStock < minStock,
        missingLot: !!item?.manages_lot && !line.lotNo.trim(),
        missingExpiry: !!item?.manages_expiry && !line.expiryDate,
      }
    })
  }, [balanceMap, draft.lines, draft.warehouseId, items, warehouseRules])

  const summary = useMemo(() => {
    const totalQty = lineDetails.reduce((sum, detail) => sum + detail.quantity, 0)
    const warningCount = lineDetails.filter(
      (detail) => detail.exceedsMax || detail.belowMin || detail.missingLot || detail.missingExpiry,
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

  const createCategory = async () => {
    openQuickCategoryModal()
    const shouldUseLegacyPrompt = false
    if (!shouldUseLegacyPrompt) return

    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy để thêm phân loại vật tư.")
      return
    }

    const code = window.prompt("Nhập mã phân loại vật tư mới")?.trim().toUpperCase() || ""
    if (!code) return
    const name = window.prompt("Nhập tên phân loại vật tư mới")?.trim() || ""
    if (!name) return

    const { data, error } = await supabase
      .from("inventory_item_categories")
      .insert({
        factory_id: factoryId,
        code,
        name,
        sort_order: categories.length + 1,
        is_active: true,
      })
      .select("id, code, name")
      .single()

    if (error || !data) {
      setSaveError(error?.message || "Không thể thêm phân loại vật tư mới.")
      return
    }

    const nextCategory = data as InventoryCategoryOption
    setCategories((prev) => [...prev, nextCategory].sort((a, b) => a.name.localeCompare(b.name, "vi")))
    setSelectedCategoryIds((prev) => (prev.includes(nextCategory.id) ? prev : [...prev, nextCategory.id]))
    setSaveSuccess(`Đã thêm phân loại vật tư ${nextCategory.code}.`)
  }

  const createItem = async () => {
    openQuickItemModal()
    const shouldUseLegacyPrompt = false
    if (!shouldUseLegacyPrompt) return

    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy để thêm mã vật tư.")
      return
    }
    if (!draft.warehouseId) {
      setSaveError("Vui lòng chọn kho nhập trước khi thêm mã vật tư.")
      return
    }
    if (selectedCategoryIds.length !== 1) {
      setSaveError("Vui lòng chọn đúng 1 phân loại vật tư trước khi thêm mã mới.")
      return
    }

    const code = window.prompt("Nhập mã vật tư mới")?.trim().toUpperCase() || ""
    if (!code) return
    const name = window.prompt("Nhập tên vật tư mới")?.trim() || ""
    if (!name) return
    const unit = window.prompt("Nhập đơn vị tính", "kg")?.trim() || ""
    if (!unit) return

    const categoryId = selectedCategoryIds[0]

    const { data, error } = await supabase
      .from("inventory_items")
      .insert({
        factory_id: factoryId,
        category_id: categoryId,
        code,
        name,
        unit,
        default_warehouse_ids: [draft.warehouseId],
        manages_lot: false,
        manages_expiry: false,
        min_stock: 0,
        max_stock: 0,
        opening_stock: 0,
        uses_shared_oil_stock: false,
        is_active: true,
      })
      .select("id, code, name, unit, specification, manages_lot, manages_expiry, min_stock, max_stock, opening_stock, category_id, default_warehouse_ids, uses_shared_oil_stock, is_active")
      .single()

    if (error || !data) {
      setSaveError(error?.message || "Không thể thêm mã vật tư mới.")
      return
    }

    const category = categories.find((entry) => entry.id === categoryId)
    const nextItem = {
      ...(data as Omit<InventoryItemOption, "category_name" | "warehouse_codes">),
      category_name: category?.name || "Chưa phân loại",
      warehouse_codes: warehouses.filter((warehouse) => warehouse.id === draft.warehouseId).map((warehouse) => warehouse.code),
    } satisfies InventoryItemOption

    setItems((prev) => [...prev, nextItem].sort((a, b) => a.code.localeCompare(b.code, "vi")))
    setDraft((prev) => ({
      ...prev,
      selectedItemIds: prev.selectedItemIds.includes(nextItem.id) ? prev.selectedItemIds : [...prev.selectedItemIds, nextItem.id],
    }))
    setSaveSuccess(`Đã thêm mã vật tư ${nextItem.code}.`)
  }

  const closeQuickModal = () => {
    setQuickModal(null)
    setQuickFormError(null)
    setQuickSaving(false)
  }

  const openQuickCategoryModal = () => {
    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy để thêm phân loại vật tư.")
      return
    }

    setQuickFormError(null)
    setQuickCategoryForm(emptyQuickCategoryForm(categories.length + 1))
    setQuickModal("category")
  }

  const openQuickItemModal = () => {
    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy để thêm mã vật tư.")
      return
    }
    if (!draft.warehouseId) {
      setSaveError("Vui lòng chọn kho nhập trước khi thêm mã vật tư.")
      return
    }
    if (selectedCategoryIds.length !== 1) {
      setSaveError("Vui lòng chọn đúng 1 phân loại vật tư trước khi thêm mã mới.")
      return
    }

    setQuickFormError(null)
    setQuickItemForm(emptyQuickItemForm(selectedCategoryIds[0]))
    setQuickModal("item")
  }

  const saveQuickCategory = async () => {
    if (!factoryId) {
      setQuickFormError("Chưa xác định được nhà máy.")
      return
    }
    if (!quickCategoryForm.code.trim()) {
      setQuickFormError("Mã phân loại vật tư không được để trống.")
      return
    }
    if (!quickCategoryForm.name.trim()) {
      setQuickFormError("Tên phân loại vật tư không được để trống.")
      return
    }

    setQuickSaving(true)
    setQuickFormError(null)
    try {
      const { data, error } = await supabase
        .from("inventory_item_categories")
        .insert({
          factory_id: factoryId,
          code: quickCategoryForm.code.trim().toUpperCase(),
          name: quickCategoryForm.name.trim(),
          sort_order: Number(quickCategoryForm.sort_order) || 0,
          is_active: quickCategoryForm.is_active,
        })
        .select("id, code, name")
        .single()

      if (error || !data) {
        setQuickFormError(error?.message || "Không thể thêm phân loại vật tư mới.")
        return
      }

      const nextCategory = data as InventoryCategoryOption
      setCategories((prev) => [...prev, nextCategory].sort((a, b) => a.name.localeCompare(b.name, "vi")))
      setSelectedCategoryIds([nextCategory.id])
      setSaveSuccess(`Đã thêm phân loại vật tư ${nextCategory.code}.`)
      closeQuickModal()
    } finally {
      setQuickSaving(false)
    }
  }

  const saveQuickItem = async () => {
    if (!factoryId) {
      setQuickFormError("Chưa xác định được nhà máy.")
      return
    }
    if (!draft.warehouseId) {
      setQuickFormError("Vui lòng chọn kho nhập trước khi thêm mã vật tư.")
      return
    }
    if (!quickItemForm.category_id) {
      setQuickFormError("Vui lòng chọn phân loại vật tư.")
      return
    }
    if (!quickItemForm.code.trim()) {
      setQuickFormError("Mã vật tư không được để trống.")
      return
    }
    if (!quickItemForm.name.trim()) {
      setQuickFormError("Tên vật tư không được để trống.")
      return
    }
    if (!quickItemForm.unit.trim()) {
      setQuickFormError("Đơn vị tính không được để trống.")
      return
    }

    setQuickSaving(true)
    setQuickFormError(null)
    try {
      const payload = {
        factory_id: factoryId,
        category_id: quickItemForm.category_id,
        code: quickItemForm.code.trim().toUpperCase(),
        name: quickItemForm.name.trim(),
        unit: quickItemForm.unit.trim(),
        specification: quickItemForm.specification.trim() || null,
        default_warehouse_ids: [draft.warehouseId],
        manages_lot: quickItemForm.manages_lot,
        manages_expiry: quickItemForm.manages_expiry,
        min_stock: Number(quickItemForm.min_stock) || 0,
        max_stock: Number(quickItemForm.max_stock) || 0,
        opening_stock: 0,
        uses_shared_oil_stock: false,
        is_active: quickItemForm.is_active,
      }

      const { data, error } = await supabase
        .from("inventory_items")
        .insert(payload)
        .select("id, code, name, unit, specification, manages_lot, manages_expiry, min_stock, max_stock, opening_stock, category_id, default_warehouse_ids, uses_shared_oil_stock, is_active")
        .single()

      if (error || !data) {
        setQuickFormError(error?.message || "Không thể thêm mã vật tư mới.")
        return
      }

      const rulesResult = await supabase.from("inventory_item_warehouse_rules").insert({
        factory_id: factoryId,
        item_id: data.id as string,
        warehouse_id: draft.warehouseId,
        min_stock: Number(quickItemForm.min_stock) || 0,
        max_stock: Number(quickItemForm.max_stock) || 0,
        reorder_point: Number(quickItemForm.min_stock) || 0,
        safety_stock: Number(quickItemForm.min_stock) || 0,
        is_primary: true,
      })

      if (rulesResult.error) {
        setQuickFormError(rulesResult.error.message)
        return
      }

      const category = categories.find((entry) => entry.id === quickItemForm.category_id)
      const nextItem = {
        ...(data as Omit<InventoryItemOption, "category_name" | "warehouse_codes">),
        category_name: category?.name || "Chưa phân loại",
        warehouse_codes: warehouses
          .filter((warehouse) => warehouse.id === draft.warehouseId)
          .map((warehouse) => warehouse.code),
      } satisfies InventoryItemOption

      setItems((prev) => [...prev, nextItem].sort((a, b) => a.code.localeCompare(b.code, "vi")))
      setWarehouseRules((prev) => [
        ...prev,
        {
          item_id: nextItem.id,
          warehouse_id: draft.warehouseId,
          min_stock: Number(quickItemForm.min_stock) || 0,
          max_stock: Number(quickItemForm.max_stock) || 0,
          reorder_point: Number(quickItemForm.min_stock) || 0,
          safety_stock: Number(quickItemForm.min_stock) || 0,
          is_primary: true,
        },
      ])
      setDraft((prev) => ({
        ...prev,
        selectedItemIds: prev.selectedItemIds.includes(nextItem.id)
          ? prev.selectedItemIds
          : [...prev.selectedItemIds, nextItem.id],
      }))
      setSaveSuccess(`Đã thêm mã vật tư ${nextItem.code}.`)
      closeQuickModal()
    } finally {
      setQuickSaving(false)
    }
  }

  const updateLine = (lineId: string, patch: Partial<ReceiptLineDraft>) => {
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

  const resetDraft = () => {
    const nextDraft = {
      ...defaultDraft(),
      warehouseId: warehouses[0]?.id || "",
      actorName: draft.actorName,
    }
    setDraft(nextDraft)
    setDocumentStatus(null)
    setSaveError(null)
    setSaveSuccess(null)
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(nextDraft))
  }

  const saveReceiptDraft = async () => {
    setSaveError(null)
    setSaveSuccess(null)

    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy đang thao tác.")
      return null
    }
    if (!draft.warehouseId) {
      setSaveError("Vui lòng chọn kho nhập.")
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

    const warehouse = warehouses.find((entry) => entry.id === draft.warehouseId)
    if (!warehouse) {
      setSaveError("Không tìm thấy kho nhập trong dữ liệu hiện tại.")
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
          .eq("document_type", "import")
          .eq("target_warehouse_id", draft.warehouseId)
          .eq("document_date", draft.documentDate)

        if (countResult.error) throw countResult.error
        nextDocumentCode = formatDocCode(warehouse.code, draft.documentDate, (countResult.count || 0) + 1)
      }

      const documentPayload = {
        factory_id: factoryId,
        document_code: nextDocumentCode,
        document_type: "import",
        document_date: draft.documentDate,
        source_warehouse_id: null,
        target_warehouse_id: draft.warehouseId,
        source_name: draft.sourceName.trim() || null,
        recipient_name: draft.actorName || null,
        requester_name: draft.actorName || null,
        created_by: session.user.id,
        status: "draft",
        qr_value: `/dashboard/inventory/print?type=import&code=${encodeURIComponent(nextDocumentCode)}`,
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
          throw insertResult.error || new Error("Không tạo được phiếu nhập.")
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
      setSaveSuccess(`Đã lưu phiếu nhập ${nextDocumentCode} ở trạng thái nháp.`)
      return { documentId, documentCode: nextDocumentCode }
    } catch (error) {
      setSaveErrorTitle("Không lưu được phiếu nhập")
      setSaveError(error instanceof Error ? error.message : "Không lưu được phiếu nhập.")
      return null
    } finally {
      setSaving(false)
    }
  }

  const postReceiptDraft = async () => {
    setSaveError(null)
    setSaveSuccess(null)

    if (!factoryId) {
      setSaveError("Chưa xác định được nhà máy đang thao tác.")
      return
    }
    if (documentStatus === "posted") {
      setSaveError("Phiếu nhập này đã được ghi sổ.")
      return
    }

    let targetDocumentId = draft.documentId
    let targetDocumentCode = draft.documentCode || documentCode

    if (!targetDocumentId) {
      const saved = await saveReceiptDraft()
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
      const postResult = await supabase.rpc("inventory_post_import_document", {
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
      setSaveSuccess(`Đã ghi sổ phiếu nhập ${targetDocumentCode} với ${postedLines} dòng vật tư.`)
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : (error as { message?: string })?.message || "Không ghi sổ được phiếu nhập."
      setSaveErrorTitle("Không ghi sổ được phiếu nhập")
      setSaveError(msg)
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
      setSaveSuccess(`Phiếu nhập ${draft.documentCode} đã được hủy. Tồn kho đã được hoàn nguyên.`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể hủy phiếu.")
    } finally {
      setCancelling(false)
    }
  }

  const canSave = !!draft.warehouseId && draft.lines.length > 0

  return (
    <>
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title="Phiếu nhập kho"
      description="Chọn kho, chọn nhiều vật tư theo kho và hoàn thiện số lượng, lô, hạn dùng ngay trên từng dòng nhập."
    >
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

      <div className="grid gap-4 xl:grid-cols-4">
        <SummaryBox label="Tổng số dòng" value={String(draft.lines.length)} />
        <SummaryBox label="Tổng số lượng nhập" value={summary.totalQty.toLocaleString("vi-VN")} tone="text-emerald-700" />
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
              Chọn kho trước, sau đó chọn nhiều vật tư. Các dòng nhập sẽ tự sinh ngay bên dưới.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-wrap justify-end gap-2">
              {draft.documentId ? (
                <Link
                  href={`/dashboard/inventory/print?type=import&documentId=${encodeURIComponent(draft.documentId)}`}
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
                <>
                  <button
                    onClick={() => void saveReceiptDraft()}
                    disabled={!canSave || saving || posting || loading}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Save size={14} />
                    {saving ? "Đang lưu..." : draft.documentId ? "Sửa phiếu" : "Lưu nháp"}
                  </button>
                  <button
                    onClick={() => void postReceiptDraft()}
                    disabled={saving || posting || loading}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {posting ? "Đang ghi sổ..." : "Ghi sổ nhập kho"}
                  </button>
                </>
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
              title="QR phiếu nhập"
              caption="Quét để mở nhanh phiếu nhập theo mã."
              hrefPath={documentQrPath}
              valueText={documentCode}
              compact
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600">Kho nhập *</label>
            <select
              value={draft.warehouseId}
              onChange={(e) => {
                setDraft((prev) => ({
                  ...prev,
                  warehouseId: e.target.value,
                  documentId: null,
                  documentCode: "",
                  selectedItemIds: [],
                  lines: [],
                }))
                setSelectedCategoryIds([])
              }}
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
            <label className="mb-1.5 block text-xs font-bold text-slate-600">Nguồn nhập</label>
            <input
              list="inventory-receipt-source-suggestions"
              value={draft.sourceName}
              onChange={(e) => setDraft((prev) => ({ ...prev, sourceName: e.target.value }))}
              placeholder="Nhà cung cấp / bộ phận giao"
              className={INPUT_CLASS}
            />
            <datalist id="inventory-receipt-source-suggestions">
              {sourceSuggestions.map((source) => (
                <option key={source} value={source} />
              ))}
            </datalist>
          </div>

          <div className="relative z-30 xl:col-span-2">
            <div className="mb-2 grid gap-3 xl:grid-cols-2">
              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
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
                  disabled={!draft.warehouseId}
                />
                </div>
                <AddItemButton disabled={!factoryId} onClick={() => void createCategory()} />
              </div>

              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
                <MultiSelectField
                  label="Mã vật tư"
                  options={warehouseScopedItems.map((item) => ({
                    value: item.id,
                    label: item.code,
                    meta: item.name,
                  }))}
                  selectedValues={draft.selectedItemIds}
                  onChange={(values) => setDraft((prev) => ({ ...prev, selectedItemIds: values }))}
                  placeholder="Chọn nhiều mã vật tư"
                  disabled={!draft.warehouseId}
                />
                </div>
                <AddItemButton disabled={!factoryId || !draft.warehouseId} onClick={() => void createItem()} />
              </div>
            </div>

            <label className="mb-2 block text-xs font-bold text-slate-600">Danh sách vật tư theo kho đã chọn</label>
            {!draft.warehouseId ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Vui lòng chọn kho trước khi chọn vật tư.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {visibleItemCards.map((item) => {
                  const selected = draft.selectedItemIds.includes(item.id)
                  const totalStock = warehouses.reduce(
                    (sum, w) => sum + (balanceMap.get(`${w.id}:${item.id}`) ?? 0), 0,
                  )
                  const warehouseStocks = warehouses
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
              placeholder="Ghi chú tình trạng hàng, chứng từ đi kèm, lưu ý khi nhập..."
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="border-b border-slate-200 pb-4">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Dòng vật tư</div>
          <h2 className="mt-1 text-lg font-bold text-slate-800">Danh sách vật tư nhập</h2>
        </div>

        {draft.lines.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Chọn vật tư ở phần trên để tự sinh các dòng nhập kho.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {lineDetails.map((detail, index) => (
              <div key={detail.line.id} className="rounded-xl border border-slate-200 p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="font-bold text-slate-800">
                    {getLineTypeLabel(detail.item, index, lineDetails.map((d) => d.item))}
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
                      <AlertPill tone="blue">
                        {getStockContextLabel(detail.item, selectedWarehouse?.code)} hiện tại: {detail.currentStock.toLocaleString("vi-VN")}
                      </AlertPill>
                      <AlertPill tone="blue">
                        {getStockContextLabel(detail.item, selectedWarehouse?.code)} sau nhập: {detail.projectedStock.toLocaleString("vi-VN")}
                      </AlertPill>
                      {detail.exceedsMax ? <AlertPill tone="red">Sau nhập vượt max</AlertPill> : null}
                      {detail.belowMin ? <AlertPill>Dưới mức min</AlertPill> : null}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-600">Số lô</label>
                    <input
                      value={detail.line.lotNo}
                      onChange={(e) => updateLine(detail.line.id, { lotNo: e.target.value })}
                      placeholder={detail.item?.manages_lot ? "Bắt buộc" : "Không bắt buộc"}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-600">Hạn sử dụng</label>
                    <input
                      type="date"
                      value={detail.line.expiryDate}
                      onChange={(e) => updateLine(detail.line.id, { expiryDate: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <InventoryImageUpload
                      factoryId={factoryId}
                      documentType="import"
                      label="Hình ảnh 1"
                      value={detail.line.image1Url}
                      onChange={(url) => updateLine(detail.line.id, { image1Url: url })}
                    />
                  </div>

                    <div>
                      <InventoryImageUpload
                        factoryId={factoryId}
                        documentType="import"
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
                      placeholder="Ghi chú riêng cho dòng nhập này"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {detail.missingLot ? (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <span>Vật tư này bắt buộc nhập số lô khi tạo phiếu nhập.</span>
                    </div>
                  ) : null}
                  {detail.missingExpiry ? (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <span>Vật tư này bắt buộc nhập hạn sử dụng khi tạo phiếu nhập.</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </InventoryPageShell>

    {quickModal ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-800">
                {quickModal === "category" ? "Thêm phân loại vật tư" : "Thêm mã vật tư"}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {quickModal === "category"
                  ? "Lưu trực tiếp vào bảng inventory_item_categories."
                  : "Lưu trực tiếp vào bảng inventory_items và gán kho mặc định theo kho nhập đang chọn."}
              </p>
            </div>
            <button onClick={closeQuickModal} className="text-slate-400 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>

          {quickFormError ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {quickFormError}
            </div>
          ) : null}

          {quickModal === "category" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Mã phân loại *</label>
                <input
                  value={quickCategoryForm.code}
                  onChange={(event) =>
                    setQuickCategoryForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))
                  }
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Thứ tự</label>
                <input
                  value={quickCategoryForm.sort_order}
                  onChange={(event) =>
                    setQuickCategoryForm((prev) => ({ ...prev, sort_order: event.target.value }))
                  }
                  className={INPUT_CLASS}
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Tên phân loại *</label>
                <input
                  value={quickCategoryForm.name}
                  onChange={(event) => setQuickCategoryForm((prev) => ({ ...prev, name: event.target.value }))}
                  className={INPUT_CLASS}
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={quickCategoryForm.is_active}
                  onChange={(event) =>
                    setQuickCategoryForm((prev) => ({ ...prev, is_active: event.target.checked }))
                  }
                />
                Đang hoạt động
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">Phân loại vật tư *</label>
                  <select
                    value={quickItemForm.category_id}
                    onChange={(event) => setQuickItemForm((prev) => ({ ...prev, category_id: event.target.value }))}
                    className={INPUT_CLASS}
                  >
                    <option value="">Chọn phân loại</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.code} - {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">Kho mặc định *</label>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                    {selectedWarehouse ? `${selectedWarehouse.code} - ${selectedWarehouse.name}` : "Chưa chọn kho"}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">Mã vật tư *</label>
                  <input
                    value={quickItemForm.code}
                    onChange={(event) =>
                      setQuickItemForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))
                    }
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">Đơn vị tính *</label>
                  <input
                    value={quickItemForm.unit}
                    onChange={(event) => setQuickItemForm((prev) => ({ ...prev, unit: event.target.value }))}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">Tên vật tư *</label>
                  <input
                    value={quickItemForm.name}
                    onChange={(event) => setQuickItemForm((prev) => ({ ...prev, name: event.target.value }))}
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">Quy cách</label>
                  <input
                    value={quickItemForm.specification}
                    onChange={(event) =>
                      setQuickItemForm((prev) => ({ ...prev, specification: event.target.value }))
                    }
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">Tồn tối thiểu</label>
                  <input
                    value={quickItemForm.min_stock}
                    onChange={(event) => setQuickItemForm((prev) => ({ ...prev, min_stock: event.target.value }))}
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">Tồn tối đa</label>
                  <input
                    value={quickItemForm.max_stock}
                    onChange={(event) => setQuickItemForm((prev) => ({ ...prev, max_stock: event.target.value }))}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={quickItemForm.manages_lot}
                    onChange={(event) =>
                      setQuickItemForm((prev) => ({ ...prev, manages_lot: event.target.checked }))
                    }
                  />
                  Quản lý lô
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={quickItemForm.manages_expiry}
                    onChange={(event) =>
                      setQuickItemForm((prev) => ({ ...prev, manages_expiry: event.target.checked }))
                    }
                  />
                  Quản lý hạn
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={quickItemForm.is_active}
                    onChange={(event) =>
                      setQuickItemForm((prev) => ({ ...prev, is_active: event.target.checked }))
                    }
                  />
                  Đang hoạt động
                </label>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeQuickModal}
              className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={() => void (quickModal === "category" ? saveQuickCategory() : saveQuickItem())}
              disabled={quickSaving}
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
            >
              {quickSaving ? "Đang lưu..." : "Lưu mới"}
            </button>
          </div>
        </div>
      </div>
    ) : null}

    {cancelModal ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-600">
              <Ban size={18} />
              <h3 className="text-base font-bold">Hủy phiếu nhập</h3>
            </div>
            <button onClick={() => { setCancelModal(false); setCancelReason("") }} className="text-slate-400 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>
          <p className="mb-3 text-sm text-slate-600">
            Hủy phiếu sẽ <strong>đảo ngược tồn kho</strong> đã được ghi sổ. Thao tác này không thể hoàn tác.
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
