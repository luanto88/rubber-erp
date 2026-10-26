"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Boxes, CalendarDays, Download, FileText, ListChecks, Share2, ShieldCheck } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, hydrateActiveSession } from "@/lib/auth"
import { formatStorageDate } from "@/lib/storage-detail"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { normalizeLotStatus } from "@/app/dashboard/product/shared"
import {
  loadReportLockState,
  resolveShiftReport,
  shiftBundleBytes,
  type ShiftReportBundle,
} from "@/app/dashboard/product/confirm/report-bundle"
import { downloadShiftReportPdfDoc, shareShiftReportImage } from "@/app/dashboard/product/confirm/shift-report-pdf"
import type { DayLockState } from "@/app/dashboard/product/confirm/report-snapshots"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { DetailSplitLayout } from "@/app/dashboard/_components/doc-ui/detail-split-layout"
import { DetailPageHeader, HeaderButton } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { useIsDesktop } from "@/app/dashboard/_components/doc-ui/use-is-desktop"
import { InspectorCard, MetaList, MetaRow, StatusSummaryBar } from "@/app/dashboard/_components/doc-ui/inspector-card"
import { SignActionBox, type SignAction } from "@/app/dashboard/_components/doc-ui/sign-action-box"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"

/**
 * Trang chi tiết NGÀY thành phẩm (2026-10-26): nhúng Phiếu thành phẩm F09 của cả ngày (tất cả lô,
 * tất cả ca) — cùng nội dung nút "Phiếu báo thành phẩm" ở danh sách, kể cả quy tắc bản cứng khi ngày
 * đã khóa đủ ca (resolveShiftReport). Chỉ XEM; thêm/sửa/xoá/khóa ca vẫn ở `/dashboard/product`.
 */

type DayTx = {
  id: string
  ca: string | null
  ngan_id: string | null
  so_banh: number | null
  so_kg: number | null
  created_at: string | null
  lots: { id: string; ma_lo: string; loai_csr: string | null; loai_banh: number | null; boc: string | null; trang_thai: string | null } | null
}

type LotSummary = {
  lotId: string
  maLo: string
  loaiCsr: string
  loaiBanh: number
  boc: string
  trangThai: string
  banh: number
  kg: number
  nganIds: string[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Mirror REPORT_SHIFT_PERMISSIONS (confirm/report-access.ts) — server kiểm lại lần nữa.
const REPORT_SHIFT_PERMS = ["product.create", "product.confirm_scan", "product.approve_shift"]
const num = (v: number | null | undefined) => Number(v || 0)
const fmtKg = (v: number) => `${Math.round(v || 0).toLocaleString("vi-VN")} kg`
const chip = "rounded-full bg-white/80 border border-slate-200 px-2.5 py-0.5 text-[12px] font-semibold text-slate-600"

export default function ProductDayDetailPage() {
  const params = useParams<{ date: string }>()
  const date = typeof params?.date === "string" ? params.date : ""
  const validDate = DATE_RE.test(date)
  const isDesktop = useIsDesktop()

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [canReport, setCanReport] = useState(false)
  const [txs, setTxs] = useState<DayTx[]>([])
  const [ngans, setNgans] = useState<Record<string, string>>({})
  const [lockState, setLockState] = useState<DayLockState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<"doc" | "info">("info")
  const [docTab, setDocTab] = useState<"file" | "lots">("file")
  const [bundle, setBundle] = useState<ShiftReportBundle | null>(null)
  const [bundleEmpty, setBundleEmpty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  // Bundle dùng lại cho Tải PDF / Chia sẻ, không dựng lại lần 2.
  const bundleRef = useRef<ShiftReportBundle | null>(null)

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    window.setTimeout(() => setToast(null), 3500)
  }, [])

  const load = useCallback(async () => {
    if (!validDate) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const { user } = await hydrateActiveSession()
      if (!user) {
        window.location.replace(`/login?next=${encodeURIComponent(`/dashboard/product/day/${date}`)}`)
        return
      }
      if (!hasPermission(user, "product.view")) {
        window.location.replace("/dashboard")
        return
      }
      const fid = user.factory_id
      if (!fid) {
        setLoadError("Tài khoản chưa được gán nhà máy.")
        return
      }
      setFactoryId(fid)
      setCanReport(user.role === "admin" || REPORT_SHIFT_PERMS.some((p) => hasPermission(user, p)))

      const [rows, lock] = await Promise.all([
        fetchAllPaginated<DayTx>((from, to) =>
          supabase
            .from("lot_transactions")
            .select("id, ca, ngan_id, so_banh, so_kg, created_at, lots!inner(id, ma_lo, loai_csr, loai_banh, boc, trang_thai)")
            .eq("lots.factory_id", fid)
            .eq("ngay_nhap", date)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to)
            .then((r) => ({ data: (r.data || []) as unknown as DayTx[], error: r.error })),
        ),
        loadReportLockState(fid, date),
      ])
      setTxs(rows)
      setLockState(lock)
      const nganIds = [...new Set(rows.map((r) => r.ngan_id).filter((v): v is string => Boolean(v)))]
      if (nganIds.length) {
        const { data } = await supabase.from("ngans").select("id, ten_ngan, ma_ngan").eq("factory_id", fid).in("id", nganIds)
        const map: Record<string, string> = {}
        for (const n of (data || []) as { id: string; ten_ngan: string | null; ma_ngan: string | null }[]) {
          map[n.id] = n.ma_ngan || n.ten_ngan || "—"
        }
        setNgans(map)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được dữ liệu ngày.")
    } finally {
      setLoading(false)
    }
  }, [date, validDate])

  useEffect(() => {
    void load()
  }, [load])

  // Ca → lô (gộp các giao dịch cùng lô trong 1 ca).
  const byCa = useMemo(() => {
    const out = new Map<string, Map<string, LotSummary>>()
    for (const t of txs) {
      if (!t.lots) continue
      const ca = t.ca || "—"
      const lots = out.get(ca) ?? new Map<string, LotSummary>()
      const cur = lots.get(t.lots.id) ?? {
        lotId: t.lots.id,
        maLo: t.lots.ma_lo,
        loaiCsr: t.lots.loai_csr || "—",
        loaiBanh: num(t.lots.loai_banh),
        boc: t.lots.boc || "",
        trangThai: t.lots.trang_thai || "",
        banh: 0,
        kg: 0,
        nganIds: [],
      }
      cur.banh += num(t.so_banh)
      cur.kg += num(t.so_kg)
      if (t.ngan_id && !cur.nganIds.includes(t.ngan_id)) cur.nganIds.push(t.ngan_id)
      lots.set(t.lots.id, cur)
      out.set(ca, lots)
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ca, lots]) => ({ ca, lots: [...lots.values()] }))
  }, [txs])

  const totalBanh = txs.reduce((s, t) => s + num(t.so_banh), 0)
  const totalKg = txs.reduce((s, t) => s + num(t.so_kg), 0)
  const lotCount = new Set(txs.map((t) => t.lots?.id).filter(Boolean)).size
  const ngayLabel = validDate ? formatStorageDate(date) : date

  const loadPdfBytes = useCallback(async () => {
    if (!factoryId) throw new Error("Chưa xác định nhà máy.")
    const b = await resolveShiftReport(factoryId, date)
    bundleRef.current = b
    setBundle(b)
    setBundleEmpty(!b)
    if (!b) throw new Error("Ngày này chưa có dữ liệu thành phẩm.")
    return shiftBundleBytes(b)
  }, [factoryId, date])

  const ensureBundle = async (): Promise<ShiftReportBundle | null> => {
    if (bundleRef.current) return bundleRef.current
    if (!factoryId) return null
    const b = await resolveShiftReport(factoryId, date)
    bundleRef.current = b
    setBundle(b)
    setBundleEmpty(!b)
    return b
  }

  const handleDownload = async () => {
    setBusy(true)
    try {
      const b = await ensureBundle()
      if (!b) { showToast("Ngày này chưa có dữ liệu thành phẩm.", false); return }
      downloadShiftReportPdfDoc(b.doc, b.fileName)
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không tải được phiếu.", false)
    } finally {
      setBusy(false)
    }
  }

  const handleShare = async () => {
    setBusy(true)
    try {
      const b = await ensureBundle()
      if (!b) { showToast("Ngày này chưa có dữ liệu thành phẩm.", false); return }
      await shareShiftReportImage(b.doc, b.fileName)
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không chia sẻ được phiếu.", false)
    } finally {
      setBusy(false)
    }
  }

  const toastNode = toast && (
    <div className={`fixed top-4 left-1/2 z-[70] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-2xl ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
      {toast.msg}
    </div>
  )

  if (!validDate) {
    return <div className={moduleThemeClass("forest")}><ListState kind="error" message="Ngày không hợp lệ." /></div>
  }
  if (loading) return <div className={moduleThemeClass("forest")}><ListState kind="loading" /></div>
  if (loadError) {
    return <div className={moduleThemeClass("forest")}><ListState kind="error" message={loadError} onRetry={() => void load()} /></div>
  }

  const cas = lockState?.cas?.length ? lockState.cas : byCa.map((c) => c.ca)
  const lockedCas = lockState?.lockedCas || []
  const lockBadge = lockState?.fullyLocked
    ? <StatusBadge tone="valid" label="Đã phê duyệt đủ ca" size="md" />
    : lockedCas.length > 0
      ? <StatusBadge tone="warn" label={`${lockedCas.length}/${cas.length} ca đã phê duyệt`} size="md" />
      : <StatusBadge tone="draft" label="Chưa phê duyệt ca" size="md" />

  const secondary: SignAction[] = []
  if (canReport) {
    secondary.push({ key: "download", label: "Tải PDF", icon: <Download size={16} />, onClick: () => void handleDownload(), disabled: busy })
    secondary.push({ key: "share", label: "Chia sẻ ảnh", icon: <Share2 size={16} />, onClick: () => void handleShare(), disabled: busy })
  }
  secondary.push({ key: "back", label: "Về danh sách", icon: <ListChecks size={16} />, onClick: () => window.location.assign("/dashboard/product") })

  const lotsTable = (
    <div className="space-y-4">
      {byCa.length === 0 ? (
        <ListState kind="empty" message="Ngày này chưa có giao dịch thành phẩm" />
      ) : byCa.map(({ ca, lots }) => (
        <div key={ca}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-mod-50 px-2.5 py-1 text-sm font-extrabold text-mod-800">Ca {ca}</span>
            <span className="text-xs font-bold text-slate-500">
              {lots.reduce((s, l) => s + l.banh, 0).toLocaleString("vi-VN")} bành · {fmtKg(lots.reduce((s, l) => s + l.kg, 0))}
            </span>
            {lockedCas.includes(ca) && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700"><ShieldCheck size={10} /> Đã phê duyệt</span>
            )}
          </div>
          <ResponsiveTableWrapper>
            <table className="enterprise-table dense min-w-[720px]">
              <thead>
                <tr>
                  <th>Mã lô</th>
                  <th>Ngăn</th>
                  <th>Loại</th>
                  <th>Bọc</th>
                  <th className="text-right">Số bành</th>
                  <th className="text-right">Số kg</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.lotId}>
                    <td className="whitespace-nowrap font-bold">
                      <Link href={`/dashboard/product/lot/${l.lotId}`} className="text-mod-800 hover:underline">{l.maLo}</Link>
                    </td>
                    <td className="whitespace-nowrap text-xs">{l.nganIds.map((id) => ngans[id] || "—").join(", ") || "—"}</td>
                    <td className="whitespace-nowrap text-xs">{l.loaiCsr} · {l.loaiBanh} kg</td>
                    <td className="max-w-[160px] truncate text-xs text-slate-500" title={l.boc}>{l.boc || "—"}</td>
                    <td className="text-right font-semibold tabular-nums">{l.banh.toLocaleString("vi-VN")}</td>
                    <td className="text-right tabular-nums">{Math.round(l.kg).toLocaleString("vi-VN")}</td>
                    <td><StatusBadge domain="lot" status={normalizeLotStatus(l.trangThai)} size="xs" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        </div>
      ))}
    </div>
  )

  return (
    <div className={moduleThemeClass("forest")}>
      {toastNode}
      <DetailSplitLayout
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        header={
          <DetailPageHeader
            backHref="/dashboard/product"
            backLabel="Quay lại danh sách thành phẩm"
            eyebrow="Phiếu thành phẩm"
            title={`Ngày SX ${ngayLabel}`}
            tags={
              <>
                <span className={chip}>{cas.length} ca</span>
                <span className={chip}>{lotCount} lô</span>
                <span className={chip}>{totalBanh.toLocaleString("vi-VN")} bành · {fmtKg(totalKg)}</span>
              </>
            }
            actions={canReport ? <HeaderButton icon={<Download size={15} />} label="Tải PDF" onClick={() => void handleDownload()} /> : undefined}
          />
        }
        document={
          <>
            <SegmentedTabs
              ariaLabel="Chọn nội dung cột tài liệu"
              value={docTab}
              onChange={setDocTab}
              items={[
                { key: "file", label: "Phiếu thành phẩm", icon: FileText },
                { key: "lots", label: "Danh sách lô", icon: Boxes, count: lotCount },
              ]}
            />
            {docTab === "file" ? (
              canReport ? (
                <DocViewer
                  key={`day-${date}`}
                  active={isDesktop || mobileTab === "doc"}
                  loadBytes={loadPdfBytes}
                  sourceKey={`day-${date}-${txs.length}-${totalBanh}-${lockedCas.join(",")}`}
                  kind="pdf"
                  fileExt="pdf"
                  label={`Phiếu thành phẩm ngày ${ngayLabel}`}
                />
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Xem Phiếu thành phẩm cần quyền tạo thành phẩm, xác nhận sản xuất hoặc phê duyệt ca. Xem danh sách lô ở tab bên cạnh.
                </div>
              )
            ) : lotsTable}
          </>
        }
        inspector={
          <>
            <StatusSummaryBar
              domain="lot"
              status={null}
              badge={lockBadge}
              headline={`${totalBanh.toLocaleString("vi-VN")} bành · ${fmtKg(totalKg)}`}
            />
            {bundle?.hint && <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs font-semibold text-sky-800">{bundle.hint}</div>}
            {bundle?.warning && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800">{bundle.warning}</div>}
            {bundleEmpty && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">Ngày này chưa có dữ liệu để dựng phiếu.</div>}
            <SignActionBox title="Hành động" secondary={secondary} />
            <InspectorCard title="Tổng hợp" icon={CalendarDays}>
              <MetaList>
                <MetaRow label="Ngày sản xuất" value={ngayLabel} />
                <MetaRow label="Số ca" value={cas.length ? cas.map((c) => `Ca ${c}`).join(", ") : "—"} />
                <MetaRow label="Ca đã phê duyệt" value={lockedCas.length ? lockedCas.map((c) => `Ca ${c}`).join(", ") : "Chưa có"} />
                <MetaRow label="Số lô" value={String(lotCount)} />
                <MetaRow label="Tổng bành" value={totalBanh.toLocaleString("vi-VN")} />
                <MetaRow label="Tổng kg" value={fmtKg(totalKg)} />
              </MetaList>
            </InspectorCard>
          </>
        }
      />
    </div>
  )
}
