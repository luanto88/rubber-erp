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
  const [selectedCategoryId, setSelectedCategoryId] = useState("")
  const [draft, setDraft] = useState<DraftState>(defaultDraft())

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
          if (!balanceResult.error) setBalances((balanceResult.data || []) as { warehouse_id: string; item_id: string; on_hand: number }[])
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

  const selectedWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === draft.warehouseId) || null,
    [draft.warehouseId, warehouses],
  )

  const documentCode = useMemo(
    () => draft.documentCode || formatDocCode(selectedWarehouse?.code || "", draft.documentDate),
    [draft.documentCode, draft.documentDate, selectedWarehouse?.code],
  )
  const documentQrPath = draft.documentId ? `/dashboard/inventory/print?type=import&code=${encodeURIComponent(documentCode)}` : null

  const balanceMap = useMemo(
    () => new Map(balances.map((row) => [`${row.warehouse_id}:${row.item_id}`, Number(row.on_hand) || 0])),
    [balances],
  )

  const warehouseScopedItems = useMemo(() => {
    let scoped = items.filter((item) => !draft.warehouseId || item.default_warehouse_ids.includes(draft.warehouseId))
    if (scoped.length === 0) scoped = items
    if (selectedCategoryId) scoped = scoped.filter((item) => item.category_id === selectedCategoryId)
    return scoped
  }, [draft.warehouseId, items, selectedCategoryId])

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
      const currentStock = item?.opening_stock ?? 0
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
  }, [draft.lines, draft.warehouseId, items, warehouseRules])

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
        qr_value: `/dashboard/inventory/receipts?code=${encodeURIComponent(nextDocumentCode)}`,
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
      setSaveError(error instanceof Error ? error.message : "Không ghi sổ được phiếu nhập.")
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

  return (
    <>
    <InventoryPageShell
      eyebrow="Nhập xuất tồn"
      title="Phiếu nhập kho"
      description="Chọn kho, chọn nhiều vật tư theo kho và hoàn thiện số lượng, lô, hạn dùng ngay trên từng dòng nhập."
      action={
        <button
          onClick={() => void saveReceiptDraft()}
          disabled={saving || posting || loading || documentStatus === "posted"}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700 disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? "Đang lưu..." : draft.documentId ? "Cập nhật phiếu" : "Tạo phiếu nhập"}
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
          <div className="font-bold">Không lưu được phiếu nhập</div>
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
                <button
                  onClick={() => void postReceiptDraft()}
                  disabled={saving || posting || loading}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                >
                  {posting ? "Đang ghi sổ..." : "Ghi sổ nhập kho"}
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
                setSelectedCategoryId("")
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
              value={draft.sourceName}
              onChange={(e) => setDraft((prev) => ({ ...prev, sourceName: e.target.value }))}
              placeholder="Nhà cung cấp / bộ phận giao"
              className={INPUT_CLASS}
            />
          </div>

          {draft.warehouseId && warehouseScopedCategories.length >= 2 ? (
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
            {!draft.warehouseId ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Vui lòng chọn kho trước khi chọn vật tư.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {warehouseScopedItems.map((item) => {
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
                      <AlertPill tone="blue">Tồn hiện tại: {detail.currentStock.toLocaleString("vi-VN")}</AlertPill>
                      <AlertPill tone="blue">Tồn sau nhập: {detail.projectedStock.toLocaleString("vi-VN")}</AlertPill>
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
