"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { loadDispatchEntriesWithResolvedRows, type LegacyDispatchRow } from "@/lib/dispatch-entry-rows"
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CalendarDays,
  Droplet,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Weight,
  X,
} from "lucide-react"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action"
import { IconActionGroup } from "@/app/dashboard/_components/doc-ui/icon-action"
import { ExpandableRow, ExpandHeaderCell, ExpandAllToggle } from "@/app/dashboard/_components/doc-ui/expandable-row"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { QrScanButton, QrScanPortal } from "@/app/dashboard/_components/qr-scan-portal"
import { OutputSourceCell, OutputWarnBadge } from "./_components/output-badges"
import type { OutputFormState, ProductionRecord } from "./_components/output-types"
import {
  OUTPUT_MATERIALS,
  WARN_SEVERITY,
  buildProductionRecordKey,
  compareSoXe,
  parseVehicleCode,
  writeBackToDispatch,
  type WarnCode,
} from "./_components/output-types"
import { OutputImport } from "./_components/output-import"
import { OutputImportGuide } from "./_components/output-import-guide"
import { OutputForm } from "./_components/output-form"
import { OutputConverterView, FxToExcelIcon } from "./_components/output-converter-view"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { loadRequiredNotes } from "@/lib/required-notes"
import { EMPTY_NOTE_FILTER, isBlankNoteContent, matchesNoteFilterMulti } from "@/lib/note-filter"
import { downloadOutputDayPdf } from "@/lib/output-pdf"
import { formatDateDisplay, getFactoryTodayISO, getFirstDayOfMonthISO } from "@/lib/date-utils"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { DateTextInput } from "@/app/dashboard/_components/date-text-input"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { KpiLinkPrompt } from "@/app/dashboard/_components/kpi-link-prompt"
import { compareDoiNho, DOI_NHO_UNASSIGNED, doiOfDoiNho, resolveTripDoiNhoFilterKeys, type DiemGN } from "@/lib/dispatch-master"

interface DispatchEntry {
  id: string
  ngay: string
  rows: Array<{
    uid: string
    so_xe: string
    chuyen: number
    tai_xe: string
    diem_gn: string[]
  }>
}

interface DeliveryPoint {
  ma_lo: string
  doi: number
  doi_nho?: string | null
}

// Dự phòng khi chưa tải được điểm giao nhận; danh sách thật = các đội có trong dispatch_delivery_points.
const DOI_LON_FALLBACK = Array.from({ length: 12 }, (_, i) => i + 1)
const doiLonLabel = (v: string) => (v === "0" ? "Thu mua" : `Đội ${v}`)
const DOI_NHO_LABELS: Record<string, string> = { [DOI_NHO_UNASSIGNED]: "Chưa gán đội nhỏ" }

function toIsoDateKey(value: string): string {
  if (!value.includes("/")) return value.slice(0, 10)
  const [d, m, y] = value.split("/")
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
}

const MATERIAL_DEFS = OUTPUT_MATERIALS
const LATEX_FILTER_OPTIONS = MATERIAL_DEFS.map((def) => def.label)
type LatexFilterOption = typeof MATERIAL_DEFS[number]["label"]

function getActiveMaterialDefs(selected: string[]) {
  if (selected.length === 0) return MATERIAL_DEFS
  return MATERIAL_DEFS.filter((def) => selected.includes(def.label))
}

function getMaterialFlags(record: ProductionRecord) {
  return Object.fromEntries(
    MATERIAL_DEFS.map((def) => [def.label, Number(record[def.tuoiKey] ?? 0) > 0 || Number(record[def.khoKey] ?? 0) > 0]),
  ) as Record<LatexFilterOption, boolean>
}

function matchesMaterialFilter(record: ProductionRecord, selected: string[]) {
  if (selected.length === 0) return true
  const flags = getMaterialFlags(record)
  return selected.some((material) => flags[material as LatexFilterOption])
}

function fmtDate(iso: string) {
  return formatDateDisplay(iso)
}

function fmtNum(n: number | null | undefined, decimals = 1) {
  if (!n) return "—"
  return n.toLocaleString("vi-VN", { maximumFractionDigits: decimals })
}

function getFilteredTotals(record: ProductionRecord, selected: string[]) {
  const totals = { tuoi: 0, kho: 0 }
  for (const def of getActiveMaterialDefs(selected)) {
    totals.tuoi += Number(record[def.tuoiKey] ?? 0)
    totals.kho += Number(record[def.khoKey] ?? 0)
  }
  return totals
}

function getMaterialSummary(record: ProductionRecord, selected: string[] = []) {
  return getActiveMaterialDefs(selected)
    .map((def) => {
      const tuoi = Number(record[def.tuoiKey] ?? 0)
      const kho = Number(record[def.khoKey] ?? 0)
      if (tuoi <= 0 && kho <= 0) return null
      const parts: string[] = []
      if (tuoi > 0) parts.push(`tươi ${fmtNum(tuoi)}`)
      if (kho > 0) parts.push(`khô ${fmtNum(kho)}`)
      return `${def.shortLabel} ${parts.join(" / ")}`
    })
    .filter((part): part is string => Boolean(part))
}

function compareProductionRecordPriority(a: ProductionRecord, b: ProductionRecord) {
  const aStamp = a.updated_at || a.created_at || ""
  const bStamp = b.updated_at || b.created_at || ""
  if (aStamp !== bStamp) return bStamp.localeCompare(aStamp)
  if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at)
  return b.id.localeCompare(a.id)
}

const DAY_HREF = (ngay: string) => `/dashboard/output/day/${ngay}`

export default function OutputPage() {
  const router = useRouter()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [records, setRecords] = useState<ProductionRecord[]>([])
  const [dispatches, setDispatches] = useState<DispatchEntry[]>([])
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPoint[]>([])

  const [view, setView] = useState<"list" | "converter">("list")
  const [tab, setTab] = useState<"list" | "stats" | "import">("list")
  const [showImport, setShowImport] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editRecord, setEditRecord] = useState<ProductionRecord | null>(null)
  const [formInitialDate, setFormInitialDate] = useState<string | null>(null)
  const [detailDay, setDetailDay] = useState<string | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([])
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [cleaningDuplicates, setCleaningDuplicates] = useState(false)
  const [deletingRows, setDeletingRows] = useState(false)
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())
  const [converterToast, setConverterToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const showConverterToast = useCallback((msg: string, ok = true) => {
    setConverterToast({ msg, ok })
    window.setTimeout(() => setConverterToast(null), ok ? 3500 : 6000)
  }, [])

  const toggleDate = (ngay: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev)
      if (next.has(ngay)) next.delete(ngay)
      else next.add(ngay)
      return next
    })
  }

  // Mặc định đầu tháng → hôm nay theo giờ nhà máy (không dùng UTC: 00:00–06:59 ra ngày hôm qua).
  const [defaultRange] = useState(() => {
    const today = getFactoryTodayISO()
    return { from: getFirstDayOfMonthISO(today), to: today }
  })
  const [filterFrom, setFilterFrom] = useState(defaultRange.from)
  const [filterTo, setFilterTo] = useState(defaultRange.to)
  const [filterDoi, setFilterDoi] = useState<string[]>([])
  const [filterDoiNho, setFilterDoiNho] = useState<string[]>([])
  const [filterXe, setFilterXe] = useState("")
  const [filterGhiChu, setFilterGhiChu] = useState<string[]>([])
  const [filterLoai, setFilterLoai] = useState<string[]>([])
  const [filterWarnOnly, setFilterWarnOnly] = useState(false)
  const [requiredNotes, setRequiredNotes] = useState<string[]>([])

  // "Gắn bản ghi tại chỗ" — gợi ý gắn bản ghi vừa lưu vào công việc KPI đang mở hôm nay
  const [kpiPrompt, setKpiPrompt] = useState<null | { recordId: string; recordLabel: string }>(null)

  const isAdmin = currentUser?.role === "admin"
  const canCreate = hasPermission(currentUser, "output.create")
  const canEdit = hasPermission(currentUser, "output.edit")
  const canDelete = hasPermission(currentUser, "output.delete")
  const canImport = hasPermission(currentUser, "output.import")
  // Converter ghi thẳng vào production_records ⇒ ngoài quyền hỗ trợ kỹ thuật còn cần quyền ghi.
  const canUseConverter = isAdmin || (hasPermission(currentUser, "output.tech_support") && (canImport || canCreate))

  // Phân trang (PostgREST cắt im lặng ở 1000 dòng); ngày rỗng = không giới hạn phía đó.
  const fetchRecords = useCallback((fid: string) =>
    fetchAllPaginated<ProductionRecord>((from, to) => {
      let q = supabase
        .from("production_records")
        .select("*")
        .eq("factory_id", fid)
        .order("ngay", { ascending: false })
        .order("so_xe")
        .order("chuyen")
        .order("id")
      if (filterFrom) q = q.gte("ngay", filterFrom)
      if (filterTo) q = q.lte("ngay", filterTo)
      return q.range(from, to)
    }), [filterFrom, filterTo])

  const loadRecords = useCallback(async (fid: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      setRecords(await fetchRecords(fid))
    } catch (error) {
      setLoadError((error as { message?: string } | null)?.message || "Không tải được danh sách sản lượng.")
    } finally {
      setLoading(false)
    }
  }, [fetchRecords])

  const loadSupportData = useCallback(async (fid: string) => {
    const { data: dp } = await supabase
      .from("dispatch_delivery_points")
      .select("ma_lo, doi, doi_nho")
      .eq("factory_id", fid)
      .eq("is_active", true)
    setDeliveryPoints((dp as DeliveryPoint[]) || [])
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const [fid, authState] = await Promise.all([
        getActiveFactoryId(),
        hydrateActiveSession().catch(() => ({ session: null, user: null })),
      ])
      setCurrentUser((authState.user as SessionUser | null) ?? null)
      if (!hasPermission(authState.user as SessionUser | null, "output.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      if (!fid) {
        setLoading(false)
        return
      }
      setFactoryId(fid)
      await loadSupportData(fid)
    }
    void bootstrap()
  }, [loadSupportData])

  // Tải sản lượng + điều xe + danh mục ghi chú; lượt cũ về muộn bị bỏ qua (refreshSeq).
  const refreshSeq = useRef(0)
  const refreshAll = useCallback(async (fid: string) => {
    const seq = ++refreshSeq.current
    setLoading(true)
    setLoadError(null)
    try {
      const [recordsResult, dispatchResult, noteRows] = await Promise.all([
        fetchRecords(fid),
        loadDispatchEntriesWithResolvedRows<Pick<DispatchEntry, "id" | "ngay">>(supabase, {
          factoryId: fid,
          select: "id,ngay,rows",
          ascending: true,
        }),
        loadRequiredNotes(supabase, fid),
      ])
      if (seq !== refreshSeq.current) return
      setRecords(recordsResult)
      setDispatches(
        (dispatchResult || []).map((entry) => ({
          id: entry.id,
          ngay: entry.ngay,
          rows: Array.isArray(entry.rows)
            ? entry.rows.map((row: Pick<LegacyDispatchRow, "uid" | "so_xe" | "chuyen" | "tai_xe" | "diem_gn">) => ({
                uid: String(row.uid ?? ""),
                so_xe: String(row.so_xe ?? ""),
                chuyen: Number(row.chuyen ?? 1),
                tai_xe: String(row.tai_xe ?? ""),
                diem_gn: Array.isArray(row.diem_gn) ? row.diem_gn.map((item) => String(item)) : [],
              }))
            : [],
        })) as DispatchEntry[],
      )
      setRequiredNotes(noteRows.map((row) => row.content))
    } catch (error) {
      if (seq !== refreshSeq.current) return
      setRequiredNotes([])
      setLoadError((error as { message?: string } | null)?.message || "Không tải được dữ liệu sản lượng.")
    } finally {
      if (seq === refreshSeq.current) setLoading(false)
    }
  }, [fetchRecords])

  useEffect(() => {
    if (factoryId) void refreshAll(factoryId)
  }, [factoryId, refreshAll])

  // Đội nhỏ của từng bản ghi: lấy từ chuyến điều xe cùng ngày + xe + chuyến, chỉ giữ điểm GN
  // thuộc đúng đội lớn của bản ghi. Sản lượng nhập theo chuyến nên chuyến đi qua nhiều đội nhỏ
  // khớp với TẤT CẢ đội nhỏ đó (lọc 1.1 vẫn hiện cả chuyến 7A gộp 1.1 + 1.5).
  const doiNhoKeysByRecord = useMemo(() => {
    const points = deliveryPoints as unknown as DiemGN[]
    const tripIdx = new Map<string, { entryId: string; diem_gn: string[] }[]>()
    for (const entry of dispatches) {
      const dateKey = toIsoDateKey(entry.ngay)
      for (const row of entry.rows) {
        const key = `${dateKey}|${parseVehicleCode(row.so_xe.toUpperCase()).base_xe}|${row.chuyen}`
        const bucket = tripIdx.get(key)
        const item = { entryId: entry.id, diem_gn: row.diem_gn }
        if (bucket) bucket.push(item)
        else tripIdx.set(key, [item])
      }
    }
    const out = new Map<string, string[]>()
    for (const record of records) {
      const doi = record.doi ?? 0
      const trips = tripIdx.get(`${record.ngay}|${parseVehicleCode(record.so_xe.toUpperCase()).base_xe}|${record.chuyen}`) ?? []
      const trip = trips.find((t) => t.entryId === record.dispatch_entry_id) ?? trips[0]
      if (!trip || doi === 0) { out.set(record.id, [DOI_NHO_UNASSIGNED]); continue }
      const inDoi = trip.diem_gn.filter((code) => points.find((p) => p.ma_lo === code)?.doi === doi)
      out.set(record.id, inDoi.length > 0 ? resolveTripDoiNhoFilterKeys(inDoi, points) : [DOI_NHO_UNASSIGNED])
    }
    return out
  }, [records, dispatches, deliveryPoints])

  const matchesDoiFilters = (record: ProductionRecord) => {
    if (filterDoi.length > 0 && !filterDoi.includes(String(record.doi ?? 0))) return false
    if (filterDoiNho.length > 0) {
      const keys = doiNhoKeysByRecord.get(record.id) ?? [DOI_NHO_UNASSIGNED]
      if (!keys.some((k) => filterDoiNho.includes(k))) return false
    }
    return true
  }

  const doiLonOptions = useMemo(() => {
    const fromPoints = [...new Set(deliveryPoints.map((p) => p.doi).filter((d) => Number.isFinite(d) && d > 0))]
    const dois = (fromPoints.length ? fromPoints : DOI_LON_FALLBACK).sort((a, b) => a - b)
    return ["0", ...dois.map(String)]
  }, [deliveryPoints])
  const doiLonLabels = useMemo(
    () => Object.fromEntries(doiLonOptions.map((v) => [v, doiLonLabel(v)])) as Record<string, string>,
    [doiLonOptions],
  )

  // Đội nhỏ: lấy từ điểm GN, lọc theo đội lớn đã chọn (mirror dispatch/page.tsx).
  const doiNhoOptions = (() => {
    const selectedDois = filterDoi.map(Number)
    const inScope = deliveryPoints.filter((p) => selectedDois.length === 0 || selectedDois.includes(p.doi))
    const values = [...new Set(inScope.map((p) => p.doi_nho).filter((v): v is string => !!v))].sort(compareDoiNho)
    if (inScope.some((p) => !p.doi_nho) || selectedDois.length === 0 || selectedDois.includes(0)) values.push(DOI_NHO_UNASSIGNED)
    return values
  })()

  // Đổi đội lớn → tự bỏ các đội nhỏ không còn thuộc đội lớn đã chọn.
  const handleDoiChange = (next: string[]) => {
    setFilterDoi(next)
    if (next.length === 0) return
    const dois = next.map(Number)
    setFilterDoiNho((prev) => prev.filter((v) => v === DOI_NHO_UNASSIGNED || dois.includes(doiOfDoiNho(v) ?? -1)))
  }

  const filtered = records
    .filter((record) => {
      if (!matchesDoiFilters(record)) return false
      if (filterXe && !record.so_xe.toUpperCase().includes(filterXe.toUpperCase())) return false
      if (!matchesNoteFilterMulti(record.ghi_chu, filterGhiChu)) return false
      if (!matchesMaterialFilter(record, filterLoai)) return false
      if (filterWarnOnly && record.warn_codes.length === 0) return false
      return true
    })
    .sort((a, b) => {
      if (a.ngay !== b.ngay) return b.ngay.localeCompare(a.ngay)
      if (a.doi !== b.doi) return (a.doi ?? 0) - (b.doi ?? 0)
      const xeCompare = compareSoXe(a.so_xe, b.so_xe)
      if (xeCompare !== 0) return xeCompare
      return a.chuyen - b.chuyen
    })

  const groupedDates = Array.from(
    filtered.reduce((map, record) => {
      const bucket = map.get(record.ngay)
      if (bucket) bucket.push(record)
      else map.set(record.ngay, [record])
      return map
    }, new Map<string, ProductionRecord[]>()),
  ).map(([ngay, dayRecords]) => ({
    ngay,
    records: dayRecords,
    totalTuoi: dayRecords.reduce((sum, record) => sum + getFilteredTotals(record, filterLoai).tuoi, 0),
    totalKho: dayRecords.reduce((sum, record) => sum + getFilteredTotals(record, filterLoai).kho, 0),
  }))

  const allDateKeys = useMemo(() => groupedDates.map((g) => g.ngay), [groupedDates])
  const allDatesExpanded = allDateKeys.length > 0 && allDateKeys.every((k) => expandedDates.has(k))

  const detailGroup = detailDay ? groupedDates.find((group) => group.ngay === detailDay) ?? null : null
  const selectedDetailRecords = detailGroup
    ? detailGroup.records.filter((record) => selectedRowIds.includes(record.id))
    : []

  const duplicateBuckets = new Map<string, ProductionRecord[]>()
  for (const record of records) {
    const key = buildProductionRecordKey(record)
    const bucket = duplicateBuckets.get(key)
    if (bucket) bucket.push(record)
    else duplicateBuckets.set(key, [record])
  }
  const duplicateGroups = Array.from(duplicateBuckets.values()).filter((bucket) => bucket.length > 1)
  const redundantRecords = duplicateGroups.flatMap((bucket) => [...bucket].sort(compareProductionRecordPriority).slice(1))
  const redundantRecordCount = redundantRecords.length

  const statsFiltered = records.filter((record) => {
    if (!matchesNoteFilterMulti(record.ghi_chu, filterGhiChu)) return false
    if (!matchesDoiFilters(record)) return false
    if (!matchesMaterialFilter(record, filterLoai)) return false
    return true
  })
  const totalTuoiAll = statsFiltered.reduce((sum, record) => sum + getFilteredTotals(record, filterLoai).tuoi, 0)
  const totalKhoAll = statsFiltered.reduce((sum, record) => sum + getFilteredTotals(record, filterLoai).kho, 0)
  const warnCount = statsFiltered.filter((record) => record.warn_codes.length > 0).length

  const byDoi = new Map<number, number>()
  for (const record of statsFiltered) {
    const kho = getFilteredTotals(record, filterLoai).kho
    const doiKey = record.doi ?? 0
    byDoi.set(doiKey, (byDoi.get(doiKey) ?? 0) + kho)
  }

  const byVehicle = new Map<string, { doi: number; taiXe: string; tuoi: number; kho: number }>()
  for (const record of statsFiltered) {
    const doiKey = record.doi ?? 0
    const key = `${doiKey}:${record.so_xe}:${record.chuyen}`
    const totals = getFilteredTotals(record, filterLoai)
    const current = byVehicle.get(key)
    if (current) {
      current.tuoi += totals.tuoi
      current.kho += totals.kho
    } else {
      byVehicle.set(key, {
        doi: doiKey,
        taiXe: record.tai_xe ?? "",
        tuoi: totals.tuoi,
        kho: totals.kho,
      })
    }
  }

  const hasActiveFilters = Boolean(
    filterFrom !== defaultRange.from || filterTo !== defaultRange.to || filterDoi.length > 0 || filterDoiNho.length > 0 || filterXe || filterGhiChu.length > 0 || filterLoai.length > 0 || filterWarnOnly,
  )

  const resetFilters = () => {
    setFilterFrom(defaultRange.from)
    setFilterTo(defaultRange.to)
    setFilterDoi([])
    setFilterDoiNho([])
    setFilterXe("")
    setFilterGhiChu([])
    setFilterLoai([])
    setFilterWarnOnly(false)
  }

  const openCreateForDate = (ngay: string) => {
    setEditRecord(null)
    setFormInitialDate(ngay)
    setShowForm(true)
  }

  const openEditRecord = (record: ProductionRecord) => {
    setEditRecord(record)
    setFormInitialDate(record.ngay)
    setShowForm(true)
  }

  const openDayDetail = (ngay: string) => {
    setDetailDay(ngay)
    setSelectedRowIds([])
  }

  const toggleRowSelection = (id: string) => {
    setSelectedRowIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const toggleSelectAllRows = (dayRecords: ProductionRecord[]) => {
    const ids = dayRecords.map((record) => record.id)
    const isAllSelected = ids.length > 0 && ids.every((id) => selectedRowIds.includes(id))
    setSelectedRowIds(isAllSelected ? [] : ids)
  }

  const handleExportDayPdf = async (ngay: string, dayRecords: ProductionRecord[]) => {
    if (dayRecords.length === 0) return
    try {
      await downloadOutputDayPdf({
        ngay,
        records: dayRecords,
        makerName: currentUser?.full_name,
        qrUrl: `${window.location.origin}${DAY_HREF(ngay)}`,
      })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không tạo được PDF ngày.")
    }
  }

  // Quét QR ở ô tìm: QR trang ngày ⇒ mở trang đó; chuỗi khác ⇒ đưa vào ô tìm số xe.
  const handleScanDecoded = (text: string) => {
    setScanOpen(false)
    const m = text.match(/\/dashboard\/output\/day\/(\d{4}-\d{2}-\d{2})/)
    if (m) {
      router.push(DAY_HREF(m[1]))
      return
    }
    setFilterXe(text.trim())
  }

  // `?day=<ngày>` (Sửa / Xóa dòng) và `?add=<ngày>` (Thêm dòng) từ trang chi tiết ngày — xử lý 1 lần.
  const queryHandled = useRef(false)
  useEffect(() => {
    if (queryHandled.current || !factoryId || !currentUser || loading) return
    queryHandled.current = true
    let params: URLSearchParams
    try { params = new URLSearchParams(window.location.search) } catch { return }
    const isIso = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
    const day = params.get("day")
    const add = params.get("add")
    if (isIso(day)) {
      if (!filterFrom || day < filterFrom) setFilterFrom(day)
      if (!filterTo || day > filterTo) setFilterTo(day)
      setTab("list")
      setDetailDay(day)
      setSelectedRowIds([])
    } else if (isIso(add) && (isAdmin || canCreate)) {
      setEditRecord(null)
      setFormInitialDate(add)
      setShowForm(true)
    }
    if (day || add) window.history.replaceState(null, "", window.location.pathname)
  }, [factoryId, currentUser, loading, filterFrom, filterTo, isAdmin, canCreate])

  const handleSave = async (form: OutputFormState) => {
    if (!factoryId) return
    if (!editRecord && !canCreate) {
      setSaveError("Bạn không có quyền thêm mới sản lượng.")
      return
    }
    if (editRecord && !canEdit) {
      setSaveError("Bạn không có quyền sửa sản lượng.")
      return
    }

    setSaveError(null)
    const isInternal = form.ma_nguon === "cs"
    const parsedDoi = isInternal
      ? (typeof form.doi === "number" ? form.doi : parseInt(String(form.doi)) || 1)
      : null

    const payload: Record<string, unknown> = {
      factory_id: factoryId,
      ngay: form.ngay,
      doi: parsedDoi,
      so_xe: form.so_xe.trim().toUpperCase(),
      chuyen: Number(form.chuyen),
      tai_xe: form.tai_xe || null,
      mn_tuoi: parseFloat(form.mn_tuoi) || 0,
      mn_drc: parseFloat(form.mn_drc) || 0,
      mn_kho: parseFloat(form.mn_kho) || 0,
      ct_tuoi: parseFloat(form.ct_tuoi) || 0,
      ct_drc: parseFloat(form.ct_drc) || 0,
      ct_kho: parseFloat(form.ct_kho) || 0,
      dct_tuoi: parseFloat(form.dct_tuoi) || 0,
      dct_drc: parseFloat(form.dct_drc) || 0,
      dct_kho: parseFloat(form.dct_kho) || 0,
      dkt_tuoi: parseFloat(form.dkt_tuoi) || 0,
      dkt_drc: parseFloat(form.dkt_drc) || 0,
      dkt_kho: parseFloat(form.dkt_kho) || 0,
      dt_tuoi: parseFloat(form.dt_tuoi) || 0,
      dt_drc: parseFloat(form.dt_drc) || 0,
      dt_kho: parseFloat(form.dt_kho) || 0,
      ghi_chu: form.ghi_chu || null,
      ghi_chu_tu_do: form.ghi_chu_tu_do?.trim() || null,
      ma_nguon: form.ma_nguon || "cs",
      nguoi_upload: currentUser?.full_name || currentUser?.username || null,
      created_by: currentUser?.id ?? null,
    }

    // created_by / nguoi_upload chỉ ghi khi TẠO MỚI — sửa không được ghi đè người tạo gốc (S7).
    const creatorFields = {
      nguoi_upload: currentUser?.full_name || currentUser?.username || null,
      created_by: currentUser?.id ?? null,
    }
    delete payload.nguoi_upload
    delete payload.created_by

    // Tìm bản ghi đã có cùng khoá (ngày + xe + chuyến + đội; đội NULL phải so bằng `is`)
    const findExistingId = async (dataPayload: Record<string, unknown>) => {
      let query = supabase.from("production_records")
        .select("id")
        .eq("factory_id", dataPayload.factory_id as string)
        .eq("ngay", dataPayload.ngay as string)
        .eq("so_xe", dataPayload.so_xe as string)
        .eq("chuyen", dataPayload.chuyen as number)
      query = dataPayload.doi === null || dataPayload.doi === undefined
        ? query.is("doi", null)
        : query.eq("doi", dataPayload.doi as number)
      const { data, error } = await query.limit(1)
      if (error) throw new Error(error.message)
      return (data?.[0] as { id: string } | undefined)?.id ?? null
    }

    const executeSave = async (dataPayload: Record<string, unknown>) => {
      if (editRecord) {
        return supabase.from("production_records").update(dataPayload).eq("id", editRecord.id).select("id").single()
      }
      const existingId = await findExistingId(dataPayload)
      if (existingId) {
        return supabase.from("production_records").update(dataPayload).eq("id", existingId).select("id").single()
      }
      return supabase.from("production_records").insert({ ...dataPayload, ...creatorFields }).select("id").single()
    }

    let res = await executeSave(payload)
    if (res.error && res.error.message.includes("does not exist")) {
      const fallback = { ...payload }
      delete fallback.ghi_chu_tu_do
      delete fallback.ma_nguon
      res = await executeSave(fallback)
    }
    if (res.error) throw new Error(res.error.message)
    const savedId = res.data?.id ?? editRecord?.id ?? null

    // Đã lưu xong ⇒ đóng form. Ghi ngược điều xe chạy SAU; lỗi ở bước này phải báo ra (không nuốt)
    // và danh sách vẫn phải tải lại (S4). Sửa đổi ngày ⇒ ghi ngược cả ngày CŨ (S3).
    const oldNgay = editRecord?.ngay
    setShowForm(false)
    setEditRecord(null)
    try {
      await writeBackToDispatch(factoryId, form.ngay, supabase)
      if (oldNgay && oldNgay !== form.ngay) await writeBackToDispatch(factoryId, oldNgay, supabase)
    } catch (error) {
      setSaveError(`Đã lưu sản lượng nhưng chưa ghi ngược được sang Điều xe: ${error instanceof Error ? error.message : "lỗi không xác định"}`)
    }
    await loadRecords(factoryId)
    if (savedId) {
      setKpiPrompt({
        recordId: savedId,
        recordLabel: `Sản lượng ${form.ngay} — Xe ${form.so_xe} ch.${form.chuyen}`,
      })
    }
  }

  const handleDelete = async (id: string) => {
    if (!factoryId || !canDelete) return
    const record = records.find((item) => item.id === id)
    try {
      const { error } = await supabase.from("production_records").delete().eq("id", id).eq("factory_id", factoryId)
      if (error) throw new Error(error.message)
      setDelConfirm(null)
      if (record) await writeBackToDispatch(factoryId, record.ngay, supabase)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể xóa bản ghi sản lượng.")
    } finally {
      await loadRecords(factoryId)
    }
  }

  const handleDeleteSelectedRows = async () => {
    if (!factoryId || !detailGroup || selectedRowIds.length === 0 || !canDelete) return
    setDeletingRows(true)
    try {
      const { error } = await supabase.from("production_records").delete().in("id", selectedRowIds).eq("factory_id", factoryId)
      if (error) throw new Error(error.message)
      setSelectedRowIds([])
      setDetailDay(null)
      await writeBackToDispatch(factoryId, detailGroup.ngay, supabase)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể xóa các dòng đã chọn.")
    } finally {
      setDeletingRows(false)
      await loadRecords(factoryId)
    }
  }

  const handleCleanupDuplicates = async () => {
    if (!factoryId || !isAdmin || redundantRecordCount === 0) return
    setCleaningDuplicates(true)
    try {
      const deleteIds = redundantRecords.map((record) => record.id)
      const affectedDates = [...new Set(redundantRecords.map((record) => record.ngay))]
      const { error } = await supabase.from("production_records").delete().in("id", deleteIds)
      if (error) throw new Error(error.message)
      // Tuần tự: mỗi lần writeBack đọc-rồi-ghi phiếu điều xe; chạy song song nhiều ngày có thể ghi đè lẫn nhau.
      for (const ngay of affectedDates) {
        await writeBackToDispatch(factoryId, ngay, supabase)
      }
      await loadRecords(factoryId)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể dọn các dòng sản lượng thừa.")
    } finally {
      setCleaningDuplicates(false)
    }
  }

  if (view === "converter" && factoryId && canUseConverter) {
    return (
      <>
      {converterToast && (
        <div className={`fixed top-4 left-1/2 z-[120] max-w-xl -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-2xl ${converterToast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
          {converterToast.msg}
        </div>
      )}
      <OutputConverterView
        currentUser={currentUser}
        factoryId={factoryId}
        showToast={showConverterToast}
        onBack={() => setView("list")}
        onSuccess={() => {
          setView("list")
          if (factoryId) void loadRecords(factoryId)
        }}
      />
      </>
    )
  }

  return (
    <div className={`p-4 sm:p-6 space-y-4 ${moduleThemeClass("forest")}`}>
      <PageBackgroundMotif theme="forest"/>
      {kpiPrompt && (
        <KpiLinkPrompt
          factoryId={factoryId}
          moduleCode="output:save"
          recordId={kpiPrompt.recordId}
          recordLabel={kpiPrompt.recordLabel}
          recordUrl="/dashboard/output"
          onDone={() => setKpiPrompt(null)}
        />
      )}
      <PageHeaderBanner
        title="Sản lượng"
        subtitle="Sản lượng mủ nhập về theo ngày · đội · xe · chuyến, đối soát với Điều xe"
        theme="forest"
        icon={Droplet}
        action={
          <>
            {canUseConverter && (
              <button
                type="button"
                onClick={() => setView("converter")}
                title="Hỗ trợ kỹ thuật: Bóc tách Báo cáo Trạm cân & Đối soát Điều xe"
                className="flex items-center justify-center px-3 py-2 text-white border border-white/40 bg-white/15 hover:bg-white/25 active:scale-95 rounded-xl transition-all shadow-xs"
              >
                <FxToExcelIcon className="w-9 h-5 text-white" />
              </button>
            )}
            {(isAdmin || canImport) && (
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/40 bg-white/15 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-white/25"
              >
                <Upload size={15} />
                Import file
              </button>
            )}
            {(isAdmin || canCreate) && (
              <button
                onClick={() => { setEditRecord(null); setFormInitialDate(null); setShowForm(true) }}
                className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 font-bold text-brand shadow-sm transition-all hover:bg-white/90"
              >
                <Plus size={16} />
                Thêm mới
              </button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <SegmentedTabs
          ariaLabel="Chọn chế độ xem sản lượng"
          value={tab}
          onChange={setTab}
          items={[
            { key: "list", label: "Danh sách", icon: Calendar },
            { key: "stats", label: "Thống kê", icon: BarChart3 },
            { key: "import", label: "Hướng dẫn Import", icon: Upload },
          ]}
        />
      </div>

      <FilterBar
        className="mb-5"
        layout="grid"
        activeCount={(filterFrom !== defaultRange.from ? 1 : 0) + (filterTo !== defaultRange.to ? 1 : 0) + (filterXe ? 1 : 0) + (filterDoi.length > 0 ? 1 : 0) + (filterDoiNho.length > 0 ? 1 : 0) + (filterGhiChu.length > 0 ? 1 : 0) + (filterLoai.length > 0 ? 1 : 0) + (filterWarnOnly ? 1 : 0)}
      >
          {tab === "list" && (
            <div className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 focus-within:border-emerald-400">
              <Search size={15} className="shrink-0 text-slate-400" />
              <input value={filterXe} onChange={(e) => setFilterXe(e.target.value)} placeholder="Tìm số xe..." className="w-full min-w-0 text-sm outline-none" />
              <QrScanButton onClick={() => setScanOpen(true)} title="Quét QR phiếu sản lượng ngày" />
            </div>
          )}

          <div className="flex w-full items-center gap-2 sm:col-span-2 [&>*]:min-w-0">
            <CalendarDays size={15} className="shrink-0 text-slate-500" />
            <DateTextInput value={filterFrom} onChange={setFilterFrom} className="w-full min-w-0 flex-1 text-sm rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400" />
            <span className="shrink-0 text-slate-300 text-sm">→</span>
            <DateTextInput value={filterTo} onChange={setFilterTo} className="w-full min-w-0 flex-1 text-sm rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400" />
          </div>

          {(tab === "list" || tab === "stats") && (
            <>
              <FilterMultiSelect
                options={doiLonOptions}
                selected={filterDoi}
                onChange={handleDoiChange}
                labels={doiLonLabels}
                placeholder="Tất cả đội lớn"
                searchPlaceholder="Tìm đội lớn..."
                fullWidth
              />

              <FilterMultiSelect
                options={doiNhoOptions}
                selected={filterDoiNho}
                onChange={setFilterDoiNho}
                labels={DOI_NHO_LABELS}
                placeholder="Tất cả đội nhỏ"
                searchPlaceholder="Tìm đội nhỏ..."
                fullWidth
              />

              <FilterMultiSelect
                options={LATEX_FILTER_OPTIONS}
                selected={filterLoai}
                onChange={setFilterLoai}
                placeholder="Tất cả nguyên liệu"
                fullWidth
              />

              <FilterMultiSelect
                options={[EMPTY_NOTE_FILTER, ...requiredNotes]}
                selected={filterGhiChu}
                onChange={setFilterGhiChu}
                labels={{ [EMPTY_NOTE_FILTER]: "Không có ghi chú" }}
                placeholder="Tất cả ghi chú đội"
                searchPlaceholder="Tìm ghi chú..."
                fullWidth
              />
            </>
          )}

          <div className={`col-span-full flex flex-wrap items-center justify-end gap-2 ${tab === "list" ? "xl:col-span-5" : ""}`}>
            {tab === "list" && (
              <button
                onClick={() => setFilterWarnOnly((value) => !value)}
                className={`mr-auto rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                  filterWarnOnly
                    ? "border border-amber-300 bg-amber-100 text-amber-700"
                    : "border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
                }`}
              >
                Chỉ cảnh báo
              </button>
            )}
            {isAdmin && redundantRecordCount > 0 && (
              <button
                onClick={() => void handleCleanupDuplicates()}
                disabled={cleaningDuplicates}
                className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-200 disabled:opacity-60"
              >
                <AlertTriangle size={12} />
                {cleaningDuplicates ? "Đang dọn..." : `Dọn ${redundantRecordCount} dòng thừa`}
              </button>
            )}
            {hasActiveFilters && (
              <button onClick={resetFilters} className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-500">
                <X size={14} />
                Xóa lọc
              </button>
            )}
            <span className="text-xs text-slate-400">{records.length} bản ghi trong kỳ</span>
          </div>
      </FilterBar>

      {/* List content */}
      {tab === "list" && (loading || loadError || filtered.length === 0) ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          {loading ? (
            <ListState kind="loading" message="Đang tải dữ liệu sản lượng…" />
          ) : loadError ? (
            <ListState kind="error" message={loadError} onRetry={() => { if (factoryId) void refreshAll(factoryId) }} />
          ) : (
            <ListState kind="empty" message="Không tìm thấy bản ghi nào — thử đổi khoảng ngày hoặc điều kiện lọc" />
          )}
        </div>
      ) : tab === "list" ? (
        detailGroup ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
              <button onClick={() => { setDetailDay(null); setSelectedRowIds([]) }} className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100">
                <X size={18} />
              </button>
              <div className="flex-1">
                <h2 className="text-2xl font-extrabold text-slate-800">Sản lượng ngày {fmtDate(detailGroup.ngay)}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>{detailGroup.records.length} dòng</span>
                  <span>·</span>
                  <span>Tươi {fmtNum(detailGroup.totalTuoi, 0)} kg</span>
                  <span>·</span>
                  <span>Khô {fmtNum(detailGroup.totalKho, 0)} kg</span>
                </p>
                <p className="mt-2 text-xs text-slate-400">Chọn 1 dòng để sửa hoặc chọn nhiều dòng để xóa.</p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button onClick={() => void handleExportDayPdf(detailGroup.ngay, detailGroup.records)} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100">
                  <FileText size={14} />
                  PDF ngày
                </button>
                {(isAdmin || canCreate || canEdit || canDelete) && (
                  <>
                    {(isAdmin || canCreate) && (
                      <button onClick={() => openCreateForDate(detailGroup.ngay)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                        <Plus size={14} />
                        Thêm dòng
                      </button>
                    )}
                    {(isAdmin || canEdit) && (
                      <button
                        onClick={() => selectedDetailRecords.length === 1 && openEditRecord(selectedDetailRecords[0])}
                        disabled={selectedDetailRecords.length !== 1}
                        className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        <Pencil size={14} />
                        Sửa
                      </button>
                    )}
                    {(isAdmin || canDelete) && (
                      <button
                        onClick={() => void handleDeleteSelectedRows()}
                        disabled={selectedDetailRecords.length === 0 || deletingRows}
                        className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        {deletingRows ? "Đang xóa..." : `Xóa ${selectedDetailRecords.length || ""}`.trim()}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            <ResponsiveTableWrapper className="rounded-2xl">
              <table className="enterprise-table dense w-full min-w-[1080px]">
                <thead>
                  <tr>
                    {(isAdmin || canEdit || canDelete) && (
                      <th className="w-10">
                        <input
                          type="checkbox"
                          checked={detailGroup.records.length > 0 && selectedRowIds.length === detailGroup.records.length}
                          onChange={() => toggleSelectAllRows(detailGroup.records)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                      </th>
                    )}
                    {["Xe", "Chuyến", "Đội / Nguồn", "Tài xế", "Nguyên liệu", "KL tươi", "KL khô", "Cảnh báo", "Ký hiệu KT", "Ghi chú", "Người Upload"].map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                    {(isAdmin || canEdit || canDelete) && <th className="text-right">Thao tác</th>}
                  </tr>
                </thead>
                <tbody>
                  {detailGroup.records.map((record) => {
                    const totals = getFilteredTotals(record, filterLoai)
                    const materials = getMaterialSummary(record, filterLoai)
                    const hasRed = record.warn_codes.some((code) => WARN_SEVERITY[code as WarnCode] === "red")
                    const hasAmber = !hasRed && record.warn_codes.some((code) => WARN_SEVERITY[code as WarnCode] === "amber")
                    const rowClass = selectedRowIds.includes(record.id)
                      ? "bg-blue-50"
                      : hasRed
                        ? "bg-red-50/60"
                        : hasAmber
                          ? "bg-amber-50/60"
                          : ""
                    return (
                      <tr key={record.id} className={rowClass}>
                        {(isAdmin || canEdit || canDelete) && (
                          <td>
                            <input type="checkbox" checked={selectedRowIds.includes(record.id)} onChange={() => toggleRowSelection(record.id)} className="h-4 w-4 rounded border-slate-300 text-blue-600" />
                          </td>
                        )}
                        <td className="font-bold text-mod-800">{record.so_xe || "—"}</td>
                        <td><span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{record.chuyen}</span></td>
                        <td className="font-semibold text-slate-700">
                          <OutputSourceCell record={record} />
                        </td>
                        <td className="text-slate-700">{record.tai_xe || "—"}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {materials.length > 0 ? materials.map((part) => (
                              <span key={part} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{part}</span>
                            )) : <span className="text-slate-400">—</span>}
                          </div>
                        </td>
                        <td className="text-right font-semibold text-slate-700">{fmtNum(totals.tuoi, 0)} kg</td>
                        <td className="text-right font-bold text-mod-800">{fmtNum(totals.kho, 0)} kg</td>
                        <td>
                          {(record.warn_codes as WarnCode[]).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {record.warn_codes.map((code) => <OutputWarnBadge key={code} code={code} />)}
                            </div>
                          ) : <span className="text-slate-400">Không có</span>}
                        </td>
                        <td className="font-medium">
                          {record.ghi_chu ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-bold font-mono text-xs">
                              {record.ghi_chu}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-slate-600 max-w-44 truncate" title={record.ghi_chu_tu_do || undefined}>
                          {record.ghi_chu_tu_do || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-slate-500">{record.nguoi_upload || "—"}</td>
                        {(isAdmin || canEdit || canDelete) && (
                          <td className="text-right">
                            <IconActionGroup>
                              {(isAdmin || canEdit) && (
                                <RowAction
                                  kind="edit"
                                  label="Sửa dòng"
                                  onClick={() => openEditRecord(record)}
                                />
                              )}
                              {(isAdmin || canDelete) && (
                                <RowAction
                                  kind="delete"
                                  label="Xóa dòng"
                                  onClick={() => setDelConfirm(record.id)}
                                />
                              )}
                            </IconActionGroup>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ResponsiveTableWrapper>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-end border-b border-slate-100 bg-white px-3 py-2 rounded-t-xl border border-b-0 border-slate-200">
              <ExpandAllToggle
                allExpanded={allDatesExpanded}
                disabled={groupedDates.length === 0}
                onExpandAll={() => setExpandedDates(new Set(allDateKeys))}
                onCollapseAll={() => setExpandedDates(new Set())}
              />
            </div>
            <ResponsiveTableWrapper className="rounded-none border-t-0">
              <table className="enterprise-table dense min-w-[980px]">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Số xe / dòng</th>
                    <th>Ký hiệu KT</th>
                    <th>Người Upload</th>
                    <th>Cảnh báo</th>
                    <th className="text-right">Tổng tươi</th>
                    <th className="text-right">Tổng khô</th>
                    <ExpandHeaderCell>Thao tác</ExpandHeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {groupedDates.map(({ ngay, records: dayRecords, totalTuoi, totalKho }) => {
                    const isExpanded = expandedDates.has(ngay)
                    const vehicleCount = [...new Set(dayRecords.map((record) => record.so_xe))].length
                    const notes = [...new Set(dayRecords.map((record) => record.ghi_chu).filter((note) => !isBlankNoteContent(note)))]
                    const uploaders = [...new Set(
                      dayRecords
                        .map((record) => record.nguoi_upload?.trim())
                        .filter((name): name is string => Boolean(name)),
                    )]
                    const dayWarnCount = dayRecords.reduce((sum, record) => sum + record.warn_codes.length, 0)
                    return (
                      <ExpandableRow
                        key={ngay}
                        expanded={isExpanded}
                        onToggle={() => toggleDate(ngay)}
                        canExpand={dayRecords.length > 0}
                        colSpan={8}
                        endCell={
                          <IconActionGroup>
                            <RowAction
                              kind="view"
                              label="Xem chi tiết ngày"
                              onClick={(e) => { e.stopPropagation(); router.push(DAY_HREF(ngay)) }}
                            />
                            <RowAction
                              kind="draft"
                              label="Xuất PDF ngày"
                              onClick={(e) => { e.stopPropagation(); void handleExportDayPdf(ngay, dayRecords) }}
                            />
                            {(isAdmin || canCreate) && (
                              <RowAction
                                kind="add"
                                label="Thêm dòng cho ngày này"
                                onClick={(e) => { e.stopPropagation(); openCreateForDate(ngay) }}
                              />
                            )}
                          </IconActionGroup>
                        }
                        detail={
                          <div className="py-2.5 pl-2">
                            <div className="mb-2.5 flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-wider text-mod-800">
                                Chi tiết sản lượng ngày {fmtDate(ngay)} ({dayRecords.length} dòng xe)
                              </span>
                              <button
                                type="button"
                                onClick={() => openDayDetail(ngay)}
                                className="text-xs font-semibold text-mod-700 hover:underline"
                              >
                                Mở bảng chi tiết có chọn dòng xóa/sửa →
                              </button>
                            </div>
                            <table className="enterprise-table dense w-full">
                              <thead>
                                <tr>
                                  <th>Xe</th>
                                  <th>Chuyến</th>
                                  <th>Đội / Nguồn</th>
                                  <th>Tài xế</th>
                                  <th>Nguyên liệu</th>
                                  <th className="text-right">KL tươi</th>
                                  <th className="text-right">KL khô</th>
                                  <th>Cảnh báo</th>
                                  <th>Ký hiệu KT</th>
                                  <th>Ghi chú</th>
                                  <th>Người Upload</th>
                                  {(isAdmin || canEdit || canDelete) && <th className="text-right">Thao tác</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {dayRecords.map((record) => {
                                  const totals = getFilteredTotals(record, filterLoai)
                                  const materials = getMaterialSummary(record, filterLoai)
                                  const hasRed = record.warn_codes.some((code) => WARN_SEVERITY[code as WarnCode] === "red")
                                  const hasAmber = !hasRed && record.warn_codes.some((code) => WARN_SEVERITY[code as WarnCode] === "amber")
                                  return (
                                    <tr key={record.id} className={hasRed ? "bg-red-50/50" : hasAmber ? "bg-amber-50/50" : ""}>
                                      <td className="font-bold text-mod-800">{record.so_xe || "—"}</td>
                                      <td><span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{record.chuyen}</span></td>
                                      <td className="font-semibold text-slate-700">
                                        <OutputSourceCell record={record} />
                                      </td>
                                      <td className="text-slate-700">{record.tai_xe || "—"}</td>
                                      <td>
                                        <div className="flex flex-wrap gap-1">
                                          {materials.length > 0 ? materials.map((part) => (
                                            <span key={part} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{part}</span>
                                          )) : <span className="text-slate-400">—</span>}
                                        </div>
                                      </td>
                                      <td className="text-right font-semibold text-slate-700">{fmtNum(totals.tuoi, 0)} kg</td>
                                      <td className="text-right font-bold text-mod-800">{fmtNum(totals.kho, 0)} kg</td>
                                      <td>
                                        {(record.warn_codes as WarnCode[]).length > 0 ? (
                                          <div className="flex flex-wrap gap-1">
                                            {record.warn_codes.map((code) => <OutputWarnBadge key={code} code={code} />)}
                                          </div>
                                        ) : <span className="text-slate-400">Không có</span>}
                                      </td>
                                      <td className="font-medium">
                                        {record.ghi_chu ? (
                                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-bold font-mono text-xs">
                                            {record.ghi_chu}
                                          </span>
                                        ) : <span className="text-slate-300">—</span>}
                                      </td>
                                      <td className="text-slate-600 max-w-44 truncate" title={record.ghi_chu_tu_do || undefined}>
                                        {record.ghi_chu_tu_do || <span className="text-slate-300">—</span>}
                                      </td>
                                      <td className="text-slate-500">{record.nguoi_upload || "—"}</td>
                                      {(isAdmin || canEdit || canDelete) && (
                                        <td className="text-right">
                                          <IconActionGroup>
                                            {(isAdmin || canEdit) && (
                                              <RowAction
                                                kind="edit"
                                                label="Sửa dòng"
                                                onClick={() => openEditRecord(record)}
                                              />
                                            )}
                                            {(isAdmin || canDelete) && (
                                              <RowAction
                                                kind="delete"
                                                label="Xóa dòng"
                                                onClick={() => setDelConfirm(record.id)}
                                              />
                                            )}
                                          </IconActionGroup>
                                        </td>
                                      )}
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        }
                      >
                        <td className="font-bold text-slate-800">{fmtDate(ngay)}</td>
                        <td className="text-slate-700">{vehicleCount} xe / {dayRecords.length} dòng</td>
                        <td className="text-slate-500">{notes.length > 0 ? notes.join(", ") : "—"}</td>
                        <td className="text-slate-500">{uploaders.length > 0 ? uploaders.join(", ") : "—"}</td>
                        <td>
                          {dayWarnCount > 0 ? (
                            <StatusBadge tone="warn" label={`${dayWarnCount} cảnh báo`} size="xs" />
                          ) : (
                            <span className="text-slate-400">Không có</span>
                          )}
                        </td>
                        <td className="text-right font-medium text-slate-700">{fmtNum(totalTuoi, 0)} kg</td>
                        <td className="text-right font-bold text-mod-800">{fmtNum(totalKho, 0)} kg</td>
                      </ExpandableRow>
                    )
                  })}
                </tbody>
              </table>
            </ResponsiveTableWrapper>
          </div>
        )
      ) : null}

      {tab === "stats" && (loading || loadError || statsFiltered.length === 0) && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          {loading ? (
            <ListState kind="loading" message="Đang tải dữ liệu sản lượng…" />
          ) : loadError ? (
            <ListState kind="error" message={loadError} onRetry={() => { if (factoryId) void refreshAll(factoryId) }} />
          ) : (
            <ListState kind="empty" message="Không có sản lượng trong kỳ / bộ lọc đang chọn" />
          )}
        </div>
      )}

      {tab === "stats" && !loading && !loadError && statsFiltered.length > 0 && (
        <div className="space-y-5">
          <StatGrid cols={4}>
            <StatCard icon={Weight} label="Tổng KL Tươi" value={`${fmtNum(totalTuoiAll, 0)} kg`} />
            <StatCard icon={Weight} label="Tổng KL Khô" value={`${fmtNum(totalKhoAll, 0)} kg`} />
            <StatCard icon={Calendar} label="Số Bản Ghi" value={String(statsFiltered.length)} />
            <StatCard
              icon={AlertTriangle}
              label="Cảnh Báo"
              value={String(warnCount)}
              valueTone={warnCount > 0 ? "warn" : "default"}
              sub={warnCount > 0 ? "Cần kiểm tra dữ liệu" : "Tất cả ổn"}
            />
          </StatGrid>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 font-bold text-slate-700">KL khô theo đội (kg)</h3>
            <div className="space-y-2">
              {Array.from(byDoi.entries()).sort((a, b) => a[0] - b[0]).map(([doi, kho]) => {
                const maxKho = Math.max(...Array.from(byDoi.values()), 1)
                const pct = Math.round((kho / maxKho) * 100)
                return (
                  <div key={doi} className="flex items-center gap-3">
                    <span className="w-16 text-right text-xs font-bold text-slate-500">
                      {doi === 0 ? "Thu mua" : `Đội ${doi}`}
                    </span>
                    <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-24 text-right text-sm font-bold text-emerald-700">{fmtNum(kho, 0)} kg</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3">
              <h3 className="font-bold text-slate-700">Chi tiết theo xe</h3>
            </div>
            <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
              <table className="enterprise-table dense min-w-[640px]">
                <thead>
                  <tr>
                    <th>Đội</th>
                    <th>Số xe</th>
                    <th className="text-right">Chuyến</th>
                    <th>Tài xế</th>
                    <th className="text-right">Tươi (kg)</th>
                    <th className="text-right">Khô (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(byVehicle.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
                    const [, soXe, chuyen] = key.split(":")
                    return (
                      <tr key={key}>
                        <td className="font-bold text-slate-700">
                          {value.doi === 0 ? "Thu mua" : `Đội ${value.doi}`}
                        </td>
                        <td className="font-bold text-slate-800">{soXe}</td>
                        <td className="text-right text-slate-600">{chuyen}</td>
                        <td className="text-slate-600">{value.taiXe || "—"}</td>
                        <td className="text-right text-slate-700">{fmtNum(value.tuoi, 0)}</td>
                        <td className="text-right font-bold text-emerald-700">{fmtNum(value.kho, 0)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ResponsiveTableWrapper>
          </div>
        </div>
      )}

      {tab === "import" && (
        <OutputImportGuide
          canImport={isAdmin || canImport}
          canUseConverter={canUseConverter}
          onStartImport={() => setShowImport(true)}
          onOpenConverter={() => setView("converter")}
        />
      )}

      {showImport && factoryId && (
        <OutputImport
          factoryId={factoryId}
          dispatches={dispatches}
          deliveryPoints={deliveryPoints}
          supabase={supabase}
          currentUser={currentUser}
          onImported={() => { void loadRecords(factoryId) }}
          onClose={() => setShowImport(false)}
        />
      )}

      {showForm && factoryId && (
        <OutputForm
          record={editRecord}
          factoryId={factoryId}
          initialDate={formInitialDate}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditRecord(null); setFormInitialDate(null) }}
        />
      )}

      {delConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <p className="mb-2 font-bold text-slate-800">Xóa bản ghi?</p>
            <p className="mb-5 text-sm text-slate-500">Thao tác này không thể hoàn tác.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDelConfirm(null)} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Hủy</button>
              <button onClick={() => void handleDelete(delConfirm)} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">Xóa</button>
            </div>
          </div>
        </div>
      )}

      <QrScanPortal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDecoded={handleScanDecoded}
        hintText="Đưa mã QR trên phiếu sản lượng ngày vào khung"
      />

      {saveError && (
        <div className="fixed left-1/2 top-4 z-50 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl bg-red-600 px-5 py-3 text-white shadow-2xl">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-bold">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
