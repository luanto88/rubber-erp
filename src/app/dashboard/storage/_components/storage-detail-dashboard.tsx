"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Boxes, Download, ExternalLink, FileText, Map as MapIcon, Pencil, Truck, Warehouse, Weight } from "lucide-react"
import { hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import {
  buildStorageLookupPath,
  formatStorageDate,
  getKLFromTrip,
  loadPublicStorageGeoJson,
  loadStorageDetailByLookup,
  summarizeStorageLots,
  type StorageDetailData,
  type StorageGeoJsonCollection,
} from "@/lib/storage-detail"
import { buildStorageDetailPdfBytes, downloadStorageDetailPdf } from "@/lib/storage-pdf"
import {
  normalizeStorageStatus,
  STORAGE_STATUS_CLOSED,
  STORAGE_STATUS_RECEIVING,
  STORAGE_STATUS_WAITING,
} from "@/lib/storage-status"
import { normalizeLotStatus } from "@/app/dashboard/product/shared"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { DetailSplitLayout } from "@/app/dashboard/_components/doc-ui/detail-split-layout"
import { DetailPageHeader, HeaderButton } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import { HeaderQr } from "@/app/dashboard/_components/doc-ui/header-qr"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { useIsDesktop } from "@/app/dashboard/_components/doc-ui/use-is-desktop"
import { InspectorCard, MetaList, MetaRow, StatusSummaryBar } from "@/app/dashboard/_components/doc-ui/inspector-card"
import { SignActionBox, type SignAction } from "@/app/dashboard/_components/doc-ui/sign-action-box"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"

/**
 * Trang chi tiết ngăn lưu trong dashboard (rule 29 mục C, 2026-10-18).
 * Cột trái nhúng PDF "Theo dõi vòng đời ngăn lưu" (F03) dựng ngay trong trình duyệt — cùng nội dung
 * nút "Xuất PDF" (`downloadStorageDetailPdf`). Trang tra cứu công khai `/storage` vẫn dùng
 * `StorageDetailClient`, không đổi.
 */

// leaflet đọc `window` khi load module — phải tắt SSR (xem storage.md mục 14).
const StorageGeoJsonMap = dynamic(
  () => import("@/app/dashboard/storage/_components/storage-geojson-map").then((m) => m.StorageGeoJsonMap),
  {
    ssr: false,
    loading: () => <ListState kind="loading" message="Đang tải bản đồ..." />,
  },
)

type DocTab = "file" | "trips" | "lots" | "map"

const safeDownloadName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")

const fmtKg = (value: number) => `${Math.round(value || 0).toLocaleString("vi-VN")} kg`

export function StorageDetailDashboard({ nganId }: { nganId: string }) {
  const isDesktop = useIsDesktop()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [detail, setDetail] = useState<StorageDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<"doc" | "info">("info")
  const [docTab, setDocTab] = useState<DocTab>("file")
  const [geoJson, setGeoJson] = useState<StorageGeoJsonCollection | null>(null)
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [origin, setOrigin] = useState("")

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    window.setTimeout(() => setToast(null), 3500)
  }, [])

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { user: sessionUser } = await hydrateActiveSession()
      if (!sessionUser) {
        window.location.replace(`/login?next=${encodeURIComponent(`/dashboard/storage/${nganId}`)}`)
        return
      }
      if (!hasPermission(sessionUser, "storage.view")) {
        window.location.replace("/dashboard")
        return
      }
      setUser(sessionUser)
      const data = await loadStorageDetailByLookup({ nganId })
      setDetail(data)
    } catch (err) {
      setDetail(null)
      setLoadError(err instanceof Error ? err.message : "Không tải được chi tiết ngăn lưu.")
    } finally {
      setLoading(false)
    }
  }, [nganId])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  // GeoJSON chỉ tải khi mở tab Bản đồ hoặc bấm Tải GeoJSON lần đầu.
  const ensureGeoJson = useCallback(async () => {
    if (!detail) return null
    if (geoJson) return geoJson
    setGeoLoading(true)
    setGeoError(null)
    try {
      const data = await loadPublicStorageGeoJson(detail.ngan.factory_id, detail.ngan)
      setGeoJson(data)
      return data
    } catch (err) {
      setGeoError(err instanceof Error ? err.message : "Không tải được dữ liệu bản đồ của ngăn.")
      return null
    } finally {
      setGeoLoading(false)
    }
  }, [detail, geoJson])

  useEffect(() => {
    if (docTab === "map" && !geoJson && !geoLoading && !geoError) void ensureGeoJson()
  }, [docTab, geoJson, geoLoading, geoError, ensureGeoJson])

  const summary = useMemo(() => (detail ? summarizeStorageLots(detail.lots) : null), [detail])

  // Lô thành phẩm gom theo chủng loại (CSR / bành / bọc) — thay modal "Xem chi tiết" cũ ở danh sách.
  const lotGroups = useMemo(() => {
    if (!detail) return []
    const map = new Map<string, { key: string; label: string; totalKg: number; lots: StorageDetailData["lots"] }>()
    for (const lot of detail.lots) {
      const key = [lot.loai_csr, lot.loai_banh, lot.boc || ""].join("|")
      const g = map.get(key) ?? {
        key,
        label: `${lot.loai_csr || "—"} / Bành ${lot.loai_banh || 0} / ${lot.boc || "—"}`,
        totalKg: 0,
        lots: [],
      }
      g.totalKg += lot.tong_kg || 0
      g.lots.push(lot)
      map.set(key, g)
    }
    return [...map.values()]
      .map((g) => ({
        ...g,
        lots: [...g.lots].sort((a, b) => (b.ngay_sx || "").localeCompare(a.ngay_sx || "") || a.ma_lo.localeCompare(b.ma_lo)),
      }))
      .sort((a, b) => b.totalKg - a.totalKg)
  }, [detail])

  const toastNode = toast && (
    <div className={`fixed top-4 left-1/2 z-[70] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-2xl ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
      {toast.msg}
    </div>
  )

  if (loading) {
    return <div className={moduleThemeClass("amber")}><ListState kind="loading" /></div>
  }
  if (loadError || !detail || !summary) {
    return (
      <div className={moduleThemeClass("amber")}>
        <ListState
          kind={loadError ? "error" : "empty"}
          message={loadError || "Không tìm thấy ngăn lưu, hoặc bạn không có quyền xem."}
          onRetry={loadError ? () => void loadDetail() : undefined}
        />
      </div>
    )
  }

  const ngan = detail.ngan
  const tenNgan = ngan.ten_ngan || ngan.ma_ngan || "Ngăn lưu"
  const ratio = ngan.tong_kho > 0 ? (summary.thanhPhamKg / ngan.tong_kho) * 100 : null
  const lookupPath = buildStorageLookupPath(ngan.id, ngan.ma_ngan)
  const detailUrl = origin ? `${origin}/dashboard/storage/${ngan.id}` : ""
  const normalizedStatus = normalizeStorageStatus(ngan.trang_thai)
  const isAdmin = user?.role === "admin"
  // Cùng điều kiện nút Sửa ở danh sách (storage/page.tsx, canEditThisNgan).
  const canEdit =
    (hasPermission(user, "storage.create") || hasPermission(user, "storage.edit")) &&
    (isAdmin ||
      normalizedStatus === STORAGE_STATUS_RECEIVING ||
      normalizedStatus === STORAGE_STATUS_CLOSED ||
      normalizedStatus === STORAGE_STATUS_WAITING)
  const editHref = `/dashboard/storage?edit=${encodeURIComponent(ngan.id)}`
  const lotCountLabel =
    summary.doDangCount > 0
      ? `${summary.totalLots} lô (${summary.tronLoCount} tròn, ${summary.doDangCount} dở dang)`
      : `${summary.totalLots} lô`

  const downloadPdf = async () => {
    setExportingPdf(true)
    try {
      await downloadStorageDetailPdf(detail)
    } catch {
      showToast("Không tạo được PDF chi tiết ngăn.", false)
    } finally {
      setExportingPdf(false)
    }
  }

  const downloadGeoJson = async () => {
    const data = await ensureGeoJson()
    if (!data) {
      showToast("Không tải được dữ liệu GeoJSON của ngăn.", false)
      return
    }
    if (data.metadata.total_plot_codes === 0) {
      showToast(`Ngăn ${tenNgan} chưa có lô thu hoạch để xuất GeoJSON.`, false)
      return
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/geo+json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `ngan-${safeDownloadName(ngan.ten_ngan || ngan.ma_ngan || ngan.id)}.geojson`
    link.click()
    URL.revokeObjectURL(url)
  }

  const secondary: SignAction[] = [
    { key: "pdf", label: "Tải PDF", icon: <Download size={14} />, loading: exportingPdf, onClick: () => void downloadPdf() },
    { key: "geo", label: "Tải GeoJSON", icon: <MapIcon size={14} />, loading: geoLoading, onClick: () => void downloadGeoJson() },
    { key: "lookup", label: "Trang tra cứu", icon: <ExternalLink size={14} />, onClick: () => window.open(lookupPath, "_blank") },
    ...(canEdit
      ? [{ key: "edit", label: "Chỉnh sửa ngăn", icon: <Pencil size={14} />, onClick: () => window.location.assign(editHref) }]
      : []),
  ]

  const chip = "rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11.5px] font-medium text-slate-600"

  const tripsTable = (
    <ResponsiveTableWrapper>
      <table className="enterprise-table dense min-w-[640px]">
        <thead>
          <tr>
            <th className="w-10 text-right">#</th>
            <th>Ngày</th>
            <th>Xe · Chuyến</th>
            <th>Tài xế</th>
            <th className="text-right">KL tươi (kg)</th>
            <th className="text-right">KL khô (kg)</th>
          </tr>
        </thead>
        <tbody>
          {detail.trips.length === 0 ? (
            <ListState kind="empty" message="Chưa có chuyến xe nào trong ngăn này" asRow colSpan={6} />
          ) : detail.trips.map((trip, idx) => {
            const kl = getKLFromTrip(trip, ngan.loai_nl)
            return (
              <tr key={trip.ref || trip.uid}>
                <td className="text-right text-slate-500">{idx + 1}</td>
                <td className="whitespace-nowrap">{formatStorageDate(trip._date)}</td>
                <td className="whitespace-nowrap font-semibold text-slate-800">{trip.so_xe || "—"} · C{trip.chuyen || 1}</td>
                <td className="whitespace-nowrap">{trip.tai_xe || "—"}</td>
                <td className="text-right tabular-nums">{kl.tuoi.toLocaleString("vi-VN")}</td>
                <td className="text-right font-semibold tabular-nums text-mod-800">{kl.kho.toLocaleString("vi-VN")}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </ResponsiveTableWrapper>
  )

  const lotsTable = (
    <ResponsiveTableWrapper>
      <table className="enterprise-table dense min-w-[720px]">
        <thead>
          <tr>
            <th>Mã lô</th>
            <th>Ngày SX</th>
            <th>Ca</th>
            <th className="text-right">Bành</th>
            <th className="text-right">KL (kg)</th>
            <th>Trạng thái</th>
            <th className="text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {lotGroups.length === 0 ? (
            <ListState kind="empty" message="Chưa có lô thành phẩm nào dùng nguyên liệu từ ngăn này" asRow colSpan={7} />
          ) : lotGroups.map((g) => (
            <LotGroupRows key={g.key} label={g.label} totalKg={g.totalKg} lots={g.lots} />
          ))}
        </tbody>
      </table>
    </ResponsiveTableWrapper>
  )

  const mapPanel = geoLoading ? (
    <ListState kind="loading" message="Đang tải bản đồ lô thu hoạch..." />
  ) : geoError ? (
    <ListState kind="error" message={geoError} onRetry={() => { setGeoError(null) }} />
  ) : !geoJson || geoJson.metadata.total_plot_codes === 0 ? (
    <ListState kind="empty" message="Ngăn này chưa có lô thu hoạch để hiển thị bản đồ." />
  ) : geoJson.features.length === 0 ? (
    <ListState kind="empty" message="Đã có mã lô thu hoạch nhưng chưa khớp được polygon GeoJSON." />
  ) : (
    <StorageGeoJsonMap data={geoJson} />
  )

  return (
    <div className={moduleThemeClass("amber")}>
      {toastNode}
      <DetailSplitLayout
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        header={
          <DetailPageHeader
            backHref="/dashboard/storage"
            backLabel="Quay lại danh sách ngăn lưu"
            eyebrow="Ngăn lưu nguyên liệu"
            title={tenNgan}
            code={ngan.ma_ngan || null}
            tags={
              <>
                <span className={chip}>{ngan.loai_nl || "—"}</span>
                <span className={chip}>
                  {formatStorageDate(ngan.ngay_bd)}
                  {ngan.ngay_kt ? ` → ${formatStorageDate(ngan.ngay_kt)}` : ""}
                </span>
                <span className={chip}>{detail.trips.length} chuyến · {lotCountLabel}</span>
              </>
            }
            actions={
              <>
                <HeaderButton
                  icon={<Download size={15} />}
                  label={exportingPdf ? "Đang xuất..." : "Tải PDF"}
                  disabled={exportingPdf}
                  onClick={() => void downloadPdf()}
                />
                {canEdit && <HeaderButton icon={<Pencil size={15} />} label="Chỉnh sửa" href={editHref} />}
                {detailUrl ? <HeaderQr value={detailUrl} code={ngan.ma_ngan || tenNgan} title="QR ngăn lưu" /> : null}
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
                { key: "file", label: "Bản PDF", icon: FileText },
                { key: "trips", label: "Chuyến xe", icon: Truck, count: detail.trips.length },
                { key: "lots", label: "Lô thành phẩm", icon: Boxes, count: summary.totalLots },
                { key: "map", label: "Bản đồ", icon: MapIcon },
              ]}
            />
            {docTab === "file" ? (
              <DocViewer
                key={`ngan-${ngan.id}`}
                active={isDesktop || mobileTab === "doc"}
                loadBytes={() => buildStorageDetailPdfBytes(detail)}
                sourceKey={`ngan-${ngan.id}-${ngan.trang_thai}-${ngan.tong_kho}-${detail.trips.length}-${detail.lots.length}-${summary.thanhPhamKg}`}
                kind="pdf"
                fileExt="pdf"
                label={`Chi tiết ngăn ${tenNgan} · Bản xem trước PDF`}
              />
            ) : docTab === "trips" ? tripsTable : docTab === "lots" ? lotsTable : mapPanel}
          </>
        }
        inspector={
          <>
            <StatusSummaryBar
              domain="storage"
              status={normalizedStatus || ngan.trang_thai}
              headline={ratio === null ? "Chưa có KL khô" : `TP/QK ${ratio.toFixed(1)}%`}
            />
            <SignActionBox title="Hành động" secondary={secondary} />
            <InspectorCard title="Khối lượng" icon={Weight}>
              <MetaList>
                <MetaRow label="KL nguyên liệu tươi" value={fmtKg(ngan.tong_tuoi)} />
                <MetaRow label="KL nguyên liệu khô" value={fmtKg(ngan.tong_kho)} />
                <MetaRow label="KL thành phẩm" value={fmtKg(summary.thanhPhamKg)} />
                <MetaRow label="Tỷ lệ TP/QK" value={ratio === null ? "—" : `${ratio.toFixed(1)}%`} />
                <MetaRow label="Số lô" value={lotCountLabel} />
              </MetaList>
              {ratio !== null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-blue-400" style={{ width: `${Math.min(ratio, 100)}%` }} />
                </div>
              )}
            </InspectorCard>
            <InspectorCard title="Thông tin ngăn" icon={Warehouse}>
              <MetaList>
                <MetaRow label="Mã ngăn" value={ngan.ma_ngan || "—"} mono />
                <MetaRow label="Loại nguyên liệu" value={ngan.loai_nl || "—"} />
                <MetaRow label="Nguồn gốc · Xử lý" value={`${ngan.nguon_goc || "—"} · ${ngan.xu_ly || "—"}`} />
                <MetaRow label="Chứng nhận" value={ngan.chung_nhan || "—"} />
                <MetaRow
                  label="Ngày nguyên liệu"
                  value={`${formatStorageDate(ngan.ngay_bd)}${ngan.ngay_kt ? ` → ${formatStorageDate(ngan.ngay_kt)}` : ""}`}
                />
                <MetaRow
                  label="Ngày xé"
                  value={ngan.xe_tu_ngay ? `${formatStorageDate(ngan.xe_tu_ngay)}${ngan.xe_den_ngay ? ` → ${formatStorageDate(ngan.xe_den_ngay)}` : ""}` : "—"}
                />
                {ngan.ghi_chu && <MetaRow label="Ký hiệu KT" value={ngan.ghi_chu} />}
                {ngan.ghi_chu_tu_do && <MetaRow label="Ghi chú" value={ngan.ghi_chu_tu_do} />}
              </MetaList>
            </InspectorCard>
          </>
        }
      />
    </div>
  )
}

function LotGroupRows({
  label,
  totalKg,
  lots,
}: {
  label: string
  totalKg: number
  lots: StorageDetailData["lots"]
}) {
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={4} className="font-bold text-slate-700">
          {label}
          <span className="ml-2 text-xs font-medium text-slate-500">{lots.length} lô</span>
        </td>
        <td className="text-right font-extrabold tabular-nums text-slate-800">{Math.round(totalKg).toLocaleString("vi-VN")}</td>
        <td colSpan={2} />
      </tr>
      {lots.map((lot) => {
        const lotId = lot.lot_id || lot.id
        return (
          <tr key={`${lot.id}-${lot.ngay_sx}-${lot.ca}`}>
            <td className="whitespace-nowrap font-semibold text-slate-800">{lot.ma_lo}</td>
            <td className="whitespace-nowrap">{formatStorageDate(lot.ngay_sx)}</td>
            <td className="whitespace-nowrap">{lot.ca || "—"}</td>
            <td className="text-right tabular-nums">{(lot.tong_banh || 0).toLocaleString("vi-VN")}</td>
            <td className="text-right tabular-nums">{Math.round(lot.tong_kg || 0).toLocaleString("vi-VN")}</td>
            <td>
              <StatusBadge domain="lot" status={normalizeLotStatus(lot.trang_thai)} size="xs" />
            </td>
            <td className="text-right">
              {lotId ? <RowAction kind="view" label={`Xem chi tiết lô ${lot.ma_lo}`} href={`/dashboard/product/lot/${lotId}`} /> : null}
            </td>
          </tr>
        )
      })}
    </>
  )
}
