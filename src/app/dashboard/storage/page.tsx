"use client"
import Link from "next/link"
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { loadRequiredNotes } from "@/lib/required-notes"
import { EMPTY_NOTE_FILTER, matchesNoteFilter, matchesNoteFilterMulti } from "@/lib/note-filter"
import { InventoryQrCard } from "@/app/dashboard/inventory/_components/inventory-qr-card"
import { RequiredNoteSelect } from "@/app/dashboard/_components/required-note-select"
import { KpiLinkPrompt } from "@/app/dashboard/_components/kpi-link-prompt"
import { loadDispatchEntriesWithResolvedRows } from "@/lib/dispatch-entry-rows"
import {
  addDaysISO,
  buildDispatchTripRef,
  buildStorageLookupPath,
  formatStorageDate,
  getKLFromTrip,
  loadDispatchTripsByDateRange,
  loadDispatchTripsByUids,
  loadStorageDetail,
  loadStorageGeoJson,
  loadStorageLots,
  loadStorageLotsByNgans,
  resolveStorageNgansActualTotals,
  summarizeStorageLots,
  toISODate,
  type StorageNgan as Ngan,
  type StorageProducedLot as ProducedLot,
  type StorageTripItem as TripItem,
} from "@/lib/storage-detail"
import {
  canManuallyMoveClosedToWaiting,
  deriveStorageStatus,
  getStorageAgingDays,
  normalizeStorageStatus,
  STORAGE_STATUS_CLOSED,
  STORAGE_STATUS_IN_PRODUCTION,
  STORAGE_STATUS_PRODUCED,
  STORAGE_STATUS_RECEIVING,
  STORAGE_STATUS_WAITING,
} from "@/lib/storage-status"
import { downloadStorageBulkQrPdf, downloadStorageDetailPdf, downloadStoragePeriodReportPdf } from "@/lib/storage-pdf"
import { DateTextInput } from "@/app/dashboard/_components/date-text-input"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { isDateInRange, normalizeDateInput } from "@/lib/date-utils"
import {
  Warehouse, Plus, X, Search, Eye, Edit2, Minus, History,
  Tag, Layers, MapPin, ShieldCheck, Weight, BarChart2, Activity, Droplets, Truck, FileText, QrCode,
  ChevronDown, ChevronRight, Map as MapIcon, Check, Printer, RefreshCw, Trash2
} from "lucide-react"

// ─── Constants ────────────────────────────────────────────────────────────────
const ALL_POSITIONS = [
  "N1","N2","N3","N4","N5","N6","N7","N8","N9","N10",
  "N11","N12","N13","N14","N15","N16","N17","N18","N19","N20",
  "N21","N22","N23","N24"
]

const NGUON_GOC_OPTS  = ["NT","M","GCA"]
const XU_LY_OPTS      = ["Xé","Không xé","Hỗn hợp"]
const CHUNG_NHAN_BASE = ["PEFC CS","PEFC FM","Không"]
const TRANG_THAI_OPTS = [
  STORAGE_STATUS_RECEIVING,
  STORAGE_STATUS_CLOSED,
  STORAGE_STATUS_WAITING,
  STORAGE_STATUS_IN_PRODUCTION,
  STORAGE_STATUS_PRODUCED,
]

const NL_ABBR: Record<string, string> = {
  "Mủ chén": "MC", "Mủ đông chén": "ĐC", "Mủ đông khối": "ĐK",
  "Mủ dây": "MD",  "Mủ dơ": "MDơ",       "Mủ tạp": "MT", "Mủ nước": "MN"
}

const loaiNLByDC = (dc: string, fCode: string): string[] => {
  if (dc === "Mủ nước") return ["Mủ nước"]
  const base = ["Mủ chén","Mủ đông chén","Mủ đông khối","Mủ dây","Mủ tạp"]
  return fCode === "cuaparis" ? [...base, "Mủ dơ"] : base
}

const emptyForm = (loaiNL = "Mủ đông chén") => ({
  ma_ngan: "", ten_ngan: "",
  loai_nl: loaiNL, nguon_goc: "NT",
  xu_ly: "Xé", chung_nhan: "PEFC CS",
  ngay_bd: new Date().toISOString().slice(0, 10),
  ngay_kt: "",
  xe_tu_ngay: addDaysISO(new Date().toISOString().slice(0, 10), 1),
  xe_den_ngay: "",
  trang_thai: STORAGE_STATUS_RECEIVING,
  tong_tuoi: 0, tong_kho: 0,
  lo_nguon_goc: "",
  ghi_chu: "",
})

type StorageForm = ReturnType<typeof emptyForm>

const headerStyle = (tt: string) => {
  if (tt === STORAGE_STATUS_IN_PRODUCTION) return { grad: "from-emerald-50 to-teal-50", icon: "text-emerald-600" }
  if (tt === STORAGE_STATUS_PRODUCED) return { grad: "from-blue-50 to-cyan-50", icon: "text-blue-600" }
  if (tt === STORAGE_STATUS_WAITING) return { grad: "from-amber-50 to-yellow-50", icon: "text-amber-500" }
  if (tt === STORAGE_STATUS_CLOSED) return { grad: "from-rose-50 to-orange-50", icon: "text-rose-500" }
  if (tt === STORAGE_STATUS_RECEIVING) return { grad: "from-slate-50 to-gray-100", icon: "text-slate-400" }
  return { grad: "from-slate-50 to-gray-100", icon: "text-slate-400" }
}

const badgeClass = (tt: string) => {
  if (tt === STORAGE_STATUS_IN_PRODUCTION) return "bg-emerald-100 text-emerald-700"
  if (tt === STORAGE_STATUS_PRODUCED) return "bg-blue-100 text-blue-700"
  if (tt === STORAGE_STATUS_WAITING) return "bg-amber-100 text-amber-700"
  if (tt === STORAGE_STATUS_CLOSED) return "bg-rose-100 text-rose-700"
  if (tt === STORAGE_STATUS_RECEIVING) return "bg-slate-100 text-slate-500"
  return "bg-slate-100 text-slate-600"
}

const genMaNgan = (f: ReturnType<typeof emptyForm>) => {
  const xlAbbr = f.xu_ly === "Xé" ? "X" : f.xu_ly === "Không xé" ? "KX" : "HH"
  const fmt = (d: string) =>
    d ? new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "2-digit" }) : ""
  return [f.ten_ngan, f.nguon_goc, NL_ABBR[f.loai_nl] || "", xlAbbr, fmt(f.ngay_bd), fmt(f.ngay_kt)]
    .filter(Boolean).join("-")
}

const fmtDate = formatStorageDate
const fmtKg = (kg: number) => `${Math.round(kg || 0).toLocaleString("vi-VN")} kg`
const safeDownloadName = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9_-]+/g, "-")
  .replace(/^-+|-+$/g, "")

const mergeTripsByUid = (...tripGroups: TripItem[][]): TripItem[] => {
  const byUid = new Map<string, TripItem>()
  for (const trips of tripGroups) {
    for (const trip of trips) {
      if (!trip.ref) continue
      byUid.set(trip.ref, trip)
    }
  }
  return Array.from(byUid.values()).sort((a, b) =>
    a._date.localeCompare(b._date) ||
    a.so_xe.localeCompare(b.so_xe, "vi", { numeric: true, sensitivity: "base" }) ||
    a.chuyen - b.chuyen,
  )
}

type DispatchEntryRowLite = {
  uid?: string
  row_id?: string
  _date?: string
  day_chuyen?: string
  kl_ct?: string | number
  kl_ck?: string | number
  kl_dct?: string | number
  kl_dck?: string | number
  kl_dkt?: string | number
  kl_dkk?: string | number
  kl_dt?: string | number
  kl_dk?: string | number
  kl_mn?: string | number
  kl_mnk?: string | number
}

const hasPositiveWeight = (value: unknown) => Number(value || 0) > 0

const rowMatchesDayChuyen = (row: DispatchEntryRowLite, dayChuyen: "Mủ tạp" | "Mủ nước") => {
  const normalizedDayChuyen = String(row.day_chuyen || "").trim()
  if (dayChuyen === "Mủ nước") {
    return normalizedDayChuyen === "Mủ nước" || hasPositiveWeight(row.kl_mn) || hasPositiveWeight(row.kl_mnk)
  }
  return normalizedDayChuyen === "Mủ tạp" ||
    hasPositiveWeight(row.kl_ct) ||
    hasPositiveWeight(row.kl_ck) ||
    hasPositiveWeight(row.kl_dct) ||
    hasPositiveWeight(row.kl_dck) ||
    hasPositiveWeight(row.kl_dkt) ||
    hasPositiveWeight(row.kl_dkk) ||
    hasPositiveWeight(row.kl_dt) ||
    hasPositiveWeight(row.kl_dk)
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function StoragePage() {
  const revealRef = useScrollReveal()
  const loadDataRequestRef = useRef(0)
  const storageDebugEnabled = process.env.NEXT_PUBLIC_STORAGE_DEBUG === "1"

  // data
  const [ngans, setNgans]               = useState<Ngan[]>([])
  const [lotStats, setLotStats]         = useState<Record<string, number>>({})
  const [loading, setLoading]           = useState(true)
  const [factoryId, setFactoryId]       = useState<string | null>(null)
  const [factoryCode, setFactoryCode]   = useState("")
  const [currentUser, setCurrentUser]   = useState<SessionUser | null>(null)

  // "Gắn bản ghi tại chỗ" — gợi ý gắn ngăn vừa tạo vào công việc KPI đang mở hôm nay
  const [kpiPrompt, setKpiPrompt] = useState<null | { recordId: string; recordLabel: string }>(null)

  // filters
  const [search, setSearch]     = useState("")
  const [filterTT, setFilterTT] = useState("")
  const [nganTab, setNganTab]   = useState<"active" | "history" | "print">("active")
  const [filterGhiChu, setFilterGhiChu] = useState("")
  const [dayChuyen, setDayChuyen] = useState<"Mủ tạp" | "Mủ nước">("Mủ tạp")
  const [requiredNotes, setRequiredNotes] = useState<string[]>([])
  const [reportFrom, setReportFrom] = useState("")
  const [reportTo, setReportTo] = useState("")
  const [reportLoaiNL, setReportLoaiNL] = useState("")

  // modal / form
  const [modal, setModal]         = useState<"add" | "edit" | "view" | null>(null)
  const [form, setForm]           = useState<StorageForm>(emptyForm())
  const [editId, setEditId]       = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [exportingDetailId, setExportingDetailId] = useState<string | null>(null)
  const [exportingGeoId, setExportingGeoId] = useState<string | null>(null)
  const [exportingPeriod, setExportingPeriod] = useState(false)
  const [selectedPrintIds, setSelectedPrintIds] = useState<Set<string>>(new Set())
  const [printingQr, setPrintingQr] = useState(false)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [viewNgan, setViewNgan]   = useState<Ngan | null>(null)
  const [viewLots, setViewLots]   = useState<ProducedLot[]>([])
  const [viewLotsLoading, setViewLotsLoading] = useState(false)
  const [expandedProductKeys, setExpandedProductKeys] = useState<Set<string>>(new Set())
  const [expandedDateKeys, setExpandedDateKeys] = useState<Set<string>>(new Set())
  const [collapsedCardIds, setCollapsedCardIds] = useState<Set<string>>(new Set())
  const [todayMs] = useState(() => Date.now())
  const isAdmin = currentUser?.role === "admin"
  const canViewStorage = hasPermission(currentUser, "storage.view")
  const canCreateStorage = hasPermission(currentUser, "storage.create")
  const canEditStorage = hasPermission(currentUser, "storage.create") || hasPermission(currentUser, "storage.edit")
  const canDeleteStorage = hasPermission(currentUser, "storage.delete")

  // unassigned summary
  const [unassignedSummary, setUnassignedSummary] = useState<{ total: number; byDate: Record<string, number> }>({ total: 0, byDate: {} })

  // trips
  const [linkedTrips, setLinkedTrips]       = useState<TripItem[]>([])
  const [availableTrips, setAvailableTrips] = useState<TripItem[]>([])
  const [selectedTrips, setSelectedTrips]   = useState<Set<string>>(new Set())
  const [loadingTrips, setLoadingTrips]     = useState(false)
  const [tripNoteFilter, setTripNoteFilter] = useState<string[]>([]) // mặc định rỗng = hiển thị tất cả
  const dispatchTrips = useMemo(
    () => mergeTripsByUid(linkedTrips, availableTrips),
    [linkedTrips, availableTrips],
  )
  const visibleTripUidSet = useMemo(
    () => new Set(dispatchTrips.map((trip) => trip.ref).filter(Boolean)),
    [dispatchTrips],
  )
  // Hợp của danh mục required_notes ∪ giá trị lịch sử còn tồn tại trong dữ liệu điều xe —
  // giữ khả năng lọc các chuyến cũ mang ghi chú tự do (trước khi ô Ghi chú của Điều xe
  // chuyển sang dropdown cứng), không chỉ dùng riêng danh mục chuẩn.
  const tripNoteOptions = useMemo(() => {
    const historical = dispatchTrips.map((trip) => trip.ghi_chu.trim()).filter(Boolean)
    return [EMPTY_NOTE_FILTER, ...new Set([...requiredNotes, ...historical])]
  }, [dispatchTrips, requiredNotes])
  const noteFilteredTrips = useMemo(
    () => dispatchTrips.filter((trip) => matchesNoteFilterMulti(trip.ghi_chu, tripNoteFilter)),
    [dispatchTrips, tripNoteFilter],
  )
  const groupedViewLots = useMemo(() => {
    const grouped = viewLots.reduce<Record<string, {
      key: string
      loai_csr: string
      loai_banh: number
      boc: string
      totalKg: number
      totalLots: number
      dates: Record<string, { totalKg: number; lots: ProducedLot[] }>
    }>>((acc, lot) => {
      const key = [lot.loai_csr, lot.loai_banh, lot.boc || ""].join("|")
      const dateKey = lot.ngay_sx?.slice(0, 10) || ""
      if (!acc[key]) {
        acc[key] = {
          key,
          loai_csr: lot.loai_csr,
          loai_banh: lot.loai_banh,
          boc: lot.boc || "—",
          totalKg: 0,
          totalLots: 0,
          dates: {},
        }
      }
      if (!acc[key].dates[dateKey]) {
        acc[key].dates[dateKey] = { totalKg: 0, lots: [] }
      }
      acc[key].totalKg += lot.tong_kg || 0
      acc[key].totalLots += 1
      acc[key].dates[dateKey].totalKg += lot.tong_kg || 0
      acc[key].dates[dateKey].lots.push(lot)
      return acc
    }, {})

    return Object.values(grouped)
      .map(group => ({
        ...group,
        dates: Object.entries(group.dates)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([date, value]) => ({
            date,
            totalKg: value.totalKg,
            lots: value.lots.sort((a, b) => a.ma_lo.localeCompare(b.ma_lo)),
          })),
      }))
      .sort((a, b) => b.totalKg - a.totalKg)
  }, [viewLots])

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadUnassigned = useCallback(async (fid: string, allNgans: Ngan[]) => {
    const assignedUIDs = new Set(allNgans.flatMap(n => n.trips || []))
    const coveredRanges = allNgans
      .filter((ngan) => loaiNLByDC(dayChuyen, factoryCode).includes(ngan.loai_nl))
      .map((ngan) => {
        const from = normalizeDateInput(ngan.ngay_bd)
        const to = normalizeDateInput(ngan.ngay_kt || ngan.ngay_bd)
        if (!from || !to) return null
        return { from, to }
      })
      .filter((range): range is { from: string; to: string } => Boolean(range))

    const data = await loadDispatchEntriesWithResolvedRows(supabase, {
      factoryId: fid,
      select: "id,ngay,rows",
      ascending: true,
    })
    const byDate: Record<string, number> = {}
    for (const entry of data) {
      for (const row of ((entry.rows || []) as DispatchEntryRowLite[])) {
        if (!rowMatchesDayChuyen(row, dayChuyen)) continue
        const dateKey = toISODate(row._date || entry.ngay)
        if (!dateKey) continue
        const isCoveredByDateRange = coveredRanges.some((range) => isDateInRange(dateKey, range.from, range.to))
        if (isCoveredByDateRange) continue
        const rowUid = String(row.uid || "").trim()
        const tripRef = buildDispatchTripRef({
          dispatchEntryId: entry.id,
          rowId: row.row_id || rowUid,
          uid: rowUid,
        })
        if (!assignedUIDs.has(tripRef) && !assignedUIDs.has(rowUid)) {
          byDate[dateKey] = (byDate[dateKey] || 0) + 1
        }
      }
    }
    const total = Object.values(byDate).reduce((s, v) => s + v, 0)
    setUnassignedSummary({ total, byDate })
  }, [dayChuyen, factoryCode])

  const loadData = useCallback(async (fid: string) => {
    const requestId = loadDataRequestRef.current + 1
    loadDataRequestRef.current = requestId
    setLoading(true)
    try {
      const q = supabase.from("ngans").select("*")
        .eq("factory_id", fid)
        .order("ten_ngan", { ascending: true })
      const [{ data }] = await Promise.all([
        q,
      ])
      const loaded = ((data || []) as Ngan[]).map((ngan) => ({
        ...ngan,
        trang_thai: normalizeStorageStatus(ngan.trang_thai),
        xe_tu_ngay: ngan.xe_tu_ngay || addDaysISO(ngan.ngay_bd?.slice(0, 10) || "", 1),
        xe_den_ngay: ngan.xe_den_ngay || addDaysISO(ngan.ngay_kt?.slice(0, 10) || "", 1),
      }))
      const resolved = await resolveStorageNgansActualTotals(fid, loaded, { persist: true })
      const resolvedWithStatus = resolved.map((ngan) => ({
        ...ngan,
        trang_thai: deriveStorageStatus({
          ngayBd: ngan.ngay_bd,
          ngayKt: ngan.ngay_kt,
          current: ngan.trang_thai,
          nowMs: todayMs,
        }),
      }))
      const statusUpdates = resolvedWithStatus
        .filter((ngan, index) => ngan.trang_thai !== resolved[index]?.trang_thai)
        .map((ngan) => ({ id: ngan.id, trang_thai: ngan.trang_thai }))
      if (statusUpdates.length > 0) {
        await Promise.all(
          statusUpdates.map((update) =>
            supabase
              .from("ngans")
              .update({ trang_thai: update.trang_thai })
              .eq("factory_id", fid)
              .eq("id", update.id),
            ),
        )
      }
      if (requestId !== loadDataRequestRef.current) return
      setNgans(resolvedWithStatus)
      const lotsByNgan = await loadStorageLotsByNgans(
        fid,
        resolvedWithStatus.map((ngan) => ngan.id),
      )
      const ls: Record<string, number> = {}
      Object.entries(lotsByNgan).forEach(([nganId, lots]) => {
        ls[nganId] = summarizeStorageLots(lots).thanhPhamKg
      })
      if (storageDebugEnabled) {
        console.debug("[storage] loadData lot stats", {
          requestId,
          factoryId: fid,
          nganIds: resolvedWithStatus.map((ngan) => ngan.id),
          lotsByNganKeys: Object.keys(lotsByNgan),
          lotsByNganCounts: Object.fromEntries(
            Object.entries(lotsByNgan).map(([nganId, lots]) => [nganId, lots.length]),
          ),
          lotStats: ls,
        })
      }
      if (requestId !== loadDataRequestRef.current) return
      setLotStats(ls)
      void loadUnassigned(fid, resolvedWithStatus)
    } catch (error) {
      if (requestId === loadDataRequestRef.current) {
        setLotStats({})
      }
      console.error("[storage] loadData failed", error)
    } finally {
      if (requestId === loadDataRequestRef.current) {
        setLoading(false)
      }
    }
  }, [loadUnassigned, storageDebugEnabled, todayMs])

  // Bootstrap chỉ chạy 1 lần khi mount để lấy factory ID
  useEffect(() => {
    const bootstrap = async () => {
      const authState = await hydrateActiveSession().catch(() => ({
        session: null,
        user: null as SessionUser | null,
      }))
      setCurrentUser(authState.user)
      if (!hasPermission(authState.user, "storage.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      const fid = authState.user?.factory_id || await getActiveFactoryId()
      if (!fid) {
        setLoading(false)
        return
      }
      setFactoryId(fid)
      loadData(fid)
      supabase.from("factories").select("code").eq("id", fid).single().then(({ data: f }) => {
        if (f) setFactoryCode((f as Record<string, unknown>).code as string || "")
      })
    }
    void bootstrap()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload khi filter thay đổi (sau khi đã có factoryId)
  useEffect(() => {
    if (factoryId) loadData(factoryId)
  }, [factoryId, loadData])

  useEffect(() => {
    if (!factoryId) return
    const run = async () => {
      try {
        const rows = await loadRequiredNotes(supabase, factoryId)
        setRequiredNotes(rows.map((row) => row.content))
      } catch {
        setRequiredNotes([])
      }
    }
    void run()
  }, [factoryId])

  useEffect(() => {
    if (!storageDebugEnabled) return
    console.debug("[storage] lotStats state", {
      keys: Object.keys(lotStats),
      lotStats,
    })
  }, [lotStats, storageDebugEnabled])

  useEffect(() => {
    const candidates = ngans
      .filter((ngan) => loaiNLByDC(dayChuyen, factoryCode).includes(ngan.loai_nl))
      .filter((ngan) => ngan.ngay_bd && ngan.ngay_kt)
    if (candidates.length === 0) return
    if (reportFrom && reportTo) return
    const from = candidates
      .map((ngan) => ngan.ngay_bd.slice(0, 10))
      .sort()[0]
    const to = candidates
      .map((ngan) => (ngan.ngay_kt || ngan.ngay_bd).slice(0, 10))
      .sort()
      .at(-1)
    if (!reportFrom && from) setReportFrom(from)
    if (!reportTo && to) setReportTo(to)
  }, [ngans, dayChuyen, factoryCode, reportFrom, reportTo])

  // ── Fetch trips from dispatch ─────────────────────────────────────────────
  const fetchTrips = useCallback(async (
    ngay_bd: string,
    ngay_kt: string,
    loaiNL: string,
    autoSelect = false,
    overrideEditId?: string | null,
  ): Promise<TripItem[]> => {
    if (!ngay_bd || !factoryId) return []
    setLoadingTrips(true)
    try {
      const data = await loadDispatchTripsByDateRange(factoryId, ngay_bd, ngay_kt || ngay_bd)
      const editingId = overrideEditId ?? editId
      const otherNgans = ngans.filter(n => n.id !== editingId)
      const assignedUIDs = new Set(otherNgans.flatMap(n => n.trips || []))
      const trips: TripItem[] = (data || [])
        .filter(t => !assignedUIDs.has(t.ref) && !assignedUIDs.has(t.uid))
        .filter(t => {
          const kl = getKLFromTrip(t, loaiNL)
          return kl.tuoi > 0 || kl.kho > 0
        })
      if (autoSelect) setSelectedTrips(new Set(trips.map(t => t.ref)))
      return trips
    } finally {
      setLoadingTrips(false)
    }
  }, [factoryId, ngans, editId])

  // ── Auto-calc KL from selected trips (filtered by loai_nl) ───────────────
  const formLoaiNL = form.loai_nl
  useEffect(() => {
    if (selectedTrips.size > 0 && dispatchTrips.length === 0) return
    const sel = dispatchTrips.filter(t => selectedTrips.has(t.ref))
    const { tuoi, kho } = sel.reduce(
      (acc, t) => {
        const kl = getKLFromTrip(t, formLoaiNL)
        return { tuoi: acc.tuoi + kl.tuoi, kho: acc.kho + kl.kho }
      },
      { tuoi: 0, kho: 0 }
    )
    setForm(p => ({ ...p, tong_tuoi: tuoi, tong_kho: kho }))
  }, [selectedTrips, dispatchTrips, formLoaiNL])

  // ── Form helpers ──────────────────────────────────────────────────────────
  const updateForm = (patch: Partial<StorageForm>) => {
    setForm(p => {
      const next = { ...p, ...patch }
      const prevAutoXeTu = p.ngay_bd ? addDaysISO(p.ngay_bd, 1) : ""
      const prevAutoXeDen = p.ngay_kt ? addDaysISO(p.ngay_kt, 1) : ""
      const shouldSyncXeTu = !p.xe_tu_ngay || p.xe_tu_ngay === prevAutoXeTu
      const shouldSyncXeDen = !p.xe_den_ngay || p.xe_den_ngay === prevAutoXeDen
      if ("ngay_bd" in patch && shouldSyncXeTu) {
        next.xe_tu_ngay = next.ngay_bd ? addDaysISO(next.ngay_bd, 1) : ""
      }
      if ("ngay_kt" in patch && shouldSyncXeDen) {
        next.xe_den_ngay = next.ngay_kt ? addDaysISO(next.ngay_kt, 1) : ""
      }
      next.ma_ngan = genMaNgan(next)
      return next
    })
  }

  const applyFetchedTrips = useCallback((trips: TripItem[], autoSelect: boolean) => {
    setLinkedTrips([])
    setAvailableTrips(trips)
    if (autoSelect) {
      setSelectedTrips(new Set(trips.map((trip) => trip.ref)))
      return
    }
    const allowed = new Set(trips.map((trip) => trip.ref))
    setSelectedTrips((prev) => new Set(Array.from(prev).filter((uid) => allowed.has(uid))))
  }, [])

  const chungNhanOpts = factoryCode === "cuaparis" ? CHUNG_NHAN_BASE : ["PEFC CS", "Không"]

  const busyPositions = new Set(
    ngans
      .filter(n =>
        (
          n.trang_thai === STORAGE_STATUS_IN_PRODUCTION ||
          n.trang_thai === STORAGE_STATUS_WAITING ||
          n.trang_thai === STORAGE_STATUS_RECEIVING ||
          n.trang_thai === STORAGE_STATUS_CLOSED
        ) &&
        (!editId || n.id !== editId)
      )
      .map(n => (n.ten_ngan || "").trim().toUpperCase())
  )
  const availablePositions = ALL_POSITIONS.filter(p => !busyPositions.has(p))

  // ── Filter cards ──────────────────────────────────────────────────────────
  const dcLoaiNL = loaiNLByDC(dayChuyen, factoryCode)
  const normalizedReportFrom = normalizeDateInput(reportFrom)
  const normalizedReportTo = normalizeDateInput(reportTo)
  const filtered = ngans.filter(n => {
    if (!dcLoaiNL.includes(n.loai_nl)) return false
    if (filterTT && n.trang_thai !== filterTT) return false
    if (reportLoaiNL && n.loai_nl !== reportLoaiNL) return false
    if (!matchesNoteFilter(n.ghi_chu, filterGhiChu)) return false
    if (search &&
      !n.ten_ngan?.toLowerCase().includes(search.toLowerCase()) &&
      !n.ma_ngan?.toLowerCase().includes(search.toLowerCase())
    ) return false
    const nganFrom = normalizeDateInput(n.ngay_bd)
    const nganTo = normalizeDateInput(n.ngay_kt || n.ngay_bd)
    if ((normalizedReportFrom || normalizedReportTo) && (!nganFrom || !nganTo)) return false
    if (normalizedReportFrom && nganFrom < normalizedReportFrom) return false
    if (normalizedReportTo && nganTo > normalizedReportTo) return false
    return true
  })

  const subTerm = dayChuyen === "Mủ tạp" ? "Ngăn" : "Hồ"

  // ── Tách theo tab: Đang hoạt động / Lịch sử ─────────────────────────────────
  const activeNgans = filtered.filter(n => n.trang_thai !== STORAGE_STATUS_PRODUCED)
  const historyNgans = filtered.filter(n => n.trang_thai === STORAGE_STATUS_PRODUCED)

  // ── Chọn ngăn để in QR hàng loạt — độc lập với filter, chỉ "Chọn tất cả" theo danh sách đang hiển thị
  const togglePrintSelection = (id: string) => {
    setSelectedPrintIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAllPrintable = () => setSelectedPrintIds(new Set(activeNgans.map(n => n.id)))
  const clearPrintSelection = () => setSelectedPrintIds(new Set())

  // ── Stats ─────────────────────────────────────────────────────────────────
  const statsCards = [
    {
      label: `Tổng ${subTerm.toLowerCase()}`,
      value: filtered.length.toString(),
      color: "text-slate-700",
      icon: <Warehouse size={20} className="mx-auto mb-1 text-slate-500 opacity-70" />,
    },
    {
      label: "Đang sản xuất",
      value: filtered.filter(n => n.trang_thai === "Đang sản xuất").length.toString(),
      color: "text-emerald-600",
      icon: <Activity size={20} className="mx-auto mb-1 text-emerald-500 opacity-70" />,
    },
    {
      label: "Tổng KL tươi (kg)",
      value: filtered.reduce((s, n) => s + (n.tong_tuoi || 0), 0).toLocaleString(),
      color: "text-blue-600",
      icon: <Droplets size={20} className="mx-auto mb-1 text-blue-500 opacity-70" />,
    },
    {
      label: "Tổng KL khô (kg)",
      value: filtered.reduce((s, n) => s + (n.tong_kho || 0), 0).toLocaleString(),
      color: "text-purple-600",
      icon: <Weight size={20} className="mx-auto mb-1 text-purple-500 opacity-70" />,
    },
  ]

  const curingDays = (ngay_bd: string) => {
    return getStorageAgingDays(ngay_bd, todayMs)
  }

  // ── Save / Delete ─────────────────────────────────────────────────────────
  const [saveError, setSaveError] = useState<string | null>(null)
  const [nganStatusSavingId, setNganStatusSavingId] = useState<string | null>(null)
  const [nganSyncingId, setNganSyncingId] = useState<string | null>(null)
  const [nganSyncMessage, setNganSyncMessage] = useState<Record<string, string>>({})

  const handleSave = async () => {
    if (!factoryId) return
    setSaving(true)
    setSaveError(null)
    try {
      if (editId && !canEditStorage) {
        setSaveError(`Bạn không có quyền sửa ${subTerm.toLowerCase()}.`)
        return
      }
      if (!editId && !canCreateStorage) {
        setSaveError(`Bạn không có quyền tạo ${subTerm.toLowerCase()}.`)
        return
      }
      const normalizedPosition = (form.ten_ngan || "").trim().toUpperCase()
      if (!normalizedPosition) {
        setSaveError(`Vị trí ${subTerm.toLowerCase()} không được để trống`)
        return
      }
      if (busyPositions.has(normalizedPosition)) {
        setSaveError(`Vị trí ${normalizedPosition} đang được sử dụng`)
        return
      }
      const trangThai = deriveStorageStatus({
        ngayBd: form.ngay_bd,
        ngayKt: form.ngay_kt,
        current: form.trang_thai,
        nowMs: todayMs,
      })
      const selectedTripList = dispatchTrips.filter((trip) =>
        selectedTrips.has(trip.ref) && visibleTripUidSet.has(trip.ref),
      )
      const selectedTripUids = selectedTripList.map((trip) => trip.ref)
      const totals = selectedTripList.reduce(
        (acc, trip) => {
          const kl = getKLFromTrip(trip, form.loai_nl)
          return {
            tuoi: acc.tuoi + kl.tuoi,
            kho: acc.kho + kl.kho,
          }
        },
        { tuoi: 0, kho: 0 },
      )
      const payload = {
        ...form,
        ten_ngan: normalizedPosition,
        trang_thai: trangThai,
        factory_id: factoryId,
        ngay_kt: form.ngay_kt || null,
        xe_tu_ngay: form.xe_tu_ngay || null,
        xe_den_ngay: form.xe_den_ngay || null,
        tong_tuoi: Math.round(totals.tuoi * 100) / 100,
        tong_kho: Math.round(totals.kho * 100) / 100,
        trips: selectedTripUids,
        ghi_chu: form.ghi_chu || null,
      }
      if (editId) {
        const { error } = await supabase.from("ngans").update(payload).eq("id", editId)
        if (error) { setSaveError(error.message); return }
      } else {
        const { data: inserted, error } = await supabase.from("ngans").insert(payload).select("id").single()
        if (error) { setSaveError(error.message); return }
        if (inserted) {
          setKpiPrompt({ recordId: inserted.id, recordLabel: `Ngăn ${normalizedPosition}` })
        }
      }
      setModal(null)
      void loadData(factoryId)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!factoryId) return
    if (!canDeleteStorage) {
      setSaveError("Bạn không có quyền xóa ngăn.")
      return
    }
    await supabase.from("ngans").delete().eq("id", id)
    setDelConfirm(null)
    loadData(factoryId)
  }

  const openAdd = () => {
    if (!canCreateStorage) {
      setSaveError(`Bạn không có quyền tạo ${subTerm.toLowerCase()}.`)
      return
    }
    const loaiNL = dayChuyen === "Mủ nước" ? "Mủ nước" : "Mủ đông chén"
    const f = emptyForm(loaiNL)
    setForm({ ...f, ma_ngan: genMaNgan(f) })
    setEditId(null)
    setSelectedTrips(new Set())
    setLinkedTrips([])
    setAvailableTrips([])
    setTripNoteFilter([])
    setModal("add")
  }

  const openEdit = (n: Ngan) => {
    const normalizedStatus = normalizeStorageStatus(n.trang_thai)
    const canEditThisStatus =
      isAdmin ||
      normalizedStatus === STORAGE_STATUS_RECEIVING ||
      normalizedStatus === STORAGE_STATUS_CLOSED ||
      normalizedStatus === STORAGE_STATUS_WAITING

    if (!canEditStorage) {
      setSaveError(`Bạn không có quyền sửa ${subTerm.toLowerCase()}.`)
      return
    }

    if (!canEditThisStatus) {
      setSaveError(`${subTerm[0].toUpperCase()}${subTerm.slice(1)} đang ở trạng thái ${n.trang_thai}, không được sửa.`)
      return
    }

    const f = {
      ma_ngan: n.ma_ngan || "", ten_ngan: n.ten_ngan || "",
      loai_nl: n.loai_nl || "Mủ đông chén", nguon_goc: n.nguon_goc || "NT",
      xu_ly: n.xu_ly || "Xé", chung_nhan: n.chung_nhan || "PEFC CS",
      ngay_bd: n.ngay_bd?.slice(0, 10) || "",
      ngay_kt: n.ngay_kt?.slice(0, 10) || "",
      xe_tu_ngay: n.xe_tu_ngay?.slice(0, 10) || addDaysISO(n.ngay_bd?.slice(0, 10) || "", 1),
      xe_den_ngay: n.xe_den_ngay?.slice(0, 10) || addDaysISO(n.ngay_kt?.slice(0, 10) || "", 1),
      trang_thai: normalizeStorageStatus(n.trang_thai) || STORAGE_STATUS_RECEIVING,
      tong_tuoi: n.tong_tuoi || 0, tong_kho: n.tong_kho || 0,
      lo_nguon_goc: n.lo_nguon_goc || "",
      ghi_chu: n.ghi_chu || "",
    }
    setForm(f)
    setEditId(n.id)
    setSelectedTrips(new Set(n.trips || []))
    setLinkedTrips([])
    setAvailableTrips([])
    setTripNoteFilter([])
    setModal("edit")
    if (!factoryId) return
    void (async () => {
        const [storedTrips, tripsInRange] = await Promise.all([
          (n.trips || []).length > 0
          ? loadDispatchTripsByUids(factoryId, n.trips || [], {
              fromDate: n.ngay_bd || undefined,
              toDate: n.ngay_kt || n.ngay_bd || undefined,
            }).catch(() => [])
          : Promise.resolve([]),
        f.ngay_bd
          ? fetchTrips(f.ngay_bd, f.ngay_kt, f.loai_nl, false, n.id).catch(() => [])
          : Promise.resolve([]),
      ])
      setLinkedTrips(storedTrips)
      setAvailableTrips(tripsInRange)
    })()
  }

  const openView = async (n: Ngan) => {
    if (!factoryId) return
    setViewNgan(n)
    setViewLots([])
    setViewLotsLoading(true)
    setExpandedProductKeys(new Set())
    setExpandedDateKeys(new Set())
    setModal("view")
    try {
      const data = await loadStorageLots(factoryId, n.id)
      setViewLots(data)
    } catch {
      setViewLots([])
    }
    setViewLotsLoading(false)
  }

  const handleExportDetailPdf = async (nganId: string) => {
    if (!factoryId) return
    setExportingDetailId(nganId)
    try {
      const detail = await loadStorageDetail(factoryId, nganId)
      await downloadStorageDetailPdf(detail)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Không xuất được PDF chi tiết ngăn")
    } finally {
      setExportingDetailId(null)
    }
  }

  const handleExportGeoJson = async (ngan: Ngan) => {
    if (!factoryId) return
    setExportingGeoId(ngan.id)
    setSaveError(null)
    try {
      const geojson = await loadStorageGeoJson(factoryId, ngan)
      if (geojson.metadata.total_plot_codes === 0) {
        setSaveError(`Ngăn ${ngan.ten_ngan} chưa có lô thu hoạch để xuất GeoJSON.`)
        return
      }

      const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `ngan-${safeDownloadName(ngan.ten_ngan || ngan.ma_ngan || ngan.id)}.geojson`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Không xuất được GeoJSON của ngăn")
    } finally {
      setExportingGeoId(null)
    }
  }

  const handleExportPeriodReport = async () => {
    if (!factoryId || !reportFrom || !reportTo) {
      setSaveError("Vui lòng chọn đầy đủ Từ ngày và Đến ngày để xuất báo cáo kỳ.")
      return
    }
    if (reportFrom > reportTo) {
      setSaveError("Từ ngày không được lớn hơn Đến ngày.")
      return
    }

    setExportingPeriod(true)
    setSaveError(null)
    try {
      const matchedNgans = ngans
        .filter((ngan) => dcLoaiNL.includes(ngan.loai_nl))
        .filter((ngan) => !reportLoaiNL || ngan.loai_nl === reportLoaiNL)
        .filter((ngan) => {
          const from = ngan.ngay_bd?.slice(0, 10) || ""
          const to = (ngan.ngay_kt || "").slice(0, 10)
          if (!from || !to) return false
          return from >= reportFrom && to <= reportTo
        })

      const nganIds = matchedNgans.map((ngan) => ngan.id)
      let lotMap: Record<string, ProducedLot[]> = {}
      if (nganIds.length > 0) {
        lotMap = await loadStorageLotsByNgans(factoryId, nganIds)
      }

      const rows = matchedNgans
        .sort((a, b) => a.ngay_bd.localeCompare(b.ngay_bd) || a.ten_ngan.localeCompare(b.ten_ngan))
        .map((ngan) => {
          const lots = lotMap[ngan.id] || []
          const summary = summarizeStorageLots(lots)
          const lotDetailsText = lots.length > 0
            ? [...lots]
                .sort((a, b) => a.ngay_sx.localeCompare(b.ngay_sx) || a.ma_lo.localeCompare(b.ma_lo, "vi", { numeric: true, sensitivity: "base" }))
                .map((lot) => lot.ma_lo || "")
                .filter(Boolean)
                .join(", ")
            : ""
          return {
            ngan,
            thanhPhamKg: summary.thanhPhamKg,
            totalLots: summary.totalLots,
            doDangCount: summary.doDangCount,
            ratioPct: ngan.tong_kho > 0 ? (summary.thanhPhamKg / ngan.tong_kho) * 100 : null,
            lotDetailsText,
          }
        })

      await downloadStoragePeriodReportPdf({
        from: reportFrom,
        to: reportTo,
        rows,
      })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Không xuất được báo cáo theo kỳ")
    } finally {
      setExportingPeriod(false)
    }
  }

  const handleBulkPrintQr = async () => {
    const selected = activeNgans.filter(n => selectedPrintIds.has(n.id))
    if (selected.length === 0) {
      setSaveError(`Vui lòng chọn ít nhất một ${subTerm.toLowerCase()} để in QR.`)
      return
    }

    setPrintingQr(true)
    setSaveError(null)
    try {
      await downloadStorageBulkQrPdf(
        selected.map(n => ({ id: n.id, ma_ngan: n.ma_ngan, ten_ngan: n.ten_ngan })),
      )
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Không in được QR hàng loạt")
    } finally {
      setPrintingQr(false)
    }
  }

  const handleNganStatusToggle = async (
    nganId: string,
    nextStatus: "Chờ sản xuất" | "Đang sản xuất" | "Đã sản xuất",
  ) => {
    if (!isAdmin) {
      setSaveError("Chỉ admin mới được đổi trạng thái ngăn.")
      return
    }
    setNganStatusSavingId(nganId)
    try {
      const { error } = await supabase
        .from("ngans")
        .update({ trang_thai: nextStatus })
        .eq("id", nganId)
      if (error) throw new Error(error.message)
      setNgans((prev) =>
        prev.map((ngan) => (ngan.id === nganId ? { ...ngan, trang_thai: nextStatus } : ngan)),
      )
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Không cập nhật được trạng thái ngăn")
    } finally {
      setNganStatusSavingId(null)
    }
  }

  // Đồng bộ nhanh KL tươi/khô của 1 ngăn từ dữ liệu Điều xe/Sản lượng hiện tại,
  // không cần tải lại toàn bộ trang. Dùng lại đúng công thức resolveStorageNgansActualTotals
  // (chỉ tính lại theo các trip đã có trong ngan.trips[], không tự thêm chuyến mới).
  // Đồng thời gọi RPC sync_ngan_production_status để đồng bộ lại trang_thai theo sản lượng
  // thành phẩm — bù đắp cho các ngăn có lot_transactions ghi TRƯỚC khi RPC này ra đời (xem
  // rule 06-module-production.md mục "Đồng bộ trạng thái ngăn theo sản lượng thật").
  const handleQuickSyncNgan = async (ngan: Ngan) => {
    if (!factoryId) return
    if (!canEditStorage) {
      setSaveError(`Bạn không có quyền sửa ${subTerm.toLowerCase()}.`)
      return
    }
    setNganSyncingId(ngan.id)
    try {
      const [resolved] = await resolveStorageNgansActualTotals(factoryId, [ngan], { persist: true })

      let nextTrangThai = ngan.trang_thai
      const { error: statusSyncError } = await supabase.rpc("sync_ngan_production_status", {
        p_ngan_id: ngan.id,
      })
      if (statusSyncError) {
        console.error("sync_ngan_production_status:", statusSyncError)
      } else {
        const { data: freshNgan } = await supabase
          .from("ngans")
          .select("trang_thai")
          .eq("id", ngan.id)
          .maybeSingle()
        if (freshNgan?.trang_thai) nextTrangThai = freshNgan.trang_thai
      }
      const statusChanged = nextTrangThai !== ngan.trang_thai

      if (resolved) {
        setNgans((prev) =>
          prev.map((item) =>
            item.id === ngan.id
              ? {
                  ...item,
                  tong_tuoi: resolved.tong_tuoi,
                  tong_kho: resolved.tong_kho,
                  trips: resolved.trips,
                  trang_thai: nextTrangThai,
                }
              : item,
          ),
        )
        const tuoiDiff = resolved.tong_tuoi - (ngan.tong_tuoi || 0)
        const khoDiff = resolved.tong_kho - (ngan.tong_kho || 0)
        const klMessage =
          Math.abs(tuoiDiff) < 0.01 && Math.abs(khoDiff) < 0.01
            ? "không có thay đổi KL"
            : `KL khô ${(ngan.tong_kho || 0).toLocaleString()} → ${resolved.tong_kho.toLocaleString()} kg`
        const message = statusChanged
          ? `Đã đồng bộ — ${klMessage}, trạng thái ${ngan.trang_thai} → ${nextTrangThai}`
          : `Đã đồng bộ — ${klMessage}`
        setNganSyncMessage((prev) => ({ ...prev, [ngan.id]: message }))
      } else if (statusChanged) {
        setNgans((prev) =>
          prev.map((item) => (item.id === ngan.id ? { ...item, trang_thai: nextTrangThai } : item)),
        )
        setNganSyncMessage((prev) => ({
          ...prev,
          [ngan.id]: `Đã đồng bộ trạng thái: ${ngan.trang_thai} → ${nextTrangThai}`,
        }))
      }
      setTimeout(() => {
        setNganSyncMessage((prev) => {
          if (!(ngan.id in prev)) return prev
          const next = { ...prev }
          delete next[ngan.id]
          return next
        })
      }, 5000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Không đồng bộ được sản lượng ngăn")
    } finally {
      setNganSyncingId(null)
    }
  }

  const toggleProductKey = (key: string) => {
    setExpandedProductKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const toggleDateKey = (key: string) => {
    setExpandedDateKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const toggleCardCollapsed = (nganId: string) => {
    setCollapsedCardIds(prev => {
      const next = new Set(prev)
      if (next.has(nganId)) {
        next.delete(nganId)
      } else {
        next.add(nganId)
      }
      return next
    })
  }

  // ? Render ????
  return (
    <div>
      {kpiPrompt && (
        <div className="mb-4">
          <KpiLinkPrompt
            factoryId={factoryId}
            moduleCode="storage:create"
            recordId={kpiPrompt.recordId}
            recordLabel={kpiPrompt.recordLabel}
            recordUrl="/dashboard/storage"
            onDone={() => setKpiPrompt(null)}
          />
        </div>
      )}
      {/* Dây chuyến selector */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
        <label className="text-xs font-bold text-slate-600 block mb-1.5">
          Dây chuyến <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-3">
          {(["Mủ tạp", "Mủ nước"] as const).map(dc => (
            <button key={dc} onClick={() => { setDayChuyen(dc); setFilterTT("") }}
              className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
                dayChuyen === dc
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
              }`}>
              {dc}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-1">
          {dayChuyen === "Mủ tạp" ? "→ Ngăn lưu" : "→ Hồ chứa"}
        </p>
      </div>

      {/* Xe chưa vào ngăn */}
      {unassignedSummary.total > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Truck size={15} className="text-amber-600 shrink-0" />
            <span className="text-sm font-bold text-amber-800">
              Xe chưa vào {subTerm.toLowerCase()}: {unassignedSummary.total} chuyến
            </span>
          </div>
          <p className="text-xs text-amber-700 leading-relaxed">
            {Object.entries(unassignedSummary.byDate)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, cnt]) => `${fmtDate(date)}: ${cnt}`)
              .join(" • ")}
          </p>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">
            {dayChuyen === "Mủ tạp" ? "Ngăn lưu" : "Hồ chứa"}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý {dayChuyen === "Mủ tạp" ? "ngăn lưu" : "hồ chứa"} mủ cao su
          </p>
        </div>
        {canCreateStorage && (
          <button onClick={openAdd}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all btn-press">
            <Plus size={16} /> Thêm {subTerm.toLowerCase()}
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div ref={revealRef} className="scroll-reveal">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {statsCards.map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-slate-200 shadow-md p-4 text-center">
              {s.icon}
              <div className={`text-2xl font-extrabold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tab nav: Đang hoạt động / Lịch sử */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5 w-fit overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setNganTab("active")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
              nganTab === "active" ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>
            <Warehouse size={14}/> Đang hoạt động
            <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
              nganTab === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
              {activeNgans.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setNganTab("history")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
              nganTab === "history" ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>
            <History size={14}/> Lịch sử
            <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
              nganTab === "history" ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-500"}`}>
              {historyNgans.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setNganTab("print")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
              nganTab === "print" ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>
            <Printer size={14}/> In QR hàng loạt
            <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
              nganTab === "print" ? "bg-violet-100 text-violet-700" : "bg-slate-200 text-slate-500"}`}>
              {activeNgans.length}
            </span>
          </button>
        </div>

        {/* Filters */}
        <FilterBar
          className="mb-5"
          activeCount={[search, filterTT, filterGhiChu, reportFrom, reportTo, reportLoaiNL].filter(Boolean).length}
        >
          <div className="flex flex-wrap gap-3 items-center w-full">
            <div className="flex items-center gap-2 flex-1 min-w-48">
              <Search size={15} className="text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={`Tìm tên ${subTerm.toLowerCase()}, mã...`}
                className="flex-1 text-sm outline-none" />
            </div>
            <select value={filterTT} onChange={e => setFilterTT(e.target.value)}
              disabled={nganTab === "history"}
              title={nganTab === "history" ? "Tab Lịch sử chỉ gồm ngăn Đã sản xuất" : undefined}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed">
              <option value="">Tất cả trạng thái</option>
              {TRANG_THAI_OPTS.filter(t => t !== STORAGE_STATUS_PRODUCED).map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={filterGhiChu} onChange={e => setFilterGhiChu(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400">
              <option value="">Tất cả ghi chú</option>
              <option value={EMPTY_NOTE_FILTER}>Không có ghi chú</option>
              {requiredNotes.map(note => <option key={note} value={note}>{note}</option>)}
            </select>
            {(search || filterTT || filterGhiChu || reportFrom || reportTo || reportLoaiNL) && (
              <button onClick={() => {
                setSearch("")
                setFilterTT("")
                setFilterGhiChu("")
                setReportFrom("")
                setReportTo("")
                setReportLoaiNL("")
              }}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-500">
                <X size={14} /> Xóa lọc
              </button>
            )}
          </div>

          <div className="border-t border-slate-100 pt-4 w-full">
            <div className="flex flex-wrap items-end gap-2.5">
              <div className="min-w-[150px]">
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Từ ngày</label>
                <DateTextInput
                  value={reportFrom}
                  onChange={setReportFrom}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div className="min-w-[150px]">
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Đến ngày</label>
                <DateTextInput
                  value={reportTo}
                  onChange={setReportTo}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div className="min-w-[220px] flex-1 max-w-[280px]">
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại nguyên liệu</label>
                <select
                  value={reportLoaiNL}
                  onChange={e => setReportLoaiNL(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">Tất cả loại nguyên liệu</option>
                  {dcLoaiNL.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => void handleExportPeriodReport()}
                disabled={exportingPeriod}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-xl shadow-sm whitespace-nowrap disabled:opacity-50"
              >
                <FileText size={14} />
                {exportingPeriod ? "Đang xuất báo cáo..." : "Xuất báo cáo theo kỳ"}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Chỉ lấy các {subTerm.toLowerCase()} có toàn bộ thời gian nguyên liệu nằm trọn trong kỳ lọc.
            </p>
          </div>
        </FilterBar>

        {/* Card grid — tab Đang hoạt động */}
        {nganTab === "active" && (loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : activeNgans.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
            <Warehouse size={40} className="mx-auto mb-3 opacity-30" />
            <p>Không có {subTerm.toLowerCase()} nào đang hoạt động</p>
          </div>
        ) : (
          <div className="columns-1 gap-4 lg:columns-2 2xl:columns-3">
            {activeNgans.map(n => {
              const days  = curingDays(n.ngay_bd)
              const ready = days !== null && days >= 21
              const hs      = headerStyle(n.trang_thai)
              const tpKg    = lotStats[n.id] || 0
              const tpPct   = n.tong_kho > 0 ? (tpKg / n.tong_kho) * 100 : 0
              const canCloseForProduction =
                n.trang_thai === STORAGE_STATUS_CLOSED &&
                canManuallyMoveClosedToWaiting(n.ngay_bd, todayMs)
              // Admin được đánh dấu "Đã sản xuất" khi ngăn đạt từ 50% trở lên (không giới hạn trên).
              // Ngưỡng 100%-110% ở banner hậu lưu trong module Thành phẩm (product/page.tsx) không đổi.
              const canMarkProduced =
                n.trang_thai === STORAGE_STATUS_IN_PRODUCTION &&
                tpPct >= 50
              const canReturnToDraft = n.trang_thai === STORAGE_STATUS_PRODUCED
              const nextManualStatus = canCloseForProduction
                ? STORAGE_STATUS_WAITING
                : canMarkProduced
                  ? STORAGE_STATUS_PRODUCED
                  : canReturnToDraft
                    ? STORAGE_STATUS_IN_PRODUCTION
                    : null
              const lookupPath = buildStorageLookupPath(n.id, n.ma_ngan)
              const isCollapsed = collapsedCardIds.has(n.id)
              const normalizedStatus = normalizeStorageStatus(n.trang_thai)
              const canEditThisNgan =
                canEditStorage && (
                  isAdmin ||
                  normalizedStatus === STORAGE_STATUS_RECEIVING ||
                  normalizedStatus === STORAGE_STATUS_CLOSED ||
                  normalizedStatus === STORAGE_STATUS_WAITING
                )
              const canDeleteThisNgan = canDeleteStorage
              const canViewThisNgan = canViewStorage

              return (
                <div key={n.id} className="group mb-4 break-inside-avoid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm hover-lift">
                  {/* Card header */}
                  <div className={`bg-gradient-to-r ${hs.grad} px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2`}>
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <Warehouse size={16} className={`${hs.icon} shrink-0`} />
                      <span className="font-extrabold text-slate-800 text-base truncate">{n.ten_ngan}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold shrink-0 ${badgeClass(n.trang_thai)}`}>
                        {n.trang_thai}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {nextManualStatus && isAdmin && (
                        <button
                          type="button"
                          onClick={() => void handleNganStatusToggle(n.id, nextManualStatus)}
                          disabled={nganStatusSavingId === n.id}
                          className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            nextManualStatus === STORAGE_STATUS_PRODUCED
                              ? "border-blue-200 bg-white/80 text-blue-700 hover:bg-white"
                              : nextManualStatus === STORAGE_STATUS_WAITING
                                ? "border-amber-200 bg-white/80 text-amber-700 hover:bg-white"
                                : "border-emerald-200 bg-white/80 text-emerald-700 hover:bg-white"
                          }`}
                          title={
                            nextManualStatus === STORAGE_STATUS_PRODUCED
                              ? `Đánh dấu đã sản xuất (${tpPct.toFixed(1)}%)`
                              : nextManualStatus === STORAGE_STATUS_WAITING
                                ? `Chuyển sang chờ sản xuất (${days ?? 0} ngày lưu)`
                                : `Chuyển về đang sản xuất (${tpPct.toFixed(1)}%)`
                          }
                        >
                          {nganStatusSavingId === n.id
                            ? "Đang cập nhật..."
                            : nextManualStatus === STORAGE_STATUS_PRODUCED
                              ? "Đã SX"
                              : nextManualStatus === STORAGE_STATUS_WAITING
                                ? "Chờ SX"
                                : "Về đang SX"}
                        </button>
                      )}
                      <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        {canViewThisNgan && (
                          <Link
                            href={lookupPath}
                            className="p-1.5 hover:bg-white/60 rounded-lg text-emerald-600 transition-colors"
                            title="QR / Tra cứu"
                          >
                            <QrCode size={14} />
                          </Link>
                        )}
                        {canViewThisNgan && (
                          <button
                            onClick={() => void handleExportDetailPdf(n.id)}
                            disabled={exportingDetailId === n.id}
                            className="p-1.5 hover:bg-white/60 rounded-lg text-slate-700 transition-colors disabled:opacity-50"
                            title="Xuất PDF"
                          >
                            <FileText size={14} />
                          </button>
                        )}
                        {canViewThisNgan && (
                          <button
                            onClick={() => void handleExportGeoJson(n)}
                            disabled={exportingGeoId === n.id}
                            className="p-1.5 hover:bg-white/60 rounded-lg text-sky-700 transition-colors disabled:opacity-50"
                            title="Xuất GeoJSON"
                          >
                            <MapIcon size={14} />
                          </button>
                        )}
                        {canViewThisNgan && (
                          <button onClick={() => openView(n)}
                            className="p-1.5 hover:bg-white/60 rounded-lg text-slate-500 transition-colors"
                            title="Xem chi tiết">
                            <Eye size={14} />
                          </button>
                        )}
                        {canEditThisNgan && (
                          <button
                            onClick={() => void handleQuickSyncNgan(n)}
                            disabled={nganSyncingId === n.id}
                            className="p-1.5 hover:bg-white/60 rounded-lg text-teal-600 transition-colors disabled:opacity-50"
                            title="Đồng bộ nhanh KL tươi/khô từ Điều xe/Sản lượng"
                          >
                            <RefreshCw size={14} className={nganSyncingId === n.id ? "animate-spin" : undefined} />
                          </button>
                        )}
                        {canEditThisNgan && (
                          <button onClick={() => openEdit(n)}
                            className="p-1.5 hover:bg-white/60 rounded-lg text-blue-500 transition-colors"
                            title="Sửa">
                            <Edit2 size={14} />
                          </button>
                        )}
                        {canDeleteThisNgan && (
                          <button onClick={() => setDelConfirm(n.id)}
                            className="p-1.5 hover:bg-white/60 rounded-lg text-red-400 transition-colors"
                            title="Xóa">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCardCollapsed(n.id)}
                        className="p-1.5 hover:bg-white/60 rounded-lg text-slate-500 transition-colors"
                        title={isCollapsed ? "Mở rộng" : "Thu gọn"}
                      >
                        <Minus size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Card body */}
                  {!isCollapsed && (
                  <div className="p-4 space-y-0">
                    <div className="flex items-start gap-2 py-2 border-b border-dashed border-slate-200">
                      <Tag size={14} className="text-slate-400 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Mã {subTerm.toLowerCase()}</span>
                      <span className="text-xs font-semibold text-slate-700 break-all leading-relaxed">{n.ma_ngan || "—"}</span>
                    </div>
                    <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                      <Layers size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Loại NL</span>
                      <span className="text-sm font-semibold text-slate-800">{n.loai_nl}</span>
                    </div>
                    <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                      <MapPin size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Nguồn · Xử lý</span>
                      <span className="text-sm font-semibold text-slate-800">{n.nguon_goc} · {n.xu_ly}</span>
                    </div>
                    <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                      <ShieldCheck size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Chứng nhận</span>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">{n.chung_nhan}</span>
                    </div>
                    <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                      <Weight size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">KL tươi / khô</span>
                      <div className="flex-1">
                        <span className="text-sm font-semibold text-slate-800">
                          {(n.tong_tuoi || 0).toLocaleString()} / <span className="text-emerald-700">{(n.tong_kho || 0).toLocaleString()}</span> kg
                        </span>
                        {nganSyncMessage[n.id] && (
                          <div className="text-xs font-semibold text-teal-600 mt-0.5">{nganSyncMessage[n.id]}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-2 py-2 border-b border-dashed border-slate-200">
                      <BarChart2 size={14} className="text-slate-400 shrink-0 mt-1" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">TP / QK {subTerm.toLowerCase()}</span>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-slate-800">
                            {n.tong_kho > 0 ? `${tpPct.toFixed(1)}%` : "—"}
                          </span>
                          {n.tong_kho > 0 && (
                            <span className="text-xs text-slate-400">
                              ({tpKg.toLocaleString()} / {(n.tong_kho || 0).toLocaleString()} kg)
                            </span>
                          )}
                        </div>
                        {n.tong_kho > 0 && (
                          <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-1 bg-blue-400 rounded-full transition-all"
                              style={{ width: `${Math.min(tpPct, 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 py-2">
                      <Activity size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Ngày lưu ủ</span>
                      <span className="text-sm font-semibold text-slate-800">
                        {fmtDate(n.ngay_bd)}{n.ngay_kt ? ` → ${fmtDate(n.ngay_kt)}` : ""}
                        {days !== null && (
                          <span className={`ml-1 text-xs ${ready ? "text-emerald-600" : "text-amber-600"}`}>
                            ({days} ngày{ready ? " ✓" : ""})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 py-2 border-t border-dashed border-slate-200">
                      <Activity size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Ngày xé</span>
                      <span className="text-sm font-semibold text-slate-800">
                        {fmtDate(n.xe_tu_ngay)}{n.xe_den_ngay ? ` → ${fmtDate(n.xe_den_ngay)}` : ""}
                      </span>
                    </div>
                    {n.ghi_chu && (
                      <div className="flex items-start gap-2 py-2 border-t border-dashed border-slate-200">
                        <Tag size={14} className="text-slate-400 shrink-0 mt-0.5" />
                        <span className="text-xs text-slate-500 w-24 shrink-0">Ghi chú</span>
                        <span className="text-xs font-semibold text-slate-700 break-words">{n.ghi_chu}</span>
                      </div>
                    )}
                  </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {/* Data table — tab Lịch sử (ngăn Đã sản xuất) */}
        {nganTab === "history" && (loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : historyNgans.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
            <History size={40} className="mx-auto mb-3 opacity-30" />
            <p>Chưa có {subTerm.toLowerCase()} nào trong lịch sử</p>
          </div>
        ) : (
          <ResponsiveTableWrapper>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {["Mã " + subTerm.toLowerCase(), "Loại NL", "KL tươi/khô", "TP/QK ngăn", "Ngày lưu ủ", ""].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historyNgans.map(n => {
                  const days  = curingDays(n.ngay_bd)
                  const ready = days !== null && days >= 21
                  const tpKg    = lotStats[n.id] || 0
                  const tpPct   = n.tong_kho > 0 ? (tpKg / n.tong_kho) * 100 : 0
                  const lookupPath = buildStorageLookupPath(n.id, n.ma_ngan)
                  const canReturnToDraft = n.trang_thai === STORAGE_STATUS_PRODUCED
                  return (
                    <tr key={n.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="font-bold text-slate-800">{n.ten_ngan}</div>
                        <div className="text-xs text-slate-400">{n.ma_ngan || "—"}</div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{n.loai_nl}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">
                        {(n.tong_tuoi || 0).toLocaleString()} / <span className="text-emerald-700 font-semibold">{(n.tong_kho || 0).toLocaleString()}</span> kg
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">
                        {n.tong_kho > 0 ? `${tpPct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">
                        {fmtDate(n.ngay_bd)}{n.ngay_kt ? ` → ${fmtDate(n.ngay_kt)}` : ""}
                        {days !== null && (
                          <span className={`ml-1 text-xs ${ready ? "text-emerald-600" : "text-amber-600"}`}>
                            ({days} ngày{ready ? " ✓" : ""})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {canViewStorage && (
                            <Link href={lookupPath}
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-emerald-600 transition-colors"
                              title="QR / Tra cứu">
                              <QrCode size={14} />
                            </Link>
                          )}
                          {canViewStorage && (
                            <button onClick={() => void handleExportDetailPdf(n.id)}
                              disabled={exportingDetailId === n.id}
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors disabled:opacity-50"
                              title="Xuất PDF">
                              <FileText size={14} />
                            </button>
                          )}
                          {canViewStorage && (
                            <button onClick={() => void handleExportGeoJson(n)}
                              disabled={exportingGeoId === n.id}
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-sky-700 transition-colors disabled:opacity-50"
                              title="Xuất GeoJSON">
                              <MapIcon size={14} />
                            </button>
                          )}
                          {canViewStorage && (
                            <button onClick={() => openView(n)}
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
                              title="Xem chi tiết">
                              <Eye size={14} />
                            </button>
                          )}
                          {canEditStorage && isAdmin && (
                            <button onClick={() => openEdit(n)}
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-blue-500 transition-colors"
                              title="Sửa">
                              <Edit2 size={14} />
                            </button>
                          )}
                          {canReturnToDraft && isAdmin && (
                            <button
                              type="button"
                              onClick={() => void handleNganStatusToggle(n.id, STORAGE_STATUS_IN_PRODUCTION)}
                              disabled={nganStatusSavingId === n.id}
                              className="rounded-lg border border-emerald-200 bg-white px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                              title={`Chuyển về đang sản xuất (${tpPct.toFixed(1)}%)`}
                            >
                              {nganStatusSavingId === n.id ? "Đang cập nhật..." : "Về đang SX"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        ))}

        {/* Card grid — tab In QR hàng loạt */}
        {nganTab === "print" && (loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : activeNgans.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
            <Printer size={40} className="mx-auto mb-3 opacity-30" />
            <p>Không có {subTerm.toLowerCase()} nào để in QR</p>
          </div>
        ) : (
          <div>
            {/* Action bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={selectAllPrintable}
                  className="text-xs font-bold text-emerald-700 hover:underline">
                  Chọn tất cả ({activeNgans.length})
                </button>
                <span className="text-slate-300">|</span>
                <button type="button" onClick={clearPrintSelection}
                  className="text-xs font-bold text-slate-500 hover:underline">
                  Bỏ chọn tất cả
                </button>
                <span className="text-xs text-slate-500">
                  Đã chọn <span className="font-bold text-slate-800">{selectedPrintIds.size}</span> / {activeNgans.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleBulkPrintQr()}
                disabled={selectedPrintIds.size === 0 || printingQr}
                className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl shadow-sm disabled:opacity-50 disabled:cursor-not-allowed btn-press"
              >
                <Printer size={14} />
                {printingQr ? "Đang tạo PDF..." : `In QR đã chọn (${selectedPrintIds.size})`}
              </button>
            </div>

            {/* Grid chọn ngăn — click toàn bộ card để toggle */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {activeNgans.map(n => {
                const isSelected = selectedPrintIds.has(n.id)
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => togglePrintSelection(n.id)}
                    className={`relative rounded-xl border p-3 text-left transition-all ${
                      isSelected
                        ? "border-violet-500 bg-violet-50 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className={`absolute right-2 top-2 rounded-full p-1 ${
                      isSelected ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-400"
                    }`}>
                      <Check size={11} />
                    </div>
                    <div className="pr-7">
                      <div className="truncate text-sm font-extrabold text-slate-800">{n.ten_ngan}</div>
                      <div className="mt-1 break-all text-[11px] text-slate-500">{n.ma_ngan || "—"}</div>
                      <span className={`mt-2 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold ${badgeClass(n.trang_thai)}`}>
                        {n.trang_thai}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Add / Edit Modal ───────────────────────────────────────────────── */}
      {(modal === "add" || modal === "edit") && (
        <ModalShell
          title={modal === "add" ? `Tạo ${subTerm.toLowerCase()} mới` : `Sửa ${subTerm.toLowerCase()}`}
          onClose={() => setModal(null)}
          maxWidth="2xl"
          footer={
            <>
              <button onClick={() => setModal(null)}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-50">
                {saving ? "Đang lưu..." : modal === "add" ? `Tạo ${subTerm.toLowerCase()}` : "Lưu thay đổi"}
              </button>
            </>
          }
        >
            <div className="space-y-4">
              {/* Row 1: Vị trí · Loại NL · Nguồn gốc */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Vị trí {subTerm.toLowerCase()} <span className="text-red-500">*</span>
                  </label>
                  <input
                    list="positions-list"
                    value={form.ten_ngan}
                    onChange={e => updateForm({ ten_ngan: e.target.value.toUpperCase().slice(0, 10) })}
                    placeholder="-- Chọn --"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                  <datalist id="positions-list">
                    {availablePositions.map(p => <option key={p} value={p} />)}
                  </datalist>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Có thể chọn nhanh N1-N24 hoặc nhập tay mã ngoài dải chuẩn như BN, 10.2, MN.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại nguyên liệu</label>
                  <select value={form.loai_nl} onChange={e => updateForm({ loai_nl: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {loaiNLByDC(dayChuyen, factoryCode).map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Nguồn gốc</label>
                  <select value={form.nguon_goc} onChange={e => updateForm({ nguon_goc: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {NGUON_GOC_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 2: Xử lý · Chứng nhận */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Xử lý</label>
                  <select value={form.xu_ly} onChange={e => updateForm({ xu_ly: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {XU_LY_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Chứng nhận</label>
                  <select value={form.chung_nhan} onChange={e => updateForm({ chung_nhan: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {chungNhanOpts.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 3: Ngày bắt đầu · Ngày kết thúc */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày bắt đầu (bắt buộc)</label>
                  <DateTextInput value={form.ngay_bd}
                    onChange={(nextNgayBd) => {
                      updateForm({ ngay_bd: nextNgayBd })
                      void fetchTrips(nextNgayBd, form.ngay_kt, form.loai_nl, modal === "add").then((trips) => {
                        applyFetchedTrips(trips, modal === "add")
                      })
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày kết thúc (tùy chọn)</label>
                  <DateTextInput value={form.ngay_kt}
                    onChange={(nextNgayKt) => {
                      updateForm({ ngay_kt: nextNgayKt })
                      void fetchTrips(form.ngay_bd, nextNgayKt, form.loai_nl, modal === "add").then((trips) => {
                        applyFetchedTrips(trips, modal === "add")
                      })
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Xé từ ngày</label>
                  <DateTextInput
                    value={form.xe_tu_ngay}
                    onChange={(value) => updateForm({ xe_tu_ngay: value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Xé đến ngày</label>
                  <DateTextInput
                    value={form.xe_den_ngay}
                    onChange={(value) => updateForm({ xe_den_ngay: value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Trips from Điều xe */}
              {form.ngay_bd && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                      <Truck size={14} className="text-slate-500" />
                      <span className="text-xs font-bold text-slate-700">
                        Chuyến xe từ Điều xe ({fmtDate(form.ngay_bd)} → {fmtDate(form.ngay_kt || form.ngay_bd)})
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <FilterMultiSelect
                        options={tripNoteOptions}
                        selected={tripNoteFilter}
                        onChange={setTripNoteFilter}
                        labels={{ [EMPTY_NOTE_FILTER]: "Không có ghi chú" }}
                        placeholder="Tất cả ghi chú"
                        searchPlaceholder="Tìm ghi chú..."
                        className="min-w-48"
                      />
                      <button
                        onClick={() => setSelectedTrips(new Set(noteFilteredTrips.map(t => t.ref)))}
                        className="text-xs px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-lg transition-colors">
                        Chọn tất cả
                      </button>
                      <button
                        onClick={() => setSelectedTrips(new Set())}
                        className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg transition-colors">
                        Bỏ tất cả
                      </button>
                    </div>
                  </div>

                  {loadingTrips ? (
                    <div className="p-6 text-center text-slate-400 text-sm">Đang tải chuyến xe...</div>
                  ) : dispatchTrips.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-sm">
                      Không có chuyến xe trong khoảng ngày này
                    </div>
                  ) : noteFilteredTrips.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-sm">
                      Không có chuyến xe nào khớp bộ lọc Ghi chú đang chọn
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
                          <tr>
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 text-left text-slate-500 font-bold">Ngày</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-bold">Xe</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-bold">Chuyến</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-bold">Tài xế</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-bold">Ghi chú</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-bold">KL tươi</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-bold">KL khô</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {noteFilteredTrips.map(t => {
                            const checked = selectedTrips.has(t.ref)
                            const kl = getKLFromTrip(t, form.loai_nl)
                            return (
                              <tr key={t.ref}
                                onClick={() => {
                                  setSelectedTrips(prev => {
                                    const next = new Set(prev)
                                    if (checked) next.delete(t.ref)
                                    else next.add(t.ref)
                                    return next
                                  })
                                }}
                                className={`cursor-pointer transition-colors ${checked ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
                                <td className="px-3 py-2">
                                  <input type="checkbox" readOnly checked={checked}
                                    className="accent-emerald-600 cursor-pointer" />
                                </td>
                                <td className="px-3 py-2 text-slate-600">
                                  {new Date(t._date).toLocaleDateString("vi-VN")}
                                </td>
                                <td className="px-3 py-2 font-bold text-slate-800">{t.so_xe}</td>
                                <td className="px-3 py-2 text-slate-600">C{t.chuyen}</td>
                                <td className="px-3 py-2 text-slate-600">{t.tai_xe}</td>
                                <td className="px-3 py-2 text-slate-500">{t.ghi_chu || "—"}</td>
                                <td className="px-3 py-2 text-right font-semibold text-amber-600">
                                  {kl.tuoi.toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-amber-600">
                                  {kl.kho.toLocaleString()}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* KL tươi / khô — read-only, tự tính từ xe được chọn */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    KL tươi (kg) <span className="text-emerald-600 font-normal">(tự tính)</span>
                  </label>
                  <div className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-700 font-semibold">
                    {form.tong_tuoi.toLocaleString("vi-VN")}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    KL khô (kg) <span className="text-emerald-600 font-normal">(tự tính)</span>
                  </label>
                  <div className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-700 font-semibold">
                    {form.tong_kho.toLocaleString("vi-VN")}
                  </div>
                </div>
              </div>

              {/* Mã ngăn (auto-generated, read-only) */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
                <RequiredNoteSelect
                  factoryId={factoryId}
                  value={form.ghi_chu}
                  onChange={(v) => updateForm({ ghi_chu: v })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  onError={setSaveError}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Mã {subTerm.toLowerCase()} (tự sinh)
                </label>
                <div className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-700 font-mono break-all">
                  {form.ma_ngan || "—"}
                </div>
              </div>

              {/* Trạng thái (read-only, tự tính từ ngày) */}
              <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center gap-2">
                <span className="text-xs text-slate-500">Trạng thái:</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${badgeClass(deriveStorageStatus({ ngayBd: form.ngay_bd, ngayKt: form.ngay_kt, current: form.trang_thai, nowMs: todayMs }))}`}>
                  {deriveStorageStatus({ ngayBd: form.ngay_bd, ngayKt: form.ngay_kt, current: form.trang_thai, nowMs: todayMs })}
                </span>
                <span className="text-xs text-slate-400">(tự động)</span>
              </div>
            </div>

            {saveError && (
              <div className="pt-2">
                <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-bold">
                  <X size={13} className="shrink-0" />
                  {saveError}
                </div>
              </div>
            )}
        </ModalShell>
      )}

      {/* ── View detail modal ──────────────────────────────────────────────── */}
      {modal === "view" && viewNgan && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className={`bg-gradient-to-r ${headerStyle(viewNgan.trang_thai).grad} border-b border-slate-200 px-6 py-4 flex items-center justify-between`}>
              <div className="flex items-center gap-2">
                <Warehouse size={18} className={headerStyle(viewNgan.trang_thai).icon} />
                <h2 className="text-lg font-extrabold text-slate-800">{viewNgan.ten_ngan}</h2>
              </div>
              <button onClick={() => {
                setModal(null)
                setViewLots([])
                setExpandedProductKeys(new Set())
                setExpandedDateKeys(new Set())
              }} className="p-2 hover:bg-white/60 rounded-xl">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-0 text-sm">
              {([
                [`Mã ${subTerm.toLowerCase()}`, viewNgan.ma_ngan],
                ["Loại NL",    viewNgan.loai_nl],
                ["Nguồn gốc",  viewNgan.nguon_goc],
                ["Xử lý",      viewNgan.xu_ly],
                ["Chứng nhận", viewNgan.chung_nhan],
                ["Ngày BD",    fmtDate(viewNgan.ngay_bd)],
                ["Ngày KT",    fmtDate(viewNgan.ngay_kt)],
                ["Xé từ ngày", fmtDate(viewNgan.xe_tu_ngay)],
                ["Xé đến ngày", fmtDate(viewNgan.xe_den_ngay)],
                ["KL tươi",    (viewNgan.tong_tuoi || 0).toLocaleString() + " kg"],
                ["KL khô",     (viewNgan.tong_kho  || 0).toLocaleString() + " kg"],
                ["TP / QK",    viewNgan.tong_kho > 0
                  ? `${((lotStats[viewNgan.id] || 0) / viewNgan.tong_kho * 100).toFixed(1)}% (${(lotStats[viewNgan.id] || 0).toLocaleString()} kg)`
                  : "—"],
                ["Số chuyến",  (viewNgan.trips || []).length + " chuyến"],
                ["Trạng thái", viewNgan.trang_thai],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between py-2 border-b border-dashed border-slate-200 last:border-0">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-semibold text-slate-700 text-right max-w-[60%]">{v}</span>
                </div>
              ))}

              <div className="pt-4">
                <InventoryQrCard
                  compact
                  title="QR ngăn"
                  caption="Quét để mở trang chi tiết ngăn lưu trên web."
                  hrefPath={buildStorageLookupPath(viewNgan.id, viewNgan.ma_ngan)}
                  valueText={viewNgan.ma_ngan || viewNgan.ten_ngan}
                  downloadFileName={`QR-${viewNgan.ma_ngan || viewNgan.ten_ngan}`}
                />
              </div>

              <div className="pt-5 mt-3 border-t border-slate-200">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-800">Thành phẩm đã dùng nguyên liệu</h3>
                    <p className="text-xs text-slate-400">Bấm từng nhóm để mở ngày sản xuất, rồi mở tiếp để xem chi tiết từng lô</p>
                  </div>
                  <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full">
                    {viewLots.length} lô
                  </span>
                </div>

                {viewLotsLoading ? (
                  <div className="py-6 text-center text-slate-400 text-sm">Đang tải danh sách thành phẩm...</div>
                ) : groupedViewLots.length === 0 ? (
                  <div className="py-6 text-center text-slate-400 text-sm">
                    Chưa có lô thành phẩm nào sử dụng nguyên liệu từ {viewNgan.ten_ngan}
                  </div>
                ) : (
                  <div className="max-h-[42vh] overflow-y-auto pr-1 space-y-4 overscroll-contain">
                    {groupedViewLots.map(group => {
                      const productExpanded = expandedProductKeys.has(group.key)
                      return (
                        <div key={group.key} className="border border-slate-200 rounded-xl overflow-hidden">
                          <button
                            type="button"
                            onClick={() => toggleProductKey(group.key)}
                            className="w-full px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 text-left hover:bg-slate-100 transition-colors"
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              {productExpanded ? (
                                <ChevronDown size={16} className="text-slate-400 shrink-0 mt-0.5" />
                              ) : (
                                <ChevronRight size={16} className="text-slate-400 shrink-0 mt-0.5" />
                              )}
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-800 break-words">
                                  {group.loai_csr} / Bành {group.loai_banh} / {group.boc}
                                </div>
                                <div className="text-xs text-slate-500 mt-1">
                                  {group.dates.length} ngày sản xuất · {group.totalLots} lô
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm font-extrabold text-blue-700">{fmtKg(group.totalKg)}</div>
                            </div>
                          </button>

                          {productExpanded && (
                            <div className="bg-white divide-y divide-slate-100">
                              {group.dates.map(dateGroup => {
                                const dateKey = `${group.key}|${dateGroup.date}`
                                const dateExpanded = expandedDateKeys.has(dateKey)
                                return (
                                  <div key={dateKey}>
                                    <button
                                      type="button"
                                      onClick={() => toggleDateKey(dateKey)}
                                      className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors"
                                    >
                                      <div className="flex items-start gap-2 min-w-0">
                                        {dateExpanded ? (
                                          <ChevronDown size={15} className="text-slate-400 shrink-0 mt-0.5" />
                                        ) : (
                                          <ChevronRight size={15} className="text-slate-400 shrink-0 mt-0.5" />
                                        )}
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-slate-700">
                                            {fmtDate(dateGroup.date)}
                                          </div>
                                          <div className="text-xs text-slate-500 mt-1 break-words">
                                            {group.loai_csr} / Bành {group.loai_banh} / {group.boc}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="text-right shrink-0">
                                        <div className="text-sm font-bold text-slate-700">{fmtKg(dateGroup.totalKg)}</div>
                                        <div className="text-xs text-slate-500">{dateGroup.lots.length} lô</div>
                                      </div>
                                    </button>

                                    {dateExpanded && (
                                      <div className="px-4 pb-3">
                                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                                          <div className="divide-y divide-slate-100 bg-white">
                                            {dateGroup.lots.map(lot => (
                                              <div key={lot.id} className="px-4 py-3 flex items-center justify-between gap-4">
                                                <div className="min-w-0">
                                                  <div className="font-bold text-slate-800">{lot.ma_lo}</div>
                                                  <div className="text-xs text-slate-500">
                                                    Ca {lot.ca || "—"} · {lot.tong_banh || 0} bành · {lot.trang_thai}
                                                  </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                  <div className="text-sm font-semibold text-slate-700">{fmtKg(lot.tong_kg || 0)}</div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────────────────────── */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-extrabold text-slate-800 mb-2">Xác nhận xóa?</h3>
            <p className="text-sm text-slate-500 mb-5">{subTerm} này sẽ bị xóa vĩnh viễn.</p>
            <div className="flex gap-3">
              <button onClick={() => setDelConfirm(null)}
                className="flex-1 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button onClick={() => handleDelete(delConfirm)}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-md">
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

