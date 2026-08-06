"use client"

// Bản đồ lô vườn + khung chi tiết click-to-info, dùng chung cho cả Customer Portal
// (`/dashboard/customer-portal/[id]`) và trang công khai theo token (`/eudr-order`) — tách
// ra khỏi order-client.tsx để không phải chép lại 2 lần cùng 1 khối logic khá lớn. Mirror
// đúng hành vi bản đồ nội bộ ở EudrClient.tsx (không đụng file đó), chỉ khác là mọi nhãn
// hiển thị được dịch song ngữ theo `lang`.

import { useCallback, useEffect, useState } from "react"
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { Feature, FeatureCollection } from "geojson"
import {
  Building2,
  CalendarDays,
  FileText,
  Layers3,
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
import { toDisplayNumber, toDisplayText, type EudrPlotProperties } from "@/lib/eudr-plot-merge"
import { tCustomerPortal, type CustomerPortalLang } from "@/lib/customer-portal-i18n"

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

export function EudrPlotMap({ geoData, lang }: { geoData: FeatureCollection; lang: CustomerPortalLang }) {
  const [selectedPlot, setSelectedPlot] = useState<EudrPlotProperties | null>(null)
  const t = (key: Parameters<typeof tCustomerPortal>[1]) => tCustomerPortal(lang, key)

  const geoStyle = (feature?: GeoJSON.Feature) => {
    const doi = String(feature?.properties?.Doi_2026 ?? "0")
    const color = TEAM_COLORS[doi] || "#6b7280"
    return { color, weight: 2, fillColor: color, fillOpacity: 0.35 }
  }

  // Tooltip khi hover + popup Leaflet nhỏ khi click + mở khung chi tiết đầy đủ
  // (selectedPlot) — mirror đúng onEachFeature của EudrClient.tsx (trang nội bộ), chỉ khác
  // là nhãn được dịch song ngữ theo `lang` hiện tại. Phụ thuộc `lang` vì nội dung HTML
  // tooltip/popup được build 1 lần lúc bind — đổi ngôn ngữ phải rebind lại (xem `key`
  // truyền vào <GeoJSON> bên dưới để buộc remount).
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

  return (
    // relative isolate: chỗ neo cho khung chi tiết lô (absolute) + chặn z-index nội bộ của
    // Leaflet tràn ra ngoài khung bản đồ — mirror EudrClient.tsx
    <div className="h-[420px] rounded-xl overflow-hidden border border-slate-200 relative isolate">
      {geoData.features.length > 0 ? (
        <MapContainer center={[12.58187, 105.497249]} zoom={12} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />
          <GeoJSON
            key={`${lang}-${geoData.features.map((f) => f.properties?.Ma_lo).join(",")}`}
            data={geoData}
            style={geoStyle}
            onEachFeature={onEachFeature}
          />
          <FitBounds data={geoData} />
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
  )
}
