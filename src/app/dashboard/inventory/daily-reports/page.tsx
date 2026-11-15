"use client"

// Kho vật tư → Báo cáo → "Sử dụng theo ngày" (mẫu 55-BC VT HC, 46-BC Mẫu 12B dầu): danh sách báo cáo (rule 29: StatGrid,
// FilterBar, Quét QR, con mắt = chi tiết 70/30), lập báo cáo, cấu hình mẫu (tick vật tư). Quyền inventory.daily_report;
// sửa mẫu cần inventory.settings. Rule 13.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { FilePlus2, FileSpreadsheet, FileText, ListChecks, Search, Settings2, X } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import {
  deleteDailyReportDraft,
  downloadDailyPdf,
  downloadDailyXlsx,
  loadDailyReport,
  loadDailyReportList,
  syncDailyReportStatuses,
  dailyReportFileName,
  type DailyReportLite,
} from "@/lib/inventory-daily-report/client"
import { DAILY_REPORT_PATH, fmtDateVN, type DailyReportStatus } from "@/lib/inventory-daily-report/types"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { IconAction, IconActionGroup } from "@/app/dashboard/_components/doc-ui/icon-action"
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { QrScanButton, QrScanPortal } from "@/app/dashboard/_components/qr-scan-portal"
import { openSecureFile } from "@/app/dashboard/_components/secure-file-open"
import { InventoryPageShell } from "../_components/inventory-shell"
import { DailyReportCreate } from "./_components/daily-report-create"
import { DailyTemplatesConfig } from "./_components/daily-templates"
import { dailyErrText, inputCls } from "./_components/daily-ui"

type Sub = "list" | "new" | "templates"

export default function InventoryDailyReportsPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [sub, setSub] = useState<Sub>("list")
  const [list, setList] = useState<DailyReportLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [scanning, setScanning] = useState(false)
  const [toast, setToast] = useState<{ kind: "ok" | "error"; msg: string } | null>(null)

  useEffect(() => {
    void (async () => {
      const { user: u } = await hydrateActiveSession().catch(() => ({ user: null }))
      setUser(u)
      setFactoryId(await getActiveFactoryId())
      setReady(true)
    })()
  }, [])

  const canReport = hasPermission(user, "inventory.daily_report")
  const canConfig = canReport && hasPermission(user, "inventory.settings")

  const load = useCallback(async () => {
    if (!factoryId) return
    setLoading(true)
    setError(null)
    try {
      let rows = await loadDailyReportList(factoryId)
      const pending = rows.filter((r) => r.trang_thai === "cho_ky").map((r) => r.id)
      if (pending.length) {
        await syncDailyReportStatuses(pending)
        rows = await loadDailyReportList(factoryId)
      }
      setList(rows)
    } catch (e) {
      setError(dailyErrText(e, "Không tải được danh sách báo cáo."))
    } finally {
      setLoading(false)
    }
  }, [factoryId])

  useEffect(() => {
    if (canReport && factoryId) void load()
  }, [canReport, factoryId, load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const q = search.trim().toLowerCase()
  const visible = list.filter((r) => {
    if (status && r.trang_thai !== status) return false
    if (!q) return true
    return `${r.ma_bao_cao || ""} ${r.template_name} ${fmtDateVN(r.tu_ngay)} ${fmtDateVN(r.den_ngay)} ${r.tu_ngay.slice(5, 7)}/${r.tu_ngay.slice(0, 4)}`.toLowerCase().includes(q)
  })
  const count = (st: DailyReportStatus) => list.filter((r) => r.trang_thai === st).length

  const onScan = (text: string) => {
    setScanning(false)
    const m = text.match(/\/dashboard\/inventory\/daily-reports\/([0-9a-f-]{36})/i)
    if (m) router.push(DAILY_REPORT_PATH(m[1]))
    else setSearch(text.trim())
  }

  const withFull = async (r: DailyReportLite, fn: (full: Awaited<ReturnType<typeof loadDailyReport>>) => Promise<void>) => {
    try {
      await fn(await loadDailyReport(r.factory_id, r.id))
    } catch (e) {
      setToast({ kind: "error", msg: dailyErrText(e, "Thao tác thất bại.") })
    }
  }

  const remove = async (r: DailyReportLite) => {
    if (!window.confirm(`Xoá báo cáo nháp "${r.template_name}" kỳ ${fmtDateVN(r.tu_ngay)} – ${fmtDateVN(r.den_ngay)}?`)) return
    try {
      await deleteDailyReportDraft(r.id)
      void load()
    } catch (e) {
      setToast({ kind: "error", msg: dailyErrText(e, "Không xoá được báo cáo.") })
    }
  }

  const COLS = 6
  return (
    <InventoryPageShell title="Báo cáo sử dụng theo ngày" description="Vật tư hóa chất (55-BC) và dầu (Mẫu 12B, 46-BC) theo từng ngày trong kỳ — ký số 2 người.">
      {toast && (
        <div className={`fixed bottom-4 right-4 z-[80] rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-lg ${toast.kind === "ok" ? "bg-emerald-600" : "bg-red-600"}`}>{toast.msg}</div>
      )}
      {!ready ? (
        <ListState kind="loading" />
      ) : !canReport ? (
        <ListState kind="error" message="Bạn chưa có quyền xem / lập báo cáo sử dụng theo ngày (inventory.daily_report). Liên hệ admin để cấp quyền." />
      ) : !factoryId ? (
        <ListState kind="error" message="Không xác định được nhà máy đang làm việc." />
      ) : (
        <div className="space-y-4">
          <SegmentedTabs
            ariaLabel="Báo cáo sử dụng theo ngày"
            size="sm"
            value={sub}
            onChange={setSub}
            items={[
              { key: "list", label: "Danh sách", icon: ListChecks },
              { key: "new" as const, label: "Lập báo cáo", icon: FilePlus2 },
              ...(canConfig ? [{ key: "templates" as const, label: "Mẫu báo cáo", icon: Settings2 }] : []),
            ]}
          />
          {sub === "new" ? (
            <DailyReportCreate factoryId={factoryId} existing={list} />
          ) : sub === "templates" && canConfig ? (
            <DailyTemplatesConfig factoryId={factoryId} onToast={(kind, msg) => setToast({ kind, msg })} />
          ) : (
            <>
              <StatGrid cols={4}>
                <StatCard icon={FileText} label="Báo cáo" value={list.filter((r) => r.trang_thai !== "huy").length} />
                <StatCard label="Nháp / Bị trả về" value={count("nhap") + count("tra_ve")} valueTone={count("tra_ve") ? "warn" : "default"} />
                <StatCard label="Chờ ký" value={count("cho_ky")} />
                <StatCard label="Đã ký" value={count("da_ky")} valueTone="good" />
              </StatGrid>
              <FilterBar layout="grid" activeCount={(search ? 1 : 0) + (status ? 1 : 0)}>
                <div className="flex h-10 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-mod-600 sm:col-span-2">
                  <Search size={15} className="shrink-0 text-slate-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm số báo cáo, mẫu, tháng (vd 10/2026)…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
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

              <ResponsiveTableWrapper>
                <table className="enterprise-table dense min-w-[820px]">
                  <thead>
                    <tr>
                      <th>Số báo cáo</th>
                      <th>Mẫu</th>
                      <th>Kỳ</th>
                      <th>Trạng thái</th>
                      <th>Lập lúc</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <ListState kind="loading" asRow colSpan={COLS} />
                    ) : error ? (
                      <ListState kind="error" asRow colSpan={COLS} message={error} onRetry={() => void load()} />
                    ) : !visible.length ? (
                      <ListState kind="empty" asRow colSpan={COLS} message='Chưa có báo cáo — bấm "Lập báo cáo".' />
                    ) : (
                      visible.map((r) => {
                        const signed = !!r.yeu_cau_ky_id && (r.trang_thai === "cho_ky" || r.trang_thai === "da_ky" || r.trang_thai === "tra_ve")
                        const name = encodeURIComponent(dailyReportFileName(r))
                        return (
                          <tr key={r.id} className="cursor-pointer" onClick={() => router.push(DAILY_REPORT_PATH(r.id))}>
                            <td className="whitespace-nowrap font-code text-xs font-bold">{r.ma_bao_cao || "—"}</td>
                            <td>
                              <div className="font-semibold">{r.template_name}</div>
                              <div className="text-xs text-slate-500">{r.config?.maMau || r.template_code}</div>
                            </td>
                            <td className="whitespace-nowrap">
                              {fmtDateVN(r.tu_ngay)} – {fmtDateVN(r.den_ngay)}
                            </td>
                            <td className="whitespace-nowrap">
                              <StatusBadge domain="norms_report" status={r.trang_thai} />
                            </td>
                            <td className="whitespace-nowrap text-xs text-slate-500">{fmtDateVN(r.created_at)}</td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <IconActionGroup>
                                <RowAction kind="view" href={DAILY_REPORT_PATH(r.id)} />
                                {signed ? (
                                  <>
                                    <RowAction kind="signed" onClick={() => void openSecureFile(`/api/signing/requests/${r.yeu_cau_ky_id}/file-url?view=1&name=${name}`)} />
                                    <RowAction kind="download" onClick={() => void openSecureFile(`/api/signing/requests/${r.yeu_cau_ky_id}/file-url?download=1&name=${name}`)} />
                                  </>
                                ) : (
                                  <RowAction kind="draft" onClick={() => void withFull(r, downloadDailyPdf)} />
                                )}
                                <IconAction icon={FileSpreadsheet} label="Tải Excel" tone="sky" onClick={() => void withFull(r, downloadDailyXlsx)} />
                                {r.trang_thai === "nhap" && <RowAction kind="delete" onClick={() => void remove(r)} />}
                              </IconActionGroup>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </ResponsiveTableWrapper>
            </>
          )}
        </div>
      )}
    </InventoryPageShell>
  )
}
