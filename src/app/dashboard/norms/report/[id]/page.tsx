"use client"

// Định mức KTKT GĐ4 — trang chi tiết 1 báo cáo kỳ (rule 29 mục C, 70/30): trái PDF (đã ký: file hiện tại của yêu
// cầu ký; chưa ký: dựng từ snapshot) / Số liệu; phải trạng thái → hành động → thông tin bộ. QR trên PDF trỏ trang này.
// Badge "Đã ký — dữ liệu đã đổi" khi tính lại snapshot từ dữ liệu hiện tại ra hash khác. Rule 30.

import { use, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Download, ExternalLink, FileSignature, FileStack, PenLine, RotateCcw, Send, ShieldCheck, Trash2, XCircle } from "lucide-react"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { loadReconcile } from "@/lib/norms/reconcile-loader"
import { buildReportSnapshot } from "@/lib/norms/report-loader"
import { buildReportPdf, deleteReportDraft, loadReportDetail, reportAction, reportQrUrl, syncReportStatuses, updateReportTexts } from "@/lib/norms/report-client"
import { hashNormSnapshot, fmtDateVN, NORM_REPORT_STATUS_LABEL, type NormReport, type NormReportBatch } from "@/lib/norms/report-types"
import { lineTitle, lineUnit, overLines, isOverSnapLine } from "@/lib/norms/report-templates"
import { fmtQty } from "@/lib/norms/types"
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
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { openSecureFile } from "@/app/dashboard/_components/secure-file-open"
import { NormsReportSendDialog } from "../../_components/norms-report-send"
import { btnCls, btnPrimaryCls, errText, inputCls } from "../../_components/norms-ui"

function readCachedUser(): SessionUser | null {
  try {
    return JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
  } catch {
    return null
  }
}

export default function NormReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [report, setReport] = useState<NormReport | null>(null)
  const [batch, setBatch] = useState<NormReportBatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [docTab, setDocTab] = useState<"pdf" | "data">("pdf")
  const [mobileTab, setMobileTab] = useState<"doc" | "info">("info")
  const [sendOpen, setSendOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dataChanged, setDataChanged] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void (async () => {
      const cached = readCachedUser()
      if (!hasPermission(cached, "norms.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      setUser(cached)
      setFactoryId(await getActiveFactoryId())
    })()
  }, [])

  const load = useCallback(async (fid: string) => {
    setLoading(true)
    setError(null)
    try {
      let d = await loadReportDetail(fid, id)
      if (d.report.trang_thai === "cho_ky") {
        await syncReportStatuses([id])
        d = await loadReportDetail(fid, id)
      }
      setReport(d.report)
      setBatch(d.batch)
    } catch (e) {
      setError(errText(e, "Không tải được báo cáo."))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (factoryId) void load(factoryId)
  }, [factoryId, load])

  const canReport = hasPermission(user, "norms.report")
  const isAdmin = user?.role === "admin"

  const checkData = useCallback(async () => {
    if (!factoryId || !batch || !report) return
    setChecking(true)
    try {
      const f = { from: batch.tu_ngay, to: batch.den_ngay, materials: batch.materials, notes: batch.notes, meterFrom: batch.meter_from, meterTo: batch.meter_to, useDraft: false }
      const snap = await buildReportSnapshot(factoryId, f, await loadReconcile(factoryId, f))
      const h = await hashNormSnapshot(snap)
      setDataChanged(h !== (report.du_lieu_hash || batch.du_lieu_hash))
    } catch {
      setDataChanged(null)
    } finally {
      setChecking(false)
    }
  }, [factoryId, batch, report])

  useEffect(() => {
    if (report?.trang_thai === "da_ky" && dataChanged === null && !checking) void checkData()
    // chỉ kiểm 1 lần khi mở báo cáo đã ký
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.trang_thai])

  const snap = batch?.snapshot
  const over = useMemo(() => (snap ? overLines(snap) : []), [snap])
  if (loading && !report) return <ListState kind="loading" />
  if (error || !report || !batch || !snap) return <ListState kind="error" message={error || "Không tìm thấy báo cáo."} onRetry={factoryId ? () => void load(factoryId) : undefined} />

  const st = report.trang_thai
  const editable = canReport && (st === "nhap" || st === "tra_ve")
  const hasSigned = !!report.yeu_cau_ky_id && (st === "cho_ky" || st === "da_ky" || st === "tra_ve")
  const fileName = `Báo cáo ${report.template_code} ${report.ma_bao_cao || ""}`.trim()
  const docActive = (isDesktop || mobileTab === "doc") && !sendOpen

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      if (factoryId) await load(factoryId)
    } catch (e) {
      window.alert(errText(e, "Thao tác thất bại."))
    } finally {
      setBusy(false)
    }
  }

  const draftBytes = async () => (await buildReportPdf(report, snap)).bytes
  const downloadDraft = async () => {
    const bytes = await draftBytes()
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${fileName} (chưa ký).pdf`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const primary =
    editable && !report.van_ban_document_id
      ? { key: "send", label: st === "tra_ve" ? "Sửa & gửi ký lại" : "Gửi ký", icon: <Send size={15} />, onClick: () => setSendOpen(true) }
      : report.van_ban_document_id
        ? { key: "vb", label: "Mở văn bản nội bộ", icon: <FileStack size={15} />, onClick: () => router.push(`/dashboard/documents/${report.van_ban_document_id}`) }
        : st === "cho_ky" && report.yeu_cau_ky_id
          ? { key: "ky", label: "Mở màn ký", icon: <FileSignature size={15} />, onClick: () => router.push(`/dashboard/ky/${report.yeu_cau_ky_id}`) }
          : null

  const secondary = [
    ...(hasSigned
      ? [
          { key: "view", label: "Xem file ký", icon: <ExternalLink size={15} />, onClick: () => void openSecureFile(`/api/signing/requests/${report.yeu_cau_ky_id}/file-url?view=1&name=${encodeURIComponent(fileName)}`) },
          { key: "dl", label: "Tải file ký", icon: <Download size={15} />, onClick: () => void openSecureFile(`/api/signing/requests/${report.yeu_cau_ky_id}/file-url?download=1&name=${encodeURIComponent(fileName)}`) },
        ]
      : [{ key: "draft", label: "Tải PDF chưa ký", icon: <Download size={15} />, onClick: () => void downloadDraft() }]),
    ...(editable && report.template_kieu === "thang_8a" ? [{ key: "edit", label: "Sửa giải trình / kiến nghị", icon: <PenLine size={15} />, onClick: () => setEditOpen(true) }] : []),
    ...(canReport && st === "cho_ky" ? [{ key: "recall", label: "Thu hồi về Nháp", icon: <RotateCcw size={15} />, disabled: busy, onClick: () => window.confirm("Thu hồi báo cáo về Nháp (chỉ khi chưa ai ký)?") && void run(() => reportAction(id, "recall")) }] : []),
    ...(st === "da_ky" ? [{ key: "check", label: checking ? "Đang kiểm tra…" : "Kiểm tra dữ liệu đã đổi", icon: <ShieldCheck size={15} />, disabled: checking, onClick: () => void checkData() }] : []),
  ]
  const danger = [
    ...(canReport && st === "nhap" ? [{ key: "del", label: "Xoá báo cáo nháp", icon: <Trash2 size={15} />, onClick: () => window.confirm("Xoá báo cáo nháp này?") && void (async () => { await deleteReportDraft(report); router.push("/dashboard/norms?tab=reports") })() }] : []),
    ...((canReport && st === "tra_ve") || (isAdmin && st === "da_ky")
      ? [{ key: "cancel", label: "Huỷ báo cáo", icon: <XCircle size={15} />, onClick: () => { const ly = st === "da_ky" ? window.prompt("Lý do huỷ báo cáo đã ký:") : "" ; if (ly === null) return; void run(() => reportAction(id, "cancel", ly || undefined)) } }]
      : []),
  ]

  return (
    <div className={`${moduleThemeClass("moss")}`}>
      <DetailSplitLayout
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        header={
          <DetailPageHeader
            backHref="/dashboard/norms?tab=reports"
            backLabel="Báo cáo định mức"
            eyebrow={`Báo cáo định mức KTKT · ${report.template_code}`}
            title={report.template_name}
            code={report.ma_bao_cao || "Chưa cấp số"}
            tags={
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                Kỳ {fmtDateVN(snap.from)} – {fmtDateVN(snap.to)}
              </span>
            }
            actions={
              <>
                {hasSigned ? (
                  <HeaderButton icon={<Download size={15} />} label="Tải file ký" onClick={() => void openSecureFile(`/api/signing/requests/${report.yeu_cau_ky_id}/file-url?download=1&name=${encodeURIComponent(fileName)}`)} />
                ) : (
                  <HeaderButton icon={<Download size={15} />} label="Tải PDF chưa ký" onClick={() => void downloadDraft()} />
                )}
                <HeaderQr value={reportQrUrl(report.id)} code={report.ma_bao_cao} title={report.template_name} />
              </>
            }
          />
        }
        banners={
          <>
            {dataChanged && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Đã ký — dữ liệu đã đổi: tính lại từ dữ liệu hiện tại ra số khác bản đã ký. Điều chỉnh ở kỳ sau.
              </div>
            )}
            {snap.draftUsed && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Số liệu dựng bằng khung NHÁP.</div>
            )}
          </>
        }
        document={
          <div className="space-y-3">
            <SegmentedTabs ariaLabel="Nội dung" value={docTab} onChange={setDocTab} items={[{ key: "pdf", label: hasSigned ? "File ký" : "Bản xem trước (chưa ký)" }, { key: "data", label: "Số liệu" }]} />
            {docTab === "pdf" ? (
              hasSigned ? (
                <DocViewer key={report.yeu_cau_ky_id || ""} active={docActive} kind="pdf" label="Bản ký số · PDF" endpoint={`/api/signing/requests/${report.yeu_cau_ky_id}/file-url`} />
              ) : (
                <DocViewer active={docActive} kind="pdf" label="Bản chưa ký · PDF" sourceKey={`${report.id}|${report.updated_at}`} loadBytes={draftBytes} />
              )
            ) : (
              <ResponsiveTableWrapper>
                <table className="enterprise-table dense min-w-[760px]">
                  <thead>
                    <tr>
                      <th>Chỉ tiêu</th>
                      <th>ĐVT</th>
                      <th className="text-right">Thực tế</th>
                      <th className="text-right">Định mức</th>
                      <th className="text-right">Chênh %</th>
                      <th>Giải trình</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.lines.map((l) => (
                      <tr key={l.key} className={isOverSnapLine(l) ? "text-red-700" : undefined}>
                        <td>{lineTitle(l)}</td>
                        <td>{lineUnit(l)}</td>
                        <td className="text-right tabular-nums">{fmtQty(l.actual ?? 0, 2)}</td>
                        <td className="text-right tabular-nums">{fmtQty(l.allowed, 2)}</td>
                        <td className="text-right tabular-nums">{l.diffPct === null ? "—" : `${l.diffPct > 0 ? "+" : ""}${fmtQty(l.diffPct, 2)}%`}</td>
                        <td className="text-xs">{report.giai_trinh?.[l.key] || ""}</td>
                      </tr>
                    ))}
                    {!snap.lines.length && <ListState kind="empty" asRow colSpan={6} message="Không có chỉ tiêu so sánh." />}
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
              headline={NORM_REPORT_STATUS_LABEL[st]}
              meta={report.van_ban_document_id ? "Ký nhiều bước qua Văn bản nội bộ" : report.khoa_tu && report.khoa_den ? `Khoá nhập liệu ${fmtDateVN(report.khoa_tu)} – ${fmtDateVN(report.khoa_den)}` : undefined}
              badge={dataChanged ? <StatusBadge tone="warn" label="Đã ký — dữ liệu đã đổi" /> : undefined}
            />
            <SignActionBox title="Hành động" primary={primary} secondary={secondary} danger={danger} />
            <InspectorCard title="Thông tin bộ báo cáo">
              <MetaList>
                <MetaRow label="Kỳ" value={`${fmtDateVN(snap.from)} – ${fmtDateVN(snap.to)}`} />
                <MetaRow label="Kỳ đồng hồ" value={snap.meterFrom && snap.meterTo ? `${fmtDateVN(snap.meterFrom)} → ${fmtDateVN(snap.meterTo)}` : "—"} />
                <MetaRow label="Khung định mức" value={snap.versions.map((v) => v.name).join(", ") || "—"} />
                <MetaRow label="Mẫu" value={`${report.template_code} (phiên bản ${report.template_phien_ban})`} />
                <MetaRow label="Thành phẩm" value={`${fmtQty(snap.totals.tpTons, 3)} tấn`} />
                <MetaRow label="NL quy khô theo lọc" value={`${fmtQty(snap.totals.nlKhoTons, 3)} tấn`} />
                <MetaRow label="Chỉ tiêu vượt" value={over.length} />
                {report.ly_do_huy && <MetaRow label="Lý do huỷ" value={report.ly_do_huy} />}
              </MetaList>
            </InspectorCard>
          </div>
        }
      />
      {sendOpen && (
        <NormsReportSendDialog
          reports={[report]}
          snapshot={snap}
          onClose={() => setSendOpen(false)}
          onDone={(r) => {
            setSendOpen(false)
            if (r.yeuCauIds[0]) router.push(`/dashboard/ky/${r.yeuCauIds[0]}`)
            else if (factoryId) void load(factoryId)
          }}
        />
      )}
      {editOpen && <EditTextsDialog report={report} batch={batch} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); if (factoryId) void load(factoryId) }} />}
    </div>
  )
}

function EditTextsDialog({ report, batch, onClose, onSaved }: { report: NormReport; batch: NormReportBatch; onClose: () => void; onSaved: () => void }) {
  const over = overLines(batch.snapshot)
  const [gt, setGt] = useState<Record<string, string>>(report.giai_trinh || {})
  const [kn, setKn] = useState(report.kien_nghi || "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      await updateReportTexts(report.id, { giai_trinh: gt, kien_nghi: kn.trim() || null })
      onSaved()
    } catch (e) {
      setErr(errText(e, "Không lưu được."))
    } finally {
      setBusy(false)
    }
  }
  return (
    <ModalShell
      title="Giải trình & kiến nghị (Mẫu 8A)"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btnCls} onClick={onClose}>
            Huỷ
          </button>
          <button type="button" className={btnPrimaryCls} disabled={busy} onClick={() => void save()}>
            {busy ? "Đang lưu…" : "Lưu"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {!over.length && <p className="text-sm text-slate-500">Không có chỉ tiêu vượt định mức.</p>}
        {over.map((l) => (
          <label key={l.key} className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">
              {lineTitle(l)} — thực tế {fmtQty(l.actual ?? 0, 2)} / định mức {fmtQty(l.allowed, 2)}
            </span>
            <textarea className={`${inputCls} h-16 py-2`} value={gt[l.key] || ""} onChange={(e) => setGt((g) => ({ ...g, [l.key]: e.target.value }))} />
          </label>
        ))}
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700">11. Kiến nghị</span>
          <textarea className={`${inputCls} h-20 py-2`} value={kn} onChange={(e) => setKn(e.target.value)} />
        </label>
        {err && <div className="text-sm font-semibold text-red-700">{err}</div>}
      </div>
    </ModalShell>
  )
}
