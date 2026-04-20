"use client"
import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { Layers, Filter, X, ChevronDown, ChevronUp, MapPin, TreePine, Calendar, Ruler, Search } from "lucide-react"
import type { Feature, FeatureCollection, Geometry } from "geojson"

// ─── Types ────────────────────────────────────────────────────────────────────
interface LotProperties {
  ID: string
  Ma_lo_2026: string
  Ten: string
  Nong_truong: string
  Doi_2026: string
  Doi_nho: string
  Giong: string
  Dtich2026_ha: string
  Nam_trong: string
  Nam_mo_cao: string
  Tuoi_cao: string
  Tong_so_cay_KK: string
  Mat_cao_2026: string
  CD_cao_2026: string
  ToadoX: string
  ToadoY: string
  Khoang_cach_m: string
  Hang_dat: string
  Ma_lo: string
  Cao_trinh_min_m: string
  Cao_trinh_max_m: string
  [key: string]: string
}

// ─── Color palette for teams ──────────────────────────────────────────────────
const TEAM_COLORS: Record<string, string> = {
  "0": "#6b7280",  // gray
  "1": "#ef4444",  // red
  "2": "#f97316",  // orange
  "3": "#eab308",  // yellow
  "4": "#22c55e",  // green
  "5": "#14b8a6",  // teal
  "6": "#3b82f6",  // blue
  "7": "#8b5cf6",  // violet
  "8": "#ec4899",  // pink
  "9": "#f43f5e",  // rose
  "10": "#06b6d4", // cyan
  "11": "#84cc16", // lime
  "12": "#a855f7", // purple
}

// ─── File list ────────────────────────────────────────────────────────────────
const FILES = [
  { key: "full", label: "Tất cả (Full)", file: "Lo cao su - 2026_Full.geojson" },
  { key: "1", label: "Đội 1", file: "Doi 1.geojson" },
  { key: "2", label: "Đội 2", file: "Doi 2.geojson" },
  { key: "3", label: "Đội 3", file: "Doi 3.geojson" },
  { key: "4", label: "Đội 4", file: "Doi 4.geojson" },
  { key: "5", label: "Đội 5", file: "Doi 5.geojson" },
  { key: "6", label: "Đội 6", file: "Doi 6.geojson" },
  { key: "7", label: "Đội 7", file: "Doi 7.geojson" },
  { key: "8", label: "Đội 8", file: "Doi 8.geojson" },
  { key: "9", label: "Đội 9", file: "Doi 9.geojson" },
  { key: "10", label: "Đội 10", file: "Doi 10.geojson" },
  { key: "11", label: "Đội 11", file: "Doi 11.geojson" },
  { key: "12", label: "Đội 12", file: "Doi 12.geojson" },
]

// ─── FitBounds component ─────────────────────────────────────────────────────
function FitBoundsToGeoJSON({ data }: { data: FeatureCollection | null }) {
  const map = useMap()
  useEffect(() => {
    if (!data || !data.features.length) return
    const geoLayer = L.geoJSON(data)
    const bounds = geoLayer.getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 })
    }
  }, [data, map])
  return null
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function MapClient() {
  const [geoData, setGeoData] = useState<FeatureCollection | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState("full")

  // Filters
  const [filterTeam, setFilterTeam] = useState("")
  const [filterVariety, setFilterVariety] = useState("")
  const [filterYear, setFilterYear] = useState("")
  const [searchLot, setSearchLot] = useState("")
  const [showFilters, setShowFilters] = useState(true)

  // Selected lot details
  const [selectedLot, setSelectedLot] = useState<LotProperties | null>(null)

  // GeoJSON key for forcing re-render
  const geoJsonKey = useRef(0)

  // ── Load GeoJSON ────────────────────────────────────────────────────────
  useEffect(() => {
    const loadGeoJSON = async () => {
      setLoading(true)
      const fileInfo = FILES.find(f => f.key === selectedFile)
      if (!fileInfo) return
      try {
        const res = await fetch(`/geojson/${fileInfo.file}`)
        const data = await res.json()
        setGeoData(data)
        geoJsonKey.current++
      } catch (e) {
        console.error("Failed to load GeoJSON:", e)
      }
      setLoading(false)
    }
    loadGeoJSON()
  }, [selectedFile])

  // ── Extract unique values for filters ──────────────────────────────────────
  const { teams, varieties, years } = useMemo(() => {
    if (!geoData) return { teams: [] as string[], varieties: [] as string[], years: [] as string[] }
    const tSet = new Set<string>()
    const vSet = new Set<string>()
    const ySet = new Set<string>()
    geoData.features.forEach(f => {
      const p = f.properties as LotProperties
      if (p.Doi_2026) tSet.add(p.Doi_2026)
      if (p.Giong) vSet.add(p.Giong)
      if (p.Nam_trong) ySet.add(p.Nam_trong)
    })
    return {
      teams: Array.from(tSet).sort((a, b) => parseInt(a) - parseInt(b)),
      varieties: Array.from(vSet).sort(),
      years: Array.from(ySet).sort(),
    }
  }, [geoData])

  // ── Filtered data ──────────────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    if (!geoData) return null
    const filtered: FeatureCollection = {
      type: "FeatureCollection",
      features: geoData.features.filter(f => {
        const p = f.properties as LotProperties
        if (filterTeam && p.Doi_2026 !== filterTeam) return false
        if (filterVariety && p.Giong !== filterVariety) return false
        if (filterYear && p.Nam_trong !== filterYear) return false
        if (searchLot && !p.Ma_lo_2026?.toLowerCase().includes(searchLot.toLowerCase()) &&
            !p.Ten?.toLowerCase().includes(searchLot.toLowerCase())) return false
        return true
      }),
    }
    geoJsonKey.current++
    return filtered
  }, [geoData, filterTeam, filterVariety, filterYear, searchLot])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!filteredData) return { count: 0, totalArea: 0, totalTrees: 0 }
    let totalArea = 0
    let totalTrees = 0
    filteredData.features.forEach(f => {
      const p = f.properties as LotProperties
      totalArea += parseFloat(p.Dtich2026_ha || "0")
      totalTrees += parseInt(p.Tong_so_cay_KK || "0")
    })
    return { count: filteredData.features.length, totalArea, totalTrees }
  }, [filteredData])

  // ── Style each feature ─────────────────────────────────────────────────────
  const styleFeature = useCallback((feature: Feature<Geometry, LotProperties> | undefined) => {
    if (!feature) return {}
    const team = feature.properties?.Doi_2026 || "0"
    const color = TEAM_COLORS[team] || "#6b7280"
    return {
      fillColor: color,
      weight: 1.5,
      opacity: 0.9,
      color: "#ffffff",
      fillOpacity: 0.55,
    }
  }, [])

  // ── Bind popup/events to each feature ──────────────────────────────────────
  const onEachFeature = useCallback((feature: Feature<Geometry, LotProperties>, layer: L.Layer) => {
    const p = feature.properties
    if (!p) return

    // Tooltip on hover
    layer.bindTooltip(
      `<div style="font-size:12px;font-weight:600">${p.Ten || p.Ma_lo_2026}</div>
       <div style="font-size:11px;color:#666">Đội ${p.Doi_2026} · ${p.Giong} · ${p.Dtich2026_ha} ha</div>`,
      { sticky: true, className: "lot-tooltip" }
    )

    // Click to select
    layer.on("click", () => setSelectedLot(p))

    // Hover highlight
    layer.on("mouseover", (e) => {
      const target = e.target as L.Path
      target.setStyle({ weight: 3, fillOpacity: 0.75, color: "#fbbf24" })
    })
    layer.on("mouseout", (e) => {
      const target = e.target as L.Path
      const team = p.Doi_2026 || "0"
      target.setStyle({
        weight: 1.5,
        fillOpacity: 0.55,
        color: "#ffffff",
      })
    })
  }, [])

  // ── Clear filters ──────────────────────────────────────────────────────────
  const clearFilters = () => {
    setFilterTeam("")
    setFilterVariety("")
    setFilterYear("")
    setSearchLot("")
  }

  const hasFilters = filterTeam || filterVariety || filterYear || searchLot

  return (
    <div className="flex h-[calc(100vh-48px)] relative">
      {/* ── LEFT: Filter Panel ─────────────────────────────────────────── */}
      <div className={`${showFilters ? "w-80" : "w-0"} transition-all duration-300 overflow-hidden flex-shrink-0`}>
        <div className="w-80 h-full bg-white border-r border-slate-200 flex flex-col">
          {/* Panel header */}
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-emerald-600" />
              <span className="font-bold text-slate-700 text-sm">Bộ lọc & Thông tin</span>
            </div>
            <button onClick={() => setShowFilters(false)} className="p-1 hover:bg-slate-100 rounded-lg">
              <X size={16} className="text-slate-400" />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* File selector */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide block mb-2">Nguồn dữ liệu</label>
              <select
                value={selectedFile}
                onChange={e => setSelectedFile(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500 font-semibold"
              >
                {FILES.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide block mb-2">Tìm lô</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchLot}
                  onChange={e => setSearchLot(e.target.value)}
                  placeholder="Mã lô hoặc tên..."
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Team filter */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide block mb-2">Đội</label>
              <select
                value={filterTeam}
                onChange={e => setFilterTeam(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
              >
                <option value="">Tất cả đội</option>
                {teams.map(t => (
                  <option key={t} value={t}>Đội {t}</option>
                ))}
              </select>
            </div>

            {/* Variety filter */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide block mb-2">Giống</label>
              <select
                value={filterVariety}
                onChange={e => setFilterVariety(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
              >
                <option value="">Tất cả giống</option>
                {varieties.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            {/* Year filter */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide block mb-2">Năm trồng</label>
              <select
                value={filterYear}
                onChange={e => setFilterYear(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
              >
                <option value="">Tất cả năm</option>
                {years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* Clear filters */}
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="w-full py-2 text-sm font-semibold text-red-500 hover:bg-red-50 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <X size={14} /> Xóa bộ lọc
              </button>
            )}

            {/* Stats */}
            <div className="border-t border-slate-200 pt-4">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide block mb-3">Thống kê</label>
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-emerald-50 rounded-xl px-3.5 py-2.5">
                  <span className="text-xs text-slate-600 flex items-center gap-2"><MapPin size={13} /> Số lô</span>
                  <span className="text-sm font-black text-emerald-700">{stats.count.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between bg-blue-50 rounded-xl px-3.5 py-2.5">
                  <span className="text-xs text-slate-600 flex items-center gap-2"><Ruler size={13} /> Diện tích</span>
                  <span className="text-sm font-black text-blue-700">{stats.totalArea.toFixed(2)} ha</span>
                </div>
                <div className="flex items-center justify-between bg-amber-50 rounded-xl px-3.5 py-2.5">
                  <span className="text-xs text-slate-600 flex items-center gap-2"><TreePine size={13} /> Tổng cây</span>
                  <span className="text-sm font-black text-amber-700">{stats.totalTrees.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="border-t border-slate-200 pt-4">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide block mb-3">Chú thích màu</label>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(TEAM_COLORS).map(([team, color]) => (
                  <button
                    key={team}
                    onClick={() => setFilterTeam(filterTeam === team ? "" : team)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      filterTeam === team
                        ? "bg-slate-800 text-white"
                        : "hover:bg-slate-100 text-slate-600"
                    }`}
                  >
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                    {team === "0" ? "KXĐ" : `Đội ${team}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── CENTER: Map ────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        {/* Toggle filter button */}
        {!showFilters && (
          <button
            onClick={() => setShowFilters(true)}
            className="absolute top-3 left-3 z-[1000] bg-white shadow-lg rounded-xl p-2.5 hover:bg-slate-50 border border-slate-200 transition-all"
          >
            <Filter size={18} className="text-slate-600" />
          </button>
        )}

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 z-[1000] bg-white/80 backdrop-blur-sm flex items-center justify-center">
            <div className="text-center">
              <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-600">Đang tải bản đồ...</p>
            </div>
          </div>
        )}

        {/* Map */}
        <MapContainer
          center={[12.6, 105.5]}
          zoom={13}
          className="w-full h-full"
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {filteredData && (
            <>
              <GeoJSON
                key={geoJsonKey.current}
                data={filteredData}
                style={styleFeature as L.StyleFunction}
                onEachFeature={onEachFeature as L.GeoJSONOptions["onEachFeature"]}
              />
              <FitBoundsToGeoJSON data={filteredData} />
            </>
          )}
        </MapContainer>

        {/* Top stats bar */}
        <div className="absolute top-3 right-3 z-[1000] flex gap-2">
          <div className="bg-white/95 backdrop-blur-lg shadow-lg rounded-xl px-4 py-2 border border-slate-200 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-emerald-600" />
              <span className="text-xs font-bold text-slate-700">{stats.count} lô</span>
            </div>
            <div className="w-px h-4 bg-slate-200" />
            <div className="flex items-center gap-2">
              <Ruler size={14} className="text-blue-600" />
              <span className="text-xs font-bold text-slate-700">{stats.totalArea.toFixed(1)} ha</span>
            </div>
            <div className="w-px h-4 bg-slate-200" />
            <div className="flex items-center gap-2">
              <TreePine size={14} className="text-amber-600" />
              <span className="text-xs font-bold text-slate-700">{stats.totalTrees.toLocaleString()} cây</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: Selected Lot Detail ─────────────────────────────────── */}
      {selectedLot && (
        <div className="w-80 bg-white border-l border-slate-200 flex flex-col flex-shrink-0 animate-[slideInRight_0.3s_ease-out]">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-bold text-slate-700 text-sm">Chi tiết lô</h3>
            <button onClick={() => setSelectedLot(null)} className="p-1 hover:bg-slate-100 rounded-lg">
              <X size={16} className="text-slate-400" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {/* Lot header */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-4 h-4 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: TEAM_COLORS[selectedLot.Doi_2026] || "#6b7280" }}
                />
                <span className="text-xl font-black text-slate-800">{selectedLot.Ten}</span>
              </div>
              <p className="text-xs text-slate-500 font-mono">{selectedLot.Ma_lo_2026}</p>
            </div>

            {/* Info grid */}
            <div className="space-y-2.5">
              {[
                { label: "Đội", value: `Đội ${selectedLot.Doi_2026}`, icon: "👥" },
                { label: "Đội nhỏ", value: selectedLot.Doi_nho, icon: "📋" },
                { label: "Nông trường", value: selectedLot.Nong_truong, icon: "🏗️" },
                { label: "Giống", value: selectedLot.Giong, icon: "🌱" },
                { label: "Diện tích", value: `${selectedLot.Dtich2026_ha} ha`, icon: "📐" },
                { label: "Năm trồng", value: selectedLot.Nam_trong, icon: "📅" },
                { label: "Năm mở cạo", value: selectedLot.Nam_mo_cao, icon: "🔓" },
                { label: "Tuổi cạo", value: `${selectedLot.Tuoi_cao} năm`, icon: "⏳" },
                { label: "Tổng cây KK", value: parseInt(selectedLot.Tong_so_cay_KK || "0").toLocaleString(), icon: "🌳" },
                { label: "Mặt cạo", value: selectedLot.Mat_cao_2026, icon: "🔧" },
                { label: "Chế độ cạo", value: selectedLot.CD_cao_2026, icon: "⚙️" },
                { label: "Phương pháp", value: selectedLot.Phuong_phap, icon: "📊" },
                { label: "Hạng đất", value: selectedLot.Hang_dat, icon: "🗺️" },
                { label: "Khoảng cách", value: selectedLot.Khoang_cach_m, icon: "📏" },
                { label: "Cao trình", value: `${selectedLot.Cao_trinh_min_m}–${selectedLot.Cao_trinh_max_m} m`, icon: "⛰️" },
                { label: "Tọa độ", value: `${parseFloat(selectedLot.ToadoY).toFixed(4)}, ${parseFloat(selectedLot.ToadoX).toFixed(4)}`, icon: "📍" },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-2.5 px-3 py-2 bg-slate-50 rounded-xl">
                  <span className="text-sm flex-shrink-0 mt-0.5">{item.icon}</span>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{item.label}</div>
                    <div className="text-sm font-semibold text-slate-700 truncate">{item.value || "—"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── CSS ─────────────────────────────────────────────────────────── */}
      <style jsx global>{`
        .leaflet-container {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          background: #f1f5f9;
        }
        .lot-tooltip {
          background: white !important;
          border: 1px solid #e2e8f0 !important;
          border-radius: 10px !important;
          padding: 6px 10px !important;
          box-shadow: 0 4px 12px -2px rgba(0,0,0,0.12) !important;
        }
        .lot-tooltip::before {
          border-top-color: #e2e8f0 !important;
        }
        .leaflet-control-zoom {
          border: none !important;
          box-shadow: 0 2px 10px -2px rgba(0,0,0,0.15) !important;
          border-radius: 12px !important;
          overflow: hidden;
        }
        .leaflet-control-zoom a {
          border: none !important;
          color: #334155 !important;
          width: 34px !important;
          height: 34px !important;
          line-height: 34px !important;
          font-size: 16px !important;
        }
        .leaflet-control-zoom a:hover {
          background: #f1f5f9 !important;
        }
        @keyframes slideInRight {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
