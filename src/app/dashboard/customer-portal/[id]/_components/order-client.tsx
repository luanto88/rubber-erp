"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { hasPermission, hydrateActiveSession } from "@/lib/auth"
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { FeatureCollection } from "geojson"
import { saveAs } from "file-saver"
import { ArrowLeft, Download, Loader2, MapPin, Package } from "lucide-react"
import { generateDDS1, generateDDS2, type FactoryProfile, type LotDetail } from "@/app/dashboard/eudr/dds-generator"

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

async function getAuthToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || ""
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
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PortalData | null>(null)
  const [downloading, setDownloading] = useState<"dds1" | "dds2" | "geojson" | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    const bootstrap = async () => {
      const { user } = await hydrateActiveSession().catch(() => ({ user: null }))
      if (!hasPermission(user, "export.view_own")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      if (!orderId) {
        setLoading(false)
        return
      }
      try {
        const token = await getAuthToken()
        const res = await fetch(`/api/customer-portal/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = (await res.json().catch(() => null)) as (PortalData & { error?: string }) | null
        if (!res.ok) throw new Error(json?.error || "Không tải được chi tiết đơn hàng.")
        setData(json)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không tải được chi tiết đơn hàng.")
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

  const handleDownloadDDS1 = async () => {
    if (!data?.factory) {
      showToast("Thiếu thông tin nhà máy để tạo DDS.", false)
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
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không tạo được file DDS.", false)
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadDDS2 = async () => {
    if (!data?.factory) {
      showToast("Thiếu thông tin nhà máy để tạo DDS.", false)
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
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không tạo được file DDS.", false)
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

  if (loading) {
    return <div className="p-12 text-center text-slate-400">Đang tải...</div>
  }

  if (error || !data) {
    return (
      <div className="p-12 text-center text-red-500 bg-white rounded-xl border border-slate-200 shadow-sm">
        {error || "Không tìm thấy đơn hàng."}
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

      <Link
        href="/dashboard/customer-portal"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-700 mb-4"
      >
        <ArrowLeft size={14} /> Quay lại danh sách
      </Link>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-slate-800">{order.ma_don}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Ngày: {formatDate(order.ngay)} · Chủng loại: {order.chung_loai || "-"} · Tổng bánh:{" "}
              {order.tong_banh?.toLocaleString("vi-VN") ?? "-"}
            </p>
            {order.customers && (
              <p className="text-xs text-slate-400 mt-1">
                Khách hàng: {order.customers.ten_kh_en} — {order.customers.quoc_gia}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDownloadDDS1}
              disabled={downloading === "dds1"}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "dds1" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              DDS Lô vườn (PDF)
            </button>
            <button
              onClick={handleDownloadDDS2}
              disabled={downloading === "dds2"}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "dds2" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              DDS Lô hàng (PDF)
            </button>
            <button
              onClick={handleDownloadGeoJson}
              disabled={downloading === "geojson"}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "geojson" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              GeoJSON
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: "Số lô", value: data.traceInfo.lots },
            { label: "Số ngăn lưu", value: data.traceInfo.ngans },
            { label: "Điểm giao nhận", value: data.traceInfo.diemGn },
            { label: "Polygon lô vườn", value: data.traceInfo.features },
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
          <MapPin size={16} /> Bản đồ lô vườn
        </div>
        <div className="h-[420px] rounded-xl overflow-hidden border border-slate-200">
          {data.geoData.features.length > 0 ? (
            <MapContainer center={[12.58187, 105.497249]} zoom={12} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
              <GeoJSON data={data.geoData} style={geoStyle} />
              <FitBounds data={data.geoData} />
              <MapResizeFix />
            </MapContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              Không có dữ liệu polygon lô vườn cho đơn hàng này.
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-4 text-slate-700 font-bold text-sm border-b border-slate-100">
          <Package size={16} /> Danh sách lô thành phẩm
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2">Mã lô</th>
                <th className="text-left px-4 py-2">Ngày sản xuất</th>
                <th className="text-left px-4 py-2">Ngày trích xuất</th>
                <th className="text-left px-4 py-2">Chứng nhận</th>
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
