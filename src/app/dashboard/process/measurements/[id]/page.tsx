"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ClipboardCheck, Download, FileText, Pencil, Plus, Printer, Table2, Trash2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { formatDateDisplay } from "@/lib/date-utils"
import {
  buildProcessMeasurementPdfBytes,
  downloadProcessMeasurementPdf,
  processMeasurementChiTieu,
  type ProcessMeasurementPdfInput,
} from "@/lib/process-measurement-pdf"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { DetailSplitLayout } from "@/app/dashboard/_components/doc-ui/detail-split-layout"
import { DetailPageHeader, HeaderButton } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import { HeaderQr } from "@/app/dashboard/_components/doc-ui/header-qr"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { useIsDesktop } from "@/app/dashboard/_components/doc-ui/use-is-desktop"
import { InspectorCard, MetaList, MetaRow, StatusSummaryBar } from "@/app/dashboard/_components/doc-ui/inspector-card"
import { SignActionBox, type SignAction } from "@/app/dashboard/_components/doc-ui/sign-action-box"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ProcessShell } from "../../_components/process-shell"
import type { QuickMeasurementRow, QuickMeasurementSheet } from "../../_components/process-types"

/**
 * Trang chi tiết phiếu đo nhanh (rule 29 mục C, U8b 2026-10-28) — chỉ XEM.
 * Cột trái nhúng PDF phiếu dựng ngay trong trình duyệt (DocViewer loadBytes); Sửa / Thêm mẫu vẫn làm
 * ở form của danh sách (`?edit=<id>` / `?add=<id>`), Xoá dùng cùng quy tắc quyền như danh sách.
 */

type SheetWithRows = QuickMeasurementSheet & { rows: QuickMeasurementRow[] }
type NganInfo = { id: string; ten_ngan: string; ma_ngan: string }

const LIST_HREF = "/dashboard/process/measurements"

function fmtNumber(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—"
  return String(v).replace(".", ",")
}

export default function ProcessMeasurementDetailPage() {
  const params = useParams<{ id: string }>()
  const sheetId = typeof params?.id === "string" ? params.id : ""
  const router = useRouter()
  const isDesktop = useIsDesktop()

  const [user, setUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetWithRows | null>(null)
  const [ngans, setNgans] = useState<Record<string, NganInfo>>({})
  const [factoryName, setFactoryName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<"doc" | "info">("info")
  const [docTab, setDocTab] = useState<"file" | "content">("file")
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const showError = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  const loadSheet = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { user: sessionUser } = await hydrateActiveSession()
      if (!sessionUser) {
        window.location.replace(`/login?next=${encodeURIComponent(`${LIST_HREF}/${sheetId}`)}`)
        return
      }
      if (!hasPermission(sessionUser, "process.view")) {
        window.location.replace("/dashboard")
        return
      }
      const fid = await getActiveFactoryId()
      if (!fid) {
        setLoadError("Không xác định được nhà máy đang đăng nhập.")
        return
      }
      setUser(sessionUser)
      setFactoryId(fid)

      const { data, error } = await supabase
        .from("quick_measurements")
        .select("*, rows:quick_measurement_rows(*)")
        .eq("id", sheetId)
        .eq("factory_id", fid)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        setSheet(null)
        return
      }
      const s = data as SheetWithRows
      s.rows = [...(s.rows || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      setSheet(s)

      const nganIds = [...new Set(s.rows.map((r) => r.ngan_id).filter((v): v is string => Boolean(v)))]
      const [nRes, fRes] = await Promise.all([
        nganIds.length
          ? supabase.from("ngans").select("id,ten_ngan,ma_ngan").eq("factory_id", fid).in("id", nganIds)
          : Promise.resolve({ data: [] as NganInfo[] }),
        supabase.from("factories").select("name").eq("id", fid).maybeSingle(),
      ])
      const map: Record<string, NganInfo> = {}
      for (const n of (nRes.data || []) as NganInfo[]) map[n.id] = n
      setNgans(map)
      setFactoryName((fRes.data as { name?: string } | null)?.name ?? null)
    } catch (err) {
      setLoadError((err as { message?: string } | null)?.message || "Không tải được phiếu đo nhanh.")
    } finally {
      setLoading(false)
    }
  }, [sheetId])

  useEffect(() => {
    if (sheetId) void loadSheet()
  }, [sheetId, loadSheet])

  const detailUrl = origin && sheetId ? `${origin}${LIST_HREF}/${sheetId}` : ""

  const nganLabel = useCallback(
    (id: string | null) => {
      if (!id) return null
      const n = ngans[id]
      return n ? `${n.ma_ngan} – ${n.ten_ngan}` : null
    },
    [ngans],
  )

  const pdfInput = useMemo<ProcessMeasurementPdfInput | null>(() => {
    if (!sheet) return null
    return {
      ma_phieu: sheet.ma_phieu,
      ngay: sheet.ngay,
      created_at: sheet.created_at,
      day_chuyen: sheet.day_chuyen,
      loai_csr: sheet.loai_csr,
      factoryName,
      qrUrl: detailUrl || null,
      rows: sheet.rows.map((r) => ({
        chi_tieu: r.chi_tieu || [],
        thung: r.thung,
        lo: r.lo,
        mau: r.mau,
        che_do_say: r.che_do_say,
        ca_sx: r.ca_sx,
        ngan_label: nganLabel(r.ngan_id),
        so_ngay_luu: r.so_ngay_luu,
        ket_qua: r.ket_qua || {},
        nguoi_do: r.nguoi_do,
        ghi_chu: r.ghi_chu,
        image_urls: r.image_urls || [],
      })),
    }
  }, [sheet, factoryName, detailUrl, nganLabel])

  if (loading) {
    return <ProcessShell hideTabs><ListState kind="loading" /></ProcessShell>
  }
  if (loadError) {
    return <ProcessShell hideTabs><ListState kind="error" message={loadError} onRetry={() => void loadSheet()} /></ProcessShell>
  }
  if (!sheet || !pdfInput) {
    return (
      <ProcessShell hideTabs>
        <ListState kind="empty" message="Không tìm thấy phiếu đo nhanh, hoặc bạn không có quyền xem." />
      </ProcessShell>
    )
  }

  const isAdmin = user?.role === "admin"
  const isOwner = !!user && sheet.created_by === user.id
  const canEdit = isAdmin || (hasPermission(user, "process.edit") && isOwner)
  const canAddRows = hasPermission(user, "process.create")
  const canDelete = isAdmin || (hasPermission(user, "process.delete") && isOwner)
  const printHref = `/dashboard/process/print?sheetId=${sheet.id}`
  const cts = processMeasurementChiTieu(pdfInput.rows)
  const nguoiDo = Array.from(new Set(sheet.rows.map((r) => r.nguoi_do).filter(Boolean)))
  const imageCount = sheet.rows.reduce((n, r) => n + (r.image_urls?.length || 0), 0)

  const downloadPdf = async () => {
    try {
      await downloadProcessMeasurementPdf(pdfInput)
    } catch {
      showError("Không tạo được PDF phiếu.")
    }
  }

  const handleDelete = async () => {
    if (!factoryId || deleting || !canDelete) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from("quick_measurements")
        .delete()
        .eq("id", sheet.id)
        .eq("factory_id", factoryId)
        .select("id")
        .single()
      if (error) {
        showError(`Không xóa được phiếu: ${error.message}`)
        return
      }
      router.replace(LIST_HREF)
    } catch (err) {
      showError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setDeleting(false)
    }
  }

  const secondary: SignAction[] = [
    { key: "pdf", label: "Tải PDF phiếu", icon: <Download size={14} />, onClick: () => void downloadPdf() },
    { key: "print", label: "In phiếu", icon: <Printer size={14} />, onClick: () => window.open(printHref, "_blank") },
    ...(canEdit
      ? [{ key: "edit", label: "Sửa phiếu", icon: <Pencil size={14} />, onClick: () => router.push(`${LIST_HREF}?edit=${sheet.id}`) }]
      : []),
    ...(canAddRows
      ? [{ key: "add", label: "Thêm mẫu vào phiếu", icon: <Plus size={14} />, onClick: () => router.push(`${LIST_HREF}?add=${sheet.id}`) }]
      : []),
  ]
  const danger: SignAction[] = canDelete
    ? [{ key: "delete", label: "Xóa phiếu", icon: <Trash2 size={14} />, onClick: () => setConfirmDelete(true) }]
    : []

  const chip = "rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11.5px] font-medium text-slate-600"

  const contentTable = (
    <ResponsiveTableWrapper>
      <table className="enterprise-table dense min-w-[900px]">
        <thead>
          <tr>
            <th className="w-10 text-right">#</th>
            <th>Thùng / Lô / Mẫu</th>
            <th>Chế độ sấy</th>
            {cts.map((ct) => <th key={ct} className="text-right">{ct}</th>)}
            <th>Ca SX</th>
            <th>Ngăn / Ngày lưu</th>
            <th>Người đo</th>
            <th>Ghi chú</th>
            <th>Ảnh</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.length === 0 ? (
            <ListState kind="empty" message="Phiếu chưa có dòng đo" asRow colSpan={8 + cts.length} />
          ) : sheet.rows.map((r, idx) => {
            const kq = r.ket_qua || {}
            return (
              <tr key={r.id}>
                <td className="text-right text-slate-500">{idx + 1}</td>
                <td className="whitespace-nowrap">{[r.thung, r.lo, r.mau].filter(Boolean).join(" / ") || "—"}</td>
                <td className="whitespace-nowrap font-code">{r.che_do_say || "—"}</td>
                {cts.map((ct) => (
                  <td key={ct} className="text-right font-code font-semibold">
                    {(r.chi_tieu || []).includes(ct) ? fmtNumber(kq[ct]) : ""}
                  </td>
                ))}
                <td className="whitespace-nowrap">{r.ca_sx || "—"}</td>
                <td>
                  {nganLabel(r.ngan_id) || "—"}
                  {r.so_ngay_luu != null && <div className="text-xs text-slate-500">{r.so_ngay_luu} ngày lưu</div>}
                </td>
                <td className="whitespace-nowrap">{r.nguoi_do || "—"}</td>
                <td className="max-w-[200px] truncate" title={r.ghi_chu || ""}>{r.ghi_chu || ""}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {(r.image_urls || []).map((url, j) => (
                      <button key={j} type="button" onClick={() => setZoomUrl(url)} className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Ảnh ${j + 1}`} className="h-9 w-9 rounded-lg border border-slate-200 object-cover hover:opacity-80" />
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </ResponsiveTableWrapper>
  )

  return (
    <ProcessShell hideTabs>
      {toast && (
        <div className="fixed top-4 left-1/2 z-[70] -translate-x-1/2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-2xl">
          {toast}
        </div>
      )}
      {zoomUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80" onClick={() => setZoomUrl(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomUrl} alt="Phóng to" className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setZoomUrl(null)} className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/30" aria-label="Đóng">
            <X size={20} />
          </button>
        </div>
      )}
      <DetailSplitLayout
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        header={
          <DetailPageHeader
            backHref={LIST_HREF}
            backLabel="Quay lại danh sách phiếu đo nhanh"
            eyebrow="Phiếu đo nhanh chỉ tiêu"
            title={[sheet.day_chuyen, sheet.loai_csr ? `CSR ${sheet.loai_csr}` : null].filter(Boolean).join(" · ") || "Phiếu đo nhanh"}
            code={sheet.ma_phieu}
            tags={
              <>
                <span className={chip}>{formatDateDisplay(sheet.ngay)}</span>
                <span className={chip}>{sheet.rows.length} mẫu</span>
                {cts.length > 0 && <span className={chip}>{cts.join(", ")}</span>}
              </>
            }
            actions={
              <>
                <HeaderButton icon={<Download size={15} />} label="Tải PDF" onClick={() => void downloadPdf()} />
                <HeaderButton icon={<Printer size={15} />} label="In phiếu" onClick={() => window.open(printHref, "_blank")} />
                {detailUrl ? <HeaderQr value={detailUrl} code={sheet.ma_phieu} title="QR phiếu đo nhanh" /> : null}
              </>
            }
          />
        }
        document={
          <>
            <SegmentedTabs
              ariaLabel="Chọn nội dung cột tài liệu"
              value={docTab}
              onChange={setDocTab}
              items={[
                { key: "file", label: "Phiếu PDF", icon: FileText },
                { key: "content", label: "Dòng đo", icon: Table2, count: sheet.rows.length },
              ]}
            />
            {docTab === "file" ? (
              <DocViewer
                key={`qm-${sheet.id}`}
                active={(isDesktop || mobileTab === "doc") && !confirmDelete && !zoomUrl}
                loadBytes={() => buildProcessMeasurementPdfBytes(pdfInput)}
                sourceKey={`qm-${sheet.id}-${sheet.rows.length}-${Object.keys(ngans).length}-${factoryName ?? ""}-${detailUrl}`}
                kind="pdf"
                fileExt="pdf"
                label={`Phiếu đo nhanh ${sheet.ma_phieu || ""} · Bản xem trước PDF`}
              />
            ) : contentTable}
          </>
        }
        inspector={
          <>
            <StatusSummaryBar
              domain="inventory"
              status={null}
              headline={`${sheet.rows.length} mẫu đo${imageCount ? ` · ${imageCount} ảnh` : ""}`}
              badge={<StatusBadge tone="valid" label="Đã lưu" size="md" />}
            />
            <SignActionBox title="Hành động" primary={null} secondary={secondary} danger={danger} />
            <InspectorCard title="Thông tin phiếu" icon={ClipboardCheck}>
              <MetaList>
                <MetaRow label="Mã phiếu" value={sheet.ma_phieu || "—"} />
                <MetaRow label="Ngày đo" value={formatDateDisplay(sheet.ngay)} />
                <MetaRow label="Dây chuyền" value={sheet.day_chuyen || "—"} />
                <MetaRow label="Loại CSR" value={sheet.loai_csr || "—"} />
                <MetaRow label="Chỉ tiêu" value={cts.join(", ") || "—"} />
                <MetaRow label="Người đo" value={nguoiDo.join(", ") || "—"} />
              </MetaList>
            </InspectorCard>
          </>
        }
      />

      {confirmDelete && (
        <ModalShell
          title="Xác nhận xóa phiếu"
          onClose={() => { if (!deleting) setConfirmDelete(false) }}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setConfirmDelete(false)} disabled={deleting}
                className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-60">
                Hủy
              </button>
              <button onClick={() => void handleDelete()} disabled={deleting}
                className="rounded-xl bg-red-600 px-5 py-2.5 font-bold text-white shadow-md hover:bg-red-700 disabled:opacity-60">
                {deleting ? "Đang xóa..." : "Xóa phiếu"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xóa phiếu <span className="font-code font-bold text-slate-800">{sheet.ma_phieu || "—"}</span> ({sheet.rows.length} mẫu)?
            Toàn bộ dòng đo sẽ bị xóa và không khôi phục được.
          </p>
        </ModalShell>
      )}
    </ProcessShell>
  )
}
