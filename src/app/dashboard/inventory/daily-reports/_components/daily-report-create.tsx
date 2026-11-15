"use client"

// Kho vật tư — "Lập báo cáo" sử dụng theo ngày: chọn mẫu + kỳ → Tính dữ liệu → xem trước PDF (dựng lại CHỈ khi bấm Tính)
// + Tải Excel → Lưu Nháp ⇒ mở trang chi tiết để Gửi ký. Rule 13 / 29.

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Calculator, FileSpreadsheet, Save } from "lucide-react"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import {
  buildDailyPdf,
  computeDailySnapshot,
  createDailyReport,
  downloadDailyXlsx,
  loadDailyTemplates,
  type DailyReportLite,
} from "@/lib/inventory-daily-report/client"
import { fmtNum } from "@/lib/inventory-daily-report/pdf"
import { DAILY_REPORT_PATH, fmtDateVN, fmtDayShort, type DailyReportSnapshot, type DailyReportTemplate } from "@/lib/inventory-daily-report/types"
import { btnCls, btnPrimaryCls, dailyErrText, inputCls, monthRange } from "./daily-ui"

export function DailyReportCreate({ factoryId, existing }: { factoryId: string; existing: DailyReportLite[] }) {
  const router = useRouter()
  const init = monthRange(getFactoryTodayISO(), -1)
  const [templates, setTemplates] = useState<DailyReportTemplate[] | null>(null)
  const [templateId, setTemplateId] = useState("")
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [snap, setSnap] = useState<DailyReportSnapshot | null>(null)
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const t = (await loadDailyTemplates(factoryId)).filter((x) => x.is_active)
        setTemplates(t)
        setTemplateId((cur) => cur || t[0]?.id || "")
      } catch (e) {
        setError(dailyErrText(e, "Không tải được mẫu báo cáo."))
        setTemplates([])
      }
    })()
  }, [factoryId])

  const tpl = templates?.find((t) => t.id === templateId) || null
  const dup = useMemo(
    () => existing.find((r) => r.template_id === templateId && r.trang_thai !== "huy" && r.tu_ngay === from && r.den_ngay === to) || null,
    [existing, templateId, from, to],
  )
  // Bản nháp tạm cho xem trước (chưa lưu) — id rỗng ⇒ QR trỏ trang danh sách.
  const draft = tpl && snap ? { id: "", template_name: tpl.name, config: tpl.config || {}, snapshot: snap, ma_bao_cao: null, phong_ban: "NMCB", loai_van_ban: "BC", tu_ngay: snap.from } : null

  const setMonth = (ym: string) => {
    if (!/^\d{4}-\d{2}$/.test(ym)) return
    const r = monthRange(`${ym}-01`)
    setFrom(r.from)
    setTo(r.to)
  }

  const compute = async () => {
    if (!tpl) return
    if (!from || !to || from > to) return setError("Kỳ không hợp lệ (Từ ngày phải ≤ Đến ngày).")
    setBusy(true)
    setError(null)
    try {
      setSnap(await computeDailySnapshot(factoryId, tpl, from, to))
      setNonce((n) => n + 1)
    } catch (e) {
      setSnap(null)
      setError(dailyErrText(e, "Không tính được số liệu."))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!tpl || !snap) return
    if (dup && !window.confirm(`Đã có báo cáo cùng mẫu và kỳ (${dup.ma_bao_cao || "Nháp"}). Vẫn lưu thêm?`)) return
    setBusy(true)
    setError(null)
    try {
      const id = await createDailyReport(factoryId, tpl, snap)
      router.push(DAILY_REPORT_PATH(id))
    } catch (e) {
      setError(dailyErrText(e, "Không lưu được báo cáo."))
      setBusy(false)
    }
  }

  if (templates === null) return <ListState kind="loading" />
  return (
    <div className="space-y-4">
      <FilterBar layout="grid" activeCount={0}>
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs font-semibold text-slate-600">Mẫu báo cáo</span>
          <select className={inputCls} value={templateId} onChange={(e) => (setTemplateId(e.target.value), setSnap(null))}>
            {!templates.length && <option value="">— Chưa có mẫu (vào thẻ Mẫu báo cáo) —</option>}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.config?.maMau ? ` (${t.config.maMau})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Tháng</span>
          <input type="month" className={inputCls} value={from.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Từ ngày</span>
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Đến ngày</span>
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="flex items-end justify-end">
          <button type="button" className={btnPrimaryCls} disabled={busy || !tpl} onClick={() => void compute()}>
            <Calculator size={15} /> {busy && !snap ? "Đang tính…" : "Tính dữ liệu"}
          </button>
        </div>
      </FilterBar>

      {error && <ListState kind="error" message={error} />}
      {dup && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Đã có báo cáo cùng mẫu và kỳ: {dup.ma_bao_cao || "Nháp"} ({fmtDateVN(dup.tu_ngay)} – {fmtDateVN(dup.den_ngay)}).
        </div>
      )}
      {!snap && !error && <ListState kind="empty" message='Chọn mẫu, kỳ rồi bấm "Tính dữ liệu".' />}

      {snap && tpl && draft && (
        <>
          <StatGrid cols={4}>
            <StatCard label="Số ngày" value={snap.days.length} />
            <StatCard label="Số cột" value={snap.columns.length} />
            <StatCard label="Cột có phát sinh" value={snap.columns.filter((c) => Math.abs(c.total) > 1e-9).length} />
            <StatCard label="Ô lấy từ dữ liệu lịch sử" value={snap.legacyCells} valueTone={snap.legacyCells ? "warn" : "default"} />
          </StatGrid>
          {snap.warnings.map((w) => (
            <div key={w} className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {w}
            </div>
          ))}
          <ResponsiveTableWrapper>
            <table className="enterprise-table dense min-w-[760px]">
              <thead>
                <tr>
                  <th>Ngày</th>
                  {snap.columns.map((c, j) => (
                    <th key={j} className="text-right">
                      {c.label}
                      {c.subLabel && <div className="text-[10px] font-normal text-slate-500">{c.subLabel}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snap.days.map((d, i) => (
                  <tr key={d}>
                    <td className="whitespace-nowrap">{fmtDayShort(d)}</td>
                    {snap.values[i].map((v, j) => (
                      <td key={j} className={`text-right tabular-nums ${v ? "font-semibold" : "text-slate-400"}`}>
                        {fmtNum(v)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td>Tổng</td>
                  {snap.columns.map((c, j) => (
                    <td key={j} className="text-right tabular-nums">
                      {fmtNum(c.total)}
                    </td>
                  ))}
                </tr>
                {snap.kieu === "dau_12b" && (
                  <tr className="bg-slate-50 font-bold">
                    <td>Tổng cộng</td>
                    <td colSpan={snap.columns.length} className="text-center tabular-nums">
                      {fmtNum(snap.grandTotal)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
          <DocViewer active kind="pdf" label={`Bản xem trước (chưa ký) · ${tpl.name}`} sourceKey={`${tpl.id}|${nonce}`} loadBytes={async () => (await buildDailyPdf(draft)).bytes} heightClass="h-[70vh]" />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={btnCls} onClick={() => void downloadDailyXlsx(draft)}>
              <FileSpreadsheet size={15} /> Tải Excel
            </button>
            <button type="button" className={btnPrimaryCls} disabled={busy} onClick={() => void save()}>
              <Save size={15} /> Lưu báo cáo (Nháp)
            </button>
          </div>
        </>
      )}
    </div>
  )
}
