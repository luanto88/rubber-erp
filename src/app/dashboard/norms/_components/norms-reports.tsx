"use client"

// Định mức KTKT GĐ4 — tab "Báo cáo": danh sách bộ báo cáo kỳ (rule 29: StatGrid, FilterBar, dòng xổ, Quét QR),
// lập bộ báo cáo mới, cấu hình mẫu báo cáo. Rule 30.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FilePlus2, FileText, ListChecks, Search, Settings2, X } from "lucide-react"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { deleteReportDraft, loadReportList, syncReportStatuses, type BatchLite } from "@/lib/norms/report-client"
import { NORM_REPORT_PATH, fmtDateVN, type NormReport } from "@/lib/norms/report-types"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ExpandAllToggle, ExpandHeaderCell, ExpandableRow } from "@/app/dashboard/_components/doc-ui/expandable-row"
import { IconActionGroup } from "@/app/dashboard/_components/doc-ui/icon-action"
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { QrScanButton, QrScanPortal } from "@/app/dashboard/_components/qr-scan-portal"
import { NormsReportBatchForm } from "./norms-report-batch-form"
import { NormsReportTemplatesConfig } from "./norms-report-templates"
import { errText, inputCls } from "./norms-ui"

type Sub = "list" | "new" | "templates"

export function NormsReports({ factoryId, user }: { factoryId: string; user: SessionUser | null }) {
  const router = useRouter()
  const canReport = hasPermission(user, "norms.report")
  const canConfig = hasPermission(user, "norms.manage_config")
  const [sub, setSub] = useState<Sub>("list")
  const [batches, setBatches] = useState<BatchLite[]>([])
  const [reports, setReports] = useState<NormReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [scanning, setScanning] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let res = await loadReportList(factoryId)
      const pending = res.reports.filter((r) => r.trang_thai === "cho_ky").map((r) => r.id)
      if (pending.length) {
        await syncReportStatuses(pending)
        res = await loadReportList(factoryId)
      }
      setBatches(res.batches)
      setReports(res.reports)
    } catch (e) {
      setError(errText(e, "Không tải được danh sách báo cáo. Kiểm tra đã chạy migration 20261124 chưa."))
    } finally {
      setLoading(false)
    }
  }, [factoryId])

  useEffect(() => {
    if (sub === "list") void load()
  }, [sub, load])

  const byBatch = useMemo(() => {
    const m = new Map<string, NormReport[]>()
    for (const r of reports) m.set(r.batch_id, [...(m.get(r.batch_id) || []), r])
    return m
  }, [reports])

  const q = search.trim().toLowerCase()
  const visible = batches.filter((b) => {
    const rs = byBatch.get(b.id) || []
    if (!rs.length) return false
    if (status && !rs.some((r) => r.trang_thai === status)) return false
    if (!q) return true
    return rs.some((r) => `${r.ma_bao_cao || ""} ${r.template_code} ${r.template_name}`.toLowerCase().includes(q)) || `${fmtDateVN(b.tu_ngay)} ${fmtDateVN(b.den_ngay)}`.includes(q)
  })
  const count = (st: string) => reports.filter((r) => r.trang_thai === st).length

  const onScan = (text: string) => {
    setScanning(false)
    const m = text.match(/\/dashboard\/norms\/report\/([0-9a-f-]{36})/i)
    if (m) router.push(NORM_REPORT_PATH(m[1]))
    else setSearch(text.trim())
  }

  const remove = async (r: NormReport) => {
    if (!window.confirm(`Xoá báo cáo nháp ${r.template_code}?`)) return
    try {
      await deleteReportDraft(r)
      void load()
    } catch (e) {
      setError(errText(e, "Không xoá được báo cáo."))
    }
  }

  const COLS = 6
  return (
    <div className="space-y-4">
      <SegmentedTabs
        ariaLabel="Báo cáo kỳ"
        size="sm"
        value={sub}
        onChange={setSub}
        items={[
          { key: "list", label: "Danh sách", icon: ListChecks },
          ...(canReport ? [{ key: "new" as const, label: "Lập bộ báo cáo kỳ", icon: FilePlus2 }] : []),
          ...(canConfig ? [{ key: "templates" as const, label: "Mẫu báo cáo", icon: Settings2 }] : []),
        ]}
      />
      {sub === "new" && canReport ? (
        <NormsReportBatchForm factoryId={factoryId} onSaved={() => setSub("list")} />
      ) : sub === "templates" && canConfig ? (
        <NormsReportTemplatesConfig factoryId={factoryId} />
      ) : (
        <>
          <StatGrid cols={4}>
            <StatCard icon={FileText} label="Báo cáo" value={reports.filter((r) => r.trang_thai !== "huy").length} />
            <StatCard label="Nháp / Bị trả về" value={count("nhap") + count("tra_ve")} valueTone={count("tra_ve") ? "warn" : "default"} />
            <StatCard label="Chờ ký" value={count("cho_ky")} />
            <StatCard label="Đã ký" value={count("da_ky")} valueTone="good" />
          </StatGrid>
          <FilterBar layout="grid" activeCount={(search ? 1 : 0) + (status ? 1 : 0)}>
            <div className="flex h-10 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-mod-600 sm:col-span-2">
              <Search size={15} className="shrink-0 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm số báo cáo, mẫu, kỳ…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Xóa ô tìm" className="shrink-0 text-slate-400 hover:text-slate-600">
                  <X size={14} />
                </button>
              )}
              <QrScanButton onClick={() => setScanning(true)} title="Quét QR báo cáo" />
            </div>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tất cả trạng thái</option>
              <option value="nhap">Nháp</option>
              <option value="cho_ky">Chờ ký</option>
              <option value="tra_ve">Bị trả về</option>
              <option value="da_ky">Đã ký</option>
              <option value="huy">Đã huỷ</option>
            </select>
          </FilterBar>
          <QrScanPortal open={scanning} onClose={() => setScanning(false)} onDecoded={onScan} hintText="Đưa camera vào mã QR góc phải trên báo cáo" />

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-end border-b border-slate-100 px-3 py-2">
              <ExpandAllToggle
                allExpanded={visible.length > 0 && visible.every((b) => expanded.has(b.id))}
                onExpandAll={() => setExpanded(new Set(visible.map((b) => b.id)))}
                onCollapseAll={() => setExpanded(new Set())}
              />
            </div>
            <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
              <table className="enterprise-table dense min-w-[860px]">
                <thead>
                  <tr>
                    <th>Kỳ báo cáo</th>
                    <th>Kỳ đồng hồ</th>
                    <th>Mẫu trong bộ</th>
                    <th>Trạng thái</th>
                    <th>Lập lúc</th>
                    <ExpandHeaderCell />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <ListState kind="loading" asRow colSpan={COLS} />
                  ) : error ? (
                    <ListState kind="error" asRow colSpan={COLS} message={error} onRetry={() => void load()} />
                  ) : !visible.length ? (
                    <ListState kind="empty" asRow colSpan={COLS} message={canReport ? 'Chưa có báo cáo — bấm "Lập bộ báo cáo kỳ".' : "Chưa có báo cáo."} />
                  ) : (
                    visible.map((b) => {
                      const rs = byBatch.get(b.id) || []
                      return (
                        <ExpandableRow
                          key={b.id}
                          expanded={expanded.has(b.id)}
                          onToggle={() =>
                            setExpanded((prev) => {
                              const n = new Set(prev)
                              if (n.has(b.id)) n.delete(b.id)
                              else n.add(b.id)
                              return n
                            })
                          }
                          colSpan={COLS}
                          detail={
                            <table className="enterprise-table dense">
                              <thead>
                                <tr>
                                  <th>Số báo cáo</th>
                                  <th>Mẫu</th>
                                  <th>Trạng thái</th>
                                  <th className="text-right">Thao tác</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rs.map((r) => (
                                  <tr key={r.id}>
                                    <td className="whitespace-nowrap font-code text-xs font-bold">{r.ma_bao_cao || "—"}</td>
                                    <td>
                                      <div className="font-semibold">{r.template_code}</div>
                                      <div className="text-xs text-slate-500">{r.template_name}</div>
                                    </td>
                                    <td>
                                      <StatusBadge domain="norms_report" status={r.trang_thai} />
                                      {r.van_ban_document_id && <span className="ml-1 text-[11px] text-slate-500">qua Văn bản</span>}
                                    </td>
                                    <td onClick={(e) => e.stopPropagation()}>
                                      <IconActionGroup>
                                        <RowAction kind="view" href={NORM_REPORT_PATH(r.id)} />
                                        {canReport && r.trang_thai === "nhap" && <RowAction kind="delete" onClick={() => void remove(r)} />}
                                      </IconActionGroup>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          }
                        >
                          <td className="whitespace-nowrap font-semibold">
                            {fmtDateVN(b.tu_ngay)} – {fmtDateVN(b.den_ngay)}
                          </td>
                          <td className="whitespace-nowrap text-xs">{b.meter_from && b.meter_to ? `${fmtDateVN(b.meter_from)} → ${fmtDateVN(b.meter_to)}` : "—"}</td>
                          <td className="text-xs">
                            {rs.map((r, i) => (
                              <Fragment key={r.id}>
                                {i > 0 && " · "}
                                <a href={NORM_REPORT_PATH(r.id)} className="font-semibold text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                                  {r.ma_bao_cao || r.template_code}
                                </a>
                              </Fragment>
                            ))}
                          </td>
                          <td className="whitespace-nowrap">
                            {[...new Set(rs.map((r) => r.trang_thai))].map((st) => (
                              <StatusBadge key={st} domain="norms_report" status={st} className="mr-1" />
                            ))}
                          </td>
                          <td className="whitespace-nowrap text-xs text-slate-500">{fmtDateVN(b.created_at)}</td>
                        </ExpandableRow>
                      )
                    })
                  )}
                </tbody>
              </table>
            </ResponsiveTableWrapper>
          </div>
        </>
      )}
    </div>
  )
}
