"use client"

// Kho vật tư — chi tiết báo cáo sử dụng theo ngày (rule 29 mục C: 70/30). Trái: PDF đã ký (DocViewer qua yêu cầu ký) hoặc
// bản chưa ký dựng trong trình duyệt + tab Số liệu. Phải: trạng thái, hành động (Gửi ký / Mở màn ký / Thu hồi / Tính lại /
// Excel / Huỷ), thông tin. Đã ký ⇒ "Kiểm tra dữ liệu đã đổi" (tính lại hash). Rule 13.

import { use, useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Download, ExternalLink, FileSignature, FileSpreadsheet, RefreshCw, RotateCcw, Send, ShieldCheck, Trash2, XCircle } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import {
  buildDailyPdf,
  dailyReportAction,
  dailyReportDataChanged,
  dailyReportFileName,
  dailyReportQrUrl,
  deleteDailyReportDraft,
  downloadDailyPdf,
  downloadDailyXlsx,
  loadDailyReport,
  refreshDailyReport,
  syncDailyReportStatuses,
} from "@/lib/inventory-daily-report/client"
import { fmtNum } from "@/lib/inventory-daily-report/pdf"
import { DAILY_REPORT_KIEU_LABEL, DAILY_REPORT_STATUS_LABEL, fmtDateVN, fmtDayShort, type DailyReport } from "@/lib/inventory-daily-report/types"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { DetailPageHeader, HeaderButton } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import { DetailSplitLayout } from "@/app/dashboard/_components/doc-ui/detail-split-layout"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { HeaderQr } from "@/app/dashboard/_components/doc-ui/header-qr"
import { InspectorCard, MetaList, MetaRow, StatusSummaryBar } from "@/app/dashboard/_components/doc-ui/inspector-card"
import { SignActionBox } from "@/app/dashboard/_components/doc-ui/sign-action-box"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { useIsDesktop } from "@/app/dashboard/_components/doc-ui/use-is-desktop"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { openSecureFile } from "@/app/dashboard/_components/secure-file-open"
import { DailyReportSendDialog } from "../_components/daily-report-send"
import { dailyErrText } from "../_components/daily-ui"

export default function InventoryDailyReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [report, setReport] = useState<DailyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [docTab, setDocTab] = useState<"pdf" | "data">("pdf")
  const [mobileTab, setMobileTab] = useState<"doc" | "info">("info")
  const [sendOpen, setSendOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dataChanged, setDataChanged] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void (async () => {
      const { user: u } = await hydrateActiveSession().catch(() => ({ user: null }))
      if (!hasPermission(u, "inventory.daily_report")) {
        setLoading(false)
        window.location.replace("/dashboard/inventory/daily-reports")
        return
      }
      setUser(u)
      setFactoryId(await getActiveFactoryId())
    })()
  }, [])

  const load = useCallback(
    async (fid: string) => {
      setLoading(true)
      setError(null)
      try {
        let r = await loadDailyReport(fid, id)
        if (r.trang_thai === "cho_ky") {
          await syncDailyReportStatuses([id])
          r = await loadDailyReport(fid, id)
        }
        setReport(r)
      } catch (e) {
        setError(dailyErrText(e, "Không tải được báo cáo."))
      } finally {
        setLoading(false)
      }
    },
    [id],
  )

  useEffect(() => {
    if (factoryId) void load(factoryId)
  }, [factoryId, load])

  const checkData = useCallback(async () => {
    if (!report) return
    setChecking(true)
    try {
      setDataChanged(await dailyReportDataChanged(report))
    } catch {
      setDataChanged(null)
    } finally {
      setChecking(false)
    }
  }, [report])

  useEffect(() => {
    if (report?.trang_thai === "da_ky" && dataChanged === null && !checking) void checkData()
    // chỉ kiểm 1 lần khi mở báo cáo đã ký
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.trang_thai])

  if (loading && !report) return <ListState kind="loading" />
  if (error || !report) return <ListState kind="error" message={error || "Không tìm thấy báo cáo."} onRetry={factoryId ? () => void load(factoryId) : undefined} />

  const st = report.trang_thai
  const snap = report.snapshot
  const editable = st === "nhap" || st === "tra_ve"
  const isAdmin = user?.role === "admin"
  const hasSigned = !!report.yeu_cau_ky_id && (st === "cho_ky" || st === "da_ky" || st === "tra_ve")
  const fileName = dailyReportFileName(report)
  const docActive = (isDesktop || mobileTab === "doc") && !sendOpen
  const fileUrl = (q: string) => `/api/signing/requests/${report.yeu_cau_ky_id}/file-url?${q}&name=${encodeURIComponent(fileName)}`

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      if (factoryId) await load(factoryId)
    } catch (e) {
      window.alert(dailyErrText(e, "Thao tác thất bại."))
    } finally {
      setBusy(false)
    }
  }

  const primary = editable
    ? { key: "send", label: st === "tra_ve" ? "Sửa & gửi ký lại" : "Gửi ký", icon: <Send size={15} />, onClick: () => setSendOpen(true) }
    : st === "cho_ky" && report.yeu_cau_ky_id
      ? { key: "ky", label: "Mở màn ký", icon: <FileSignature size={15} />, onClick: () => router.push(`/dashboard/ky/${report.yeu_cau_ky_id}`) }
      : null

  const secondary = [
    ...(hasSigned
      ? [
          { key: "view", label: "Xem file ký", icon: <ExternalLink size={15} />, onClick: () => void openSecureFile(fileUrl("view=1")) },
          { key: "dl", label: "Tải file ký", icon: <Download size={15} />, onClick: () => void openSecureFile(fileUrl("download=1")) },
        ]
      : [{ key: "draft", label: "Tải PDF chưa ký", icon: <Download size={15} />, onClick: () => void downloadDailyPdf(report) }]),
    { key: "xlsx", label: "Tải Excel", icon: <FileSpreadsheet size={15} />, onClick: () => void downloadDailyXlsx(report) },
    ...(editable
      ? [{ key: "refresh", label: "Tính lại số liệu", icon: <RefreshCw size={15} />, disabled: busy, onClick: () => window.confirm("Tính lại số liệu từ phiếu xuất kho hiện tại?") && void run(() => refreshDailyReport(report)) }]
      : []),
    ...(st === "cho_ky" ? [{ key: "recall", label: "Thu hồi về Nháp", icon: <RotateCcw size={15} />, disabled: busy, onClick: () => window.confirm("Thu hồi báo cáo về Nháp (chỉ khi chưa ai ký)?") && void run(() => dailyReportAction(id, "recall")) }] : []),
    ...(st === "da_ky" ? [{ key: "check", label: checking ? "Đang kiểm tra…" : "Kiểm tra dữ liệu đã đổi", icon: <ShieldCheck size={15} />, disabled: checking, onClick: () => void checkData() }] : []),
  ]
  const danger = [
    ...(st === "nhap"
      ? [{ key: "del", label: "Xoá báo cáo nháp", icon: <Trash2 size={15} />, onClick: () => window.confirm("Xoá báo cáo nháp này?") && void (async () => { await deleteDailyReportDraft(report.id); router.push("/dashboard/inventory/daily-reports") })() }]
      : []),
    ...(st === "tra_ve" || (isAdmin && st === "da_ky")
      ? [{ key: "cancel", label: "Huỷ báo cáo", icon: <XCircle size={15} />, onClick: () => { const ly = st === "da_ky" ? window.prompt("Lý do huỷ báo cáo đã ký:") : ""; if (ly === null) return; void run(() => dailyReportAction(id, "cancel", ly || undefined)) } }]
      : []),
  ]

  return (
    <div className={moduleThemeClass("amber")}>
      <DetailSplitLayout
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        header={
          <DetailPageHeader
            backHref="/dashboard/inventory/daily-reports"
            backLabel="Báo cáo sử dụng theo ngày"
            eyebrow={`Kho vật tư · ${report.config?.maMau || "Báo cáo theo ngày"}`}
            title={report.template_name}
            code={report.ma_bao_cao || "Chưa cấp số"}
            tags={
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                Kỳ {fmtDateVN(report.tu_ngay)} – {fmtDateVN(report.den_ngay)}
              </span>
            }
            actions={
              <>
                {hasSigned ? (
                  <HeaderButton icon={<Download size={15} />} label="Tải file ký" onClick={() => void openSecureFile(fileUrl("download=1"))} />
                ) : (
                  <HeaderButton icon={<Download size={15} />} label="Tải PDF chưa ký" onClick={() => void downloadDailyPdf(report)} />
                )}
                <HeaderQr value={dailyReportQrUrl(report.id)} code={report.ma_bao_cao} title={report.template_name} />
              </>
            }
          />
        }
        banners={
          <>
            {dataChanged && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Đã ký — dữ liệu đã đổi: phiếu xuất kho trong kỳ đã được sửa / huỷ sau khi ký. Điều chỉnh ở kỳ sau.
              </div>
            )}
            {snap.warnings.map((w) => (
              <div key={w} className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                {w}
              </div>
            ))}
          </>
        }
        document={
          <div className="space-y-3">
            <SegmentedTabs ariaLabel="Nội dung" value={docTab} onChange={setDocTab} items={[{ key: "pdf", label: hasSigned ? "File ký" : "Bản xem trước (chưa ký)" }, { key: "data", label: "Số liệu" }]} />
            {docTab === "pdf" ? (
              hasSigned ? (
                <DocViewer key={report.yeu_cau_ky_id || ""} active={docActive} kind="pdf" label="Bản ký số · PDF" endpoint={`/api/signing/requests/${report.yeu_cau_ky_id}/file-url`} />
              ) : (
                <DocViewer active={docActive} kind="pdf" label="Bản chưa ký · PDF" sourceKey={`${report.id}|${report.updated_at}`} loadBytes={async () => (await buildDailyPdf(report)).bytes} />
              )
            ) : (
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
                  </tbody>
                </table>
              </ResponsiveTableWrapper>
            )}
          </div>
        }
        inspector={
          <div className="space-y-3">
            <StatusSummaryBar
              domain="norms_report"
              status={st}
              headline={DAILY_REPORT_STATUS_LABEL[st]}
              meta={report.gui_ky_luc ? `Gửi ký ${fmtDateVN(report.gui_ky_luc)}` : undefined}
              badge={dataChanged ? <StatusBadge tone="warn" label="Đã ký — dữ liệu đã đổi" /> : undefined}
            />
            <SignActionBox title="Hành động" primary={primary} secondary={secondary} danger={danger} />
            <InspectorCard title="Thông tin báo cáo">
              <MetaList>
                <MetaRow label="Loại" value={DAILY_REPORT_KIEU_LABEL[report.template_kieu]} />
                <MetaRow label="Kỳ" value={`${fmtDateVN(report.tu_ngay)} – ${fmtDateVN(report.den_ngay)}`} />
                <MetaRow label="Mẫu" value={`${report.template_name} (phiên bản ${report.template_phien_ban})`} />
                <MetaRow label="Số cột" value={snap.columns.length} />
                {snap.kieu === "dau_12b" && <MetaRow label="Tổng cộng" value={fmtNum(snap.grandTotal)} />}
                {snap.legacyCells > 0 && <MetaRow label="Ô từ dữ liệu lịch sử" value={snap.legacyCells} />}
                {report.ly_do_huy && <MetaRow label="Lý do huỷ" value={report.ly_do_huy} />}
              </MetaList>
            </InspectorCard>
          </div>
        }
      />
      {sendOpen && (
        <DailyReportSendDialog
          report={report}
          onClose={() => setSendOpen(false)}
          onDone={(yeuCauId) => {
            setSendOpen(false)
            router.push(`/dashboard/ky/${yeuCauId}`)
          }}
        />
      )}
    </div>
  )
}
