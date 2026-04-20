"use client"
import dynamic from "next/dynamic"

const MapClient = dynamic(() => import("./MapClient"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[calc(100vh-48px)] bg-slate-50">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm font-semibold text-slate-600">Đang khởi tạo bản đồ...</p>
        <p className="text-xs text-slate-400 mt-1">Leaflet + GeoJSON</p>
      </div>
    </div>
  ),
})

export default function MapPage() {
  return <MapClient />
}
