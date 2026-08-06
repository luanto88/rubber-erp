"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { authBlockReason, hasPermission, hydrateActiveSession, signOutEverywhere } from "@/lib/auth"
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { Feature, FeatureCollection } from "geojson"
import { saveAs } from "file-saver"
import JSZip from "jszip"
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Download,
  FileDown,
  FileText,
  Layers3,
  Loader2,
  Map,
  MapPin,
  Mountain,
  Package,
  Route,
  Ruler,
  Sprout,
  Trees,
  Users,
  X,
} from "lucide-react"
import { generateDDS1, generateDDS2, type FactoryProfile, type LotDetail } from "@/app/dashboard/eudr/dds-generator"
import { toDisplayNumber, toDisplayText, type EudrPlotProperties } from "@/lib/eudr-plot-merge"
import {
  broadcastCustomerPortalLangChange,
  getStoredCustomerPortalLang,
  onCustomerPortalLangChange,
  tCustomerPortal,
  type CustomerPortalLang,
} from "@/lib/customer-portal-i18n"
import { CustomerPortalLangToggle } from "@/app/dashboard/customer-portal/_components/lang-toggle"

type PortalOrderDetail = {
  id: string
  ma_don: string
  ngay: string
  chung_loai: string
  tong_banh: number
  loai_banh: number
  loai_pallet: string
  loai_boc: string
  so_thong_bao: string
  so_hoa_don: string
  so_hop_dong: string
  assignments: { lot_id: string; ma_lo: string; kien_a: number; kien_b: number; kien_c: number; kien_d: number }[]
  files?: { name: string; url: string; path?: string; size?: number }[] | null
  customers?: { ma_kh: string; ten_kh_en: string; quoc_gia: string; dia_chi: string; email: string; nguoi_lien_he: string } | null
}

type PortalData = {
  order: PortalOrderDetail
  factory: FactoryProfile | null
  lotDetails: LotDetail[]
  extractionDates: Record<string, string>
  lotCertMap: Record<string, string>
  diemGn: string[]
  geoData: FeatureCollection
  traceInfo: { lots: number; ngans: number; tripUids: number; matchedRows: number; diemGn: number; features: number; fallback?: boolean }
}

type DownloadKind = "dds1" | "dds2" | "geojson" | "all"

const TEAM_COLORS: Record<string, string> = {
  "1": "#ef4444", "2": "#f97316", "3": "#eab308", "4": "#22c55e", "5": "#14b8a6",
  "6": "#3b82f6", "7": "#8b5cf6", "8": "#ec4899", "9": "#f43f5e", "10": "#06b6d4",
  "11": "#84cc16", "12": "#a855f7", "0": "#6b7280",
}

function FitBounds({ data }: { data: FeatureCollection | null }) {
  const map = useMap()
  useEffect(() => {
    if (!data?.features.length) return
    const layer = L.geoJSON(data)
    const bounds = layer.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 })
  }, [data, map])
  return null
}

function MapResizeFix() {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 200)
    const container = map.getContainer()
    const resizeObserver = new ResizeObserver(() => map.invalidateSize())
    resizeObserver.observe(container)
    return () => {
      clearTimeout(timer)
      resizeObserver.disconnect()
    }
  }, [map])
  return null
}

function formatDate(value: string) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
}

export default function CustomerPortalOrderClient() {
  const params = useParams<{ id: string }>()
  const orderId = params?.id
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [data, setData] = useState<PortalData | null>(null)
  const [downloading, setDownloading] = useState<DownloadKind | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [selectedPlot, setSelectedPlot] = useState<EudrPlotProperties | null>(null)
  const [lang, setLang] = useState<CustomerPortalLang>("en")
  const t = (key: Parameters<typeof tCustomerPortal>[1]) => tCustomerPortal(lang, key)

  useEffect(() => {
    setLang(getStoredCustomerPortalLang())
    return onCustomerPortalLangChange(setLang)
  }, [])

  const changeLang = (next: CustomerPortalLang) => {
    setLang(next)
    broadcastCustomerPortalLangChange(next)
  }

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    const bootstrap = async () => {
      const { session, user } = await hydrateActiveSession().catch(() => ({ session: null, user: null }))
      const blocked = authBlockReason(user)
      if (!session?.user || blocked) {
        setLoading(false)
        await signOutEverywhere()
        window.location.replace(`/login${blocked ? `?reason=${blocked}` : ""}`)
        return
      }
      if (!hasPermission(user, "export.view_own")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      if (!orderId) {
        setLoading(false)
        setLoadFailed(true)
        return
      }
      try {
        const res = await fetch(`/api/customer-portal/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const json = (await res.json().catch(() => null)) as (PortalData & { error?: string }) | null
        if (!res.ok || !json) throw new Error("load_failed")
        setData(json)
      } catch {
        setLoadFailed(true)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [orderId])

  const geoStyle = (feature?: GeoJSON.Feature) => {
    const doi = String(feature?.properties?.Doi_2026 ?? "0")
    const color = TEAM_COLORS[doi] || "#6b7280"
    return { color, weight: 2, fillColor: color, fillOpacity: 0.35 }
  }

  // Tooltip khi hover + popup Leaflet nhỏ khi click + mở khung chi tiết đầy đủ
  // (selectedPlot) — mirror đúng onEachFeature của EudrClient.tsx (trang nội bộ),
  // chỉ khác là nhãn được dịch song ngữ theo `lang` hiện tại. Phụ thuộc `lang` vì
  // nội dung HTML tooltip/popup được build 1 lần lúc bind — đổi ngôn ngữ phải rebind
  // lại (xem `key` truyền vào <GeoJSON> bên dưới để buộc remount).
  const onEachFeature = useCallback(
    (feature: Feature, layer: L.Layer) => {
      const p = (feature.properties || {}) as EudrPlotProperties
      const plotName = toDisplayText(p.Ten || p.Ma_lo_2026 || p.Ma_lo, "?")
      const areaText = toDisplayNumber(p.Dtich2026_ha, 2)
      const teamText = toDisplayText(p.Doi_2026)
      const varietyText = toDisplayText(p.Giong)
      const plantationText = toDisplayText(p.Nong_truong)
      layer.bindTooltip(
        `<div style="font-size:12px;font-weight:600">${plotName}</div>
         <div style="font-size:11px;color:#666">${t("plotFieldTeam")} ${teamText} · ${varietyText} · ${areaText} ha</div>`,
        { sticky: true, className: "lot-tooltip" },
      )
      layer.bindPopup(
        `<div class="text-xs leading-5">
          <div class="font-bold text-slate-800 mb-1">${plotName}</div>
          <div>${t("plotFieldPlantation")}: <strong>${plantationText}</strong></div>
          <div>${t("plotFieldTeam")}: <strong>${teamText}</strong></div>
          <div>${t("plotFieldArea")}: <strong>${areaText} ha</strong></div>
          <div>${t("plotFieldVariety")}: <strong>${varietyText}</strong></div>
          <div>${t("plotFieldPlantingYear")}: <strong>${toDisplayText(p.Nam_trong)}</strong></div>
          <div>${t("plotFieldTappingOpenYear")}: <strong>${toDisplayText(p.Nam_mo_cao)}</strong></div>
        </div>`,
        { maxWidth: 240 },
      )
      layer.on("click", () => setSelectedPlot(p))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang],
  )

  const handleDownloadDDS1 = async () => {
    if (!data?.factory) {
      showToast(t("errorMissingFactory"), false)
      return
    }
    setDownloading("dds1")
    try {
      const blob = await generateDDS1(
        { ...data.order, customers: data.order.customers ?? undefined },
        data.geoData,
        data.factory,
        data.lotCertMap,
      )
      saveAs(blob, `${data.order.ma_don}_Plantation.pdf`)
    } catch {
      showToast(t("errorGenerateDds"), false)
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadDDS2 = async () => {
    if (!data?.factory) {
      showToast(t("errorMissingFactory"), false)
      return
    }
    setDownloading("dds2")
    try {
      const blob = await generateDDS2(
        { ...data.order, customers: data.order.customers ?? undefined },
        data.lotDetails,
        data.extractionDates,
        data.factory,
      )
      saveAs(blob, `${data.order.ma_don}_Shipment.pdf`)
    } catch {
      showToast(t("errorGenerateDds"), false)
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadGeoJson = () => {
    if (!data) return
    setDownloading("geojson")
    try {
      const blob = new Blob([JSON.stringify(data.geoData, null, 2)], { type: "application/geo+json" })
      saveAs(blob, `${data.order.ma_don}_supply_chain.geojson`)
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadAll = async () => {
    if (!data?.factory) {
      showToast(t("errorMissingFactory"), false)
      return
    }
    setDownloading("all")
    try {
      const orderForDds = { ...data.order, customers: data.order.customers ?? undefined }
      const [dds1Blob, dds2Blob] = await Promise.all([
        generateDDS1(orderForDds, data.geoData, data.factory, data.lotCertMap),
        generateDDS2(orderForDds, data.lotDetails, data.extractionDates, data.factory),
      ])
      const zip = new JSZip()
      zip.file(`${data.order.ma_don}_Plantation.pdf`, dds1Blob)
      zip.file(`${data.order.ma_don}_Shipment.pdf`, dds2Blob)
      zip.file(`${data.order.ma_don}_supply_chain.geojson`, JSON.stringify(data.geoData, null, 2))

      // Gộp thêm các tệp đính kèm ngoài 2 DDS (nhân viên đính vào qua trang EUDR nội bộ) —
      // bucket "eudr-files" đã public nên fetch thẳng URL là đủ, không cần service role.
      // 1 file lỗi không được làm hỏng cả lượt tải — bỏ qua file đó, vẫn zip các file còn lại.
      for (const f of data.order.files || []) {
        try {
          const res = await fetch(f.url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          zip.file(f.name, blob)
        } catch {
          // bỏ qua file đính kèm lỗi, tiếp tục với các file khác
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" })
      saveAs(zipBlob, `${data.order.ma_don}_EUDR.zip`)
    } catch {
      showToast(t("errorGenerateDds"), false)
    } finally {
      setDownloading(null)
    }
  }

  if (loading) {
    return <div className="p-12 text-center text-slate-400">{t("loading")}</div>
  }

  if (loadFailed || !data) {
    return (
      <div className="p-12 text-center text-red-500 bg-white rounded-xl border border-slate-200 shadow-sm">
        {t("orderNotFound")}
      </div>
    )
  }

  const { order } = data

  return (
    <div>
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold text-white ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}
        >
          {toast.msg}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Link
          href="/dashboard/customer-portal"
          className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} /> {t("backToList")}
        </Link>
        <CustomerPortalLangToggle lang={lang} onChange={changeLang} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-slate-800">{order.ma_don}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {t("dateLabel")}: {formatDate(order.ngay)} · {t("productTypeLabel")}: {order.chung_loai || "-"} ·{" "}
              {t("totalBalesLabel")}: {order.tong_banh?.toLocaleString("vi-VN") ?? "-"}
            </p>
            {order.customers && (
              <p className="text-xs text-slate-400 mt-1">
                {t("customerLabel")}: {order.customers.ten_kh_en} — {order.customers.quoc_gia}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDownloadAll}
              disabled={downloading === "all"}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "all" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t("downloadAll")}
            </button>
            <button
              onClick={handleDownloadDDS1}
              disabled={downloading === "dds1"}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "dds1" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t("ddsPlantation")}
            </button>
            <button
              onClick={handleDownloadDDS2}
              disabled={downloading === "dds2"}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "dds2" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t("ddsShipment")}
            </button>
            <button
              onClick={handleDownloadGeoJson}
              disabled={downloading === "geojson"}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "geojson" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t("geoJson")}
            </button>
          </div>
        </div>

        {order.files && order.files.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-xs font-bold text-slate-500 mb-2">{t("attachmentsTitle")}</div>
            <div className="space-y-1.5">
              {order.files.map((f) => (
                <div
                  key={f.url}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200"
                >
                  <FileText size={13} className="text-slate-400 shrink-0" />
                  <span className="flex-1 text-xs text-slate-700 truncate" title={f.name}>
                    {f.name}
                  </span>
                  <a
                    href={f.url}
                    download
                    className="p-1 hover:bg-slate-200 rounded text-slate-500"
                    title={t("downloadOne")}
                  >
                    <FileDown size={13} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: t("kpiLots"), value: data.traceInfo.lots },
            { label: t("kpiStorage"), value: data.traceInfo.ngans },
            { label: t("kpiDeliveryPoints"), value: data.traceInfo.diemGn },
            { label: t("kpiPolygons"), value: data.traceInfo.features },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-slate-50 rounded-xl p-3 text-center">
              <div className="text-lg font-black text-slate-800">{kpi.value}</div>
              <div className="text-[11px] text-slate-500">{kpi.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex items-center gap-2 mb-3 text-slate-700 font-bold text-sm">
          <MapPin size={16} /> {t("plantationMap")}
        </div>
        {/* relative isolate: chỗ neo cho khung chi tiết lô (absolute) + chặn z-index nội bộ
            của Leaflet tràn ra ngoài khung bản đồ — mirror EudrClient.tsx */}
        <div className="h-[420px] rounded-xl overflow-hidden border border-slate-200 relative isolate">
          {data.geoData.features.length > 0 ? (
            <MapContainer center={[12.58187, 105.497249]} zoom={12} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
              <GeoJSON
                key={`${lang}-${data.geoData.features.map((f) => f.properties?.Ma_lo).join(",")}`}
                data={data.geoData}
                style={geoStyle}
                onEachFeature={onEachFeature}
              />
              <FitBounds data={data.geoData} />
              <MapResizeFix />
            </MapContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              {t("noPolygonData")}
            </div>
          )}
          {selectedPlot && (
            <div className="absolute top-4 right-4 z-[400] w-80 max-w-[calc(100%-2rem)] bg-white/95 backdrop-blur rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <div className="text-lg font-black text-slate-800">
                    {toDisplayText(selectedPlot.Ten || selectedPlot.Ma_lo_2026 || selectedPlot.Ma_lo)}
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    {toDisplayText(selectedPlot.ma_lo_full || selectedPlot.Ma_lo_2026 || selectedPlot.Ma_lo)}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedPlot(null)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-3 space-y-2 text-sm max-h-[70vh] overflow-y-auto">
                {[
                  { label: t("plotFieldTeam"), value: `${t("plotFieldTeam")} ${toDisplayText(selectedPlot.Doi_2026)}`, icon: Users },
                  { label: t("plotFieldSubTeam"), value: toDisplayText(selectedPlot.Doi_nho), icon: Layers3 },
                  { label: t("plotFieldPlantation"), value: toDisplayText(selectedPlot.Nong_truong), icon: Building2 },
                  { label: t("plotFieldVariety"), value: toDisplayText(selectedPlot.Giong), icon: Sprout },
                  { label: t("plotFieldArea"), value: `${toDisplayNumber(selectedPlot.Dtich2026_ha, 2)} ha`, icon: Ruler },
                  { label: t("plotFieldPlantingYear"), value: toDisplayText(selectedPlot.Nam_trong), icon: CalendarDays },
                  { label: t("plotFieldTappingOpenYear"), value: toDisplayText(selectedPlot.Nam_mo_cao), icon: CalendarDays },
                  {
                    label: t("plotFieldTappingAge"),
                    value: selectedPlot.Tuoi_cao ? `${toDisplayText(selectedPlot.Tuoi_cao)} ${t("unitYears")}` : "—",
                    icon: Route,
                  },
                  { label: t("plotFieldTreeCount"), value: toDisplayNumber(selectedPlot.Tong_so_cay_KK), icon: Trees },
                  { label: t("plotFieldTappingPanel"), value: toDisplayText(selectedPlot.Mat_cao_2026), icon: FileText },
                  { label: t("plotFieldTappingRegime"), value: toDisplayText(selectedPlot.CD_cao_2026), icon: Package },
                  { label: t("plotFieldSoilGrade"), value: toDisplayText(selectedPlot.Hang_dat), icon: Map },
                  { label: t("plotFieldSpacing"), value: toDisplayText(selectedPlot.Khoang_cach_m), icon: Ruler },
                  {
                    label: t("plotFieldElevation"),
                    value:
                      selectedPlot.Cao_trinh_min_m || selectedPlot.Cao_trinh_max_m
                        ? `${toDisplayText(selectedPlot.Cao_trinh_min_m)}-${toDisplayText(selectedPlot.Cao_trinh_max_m)} m`
                        : "—",
                    icon: Mountain,
                  },
                  {
                    label: t("plotFieldCoordinates"),
                    value:
                      selectedPlot.ToadoY || selectedPlot.ToadoX
                        ? `${toDisplayText(selectedPlot.ToadoY)}, ${toDisplayText(selectedPlot.ToadoX)}`
                        : "—",
                    icon: MapPin,
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-2 flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-white p-2 text-slate-500 shadow-sm">
                      <item.icon size={15} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.label}</div>
                      <div className="font-semibold text-slate-700">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-4 text-slate-700 font-bold text-sm border-b border-slate-100">
          <Package size={16} /> {t("lotListTitle")}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2">{t("colLotCode")}</th>
                <th className="text-left px-4 py-2">{t("colProductionDate")}</th>
                <th className="text-left px-4 py-2">{t("colExtractionDate")}</th>
                <th className="text-left px-4 py-2">{t("colCertification")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.assignments.map((assignment) => {
                const lot = data.lotDetails.find((item) => item.id === assignment.lot_id)
                return (
                  <tr key={assignment.lot_id}>
                    <td className="px-4 py-2 font-bold text-slate-700">{assignment.ma_lo}</td>
                    <td className="px-4 py-2 text-slate-600">{lot?.ngay_sx ? formatDate(lot.ngay_sx) : "-"}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {data.extractionDates[assignment.lot_id] ? formatDate(data.extractionDates[assignment.lot_id]) : "-"}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{data.lotCertMap[assignment.lot_id] || "-"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
