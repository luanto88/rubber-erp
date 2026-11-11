"use client"

// Định mức KTKT GĐ2 — "Kiểm kê tồn xưởng": số lượng còn ở xưởng CUỐI NGÀY cho các chỉ tiêu tick
// "Có kiểm kê tồn xưởng" (vd Axit Formic ở bồn). Báo cáo kỳ [F,T]: đầu kỳ = kiểm kê ngày F−1, cuối kỳ = ngày T.
// Lưới = vị trí × chỉ tiêu, lưu cả bảng 1 lần. Rule 30.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { Camera, ClipboardList, Save } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { addDaysISO, getFactoryTodayISO } from "@/lib/date-utils"
import { loadNormFloorCountDates, loadNormFloorCounts, loadNormFloorLocations, loadNormItems } from "@/lib/norms/client"
import { fmtQty, type NormFloorCount, type NormFloorLocation, type NormItem } from "@/lib/norms/types"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { ImageLightbox, PurchaseImagePicker } from "@/app/dashboard/purchase/_components/purchase-image-picker"
import { btnCls, btnPrimaryCls, cellInputCls, errText, fmtDate, inputCls, parseQtyInput } from "./norms-ui"

type Draft = { qty: string; images: string[]; ghi_chu: string }
const EMPTY: Draft = { qty: "", images: [], ghi_chu: "" }
const keyOf = (locationId: string, itemId: string) => `${locationId}|${itemId}`

function draftFrom(c: NormFloorCount | undefined): Draft {
  return c ? { qty: String(c.so_luong), images: c.image_urls, ghi_chu: c.ghi_chu || "" } : EMPTY
}
const sameDraft = (a: Draft, b: Draft) =>
  a.qty.trim() === b.qty.trim() && a.ghi_chu.trim() === b.ghi_chu.trim() && a.images.join("|") === b.images.join("|")

export function NormsFloorEntry({
  factoryId,
  user,
  showToast,
}: {
  factoryId: string
  user: SessionUser | null
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const canEdit = hasPermission(user, "norms.periodic_entry")
  const [locations, setLocations] = useState<NormFloorLocation[]>([])
  const [items, setItems] = useState<NormItem[]>([])
  const [counts, setCounts] = useState<NormFloorCount[]>([])
  const [dates, setDates] = useState<string[]>([])
  const [date, setDate] = useState(() => getFactoryTodayISO())
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [imageKey, setImageKey] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const loadBase = useCallback(async () => {
    setLoadError(null)
    try {
      const [loc, it, ds] = await Promise.all([loadNormFloorLocations(factoryId), loadNormItems(factoryId), loadNormFloorCountDates(factoryId)])
      setLocations(loc.filter((l) => l.is_active))
      setItems(it.filter((i) => i.is_active && i.kiem_ke_ton_xuong))
      setDates(ds)
    } catch (e) {
      setLoadError(errText(e, "Không tải được danh mục kiểm kê. Kiểm tra đã chạy migration 20261122 chưa."))
    }
  }, [factoryId])

  const loadCounts = useCallback(async () => {
    setLoading(true)
    try {
      setCounts(await loadNormFloorCounts(factoryId, date))
    } catch (e) {
      setLoadError(errText(e, "Không tải được số kiểm kê."))
    } finally {
      setLoading(false)
    }
  }, [factoryId, date])

  useEffect(() => {
    void loadBase()
  }, [loadBase])
  useEffect(() => {
    void loadCounts()
  }, [loadCounts])

  const existing = useMemo(() => new Map(counts.map((c) => [keyOf(c.location_id, c.norm_item_id), c])), [counts])

  useEffect(() => {
    const next: Record<string, Draft> = {}
    for (const l of locations) for (const it of items) next[keyOf(l.id, it.id)] = draftFrom(existing.get(keyOf(l.id, it.id)))
    setDrafts(next)
  }, [locations, items, existing])

  const dirtyKeys = useMemo(
    () => Object.keys(drafts).filter((k) => !sameDraft(drafts[k], draftFrom(existing.get(k)))),
    [drafts, existing],
  )

  const setDraft = (k: string, patch: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [k]: { ...(prev[k] || EMPTY), ...patch } }))

  const changeDate = (next: string) => {
    if (!next || next === date) return
    if (dirtyKeys.length && !window.confirm(`Còn ${dirtyKeys.length} ô chưa lưu. Bỏ thay đổi để chuyển ngày?`)) return
    setDate(next)
  }

  const totals = useMemo(() => {
    const map = new Map<string, number>()
    for (const it of items) {
      let s = 0
      for (const l of locations) {
        const v = parseQtyInput(drafts[keyOf(l.id, it.id)]?.qty || "")
        if (v !== null && !Number.isNaN(v)) s += v
      }
      map.set(it.id, s)
    }
    return map
  }, [items, locations, drafts])

  const save = async () => {
    if (!canEdit || !dirtyKeys.length) return
    const upserts: Record<string, unknown>[] = []
    const deletes: string[] = []
    const errors: string[] = []
    for (const k of dirtyKeys) {
      const [locationId, itemId] = k.split("|")
      const d = drafts[k]
      const v = parseQtyInput(d.qty)
      const ex = existing.get(k)
      if (v === null) {
        if (ex) deletes.push(ex.id)
        continue
      }
      if (Number.isNaN(v) || v < 0) {
        const loc = locations.find((l) => l.id === locationId)
        const it = items.find((i) => i.id === itemId)
        errors.push(`${loc?.name} — ${it?.name}: số lượng không hợp lệ.`)
        continue
      }
      upserts.push({
        factory_id: factoryId,
        ngay: date,
        location_id: locationId,
        norm_item_id: itemId,
        so_luong: v,
        image_urls: d.images,
        ghi_chu: d.ghi_chu.trim() || null,
      })
    }
    if (errors.length) {
      showToast("err", errors.join("\n"))
      return
    }
    if (deletes.length && !window.confirm(`Xoá ${deletes.length} số kiểm kê ngày ${fmtDate(date)} (ô để trống)?`)) return
    setSaving(true)
    try {
      if (upserts.length) {
        const { error } = await supabase.from("tech_norm_floor_counts").upsert(upserts, { onConflict: "ngay,location_id,norm_item_id" })
        if (error) throw error
      }
      if (deletes.length) {
        const { error } = await supabase.from("tech_norm_floor_counts").delete().eq("factory_id", factoryId).in("id", deletes)
        if (error) throw error
      }
      showToast("ok", `Đã lưu kiểm kê ngày ${fmtDate(date)}.`)
      void loadCounts()
      void loadBase()
    } catch (e) {
      showToast("err", errText(e, "Không lưu được kiểm kê."))
    } finally {
      setSaving(false)
    }
  }

  const COLS = 5
  const imgDraft = imageKey ? drafts[imageKey] || EMPTY : null

  if (loadError) return <ListState kind="error" message={loadError} onRetry={() => void loadBase()} />

  return (
    <div className="space-y-4">
      <StatGrid cols={3}>
        <StatCard icon={ClipboardList} label="Chỉ tiêu cần kiểm kê" value={items.length} />
        <StatCard label="Vị trí kiểm kê" value={locations.length} />
        <StatCard label="Chưa lưu" value={dirtyKeys.length} valueTone={dirtyKeys.length ? "warn" : "default"} />
      </StatGrid>

      <FilterBar layout="grid" activeCount={0}>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Ngày kiểm kê (cuối ngày)</span>
          <input type="date" className={inputCls} value={date} onChange={(e) => changeDate(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Ngày đã có kiểm kê</span>
          <select className={inputCls} value={dates.includes(date) ? date : ""} onChange={(e) => e.target.value && changeDate(e.target.value)}>
            <option value="">— Chọn —</option>
            {dates.map((d) => (
              <option key={d} value={d}>
                {fmtDate(d)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end text-xs text-slate-500">
          Dùng làm tồn đầu kỳ cho báo cáo bắt đầu ngày {fmtDate(addDaysISO(date, 1))}, tồn cuối kỳ cho báo cáo kết thúc ngày {fmtDate(date)}.
        </div>
        <div className="flex items-end justify-end">
          {canEdit ? (
            <button type="button" className={btnPrimaryCls} disabled={saving || !dirtyKeys.length} onClick={() => void save()}>
              <Save size={15} /> {saving ? "Đang lưu…" : `Lưu${dirtyKeys.length ? ` (${dirtyKeys.length})` : ""}`}
            </button>
          ) : (
            <span className="text-xs text-slate-500">Chỉ xem — cần quyền nhập liệu định mức.</span>
          )}
        </div>
      </FilterBar>

      {loading ? (
        <ListState kind="loading" />
      ) : !items.length ? (
        <ListState kind="empty" message='Chưa có chỉ tiêu nào tick "Có kiểm kê tồn xưởng" (Cấu hình định mức → Danh mục chỉ tiêu).' />
      ) : !locations.length ? (
        <ListState kind="empty" message="Chưa có vị trí kiểm kê. Thêm ở thẻ Danh mục." />
      ) : (
        <ResponsiveTableWrapper>
          <table className="enterprise-table dense min-w-[760px]">
            <thead>
              <tr>
                <th>Chỉ tiêu</th>
                <th>Vị trí</th>
                <th className="text-right">Số lượng còn</th>
                <th>Ảnh</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <Fragment key={it.id}>
                  <tr className="bg-slate-50">
                    <td colSpan={COLS} className="text-xs font-bold text-slate-700">
                      {it.name} <span className="font-code text-slate-500">({it.code})</span>
                      <span className="ml-2 font-semibold text-mod-800">— Tổng: {fmtQty(totals.get(it.id) || 0)}</span>
                    </td>
                  </tr>
                  {locations.map((l) => {
                    const k = keyOf(l.id, it.id)
                    const d = drafts[k] || EMPTY
                    const parsed = parseQtyInput(d.qty)
                    const dirty = dirtyKeys.includes(k)
                    return (
                      <tr key={k}>
                        <td className="text-xs text-slate-400">{it.code}</td>
                        <td className="text-sm">{l.name}</td>
                        <td className="w-40">
                          <input
                            className={`${cellInputCls} ${parsed !== null && Number.isNaN(parsed) ? "border-red-400" : dirty ? "border-amber-400 bg-amber-50" : ""}`}
                            inputMode="decimal"
                            disabled={!canEdit}
                            value={d.qty}
                            onChange={(e) => setDraft(k, { qty: e.target.value })}
                            placeholder="—"
                          />
                        </td>
                        <td>
                          <button type="button" className={`${btnCls} px-2 py-1 text-xs`} onClick={() => setImageKey(k)}>
                            <Camera size={13} /> {d.images.length || ""}
                          </button>
                        </td>
                        <td>
                          <input className={`${cellInputCls} text-left`} disabled={!canEdit} value={d.ghi_chu} onChange={(e) => setDraft(k, { ghi_chu: e.target.value })} />
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      {imageKey && imgDraft && (
        <ModalShell
          title="Ảnh kiểm kê"
          onClose={() => setImageKey(null)}
          maxWidth="md"
          footer={
            <button type="button" className={btnPrimaryCls} onClick={() => setImageKey(null)}>
              Xong
            </button>
          }
        >
          {canEdit ? (
            <PurchaseImagePicker
              factoryId={factoryId}
              documentType="norms-floor"
              images={imgDraft.images}
              onChange={(urls) => setDraft(imageKey, { images: urls })}
              max={4}
              onPreview={setPreview}
            />
          ) : imgDraft.images.length ? (
            <div className="flex flex-wrap gap-1.5">
              {imgDraft.images.map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={u} src={u} alt="Ảnh kiểm kê" onClick={() => setPreview(u)} className="h-14 w-14 cursor-zoom-in rounded-lg border object-cover" />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Chưa có ảnh.</p>
          )}
          <p className="mt-3 text-xs text-slate-500">Ảnh được lưu khi bấm Lưu ở bảng.</p>
        </ModalShell>
      )}
      <ImageLightbox url={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
