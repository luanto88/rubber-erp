"use client"

import Link from "next/link"
import dynamic from "next/dynamic"
import { useEffect, useMemo, useState } from "react"
import { Activity, ArrowLeft, Download, FileText, Layers, Map, QrCode, Truck, Warehouse, Weight } from "lucide-react"
import { InventoryQrCard } from "@/app/dashboard/inventory/_components/inventory-qr-card"
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
import { downloadStorageDetailPdf } from "@/lib/storage-pdf"
import { getStorageStatusLabelEn, getStorageStatusTheme, normalizeStorageStatus } from "@/lib/storage-status"

// leaflet đọc `window` ngay khi module được load — phải tắt SSR, nếu không trang public
// /storage (server-rendered) sẽ crash với "ReferenceError: window is not defined".
const StorageGeoJsonMap = dynamic(
  () => import("@/app/dashboard/storage/_components/storage-geojson-map").then((m) => m.StorageGeoJsonMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] w-full items-center justify-center rounded-3xl border border-slate-200 bg-slate-50 text-sm text-slate-400">
        Đang tải bản đồ...
      </div>
    ),
  },
)

type StorageDetailClientProps = {
  nganId?: string
  nganCode?: string
  showDashboardBackLink?: boolean
}

const safeDownloadName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")

export function StorageDetailClient({
  nganId,
  nganCode,
  showDashboardBackLink = false,
}: StorageDetailClientProps) {
  const [detail, setDetail] = useState<StorageDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [geoJson, setGeoJson] = useState<StorageGeoJsonCollection | null>(null)
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [exportingGeoJson, setExportingGeoJson] = useState(false)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await loadStorageDetailByLookup({ nganId, nganCode })
        setDetail(data)
      } catch (err) {
        setDetail(null)
        setError(err instanceof Error ? err.message : "Không tải được chi tiết ngăn lưu.")
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [nganCode, nganId])

  useEffect(() => {
    const run = async () => {
      if (!detail) {
        setGeoJson(null)
        setGeoError(null)
        return
      }

      setGeoLoading(true)
      setGeoError(null)

      try {
        const data = await loadPublicStorageGeoJson(detail.ngan.factory_id, detail.ngan)
        setGeoJson(data)
      } catch (err) {
        setGeoJson(null)
        setGeoError(err instanceof Error ? err.message : "Không tải được dữ liệu bản đồ của ngăn.")
      } finally {
        setGeoLoading(false)
      }
    }

    void run()
  }, [detail])

  const groupedLots = useMemo(() => {
    if (!detail) return []

    const grouped = detail.lots.reduce<
      Record<string, { key: string; label: string; totalKg: number; items: typeof detail.lots }>
    >((acc, lot) => {
      const key = [lot.loai_csr, lot.loai_banh, lot.boc || ""].join("|")
      if (!acc[key]) {
        acc[key] = {
          key,
          label: `${lot.loai_csr || "—"} / Bành ${lot.loai_banh || 0} / ${lot.boc || "—"}`,
          totalKg: 0,
          items: [],
        }
      }
      acc[key].totalKg += lot.tong_kg || 0
      acc[key].items.push(lot)
      return acc
    }, {})

    return Object.values(grouped).sort((a, b) => b.totalKg - a.totalKg)
  }, [detail])

  const summary = useMemo(() => (detail ? summarizeStorageLots(detail.lots) : null), [detail])
  const ratio = detail && summary && detail.ngan.tong_kho > 0 ? (summary.thanhPhamKg / detail.ngan.tong_kho) * 100 : null

  const statusLabelVi = detail ? normalizeStorageStatus(detail.ngan.trang_thai) || "—" : "—"
  const statusLabelEn = detail ? getStorageStatusLabelEn(detail.ngan.trang_thai) : ""
  const statusTheme = getStorageStatusTheme(detail?.ngan.trang_thai)

  const handleExportPdf = async () => {
    if (!detail) return

    setExportingPdf(true)
    try {
      await downloadStorageDetailPdf(detail)
    } finally {
      setExportingPdf(false)
    }
  }

  const handleExportGeoJson = () => {
    if (!detail || !geoJson) return

    setExportingGeoJson(true)
    try {
      if (geoJson.metadata.total_plot_codes === 0) {
        setGeoError(`Ngăn ${detail.ngan.ten_ngan} chưa có lô thu hoạch để xuất GeoJSON.`)
        return
      }

      const blob = new Blob([JSON.stringify(geoJson, null, 2)], { type: "application/geo+json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `ngan-${safeDownloadName(detail.ngan.ten_ngan || detail.ngan.ma_ngan || detail.ngan.id)}.geojson`
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingGeoJson(false)
    }
  }

  if (loading) {
    return <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-400">Đang tải chi tiết ngăn lưu...</div>
  }

  if (error || !detail) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-red-700">
        <p className="font-bold">Không mở được chi tiết ngăn lưu.</p>
        <p className="mt-2 text-sm">{error || "Dữ liệu không tồn tại."}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {showDashboardBackLink ? (
            <Link href="/dashboard/storage" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 hover:text-emerald-800">
              <ArrowLeft size={15} />
              Quay lại danh sách ngăn lưu
            </Link>
          ) : null}
          <h1 className="mt-3 text-3xl font-extrabold text-slate-900 break-words">{detail.ngan.ten_ngan}</h1>
          <p className="mt-1 text-sm text-slate-500">{detail.ngan.ma_ngan || "—"}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleExportPdf()}
          disabled={exportingPdf}
          className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <FileText size={15} />
          {exportingPdf ? "Đang xuất PDF..." : "Xuất PDF chi tiết"}
        </button>
      </div>

      <div
        className={`inline-flex w-full flex-wrap items-center gap-2 rounded-2xl border border-white/60 bg-gradient-to-br ${statusTheme.gradient} px-4 py-3 shadow-sm sm:w-auto`}
      >
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${statusTheme.badge}`}>
          <Activity size={16} />
        </span>
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          Trạng thái ngăn / Bin status
        </span>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-extrabold ${statusTheme.badge}`}>
          <span className={`h-2 w-2 rounded-full ${statusTheme.dot}`} />
          {statusLabelVi}
          <span className="font-semibold opacity-70">· {statusLabelEn}</span>
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div className={`rounded-3xl border border-slate-200 bg-gradient-to-br ${statusTheme.gradient} p-6`}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "Loại nguyên liệu", value: detail.ngan.loai_nl, icon: <Layers size={16} className="text-emerald-600" /> },
              { label: "Ngày nguyên liệu", value: `${formatStorageDate(detail.ngan.ngay_bd)} - ${formatStorageDate(detail.ngan.ngay_kt)}`, icon: <Warehouse size={16} className="text-emerald-600" /> },
              { label: "Ngày xé", value: `${formatStorageDate(detail.ngan.xe_tu_ngay)} - ${formatStorageDate(detail.ngan.xe_den_ngay)}`, icon: <QrCode size={16} className="text-emerald-600" /> },
              { label: "Khối lượng nguyên liệu khô", value: `${(detail.ngan.tong_kho || 0).toLocaleString("vi-VN")} kg`, icon: <Weight size={16} className="text-emerald-600" /> },
              { label: "Khối lượng thành phẩm", value: `${(summary?.thanhPhamKg || 0).toLocaleString("vi-VN")} kg`, icon: <Weight size={16} className="text-emerald-600" /> },
              { label: "Tỷ lệ TP/QK", value: ratio === null ? "—" : `${ratio.toFixed(1)}%`, icon: <Weight size={16} className="text-emerald-600" /> },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  {item.icon}
                  {item.label}
                </div>
                <div className="mt-3 text-base font-bold text-slate-800">{item.value || "—"}</div>
              </div>
            ))}
          </div>
          {detail.ngan.ghi_chu ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-bold">Ghi chú:</span> {detail.ngan.ghi_chu}
            </div>
          ) : null}
        </div>

        <InventoryQrCard
          title="QR ngăn"
          caption="Quét mã để mở lại đúng trang chi tiết này trên web."
          hrefPath={buildStorageLookupPath(detail.ngan.id, detail.ngan.ma_ngan)}
          valueText={detail.ngan.ma_ngan || detail.ngan.ten_ngan}
          downloadFileName={`QR-${detail.ngan.ma_ngan || detail.ngan.ten_ngan}`}
        />
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">Bản đồ lô thu hoạch</h2>
            <p className="text-sm text-slate-400">Xem nhanh vùng lô vườn của ngăn và tải file GeoJSON trực tiếp.</p>
          </div>
          <button
            type="button"
            onClick={handleExportGeoJson}
            disabled={geoLoading || exportingGeoJson || !geoJson || geoJson.metadata.total_plot_codes === 0}
            className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            <Download size={15} />
            {exportingGeoJson ? "Đang xuất GeoJSON..." : "Tải GeoJSON"}
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              <Map size={14} className="text-sky-600" />
              Mã lô thu hoạch
            </div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">
              {geoJson?.metadata.total_plot_codes.toLocaleString("vi-VN") ?? 0}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              <Truck size={14} className="text-sky-600" />
              Chuyến điều xe
            </div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">
              {geoJson?.metadata.trip_count.toLocaleString("vi-VN") ?? detail.trips.length}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              <Layers size={14} className="text-sky-600" />
              Polygon hiển thị
            </div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">
              {geoJson?.features.length.toLocaleString("vi-VN") ?? 0}
            </div>
          </div>
        </div>

        <div className="mt-4">
          {geoLoading ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-10 text-center text-slate-400">
              Đang tải bản đồ lô thu hoạch...
            </div>
          ) : geoError ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
              {geoError}
            </div>
          ) : !geoJson || geoJson.metadata.total_plot_codes === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-400">
              Ngăn này chưa có lô thu hoạch để hiển thị bản đồ hoặc xuất GeoJSON.
            </div>
          ) : geoJson.features.length === 0 ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
              Đã tìm thấy mã lô thu hoạch nhưng chưa khớp được polygon GeoJSON.
            </div>
          ) : (
            <StorageGeoJsonMap data={geoJson} />
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Chuyến xe nguyên liệu</h2>
              <p className="text-sm text-slate-400">{detail.trips.length} chuyến đã liên kết với ngăn này</p>
            </div>
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">
              <Truck size={15} className="mr-2 inline-block" />
              {detail.trips.length}
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {detail.trips.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                Chưa có chuyến xe nào trong ngăn này.
              </div>
            ) : (
              detail.trips.map((trip) => {
                const kl = getKLFromTrip(trip, detail.ngan.loai_nl)
                return (
                  <div key={trip.ref || trip.uid} className="rounded-2xl border border-slate-200 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold text-slate-800">{trip.so_xe || "—"} · C{trip.chuyen || 1}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatStorageDate(trip._date)} · {trip.tai_xe || "Chưa có tài xế"}
                        </div>
                      </div>
                      <div className="text-right text-sm font-semibold text-slate-700">
                        <div>{kl.tuoi.toLocaleString("vi-VN")} kg tươi</div>
                        <div className="text-emerald-700">{kl.kho.toLocaleString("vi-VN")} kg khô</div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Lô thành phẩm</h2>
              <p className="text-sm text-slate-400">
                {summary?.totalLots || 0} lô, gồm {summary?.doDangCount || 0} lô dở dang
              </p>
            </div>
            <div className="rounded-2xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">
              {(summary?.thanhPhamKg || 0).toLocaleString("vi-VN")} kg
            </div>
          </div>
          <div className="mt-4 space-y-4">
            {groupedLots.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                Chưa có lô thành phẩm nào sử dụng nguyên liệu từ ngăn này.
              </div>
            ) : (
              groupedLots.map((group) => (
                <div key={group.key} className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="bg-slate-50 px-4 py-3">
                    <div className="font-bold text-slate-800">{group.label}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {group.items.length} lô · {group.totalKg.toLocaleString("vi-VN")} kg
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {group.items.map((lot) => (
                      <div key={lot.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div>
                          <div className="font-semibold text-slate-800">{lot.ma_lo}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatStorageDate(lot.ngay_sx)} · Ca {lot.ca || "—"} · {lot.tong_banh || 0} bành · {lot.trang_thai}
                          </div>
                        </div>
                        <div className="text-right text-sm font-bold text-slate-700">
                          {(lot.tong_kg || 0).toLocaleString("vi-VN")} kg
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
