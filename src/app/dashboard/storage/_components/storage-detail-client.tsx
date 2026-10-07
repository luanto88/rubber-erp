"use client"

import Link from "next/link"
import dynamic from "next/dynamic"
import { useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  Calendar,
  Clock,
  Download,
  Eye,
  FileText,
  Layers,
  Map,
  MapPin,
  Percent,
  Scale,
  ShieldCheck,
  Tag,
  Truck,
  Warehouse,
} from "lucide-react"
import {
  buildStorageLookupPath,
  formatStorageDate,
  getKLFromTrip,
  loadPublicStorageGeoJson,
  loadStorageDetailByLookup,
  summarizeStorageLots,
  type StorageDetailData,
  type StorageGeoJsonCollection,
  type StorageProducedLot,
} from "@/lib/storage-detail"
import { downloadStorageDetailPdf } from "@/lib/storage-pdf"
import {
  getStorageAgingDays,
  getStorageStatusLabelEn,
  getStorageStatusTheme,
  normalizeStorageStatus,
} from "@/lib/storage-status"
import { DetailCard, DetailFieldItem, DetailFileCard, DetailQrBox } from "@/app/dashboard/_components/detail-view-ui"
import { StorageLotDetailModal } from "@/app/dashboard/storage/_components/storage-lot-detail-modal"

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

  // Traceability: Chiều 1 - Xem chi tiết lô thành phẩm bằng LotDetailModal
  const [selectedLotForModal, setSelectedLotForModal] = useState<StorageProducedLot | null>(null)

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
  const agingDays = detail ? getStorageAgingDays(detail.ngan.ngay_bd) : null

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
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-400 font-medium">
        Đang tải chi tiết ngăn lưu...
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-red-700">
        <p className="font-bold">Không mở được chi tiết ngăn lưu.</p>
        <p className="mt-2 text-sm">{error || "Dữ liệu không tồn tại."}</p>
      </div>
    )
  }

  const lookupUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${buildStorageLookupPath(detail.ngan.id, detail.ngan.ma_ngan)}`
      : buildStorageLookupPath(detail.ngan.id, detail.ngan.ma_ngan)

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {showDashboardBackLink && (
            <Link
              href="/dashboard/storage"
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-emerald-700 hover:text-emerald-800 transition-colors"
            >
              <ArrowLeft size={15} />
              Quay lại danh sách ngăn lưu
            </Link>
          )}
          <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-slate-900 break-words">
            {detail.ngan.ten_ngan}
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-500 font-mono">{detail.ngan.ma_ngan || "—"}</p>
        </div>
      </div>

      {/* 1. NGUYÊN TẮC FILE-FIRST: Khối tệp tài liệu đặt trên cùng */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DetailFileCard
          fileName={`Lý lịch ngăn lưu — ${detail.ngan.ten_ngan || detail.ngan.ma_ngan}.pdf`}
          fileType="pdf"
          fileSize="Báo cáo chi tiết"
          statusLabel={exportingPdf ? "Đang xuất..." : "Sẵn sàng tải"}
          statusTone="emerald"
          onDownload={() => void handleExportPdf()}
        />
        <DetailFileCard
          fileName={`Bản đồ vùng trồng EUDR — ${detail.ngan.ten_ngan || detail.ngan.ma_ngan}.geojson`}
          fileType="geojson"
          fileSize={
            geoJson
              ? `${geoJson.metadata.total_plot_codes} mã lô · ${geoJson.features.length} polygons`
              : "Đang nạp tọa độ..."
          }
          statusLabel={geoJson && geoJson.metadata.total_plot_codes > 0 ? "Bản đồ EUDR" : "Chưa có polygon"}
          statusTone={geoJson && geoJson.metadata.total_plot_codes > 0 ? "blue" : "amber"}
          onDownload={geoJson && geoJson.metadata.total_plot_codes > 0 ? handleExportGeoJson : undefined}
        />
      </div>

      {/* 2. THẺ THÔNG TIN NGĂN (DetailCard Pastel, 2 cột 50-50 mobile) */}
      <DetailCard
        icon={<Warehouse size={20} />}
        iconTone="teal"
        title={detail.ngan.ten_ngan}
        subtitle={detail.ngan.ma_ngan || "Ngăn lưu trữ nguyên liệu mủ cao su"}
        badge={
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full ${statusTheme.badge}`}>
            <span className={`h-2 w-2 rounded-full ${statusTheme.dot}`} />
            {statusLabelVi}
            <span className="font-semibold opacity-70">· {statusLabelEn}</span>
          </span>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <DetailFieldItem
            icon={<Tag size={15} />}
            iconTone="rose"
            label="Mã ngăn"
            value={detail.ngan.ma_ngan}
            mono
            highlight="rose"
          />
          <DetailFieldItem
            icon={<Layers size={15} />}
            iconTone="amber"
            label="Loại nguyên liệu"
            value={detail.ngan.loai_nl}
          />
          <DetailFieldItem
            icon={<MapPin size={15} />}
            iconTone="emerald"
            label="Nguồn gốc / Đơn vị"
            value={detail.ngan.nguon_goc || "—"}
          />
          <DetailFieldItem
            icon={<ShieldCheck size={15} />}
            iconTone="violet"
            label="Chứng nhận"
            value={detail.ngan.chung_nhan || "Không"}
          />
          <DetailFieldItem
            icon={<Calendar size={15} />}
            iconTone="emerald"
            label="Ngày BĐ nhận"
            value={formatStorageDate(detail.ngan.ngay_bd)}
          />
          <DetailFieldItem
            icon={<Calendar size={15} />}
            iconTone="rose"
            label="Ngày KT nhận"
            value={formatStorageDate(detail.ngan.ngay_kt)}
          />
          <DetailFieldItem
            icon={<Clock size={15} />}
            iconTone="amber"
            label="Ngày xé nguyên liệu"
            value={`${formatStorageDate(detail.ngan.xe_tu_ngay)} - ${formatStorageDate(detail.ngan.xe_den_ngay)}`}
          />
          <DetailFieldItem
            icon={<Clock size={15} />}
            iconTone="blue"
            label="Số ngày lưu"
            value={agingDays !== null ? `${agingDays} ngày` : "—"}
            highlight={
              agingDays !== null && agingDays >= 21
                ? "rose"
                : agingDays !== null && agingDays >= 6
                  ? "amber"
                  : undefined
            }
          />
          <DetailFieldItem
            icon={<Scale size={15} />}
            iconTone="emerald"
            label="KL mủ tươi"
            value={`${(detail.ngan.tong_tuoi || 0).toLocaleString("vi-VN")} kg`}
            mono
          />
          <DetailFieldItem
            icon={<Scale size={15} />}
            iconTone="blue"
            label="KL mủ khô"
            value={`${(detail.ngan.tong_kho || 0).toLocaleString("vi-VN")} kg`}
            mono
            highlight="blue"
          />
          <DetailFieldItem
            icon={<Percent size={15} />}
            iconTone="teal"
            label="Tỷ lệ TP / QK"
            value={
              ratio === null
                ? "—"
                : `${ratio.toFixed(1)}% (${(summary?.thanhPhamKg || 0).toLocaleString("vi-VN")} kg)`
            }
            highlight="emerald"
          />
          <DetailFieldItem
            icon={<Truck size={15} />}
            iconTone="orange"
            label="Số chuyến xe"
            value={`${detail.trips.length} chuyến`}
          />
          {(detail.ngan.ghi_chu || detail.ngan.ghi_chu_tu_do) && (
            <DetailFieldItem
              icon={<FileText size={15} />}
              iconTone="slate"
              label="Ghi chú kỹ thuật & ghi chú khác"
              value={[detail.ngan.ghi_chu, detail.ngan.ghi_chu_tu_do].filter(Boolean).join(" · ")}
              colSpan={2}
            />
          )}
        </div>
      </DetailCard>

      {/* 3. KHỐI QR NGĂN: Thay bằng DetailQrBox đồng bộ */}
      <DetailQrBox
        label="Mã QR tra cứu trực tuyến ngăn lưu"
        qrUrl={lookupUrl}
      />

      {/* 4. BẢN ĐỒ LÔ THU HOẠCH EUDR */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900">Bản đồ lô thu hoạch EUDR</h2>
            <p className="text-xs text-slate-400">Xem nhanh vùng lô vườn của ngăn và tải file GeoJSON trực tiếp.</p>
          </div>
          <button
            type="button"
            onClick={handleExportGeoJson}
            disabled={geoLoading || exportingGeoJson || !geoJson || geoJson.metadata.total_plot_codes === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50 transition-all shadow-xs"
          >
            <Download size={14} />
            {exportingGeoJson ? "Đang xuất GeoJSON..." : "Tải GeoJSON"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 border border-slate-100">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <Map size={13} className="text-sky-600" />
              Mã lô thu hoạch
            </div>
            <div className="mt-1 text-lg sm:text-xl font-extrabold text-slate-900 font-mono">
              {geoJson?.metadata.total_plot_codes.toLocaleString("vi-VN") ?? 0}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 border border-slate-100">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <Truck size={13} className="text-sky-600" />
              Chuyến xe
            </div>
            <div className="mt-1 text-lg sm:text-xl font-extrabold text-slate-900 font-mono">
              {geoJson?.metadata.trip_count.toLocaleString("vi-VN") ?? detail.trips.length}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 border border-slate-100">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <Layers size={13} className="text-sky-600" />
              Polygons
            </div>
            <div className="mt-1 text-lg sm:text-xl font-extrabold text-slate-900 font-mono">
              {geoJson?.features.length.toLocaleString("vi-VN") ?? 0}
            </div>
          </div>
        </div>

        <div className="mt-4">
          {geoLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-400 font-medium">
              Đang tải bản đồ lô thu hoạch...
            </div>
          ) : geoError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-900">
              {geoError}
            </div>
          ) : !geoJson || geoJson.metadata.total_plot_codes === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-400">
              Ngăn này chưa có lô thu hoạch để hiển thị bản đồ hoặc xuất GeoJSON.
            </div>
          ) : geoJson.features.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-900">
              Đã tìm thấy mã lô thu hoạch nhưng chưa khớp được polygon GeoJSON.
            </div>
          ) : (
            <StorageGeoJsonMap data={geoJson} />
          )}
        </div>
      </section>

      {/* 5. HAI CỘT: CHUYẾN XE NGUYÊN LIỆU & LÔ THÀNH PHẨM */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Chuyến xe nguyên liệu */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">Chuyến xe nguyên liệu</h2>
              <p className="text-xs text-slate-400">{detail.trips.length} chuyến đã liên kết với ngăn này</p>
            </div>
            <div className="rounded-xl bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700">
              <Truck size={13} className="mr-1.5 inline-block" />
              {detail.trips.length} chuyến
            </div>
          </div>
          <div className="mt-3.5 space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
            {detail.trips.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-400">
                Chưa có chuyến xe nào trong ngăn này.
              </div>
            ) : (
              detail.trips.map((trip) => {
                const kl = getKLFromTrip(trip, detail.ngan.loai_nl)
                return (
                  <div key={trip.ref || trip.uid} className="rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50/50 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs sm:text-sm font-bold text-slate-800">
                          {trip.so_xe || "—"} · C{trip.chuyen || 1}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {formatStorageDate(trip._date)} · {trip.tai_xe || "Chưa có tài xế"}
                        </div>
                      </div>
                      <div className="text-right text-xs font-semibold text-slate-700">
                        <div>{kl.tuoi.toLocaleString("vi-VN")} kg tươi</div>
                        <div className="text-emerald-700 font-bold">{kl.kho.toLocaleString("vi-VN")} kg khô</div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* Lô thành phẩm đã dùng nguyên liệu (Chiều 1: Có icon mắt 👁️ xem chi tiết lô) */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">Lô thành phẩm đã sử dụng</h2>
              <p className="text-xs text-slate-400">
                {summary
                  ? summary.doDangCount > 0
                    ? `${summary.totalLots} lô (${summary.tronLoCount} tròn, ${summary.doDangCount} dở dang)`
                    : `${summary.totalLots} lô tròn`
                  : "0 lô"}
              </p>
            </div>
            <div className="rounded-xl bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
              {(summary?.thanhPhamKg || 0).toLocaleString("vi-VN")} kg
            </div>
          </div>
          <div className="mt-3.5 space-y-3.5 max-h-[460px] overflow-y-auto pr-1">
            {groupedLots.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-400">
                Chưa có lô thành phẩm nào sử dụng nguyên liệu từ ngăn này.
              </div>
            ) : (
              groupedLots.map((group) => (
                <div key={group.key} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="bg-slate-50 px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="text-xs sm:text-sm font-bold text-slate-800">{group.label}</div>
                      <div className="text-[11px] text-slate-400">
                        {group.items.length} lô thành phẩm
                      </div>
                    </div>
                    <div className="text-xs font-extrabold text-blue-700 font-mono">
                      {group.totalKg.toLocaleString("vi-VN")} kg
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100 bg-white">
                    {group.items.map((lot) => (
                      <div
                        key={lot.id}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* Nút bấm / icon mắt xem chi tiết lô thành phẩm (Chiều 1) */}
                          <button
                            type="button"
                            onClick={() => setSelectedLotForModal(lot)}
                            title="Xem chi tiết lô thành phẩm"
                            aria-label={`Xem chi tiết lô ${lot.ma_lo}`}
                            className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 grid place-items-center shrink-0 transition-colors"
                          >
                            <Eye size={14} />
                          </button>
                          <div className="min-w-0">
                            <div className="text-xs sm:text-sm font-bold text-slate-800 font-mono truncate">
                              {lot.ma_lo}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {formatStorageDate(lot.ngay_sx)} · Ca {lot.ca || "—"} · {lot.tong_banh || 0} bành · {lot.trang_thai}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs sm:text-sm font-bold font-mono text-slate-700">
                            {(lot.tong_kg || 0).toLocaleString("vi-VN")} kg
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedLotForModal(lot)}
                            className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline mt-0.5 inline-flex items-center gap-0.5"
                          >
                            <span>Xem chi tiết</span>
                            <Eye size={11} />
                          </button>
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

      {/* Modal xem chi tiết Lô thành phẩm (Chiều 1: Từ Ngăn sang Lô thành phẩm) */}
      {selectedLotForModal && (
        <StorageLotDetailModal
          lot={selectedLotForModal}
          onClose={() => setSelectedLotForModal(null)}
        />
      )}
    </div>
  )
}
