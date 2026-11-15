"use client"

// Định mức KTKT GĐ3 — tab "Đối soát": chọn kỳ [Từ, Đến] + lọc nguyên liệu (loại mủ, ký hiệu KT) + kỳ đồng hồ,
// tính Định mức cho phép vs Thực tế theo từng chỉ tiêu (lib thuần compute.ts). Chỉ hiện dòng có số > 0.
// Không ghi gì vào DB. Rule 30.

import { Fragment, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Calculator, Factory, Fuel, Gauge, Truck } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { getFactoryTodayISO, getFirstDayOfMonthISO } from "@/lib/date-utils"
import { loadRequiredNotes } from "@/lib/required-notes"
import { loadNormMeterReadings, loadNormVersions } from "@/lib/norms/client"
import { suggestMeterPeriod } from "@/lib/norms/meters"
import { OUTSIDE_KIND_LABEL, isOverNorm, type ExportMovement, type OutsideRow, type ReconcileLine } from "@/lib/norms/compute"
import {
  NL_MATERIALS,
  NO_NOTE_KEY,
  loadReconcile,
  recomputeWithExclusion,
  type MovementDisplay,
  type ReconcileBundle,
} from "@/lib/norms/reconcile-loader"
import { NORM_BASIS_LABEL, NORM_UNIT_LABEL, fmtQty, type NormBasis } from "@/lib/norms/types"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ExpandAllToggle, ExpandHeaderCell, ExpandableRow } from "@/app/dashboard/_components/doc-ui/expandable-row"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { btnCls, btnPrimaryCls, errText, fmtDate, inputCls } from "./norms-ui"

const BASIS_ORDER: NormBasis[] = ["tan_tp", "tan_nl_kho", "tan_nl_tuoi", "km100"]
const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : fmtQty(v, d))

export function NormsReconcile({ factoryId, user }: { factoryId: string; user: SessionUser | null }) {
  const canExclude = hasPermission(user, "norms.report")
  const today = getFactoryTodayISO()
  const [from, setFrom] = useState(() => getFirstDayOfMonthISO(today))
  const [to, setTo] = useState(today)
  const [materials, setMaterials] = useState<string[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [noteOptions, setNoteOptions] = useState<string[]>([])
  const [readingDates, setReadingDates] = useState<string[]>([])
  const [meterFrom, setMeterFrom] = useState<string>("")
  const [meterTo, setMeterTo] = useState<string>("")
  const [meterTouched, setMeterTouched] = useState(false)
  const [hasActiveVersion, setHasActiveVersion] = useState<boolean | null>(null)
  const [useDraft, setUseDraft] = useState(false)
  const [bundle, setBundle] = useState<ReconcileBundle | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [exclTarget, setExclTarget] = useState<ExportMovement | null>(null)
  const [exclReason, setExclReason] = useState("")
  const [exclBusy, setExclBusy] = useState(false)

  /** Tick lại "Tính định mức" (xoá loại trừ) hoặc mở hộp nhập lý do để bỏ tick. */
  const toggleExport = async (mv: ExportMovement, include: boolean) => {
    if (!bundle || !canExclude || mv.legacy) return
    if (!include) {
      setExclReason("")
      setExclTarget(mv)
      return
    }
    setExclBusy(true)
    try {
      const { error: dErr } = await supabase.from("tech_norm_export_exclusions").delete().eq("factory_id", factoryId).eq("movement_id", mv.id)
      if (dErr) throw dErr
      setBundle(recomputeWithExclusion(bundle, mv.id, null))
    } catch (e) {
      setError(errText(e, "Không cập nhật được dòng xuất."))
    } finally {
      setExclBusy(false)
    }
  }

  const confirmExclude = async () => {
    if (!bundle || !exclTarget) return
    const reason = exclReason.trim()
    if (!reason) return
    setExclBusy(true)
    try {
      const { error: iErr } = await supabase
        .from("tech_norm_export_exclusions")
        .insert({ factory_id: factoryId, movement_id: exclTarget.id, ly_do: reason })
      if (iErr) throw iErr
      setBundle(recomputeWithExclusion(bundle, exclTarget.id, reason))
      setExclTarget(null)
    } catch (e) {
      setError(errText(e, "Không bỏ tick được dòng xuất. Kiểm tra đã chạy migration 20261123 chưa."))
    } finally {
      setExclBusy(false)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [rn, rd, vers] = await Promise.all([loadRequiredNotes(supabase, factoryId), loadNormMeterReadings(factoryId), loadNormVersions(factoryId)])
        setNoteOptions(rn.map((n) => n.content))
        setReadingDates([...new Set(rd.map((r) => r.ngay))].sort())
        setHasActiveVersion(vers.some((v) => v.status !== "draft"))
      } catch (e) {
        setError(errText(e, "Không tải được danh mục lọc. Kiểm tra đã chạy migration 20261122 chưa."))
      }
    })()
  }, [factoryId])

  // Gợi ý kỳ đồng hồ theo kỳ báo cáo cho tới khi người dùng tự chọn.
  useEffect(() => {
    if (meterTouched) return
    const s = suggestMeterPeriod(readingDates, from, to)
    setMeterFrom(s.fromDate || "")
    setMeterTo(s.toDate || "")
  }, [readingDates, from, to, meterTouched])

  const run = async () => {
    if (!from || !to || from > to) {
      setError("Kỳ không hợp lệ (Từ ngày phải ≤ Đến ngày).")
      return
    }
    setBusy(true)
    setError(null)
    try {
      setBundle(
        await loadReconcile(factoryId, {
          from,
          to,
          materials,
          notes,
          meterFrom: meterFrom || null,
          meterTo: meterTo || null,
          useDraft,
        }),
      )
      setExpanded(new Set())
    } catch (e) {
      setBundle(null)
      setError(errText(e, "Không tính được đối soát."))
    } finally {
      setBusy(false)
    }
  }

  const lines = useMemo(() => bundle?.result.lines || [], [bundle])
  const groups = useMemo(
    () => BASIS_ORDER.map((b) => ({ basis: b, lines: lines.filter((l) => l.basis === b) })).filter((g) => g.lines.length),
    [lines],
  )
  const overCount = lines.filter(isOverNorm).length
  const t = bundle?.result.totals
  const kmTotal = (t?.kmByType || []).reduce((s, x) => s + x.km, 0)
  const COLS = 10

  const toggle = (k: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  return (
    <div className="space-y-4">
      <FilterBar layout="grid" activeCount={materials.length + notes.length}>
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
          <span className="text-xs font-semibold text-slate-600">Ký hiệu KT (tấn NL)</span>
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
          <select
            className={inputCls}
            value={meterFrom}
            onChange={(e) => {
              setMeterTouched(true)
              setMeterFrom(e.target.value)
            }}
          >
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
          <select
            className={inputCls}
            value={meterTo}
            onChange={(e) => {
              setMeterTouched(true)
              setMeterTo(e.target.value)
            }}
          >
            <option value="">— Chọn —</option>
            {readingDates.map((d) => (
              <option key={d} value={d}>
                {fmtDate(d)}
              </option>
            ))}
          </select>
        </label>
        <div className="col-span-full flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
            {hasActiveVersion === false && (
              <label className="flex items-center gap-2 font-semibold text-amber-800">
                <input type="checkbox" checked={useDraft} onChange={(e) => setUseDraft(e.target.checked)} />
                Chưa có khung định mức đang áp dụng — xem thử bằng khung Nháp
              </label>
            )}
            {meterTouched && (
              <button type="button" className="mt-1 text-mod-800 underline" onClick={() => setMeterTouched(false)}>
                Gợi ý lại kỳ đồng hồ theo kỳ báo cáo
              </button>
            )}
          </div>
          <button type="button" className={btnPrimaryCls} disabled={busy} onClick={() => void run()}>
            <Calculator size={15} /> {busy ? "Đang tính…" : "Tính đối soát"}
          </button>
        </div>
      </FilterBar>

      {error && <ListState kind="error" message={error} />}
      {busy && !bundle && <ListState kind="loading" message="Đang gom thành phẩm, nguyên liệu, km, xuất kho…" />}
      {!busy && !bundle && !error && <ListState kind="empty" message='Chọn kỳ rồi bấm "Tính đối soát".' />}

      {bundle && t && (
        <>
          {bundle.draftUsed && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              Đang xem thử bằng khung NHÁP — số liệu chưa chính thức. Áp dụng khung ở tab Cấu hình định mức trước khi lập báo cáo.
            </div>
          )}
          <StatGrid cols={4}>
            <StatCard icon={Factory} label="Thành phẩm nhập (tấn)" value={fmt(t.tpTons, 3)} sub={t.tpTonsNoNorm > 0 ? `${fmt(t.tpTonsNoNorm, 3)} tấn không có định mức` : undefined} />
            <StatCard icon={Fuel} label="NL quy khô / tươi (tấn)" value={fmt(t.nlKhoTons, 3)} sub={`Tươi ${fmt(t.nlTuoiTons, 3)}`} />
            <StatCard icon={Truck} label="Km vận chuyển" value={fmt(kmTotal, 0)} sub={t.kmByType.slice(0, 3).map((x) => `${x.vehicleType}: ${fmt(x.km, 0)}`).join(" · ")} />
            <StatCard icon={Gauge} label="Chỉ tiêu vượt định mức" value={overCount} valueTone={overCount ? "danger" : "good"} />
          </StatGrid>

          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            Kỳ {fmtDate(from)} – {fmtDate(to)} · Khung áp dụng: {bundle.result.versionsUsed.join(", ") || "—"}
            {t.thayBocTons > 0 && ` · Thay bọc ${fmt(t.thayBocTons, 3)} tấn (cộng định mức bọc 0,04)`}
            {meterFrom && meterTo && ` · Kỳ đồng hồ ${fmtDate(meterFrom)} → ${fmtDate(meterTo)}`}
            {" · "}
            <span className="text-amber-700">Km lấy theo loại xe ở Điều xe — logic km chưa kiểm chứng.</span>
          </div>
          {bundle.result.warnings.map((w) => (
            <div key={w} className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}
            </div>
          ))}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-end border-b border-slate-100 px-3 py-2">
              <ExpandAllToggle
                allExpanded={lines.length > 0 && lines.every((l) => expanded.has(l.key))}
                onExpandAll={() => setExpanded(new Set(lines.map((l) => l.key)))}
                onCollapseAll={() => setExpanded(new Set())}
              />
            </div>
            <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
              <table className="enterprise-table dense min-w-[1100px]">
                <thead>
                  <tr>
                    <th>Chỉ tiêu</th>
                    <th>ĐVT</th>
                    <th className="text-right">Cơ sở tính</th>
                    <th className="text-right">Thực tế</th>
                    <th className="text-right">Định mức</th>
                    <th className="text-right">BQ thực tế</th>
                    <th className="text-right">BQ định mức</th>
                    <th className="text-right">Chênh SL</th>
                    <th className="text-right">Chênh %</th>
                    <ExpandHeaderCell />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.basis}>
                      <tr className="bg-slate-50">
                        <td colSpan={COLS} className="text-xs font-bold text-slate-700">
                          Định mức theo {NORM_BASIS_LABEL[g.basis]}
                        </td>
                      </tr>
                      {g.lines.map((l) => (
                        <LineRow
                          key={l.key}
                          line={l}
                          expanded={expanded.has(l.key)}
                          onToggle={() => toggle(l.key)}
                          colSpan={COLS}
                          movementInfo={bundle.movementInfo}
                          canExclude={canExclude && !exclBusy}
                          onToggleExport={(mv, inc) => void toggleExport(mv, inc)}
                        />
                      ))}
                    </Fragment>
                  ))}
                  {!groups.length && <ListState kind="empty" asRow colSpan={COLS} message="Không có chỉ tiêu nào có định mức hoặc phát sinh trong kỳ." />}
                </tbody>
              </table>
            </ResponsiveTableWrapper>
          </div>

          <OutsideSection
            rows={bundle.result.outside}
            movementInfo={bundle.movementInfo}
            canExclude={canExclude && !exclBusy}
            onToggleExport={(mv, inc) => void toggleExport(mv, inc)}
            categoriesConfigured={bundle.categoriesConfigured}
          />
        </>
      )}

      {exclTarget && (
        <ModalShell
          title="Bỏ tick tính định mức"
          onClose={() => setExclTarget(null)}
          maxWidth="md"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className={btnCls} onClick={() => setExclTarget(null)}>
                Huỷ
              </button>
              <button type="button" className={btnPrimaryCls} disabled={exclBusy || !exclReason.trim()} onClick={() => void confirmExclude()}>
                {exclBusy ? "Đang lưu…" : "Bỏ tick"}
              </button>
            </div>
          }
        >
          <p className="text-sm text-slate-700">
            Dòng xuất {bundle?.movementInfo[exclTarget.id]?.documentCode || ""} ngày {fmtDate(exclTarget.ngay)} — {fmt(exclTarget.qty, 3)} sẽ KHÔNG
            tính vào thực tế định mức, chuyển sang mục &quot;Phát sinh ngoài định mức&quot;. Áp dụng cho mọi báo cáo có ngày này.
          </p>
          <label className="mt-3 block space-y-1">
            <span className="text-xs font-semibold text-slate-600">Lý do *</span>
            <textarea
              className={`${inputCls} h-20 py-2`}
              value={exclReason}
              onChange={(e) => setExclReason(e.target.value)}
              placeholder="vd Xuất đóng gói mủ thu mua bán lại / dùng cho XLNT"
              autoFocus
            />
          </label>
        </ModalShell>
      )}
    </div>
  )
}

function ExportLinesTable({
  lines,
  movementInfo,
  canExclude,
  onToggle,
}: {
  lines: ExportMovement[]
  movementInfo: Record<string, MovementDisplay>
  canExclude: boolean
  onToggle: (mv: ExportMovement, include: boolean) => void
}) {
  if (!lines.length) return null
  const sorted = [...lines].sort((a, b) => a.ngay.localeCompare(b.ngay))
  return (
    <table className="enterprise-table dense">
      <thead>
        <tr>
          <th>Tính ĐM</th>
          <th>Ngày</th>
          <th>Phiếu xuất</th>
          <th>Ghi chú</th>
          <th className="text-right">Số lượng</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((mv) => {
          const info = movementInfo[mv.id]
          return (
            <tr key={mv.id} className={mv.excludedReason ? "bg-amber-50/60" : undefined}>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={!mv.excludedReason}
                  disabled={!canExclude || !!mv.legacy}
                  title={
                    mv.legacy
                      ? "Phiếu cũ (AppSheet) — luôn tính; dòng trùng phiếu app cần loại ở script import (EXCLUDE)"
                      : canExclude
                        ? "Bỏ tick = không tính dòng xuất này vào định mức"
                        : "Cần quyền lập báo cáo định mức"
                  }
                  onChange={(e) => onToggle(mv, e.target.checked)}
                />
              </td>
              <td className="whitespace-nowrap">{fmtDate(mv.ngay)}</td>
              <td className="whitespace-nowrap font-code text-xs">
                {info?.documentId ? (
                  <a
                    href={`/dashboard/inventory/document/issue/${info.documentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-700 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {info.documentCode || "Xem phiếu"}
                  </a>
                ) : (
                  info?.documentCode || ""
                )}
              </td>
              <td className="text-xs">
                {info?.note || ""}
                {mv.excludedReason && <div className="font-semibold text-amber-800">Bỏ tick: {mv.excludedReason}</div>}
              </td>
              <td className="text-right tabular-nums">{fmt(mv.qty, 3)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function OutsideSection({
  rows,
  movementInfo,
  canExclude,
  onToggleExport,
  categoriesConfigured,
}: {
  rows: OutsideRow[]
  movementInfo: Record<string, MovementDisplay>
  canExclude: boolean
  onToggleExport: (mv: ExportMovement, include: boolean) => void
  categoriesConfigured: boolean
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const COLS = 6
  const kinds = [...new Set(rows.map((r) => r.kind))]
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-800">Phát sinh ngoài định mức (chỉ hiển thị, không so sánh)</div>
        {!categoriesConfigured && (
          <span className="text-xs text-amber-700">
            Chưa chọn nhóm vật tư báo cáo — đang dùng nhóm của các mã đã gắn (Nhập liệu → Danh mục).
          </span>
        )}
      </div>
      {!rows.length ? (
        <ListState kind="empty" message="Không có phát sinh ngoài định mức trong kỳ." />
      ) : (
        <ResponsiveTableWrapper>
          <table className="enterprise-table dense min-w-[860px]">
            <thead>
              <tr>
                <th>Nhóm / Khu vực</th>
                <th>Mã</th>
                <th>Tên</th>
                <th className="text-right">Số lượng</th>
                <th>Ghi chú / Lý do</th>
                <ExpandHeaderCell />
              </tr>
            </thead>
            <tbody>
              {kinds.map((kind) => (
                <Fragment key={kind}>
                  <tr className="bg-slate-50">
                    <td colSpan={COLS} className="text-xs font-bold text-slate-700">
                      {OUTSIDE_KIND_LABEL[kind]}
                    </td>
                  </tr>
                  {rows
                    .filter((r) => r.kind === kind)
                    .map((r) => (
                      <ExpandableRow
                        key={r.key}
                        expanded={open.has(r.key)}
                        onToggle={() =>
                          setOpen((prev) => {
                            const next = new Set(prev)
                            if (next.has(r.key)) next.delete(r.key)
                            else next.add(r.key)
                            return next
                          })
                        }
                        canExpand={r.exportLines.length > 0}
                        colSpan={COLS}
                        detail={
                          <ExportLinesTable lines={r.exportLines} movementInfo={movementInfo} canExclude={canExclude} onToggle={onToggleExport} />
                        }
                      >
                        <td className="text-xs text-slate-600">{r.group}</td>
                        <td className="whitespace-nowrap font-code text-xs font-bold">{r.code}</td>
                        <td>{r.name}</td>
                        <td className="whitespace-nowrap text-right tabular-nums font-semibold">
                          {r.qty === null ? "—" : fmt(r.qty, 3)} <span className="text-[10px] font-normal text-slate-500">{r.unit}</span>
                        </td>
                        <td className="text-xs text-slate-600">{r.note}</td>
                      </ExpandableRow>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}
    </div>
  )
}

function LineRow({
  line: l,
  expanded,
  onToggle,
  colSpan,
  movementInfo,
  canExclude,
  onToggleExport,
}: {
  line: ReconcileLine
  expanded: boolean
  onToggle: () => void
  colSpan: number
  movementInfo: Record<string, MovementDisplay>
  canExclude: boolean
  onToggleExport: (mv: ExportMovement, include: boolean) => void
}) {
  const over = isOverNorm(l)
  const unitText = `${NORM_UNIT_LABEL[l.unit]}`
  const basisUnit = l.basis === "km100" ? "km" : "tấn"
  const avgUnit = l.basis === "km100" ? "/100km" : "/tấn"
  return (
    <ExpandableRow
      expanded={expanded}
      onToggle={onToggle}
      colSpan={colSpan}
      canExpand={l.breakdown.length > 0 || l.notes.length > 0 || l.warnings.length > 0 || l.exportLines.length > 0}
      detail={
        <div className="space-y-2 py-1">
          {l.breakdown.length > 0 && (
            <table className="enterprise-table dense">
              <thead>
                <tr>
                  <th>Dòng định mức</th>
                  <th className="text-right">Cơ sở ({basisUnit})</th>
                  <th className="text-right">Định mức ({unitText}{l.basis === "km100" ? "/km" : "/tấn"})</th>
                  <th className="text-right">Cho phép ({unitText})</th>
                </tr>
              </thead>
              <tbody>
                {l.breakdown.map((b) => (
                  <tr key={`${b.label}-${b.norm}`}>
                    <td>{b.label}</td>
                    <td className="text-right tabular-nums">{fmt(b.driver, 3)}</td>
                    <td className="text-right tabular-nums">{fmt(b.norm, 4)}</td>
                    <td className="text-right tabular-nums">{fmt(b.allowed, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {l.notes.map((n) => (
            <div key={n} className="text-xs text-slate-600">
              {n}
            </div>
          ))}
          {l.warnings.map((w) => (
            <div key={w} className="flex items-start gap-1 text-xs font-semibold text-amber-800">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
            </div>
          ))}
          {l.exportLines.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-bold text-slate-600">Dòng xuất kho trong kỳ — bỏ tick dòng không dùng cho sản xuất</div>
              <ExportLinesTable lines={l.exportLines} movementInfo={movementInfo} canExclude={canExclude} onToggle={onToggleExport} />
            </div>
          )}
        </div>
      }
    >
      <td>
        <div className="font-semibold text-slate-800">
          {l.itemName}
          {l.dayChuyen && <span className="font-normal text-slate-500"> · {l.dayChuyen}</span>}
        </div>
        {l.warnings.length > 0 && (
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700">
            <AlertTriangle size={11} /> {l.warnings.length} lưu ý
          </div>
        )}
      </td>
      <td className="text-xs">{unitText}</td>
      <td className="whitespace-nowrap text-right tabular-nums">
        {fmt(l.driver, l.basis === "km100" ? 0 : 3)} <span className="text-[10px] text-slate-400">{basisUnit}</span>
      </td>
      <td className="text-right tabular-nums font-semibold">{fmt(l.actual)}</td>
      <td className="text-right tabular-nums">{fmt(l.allowed)}</td>
      <td className="whitespace-nowrap text-right tabular-nums">
        {fmt(l.avgActual, 3)}
        {l.avgActual !== null && <span className="text-[10px] text-slate-400">{avgUnit}</span>}
      </td>
      <td className="whitespace-nowrap text-right tabular-nums">
        {fmt(l.avgNorm, 3)}
        {l.avgNorm !== null && <span className="text-[10px] text-slate-400">{avgUnit}</span>}
      </td>
      <td className={`text-right tabular-nums font-semibold ${over ? "text-red-600" : "text-emerald-700"}`}>
        {l.diff === null ? "—" : `${l.diff > 0 ? "+" : ""}${fmt(l.diff)}`}
      </td>
      <td className="whitespace-nowrap text-right">
        {l.diffPct === null ? (
          <span className="text-slate-300">—</span>
        ) : (
          <StatusBadge tone={over ? "danger" : "valid"} label={`${l.diffPct > 0 ? "+" : ""}${fmtQty(l.diffPct, 2)}%`} />
        )}
      </td>
    </ExpandableRow>
  )
}
