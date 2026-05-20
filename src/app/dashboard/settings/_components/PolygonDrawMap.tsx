"use client"

import { useEffect, useRef } from "react"
import { MapContainer, TileLayer, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css"
import "@geoman-io/leaflet-geoman-free"

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
    </MapContainer>
  )
}
