"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { DIEM_GN, buildLoThuHoach, normalizeDeliveryPoints } from "@/lib/dispatch-master"
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { FeatureCollection, Feature } from "geojson"
import JSZip from "jszip"
import { saveAs } from "file-saver"
import {
  Search, FileDown, Upload, Trash2, Map, Shield, Package,
  AlertTriangle, Check, X, FileText, Globe, Download, Loader2
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
import type { FactoryProfile, LotDetail } from "./dds-generator"

type ExportOrder = {
  id: string; ma_don: string; ngay: string; factory_id: string
  chung_loai: string; tong_banh: number
  loai_banh: number; loai_pallet: string; loai_boc: string
  so_thong_bao: string; so_hoa_don: string; so_hop_dong: string
  assignments: { lot_id: string; ma_lo: string; vehicleIdx: number; kien_a:number; kien_b:number; kien_c:number; kien_d:number }[]
  vehicles: { id:string; loai_xe:string; bien_truoc:string; bien_sau:string }[]
  files: { name: string; url: string; size?: number }[]
  customers?: { ma_kh:string; ten_kh_en:string; quoc_gia:string; dia_chi:string; email:string; nguoi_lien_he:string }
}

// ─── Team colors ──────────────────────────────────────────────────────────────
const TEAM_COLORS: Record<string, string> = {
  "1":"#ef4444","2":"#f97316","3":"#eab308","4":"#22c55e","5":"#14b8a6",
  "6":"#3b82f6","7":"#8b5cf6","8":"#ec4899","9":"#f43f5e","10":"#06b6d4",
  "11":"#84cc16","12":"#a855f7","0":"#6b7280",
}

// ─── FitBounds helper ─────────────────────────────────────────────────────────
function FitBounds({ data }: { data: FeatureCollection | null }) {
  const map = useMap()
  useEffect(() => {
    if (!data?.features.length) return
    const layer = L.geoJSON(data)
    const b = layer.getBounds()
    if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 15 })
  }, [data, map])
  return null
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function EudrClient() {
  const searchParams = useSearchParams()
  const initOrder = searchParams.get("order") ?? ""

  const [query, setQuery]       = useState(initOrder)
  const [order, setOrder]       = useState<ExportOrder|null>(null)
  const [searching, setSearching] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [factoryId, setFactoryId] = useState<string|null>(null)

  const [geoData, setGeoData]   = useState<FeatureCollection|null>(null)
  const [diemGnSet, setDiemGnSet] = useState<Set<string>>(new Set())
  const [loadingGeo, setLoadingGeo] = useState(false)

  const [factory, setFactory]   = useState<FactoryProfile|null>(null)
  const [lotDetails, setLotDetails] = useState<LotDetail[]>([])
  const [extractionDates, setExtractionDates] = useState<Record<string,string>>({})
  const [lotCertMap, setLotCertMap] = useState<Record<string,string>>({})

  // Trạng thái trace từng bước chuỗi cung ứng (null = chưa trace)
  const [traceInfo, setTraceInfo] = useState<{
    lots: number; ngans: number; tripUids: number; matchedRows: number; diemGn: number; features: number; fallback?: boolean
  } | null>(null)

  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [toast, setToast]        = useState<{msg:string;ok:boolean}|null>(null)
  const fileInputRef             = useRef<HTMLInputElement>(null)

  const showToast = (msg: string, ok = true) => { setToast({msg,ok}); setTimeout(()=>setToast(null),3500) }

  useEffect(() => {
    const fid = localStorage.getItem("erp_factory")
    if (fid) {
      setFactoryId(fid)
      supabase.from("factories")
        .select("id,full_name_en,address_en,contact_person,contact_email,website,country_en")
        .eq("id", fid).single()
        .then(({ data }) => { if (data) setFactory(data as FactoryProfile) })
    }
    if (initOrder) searchOrder(initOrder, fid ?? "")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Search order ──────────────────────────────────────────────────────────
  const searchOrder = useCallback(async (ma: string, fid?: string) => {
    const f = fid ?? factoryId
    if (!ma.trim()) return
    setSearching(true); setNotFound(false); setOrder(null); setGeoData(null); setTraceInfo(null)
    const { data } = await supabase.from("export_orders")
      .select("*, customers(ma_kh,ten_kh_en,quoc_gia,dia_chi,email,nguoi_lien_he)")
      .eq("ma_don", ma.trim())
      .eq("factory_id", f ?? "")
      .single()
    setSearching(false)
    if (!data) { setNotFound(true); return }
    setOrder(data)
    traceGeoChain(data)
  }, [factoryId])

  // ── Trace supply chain → GeoJSON ──────────────────────────────────────────
  const traceGeoChain = async (ord: ExportOrder) => {
    setLoadingGeo(true)
    try {
      const lotIds = [...new Set(ord.assignments.map(a => a.lot_id))]
      if (!lotIds.length) {
        setTraceInfo({ lots: 0, ngans: 0, tripUids: 0, matchedRows: 0, diemGn: 0, features: 0 })
        setLoadingGeo(false); return
      }

      // 1. Get lots → full details + ngan_ids
      const { data: lotsFull } = await supabase.from("lots")
        .select("id,ma_lo,ngay_sx,loai_banh,kien_a,kien_b,kien_c,kien_d,ngan_id")
        .in("id", lotIds)
      setLotDetails(lotsFull || [])
      const nganIds = [...new Set((lotsFull||[]).map((l:any)=>l.ngan_id).filter(Boolean))]
      if (!nganIds.length) {
        setTraceInfo({ lots: lotsFull?.length||0, ngans: 0, tripUids: 0, matchedRows: 0, diemGn: 0, features: 0 })
        setLoadingGeo(false); return
      }

      // 2. Get ngans → trips + chung_nhan
      const { data: ngans } = await supabase.from("ngans")
        .select("id,trips,chung_nhan,ngay_bd,ngay_kt").in("id", nganIds)

      // Build lot→certification map from ngan.chung_nhan
      const certMap: Record<string,string> = {}
      for (const lot of (lotsFull||[])) {
        const ngan = (ngans||[]).find((n:any) => n.id === lot.ngan_id)
        certMap[lot.id] = ngan?.chung_nhan ?? ""
      }
      setLotCertMap(certMap)

      const allTripUids = new Set<string>()
      ;(ngans||[]).forEach((n:any) => (n.trips||[]).forEach((uid:string) => allTripUids.add(uid)))
      if (!allTripUids.size) {
        setTraceInfo({ lots: lotsFull?.length||0, ngans: nganIds.length, tripUids: 0, matchedRows: 0, diemGn: 0, features: 0 })
        setLoadingGeo(false); return
      }

      // 3. Get dispatch_entries for this factory (include ngay for extraction dates)
      const { data: dispatches } = await supabase.from("dispatch_entries")
        .select("ngay,rows").eq("factory_id", ord.factory_id)
      const { data: pointRows } = await supabase.from("dispatch_delivery_points")
        .select("ma_lo, lat, lng, doi, phien_a, phien_b, phien_c, phien_d")
        .eq("factory_id", ord.factory_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("ma_lo", { ascending: true })
      const deliveryPoints = normalizeDeliveryPoints(pointRows) || DIEM_GN
      // Normalize DD/MM/YYYY → YYYY-MM-DD (dispatch_entries.ngay từ CSV import dùng format này)
      const toISO = (d: string) => d?.includes("/") ? d.split("/").reverse().join("-") : (d || "")

      // Build lookup maps từ dispatches (key luôn là ISO)
      const dateToRows: Record<string, any[]> = {}
      const uidToRow:   Record<string, any>   = {}
      ;(dispatches||[]).forEach((d:any) => {
        const isoNgay = toISO(d.ngay)
        const rows = d.rows || []
        dateToRows[isoNgay] = [...(dateToRows[isoNgay]||[]), ...rows]
        rows.forEach((r:any) => { if (r.uid) uidToRow[r.uid] = r })
      })

      const extractPlots = (row: any): string[] =>
        (row.lo_thu_hoach||[]).length
          ? row.lo_thu_hoach
          : buildLoThuHoach(row.diem_gn || [], row.phien || [], deliveryPoints)

      const diemGn = new Set<string>()
      let matchedRows = 0
      const processedDates = new Set<string>()

      for (const uid of allTripUids) {
        if (uid in uidToRow) {
          // Format hiện tại: UUID khớp chính xác
          matchedRows++
          extractPlots(uidToRow[uid]).forEach((c:string) => diemGn.add(c))
        } else {
          // Format cũ: "DX-ddmmyy_N" → giải mã ngày, lấy tất cả rows của ngày đó
          const m = uid.match(/^DX-(\d{2})(\d{2})(\d{2})_\d+$/)
          if (m) {
            const isoDate = `20${m[3]}-${m[2]}-${m[1]}`
            if (!processedDates.has(isoDate)) {
              processedDates.add(isoDate)
              ;(dateToRows[isoDate] || []).forEach((row:any) => {
                matchedRows++
                extractPlots(row).forEach((c:string) => diemGn.add(c))
              })
            }
          }
        }
      }

      // Fallback cuối: khi không nhận ra format UID → dùng khoảng ngày ngăn
      let usedDateFallback = false
      if (matchedRows === 0 && allTripUids.size > 0) {
        usedDateFallback = true
        const today = new Date().toISOString().split("T")[0]
        for (const ngan of (ngans||[])) {
          if (!ngan.ngay_bd) continue
          const bd = ngan.ngay_bd as string
          const kt = (ngan.ngay_kt as string) || today
          ;(dispatches||[]).forEach((d:any) => {
            const dn = toISO(d.ngay)
            if (dn >= bd && dn <= kt) {
              ;(d.rows||[]).forEach((row:any) => {
                matchedRows++
                extractPlots(row).forEach((c:string) => diemGn.add(c))
              })
            }
          })
        }
      }
      setDiemGnSet(diemGn)

      // Build extraction date map: lot_id → ngày điều xe sớm nhất của ngăn
      const edMap: Record<string,string> = {}
      for (const lot of (lotsFull||[])) {
        const ngan = (ngans||[]).find((n:any) => n.id === lot.ngan_id)
        if (!ngan) continue
        // Thử exact UID match trước
        const tripSet = new Set(ngan.trips||[])
        const exactDates = (dispatches||[])
          .filter((d:any) => (d.rows||[]).some((r:any) => tripSet.has(r.uid)))
          .map((d:any) => d.ngay as string).filter(Boolean).sort()
        if (exactDates.length) { edMap[lot.id] = exactDates[0]; continue }
        // Fallback: giải mã "DX-ddmmyy_N" → lấy ngày sớm nhất
        const legacyDates: string[] = []
        ;(ngan.trips||[]).forEach((uid:string) => {
          const m = uid.match(/^DX-(\d{2})(\d{2})(\d{2})_\d+$/)
          if (m) legacyDates.push(`20${m[3]}-${m[2]}-${m[1]}`)
        })
        edMap[lot.id] = legacyDates.length ? legacyDates.sort()[0] : (ngan.ngay_bd as string)||""
      }
      setExtractionDates(edMap)

      // 4. Lấy polygon lô vườn — ưu tiên DB (forest_plots), fallback file GeoJSON tĩnh
      let filtered: FeatureCollection

      const tenList = [...diemGn]
      const { data: plotRows } = tenList.length
        ? await supabase
            .from("forest_plots")
            .select("ten, geometry, nong_truong, doi, dien_tich_ha")
            .eq("factory_id", ord.factory_id)
            .eq("is_active", true)
            .in("ten", tenList)
        : { data: null }

      if (plotRows && plotRows.length > 0) {
        // DB có dữ liệu — dùng trực tiếp
        filtered = {
          type: "FeatureCollection",
          features: (plotRows as { ten: string; geometry: unknown; nong_truong: string | null; doi: number | null; dien_tich_ha: number | null }[]).map(p => ({
            type: "Feature" as const,
            properties: {
              Ten: p.ten,
              Nong_truong: p.nong_truong ?? "",
              Doi_2026: p.doi ?? null,
              Dtich2026_ha: p.dien_tich_ha ?? null,
            },
            geometry: p.geometry as FeatureCollection["features"][0]["geometry"],
          })),
        }
      } else {
        // Fallback: file GeoJSON tĩnh (dùng khi chưa seed DB)
        const res = await fetch("/geojson/Lo cao su - 2026_Full.geojson")
        const full: FeatureCollection = await res.json()
        filtered = {
          type: "FeatureCollection",
          features: full.features.filter(f => diemGn.has(f.properties?.Ten)),
        }
      }

      setTraceInfo({ lots: lotsFull?.length||0, ngans: nganIds.length, tripUids: allTripUids.size, matchedRows, diemGn: diemGn.size, features: filtered.features.length, fallback: usedDateFallback })
      setGeoData(filtered)
    } catch (e) {
      console.error(e)
    }
    setLoadingGeo(false)
  }

  // ── Upload file ───────────────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!order || !factoryId) return
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    const newFiles = [...(order.files || [])]
    for (const file of files) {
      const path = `${factoryId}/${order.ma_don}/${Date.now()}_${file.name}`
      const { data, error } = await supabase.storage.from("eudr-files").upload(path, file, { upsert: true })
      if (error) { showToast(`Lỗi: ${error.message}`, false); continue }
      const { data: urlData } = supabase.storage.from("eudr-files").getPublicUrl(data.path)
      newFiles.push({ name: file.name, url: urlData.publicUrl, size: file.size })
    }
    const { error } = await supabase.from("export_orders").update({ files: newFiles }).eq("id", order.id)
    if (error) { showToast(error.message, false) } else {
      setOrder(prev => prev ? { ...prev, files: newFiles } : prev)
      showToast(`Đã đính kèm ${files.length} file`)
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // ── Delete attached file ──────────────────────────────────────────────────
  const handleDeleteFile = async (url: string) => {
    if (!order) return
    const newFiles = (order.files||[]).filter(f => f.url !== url)
    await supabase.from("export_orders").update({ files: newFiles }).eq("id", order.id)
    setOrder(prev => prev ? { ...prev, files: newFiles } : prev)
    showToast("Đã xóa file")
  }

  // ── Download single DDS ───────────────────────────────────────────────────
  const handleDownloadDDS = async (n: 1 | 2) => {
    if (!order || !factory) { showToast("Chưa có thông tin công ty. Vào Settings → điền thông tin Seller.", false); return }
    try {
      const { generateDDS1, generateDDS2 } = await import("./dds-generator")
      const blob = n === 1
        ? await generateDDS1(order, geoData, factory, lotCertMap)
        : await generateDDS2(order, lotDetails, extractionDates, factory)
      saveAs(blob, `${order.ma_don}_DDS_${n === 1 ? "Plantation" : "Shipment"}.pdf`)
    } catch (e: any) {
      showToast("Lỗi tạo PDF: " + e.message, false)
    }
  }

  // ── Download all (zip) ────────────────────────────────────────────────────
  const handleDownloadAll = async () => {
    if (!order) return
    setDownloading(true)
    const zip = new JSZip()
    const folder = zip.folder(order.ma_don) || zip

    try {
      // Generated DDS PDFs (dynamic per order)
      if (factory) {
        const { generateDDS1, generateDDS2 } = await import("./dds-generator")
        folder.file(`${order.ma_don}_DDS_Plantation.pdf`, await generateDDS1(order, geoData, factory, lotCertMap))
        folder.file(`${order.ma_don}_DDS_Shipment.pdf`,   await generateDDS2(order, lotDetails, extractionDates, factory))
      } else {
        // Fallback: static templates if factory info not set up yet
        for (const [name, path] of [
          ["EUDR_DDS_Template_1.pdf", "/mau_eudr_1.pdf"],
          ["EUDR_DDS_Template_2.pdf", "/mau_eudr2.pdf"],
        ] as [string,string][]) {
          try { const res = await fetch(path); if (res.ok) folder.file(name, await res.blob()) } catch {}
        }
      }

      // GeoJSON
      if (geoData) {
        folder.file(`${order.ma_don}_supply_chain.geojson`, JSON.stringify(geoData, null, 2))
      }

      // Uploaded files
      for (const f of (order.files || [])) {
        try {
          const res = await fetch(f.url)
          if (res.ok) folder.file(f.name, await res.blob())
        } catch {}
      }

      const blob = await zip.generateAsync({ type: "blob" })
      saveAs(blob, `EUDR_${order.ma_don}.zip`)
      showToast("Đã tải về " + order.ma_don + ".zip")
    } catch (e: any) {
      showToast("Lỗi: " + e.message, false)
    }
    setDownloading(false)
  }

  // ── GeoJSON style ─────────────────────────────────────────────────────────
  const geoStyle = (feature?: Feature) => {
    const team = feature?.properties?.Doi_2026 ?? "0"
    return { fillColor: TEAM_COLORS[String(team)] ?? "#6b7280", weight: 1.5, color: "#fff", fillOpacity: 0.7 }
  }

  const onEachFeature = (feature: Feature, layer: L.Layer) => {
    const p = feature.properties || {}
    layer.bindPopup(`
      <div class="text-xs leading-5">
        <div class="font-bold text-slate-800 mb-1">${p.Ma_lo_2026 ?? p.Ma_lo ?? "?"}</div>
        <div>Đội: <strong>${p.Doi_2026 ?? "—"}</strong></div>
        <div>Diện tích: <strong>${p.Dtich2026_ha ?? "—"} ha</strong></div>
        <div>Giống: <strong>${p.Giong ?? "—"}</strong></div>
        <div>Năm trồng: <strong>${p.Nam_trong ?? "—"}</strong></div>
      </div>
    `, { maxWidth: 220 })
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  const cust = order?.customers

  return (
    <div className="h-full">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-bold ${toast.ok?"bg-emerald-600":"bg-red-600"}`}>
          {toast.ok ? <Check size={15}/> : <AlertTriangle size={15}/>} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
            <Shield size={22} className="text-emerald-600"/> EUDR / Truy xuất nguồn gốc
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Tra cứu đơn hàng và xem vùng trồng liên quan</p>
        </div>
      </div>

      {/* Search bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex gap-3">
          <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
            <Search size={16} className="text-slate-400 shrink-0"/>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key==="Enter" && searchOrder(query)}
              placeholder="Nhập mã đơn xuất hàng (VD: XH-KUMHO-TB001-010126)..."
              className="flex-1 text-sm outline-none bg-transparent"
            />
            {query && <button onClick={()=>{setQuery("");setOrder(null);setGeoData(null);setNotFound(false)}}><X size={14} className="text-slate-400"/></button>}
          </div>
          <button onClick={()=>searchOrder(query)} disabled={searching || !query.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50">
            {searching ? <Loader2 size={15} className="animate-spin"/> : <Search size={15}/>}
            Tra cứu
          </button>
        </div>
        {notFound && <div className="mt-2 text-sm text-red-500 flex items-center gap-2"><AlertTriangle size={14}/> Không tìm thấy đơn hàng "{query}"</div>}
      </div>

      {/* Main content */}
      {order && (
        <div className="flex gap-4" style={{ height: "calc(100vh - 260px)" }}>
          {/* LEFT: Info + Files */}
          <div className="w-80 shrink-0 overflow-y-auto space-y-4">

            {/* Order info */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                <Package size={15} className="text-emerald-600"/>
                <span className="font-bold text-slate-700 text-sm">{order.ma_don}</span>
              </div>
              <div className="p-4 space-y-2 text-xs">
                <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">Ngày xuất:</span><span className="font-semibold">{order.ngay ? new Date(order.ngay).toLocaleDateString("vi-VN") : "—"}</span></div>
                <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">Loại:</span><span className="font-semibold">{order.chung_loai}</span></div>
                <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">Tổng bành:</span><span className="font-semibold text-emerald-600">{order.tong_banh?.toLocaleString()}</span></div>
                <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">Lô hàng:</span><span className="font-semibold">{[...new Set(order.assignments?.map(a=>a.lot_id)||[])].length} lô</span></div>
                <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">Xe:</span><span className="font-semibold">{order.vehicles?.length || 0} xe</span></div>
              </div>
            </div>

            {/* Customer info */}
            {cust && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
                <div className="bg-gradient-to-r from-blue-50 to-cyan-50 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                  <Globe size={15} className="text-blue-600"/>
                  <span className="font-bold text-slate-700 text-sm">Khách hàng</span>
                </div>
                <div className="p-4 text-xs space-y-1">
                  <div className="font-bold text-slate-700 text-sm">{cust.ten_kh_en}</div>
                  {cust.dia_chi && <div className="text-slate-500 whitespace-pre-line">{cust.dia_chi}</div>}
                  {cust.nguoi_lien_he && <div className="text-slate-500 mt-1">Liên hệ: <span className="font-semibold">{cust.nguoi_lien_he}</span></div>}
                  {cust.email && <div className="text-slate-500">{cust.email}</div>}
                  {cust.quoc_gia && <div className="text-slate-400 font-semibold uppercase text-[10px] tracking-wide mt-1">{cust.quoc_gia}</div>}
                </div>
              </div>
            )}

            {/* Trace info — luôn hiển thị khi đang load hoặc đã có kết quả */}
            {(loadingGeo || traceInfo !== null) && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 text-xs">
                {loadingGeo ? (
                  <div className="flex items-center gap-2 text-slate-500">
                    <Loader2 size={13} className="animate-spin"/> Đang truy xuất chuỗi cung ứng...
                  </div>
                ) : traceInfo && traceInfo.features > 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-emerald-600">
                      <Check size={13}/> <span className="font-semibold">{traceInfo.features} lô vườn</span>
                      <span className="text-slate-400">từ {traceInfo.diemGn} mã lô vườn</span>
                    </div>
                    {traceInfo.fallback && (
                      <div className="text-[10px] text-amber-500">khoảng ngày ngăn (UID điều xe đã thay đổi)</div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-1.5 text-amber-600 font-semibold mb-1.5">
                      <AlertTriangle size={13}/> Không tìm thấy lô vườn
                    </div>
                    <div className="text-[10px] text-slate-400 leading-5">
                      {traceInfo && traceInfo.lots === 0
                        ? "Đơn hàng chưa có lô thành phẩm"
                        : traceInfo && traceInfo.ngans === 0
                        ? `${traceInfo.lots} lô TP → chưa có ngăn lưu`
                        : traceInfo && traceInfo.tripUids === 0
                        ? `${traceInfo.ngans} ngăn → chưa có chuyến điều xe`
                        : traceInfo && traceInfo.diemGn === 0 && (traceInfo.matchedRows||0) === 0
                        ? `${traceInfo.tripUids} UID ngăn không khớp bất kỳ chuyến nào (dữ liệu điều xe đã thay đổi?)`
                        : traceInfo && traceInfo.diemGn === 0
                        ? `${traceInfo.matchedRows} chuyến khớp nhưng diem_gn/phien rỗng`
                        : `${traceInfo?.diemGn} lô thu hoạch không khớp dữ liệu GeoJSON 2026`}
                    </div>
                    {traceInfo && (
                      <div className="text-[10px] text-slate-300 mt-1">
                        {traceInfo.lots}TP → {traceInfo.ngans}NL → {traceInfo.tripUids}UID → {traceInfo.matchedRows||0}match → {traceInfo.diemGn}LV → {traceInfo.features}lô
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Files panel */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
              <div className="bg-gradient-to-r from-violet-50 to-purple-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-violet-600"/>
                  <span className="font-bold text-slate-700 text-sm">Tài liệu EUDR</span>
                </div>
                <button onClick={handleDownloadAll} disabled={downloading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50">
                  {downloading ? <Loader2 size={11} className="animate-spin"/> : <Download size={11}/>}
                  Tải tất cả
                </button>
              </div>
              <div className="p-3 space-y-1.5">
                {/* DDS files — generated dynamically per order */}
                {([
                  { n: 1 as const, label: `${order.ma_don}_DDS_Plantation.pdf`, desc: "Lô vườn" },
                  { n: 2 as const, label: `${order.ma_don}_DDS_Shipment.pdf`,   desc: "Lô thành phẩm" },
                ] as const).map(f => (
                  <div key={f.n} className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                    <FileText size={13} className="text-blue-500 shrink-0"/>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-700 truncate">{f.label}</div>
                      <div className="text-[10px] text-slate-400">DDS {f.desc}</div>
                    </div>
                    <button onClick={() => handleDownloadDDS(f.n)}
                      className="p-1 hover:bg-blue-100 rounded text-blue-500" title="Tạo và tải PDF">
                      <FileDown size={13}/>
                    </button>
                  </div>
                ))}

                {/* GeoJSON download */}
                {geoData && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-100">
                    <Map size={13} className="text-emerald-600 shrink-0"/>
                    <span className="flex-1 text-xs text-slate-700 truncate">{order.ma_don}_supply_chain.geojson</span>
                    <button onClick={() => {
                      const blob = new Blob([JSON.stringify(geoData,null,2)], { type:"application/json" })
                      saveAs(blob, `${order.ma_don}_supply_chain.geojson`)
                    }} className="p-1 hover:bg-emerald-100 rounded text-emerald-600" title="Tải về"><FileDown size={13}/></button>
                  </div>
                )}

                {/* Uploaded files */}
                {(order.files||[]).map(f => (
                  <div key={f.url} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                    <FileText size={13} className="text-slate-400 shrink-0"/>
                    <span className="flex-1 text-xs text-slate-700 truncate" title={f.name}>{f.name}</span>
                    <a href={f.url} download className="p-1 hover:bg-slate-200 rounded text-slate-500" title="Tải về"><FileDown size={13}/></a>
                    <button onClick={()=>handleDeleteFile(f.url)} className="p-1 hover:bg-red-50 rounded text-red-400" title="Xóa"><Trash2 size={11}/></button>
                  </div>
                ))}

                {/* Upload button */}
                <div>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload}/>
                  <button onClick={()=>fileInputRef.current?.click()} disabled={uploading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 border-2 border-dashed border-slate-300 hover:border-emerald-400 rounded-lg text-xs text-slate-500 hover:text-emerald-600 transition-all disabled:opacity-50">
                    {uploading ? <><Loader2 size={13} className="animate-spin"/> Đang tải lên...</> : <><Upload size={13}/> Đính kèm file</>}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Map */}
          <div className="flex-1 rounded-xl overflow-hidden border border-slate-200 shadow-md relative">
            {!geoData && !loadingGeo && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
                {traceInfo !== null ? (
                  <div className="text-center">
                    <AlertTriangle size={44} className="mx-auto mb-3 text-amber-400"/>
                    <p className="font-semibold text-amber-600">Không tìm thấy lô vườn</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs">
                      {traceInfo.lots === 0
                        ? "Đơn hàng chưa có lô thành phẩm"
                        : traceInfo.ngans === 0
                        ? `${traceInfo.lots} lô chưa được liên kết ngăn lưu`
                        : traceInfo.tripUids === 0
                        ? `${traceInfo.ngans} ngăn chưa có chuyến điều xe`
                        : traceInfo.diemGn === 0 && (traceInfo.matchedRows||0) === 0
                        ? `${traceInfo.tripUids} UID ngăn không khớp bất kỳ chuyến nào`
                        : traceInfo.diemGn === 0
                        ? `${traceInfo.matchedRows} chuyến khớp UID nhưng diem_gn/phien rỗng`
                        : `${traceInfo.diemGn} lô thu hoạch không khớp GeoJSON 2026`}
                    </p>
                    <p className="text-[10px] text-slate-300 mt-2">
                      {traceInfo.lots}TP → {traceInfo.ngans}NL → {traceInfo.tripUids}ĐX → {traceInfo.diemGn}LV → {traceInfo.features}lô
                    </p>
                  </div>
                ) : (
                  <div className="text-center text-slate-400">
                    <Map size={48} className="mx-auto mb-3 opacity-30"/>
                    <p className="font-semibold">Đang truy xuất chuỗi cung ứng...</p>
                    <p className="text-xs mt-1">Bản đồ sẽ hiển thị sau khi tìm thấy lô vườn</p>
                  </div>
                )}
              </div>
            )}
            {loadingGeo && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20">
                <div className="flex items-center gap-3 bg-white rounded-xl shadow-lg px-6 py-4">
                  <Loader2 size={20} className="animate-spin text-emerald-500"/>
                  <span className="text-sm font-semibold text-slate-700">Đang tải dữ liệu lô vườn...</span>
                </div>
              </div>
            )}
            <MapContainer
              center={[12.5819, 105.4972]}
              zoom={11}
              style={{ height: "100%", width: "100%" }}
              zoomControl={true}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
              {geoData && geoData.features.length > 0 && (
                <>
                  <GeoJSON
                    key={JSON.stringify(geoData.features.map(f=>f.properties?.Ma_lo))}
                    data={geoData}
                    style={geoStyle}
                    onEachFeature={onEachFeature}
                  />
                  <FitBounds data={geoData}/>
                </>
              )}
            </MapContainer>

            {/* Map legend */}
            {geoData && geoData.features.length > 0 && (
              <div className="absolute bottom-4 left-4 z-[400] bg-white/90 backdrop-blur rounded-xl shadow-md p-3 text-xs">
                <div className="font-bold text-slate-700 mb-2 flex items-center gap-1"><Map size={12}/> {geoData.features.length} lô vườn</div>
                <div className="text-slate-500">Từ {diemGnSet.size} điểm giao nhận</div>
                <div className="text-slate-500">{order.chung_loai} · {order.tong_banh?.toLocaleString()} bành</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!order && !searching && !notFound && (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <Shield size={56} className="mb-4 opacity-20"/>
          <h3 className="text-xl font-bold text-slate-600 mb-2">Truy xuất nguồn gốc EUDR</h3>
          <p className="text-sm text-center max-w-md">
            Nhập mã đơn xuất hàng để xem bản đồ lô thu hoạch, tải tài liệu DDS và GeoJSON
            phục vụ tuân thủ quy định EUDR.
          </p>
          <p className="text-xs mt-3 text-slate-300">Hoặc quét mã QR trên phiếu xuất hàng</p>
        </div>
      )}
    </div>
  )
}
