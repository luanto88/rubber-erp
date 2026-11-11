"use client"

// Định mức KTKT GĐ2 — "Chỉ số đồng hồ": nhập chỉ số điện / nước theo NGÀY ghi (thường ngày 27 hằng tháng)
// cho mọi đồng hồ đang dùng, gom theo khu vực như Mẫu 09-NMCB. Chỉ số cũ = lần ghi gần nhất trước ngày đó.
// Lưu cả bảng 1 lần (upsert theo meter_id + ngày). Rule 30.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Camera, Gauge, Save, Search, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { loadNormItems, loadNormMeterReadings, loadNormMeters } from "@/lib/norms/client"
import {
  NORM_METER_LOAI_LABEL,
  NORM_METER_UNIT,
  fmtQty,
  type NormItem,
  type NormMeter,
  type NormMeterLoai,
  type NormMeterReading,
} from "@/lib/norms/types"
import {
  meterCountsForNormAt,
  parseNormMeterQr,
  previousReading,
  readingWarnings,
  sortReadings,
  stepConsumption,
  type StepWarning,
} from "@/lib/norms/meters"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { ExpandAllToggle, ExpandHeaderCell, ExpandableRow } from "@/app/dashboard/_components/doc-ui/expandable-row"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { QrScanButton, QrScanPortal } from "@/app/dashboard/_components/qr-scan-portal"
import { ImageLightbox, PurchaseImagePicker } from "@/app/dashboard/purchase/_components/purchase-image-picker"
import { btnCls, btnPrimaryCls, cellInputCls, errText, fmtDate, inputCls, parseQtyInput } from "./norms-ui"

type Draft = { chi_so: string; thay: boolean; chot: string; images: string[]; ghi_chu: string }

const EMPTY_DRAFT: Draft = { chi_so: "", thay: false, chot: "", images: [], ghi_chu: "" }

function draftFrom(r: NormMeterReading | undefined): Draft {
  if (!r) return EMPTY_DRAFT
  return {
    chi_so: String(r.chi_so),
    thay: r.thay_dong_ho,
    chot: r.chi_so_chot_cu === null ? "" : String(r.chi_so_chot_cu),
    images: r.image_urls,
    ghi_chu: r.ghi_chu || "",
  }
}

function sameDraft(a: Draft, b: Draft) {
  return (
    a.chi_so.trim() === b.chi_so.trim() &&
    a.thay === b.thay &&
    (a.thay ? a.chot.trim() === b.chot.trim() : true) &&
    a.ghi_chu.trim() === b.ghi_chu.trim() &&
    a.images.join("|") === b.images.join("|")
  )
}

export function NormsMeterEntry({
  factoryId,
  user,
  showToast,
}: {
  factoryId: string
  user: SessionUser | null
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const canEdit = hasPermission(user, "norms.periodic_entry")
  const [meters, setMeters] = useState<NormMeter[]>([])
  const [items, setItems] = useState<NormItem[]>([])
  const [readings, setReadings] = useState<NormMeterReading[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [date, setDate] = useState(() => getFactoryTodayISO())
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [search, setSearch] = useState("")
  const [scanOpen, setScanOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [imageMeterId, setImageMeterId] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [m, r, it] = await Promise.all([loadNormMeters(factoryId), loadNormMeterReadings(factoryId), loadNormItems(factoryId)])
      setMeters(m.filter((x) => x.is_active))
      setReadings(r)
      setItems(it)
    } catch (e) {
      setLoadError(errText(e, "Không tải được đồng hồ. Kiểm tra đã chạy migration 20261122 chưa."))
    } finally {
      setLoading(false)
    }
  }, [factoryId])

  useEffect(() => {
    void load()
  }, [load])

  const readingsByMeter = useMemo(() => {
    const map = new Map<string, NormMeterReading[]>()
    for (const r of readings) {
      const arr = map.get(r.meter_id) || []
      arr.push(r)
      map.set(r.meter_id, arr)
    }
    for (const [k, arr] of map) map.set(k, sortReadings(arr))
    return map
  }, [readings])

  const existingOnDate = useMemo(() => {
    const map = new Map<string, NormMeterReading>()
    for (const r of readings) if (r.ngay === date) map.set(r.meter_id, r)
    return map
  }, [readings, date])

  // Nạp lại ô nhập khi đổi ngày / sau khi tải lại.
  useEffect(() => {
    const next: Record<string, Draft> = {}
    for (const m of meters) next[m.id] = draftFrom(existingOnDate.get(m.id))
    setDrafts(next)
  }, [meters, existingOnDate])

  const dirtyIds = useMemo(
    () => meters.filter((m) => drafts[m.id] && !sameDraft(drafts[m.id], draftFrom(existingOnDate.get(m.id)))).map((m) => m.id),
    [meters, drafts, existingOnDate],
  )

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const changeDate = (next: string) => {
    if (!next || next === date) return
    if (dirtyIds.length && !window.confirm(`Còn ${dirtyIds.length} đồng hồ chưa lưu ở ngày ${fmtDate(date)}. Bỏ thay đổi để chuyển ngày?`)) return
    setDate(next)
  }

  const setDraft = (meterId: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [meterId]: { ...(prev[meterId] || EMPTY_DRAFT), ...patch } }))

  /** Tính dòng: chỉ số cũ, tiêu thụ dự kiến, cảnh báo. */
  type RowCalc = { prev: NormMeterReading | null; value: number | null; parsed: number | null; invalid: boolean; warnings: StepWarning[] }
  const calc = useMemo(() => {
    const out = new Map<string, RowCalc>()
    for (const m of meters) {
      const hist = readingsByMeter.get(m.id) || []
      const prev = previousReading(hist, date)
      const d = drafts[m.id] || EMPTY_DRAFT
      const parsed = parseQtyInput(d.chi_so)
      const chot = parseQtyInput(d.chot)
      const invalid = (parsed !== null && Number.isNaN(parsed)) || (d.thay && (chot === null || Number.isNaN(chot)))
      let value: number | null = null
      let warnings: StepWarning[] = []
      if (parsed !== null && !Number.isNaN(parsed) && !invalid) {
        const next = {
          ngay: date,
          chi_so: parsed,
          he_so: existingOnDate.get(m.id)?.he_so ?? m.he_so,
          thay_dong_ho: d.thay,
          chi_so_chot_cu: d.thay ? (chot as number) : null,
        }
        if (prev) value = stepConsumption(prev, next)
        warnings = readingWarnings(hist, next)
      }
      out.set(m.id, { prev, value, parsed, invalid, warnings })
    }
    return out
  }, [meters, readingsByMeter, drafts, date, existingOnDate])

  const q = search.trim().toLowerCase()
  const visible = useMemo(
    () => meters.filter((m) => !q || `${m.code} ${m.name} ${m.khu_vuc}`.toLowerCase().includes(q)),
    [meters, q],
  )
  const groups = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, NormMeter[]>()
    for (const m of visible) {
      const k = m.khu_vuc || "Khác"
      if (!map.has(k)) {
        map.set(k, [])
        order.push(k)
      }
      map.get(k)!.push(m)
    }
    return order.map((k) => ({ khuVuc: k, meters: map.get(k)! }))
  }, [visible])

  const recordedCount = meters.filter((m) => existingOnDate.has(m.id)).length
  const warnCount = meters.filter((m) => (calc.get(m.id)?.warnings.length || 0) > 0).length

  const groupTotals = (list: NormMeter[]) => {
    const sums = new Map<NormMeterLoai, number>()
    for (const m of list) {
      const v = calc.get(m.id)?.value
      if (v !== null && v !== undefined) sums.set(m.loai, (sums.get(m.loai) || 0) + v)
    }
    return [...sums.entries()].map(([loai, v]) => `${NORM_METER_LOAI_LABEL[loai]}: ${fmtQty(v, 1)} ${NORM_METER_UNIT[loai]}`).join(" · ")
  }

  const save = async () => {
    if (!canEdit || !dirtyIds.length) return
    const upserts: Record<string, unknown>[] = []
    const deletes: string[] = []
    const errors: string[] = []
    for (const id of dirtyIds) {
      const m = meters.find((x) => x.id === id)!
      const d = drafts[id]
      const existing = existingOnDate.get(id)
      const parsed = parseQtyInput(d.chi_so)
      if (parsed === null) {
        if (existing) deletes.push(existing.id)
        continue
      }
      if (Number.isNaN(parsed) || parsed < 0) {
        errors.push(`${m.code}: chỉ số không hợp lệ.`)
        continue
      }
      const chot = d.thay ? parseQtyInput(d.chot) : null
      if (d.thay && (chot === null || Number.isNaN(chot) || chot < 0)) {
        errors.push(`${m.code}: đã tick "Thay đồng hồ" thì phải nhập chỉ số chốt đồng hồ cũ.`)
        continue
      }
      upserts.push({
        factory_id: factoryId,
        meter_id: id,
        ngay: date,
        chi_so: parsed,
        he_so: existing?.he_so ?? m.he_so,
        thay_dong_ho: d.thay,
        chi_so_chot_cu: d.thay ? chot : null,
        image_urls: d.images,
        ghi_chu: d.ghi_chu.trim() || null,
        nhap_qua: existing?.nhap_qua ?? "tay",
      })
    }
    if (errors.length) {
      showToast("err", errors.join("\n"))
      return
    }
    if (deletes.length && !window.confirm(`Xoá chỉ số ngày ${fmtDate(date)} của ${deletes.length} đồng hồ (ô chỉ số để trống)?`)) return
    setSaving(true)
    try {
      if (upserts.length) {
        const { error } = await supabase.from("tech_norm_meter_readings").upsert(upserts, { onConflict: "meter_id,ngay" })
        if (error) throw error
      }
      if (deletes.length) {
        const { error } = await supabase.from("tech_norm_meter_readings").delete().eq("factory_id", factoryId).in("id", deletes)
        if (error) throw error
      }
      showToast("ok", `Đã lưu chỉ số ngày ${fmtDate(date)} (${upserts.length} ghi, ${deletes.length} xoá).`)
      void load()
    } catch (e) {
      showToast("err", errText(e, "Không lưu được chỉ số đồng hồ."))
    } finally {
      setSaving(false)
    }
  }

  const handleScan = (text: string) => {
    setScanOpen(false)
    const id = parseNormMeterQr(text)
    const m = id ? meters.find((x) => x.id === id) : null
    if (m) {
      setSearch(m.code)
      setExpanded((prev) => new Set(prev).add(m.id))
      return
    }
    setSearch(text.trim())
  }

  const imageMeter = imageMeterId ? meters.find((m) => m.id === imageMeterId) : null
  const COLS = 10

  if (loading) return <ListState kind="loading" />
  if (loadError) return <ListState kind="error" message={loadError} onRetry={() => void load()} />

  return (
    <div className="space-y-4">
      <StatGrid cols={4}>
        <StatCard icon={Gauge} label="Đồng hồ đang dùng" value={meters.length} />
        <StatCard label={`Đã ghi ngày ${fmtDate(date)}`} value={`${recordedCount}/${meters.length}`} valueTone={recordedCount === meters.length && meters.length ? "good" : "default"} />
        <StatCard label="Chưa lưu" value={dirtyIds.length} valueTone={dirtyIds.length ? "warn" : "default"} />
        <StatCard label="Cảnh báo" value={warnCount} valueTone={warnCount ? "danger" : "default"} />
      </StatGrid>

      <FilterBar layout="grid" activeCount={q ? 1 : 0}>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Ngày ghi chỉ số</span>
          <input type="date" className={inputCls} value={date} onChange={(e) => changeDate(e.target.value)} />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs font-semibold text-slate-600">Tìm đồng hồ</span>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${inputCls} pl-9 pr-20`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ký hiệu, tên, khu vực…" />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {search && (
                <button type="button" className="rounded p-1 text-slate-400 hover:text-slate-700" onClick={() => setSearch("")} aria-label="Xoá tìm">
                  <X size={14} />
                </button>
              )}
              <QrScanButton onClick={() => setScanOpen(true)} title="Quét tem QR đồng hồ" />
            </div>
          </div>
        </label>
        <div className="flex items-end justify-end gap-2">
          {canEdit ? (
            <button type="button" className={btnPrimaryCls} disabled={saving || !dirtyIds.length} onClick={() => void save()}>
              <Save size={15} /> {saving ? "Đang lưu…" : `Lưu${dirtyIds.length ? ` (${dirtyIds.length})` : ""}`}
            </button>
          ) : (
            <span className="text-xs text-slate-500">Chỉ xem — cần quyền nhập liệu định mức.</span>
          )}
        </div>
      </FilterBar>

      {meters.length === 0 ? (
        <ListState kind="empty" message="Chưa có đồng hồ nào. Thêm ở thẻ Danh mục." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <p className="text-xs text-slate-500">
              Tiêu thụ = (Chỉ số mới − Chỉ số cũ) × Hệ số. Số có dấu chấm ngăn nghìn (36.333) được hiểu là 36333.
            </p>
            <ExpandAllToggle
              allExpanded={visible.length > 0 && visible.every((m) => expanded.has(m.id))}
              onExpandAll={() => setExpanded(new Set(visible.map((m) => m.id)))}
              onCollapseAll={() => setExpanded(new Set())}
            />
          </div>
          <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="enterprise-table dense min-w-[1080px]">
              <thead>
                <tr>
                  <th>Ký hiệu</th>
                  <th>Đồng hồ</th>
                  <th className="text-right">Hệ số</th>
                  <th className="text-right">Chỉ số cũ</th>
                  <th className="text-right">Chỉ số mới</th>
                  <th>Thay ĐH</th>
                  <th className="text-right">Tiêu thụ</th>
                  <th>Ảnh</th>
                  <th>Ghi chú</th>
                  <ExpandHeaderCell />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.khuVuc}>
                    <tr className="bg-slate-50">
                      <td colSpan={COLS} className="text-xs font-bold text-slate-700">
                        {g.khuVuc}
                        {groupTotals(g.meters) && <span className="ml-2 font-semibold text-mod-800">— {groupTotals(g.meters)}</span>}
                      </td>
                    </tr>
                    {g.meters.map((m) => {
                      const d = drafts[m.id] || EMPTY_DRAFT
                      const c = calc.get(m.id)
                      const hist = readingsByMeter.get(m.id) || []
                      const dirty = dirtyIds.includes(m.id)
                      const counts = meterCountsForNormAt(m, date)
                      const item = m.norm_item_id ? itemById.get(m.norm_item_id) : null
                      return (
                        <ExpandableRow
                          key={m.id}
                          expanded={expanded.has(m.id)}
                          onToggle={() =>
                            setExpanded((prev) => {
                              const next = new Set(prev)
                              if (next.has(m.id)) next.delete(m.id)
                              else next.add(m.id)
                              return next
                            })
                          }
                          canExpand={hist.length > 0}
                          colSpan={COLS}
                          detail={<MeterHistory meter={m} readings={hist} onPreview={setPreview} />}
                        >
                          <td className="whitespace-nowrap font-code text-xs font-bold">{m.code}</td>
                          <td className="text-sm">
                            <div className="font-semibold text-slate-800">{m.name}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              <span className="text-[11px] text-slate-500">{NORM_METER_LOAI_LABEL[m.loai]}</span>
                              {counts && (
                                <StatusBadge tone="valid" label={`Định mức: ${item?.name || "?"}${m.day_chuyen ? ` · ${m.day_chuyen}` : ""}`} />
                              )}
                            </div>
                          </td>
                          <td className="text-right tabular-nums">{fmtQty(existingOnDate.get(m.id)?.he_so ?? m.he_so, 4)}</td>
                          <td className="whitespace-nowrap text-right tabular-nums text-slate-600">
                            {c?.prev ? (
                              <>
                                {fmtQty(c.prev.chi_so)}
                                <div className="text-[10px] text-slate-400">{fmtDate(c.prev.ngay)}</div>
                              </>
                            ) : (
                              <span className="text-[11px] text-slate-400">Lần ghi đầu</span>
                            )}
                          </td>
                          <td className="w-36" onClick={(e) => e.stopPropagation()}>
                            <input
                              className={`${cellInputCls} ${c?.invalid ? "border-red-400" : dirty ? "border-amber-400 bg-amber-50" : ""}`}
                              inputMode="decimal"
                              disabled={!canEdit}
                              value={d.chi_so}
                              onChange={(e) => setDraft(m.id, { chi_so: e.target.value })}
                              placeholder="—"
                            />
                          </td>
                          <td className="w-40" onClick={(e) => e.stopPropagation()}>
                            <label className="flex items-center gap-1 text-xs">
                              <input type="checkbox" disabled={!canEdit} checked={d.thay} onChange={(e) => setDraft(m.id, { thay: e.target.checked })} />
                              Thay / reset
                            </label>
                            {d.thay && (
                              <input
                                className={`${cellInputCls} mt-1`}
                                inputMode="decimal"
                                disabled={!canEdit}
                                value={d.chot}
                                onChange={(e) => setDraft(m.id, { chot: e.target.value })}
                                placeholder="Chốt ĐH cũ"
                                title="Chỉ số cuối của đồng hồ cũ lúc tháo; ô Chỉ số mới = chỉ số đầu của đồng hồ mới"
                              />
                            )}
                          </td>
                          <td className="whitespace-nowrap text-right tabular-nums">
                            {c?.value !== null && c?.value !== undefined ? (
                              <span className="font-semibold">
                                {fmtQty(c.value, 1)} <span className="text-[10px] text-slate-500">{NORM_METER_UNIT[m.loai]}</span>
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                            {c?.warnings.map((w, i) => (
                              <div key={i} className={`mt-0.5 flex max-w-[220px] items-start gap-1 whitespace-normal text-left text-[10px] ${w.level === "danger" ? "text-red-600" : "text-amber-700"}`}>
                                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                {w.text}
                              </div>
                            ))}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className={`${btnCls} px-2 py-1 text-xs`}
                              onClick={() => setImageMeterId(m.id)}
                              title="Ảnh bằng chứng (chụp mặt đồng hồ)"
                            >
                              <Camera size={13} /> {d.images.length || ""}
                            </button>
                          </td>
                          <td className="min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                            <input
                              className={`${cellInputCls} text-left`}
                              disabled={!canEdit}
                              value={d.ghi_chu}
                              onChange={(e) => setDraft(m.id, { ghi_chu: e.target.value })}
                            />
                          </td>
                        </ExpandableRow>
                      )
                    })}
                  </Fragment>
                ))}
                {groups.length === 0 && <ListState kind="empty" asRow colSpan={COLS} message="Không có đồng hồ khớp ô tìm." />}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        </div>
      )}

      {imageMeter && (
        <ModalShell
          title={`Ảnh chỉ số ${imageMeter.code} — ngày ${fmtDate(date)}`}
          onClose={() => setImageMeterId(null)}
          maxWidth="md"
          footer={
            <button type="button" className={btnPrimaryCls} onClick={() => setImageMeterId(null)}>
              Xong
            </button>
          }
        >
          {canEdit ? (
            <PurchaseImagePicker
              factoryId={factoryId}
              documentType="norms-meters"
              images={drafts[imageMeter.id]?.images || []}
              onChange={(urls) => setDraft(imageMeter.id, { images: urls })}
              max={4}
              onPreview={setPreview}
              label="Chụp mặt đồng hồ (tối đa 4 ảnh)"
            />
          ) : (
            <ImageThumbs urls={drafts[imageMeter.id]?.images || []} onPreview={setPreview} />
          )}
          <p className="mt-3 text-xs text-slate-500">Ảnh được lưu cùng chỉ số khi bấm Lưu ở bảng.</p>
        </ModalShell>
      )}

      <ImageLightbox url={preview} onClose={() => setPreview(null)} />
      <QrScanPortal open={scanOpen} onClose={() => setScanOpen(false)} onDecoded={handleScan} hintText="Đưa tem QR đồng hồ vào khung" />
    </div>
  )
}

function ImageThumbs({ urls, onPreview }: { urls: string[]; onPreview: (url: string) => void }) {
  if (!urls.length) return <span className="text-xs text-slate-400">Chưa có ảnh.</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {urls.map((u) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={u} src={u} alt="Ảnh đồng hồ" onClick={() => onPreview(u)} className="h-12 w-12 cursor-zoom-in rounded-lg border border-slate-200 object-cover" />
      ))}
    </div>
  )
}

function MeterHistory({ meter, readings, onPreview }: { meter: NormMeter; readings: NormMeterReading[]; onPreview: (url: string) => void }) {
  const rows = [...readings].reverse().slice(0, 12)
  return (
    <table className="enterprise-table dense">
      <thead>
        <tr>
          <th>Ngày ghi</th>
          <th className="text-right">Chỉ số</th>
          <th className="text-right">Hệ số</th>
          <th className="text-right">Tiêu thụ ({NORM_METER_UNIT[meter.loai]})</th>
          <th>Ghi chú</th>
          <th>Ảnh</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const idx = readings.findIndex((x) => x.id === r.id)
          const prev = idx > 0 ? readings[idx - 1] : null
          const v = prev ? stepConsumption(prev, r) : null
          return (
            <tr key={r.id}>
              <td className="whitespace-nowrap">
                {fmtDate(r.ngay)}
                {r.nhap_qua !== "tay" && <span className="ml-1 text-[10px] text-slate-400">({r.nhap_qua === "qr" ? "quét QR" : "offline"})</span>}
              </td>
              <td className="text-right tabular-nums">
                {fmtQty(r.chi_so)}
                {r.thay_dong_ho && <div className="text-[10px] text-amber-700">Thay ĐH — chốt cũ {fmtQty(r.chi_so_chot_cu)}</div>}
              </td>
              <td className="text-right tabular-nums">{fmtQty(r.he_so, 4)}</td>
              <td className={`text-right tabular-nums ${v !== null && v < 0 ? "text-red-600" : ""}`}>{v === null ? "—" : fmtQty(v, 1)}</td>
              <td className="text-xs">{r.ghi_chu || ""}</td>
              <td>
                <ImageThumbs urls={r.image_urls} onPreview={onPreview} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
