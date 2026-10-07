"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle, ChevronDown, ChevronUp, Loader2, Package, Plus, Save, Search, Send, Sparkles, Trash2,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { authFetch } from "@/lib/auth-fetch"
import { convertCurrency, CURRENCIES, setCurrencyRates } from "@/lib/currency"
import { findSimilarNames, normalizeName } from "@/lib/similar-name"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import {
  formatMoney, formatSoPhieuFull, isPriceDeviationExceeded, priceDeviationPct,
  PRICE_DEVIATION_LIMIT_PCT, purchaseUrgency,
  type PurchaseItemInsight, type PurchaseLineInput, type PurchaseLineRow, type PurchaseRequestRow,
} from "@/lib/purchase/types"
import { BO_PHAN_LIST } from "@/lib/bo-phan"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { fetchApprovers, readJson, type ApproversResponse } from "./purchase-client"
import { ImageLightbox, PurchaseImagePicker } from "./purchase-image-picker"
import { PurchaseInsightPanel } from "./purchase-insight-panel"

// ── Kiểu dữ liệu ─────────────────────────────────────────────────────────────

export type ItemOpt = {
  id: string
  code: string
  name: string
  unit: string | null
  category_id: string | null
  don_gia: number | null
  loai_tien: string | null
  nguon_tao: string | null
}
type CategoryOpt = { id: string; code: string; name: string }
type WarehouseOpt = { id: string; code: string; name: string }

type Insight = PurchaseItemInsight

type DraftLine = {
  key: string
  item_id: string | null
  item_code: string | null
  item_name: string
  unit: string | null
  category_id: string | null
  so_luong: string
  don_gia: string
  muc_dich: string
  ghi_chu: string
  ly_do_lech_gia: string
  la_vat_tu_moi: boolean
  image_urls: string[]
  mua_tai: string
  ngay_co_hang: string
  ngay_can_hang: string
  insight: Insight | null
  insightLoading: boolean
  showInsight: boolean
}

type Suggestion = { value: number; source: "lan_mua_truoc" | "cung_nhom" | "danh_muc"; label: string }

let keySeq = 0
const newKey = () => `l${Date.now()}_${keySeq++}`

/**
 * Dòng mới; `prev` có giá trị → tự lấy Mua tại / Có hàng / Cần hàng của dòng trước để khỏi nhập lại.
 * Dòng đầu tiên (không có `prev`) → Cần hàng mặc định HÔM NAY theo giờ nhà máy (GĐ2f).
 */
function emptyLine(prev?: DraftLine): DraftLine {
  return {
    key: newKey(), item_id: null, item_code: null, item_name: "", unit: null, category_id: null,
    so_luong: "", don_gia: "", muc_dich: "", ghi_chu: "", ly_do_lech_gia: "", la_vat_tu_moi: false, image_urls: [],
    mua_tai: prev?.mua_tai || "", ngay_co_hang: prev?.ngay_co_hang || "", ngay_can_hang: prev ? (prev.ngay_can_hang || "") : getFactoryTodayISO(),
    insight: null, insightLoading: false, showInsight: false,
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function roundPrice(v: number, currency: string): number {
  return currency === "USD" ? Math.round(v * 100) / 100 : Math.round(v)
}

/** Trung vị cùng nhóm chỉ đáng tin khi đủ mẫu: ≥3 lần mua và (nếu biết phiếu) từ ≥2 phiếu khác nhau. */
const CATEGORY_MIN_SAMPLES = 3
const CATEGORY_MIN_REQUESTS = 2

/**
 * Giá gợi ý (GĐ2h): lần mua gần nhất của CHÍNH vật tư → giá danh mục của CHÍNH vật tư → trung vị cùng
 * nhóm (khi đủ mẫu). Quy đổi về tiền của phiếu. Trước đây trung vị nhóm đứng trước giá danh mục nên
 * 1-2 phiếu lẻ trong nhóm kéo giá gợi ý của cả nhóm về cùng một con số.
 */
function computeSuggestion(line: DraftLine, item: ItemOpt | undefined, currency: string): Suggestion | null {
  const ins = line.insight
  const last = ins?.recentPurchases[0]
  if (last && last.donGia > 0) {
    return {
      value: roundPrice(convertCurrency(last.donGia, last.loaiTien, currency), currency),
      source: "lan_mua_truoc",
      label: `theo phiếu ${formatSoPhieuFull(last.so, last.nam)} (${fmtDate(last.ngay)})`,
    }
  }
  if (item && Number(item.don_gia) > 0) {
    return {
      value: roundPrice(convertCurrency(Number(item.don_gia), item.loai_tien || "USD", currency), currency),
      source: "danh_muc",
      label: "giá danh mục kho",
    }
  }
  const raw = (ins?.categorySamples || []).filter((s) => convertCurrency(s.donGia, s.loaiTien, currency) > 0)
  const reqIds = new Set(raw.map((s) => s.requestId).filter(Boolean))
  // Bản chụp cũ không có requestId → chỉ xét số mẫu.
  const enoughRequests = reqIds.size === 0 || reqIds.size >= CATEGORY_MIN_REQUESTS
  if (raw.length >= CATEGORY_MIN_SAMPLES && enoughRequests) {
    const med = median(raw.map((s) => convertCurrency(s.donGia, s.loaiTien, currency)))
    if (med) return { value: roundPrice(med, currency), source: "cung_nhom", label: `trung vị ${raw.length} lần mua vật tư cùng nhóm` }
  }
  return null
}

// ── Chọn vật tư có tìm nhanh ────────────────────────────────────────────────

export function ItemPicker({
  items, value, onSelect, onCreateNew, disabledIds, categories,
}: {
  items: ItemOpt[]
  value: ItemOpt | null
  onSelect: (item: ItemOpt) => void
  /** categoryId = phân loại đang lọc trong dropdown ("" nếu Tất cả) — để điền sẵn khi tạo vật tư mới. */
  onCreateNew?: (name: string, categoryId: string) => void
  disabledIds: Set<string>
  /** Có truyền → hiện ô "Phân loại vật tư" trong dropdown để lọc nhanh (chỉ UI, không lưu). */
  categories?: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [cat, setCat] = useState("")
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("touchstart", close)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("touchstart", close)
    }
  }, [])

  const filtered = useMemo(() => {
    const nq = normalizeName(q)
    const byCat = cat ? items.filter((it) => it.category_id === cat) : items
    const list = nq
      ? byCat.filter((it) => normalizeName(`${it.code} ${it.name}`).includes(nq))
      : byCat
    return list.slice(0, 80)
  }, [items, q, cat])

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => {
          // Mở dropdown: phân loại mặc định = nhóm của vật tư đang chọn (nếu có).
          if (!open) setCat(value?.category_id || "")
          setOpen((o) => !o)
        }}
        className="w-full flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-xl text-sm text-left bg-white hover:border-emerald-500"
      >
        {value ? (
          <span className="flex-1 min-w-0 truncate">
            <span className="font-mono text-xs text-slate-500 mr-1.5">{value.code}</span>
            <span className="font-semibold text-slate-800">{value.name}</span>
          </span>
        ) : (
          <span className="flex-1 text-slate-400">— Chọn vật tư trong kho —</span>
        )}
        <ChevronDown size={14} className="text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl">
          <div className="p-2 border-b border-slate-100 flex flex-col sm:flex-row gap-2">
            {categories && categories.length > 0 && (
              <select
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                title="Lọc nhanh theo phân loại vật tư — không lưu vào phiếu"
                className="sm:w-48 shrink-0 px-2 py-1.5 border border-slate-200 rounded-lg text-sm outline-none focus:border-emerald-500 bg-white"
              >
                <option value="">Tất cả phân loại</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <div className="flex-1 flex items-center gap-2 px-2 py-1.5 border border-slate-200 rounded-lg">
              <Search size={13} className="text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm theo mã hoặc tên vật tư..."
                className="flex-1 text-sm outline-none"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-xs text-slate-400 text-center">Không tìm thấy vật tư phù hợp.</p>
            )}
            {filtered.map((it) => {
              const dup = disabledIds.has(it.id)
              return (
                <button
                  key={it.id}
                  type="button"
                  disabled={dup}
                  onClick={() => { onSelect(it); setOpen(false); setQ("") }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-emerald-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span className="font-mono text-xs text-slate-500 w-20 shrink-0 truncate">{it.code}</span>
                  <span className="flex-1 min-w-0 truncate text-slate-800">{it.name}</span>
                  <span className="text-xs text-slate-400 shrink-0">{it.unit}</span>
                  {dup && <span className="text-[10px] text-amber-600 shrink-0">đã có dòng</span>}
                </button>
              )
            })}
          </div>
          {onCreateNew && <div className="p-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => { setOpen(false); onCreateNew(q, cat) }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg"
            >
              <Plus size={13} /> Không có trong kho — tạo vật tư mới{q ? ` "${q}"` : ""}
            </button>
          </div>}
        </div>
      )}
    </div>
  )
}

// ── Form chính ───────────────────────────────────────────────────────────────

export function PurchaseForm({
  factoryId,
  userId,
  existing,
  onSaved,
  onCancel,
}: {
  factoryId: string
  userId: string
  existing?: { request: PurchaseRequestRow; lines: PurchaseLineRow[] } | null
  onSaved: (id: string, submitAfter: boolean) => void | Promise<void>
  onCancel?: () => void
}) {
  const [items, setItems] = useState<ItemOpt[]>([])
  const [categories, setCategories] = useState<CategoryOpt[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseOpt[]>([])
  const [approvers, setApprovers] = useState<ApproversResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [loaiTien, setLoaiTien] = useState(existing?.request.loai_tien || "USD")
  const [giamDocId, setGiamDocId] = useState<string>(existing?.request.giam_doc_user_id || "")
  const [keToanId, setKeToanId] = useState<string>(existing?.request.ke_toan_user_id || "")
  const [ghiChu, setGhiChu] = useState(existing?.request.ghi_chu || "")
  const [boPhan, setBoPhan] = useState<string>(existing?.request.bo_phan || "")
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [lines, setLines] = useState<DraftLine[]>(() =>
    existing?.lines.length
      ? existing.lines.map((l) => ({
          ...emptyLine(),
          item_id: l.item_id, item_code: l.item_code, item_name: l.item_name, unit: l.unit,
          so_luong: String(l.so_luong), don_gia: String(l.don_gia), muc_dich: l.muc_dich || "",
          ghi_chu: l.ghi_chu || "", ly_do_lech_gia: l.ly_do_lech_gia || "", la_vat_tu_moi: l.la_vat_tu_moi,
          image_urls: l.image_urls || [],
          mua_tai: l.mua_tai || "", ngay_co_hang: l.ngay_co_hang || "", ngay_can_hang: l.ngay_can_hang || "",
        }))
      : [emptyLine()],
  )
  const [saving, setSaving] = useState<"" | "save" | "submit">("")
  const [error, setError] = useState<string | null>(null)

  // Modal tạo vật tư mới
  const [newItemFor, setNewItemFor] = useState<string | null>(null)
  const [newItem, setNewItem] = useState({ name: "", unit: "", categoryId: "", warehouseId: "", specification: "" })
  const [newItemConfirmed, setNewItemConfirmed] = useState(false)
  const [newItemSaving, setNewItemSaving] = useState(false)
  const [newItemError, setNewItemError] = useState<string | null>(null)

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  // ── Tải danh mục ──
  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const all: ItemOpt[] = []
        for (let from = 0; ; from += 1000) {
          const { data, error: e } = await supabase
            .from("inventory_items")
            .select("id, code, name, unit, category_id, don_gia, loai_tien, nguon_tao")
            .eq("factory_id", factoryId)
            .eq("is_active", true)
            .order("code")
            .range(from, from + 999)
          if (e) throw new Error(e.message)
          all.push(...((data || []) as ItemOpt[]))
          if (!data || data.length < 1000) break
        }
        const [{ data: cats }, { data: whs }, { data: fac }, appr] = await Promise.all([
          supabase.from("inventory_item_categories").select("id, code, name").eq("factory_id", factoryId).eq("is_active", true).order("name"),
          supabase.from("inventory_warehouses").select("id, code, name").eq("factory_id", factoryId).order("code"),
          supabase.from("factories").select("ty_gia_usd_vnd, ty_gia_usd_khr").eq("id", factoryId).maybeSingle(),
          fetchApprovers(),
        ])
        if (!alive) return
        setCurrencyRates({ vnd: fac?.ty_gia_usd_vnd as number | null, khr: fac?.ty_gia_usd_khr as number | null })
        setItems(all)
        setCategories((cats || []) as CategoryOpt[])
        setWarehouses((whs || []) as WarehouseOpt[])
        setApprovers(appr)
        if (!existing) {
          setGiamDocId((v) => v || appr.defaultGiamDocId || "")
          setKeToanId((v) => v || appr.defaultKeToanId || "")
        }
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : "Không tải được danh mục")
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => { alive = false }
  }, [factoryId, existing])

  const patchLine = useCallback((key: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }, [])

  const loadInsight = useCallback(async (key: string, itemId: string, autoPrice: boolean) => {
    patchLine(key, { insightLoading: true })
    try {
      const qs = new URLSearchParams({ itemId })
      if (existing?.request.id) qs.set("excludeRequestId", existing.request.id)
      const ins = await readJson<Insight>(await authFetch(`/api/purchase/item-insight?${qs}`))
      setLines((prev) => prev.map((l) => {
        if (l.key !== key) return l
        const next = { ...l, insight: ins, insightLoading: false }
        if (autoPrice && !l.don_gia) {
          const s = computeSuggestion(next, itemById.get(itemId), loaiTien)
          if (s) next.don_gia = String(s.value)
        }
        return next
      }))
    } catch {
      patchLine(key, { insightLoading: false })
    }
  }, [existing, itemById, loaiTien, patchLine])

  // Nạp thông tin cho các dòng đã có khi mở phiếu để sửa.
  const loadedOnce = useRef(false)
  useEffect(() => {
    if (loading || loadedOnce.current) return
    loadedOnce.current = true
    for (const l of lines) if (l.item_id) void loadInsight(l.key, l.item_id, false)
  }, [loading, lines, loadInsight])

  const selectItem = (key: string, item: ItemOpt, isNew = false) => {
    patchLine(key, {
      item_id: item.id, item_code: item.code, item_name: item.name, unit: item.unit,
      category_id: item.category_id, don_gia: "", ly_do_lech_gia: "", la_vat_tu_moi: isNew || item.nguon_tao === "de_nghi_mua",
      insight: null, showInsight: true,
    })
    void loadInsight(key, item.id, true)
  }

  const usedIds = useMemo(() => new Set(lines.map((l) => l.item_id).filter(Boolean) as string[]), [lines])

  // ── Vật tư mới ──
  const similar = useMemo(
    () => (newItemFor ? findSimilarNames(newItem.name, items, (i) => i.name) : []),
    [newItemFor, newItem.name, items],
  )

  const openNewItem = (key: string, name: string, categoryId = "") => {
    setNewItemFor(key)
    setNewItem({ name, unit: "", categoryId, warehouseId: warehouses[0]?.id || "", specification: "" })
    setNewItemConfirmed(false)
    setNewItemError(null)
  }

  const saveNewItem = async () => {
    if (!newItemFor) return
    if (similar.length && !newItemConfirmed) {
      setNewItemError("Có vật tư tên gần giống — chọn vật tư có sẵn hoặc tick xác nhận không trùng.")
      return
    }
    setNewItemSaving(true)
    setNewItemError(null)
    try {
      const res = await authFetch("/api/purchase/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newItem),
      })
      const json = (await res.json()) as { item?: ItemOpt; error?: string; existing?: ItemOpt }
      if (!res.ok || !json.item) {
        setNewItemError(json.error || "Không tạo được vật tư")
        return
      }
      const created: ItemOpt = { ...json.item, nguon_tao: "de_nghi_mua" }
      setItems((prev) => [...prev, created].sort((a, b) => a.code.localeCompare(b.code, "vi")))
      selectItem(newItemFor, created, true)
      setNewItemFor(null)
    } finally {
      setNewItemSaving(false)
    }
  }

  const pickExistingInstead = (item: ItemOpt) => {
    if (!newItemFor) return
    selectItem(newItemFor, item)
    setNewItemFor(null)
  }

  // ── Lưu ──
  const total = lines.reduce((s, l) => s + (Number(l.so_luong) || 0) * (Number(l.don_gia) || 0), 0)
  const today = getFactoryTodayISO()
  const muaTaiOptions = [...new Set(lines.map((l) => l.mua_tai.trim()).filter(Boolean))]
  const applySupplyToAll = (src: DraftLine) =>
    setLines((prev) => prev.map((l) => ({ ...l, mua_tai: src.mua_tai, ngay_co_hang: src.ngay_co_hang, ngay_can_hang: src.ngay_can_hang })))

  const handleSave = async (submitAfter: boolean) => {
    setError(null)
    const errs: string[] = []
    if (!boPhan) errs.push("Chưa chọn Bộ phận")
    if (!giamDocId) errs.push("Chưa chọn Giám đốc nhà máy")
    if (!keToanId) errs.push("Chưa chọn Kế toán")
    if (giamDocId && giamDocId === keToanId) errs.push("Giám đốc và Kế toán phải là 2 người khác nhau")
    if ([giamDocId, keToanId].includes(userId)) errs.push("Người đề nghị không được đồng thời là người ký duyệt")
    const payloadLines: PurchaseLineInput[] = []
    lines.forEach((l, i) => {
      if (!l.item_id) { errs.push(`Dòng ${i + 1}: chưa chọn vật tư`); return }
      const sl = Number(l.so_luong)
      const gia = Number(l.don_gia)
      if (!(sl > 0)) errs.push(`Dòng ${i + 1}: số lượng phải > 0`)
      if (!l.muc_dich.trim()) errs.push(`Dòng ${i + 1}: chưa nhập mục đích sử dụng`)
      if (!l.ngay_can_hang) errs.push(`Dòng ${i + 1}: chưa chọn thời gian cần hàng`)
      else if (l.ngay_can_hang < today) errs.push(`Dòng ${i + 1}: thời gian cần hàng không được trước hôm nay`)
      if (!(gia >= 0) || l.don_gia === "") errs.push(`Dòng ${i + 1}: chưa nhập đơn giá`)
      const s = computeSuggestion(l, itemById.get(l.item_id), loaiTien)
      const pct = priceDeviationPct(gia, s?.value)
      if (isPriceDeviationExceeded(pct) && !l.ly_do_lech_gia.trim()) {
        errs.push(`Dòng ${i + 1}: đơn giá lệch ${pct!.toFixed(0)}% — cần nhập lý do`)
      }
      payloadLines.push({
        item_id: l.item_id, item_code: l.item_code, item_name: l.item_name, unit: l.unit,
        so_luong: sl, don_gia: gia, muc_dich: l.muc_dich || null, ghi_chu: l.ghi_chu || null,
        gia_goi_y: s?.value ?? null, nguon_gia_goi_y: s?.source ?? null,
        ly_do_lech_gia: l.ly_do_lech_gia || null, la_vat_tu_moi: l.la_vat_tu_moi,
        image_urls: l.image_urls,
        mua_tai: l.mua_tai.trim() || null,
        ngay_co_hang: l.ngay_co_hang || null,
        ngay_can_hang: l.ngay_can_hang || null,
      })
    })
    if (errs.length) { setError(errs.join("\n")); return }

    setSaving(submitAfter ? "submit" : "save")
    try {
      const res = await authFetch("/api/purchase/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: existing?.request.id || null,
          loaiTien, giamDocUserId: giamDocId, keToanUserId: keToanId, ghiChu, boPhan, lines: payloadLines,
        }),
      })
      const json = await readJson<{ id: string }>(res)
      await onSaved(json.id, submitAfter)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được phiếu")
    } finally {
      setSaving("")
    }
  }

  if (loading) {
    return <div className="p-10 text-center text-slate-400"><Loader2 className="mx-auto animate-spin mb-2" />Đang tải danh mục vật tư...</div>
  }
  if (loadError) {
    return <div className="p-6 text-center text-red-600 font-semibold">{loadError}</div>
  }

  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
  const labelCls = "text-xs font-bold text-slate-600 block mb-1"

  return (
    <div className="space-y-4">
      {/* Người ký */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h3 className="text-sm font-extrabold text-slate-700 mb-3">Người ký duyệt (thứ tự: Người đề nghị → Giám đốc → Kế toán)</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className={labelCls}>Người đề nghị</label>
            <div className="px-3 py-2 rounded-xl bg-slate-100 text-sm text-slate-700">
              Bạn{approvers?.myChucVu ? ` — ${approvers.myChucVu}` : ""}
            </div>
          </div>
          <div>
            <label className={labelCls}>Bộ phận *</label>
            <select className={`${inputCls} ${!boPhan ? "text-slate-400" : ""}`} value={boPhan} onChange={(e) => setBoPhan(e.target.value)}>
              <option value="">— Chọn bộ phận —</option>
              {BO_PHAN_LIST.map((b) => <option key={b} value={b} className="text-slate-800">{b}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Giám đốc nhà máy *</label>
            <select className={inputCls} value={giamDocId} onChange={(e) => setGiamDocId(e.target.value)}>
              <option value="">— Chọn —</option>
              {approvers?.giamDoc.map((a) => (
                <option key={a.id} value={a.id} disabled={a.id === userId}>{a.full_name} — {a.chuc_vu}</option>
              ))}
            </select>
            {approvers?.giamDocFallback && <p className="text-[11px] text-amber-600 mt-1">Không tìm thấy lãnh đạo thuộc NMCB — đang hiện toàn nhà máy.</p>}
          </div>
          <div>
            <label className={labelCls}>Kế toán *</label>
            <select className={inputCls} value={keToanId} onChange={(e) => setKeToanId(e.target.value)}>
              <option value="">— Chọn —</option>
              {approvers?.keToan.map((a) => (
                <option key={a.id} value={a.id} disabled={a.id === userId}>{a.full_name} — {a.chuc_vu}</option>
              ))}
            </select>
            {approvers?.keToanFallback && <p className="text-[11px] text-amber-600 mt-1">Không tìm thấy nhân viên thuộc NMCB — đang hiện toàn nhà máy.</p>}
          </div>
          <div>
            <label className={labelCls}>Loại tiền</label>
            <select className={inputCls} value={loaiTien} onChange={(e) => setLoaiTien(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Dòng vật tư */}
      <div className="space-y-3">
        {lines.map((l, idx) => {
          const item = l.item_id ? itemById.get(l.item_id) : undefined
          const sug = l.item_id ? computeSuggestion(l, item, loaiTien) : null
          const gia = Number(l.don_gia)
          const pct = l.don_gia !== "" ? priceDeviationPct(gia, sug?.value) : null
          const exceeded = isPriceDeviationExceeded(pct)
          const thanhTien = (Number(l.so_luong) || 0) * (gia || 0)
          return (
            <div key={l.key} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-extrabold text-slate-500">Dòng {idx + 1}</span>
                <div className="flex items-center gap-2">
                  {l.la_vat_tu_moi && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Vật tư mới</span>}
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50" title="Xoá dòng">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
                <div className="col-span-2 md:col-span-5">
                  <label className={labelCls}>Vật tư hàng hóa *</label>
                  <ItemPicker
                    items={items}
                    categories={categories}
                    value={item || null}
                    onSelect={(it) => selectItem(l.key, it)}
                    onCreateNew={(name, cat) => openNewItem(l.key, name, cat)}
                    disabledIds={new Set([...usedIds].filter((id) => id !== l.item_id))}
                  />
                </div>
                <div className="md:col-span-1">
                  <label className={labelCls}>ĐVT</label>
                  <div className="px-2 py-2 rounded-xl bg-slate-100 text-sm text-slate-700 truncate">{l.unit || "—"}</div>
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Số lượng *</label>
                  <input type="number" min={0} step="any" className={inputCls} value={l.so_luong} onChange={(e) => patchLine(l.key, { so_luong: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Đơn giá ({loaiTien}) *</label>
                  <input
                    type="number" min={0} step="any"
                    className={`${inputCls} ${exceeded ? "border-red-500 bg-red-50 focus:border-red-500" : ""}`}
                    value={l.don_gia}
                    onChange={(e) => patchLine(l.key, { don_gia: e.target.value })}
                  />
                </div>
                <div className="col-span-2 md:col-span-2">
                  <label className={labelCls}>Thành tiền</label>
                  <div className="px-3 py-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-800 text-right">{formatMoney(thanhTien, loaiTien)}</div>
                </div>
              </div>

              {sug && (
                <div className={`mt-2 text-xs ${exceeded ? "text-red-600 font-semibold" : "text-slate-500"}`}>
                  {exceeded ? (
                    <span className="flex items-start gap-1">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                      Đơn giá {pct! > 0 ? "cao" : "thấp"} hơn {Math.abs(pct!).toFixed(0)}% so với giá gợi ý {formatMoney(sug.value, loaiTien)} {loaiTien} ({sug.label}) — vượt ngưỡng ±{PRICE_DEVIATION_LIMIT_PCT}%.
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Sparkles size={12} className="text-emerald-500" /> Giá gợi ý {formatMoney(sug.value, loaiTien)} {loaiTien} — {sug.label}
                      {l.don_gia === "" && (
                        <button type="button" className="ml-1 text-emerald-700 font-bold underline" onClick={() => patchLine(l.key, { don_gia: String(sug.value) })}>Dùng giá này</button>
                      )}
                    </span>
                  )}
                </div>
              )}
              {l.item_id && !sug && !l.insightLoading && (
                <p className="mt-2 text-xs text-slate-400">Chưa có lịch sử giá cho vật tư này hoặc vật tư cùng nhóm — nhập đơn giá theo báo giá.</p>
              )}
              {exceeded && (
                <div className="mt-2">
                  <label className={`${labelCls} text-red-600`}>Lý do lệch giá *</label>
                  <input className={`${inputCls} border-red-300`} value={l.ly_do_lech_gia} placeholder="VD: giá thị trường tăng, nhà cung cấp mới..." onChange={(e) => patchLine(l.key, { ly_do_lech_gia: e.target.value })} />
                </div>
              )}

              {(() => {
                const urg = purchaseUrgency(l.ngay_can_hang, today)
                const urgTitle = urg ? `${urg.label}${urg.level === "gap" || urg.level === "qua_han" ? " — nên ưu tiên duyệt" : ""}` : undefined
                const lateSupply = !!l.ngay_co_hang && !!l.ngay_can_hang && l.ngay_co_hang > l.ngay_can_hang
                return (
                  <div className="mt-3 space-y-3">
                    {/* Dòng 1: Mục đích | Mua tại | Ghi chú — 3 ô bằng nhau */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className={labelCls}>Mục đích sử dụng *</label>
                        <input className={inputCls} value={l.muc_dich} onChange={(e) => patchLine(l.key, { muc_dich: e.target.value })} />
                      </div>
                      <div>
                        <label className={labelCls}>Vật tư mua tại</label>
                        <input
                          className={inputCls}
                          list="purchase-mua-tai-options"
                          value={l.mua_tai}
                          placeholder="Cửa hàng / nhà cung cấp dự kiến"
                          onChange={(e) => patchLine(l.key, { mua_tai: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Ghi chú</label>
                        <input className={inputCls} value={l.ghi_chu} onChange={(e) => patchLine(l.key, { ghi_chu: e.target.value })} />
                      </div>
                    </div>
                    {/* Dòng 2: Có hàng | Cần hàng (chip mức gấp nằm trong ô) | Ảnh đính kèm */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className={labelCls}>Thời gian có hàng</label>
                        <input type="date" className={inputCls} value={l.ngay_co_hang} onChange={(e) => patchLine(l.key, { ngay_co_hang: e.target.value })} />
                      </div>
                      <div>
                        <label className={labelCls}>Thời gian cần hàng *</label>
                        <div className="relative" title={urgTitle}>
                          <input
                            type="date" min={today}
                            className={`${inputCls} ${urg?.shortLabel ? "pr-24" : ""} ${urg && (urg.level === "gap" || urg.level === "qua_han") ? "border-red-400 bg-red-50" : ""}`}
                            value={l.ngay_can_hang}
                            onChange={(e) => patchLine(l.key, { ngay_can_hang: e.target.value })}
                          />
                          {urg?.shortLabel && (
                            <span className={`pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-bold ${urg.className}`}>
                              {urg.shortLabel}
                            </span>
                          )}
                        </div>
                      </div>
                      <PurchaseImagePicker
                        variant="inline"
                        factoryId={factoryId}
                        documentType="purchase-requests"
                        label="Ảnh đính kèm"
                        title="Ảnh hiện trạng, báo giá… — chỉ lưu kèm phiếu, không in lên phiếu"
                        images={l.image_urls}
                        onChange={(urls) => patchLine(l.key, { image_urls: urls })}
                        onPreview={setLightbox}
                      />
                    </div>
                    {(lateSupply || (lines.length > 1 && (l.mua_tai || l.ngay_co_hang || l.ngay_can_hang))) && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {lateSupply && (
                          <span className="flex items-center gap-1 font-semibold text-amber-700" title="Kiểm tra lại ngày có hàng hoặc ghi rõ trong ghi chú">
                            <AlertTriangle size={12} /> Có hàng sau ngày cần
                          </span>
                        )}
                        {lines.length > 1 && (l.mua_tai || l.ngay_co_hang || l.ngay_can_hang) && (
                          <button
                            type="button" onClick={() => applySupplyToAll(l)}
                            title="Chép Mua tại, Thời gian có hàng, Thời gian cần hàng sang mọi dòng"
                            className="ml-auto font-bold text-emerald-700 underline"
                          >
                            Áp dụng cho mọi dòng
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}

              {l.item_id && (
                <div className="mt-3">
                  {/* Thanh tiêu đề panel THAM KHẢO — cố ý khác hẳn ô nhập liệu để không bị nhầm. */}
                  <button
                    type="button"
                    onClick={() => patchLine(l.key, { showInsight: !l.showInsight })}
                    aria-expanded={l.showInsight}
                    className={`w-full flex items-center gap-2 px-3 py-2 bg-sky-50 hover:bg-sky-100 border-l-4 border-sky-500 text-left text-sm font-bold text-sky-800 ${l.showInsight ? "rounded-t-lg" : "rounded-lg"}`}
                  >
                    <Package size={15} className="shrink-0" />
                    <span className="flex-1">
                      Tồn kho và lịch sử mua &amp; sử dụng
                      <span className="block text-[11px] font-medium text-sky-600">Chỉ để tham khảo — không phải ô nhập</span>
                    </span>
                    {l.showInsight ? <ChevronUp size={16} className="shrink-0" /> : <ChevronDown size={16} className="shrink-0" />}
                  </button>
                  {l.showInsight && <PurchaseInsightPanel insight={l.insight} unit={l.unit} loading={l.insightLoading} />}
                </div>
              )}
            </div>
          )
        })}
        <button type="button" onClick={() => setLines((p) => [...p, emptyLine(p[p.length - 1])])} className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-sm font-bold rounded-xl">
          <Plus size={15} /> Thêm dòng vật tư
        </button>
        <datalist id="purchase-mua-tai-options">
          {muaTaiOptions.map((v) => <option key={v} value={v} />)}
        </datalist>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div className="md:col-span-2">
          <label className={labelCls}>Ghi chú chung</label>
          <input className={inputCls} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} />
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Tổng cộng</p>
          <p className="text-2xl font-extrabold text-slate-800">{formatMoney(total, loaiTien)} <span className="text-sm text-slate-500">{loaiTien}</span></p>
        </div>
      </div>

      <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />

      {error && (
        <div className="whitespace-pre-line rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Huỷ</button>
        )}
        <button type="button" disabled={!!saving} onClick={() => handleSave(false)} className="flex items-center gap-1.5 px-5 py-2.5 border border-emerald-600 text-emerald-700 font-bold rounded-xl hover:bg-emerald-50 disabled:opacity-60">
          {saving === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu nháp
        </button>
        <button type="button" disabled={!!saving} onClick={() => handleSave(true)} className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60">
          {saving === "submit" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Lưu & gửi ký
        </button>
      </div>

      {newItemFor && (
        <ModalShell
          title="Tạo vật tư mới vào danh mục kho"
          onClose={() => setNewItemFor(null)}
          maxWidth="lg"
          footer={
            <>
              <button onClick={() => setNewItemFor(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Huỷ</button>
              <button onClick={saveNewItem} disabled={newItemSaving} className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-60">
                {newItemSaving && <Loader2 size={14} className="animate-spin" />} Tạo & chọn
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Tên vật tư *</label>
              <input className={inputCls} value={newItem.name} autoFocus onChange={(e) => { setNewItem((v) => ({ ...v, name: e.target.value })); setNewItemConfirmed(false) }} />
            </div>
            {similar.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
                <p className="text-xs font-bold text-amber-800 flex items-center gap-1"><AlertTriangle size={13} /> Có thể trùng với vật tư đã có:</p>
                {similar.map(({ item, score }) => (
                  <div key={item.id} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-slate-500">{item.code}</span>
                    <span className="flex-1 font-semibold text-slate-800">{item.name}</span>
                    <span className="text-xs text-amber-700">{Math.round(score * 100)}%</span>
                    <button type="button" onClick={() => pickExistingInstead(item)} className="px-2 py-1 text-xs font-bold bg-white border border-amber-300 rounded-lg hover:bg-amber-100">Dùng vật tư này</button>
                  </div>
                ))}
                <label className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                  <input type="checkbox" checked={newItemConfirmed} onChange={(e) => setNewItemConfirmed(e.target.checked)} />
                  Tôi xác nhận đây là vật tư KHÁC, không trùng
                </label>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Đơn vị tính *</label>
                <input className={inputCls} value={newItem.unit} onChange={(e) => setNewItem((v) => ({ ...v, unit: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Phân loại *</label>
                <select className={inputCls} value={newItem.categoryId} onChange={(e) => setNewItem((v) => ({ ...v, categoryId: e.target.value }))}>
                  <option value="">— Chọn —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Kho nhập dự kiến *</label>
                <select className={inputCls} value={newItem.warehouseId} onChange={(e) => setNewItem((v) => ({ ...v, warehouseId: e.target.value }))}>
                  <option value="">— Chọn —</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Quy cách</label>
                <input className={inputCls} value={newItem.specification} onChange={(e) => setNewItem((v) => ({ ...v, specification: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-slate-500">Mã vật tư tự sinh theo phân loại. Vật tư được gắn nhãn &quot;Vật tư mới&quot; để Kế toán rà khi ký.</p>
            {newItemError && <p className="text-sm font-semibold text-red-600">{newItemError}</p>}
          </div>
        </ModalShell>
      )}
    </div>
  )
}
