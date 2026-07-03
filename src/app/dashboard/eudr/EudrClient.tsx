"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, hydrateActiveSession } from "@/lib/auth"
import { DIEM_GN, buildLoThuHoach, normalizeDeliveryPoints } from "@/lib/dispatch-master"
import { loadDispatchEntriesWithResolvedRows } from "@/lib/dispatch-entry-rows"
import { loadDispatchTripsByUids, type StorageTripItem } from "@/lib/storage-detail"
import { dedupeLotsByMaLo, normalizeLotCode } from "@/app/dashboard/product/shared"
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { FeatureCollection, Feature } from "geojson"
import JSZip from "jszip"
import { saveAs } from "file-saver"
import {
  Search, FileDown, Upload, Trash2, Map, Shield, Package,
  AlertTriangle, Check, X, FileText, Globe, Download, Loader2,
  Users, Building2, Sprout, Ruler, CalendarDays, Trees, Route, Mountain, MapPin, Layers3
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
  files: { name: string; url: string; path?: string; size?: number }[]
  customers?: { ma_kh:string; ten_kh_en:string; quoc_gia:string; dia_chi:string; email:string; nguoi_lien_he:string }
}

type ExportOrderFile = ExportOrder["files"][number]

type EudrUploadedFile = {
  name: string
  url: string
  path: string
  size: number
  source: "client" | "server-fallback"
}

type AttachmentDebugRow = {
  index: number
  name: string
  url: string
  path: string | null
  resolvedPath: string | null
  size: number | null
  source: string
  downloadStatus?: "pending" | "ok" | "error"
  downloadError?: string | null
  blobSize?: number | null
  zipEntryName?: string | null
}

type AttachmentDebugState = {
  stage: "idle" | "after-upload" | "before-zip" | "after-zip" | "manual-refresh"
  updatedAt: string
  orderId: string | null
  orderCode: string | null
  selectedUploadFiles: AttachmentDebugRow[]
  currentFiles: AttachmentDebugRow[]
  latestFiles: AttachmentDebugRow[]
  filesForZip: AttachmentDebugRow[]
  uploadFiles: AttachmentDebugRow[]
  uploadResults: AttachmentDebugRow[]
  dbAfterUpload: AttachmentDebugRow[]
  attachmentResults: AttachmentDebugRow[]
  uploadErrors: string[]
  attachmentErrors: string[]
  note?: string
}

type TraceLot = {
  id: string
  ma_lo: string
  factory_id?: string | null
  ngan_id: string | null
  ngay_sx?: string | null
  loai_banh?: number | null
  kien_a?: number | null
  kien_b?: number | null
  kien_c?: number | null
  kien_d?: number | null
  created_at?: string | null
  updated_at?: string | null
}

type TraceNgan = {
  id: string
  trips: string[] | null
  chung_nhan: string | null
  ngay_bd: string | null
  ngay_kt: string | null
}

const DDS_FILES = [
  { n: 1 as const, suffix: "Plantation", desc: "Lô vườn" },
  { n: 2 as const, suffix: "Shipment", desc: "Lô thành phẩm" },
] as const

type ForestPlotRow = {
  ten: string
  ma_lo_full: string | null
  geometry: unknown
  nong_truong: string | null
  doi: number | null
  giong: string | null
  dien_tich_ha: number | null
  nam_trong: number | null
  nam_cao_up: number | null
}

type EudrPlotProperties = {
  ID?: string
  Ma_lo_2026?: string
  Ten?: string
  Nong_truong?: string
  Doi_2026?: string | number | null
  Doi_nho?: string
  Giong?: string
  Dtich2026_ha?: string | number | null
  Nam_trong?: string | number | null
  Nam_mo_cao?: string | number | null
  Tuoi_cao?: string | number | null
  Tong_so_cay_KK?: string | number | null
  Mat_cao_2026?: string
  CD_cao_2026?: string
  ToadoX?: string | number | null
  ToadoY?: string | number | null
  Khoang_cach_m?: string
  Hang_dat?: string
  Ma_lo?: string
  Cao_trinh_min_m?: string | number | null
  Cao_trinh_max_m?: string | number | null
  Phuong_phap?: string
  ma_lo_full?: string
  [key: string]: unknown
}

const EUDR_DEBUG_ENABLED = process.env.NEXT_PUBLIC_EUDR_DEBUG === "1"

function resolveEudrStoragePath(fileUrl?: string | null) {
  if (!fileUrl) return null
  try {
    const url = new URL(fileUrl)
    const markers = [
      "/storage/v1/object/public/eudr-files/",
      "/storage/v1/object/sign/eudr-files/",
      "/storage/v1/object/authenticated/eudr-files/",
    ]

    for (const marker of markers) {
      const markerIndex = url.pathname.indexOf(marker)
      if (markerIndex >= 0) {
        return decodeURIComponent(url.pathname.slice(markerIndex + marker.length))
      }
    }

    const bucketIndex = url.pathname.indexOf("/eudr-files/")
    if (bucketIndex >= 0) {
      return decodeURIComponent(url.pathname.slice(bucketIndex + "/eudr-files/".length))
    }

    return null
  } catch {
    return null
  }
}

function isStorageConfigError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  return /bucket.*not found|row-level security|permission denied|unauthorized|403/i.test(message)
}

function sanitizeEudrPathSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "_")
}

function sanitizeEudrFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function buildEudrStoragePath(factoryId: string, orderCode: string, fileName: string) {
  return `${sanitizeEudrPathSegment(factoryId)}/${sanitizeEudrPathSegment(orderCode)}/${Date.now()}_${sanitizeEudrFilename(fileName)}`
}

async function uploadEudrFile(params: {
  factoryId: string
  orderCode: string
  file: File
}): Promise<EudrUploadedFile> {
  const path = buildEudrStoragePath(params.factoryId, params.orderCode, params.file.name)
  const uploadResult = await supabase.storage.from("eudr-files").upload(path, params.file, { upsert: true })

  if (!uploadResult.error) {
    const { data } = supabase.storage.from("eudr-files").getPublicUrl(uploadResult.data.path)
    return {
      name: params.file.name,
      url: data.publicUrl,
      path: uploadResult.data.path,
      size: params.file.size,
      source: "client",
    }
  }

  if (!isStorageConfigError(uploadResult.error)) {
    throw uploadResult.error
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (!sessionData.session?.access_token) {
    throw new Error("Phien dang nhap da het han. Vui long dang nhap lai.")
  }

  const body = new FormData()
  body.append("factoryId", params.factoryId)
  body.append("orderCode", params.orderCode)
  body.append("file", params.file)

  const response = await fetch("/api/eudr/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body,
  })

  const payload = (await response.json().catch(() => null)) as {
    error?: string
    name?: string
    size?: number
    path?: string
    publicUrl?: string
  } | null

  if (!response.ok || !payload?.path || !payload.publicUrl) {
    throw new Error(payload?.error || uploadResult.error.message || "Khong tai duoc file EUDR len may chu.")
  }

  console.warn("EUDR upload used server fallback after storage policy failure", {
    orderCode: params.orderCode,
    fileName: params.file.name,
    initialError: uploadResult.error.message,
    path: payload.path,
  })

  return {
    name: payload.name || params.file.name,
    url: payload.publicUrl,
    path: payload.path,
    size: typeof payload.size === "number" ? payload.size : params.file.size,
    source: "server-fallback",
  }
}

function normalizeExportOrderFiles(files: unknown): ExportOrderFile[] {
  if (!Array.isArray(files)) return []
  return files.filter((file): file is ExportOrderFile => (
    !!file &&
    typeof file === "object" &&
    typeof file.name === "string" &&
    typeof file.url === "string"
  ))
}

function getUniqueZipEntryName(name: string, usedNames: Set<string>) {
  const trimmed = name.trim() || "attachment"
  if (!usedNames.has(trimmed)) {
    usedNames.add(trimmed)
    return trimmed
  }

  const dotIndex = trimmed.lastIndexOf(".")
  const base = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed
  const ext = dotIndex > 0 ? trimmed.slice(dotIndex) : ""

  let index = 2
  let candidate = `${base} (${index})${ext}`
  while (usedNames.has(candidate)) {
    index += 1
    candidate = `${base} (${index})${ext}`
  }
  usedNames.add(candidate)
  return candidate
}

function mergeExportOrderFiles(primary: ExportOrderFile[], fallback: ExportOrderFile[]) {
  const merged = new globalThis.Map<string, ExportOrderFile>()

  for (const file of [...primary, ...fallback]) {
    const key = file.path || file.url || `${file.name}:${file.size ?? ""}`
    if (!merged.has(key)) merged.set(key, file)
  }

  return [...merged.values()]
}

function toAttachmentDebugRows(files: ExportOrderFile[], source: string): AttachmentDebugRow[] {
  return files.map((file, index) => ({
    index,
    name: file.name,
    url: file.url,
    path: file.path ?? null,
    resolvedPath: file.path || resolveEudrStoragePath(file.url),
    size: typeof file.size === "number" ? file.size : null,
    source,
  }))
}

function toSelectedFileDebugRows(files: File[], source: string): AttachmentDebugRow[] {
  return files.map((file, index) => ({
    index,
    name: file.name,
    url: "",
    path: null,
    resolvedPath: null,
    size: file.size,
    source,
  }))
}

function formatAttachmentDebugTimestamp(value: string) {
  if (!value) return "Chua co"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("vi-VN")
}

function getAttachmentDebugBadgeTone(status?: AttachmentDebugRow["downloadStatus"]) {
  if (status === "ok") return "bg-emerald-100 text-emerald-700 border-emerald-200"
  if (status === "error") return "bg-red-100 text-red-700 border-red-200"
  return "bg-slate-100 text-slate-600 border-slate-200"
}

function toDisplayText(value: unknown, fallback = "—") {
  if (value === null || value === undefined) return fallback
  const text = String(value).trim()
  return text ? text : fallback
}

function toDisplayNumber(value: unknown, digits = 0, fallback = "—") {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return digits > 0 ? number.toFixed(digits) : number.toLocaleString("vi-VN")
}

function parseFiniteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function buildStaticPlotFeatureMap(full: FeatureCollection | null) {
  const mapped = new globalThis.Map<string, FeatureCollection["features"][number]>()
  for (const feature of full?.features || []) {
    const key = String((feature.properties as EudrPlotProperties | undefined)?.Ten || "").trim()
    if (key) mapped.set(key, feature)
  }
  return mapped
}

function mergePlotProperties(
  plotCode: string,
  dbRow?: ForestPlotRow | null,
  reference?: FeatureCollection["features"][number] | null,
): EudrPlotProperties {
  const refProps = ((reference?.properties as EudrPlotProperties | undefined) || {})
  const normalizedArea = dbRow?.dien_tich_ha ?? refProps.Dtich2026_ha ?? null
  const normalizedTeam = dbRow?.doi ?? refProps.Doi_2026 ?? null
  const normalizedPlantYear = dbRow?.nam_trong ?? refProps.Nam_trong ?? null
  const normalizedOpenYear = dbRow?.nam_cao_up ?? refProps.Nam_mo_cao ?? null
  const areaNumber = parseFiniteNumber(normalizedArea)

  return {
    ...refProps,
    Ten: plotCode || refProps.Ten || refProps.Ma_lo_2026 || refProps.Ma_lo,
    Ma_lo: toDisplayText(refProps.Ma_lo, dbRow?.ma_lo_full || plotCode),
    Ma_lo_2026: toDisplayText(refProps.Ma_lo_2026, dbRow?.ma_lo_full || plotCode),
    Nong_truong: toDisplayText(dbRow?.nong_truong, refProps.Nong_truong || ""),
    Doi_2026: normalizedTeam,
    Giong: toDisplayText(dbRow?.giong, refProps.Giong || ""),
    Dtich2026_ha: areaNumber ?? normalizedArea,
    Nam_trong: normalizedPlantYear,
    Nam_mo_cao: normalizedOpenYear,
    ma_lo_full: dbRow?.ma_lo_full || refProps.ma_lo_full || refProps.Ma_lo_2026 || "",
  }
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

// ─── MapResizeFix ─────────────────────────────────────────────────────────────
// Container map dùng style={{height:"100%"}} phụ thuộc layout flex responsive không
// có chiều cao cố định trên mobile — cùng nguy cơ Leaflet đo sai size lúc mount như
// module Bản đồ lô. invalidateSize() + ResizeObserver phòng ngừa, cộng thêm thuần túy.
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
  const [selectedPlot, setSelectedPlot] = useState<EudrPlotProperties | null>(null)
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
  const [showAttachmentDebug, setShowAttachmentDebug] = useState(false)
  const [attachmentDebug, setAttachmentDebug] = useState<AttachmentDebugState>({
    stage: "idle",
    updatedAt: "",
    orderId: null,
    orderCode: null,
    selectedUploadFiles: [],
    currentFiles: [],
    latestFiles: [],
    filesForZip: [],
    uploadFiles: [],
    uploadResults: [],
    dbAfterUpload: [],
    attachmentResults: [],
    uploadErrors: [],
    attachmentErrors: [],
  })
  const fileInputRef             = useRef<HTMLInputElement>(null)

  const showToast = (msg: string, ok = true) => { setToast({msg,ok}); setTimeout(()=>setToast(null),3500) }

  useEffect(() => {
    const bootstrap = async () => {
      const { user } = await hydrateActiveSession().catch(() => ({ user: null }))
      if (!hasPermission(user, "export.view")) {
        window.location.replace("/dashboard")
        return
      }
      const fid = user?.factory_id || await getActiveFactoryId()
      if (!fid) return
      setFactoryId(fid)
      supabase.from("factories")
        .select("id,full_name_en,address_en,contact_person,contact_email,website,country_en")
        .eq("id", fid).single()
        .then(({ data }) => { if (data) setFactory(data as FactoryProfile) })
      if (initOrder) searchOrder(initOrder, fid)
    }
    void bootstrap()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Search order ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!geoData?.features.length) {
      setSelectedPlot(null)
      return
    }

    const currentTen = selectedPlot?.Ten
    if (!currentTen) return

    const nextSelected = geoData.features.find(
      (feature) => String((feature.properties as EudrPlotProperties | undefined)?.Ten || "") === currentTen,
    )?.properties as EudrPlotProperties | undefined

    if (!nextSelected) setSelectedPlot(null)
  }, [geoData, selectedPlot?.Ten])

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
    setOrder({
      ...(data as ExportOrder),
      files: normalizeExportOrderFiles((data as ExportOrder).files),
    })
    traceGeoChain(data)
  }, [factoryId])

  const fetchLatestOrderFiles = useCallback(async (orderId: string) => {
    const { data, error } = await supabase
      .from("export_orders")
      .select("files")
      .eq("id", orderId)
      .single()

    if (error) throw error
    return normalizeExportOrderFiles(data?.files)
  }, [])

  const refreshAttachmentDebug = useCallback(async () => {
    if (!order) return
    try {
      const currentFiles = normalizeExportOrderFiles(order.files)
      const latestFiles = await fetchLatestOrderFiles(order.id)
      setAttachmentDebug(prev => ({
        ...prev,
        stage: "manual-refresh",
        updatedAt: new Date().toISOString(),
        orderId: order.id,
        orderCode: order.ma_don,
        currentFiles: toAttachmentDebugRows(currentFiles, "state-manual-refresh"),
        latestFiles: toAttachmentDebugRows(latestFiles, "db-manual-refresh"),
        note: `Lam moi DB thu cong. DB dang co ${latestFiles.length} file, state dang co ${currentFiles.length} file.`,
      }))
      setShowAttachmentDebug(true)
      console.info("EUDR debug manual refresh", {
        orderId: order.id,
        orderCode: order.ma_don,
        currentFiles,
        latestFiles,
      })
    } catch (error: unknown) {
      console.error("Failed to refresh EUDR attachment debug panel", error)
      showToast("Khong the lam moi debug files tu DB.", false)
    }
  }, [fetchLatestOrderFiles, order])

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
      const { data: lotsById } = await supabase.from("lots")
        .select("id,factory_id,ma_lo,ngay_sx,loai_banh,kien_a,kien_b,kien_c,kien_d,ngan_id,created_at,updated_at")
        .in("id", lotIds)
      const lotsByIdMap = new globalThis.Map(((lotsById || []) as TraceLot[]).map((lot) => [lot.id, lot] as const))
      const missingLotCodes = [...new Set(
        ord.assignments
          .filter((assignment) => !lotsByIdMap.has(assignment.lot_id))
          .map((assignment) => assignment.ma_lo)
          .filter(Boolean),
      )]
      const { data: lotsByCode } = missingLotCodes.length
        ? await supabase
            .from("lots")
            .select("id,factory_id,ma_lo,ngay_sx,loai_banh,kien_a,kien_b,kien_c,kien_d,ngan_id,created_at,updated_at")
            .eq("factory_id", ord.factory_id)
            .in("ma_lo", missingLotCodes)
        : { data: [] }
      const canonicalLotsByCode = new globalThis.Map(
        dedupeLotsByMaLo((lotsByCode || []) as TraceLot[]).map(
          (lot) => [normalizeLotCode(lot.ma_lo), lot] as const,
        ),
      )
      const resolvedAssignments = ord.assignments.map((assignment) => {
        const resolvedLot =
          lotsByIdMap.get(assignment.lot_id) ||
          canonicalLotsByCode.get(normalizeLotCode(assignment.ma_lo))
        return resolvedLot
          ? { ...assignment, lot_id: resolvedLot.id, ma_lo: resolvedLot.ma_lo }
          : assignment
      })
      const typedLotsMap = new globalThis.Map<string, TraceLot>()
      resolvedAssignments.forEach((assignment) => {
        const resolvedLot =
          lotsByIdMap.get(assignment.lot_id) ||
          canonicalLotsByCode.get(normalizeLotCode(assignment.ma_lo))
        if (resolvedLot) typedLotsMap.set(resolvedLot.id, resolvedLot)
      })
      const typedLots = Array.from(typedLotsMap.values())
      setLotDetails(typedLots as LotDetail[])
      if (resolvedAssignments.some((assignment, index) => assignment.lot_id !== ord.assignments[index]?.lot_id)) {
        setOrder((current) => current?.id === ord.id ? { ...current, assignments: resolvedAssignments } : current)
      }
      const nganIds = [...new Set(typedLots.map((lot) => lot.ngan_id).filter((value): value is string => Boolean(value)))]
      if (!nganIds.length) {
        setTraceInfo({ lots: typedLots.length, ngans: 0, tripUids: 0, matchedRows: 0, diemGn: 0, features: 0 })
        setLoadingGeo(false); return
      }

      // 2. Get ngans → trips + chung_nhan
      const { data: ngans } = await supabase.from("ngans")
        .select("id,trips,chung_nhan,ngay_bd,ngay_kt").in("id", nganIds)
      const typedNgans = (ngans || []) as TraceNgan[]

      // Build lot→certification map from ngan.chung_nhan
      const certMap: Record<string,string> = {}
      for (const lot of typedLots) {
        const ngan = typedNgans.find((item) => item.id === lot.ngan_id)
        certMap[lot.id] = ngan?.chung_nhan ?? ""
      }
      setLotCertMap(certMap)

      const allTripUids = new Set<string>()
      typedNgans.forEach((ngan) => (ngan.trips || []).forEach((uid) => allTripUids.add(uid)))
      if (!allTripUids.size) {
        setTraceInfo({ lots: typedLots.length, ngans: nganIds.length, tripUids: 0, matchedRows: 0, diemGn: 0, features: 0 })
        setLoadingGeo(false); return
      }

      // 3. Resolve trips through shared helper so stable refs and legacy uid tokens both work.
      const nganTrips = await Promise.all(
        typedNgans.map(async (ngan) => {
          const trips = await loadDispatchTripsByUids(
            ord.factory_id,
            Array.isArray(ngan.trips) ? ngan.trips : [],
            {
              fromDate: typeof ngan.ngay_bd === "string" ? ngan.ngay_bd : undefined,
              toDate:
                typeof ngan.ngay_kt === "string"
                  ? ngan.ngay_kt
                  : typeof ngan.ngay_bd === "string"
                    ? ngan.ngay_bd
                    : undefined,
            },
          )
          return [ngan.id as string, trips] as const
        }),
      )
      const tripsByNganId = new globalThis.Map<string, StorageTripItem[]>(nganTrips)
      const resolvedTrips = [...new globalThis.Map(
        nganTrips
          .flatMap(([, trips]) => trips)
          .map((trip: StorageTripItem) => [trip.ref, trip] as const),
      ).values()]
      const { data: pointRows } = await supabase.from("dispatch_delivery_points")
        .select("ma_lo, lat, lng, doi, phien_a, phien_b, phien_c, phien_d")
        .eq("factory_id", ord.factory_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("ma_lo", { ascending: true })
      const deliveryPoints = normalizeDeliveryPoints(pointRows) || DIEM_GN

      const extractPlots = (trip: Pick<StorageTripItem, "lo_thu_hoach" | "diem_gn" | "phien">): string[] =>
        trip.lo_thu_hoach.length
          ? trip.lo_thu_hoach
          : buildLoThuHoach(trip.diem_gn, trip.phien, deliveryPoints)

      const diemGn = new Set<string>()
      let matchedRows = resolvedTrips.length
      for (const trip of resolvedTrips) {
        extractPlots(trip).forEach((code) => diemGn.add(code))
      }

      // Fallback cuối: khi trip tokens cũ không resolve được → dùng khoảng ngày ngăn
      let usedDateFallback = false
      if (matchedRows === 0 && allTripUids.size > 0) {
        usedDateFallback = true
        const dispatches = await loadDispatchEntriesWithResolvedRows(supabase, {
          factoryId: ord.factory_id,
          select: "id,ngay,rows",
          ascending: true,
        })
        const today = new Date().toISOString().split("T")[0]
        for (const ngan of typedNgans) {
          if (!ngan.ngay_bd) continue
          const bd = ngan.ngay_bd
          const kt = ngan.ngay_kt || today
          for (const dispatch of dispatches) {
            const dn = String(dispatch.ngay || "")
            if (dn >= bd && dn <= kt) {
              for (const row of dispatch.rows || []) {
                matchedRows++
                const fallbackTrip = {
                  lo_thu_hoach: Array.isArray(row.lo_thu_hoach) ? row.lo_thu_hoach.map((item: unknown) => String(item || "")) : [],
                  diem_gn: Array.isArray(row.diem_gn) ? row.diem_gn.map((item: unknown) => String(item || "")) : [],
                  phien: Array.isArray(row.phien) ? row.phien.map((item: unknown) => String(item || "")) : [],
                }
                extractPlots(fallbackTrip).forEach((c:string) => diemGn.add(c))
              }
            }
          }
        }
      }
      setDiemGnSet(diemGn)

      // Build extraction date map: lot_id → ngày điều xe sớm nhất của ngăn
      const edMap: Record<string,string> = {}
      for (const lot of typedLots) {
        const ngan = typedNgans.find((item) => item.id === lot.ngan_id)
        if (!ngan) continue
        const tripDates = (tripsByNganId.get(ngan.id) || [])
          .map((trip: StorageTripItem) => trip._date)
          .filter(Boolean)
          .sort()
        edMap[lot.id] = tripDates[0] || ngan.ngay_bd || ""
      }
      setExtractionDates(edMap)

      // 4. Lấy polygon lô vườn và ghép metadata đầy đủ từ GeoJSON chuẩn
      const tenList = [...diemGn]
      const fullResponse = await fetch("/geojson/Lo cao su - 2026_Full.geojson")
      const full: FeatureCollection | null = fullResponse.ok ? await fullResponse.json() : null
      const staticPlotMap = buildStaticPlotFeatureMap(full)

      const { data: plotRows } = tenList.length
        ? await supabase
            .from("forest_plots")
            .select("ten, ma_lo_full, geometry, nong_truong, doi, giong, dien_tich_ha, nam_trong, nam_cao_up")
            .eq("factory_id", ord.factory_id)
            .eq("is_active", true)
            .in("ten", tenList)
        : { data: null }

      const dbPlotMap = new globalThis.Map(
        ((plotRows || []) as ForestPlotRow[]).map((plot) => [plot.ten, plot] as const),
      )

      const filteredFeatures = tenList.reduce<FeatureCollection["features"]>((acc, plotCode) => {
        const dbPlot = dbPlotMap.get(plotCode)
        const staticPlot = staticPlotMap.get(plotCode)
        const geometry =
          (dbPlot?.geometry as FeatureCollection["features"][number]["geometry"] | undefined) ||
          staticPlot?.geometry

        if (!geometry) return acc

        acc.push({
          type: "Feature",
          properties: mergePlotProperties(plotCode, dbPlot, staticPlot),
          geometry,
        })

        return acc
      }, [])

      const filtered: FeatureCollection = {
        type: "FeatureCollection",
        features: filteredFeatures,
      }

      setTraceInfo({ lots: typedLots.length, ngans: nganIds.length, tripUids: allTripUids.size, matchedRows, diemGn: diemGn.size, features: filtered.features.length, fallback: usedDateFallback })
      setGeoData(filtered)
    } catch (e) {
      console.error(e)
    }
    setLoadingGeo(false)
  }

  // ── Upload file ───────────────────────────────────────────────────────────
  /*
    if (!order || !factoryId) return
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    const previousFiles = normalizeExportOrderFiles(order.files)
    const newFiles = [...previousFiles]
    const selectedUploadFiles = toSelectedFileDebugRows(files, "selected-for-upload")
    const uploadResults: AttachmentDebugRow[] = []
    const uploadErrors: string[] = []
    for (const file of files) {
      const path = `${factoryId}/${order.ma_don}/${Date.now()}_${file.name}`
      const { data, error } = await supabase.storage.from("eudr-files").upload(path, file, { upsert: true })
      if (error) { showToast(`Lỗi: ${error.message}`, false); continue }
      const { data: urlData } = supabase.storage.from("eudr-files").getPublicUrl(data.path)
      newFiles.push({ name: file.name, url: urlData.publicUrl, path: data.path, size: file.size })
    }
    const normalizedNewFiles = normalizeExportOrderFiles(newFiles)
    const { error } = await supabase.from("export_orders").update({ files: normalizedNewFiles }).eq("id", order.id)
    if (error) { showToast(error.message, false) } else {
      const dbAfterUpload = await fetchLatestOrderFiles(order.id).catch((fetchError: unknown) => {
        console.error("Failed to reload export order files right after upload", fetchError)
        return []
      })
      const effectiveFiles = dbAfterUpload.length > 0 || normalizedNewFiles.length === 0
        ? mergeExportOrderFiles(dbAfterUpload, normalizedNewFiles)
        : normalizedNewFiles

      setAttachmentDebug({
        stage: "after-upload",
        updatedAt: new Date().toISOString(),
        orderId: order.id,
        orderCode: order.ma_don,
        selectedUploadFiles,
        currentFiles: toAttachmentDebugRows(previousFiles, "state-before-upload"),
        latestFiles: [],
        filesForZip: [],
        uploadFiles: toAttachmentDebugRows(normalizedNewFiles, "upload-payload"),
        uploadResults,
        dbAfterUpload: toAttachmentDebugRows(dbAfterUpload, "db-after-upload"),
        attachmentResults: [],
        uploadErrors,
        attachmentErrors: [],
        note: dbAfterUpload.length !== normalizedNewFiles.length
          ? "So luong file trong DB sau upload khac voi payload vua save."
          : "DB da tra ve cung so luong file voi payload vua save.",
      })
      setShowAttachmentDebug(true)

      console.info("EUDR upload verification", {
        orderId: order.id,
        orderCode: order.ma_don,
        previousFiles,
        normalizedNewFiles,
        dbAfterUpload,
        effectiveFiles,
      })
      setOrder(prev => prev ? { ...prev, files: effectiveFiles } : prev)
      if (dbAfterUpload.length !== normalizedNewFiles.length) {
        console.warn("EUDR upload DB mismatch after save", {
          orderId: order.id,
          orderCode: order.ma_don,
          normalizedNewFiles,
          dbAfterUpload,
        })
        showToast(`Upload xong nhung DB dang tra ve ${dbAfterUpload.length}/${normalizedNewFiles.length} file. Xem panel debug.`, false)
      }
      showToast(`Đã đính kèm ${files.length} file`)
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // ── Delete attached file ──────────────────────────────────────────────────
  */
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!order || !factoryId) return
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    setUploading(true)
    const previousFiles = normalizeExportOrderFiles(order.files)
    const newFiles = [...previousFiles]
    const selectedUploadFiles = toSelectedFileDebugRows(files, "selected-for-upload")
    const uploadResults: AttachmentDebugRow[] = []
    const uploadErrors: string[] = []

    for (const file of files) {
      try {
        const uploaded = await uploadEudrFile({ factoryId, orderCode: order.ma_don, file })
        newFiles.push({ name: uploaded.name, url: uploaded.url, path: uploaded.path, size: uploaded.size })
        uploadResults.push({
          index: uploadResults.length,
          name: uploaded.name,
          url: uploaded.url,
          path: uploaded.path,
          resolvedPath: uploaded.path,
          size: uploaded.size,
          source: uploaded.source === "client" ? "upload-result" : "upload-result-server-fallback",
          downloadStatus: "ok",
          downloadError: null,
          blobSize: uploaded.size,
          zipEntryName: null,
        })
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : "Unknown upload error"
        const path = buildEudrStoragePath(factoryId, order.ma_don, file.name)
        uploadErrors.push(`${file.name}: ${message}`)
        uploadResults.push({
          index: uploadResults.length,
          name: file.name,
          url: "",
          path,
          resolvedPath: path,
          size: file.size,
          source: "upload-result",
          downloadStatus: "error",
          downloadError: message,
          blobSize: null,
          zipEntryName: null,
        })
        console.error("EUDR upload failed before DB save", { fileName: file.name, path, error: uploadError })
      }
    }

    const normalizedNewFiles = normalizeExportOrderFiles(newFiles)
    const { error } = await supabase.from("export_orders").update({ files: normalizedNewFiles }).eq("id", order.id)

    if (error) {
      showToast(error.message, false)
    } else {
      const dbAfterUpload = await fetchLatestOrderFiles(order.id).catch((fetchError: unknown) => {
        console.error("Failed to reload export order files right after upload", fetchError)
        return []
      })
      const effectiveFiles = dbAfterUpload.length > 0 || normalizedNewFiles.length === 0
        ? mergeExportOrderFiles(dbAfterUpload, normalizedNewFiles)
        : normalizedNewFiles
      const successfulUploads = uploadResults.filter(row => row.downloadStatus === "ok").length

      setAttachmentDebug({
        stage: "after-upload",
        updatedAt: new Date().toISOString(),
        orderId: order.id,
        orderCode: order.ma_don,
        selectedUploadFiles,
        currentFiles: toAttachmentDebugRows(previousFiles, "state-before-upload"),
        latestFiles: [],
        filesForZip: [],
        uploadFiles: toAttachmentDebugRows(normalizedNewFiles, "upload-payload"),
        uploadResults,
        dbAfterUpload: toAttachmentDebugRows(dbAfterUpload, "db-after-upload"),
        attachmentResults: [],
        uploadErrors,
        attachmentErrors: [],
        note:
          successfulUploads === 0
            ? "Khong co file nao upload thanh cong len storage. Kiem tra bang 'Ket qua upload tung file'."
            : dbAfterUpload.length !== normalizedNewFiles.length
              ? "So luong file trong DB sau upload khac voi payload vua save."
              : "DB da tra ve cung so luong file voi payload vua save.",
      })
      setShowAttachmentDebug(true)

      console.info("EUDR upload verification", {
        orderId: order.id,
        orderCode: order.ma_don,
        previousFiles,
        selectedUploadFiles,
        uploadResults,
        uploadErrors,
        normalizedNewFiles,
        dbAfterUpload,
        effectiveFiles,
      })

      setOrder(prev => prev ? { ...prev, files: effectiveFiles } : prev)

      if (successfulUploads === 0) {
        showToast("Khong co file nao upload thanh cong. Xem panel debug.", false)
      } else if (dbAfterUpload.length !== normalizedNewFiles.length) {
        console.warn("EUDR upload DB mismatch after save", {
          orderId: order.id,
          orderCode: order.ma_don,
          normalizedNewFiles,
          dbAfterUpload,
        })
        showToast(`Upload xong nhung DB dang tra ve ${dbAfterUpload.length}/${normalizedNewFiles.length} file. Xem panel debug.`, false)
      } else if (successfulUploads < files.length) {
        showToast(`Chi upload thanh cong ${successfulUploads}/${files.length} file. Xem panel debug.`, false)
      } else {
        showToast(`Da dinh kem ${successfulUploads} file`)
      }
    }

    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleDeleteFile = async (url: string) => {
    if (!order) return
    const newFiles = normalizeExportOrderFiles(order.files).filter(f => f.url !== url)
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
    } catch (error: unknown) {
      showToast("Lỗi tạo PDF: " + (error instanceof Error ? error.message : "Unknown error"), false)
    }
  }

  // ── Download all (zip) ────────────────────────────────────────────────────
  const handleDownloadAll = async () => {
    if (!order) return
    if (!factory) {
      showToast("Chưa có thông tin công ty để tạo 2 file DDS.", false)
      return
    }
    setDownloading(true)
    const zip = new JSZip()
    const folder = zip.folder(order.ma_don) || zip
    const usedEntryNames = new Set<string>()

    try {
      const { generateDDS1, generateDDS2 } = await import("./dds-generator")
      const plantationName = `${order.ma_don}_DDS_Plantation.pdf`
      const shipmentName = `${order.ma_don}_DDS_Shipment.pdf`
      const geojsonName = `${order.ma_don}_supply_chain.geojson`

      usedEntryNames.add(plantationName)
      usedEntryNames.add(shipmentName)
      usedEntryNames.add(geojsonName)

      folder.file(plantationName, await generateDDS1(order, geoData, factory, lotCertMap))
      folder.file(shipmentName, await generateDDS2(order, lotDetails, extractionDates, factory))

      if (geoData) {
        folder.file(geojsonName, JSON.stringify(geoData, null, 2))
      }

      const currentFiles = normalizeExportOrderFiles(order.files)
      const latestFiles = await fetchLatestOrderFiles(order.id).catch((error: unknown) => {
        console.error("Failed to refresh export order files before ZIP download", error)
        return currentFiles
      })
      const filesForZip = mergeExportOrderFiles(
        latestFiles.length >= currentFiles.length ? latestFiles : currentFiles,
        latestFiles.length >= currentFiles.length ? currentFiles : latestFiles,
      )

      setAttachmentDebug({
        stage: "before-zip",
        updatedAt: new Date().toISOString(),
        orderId: order.id,
        orderCode: order.ma_don,
        selectedUploadFiles: attachmentDebug.selectedUploadFiles,
        currentFiles: toAttachmentDebugRows(currentFiles, "state-before-zip"),
        latestFiles: toAttachmentDebugRows(latestFiles, "db-before-zip"),
        filesForZip: toAttachmentDebugRows(filesForZip, "zip-input"),
        uploadFiles: attachmentDebug.uploadFiles,
        uploadResults: attachmentDebug.uploadResults,
        dbAfterUpload: attachmentDebug.dbAfterUpload,
        attachmentResults: [],
        uploadErrors: attachmentDebug.uploadErrors,
        attachmentErrors: [],
        note: "Snapshot truoc khi tao ZIP.",
      })
      setShowAttachmentDebug(true)

      console.info("EUDR ZIP file snapshot", {
        orderId: order.id,
        orderCode: order.ma_don,
        currentFiles,
        latestFiles,
        filesForZip,
      })

      if (latestFiles.length !== currentFiles.length) {
        console.warn("EUDR attachment count mismatch between DB refresh and client state", {
          orderId: order.id,
          currentFiles,
          latestFiles,
          filesForZip,
        })
      }

      const attachmentErrors: string[] = []
      const attachmentResults: AttachmentDebugRow[] = []

      // Uploaded files are extra attachments outside the 2 DDS PDFs.
      for (const [index, f] of filesForZip.entries()) {
        const storagePath = f.path || resolveEudrStoragePath(f.url)
        try {
          let fileBlob: Blob | null = null

          console.info("EUDR ZIP attachment start", {
            index,
            name: f.name,
            url: f.url,
            path: f.path ?? null,
            resolvedPath: storagePath,
            size: f.size ?? null,
          })

          if (storagePath) {
            const { data, error } = await supabase.storage.from("eudr-files").download(storagePath)
            console.info("EUDR ZIP storage.download result", {
              index,
              name: f.name,
              path: storagePath,
              hasData: Boolean(data),
              blobSize: data?.size ?? null,
              error: error?.message ?? null,
            })
            if (error) throw error
            fileBlob = data
          } else {
            const res = await fetch(f.url)
            console.info("EUDR ZIP fetch fallback result", {
              index,
              name: f.name,
              url: f.url,
              ok: res.ok,
              status: res.status,
              statusText: res.statusText,
            })
            if (!res.ok) {
              throw new Error(`HTTP ${res.status} ${res.statusText}`.trim())
            }
            fileBlob = await res.blob()
          }

          if (!fileBlob || fileBlob.size <= 0) {
            throw new Error("Downloaded attachment is empty")
          }

          const entryName = getUniqueZipEntryName(f.name, usedEntryNames)
          folder.file(entryName, fileBlob)
          attachmentResults.push({
            index,
            name: f.name,
            url: f.url,
            path: f.path ?? null,
            resolvedPath: storagePath,
            size: typeof f.size === "number" ? f.size : null,
            source: "zip-result",
            downloadStatus: "ok",
            downloadError: null,
            blobSize: fileBlob.size,
            zipEntryName: entryName,
          })
          console.info("EUDR ZIP attachment added", {
            index,
            name: f.name,
            path: storagePath,
            blobSize: fileBlob.size,
            zipEntryName: entryName,
          })
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : "Unknown error"
          const label = f.name || f.url || "Unnamed attachment"
          attachmentErrors.push(`${label}: ${reason}`)
          attachmentResults.push({
            index,
            name: f.name,
            url: f.url,
            path: f.path ?? null,
            resolvedPath: storagePath,
            size: typeof f.size === "number" ? f.size : null,
            source: "zip-result",
            downloadStatus: "error",
            downloadError: reason,
            blobSize: null,
            zipEntryName: null,
          })
          console.error("Failed to add EUDR attachment to ZIP", { file: f, error })
        }
      }

      setAttachmentDebug({
        stage: "after-zip",
        updatedAt: new Date().toISOString(),
        orderId: order.id,
        orderCode: order.ma_don,
        selectedUploadFiles: attachmentDebug.selectedUploadFiles,
        currentFiles: toAttachmentDebugRows(currentFiles, "state-before-zip"),
        latestFiles: toAttachmentDebugRows(latestFiles, "db-before-zip"),
        filesForZip: toAttachmentDebugRows(filesForZip, "zip-input"),
        uploadFiles: attachmentDebug.uploadFiles,
        uploadResults: attachmentDebug.uploadResults,
        dbAfterUpload: attachmentDebug.dbAfterUpload,
        attachmentResults,
        uploadErrors: attachmentDebug.uploadErrors,
        attachmentErrors,
        note: "Ket qua sau khi thu add tung file dinh kem vao ZIP.",
      })
      setShowAttachmentDebug(true)

      const blob = await zip.generateAsync({ type: "blob" })
      saveAs(blob, `EUDR_${order.ma_don}.zip`)
      if (attachmentErrors.length > 0) {
        showToast(`ZIP thiếu ${attachmentErrors.length} file đính kèm. Xem console để biết chi tiết.`, false)
      } else if (filesForZip.length === 0) {
        showToast("ZIP chỉ có 2 DDS và GeoJSON vì hệ thống chưa thấy file đính kèm nào trên đơn này.", false)
      } else {
        showToast(`Đã tải gộp 2 DDS, GeoJSON và ${filesForZip.length} file đính kèm`)
      }
    } catch (error: unknown) {
      showToast("Lỗi: " + (error instanceof Error ? error.message : "Unknown error"), false)
    }
    setDownloading(false)
  }

  // ── GeoJSON style ─────────────────────────────────────────────────────────
  const geoStyle = useCallback((feature?: Feature) => {
    const team = feature?.properties?.Doi_2026 ?? "0"
    return { fillColor: TEAM_COLORS[String(team)] ?? "#6b7280", weight: 1.5, color: "#fff", fillOpacity: 0.7 }
  }, [])

  const onEachFeature = useCallback((feature: Feature, layer: L.Layer) => {
    const p = (feature.properties || {}) as EudrPlotProperties
    const plotName = toDisplayText(p.Ten || p.Ma_lo_2026 || p.Ma_lo, "?")
    const areaText = toDisplayNumber(p.Dtich2026_ha, 2)
    const teamText = toDisplayText(p.Doi_2026)
    const varietyText = toDisplayText(p.Giong)
    const plantationText = toDisplayText(p.Nong_truong)
    layer.bindTooltip(
      `<div style="font-size:12px;font-weight:600">${plotName}</div>
       <div style="font-size:11px;color:#666">Đội ${teamText} · ${varietyText} · ${areaText} ha</div>`,
      { sticky: true, className: "lot-tooltip" },
    )
    layer.bindPopup(`
      <div class="text-xs leading-5">
        <div class="font-bold text-slate-800 mb-1">${plotName}</div>
        <div>Nông trường: <strong>${plantationText}</strong></div>
        <div>Đội: <strong>${teamText}</strong></div>
        <div>Diện tích: <strong>${areaText} ha</strong></div>
        <div>Giống: <strong>${varietyText}</strong></div>
        <div>Năm trồng: <strong>${toDisplayText(p.Nam_trong)}</strong></div>
        <div>Năm mở cạo: <strong>${toDisplayText(p.Nam_mo_cao)}</strong></div>
      </div>
    `, { maxWidth: 240 })
    layer.on("click", () => setSelectedPlot(p))
    /* legacy popup
    layer.bindPopup(`
      <div class="text-xs leading-5">
        <div class="font-bold text-slate-800 mb-1">${p.Ma_lo_2026 ?? p.Ma_lo ?? "?"}</div>
        <div>Đội: <strong>${p.Doi_2026 ?? "—"}</strong></div>
        <div>Diện tích: <strong>${p.Dtich2026_ha ?? "—"} ha</strong></div>
        <div>Giống: <strong>${p.Giong ?? "—"}</strong></div>
        <div>Năm trồng: <strong>${p.Nam_trong ?? "—"}</strong></div>
      </div>
    `, { maxWidth: 220 }) */
  }, [])

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
        {notFound && <div className="mt-2 text-sm text-red-500 flex items-center gap-2"><AlertTriangle size={14}/> Không tìm thấy đơn hàng &quot;{query}&quot;</div>}
      </div>

      {/* Main content */}
      {order && (
        <div className="flex flex-col lg:flex-row gap-4" style={{ height: "calc(100vh - 260px)" }}>
          {/* LEFT: Info + Files */}
          <div className="w-full lg:w-80 shrink-0 overflow-y-auto space-y-4 max-h-64 lg:max-h-none lg:h-full">

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
                {DDS_FILES.map(f => (
                  <div key={f.n} className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                    <FileText size={13} className="text-blue-500 shrink-0"/>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-700 truncate">{`${order.ma_don}_DDS_${f.suffix}.pdf`}</div>
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
                    {uploading ? <><Loader2 size={13} className="animate-spin"/> Đang tải lên...</> : <><Upload size={13}/> Đính kèm file ngoài 2 DDS</>}
                  </button>
                </div>
              </div>
            </div>

            {EUDR_DEBUG_ENABLED && (
            <div className="bg-slate-950 text-slate-100 rounded-xl border border-slate-800 shadow-md overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Package size={15} className="text-amber-300"/>
                    <span className="font-bold text-sm">Debug file dinh kem EUDR</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Stage: <span className="text-slate-200">{attachmentDebug.stage}</span> · Updated: <span className="text-slate-200">{formatAttachmentDebugTimestamp(attachmentDebug.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={refreshAttachmentDebug}
                    disabled={!order}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-[11px] font-semibold hover:bg-slate-800 disabled:opacity-50"
                  >
                    Lam moi DB
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(JSON.stringify(attachmentDebug, null, 2))
                        showToast("Da copy debug JSON")
                      } catch (error: unknown) {
                        console.error("Failed to copy EUDR debug JSON", error)
                        showToast("Khong copy duoc debug JSON.", false)
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-[11px] font-semibold hover:bg-slate-800"
                  >
                    Copy JSON
                  </button>
                  <button
                    onClick={() => setShowAttachmentDebug(prev => !prev)}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-[11px] font-bold hover:bg-amber-300"
                  >
                    {showAttachmentDebug ? "An panel" : "Mo panel"}
                  </button>
                </div>
              </div>

              {showAttachmentDebug && (
                <div className="p-3 space-y-3 text-[11px]">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2">
                      <div className="text-slate-400">File da chon</div>
                      <div className="text-lg font-bold">{attachmentDebug.selectedUploadFiles.length}</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2">
                      <div className="text-slate-400">State hien tai</div>
                      <div className="text-lg font-bold">{attachmentDebug.currentFiles.length}</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2">
                      <div className="text-slate-400">DB moi nhat</div>
                      <div className="text-lg font-bold">{attachmentDebug.latestFiles.length || attachmentDebug.dbAfterUpload.length}</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2">
                      <div className="text-slate-400">Ket qua upload</div>
                      <div className="text-lg font-bold">{attachmentDebug.uploadResults.length}</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2">
                      <div className="text-slate-400">Input tao ZIP</div>
                      <div className="text-lg font-bold">{attachmentDebug.filesForZip.length}</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2">
                      <div className="text-slate-400">Ket qua add ZIP</div>
                      <div className="text-lg font-bold">{attachmentDebug.attachmentResults.length}</div>
                    </div>
                  </div>

                  {attachmentDebug.note && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-100">
                      {attachmentDebug.note}
                    </div>
                  )}

                  {[
                    { title: "File da chon upload", rows: attachmentDebug.selectedUploadFiles },
                    { title: "Payload sau upload", rows: attachmentDebug.uploadFiles },
                    { title: "Ket qua upload tung file", rows: attachmentDebug.uploadResults },
                    { title: "DB sau upload", rows: attachmentDebug.dbAfterUpload },
                    { title: "State truoc ZIP", rows: attachmentDebug.currentFiles },
                    { title: "DB truoc ZIP", rows: attachmentDebug.latestFiles },
                    { title: "Files dua vao ZIP", rows: attachmentDebug.filesForZip },
                    { title: "Ket qua tung attachment", rows: attachmentDebug.attachmentResults },
                  ].map(section => (
                    <div key={section.title} className="rounded-xl border border-slate-800 overflow-hidden">
                      <div className="px-3 py-2 bg-slate-900 font-semibold text-slate-200">
                        {section.title} ({section.rows.length})
                      </div>
                      <div className="divide-y divide-slate-800">
                        {section.rows.length === 0 ? (
                          <div className="px-3 py-2 text-slate-500">Chua co du lieu.</div>
                        ) : section.rows.map(row => (
                          <div key={`${section.title}-${row.index}-${row.url}`} className="px-3 py-2 space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-100 break-all">{row.name || "(khong ten)"}</div>
                                <div className="text-slate-400 break-all">{row.url}</div>
                              </div>
                              <div className={`shrink-0 rounded-full border px-2 py-0.5 ${getAttachmentDebugBadgeTone(row.downloadStatus)}`}>
                                {row.downloadStatus || row.source}
                              </div>
                            </div>
                            <div className="text-slate-400 break-all">
                              path: {row.path || "(rong)"} | resolved: {row.resolvedPath || "(khong resolve)"} | size: {row.size ?? "?"} | blob: {row.blobSize ?? "?"} | zip: {row.zipEntryName || "(chua add)"}
                            </div>
                            {row.downloadError && (
                              <div className="text-red-300 break-all">error: {row.downloadError}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {attachmentDebug.uploadErrors.length > 0 && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
                      <div className="font-semibold text-red-200 mb-1">Loi upload ({attachmentDebug.uploadErrors.length})</div>
                      <div className="space-y-1 text-red-100">
                        {attachmentDebug.uploadErrors.map((error, index) => (
                          <div key={`${error}-${index}`} className="break-all">{error}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {attachmentDebug.attachmentErrors.length > 0 && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
                      <div className="font-semibold text-red-200 mb-1">Loi khi add ZIP ({attachmentDebug.attachmentErrors.length})</div>
                      <div className="space-y-1 text-red-100">
                        {attachmentDebug.attachmentErrors.map((error, index) => (
                          <div key={`${error}-${index}`} className="break-all">{error}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </div>

          {/* RIGHT: Map */}
          {/* isolate: chặn z-index nội bộ của Leaflet (control z-1000, pane 200-700) tràn lên trên sidebar/backdrop mobile (z-40/z-50) */}
          <div className="flex-1 min-h-[280px] rounded-xl overflow-hidden border border-slate-200 shadow-md relative isolate">
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
              <MapResizeFix />
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
            {selectedPlot && (
              <div className="absolute top-4 right-4 z-[400] w-80 max-w-[calc(100%-2rem)] bg-white/95 backdrop-blur rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="text-lg font-black text-slate-800">{toDisplayText(selectedPlot.Ten || selectedPlot.Ma_lo_2026 || selectedPlot.Ma_lo)}</div>
                    <div className="text-xs text-slate-500 font-mono">{toDisplayText(selectedPlot.ma_lo_full || selectedPlot.Ma_lo_2026 || selectedPlot.Ma_lo)}</div>
                  </div>
                  <button onClick={() => setSelectedPlot(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                    <X size={16} />
                  </button>
                </div>
                <div className="p-3 space-y-2 text-sm max-h-[70vh] overflow-y-auto">
                  {[
                    { label: "Đội", value: `Đội ${toDisplayText(selectedPlot.Doi_2026)}`, icon: Users },
                    { label: "Đội nhỏ", value: toDisplayText(selectedPlot.Doi_nho), icon: Layers3 },
                    { label: "Nông trường", value: toDisplayText(selectedPlot.Nong_truong), icon: Building2 },
                    { label: "Giống", value: toDisplayText(selectedPlot.Giong), icon: Sprout },
                    { label: "Diện tích", value: `${toDisplayNumber(selectedPlot.Dtich2026_ha, 2)} ha`, icon: Ruler },
                    { label: "Năm trồng", value: toDisplayText(selectedPlot.Nam_trong), icon: CalendarDays },
                    { label: "Năm mở cạo", value: toDisplayText(selectedPlot.Nam_mo_cao), icon: CalendarDays },
                    { label: "Tuổi cạo", value: selectedPlot.Tuoi_cao ? `${toDisplayText(selectedPlot.Tuoi_cao)} năm` : "—", icon: Route },
                    { label: "Tổng cây KK", value: toDisplayNumber(selectedPlot.Tong_so_cay_KK), icon: Trees },
                    { label: "Mặt cạo", value: toDisplayText(selectedPlot.Mat_cao_2026), icon: FileText },
                    { label: "Chế độ cạo", value: toDisplayText(selectedPlot.CD_cao_2026), icon: Package },
                    { label: "Hạng đất", value: toDisplayText(selectedPlot.Hang_dat), icon: Map },
                    { label: "Khoảng cách", value: toDisplayText(selectedPlot.Khoang_cach_m), icon: Ruler },
                    { label: "Cao trình", value: (selectedPlot.Cao_trinh_min_m || selectedPlot.Cao_trinh_max_m) ? `${toDisplayText(selectedPlot.Cao_trinh_min_m)}-${toDisplayText(selectedPlot.Cao_trinh_max_m)} m` : "—", icon: Mountain },
                    { label: "Tọa độ", value: (selectedPlot.ToadoY || selectedPlot.ToadoX) ? `${toDisplayText(selectedPlot.ToadoY)}, ${toDisplayText(selectedPlot.ToadoX)}` : "—", icon: MapPin },
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
