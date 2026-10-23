"use client"

// Modal "Thêm / Sửa vật tư mua ngoài" của Bảo trì — dùng chung cho biên bản
// (records/[id]) và Cài đặt → Bảo trì → Vật tư mua ngoài.
// - Gõ tên tới đâu hiện vật tư GẦN GIỐNG trong danh mục (similar-name.ts, ngưỡng 0,8 như form
//   Đề nghị mua), kèm "Lịch sử" (tồn theo kho, lần mua/nhập/xuất gần nhất) và "Dùng mã này".
// - Trùng tuyệt đối tên (sau chuẩn hoá) hoặc trùng mã → chặn ngay ở client (server vẫn chặn 409).
// - Ảnh đại diện = 1 ảnh upload/chụp (inventory_items.image_url), không còn ô dán link.
// - Kho mặc định chọn được, mặc định Kho tạm KT (chỉ khi tạo mới). Biên bản nhập/xuất theo kho thật
//   của lần nhập (Bước 2), kho mặc định là gợi ý khi chưa nhập.

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { AlertTriangle, History, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { authFetch } from "@/lib/auth-fetch"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { findKeywordMatches, findSimilarNames, normalizeName } from "@/lib/similar-name"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { ImageLightbox, PurchaseImagePicker } from "@/app/dashboard/purchase/_components/purchase-image-picker"
import { PurchaseInsightPanel } from "@/app/dashboard/purchase/_components/purchase-insight-panel"
import type { PurchaseItemInsight } from "@/lib/purchase/types"

// Mã kho tạm — trùng KT_WAREHOUSE_CODE (src/lib/maintenance-kt.ts, file server-only nên không import).
const KT_CODE = "KT"

export type ExtMaterialFormValues = {
  code: string
  ten_vat_tu: string
  dvt: string
  specification: string
  category_id: string
  don_gia: string
  loai_tien: string
  image_url: string
  warehouse_id: string
  is_active: boolean
}

export function emptyExtMaterialForm(): ExtMaterialFormValues {
  return { code: "", ten_vat_tu: "", dvt: "", specification: "", category_id: "", don_gia: "", loai_tien: "USD", image_url: "", warehouse_id: "", is_active: true }
}

export type ExtCatalogItem = {
  id: string
  code: string
  name: string
  unit: string | null
  category_id: string | null
  image_url: string | null
  specification: string | null
  don_gia: number | null
  loai_tien: string | null
  is_active: boolean | null
}

export type CreatedExtMaterial = {
  item: {
    id: string
    code: string
    name: string
    unit: string
    specification: string | null
    category_id: string | null
    don_gia: number | null
    loai_tien: string | null
    default_warehouse_ids: string[] | null
  }
  warehouse: { id: string; code: string } | null
}

type Warehouse = { id: string; code: string; name: string; is_active: boolean | null }

const labelCls = "text-xs font-bold text-slate-600 block mb-1.5"
const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-brand-500"

export function ExtMaterialModal({
  factoryId, categories, initial, editItemId = null, onClose, onCreated, onUpdated, onUseExisting,
}: {
  factoryId: string
  categories: { id: string; code?: string | null; name: string }[]
  initial?: Partial<ExtMaterialFormValues>
  /** Có giá trị = sửa vật tư đã có (Cài đặt); không có = tạo mới qua API. */
  editItemId?: string | null
  onClose: () => void
  onCreated?: (result: CreatedExtMaterial) => void
  onUpdated?: () => void
  /** Có giá trị = hiện nút "Dùng mã này" cạnh vật tư gần giống (biên bản). */
  onUseExisting?: (item: ExtCatalogItem) => void
}) {
  const isEdit = !!editItemId
  const [form, setForm] = useState<ExtMaterialFormValues>(() => ({ ...emptyExtMaterialForm(), ...initial }))
  const [catalog, setCatalog] = useState<ExtCatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverDup, setServerDup] = useState<{ id: string; code: string; name: string; unit: string | null } | null>(null)
  const [insightFor, setInsightFor] = useState<string | null>(null)
  const [insight, setInsight] = useState<PurchaseItemInsight | null>(null)
  const [insightLoading, setInsightLoading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  const patch = (p: Partial<ExtMaterialFormValues>) => setForm((prev) => ({ ...prev, ...p }))

  // Danh mục để so trùng/gần giống (kể cả vật tư đã ngừng — server cũng chặn trùng với chúng)
  // + danh sách kho. Phân trang vì inventory_items có thể vượt 1000 dòng.
  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const [items, whRes] = await Promise.all([
          fetchAllPaginated<ExtCatalogItem>((from, to) =>
            supabase
              .from("inventory_items")
              .select("id, code, name, unit, category_id, image_url, specification, don_gia, loai_tien, is_active")
              .eq("factory_id", factoryId)
              .order("id")
              .range(from, to),
          ),
          supabase.from("inventory_warehouses").select("id, code, name, is_active").eq("factory_id", factoryId).order("code"),
        ])
        if (!alive) return
        setCatalog(items)
        const whs = ((whRes.data || []) as Warehouse[]).filter((w) => w.is_active !== false)
        setWarehouses(whs)
        if (!isEdit) {
          setForm((prev) => {
            if (prev.warehouse_id) return prev
            const kt = whs.find((w) => w.code === KT_CODE)
            return { ...prev, warehouse_id: kt?.id || "" }
          })
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Không tải được danh mục vật tư")
      } finally {
        if (alive) setCatalogLoading(false)
      }
    }
    void run()
    return () => { alive = false }
  }, [factoryId, isEdit])

  const deferredName = useDeferredValue(form.ten_vat_tu)
  const others = useMemo(() => catalog.filter((it) => it.id !== editItemId), [catalog, editItemId])
  // Gợi ý = khớp từ khoá (gõ "UCP" hay "203" ra "Bạc đạn UCP 203") + tên gần giống (chống trùng).
  const similar = useMemo(() => {
    const fuzzy = findSimilarNames(deferredName, others, (it) => it.name, { limit: 5 })
    const keyword = findKeywordMatches(deferredName, others, (it) => it.name, (it) => it.code, { limit: 5 })
    const out: { item: ExtCatalogItem; score: number | null }[] = fuzzy.map((c) => ({ item: c.item, score: c.score }))
    for (const it of keyword) {
      if (out.length >= 8) break
      if (!out.some((o) => o.item.id === it.id)) out.push({ item: it, score: null })
    }
    return out
  }, [deferredName, others])
  const exactDup = useMemo(() => {
    const target = normalizeName(form.ten_vat_tu)
    return target ? others.find((it) => normalizeName(it.name) === target) || null : null
  }, [form.ten_vat_tu, others])
  const codeDup = useMemo(() => {
    const code = form.code.trim().toUpperCase()
    return code ? others.find((it) => (it.code || "").trim().toUpperCase() === code) || null : null
  }, [form.code, others])

  const toggleInsight = async (itemId: string) => {
    if (insightFor === itemId) { setInsightFor(null); setInsight(null); return }
    setInsightFor(itemId)
    setInsight(null)
    setInsightLoading(true)
    try {
      const res = await authFetch(`/api/purchase/item-insight?${new URLSearchParams({ itemId })}`)
      const json = (await res.json().catch(() => null)) as (PurchaseItemInsight & { error?: string }) | null
      if (res.ok && json && !json.error) setInsight(json)
    } finally {
      setInsightLoading(false)
    }
  }

  const handleSave = async () => {
    const missing: string[] = []
    if (!form.code.trim()) missing.push("Mã vật tư")
    if (!form.ten_vat_tu.trim()) missing.push("Tên vật tư")
    if (!form.category_id) missing.push("Phân loại vật tư")
    if (!form.dvt.trim()) missing.push("Đơn vị tính")
    if (!(parseFloat(form.don_gia) > 0)) missing.push("Đơn giá (> 0)")
    if (!isEdit && !form.warehouse_id) missing.push("Kho mặc định")
    if (missing.length) { setError(`Vui lòng nhập: ${missing.join(", ")}`); return }
    if (codeDup) { setError(`Mã vật tư ${form.code.trim().toUpperCase()} đã có (${codeDup.name}).`); return }
    if (exactDup) { setError(`Vật tư "${exactDup.name}" (${exactDup.code}) đã có trong danh mục.`); return }

    setSaving(true)
    setError(null)
    setServerDup(null)
    try {
      if (isEdit) {
        const { error: updErr } = await supabase
          .from("inventory_items")
          .update({
            code: form.code.trim().toUpperCase(),
            name: form.ten_vat_tu.trim(),
            unit: form.dvt.trim(),
            specification: form.specification.trim() || null,
            category_id: form.category_id,
            image_url: form.image_url.trim() || null,
            don_gia: parseFloat(form.don_gia),
            loai_tien: form.loai_tien,
            is_active: form.is_active,
          })
          .eq("id", editItemId)
          .eq("factory_id", factoryId)
        if (updErr) { setError(updErr.message); return }
        onUpdated?.()
        return
      }
      const res = await authFetch("/api/maintenance/external-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.ten_vat_tu.trim(),
          categoryId: form.category_id,
          unit: form.dvt.trim(),
          donGia: parseFloat(form.don_gia),
          loaiTien: form.loai_tien,
          specification: form.specification.trim() || null,
          imageUrl: form.image_url.trim() || null,
          warehouseId: form.warehouse_id || null,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        existing?: { id: string; code: string; name: string; unit: string | null }
      } & Partial<CreatedExtMaterial>
      if (!res.ok || !json.item) {
        setError(json.error || "Không tạo được vật tư mua ngoài")
        if (json.existing) setServerDup(json.existing)
        return
      }
      onCreated?.({ item: json.item, warehouse: json.warehouse || null })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi lưu vật tư mua ngoài")
    } finally {
      setSaving(false)
    }
  }

  const blocked = !!exactDup || !!codeDup

  const renderSuggestion = (it: ExtCatalogItem, score: number | null) => {
    const exact = exactDup?.id === it.id
    const inactive = it.is_active === false
    return (
      <li key={it.id} className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-2.5 py-2">
          {it.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.image_url} alt="" onClick={() => setPreview(it.image_url)} className="h-9 w-9 shrink-0 cursor-zoom-in rounded-md border border-slate-200 object-cover" />
          ) : (
            <div className="h-9 w-9 shrink-0 rounded-md border border-dashed border-slate-200 bg-slate-50" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">{it.name}</p>
            <p className="truncate text-[11px] text-slate-500">
              <span className="font-mono">{it.code}</span>{it.unit ? ` · ${it.unit}` : ""}
              {score !== null && !exact && <> · giống {Math.round(score * 100)}%</>}
            </p>
          </div>
          {exact && <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">Trùng tên</span>}
          {inactive && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Ngừng dùng</span>}
          <button
            type="button"
            onClick={() => void toggleInsight(it.id)}
            title="Tồn kho, lần mua/nhập/xuất gần nhất"
            className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100"
          >
            <History size={13} /> Lịch sử
          </button>
          {onUseExisting && !inactive && (
            <button
              type="button"
              onClick={() => onUseExisting(it)}
              className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-brand-700"
            >
              Dùng mã này
            </button>
          )}
        </div>
        {insightFor === it.id && (
          <div className="border-t border-slate-100">
            {insightLoading || insight
              ? <PurchaseInsightPanel insight={insight} unit={it.unit} loading={insightLoading} compact />
              : <p className="px-3 py-2 text-xs text-slate-400">Không tải được lịch sử vật tư.</p>}
          </div>
        )}
      </li>
    )
  }

  // Gộp: vật tư gần giống + vật tư trùng mà server báo về (khi danh mục client chưa kịp có).
  const suggestionList: { item: ExtCatalogItem; score: number | null }[] = [
    ...similar,
  ]
  if (exactDup && !suggestionList.some((s) => s.item.id === exactDup.id)) suggestionList.unshift({ item: exactDup, score: 1 })
  if (codeDup && !suggestionList.some((s) => s.item.id === codeDup.id)) suggestionList.unshift({ item: codeDup, score: null })
  if (serverDup && !suggestionList.some((s) => s.item.id === serverDup.id)) {
    const full = catalog.find((it) => it.id === serverDup.id)
    suggestionList.unshift({
      item: full || { ...serverDup, category_id: null, image_url: null, specification: null, don_gia: null, loai_tien: null, is_active: true },
      score: null,
    })
  }

  return (
    <>
      <ModalShell
        title={isEdit ? "Sửa vật tư mua ngoài" : "Thêm vật tư mua ngoài"}
        onClose={onClose}
        maxWidth="2xl"
        footer={
          <>
            <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || blocked}
              title={blocked ? "Vật tư đã có trong danh mục — chọn mã đang có thay vì tạo mới" : undefined}
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50"
            >
              {saving ? "Đang lưu..." : "Lưu vật tư"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}
            </div>
          )}
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Vật tư được thêm vào danh mục kho để lập Đề nghị mua và nhập/xuất kho. Các trường có dấu * là bắt buộc.
          </p>

          <div>
            <label className={labelCls}>Tên vật tư *</label>
            <input
              value={form.ten_vat_tu}
              onChange={(e) => patch({ ten_vat_tu: e.target.value })}
              placeholder="Tên đầy đủ của vật tư"
              className={inputCls}
              autoFocus
            />
            {catalogLoading ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Đang tải danh mục để kiểm tra trùng...</p>
            ) : suggestionList.length > 0 ? (
              <div className={`mt-2 rounded-xl border p-2.5 ${blocked ? "border-red-200 bg-red-50/60" : "border-amber-200 bg-amber-50/60"}`}>
                <p className={`mb-2 flex items-center gap-1.5 text-xs font-bold ${blocked ? "text-red-700" : "text-amber-800"}`}>
                  <AlertTriangle size={13} />
                  {blocked
                    ? "Vật tư này đã có trong danh mục — hãy dùng mã đang có."
                    : "Vật tư đã có khớp tên đang gõ — kiểm tra trước khi tạo mã mới."}
                </p>
                <ul className="space-y-1.5">{suggestionList.map((s) => renderSuggestion(s.item, s.score))}</ul>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Mã vật tư *</label>
              <input
                value={form.code}
                onChange={(e) => patch({ code: e.target.value })}
                placeholder="VD: BD22211"
                className={`${inputCls} font-mono ${codeDup ? "border-red-400" : ""}`}
              />
              {codeDup && <p className="mt-1 text-xs text-red-600">Mã đã dùng cho “{codeDup.name}”.</p>}
            </div>
            <div>
              <label className={labelCls}>Phân loại vật tư *</label>
              <select value={form.category_id} onChange={(e) => patch({ category_id: e.target.value })} className={`${inputCls} bg-white`}>
                <option value="">— Chọn phân loại —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.code ? `${c.code} - ${c.name}` : c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Đơn vị tính *</label>
              <input value={form.dvt} onChange={(e) => patch({ dvt: e.target.value })} placeholder="Cái, kg, lít..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Đơn giá *</label>
              <input type="number" min="0" step="any" value={form.don_gia} onChange={(e) => patch({ don_gia: e.target.value })} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Loại tiền</label>
              <select value={form.loai_tien} onChange={(e) => patch({ loai_tien: e.target.value })} className={`${inputCls} bg-white`}>
                <option value="USD">USD</option>
                <option value="VND">VND</option>
                <option value="KHR">KHR</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Quy cách / Đặc tính</label>
            <input value={form.specification} onChange={(e) => patch({ specification: e.target.value })} placeholder="Quy cách, đặc tính kỹ thuật..." className={inputCls} />
          </div>

          {!isEdit && (
            <div>
              <label className={labelCls}>Kho mặc định *</label>
              <select value={form.warehouse_id} onChange={(e) => patch({ warehouse_id: e.target.value })} className={`${inputCls} bg-white`}>
                <option value="">— Chọn kho —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
                ))}
              </select>
            </div>
          )}

          <PurchaseImagePicker
            factoryId={factoryId}
            images={form.image_url ? [form.image_url] : []}
            onChange={(urls) => patch({ image_url: urls[0] || "" })}
            documentType="inventory-items"
            label="Hình ảnh vật tư (1 ảnh)"
            title="Chọn ảnh từ máy hoặc chụp trực tiếp — ảnh HEIC tự chuyển JPEG"
            max={1}
            variant="inline"
            onPreview={setPreview}
          />

          {isEdit && (
            <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
              <input type="checkbox" checked={form.is_active} onChange={(e) => patch({ is_active: e.target.checked })} className="rounded" />
              Đang sử dụng
            </label>
          )}
        </div>
      </ModalShell>
      <ImageLightbox url={preview} onClose={() => setPreview(null)} />
    </>
  )
}
