"use client"

import { useEffect } from "react"
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { GeoJsonObject } from "geojson"
import type { StorageGeoJsonCollection } from "@/lib/storage-detail"

function FitBoundsToStorageGeoJson({ data }: { data: StorageGeoJsonCollection }) {
  const map = useMap()

  useEffect(() => {
    if (!data.features.length) return
    const layer = L.geoJSON(data as GeoJsonObject)
    const bounds = layer.getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 })
    }
  }, [data, map])

  return null
}

export function StorageGeoJsonMap({ data }: { data: StorageGeoJsonCollection }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200">
      <MapContainer center={[12.5819, 105.4972]} zoom={11} scrollWheelZoom className="h-[420px] w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GeoJSON
          key={JSON.stringify(data.features.map((feature) => feature.properties?.Ten ?? feature.properties?.ma_lo ?? ""))}
          data={data as GeoJsonObject}
          style={() => ({
            color: "#0f766e",
            weight: 2,
            fillColor: "#14b8a6",
            fillOpacity: 0.35,
          })}
          onEachFeature={(feature, layer) => {
            const props = feature.properties || {}
            const title = String(props.Ten || props.ma_lo || "Lô vườn")
            const team = props.Doi_2026 ? `Đội ${props.Doi_2026}` : "Chưa có đội"
            const area = props.Dtich2026_ha ? `${props.Dtich2026_ha} ha` : "Chưa có diện tích"
            layer.bindPopup(
              `<div style="font-size:12px;line-height:1.5">
                <div style="font-weight:700;margin-bottom:4px">${title}</div>
                <div>${team}</div>
                <div>${area}</div>
              </div>`,
              { maxWidth: 220 },
            )
          }}
        />
        <FitBoundsToStorageGeoJson data={data} />
      </MapContainer>
    </div>
  )
}
