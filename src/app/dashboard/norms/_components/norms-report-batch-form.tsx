"use client"

// Định mức KTKT GĐ4 — "Lập bộ báo cáo kỳ": chọn kỳ + bộ lọc NL + kỳ đồng hồ 1 lần, tính snapshot dùng chung,
// tick mẫu (8A / 09 / VT HC / 12B…), nhập giải trình dòng vượt (bắt buộc) + kiến nghị, xem trước PDF chưa ký,
// lưu bộ rồi gửi ký các mẫu. Rule 30.

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Calculator, Save } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getFactoryTodayISO, getFirstDayOfMonthISO, addDaysISO } from "@/lib/date-utils"
import { loadRequiredNotes } from "@/lib/required-notes"
import { THU_MUA_NOTE } from "@/lib/lot-source"
import { loadNormMeterReadings, loadNormVersions } from "@/lib/norms/client"
import { suggestMeterPeriod } from "@/lib/norms/meters"
import { NL_MATERIALS, NO_NOTE_KEY, loadReconcile } from "@/lib/norms/reconcile-loader"
import { buildReportSnapshot } from "@/lib/norms/report-loader"
import { buildReportPdf, createReportBatch, loadReportList, loadReportTemplates } from "@/lib/norms/report-client"
import { lineTitle, overLines } from "@/lib/norms/report-templates"
import { fmtQty } from "@/lib/norms/types"
import type { NormReport, NormReportSnapshot, NormReportTemplate } from "@/lib/norms/report-types"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { NormsReportSendDialog } from "./norms-report-send"
import { btnPrimaryCls, errText, fmtDate, inputCls } from "./norms-ui"

/** Báo cáo tạm (chưa lưu) để dựng bản xem trước. */
function previewReport(t: NormReportTemplate, factoryId: string, giaiTrinh: Record<string, string>, kienNghi: string): NormReport {
  const now = new Date().toISOString()
  return {
    id: "00000000-0000-0000-0000-000000000000",
    factory_id: factoryId,
    batch_id: "",
    template_id: t.id,
    template_code: t.code,
    template_name: t.name,
    template_kieu: t.kieu,
    template_phien_ban: t.phien_ban,
    config: t.config || {},
    khoa_ngay: t.khoa_ngay,
    phong_ban: t.phong_ban,
    loai_van_ban: t.loai_van_ban,
    nam: null,
    so: null,
    ma_bao_cao: null,
    trang_thai: "nhap",
    giai_trinh: giaiTrinh,
    kien_nghi: kienNghi,
    nguoi_lap_id: null,
    bgd_id: null,
    yeu_cau_ky_id: null,
    van_ban_document_id: null,
    du_lieu_hash: null,
    khoa_tu: null,
    khoa_den: null,
    gui_ky_luc: null,
    da_ky_luc: null,
    ly_do_huy: null,
    created_by: null,
    created_at: now,
    updated_at: now,
  }
}

export function NormsReportBatchForm({ factoryId, onSaved }: { factoryId: string; onSaved: () => void }) {
  const today = getFactoryTodayISO()
  // Mặc định: tháng trước (báo cáo lập đầu tháng sau).
  const lastMonthEnd = addDaysISO(getFirstDayOfMonthISO(today), -1)
  const [from, setFrom] = useState(() => getFirstDayOfMonthISO(lastMonthEnd))
  const [to, setTo] = useState(lastMonthEnd)
  const [materials, setMaterials] = useState<string[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [noteOptions, setNoteOptions] = useState<string[]>([])
  const [readingDates, setReadingDates] = useState<string[]>([])
  const [meterFrom, setMeterFrom] = useState("")
  const [meterTo, setMeterTo] = useState("")
  const [meterTouched, setMeterTouched] = useState(false)
  const [hasActiveVersion, setHasActiveVersion] = useState<boolean | null>(null)
  const [useDraft, setUseDraft] = useState(false)
  const [templates, setTemplates] = useState<NormReportTemplate[]>([])
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [snapshot, setSnapshot] = useState<NormReportSnapshot | null>(null)
  const [giaiTrinh, setGiaiTrinh] = useState<Record<string, string>>({})
  const [kienNghi, setKienNghi] = useState("")
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<NormReport[] | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [rn, rd, vers, tpls] = await Promise.all([
          loadRequiredNotes(supabase, factoryId),
          loadNormMeterReadings(factoryId),
          loadNormVersions(factoryId),
          loadReportTemplates(factoryId),
        ])
        const opts = rn.map((n) => n.content)
        setNoteOptions(opts)
        // Mặc định bỏ "TM" (thu mua dùng xe ngoài) ⇒ tấn NL quy khô = nông trường (đã chốt).
        setNotes([NO_NOTE_KEY, ...opts.filter((o) => o.trim().toUpperCase() !== THU_MUA_NOTE)])
        setReadingDates([...new Set(rd.map((r) => r.ngay))].sort())
        setHasActiveVersion(vers.some((v) => v.status !== "draft"))
        const active = tpls.filter((t) => t.is_active)
        setTemplates(active)
        setTicked(new Set(active.map((t) => t.id)))
      } catch (e) {
        setError(errText(e, "Không tải được danh mục. Kiểm tra đã chạy migration 20261124 chưa."))
      }
    })()
  }, [factoryId])

  useEffect(() => {
    if (meterTouched) return
    const s = suggestMeterPeriod(readingDates, from, to)
    setMeterFrom(s.fromDate || "")
    setMeterTo(s.toDate || "")
  }, [readingDates, from, to, meterTouched])

  const compute = async () => {
    if (!from || !to || from > to) {
      setError("Kỳ không hợp lệ (Từ ngày phải ≤ Đến ngày).")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const f = { from, to, materials, notes, meterFrom: meterFrom || null, meterTo: meterTo || null, useDraft }
      const bundle = await loadReconcile(factoryId, f)
      setSnapshot(await buildReportSnapshot(factoryId, f, bundle))
      setPreviewId(null)
    } catch (e) {
      setSnapshot(null)
      setError(errText(e, "Không tính được dữ liệu báo cáo."))
    } finally {
      setBusy(false)
    }
  }

  const chosen = templates.filter((t) => ticked.has(t.id))
  const has8a = chosen.some((t) => t.kieu === "thang_8a")
  const over = useMemo(() => (snapshot ? overLines(snapshot) : []), [snapshot])
  const missing = has8a ? over.filter((l) => !String(giaiTrinh[l.key] || "").trim()) : []
  const preview = chosen.find((t) => t.id === previewId) || chosen[0] || null

  const save = async () => {
    if (!snapshot || !chosen.length) return
    if (snapshot.draftUsed) {
      setError("Đang xem thử bằng khung NHÁP — áp dụng khung định mức trước khi lưu bộ báo cáo.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { batchId } = await createReportBatch(factoryId, snapshot, chosen, { giaiTrinh, kienNghi })
      const { reports } = await loadReportList(factoryId)
      setSaved(reports.filter((r) => r.batch_id === batchId))
    } catch (e) {
      setError(errText(e, "Không lưu được bộ báo cáo."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <FilterBar layout="grid" activeCount={materials.length}>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Từ ngày</span>
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Đến ngày</span>
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="space-y-1">
          <span className="text-xs font-semibold text-slate-600">Loại nguyên liệu (tấn NL)</span>
          <FilterMultiSelect
            fullWidth
            options={NL_MATERIALS.map((m) => m.key)}
            labels={Object.fromEntries(NL_MATERIALS.map((m) => [m.key, m.label]))}
            selected={materials}
            onChange={setMaterials}
            placeholder="Tất cả loại mủ"
            searchPlaceholder="Tìm loại mủ..."
          />
        </div>
        <div className="space-y-1">
          <span className="text-xs font-semibold text-slate-600">Ký hiệu KT (tấn NL — mặc định bỏ TM)</span>
          <FilterMultiSelect
            fullWidth
            options={[NO_NOTE_KEY, ...noteOptions]}
            labels={{ [NO_NOTE_KEY]: "(Không ký hiệu)" }}
            selected={notes}
            onChange={setNotes}
            placeholder="Tất cả ký hiệu"
            searchPlaceholder="Tìm ký hiệu..."
          />
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Kỳ đồng hồ — lần ghi cũ</span>
          <select className={inputCls} value={meterFrom} onChange={(e) => (setMeterTouched(true), setMeterFrom(e.target.value))}>
            <option value="">— Chọn —</option>
            {readingDates.map((d) => (
              <option key={d} value={d}>
                {fmtDate(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Kỳ đồng hồ — lần ghi mới</span>
          <select className={inputCls} value={meterTo} onChange={(e) => (setMeterTouched(true), setMeterTo(e.target.value))}>
            <option value="">— Chọn —</option>
            {readingDates.map((d) => (
              <option key={d} value={d}>
                {fmtDate(d)}
              </option>
            ))}
          </select>
        </label>
        <div className="col-span-full flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-slate-600">Mẫu báo cáo:</span>
              {templates.map((t) => (
                <label key={t.id} className="flex items-center gap-1.5 font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={ticked.has(t.id)}
                    onChange={(e) =>
                      setTicked((prev) => {
                        const n = new Set(prev)
                        if (e.target.checked) n.add(t.id)
                        else n.delete(t.id)
                        return n
                      })
                    }
                  />
                  {t.code}
                </label>
              ))}
              {!templates.length && <span className="text-amber-700">Chưa có mẫu báo cáo (chạy migration 20261124).</span>}
            </div>
            {hasActiveVersion === false && (
              <label className="flex items-center gap-2 font-semibold text-amber-800">
                <input type="checkbox" checked={useDraft} onChange={(e) => setUseDraft(e.target.checked)} />
                Chưa có khung định mức đang áp dụng — xem thử bằng khung Nháp (không lưu được)
              </label>
            )}
          </div>
          <button type="button" className={btnPrimaryCls} disabled={busy} onClick={() => void compute()}>
            <Calculator size={15} /> {busy && !snapshot ? "Đang tính…" : "Tính dữ liệu"}
          </button>
        </div>
      </FilterBar>

      {error && <ListState kind="error" message={error} />}
      {!snapshot && !error && <ListState kind="empty" message='Chọn kỳ, tick mẫu rồi bấm "Tính dữ liệu".' />}

      {snapshot && (
        <>
          <StatGrid cols={4}>
            <StatCard label="Thành phẩm (tấn)" value={fmtQty(snapshot.totals.tpTons, 3)} />
            <StatCard label="NL quy khô theo lọc (tấn)" value={fmtQty(snapshot.totals.nlKhoTons, 3)} />
            <StatCard label="Chỉ tiêu so sánh" value={snapshot.lines.length} />
            <StatCard label="Vượt định mức" value={over.length} valueTone={over.length ? "danger" : "good"} />
          </StatGrid>
          {snapshot.draftUsed && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Đang xem thử bằng khung NHÁP — không lưu / gửi ký được.
            </div>
          )}

          {has8a && over.length > 0 && (
            <div className="space-y-2 rounded-2xl border border-red-200 bg-white p-3">
              <div className="text-sm font-bold text-red-800">Giải trình chỉ tiêu vượt định mức (mục 10 Mẫu 8A — bắt buộc)</div>
              {over.map((l) => (
                <label key={l.key} className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    {lineTitle(l)}: thực tế {fmtQty(l.actual ?? 0, 2)} / định mức {fmtQty(l.allowed, 2)} (+{fmtQty(l.diffPct ?? 0, 2)}%)
                  </span>
                  <textarea
                    className={`${inputCls} h-16 py-2`}
                    value={giaiTrinh[l.key] || ""}
                    onChange={(e) => setGiaiTrinh((g) => ({ ...g, [l.key]: e.target.value }))}
                    placeholder="Nguyên nhân vượt định mức…"
                  />
                </label>
              ))}
            </div>
          )}
          {has8a && (
            <label className="block space-y-1 rounded-2xl border border-slate-200 bg-white p-3">
              <span className="text-sm font-bold text-slate-800">11. Kiến nghị (tuỳ chọn)</span>
              <textarea className={`${inputCls} h-20 py-2`} value={kienNghi} onChange={(e) => setKienNghi(e.target.value)} />
            </label>
          )}

          {chosen.length > 0 && preview && (
            <div className="space-y-2">
              <SegmentedTabs
                ariaLabel="Xem trước mẫu"
                value={preview.id}
                onChange={setPreviewId}
                items={chosen.map((t) => ({ key: t.id, label: t.code }))}
              />
              <DocViewer
                active
                kind="pdf"
                label={`Bản xem trước (chưa ký) · ${preview.code}`}
                sourceKey={`${preview.id}|${snapshot.from}|${snapshot.to}|${Object.values(giaiTrinh).join("|").length}|${kienNghi.length}`}
                loadBytes={async () => (await buildReportPdf(previewReport(preview, factoryId, giaiTrinh, kienNghi), snapshot)).bytes}
                heightClass="h-[70vh]"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {missing.length > 0 && <span className="text-xs font-semibold text-red-700">Còn {missing.length} dòng vượt chưa giải trình (lưu được, chưa gửi ký được).</span>}
            <button type="button" className={btnPrimaryCls} disabled={busy || !chosen.length || snapshot.draftUsed} onClick={() => void save()}>
              <Save size={15} /> Lưu bộ báo cáo ({chosen.length} mẫu)
            </button>
          </div>
        </>
      )}

      {saved && snapshot && (
        <NormsReportSendDialog
          reports={saved}
          snapshot={snapshot}
          onClose={() => {
            setSaved(null)
            onSaved()
          }}
          onDone={() => {
            setSaved(null)
            onSaved()
          }}
        />
      )}
    </div>
  )
}
