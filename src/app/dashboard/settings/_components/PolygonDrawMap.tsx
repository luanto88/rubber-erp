"use client"

import { useEffect, useRef, useState } from "react"
import { MapContainer, TileLayer, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css"
import "@geoman-io/leaflet-geoman-free"
import { Search, X, Loader2 } from "lucide-react"

interface Props {
  existingGeometry?: unknown
  onChange: (geometry: unknown | null) => void
}

// Khởi tạo geoman và lắng nghe sự kiện vẽ/chỉnh polygon
function GeomanControls({ existingGeometry, onChange }: Props) {
  const map = useMap()
  const drawnLayerRef = useRef<L.Layer | null>(null)

  useEffect(() => {
    // Thêm công cụ vẽ
    map.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawCircle: false,
      drawText: false,
      drawPolygon: true,
      editMode: true,
      dragMode: false,
      cutPolygon: false,
      removalMode: true,
      rotateMode: false,
    })

    // Nếu đã có geometry (chế độ edit), render lên map
    if (existingGeometry) {
      try {
        const geoLayer = L.geoJSON(existingGeometry as Parameters<typeof L.geoJSON>[0], {
          style: { color: "#059669", weight: 2, fillOpacity: 0.2 },
        }).addTo(map)
        drawnLayerRef.current = geoLayer
        map.fitBounds(geoLayer.getBounds(), { padding: [30, 30] })
      } catch {
        // geometry không hợp lệ — bỏ qua
      }
    }

    // Vẽ xong polygon mới
    const onCreate = (e: L.LeafletEvent) => {
      const ev = e as L.LeafletEvent & { layer: L.Layer }
      // Xóa layer cũ nếu có
      if (drawnLayerRef.current) {
        map.removeLayer(drawnLayerRef.current)
      }
      drawnLayerRef.current = ev.layer
      const geojson = (ev.layer as L.Polygon).toGeoJSON()
      onChange(geojson.geometry)
    }

    // Chỉnh polygon đã vẽ
    const onEdit = () => {
      if (!drawnLayerRef.current) return
      const geojson = (drawnLayerRef.current as L.Polygon).toGeoJSON()
      onChange(geojson.geometry)
    }

    // Xóa polygon
    const onRemove = () => {
      drawnLayerRef.current = null
      onChange(null)
    }

    map.on("pm:create", onCreate)
    map.on("pm:edit", onEdit)
    map.on("pm:remove", onRemove)

    return () => {
      map.off("pm:create", onCreate)
      map.off("pm:edit", onEdit)
      map.off("pm:remove", onRemove)
      map.pm.removeControls()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  return null
}

type GeocodeResult = {
  display_name: string
  lat: string
  lon: string
  boundingbox?: [string, string, string, string]
}

/**
 * Ô tìm kiếm địa điểm để bay nhanh tới bất kỳ vùng nào trên bản đồ trước khi vẽ
 * polygon — cần thiết vì nguồn nguyên liệu trải khắp Campuchia và Việt Nam, không
 * chỉ quanh Kampong Thom (tâm mặc định của bản đồ).
 *
 * Dùng Nominatim (OpenStreetMap) — API tìm kiếm công khai, không cần API key.
 * Chỉ gọi khi người dùng ngừng gõ (debounce) hoặc bấm Enter, không gọi mỗi phím.
 */
function LocationSearchControl() {
  const map = useMap()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  // Ngăn thao tác trên ô tìm kiếm (kéo/cuộn/click) làm map bị pan/zoom theo
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    L.DomEvent.disableClickPropagation(el)
    L.DomEvent.disableScrollPropagation(el)
  }, [])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
      if (markerRef.current) map.removeLayer(markerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSearch = (q: string) => {
    abortRef.current?.abort()
    if (!q.trim() || q.trim().length < 2) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    // Ưu tiên kết quả ở Campuchia (kh) và Việt Nam (vn) — 2 nơi công ty thu mua mủ
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=6&accept-language=vi&countrycodes=kh,vn&q=${encodeURIComponent(q)}`
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("request_failed")
        return res.json() as Promise<GeocodeResult[]>
      })
      .then((data) => {
        setResults(Array.isArray(data) ? data : [])
        setOpen(true)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setError("Không tìm được địa điểm, thử lại sau.")
        setResults([])
        setOpen(true)
      })
      .finally(() => setLoading(false))
  }

  const handleChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(value), 500)
  }

  const handleSelect = (r: GeocodeResult) => {
    const lat = parseFloat(r.lat)
    const lon = parseFloat(r.lon)
    if (Number.isNaN(lat) || Number.isNaN(lon)) return

    if (markerRef.current) map.removeLayer(markerRef.current)
    markerRef.current = L.marker([lat, lon]).addTo(map).bindPopup(r.display_name)

    if (r.boundingbox) {
      const [south, north, west, east] = r.boundingbox.map(Number)
      if ([south, north, west, east].every((n) => !Number.isNaN(n))) {
        map.flyToBounds(
          [
            [south, west],
            [north, east],
          ],
          { maxZoom: 15, duration: 0.8 }
        )
      } else {
        map.flyTo([lat, lon], 14, { duration: 0.8 })
      }
    } else {
      map.flyTo([lat, lon], 14, { duration: 0.8 })
    }
    setQuery(r.display_name)
    setOpen(false)
  }

  return (
    <div
      ref={boxRef}
      className="absolute top-2 right-2 z-[1000] w-[calc(100%-5rem)] max-w-xs sm:max-w-sm"
    >
      <div className="relative">
        <div className="flex items-center gap-1.5 bg-white rounded-lg shadow-md border border-slate-300 px-2 py-1.5">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => (results.length > 0 || error) && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (debounceRef.current) clearTimeout(debounceRef.current)
                runSearch(query)
              }
            }}
            placeholder="Tìm địa điểm (tỉnh, huyện, xã...)"
            className="flex-1 min-w-0 text-xs outline-none placeholder:text-slate-400 bg-transparent"
          />
          {loading && <Loader2 size={13} className="animate-spin text-slate-400 shrink-0" />}
          {!loading && query && (
            <button
              type="button"
              onClick={() => {
                setQuery("")
                setResults([])
                setOpen(false)
                setError(null)
              }}
              className="text-slate-400 hover:text-slate-600 shrink-0"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {open && (results.length > 0 || error) && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-slate-200 max-h-56 overflow-y-auto">
            {error ? (
              <div className="px-3 py-2 text-xs text-red-500">{error}</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">Không tìm thấy địa điểm nào</div>
            ) : (
              results.map((r, i) => (
                <button
                  key={`${r.lat}-${r.lon}-${i}`}
                  type="button"
                  onClick={() => handleSelect(r)}
                  className="block w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-emerald-50 border-b border-slate-100 last:border-0"
                >
                  {r.display_name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function PolygonDrawMap({ existingGeometry, onChange }: Props) {
  // Trung tâm vùng NMPHK — Kampong Thom, Cambodia
  const defaultCenter: L.LatLngExpression = [12.5, 105.5]
  const defaultZoom = 11

  return (
    <MapContainer
      center={defaultCenter}
      zoom={defaultZoom}
      style={{ height: "320px", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <GeomanControls existingGeometry={existingGeometry} onChange={onChange} />
      <LocationSearchControl />
    </MapContainer>
  )
}
