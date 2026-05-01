"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"
import {
  AlertTriangle,
  BarChart2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Filter,
  RefreshCw,
  TrendingUp,
} from "lucide-react"
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type MetricKey =
  | "tap_chat"
  | "tro"
  | "bay_hoi"
  | "nito"
  | "po"
  | "pri"
  | "mooney"
  | "mau_sac"

type Samples = Record<string, (string | number)[]>

type GradeEntry = {
  dat?: boolean
  tb?: number
  detail?: string
}

type QcRow = {
  id: string
  factory_id: string
  lot_id: string | null
  ma_lo: string
  pkn: number
  ngay_kn: string
  ngay_sx: string
  chung_loai: string
  loai_csr: string
  loai_kn: string
  tieu_chuan: string
  so_mau: number
  samples: Samples
  grade: Record<string, GradeEntry>
  dat_hang: string
  trang_thai: string
}

type LotRow = {
  id: string
  day_chuyen?: string | null
  ca?: string | null
  loai_banh?: number | null
  boc?: string | null
  ngan_id?: string | null
}

type NganRow = {
  id: string
  ten_ngan?: string | null
}

type LimitRow = {
  tap_chat: number
  tro: number
  bay_hoi: number
  bay_hoi_dr: number | null
  nito: number
  nito_dr: number | null
  po_min: number | null
  po_dr: number | null
  pri_min: number
  pri_tb: number
  pri_dr: number | null
  mooney_min: number | null
  mooney_max: number | null
  mau_max: number | null
  mau_dr: number | null
}

type CustomStdRow = {
  id: string
  ten_kh: string
  limits: LimitRow
}

type MetricStats = {
  mean: number
  min: number
  max: number
  dr: number
  x3sd: number
  pass: boolean | null
  count: number
}

type QualityRecord = {
  id: string
  lot_id: string | null
  ma_lo: string
  pkn: number
  ngay_kn: string
  ngay_sx: string
  chung_loai: string
  loai_csr: string
  loai_kn: string
  tieu_chuan: string
  dat_hang: string
  trang_thai: string
  day_chuyen: string
  ca: string
  loai_banh: string
  boc: string
  ngan_id: string
  ngan_label: string
  metrics: Partial<Record<MetricKey, MetricStats>>
}

type TrendRow = {
  bucket: string
  label: string
  sampleCount: number
  [key: string]: string | number | null
}

type DriverDimension = "ca" | "day_chuyen" | "boc" | "loai_banh" | "ngan_label" | "tieu_chuan"
type StandardFilter = "all" | "tcvn3769" | "tcvn112" | "tckh"
type LoaiKnFilter = "all" | "thuong" | "ngat"

const METRICS: { key: MetricKey; label: string; decimals: number }[] = [
  { key: "tap_chat", label: "Tạp chất", decimals: 3 },
  { key: "tro", label: "Tro", decimals: 3 },
  { key: "bay_hoi", label: "Bay hơi", decimals: 3 },
  { key: "nito", label: "Nitơ", decimals: 3 },
  { key: "po", label: "Po", decimals: 1 },
  { key: "pri", label: "PRI", decimals: 1 },
  { key: "mooney", label: "Mooney", decimals: 1 },
  { key: "mau_sac", label: "Màu sắc", decimals: 1 },
]

const METRIC_LABEL_MAP = Object.fromEntries(METRICS.map((item) => [item.key, item.label])) as Record<MetricKey, string>
const CHART_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#ea580c", "#db2777", "#0891b2", "#65a30d", "#b45309"]
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"

const TCCS_LIMITS: Record<string, LimitRow> = {
  CSRL: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: 35, po_dr: 8, pri_min: 60, pri_tb: 70, pri_dr: 10, mooney_min: null, mooney_max: null, mau_max: 4, mau_dr: 1 },
  CSR3L: { tap_chat: 0.03, tro: 0.4, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: 35, po_dr: 8, pri_min: 60, pri_tb: 70, pri_dr: 10, mooney_min: 73, mooney_max: 93, mau_max: 6, mau_dr: 1 },
  CSR5: { tap_chat: 0.04, tro: 0.5, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: 30, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: 10, mooney_min: null, mooney_max: null, mau_max: null, mau_dr: null },
  CSRCV50: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: null, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: 10, mooney_min: 45, mooney_max: 55, mau_max: null, mau_dr: null },
  CSRCV60: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: null, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: 10, mooney_min: 55, mooney_max: 65, mau_max: null, mau_dr: null },
  CSR10: { tap_chat: 0.07, tro: 0.6, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: 30, po_dr: 8, pri_min: 50, pri_tb: 60, pri_dr: 10, mooney_min: 73, mooney_max: 93, mau_max: null, mau_dr: null },
  CSR20: { tap_chat: 0.15, tro: 0.7, bay_hoi: 0.7, bay_hoi_dr: 0.1, nito: 0.5, nito_dr: 0.06, po_min: 30, po_dr: 8, pri_min: 40, pri_tb: 50, pri_dr: 10, mooney_min: null, mooney_max: null, mau_max: null, mau_dr: null },
}

const TCVN_LIMITS: Record<string, LimitRow> = {
  CSRL: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: 35, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: null, mooney_min: null, mooney_max: null, mau_max: 4, mau_dr: null },
  CSR3L: { tap_chat: 0.03, tro: 0.5, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: 35, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: null, mooney_min: 73, mooney_max: 93, mau_max: 6, mau_dr: null },
  CSR5: { tap_chat: 0.05, tro: 0.6, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: 30, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: null, mooney_min: null, mooney_max: null, mau_max: null, mau_dr: null },
  CSRCV50: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: null, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: null, mooney_min: 45, mooney_max: 55, mau_max: null, mau_dr: null },
  CSRCV60: { tap_chat: 0.02, tro: 0.4, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: null, po_dr: null, pri_min: 60, pri_tb: 70, pri_dr: null, mooney_min: 55, mooney_max: 65, mau_max: null, mau_dr: null },
  CSR10: { tap_chat: 0.08, tro: 0.6, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: 30, po_dr: null, pri_min: 50, pri_tb: 60, pri_dr: null, mooney_min: 73, mooney_max: 93, mau_max: null, mau_dr: null },
  CSR20: { tap_chat: 0.16, tro: 0.8, bay_hoi: 0.8, bay_hoi_dr: null, nito: 0.6, nito_dr: null, po_min: 30, po_dr: null, pri_min: 40, pri_tb: 50, pri_dr: null, mooney_min: null, mooney_max: null, mau_max: null, mau_dr: null },
}

function fmtNumber(value: number | null | undefined, decimals = 1) {
  if (value == null || Number.isNaN(value)) return "—"
  return value.toLocaleString("vi-VN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—"
  return `${value.toFixed(1)}%`
}

function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function getWeekBucket(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00`)
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day)
  return date.toISOString().slice(0, 10)
}

function getMonthBucket(dateStr: string) {
  return dateStr.slice(0, 7)
}

function formatBucket(bucket: string, granularity: "day" | "week" | "month") {
  if (granularity === "day") {
    const [y, m, d] = bucket.split("-")
    return `${d}/${m}/${y.slice(2)}`
  }
  if (granularity === "week") {
    const [y, m, d] = bucket.split("-")
    return `Từ ${d}/${m}/${y.slice(2)}`
  }
  const [y, m] = bucket.split("-")
  return `T${Number(m)}/${y}`
}

function normalizeStandard(raw: string): StandardFilter | null {
  if (raw === "TCVN 3769:2016") return "tcvn3769"
  if (raw === "TCCS 112:2022" || raw === "TCVN 112:2022") return "tcvn112"
  if (raw) return "tckh"
  return null
}

function standardLabel(value: StandardFilter) {
  if (value === "tcvn3769") return "TCVN 3769:2016"
  if (value === "tcvn112") return "TCCS 112:2022"
  if (value === "tckh") return "TCKH"
  return "Tất cả"
}

function loaiKnLabel(value: string) {
  if (value === "thuong") return "Thường"
  if (value === "ngat") return "Ngặt"
  return value
}

function statusText(status: string) {
  return status === "dat" ? "Đạt" : "Rớt hạng"
}

function isMetricPass(record: QualityRecord, metric: MetricKey) {
  return record.metrics[metric]?.pass === true
}

function isMetricFail(record: QualityRecord, metric: MetricKey) {
  return record.metrics[metric]?.pass === false
}

function limitKey(loaiCsr: string) {
  return loaiCsr.replace(/^SVR/, "CSR")
}

function getLimitRow(loaiCsr: string, tieuChuan: string, customStdMap: Map<string, CustomStdRow>) {
  const key = limitKey(loaiCsr)
  if (tieuChuan === "TCVN 3769:2016") return TCVN_LIMITS[key] || TCVN_LIMITS.CSR10
  if (tieuChuan === "TCCS 112:2022" || tieuChuan === "TCVN 112:2022") return TCCS_LIMITS[key] || TCCS_LIMITS.CSR10
  return customStdMap.get(tieuChuan)?.limits || null
}

function getMetricSpecBounds(metric: MetricKey, limits: LimitRow | null) {
  if (!limits) return { lsl: null as number | null, usl: null as number | null }
  switch (metric) {
    case "tap_chat":
      return { lsl: null, usl: limits.tap_chat }
    case "tro":
      return { lsl: null, usl: limits.tro }
    case "bay_hoi":
      return { lsl: null, usl: limits.bay_hoi }
    case "nito":
      return { lsl: null, usl: limits.nito }
    case "po":
      return { lsl: limits.po_min, usl: null }
    case "pri":
      return { lsl: limits.pri_min, usl: null }
    case "mooney":
      return { lsl: limits.mooney_min, usl: limits.mooney_max }
    case "mau_sac":
      return { lsl: null, usl: limits.mau_max }
    default:
      return { lsl: null, usl: null }
  }
}

function parseMetricStats(values: (string | number)[] | undefined, pass: boolean | undefined): MetricStats | null {
  const nums = (values || [])
    .map((item) => Number(item))
    .filter((value) => !Number.isNaN(value))

  if (!nums.length) return null

  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const variance = nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / nums.length
  const sd = Math.sqrt(variance)

  return {
    mean,
    min,
    max,
    dr: max - min,
    x3sd: mean + 3 * sd,
    pass: pass ?? null,
    count: nums.length,
  }
}

function DashboardTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl">
      <p className="mb-2 text-xs font-bold text-slate-500">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-sm font-semibold" style={{ color: entry.color }}>
          {entry.name}: {fmtNumber(entry.value, 2)}
        </p>
      ))}
    </div>
  )
}

export default function QualityAnalyticsPage({
  embedded = false,
  factoryId: factoryIdProp,
}: {
  embedded?: boolean
  factoryId?: string | null
}) {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<QualityRecord[]>([])
  const [customStdMap, setCustomStdMap] = useState<Map<string, CustomStdRow>>(new Map())

  const [fromDate, setFromDate] = useState(daysAgo(30))
  const [toDate, setToDate] = useState(today())
  const [selectedLoaiCsr, setSelectedLoaiCsr] = useState("all")
  const [selectedTieuChuan, setSelectedTieuChuan] = useState<StandardFilter>("all")
  const [selectedLoaiKn, setSelectedLoaiKn] = useState<LoaiKnFilter>("all")
  const [selectedTrangThai, setSelectedTrangThai] = useState("all")
  const [selectedDayChuyen, setSelectedDayChuyen] = useState("all")
  const [selectedCa, setSelectedCa] = useState("all")
  const [selectedLoaiBanh, setSelectedLoaiBanh] = useState("all")
  const [selectedBoc, setSelectedBoc] = useState("all")
  const [selectedNgan, setSelectedNgan] = useState("all")
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(["pri", "po", "mooney"])
  const [focusMetricSelection, setFocusMetric] = useState<MetricKey>("pri")
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day")
  const [compareMonthA, setCompareMonthA] = useState("")
  const [compareMonthB, setCompareMonthB] = useState("")
  const [driversDimension, setDriversDimension] = useState<DriverDimension>("ca")
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set())
  const [expandedDateKeys, setExpandedDateKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    const bootstrap = async () => {
      if (factoryIdProp) {
        setFactoryId(factoryIdProp)
        return
      }

      const fid = await getActiveFactoryId()
      if (fid) setFactoryId(fid)
      else setLoading(false)
    }
    void bootstrap()
  }, [factoryIdProp])

  useEffect(() => {
    if (!factoryId) return

    const load = async () => {
      setLoading(true)

      const [qcResult, lotResult, ngansResult, customStdResult] = await Promise.allSettled([
        supabase
          .from("qc_results")
          .select("id,factory_id,lot_id,ma_lo,pkn,ngay_kn,ngay_sx,chung_loai,loai_csr,loai_kn,tieu_chuan,so_mau,samples,grade,dat_hang,trang_thai")
          .eq("factory_id", factoryId)
          .order("ngay_kn", { ascending: false }),
        supabase.from("lots").select("id,day_chuyen,ca,loai_banh,boc,ngan_id").eq("factory_id", factoryId),
        supabase.from("ngans").select("id,ten_ngan").eq("factory_id", factoryId),
        supabase.from("qc_custom_std").select("id,ten_kh,limits").eq("factory_id", factoryId),
      ])

      const qcPayload = qcResult.status === "fulfilled" ? qcResult.value : null
      const lotPayload = lotResult.status === "fulfilled" ? lotResult.value : null
      const ngansPayload = ngansResult.status === "fulfilled" ? ngansResult.value : null
      const customStdPayload = customStdResult.status === "fulfilled" ? customStdResult.value : null

      if (qcResult.status === "rejected" || qcPayload?.error) {
        console.error("load quality analytics qc_results failed", qcResult.status === "rejected" ? qcResult.reason : qcPayload?.error)
        setRecords([])
        setCustomStdMap(new Map())
        setLoading(false)
        return
      }

      if (lotResult.status === "rejected" || lotPayload?.error) {
        console.error("load quality analytics lots failed", lotResult.status === "rejected" ? lotResult.reason : lotPayload?.error)
      }
      if (ngansResult.status === "rejected" || ngansPayload?.error) {
        console.error("load quality analytics ngans failed", ngansResult.status === "rejected" ? ngansResult.reason : ngansPayload?.error)
      }
      if (customStdResult.status === "rejected" || customStdPayload?.error) {
        console.error("load quality analytics qc_custom_std failed", customStdResult.status === "rejected" ? customStdResult.reason : customStdPayload?.error)
      }

      const lotRows = (lotPayload?.error ? [] : ((lotPayload?.data as LotRow[] | null | undefined) || []))
      const nganRows = (ngansPayload?.error ? [] : ((ngansPayload?.data as NganRow[] | null | undefined) || []))
      const customStdRows = (customStdPayload?.error ? [] : ((customStdPayload?.data as CustomStdRow[] | null | undefined) || []))

      const lotMap = new Map<string, LotRow>(lotRows.map((item) => [item.id, item]))
      const nganMap = new Map<string, NganRow>(nganRows.map((item) => [item.id, item]))

      const nextRecords = (((qcPayload?.data as QcRow[] | null) || [])).map((row) => {
        const lot = row.lot_id ? lotMap.get(row.lot_id) : null
        const ngan = lot?.ngan_id ? nganMap.get(lot.ngan_id) : null
        const metrics = {} as Partial<Record<MetricKey, MetricStats>>

        METRICS.forEach((metric) => {
          const stats = parseMetricStats(row.samples?.[metric.key], row.grade?.[metric.key]?.dat)
          if (stats) metrics[metric.key] = stats
        })

        return {
          id: row.id,
          lot_id: row.lot_id,
          ma_lo: row.ma_lo,
          pkn: row.pkn,
          ngay_kn: row.ngay_kn,
          ngay_sx: row.ngay_sx,
          chung_loai: row.chung_loai,
          loai_csr: row.loai_csr,
          loai_kn: row.loai_kn,
          tieu_chuan: row.tieu_chuan,
          dat_hang: row.dat_hang,
          trang_thai: row.trang_thai,
          day_chuyen: lot?.day_chuyen || "Chưa rõ",
          ca: lot?.ca || "Chưa rõ",
          loai_banh: lot?.loai_banh != null ? String(lot.loai_banh) : "Chưa rõ",
          boc: lot?.boc || "Chưa rõ",
          ngan_id: lot?.ngan_id || "",
          ngan_label: ngan?.ten_ngan || "Chưa gán",
          metrics,
        }
      })

      setCustomStdMap(new Map(customStdRows.map((item) => [item.id, item])))
      setRecords(nextRecords)
      setLoading(false)
    }

    load()
  }, [factoryId])

  const filterOptions = useMemo(() => {
    const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi"))
    const standards = new Set(records.map((record) => normalizeStandard(record.tieu_chuan)).filter(Boolean))
    const ngansInDateRange = records
      .filter((record) => record.ngay_sx >= fromDate && record.ngay_sx <= toDate)
      .map((record) => record.ngan_label)

    return {
      loaiCsr: unique(records.map((record) => record.loai_csr)),
      has3769: standards.has("tcvn3769"),
      has112: standards.has("tcvn112"),
      hasTckh: standards.has("tckh"),
      dayChuyen: unique(records.map((record) => record.day_chuyen)),
      ca: unique(records.map((record) => record.ca)),
      loaiBanh: unique(records.map((record) => record.loai_banh)),
      boc: unique(records.map((record) => record.boc)),
      ngan: unique(ngansInDateRange),
    }
  }, [fromDate, records, toDate])

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (record.ngay_kn < fromDate || record.ngay_kn > toDate) return false
      if (selectedLoaiCsr !== "all" && record.loai_csr !== selectedLoaiCsr) return false
      if (selectedTieuChuan !== "all" && normalizeStandard(record.tieu_chuan) !== selectedTieuChuan) return false
      if (selectedLoaiKn !== "all" && record.loai_kn !== selectedLoaiKn) return false
      if (selectedTrangThai !== "all" && record.trang_thai !== selectedTrangThai) return false
      if (selectedDayChuyen !== "all" && record.day_chuyen !== selectedDayChuyen) return false
      if (selectedCa !== "all" && record.ca !== selectedCa) return false
      if (selectedLoaiBanh !== "all" && record.loai_banh !== selectedLoaiBanh) return false
      if (selectedBoc !== "all" && record.boc !== selectedBoc) return false
      if (selectedNgan !== "all" && record.ngan_label !== selectedNgan) return false
      return selectedMetrics.some((metric) => record.metrics[metric])
    })
  }, [
    fromDate,
    records,
    selectedBoc,
    selectedCa,
    selectedDayChuyen,
    selectedLoaiBanh,
    selectedLoaiCsr,
    selectedLoaiKn,
    selectedMetrics,
    selectedNgan,
    selectedTieuChuan,
    selectedTrangThai,
    toDate,
  ])

  const focusMetric = selectedMetrics.includes(focusMetricSelection)
    ? focusMetricSelection
    : (selectedMetrics[0] || "pri")

  const trendData = useMemo<TrendRow[]>(() => {
    const bucketMap = new Map<string, QualityRecord[]>()

    filteredRecords.forEach((record) => {
      const bucket =
        granularity === "day"
          ? record.ngay_kn
          : granularity === "week"
            ? getWeekBucket(record.ngay_kn)
            : getMonthBucket(record.ngay_kn)

      const arr = bucketMap.get(bucket) || []
      arr.push(record)
      bucketMap.set(bucket, arr)
    })

    return Array.from(bucketMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucket, items]) => {
        const row: TrendRow = {
          bucket,
          label: formatBucket(bucket, granularity),
          sampleCount: items.length,
        }

        selectedMetrics.forEach((metric) => {
          const values = items.map((item) => item.metrics[metric]?.mean).filter((value): value is number => value != null)
          row[metric] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
        })

        return row
      })
  }, [filteredRecords, granularity, selectedMetrics])

  const focusMetricTrend = useMemo(() => {
    const values = trendData.map((row) => row[focusMetric]).filter((value): value is number => typeof value === "number")
    if (!values.length) return { center: 0, ucl: 0, lcl: 0 }

    const center = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length
    const sd = Math.sqrt(variance)
    return {
      center,
      ucl: center + 3 * sd,
      lcl: Math.max(center - 3 * sd, 0),
    }
  }, [focusMetric, trendData])

  const compareBaseRecords = useMemo(() => {
    return records.filter((record) => {
      if (selectedLoaiCsr !== "all" && record.loai_csr !== selectedLoaiCsr) return false
      if (selectedTieuChuan !== "all" && normalizeStandard(record.tieu_chuan) !== selectedTieuChuan) return false
      if (selectedLoaiKn !== "all" && record.loai_kn !== selectedLoaiKn) return false
      if (selectedTrangThai !== "all" && record.trang_thai !== selectedTrangThai) return false
      if (selectedDayChuyen !== "all" && record.day_chuyen !== selectedDayChuyen) return false
      if (selectedCa !== "all" && record.ca !== selectedCa) return false
      if (selectedLoaiBanh !== "all" && record.loai_banh !== selectedLoaiBanh) return false
      if (selectedBoc !== "all" && record.boc !== selectedBoc) return false
      if (selectedNgan !== "all" && record.ngan_label !== selectedNgan) return false
      return Boolean(record.metrics[focusMetric])
    })
  }, [
    focusMetric,
    records,
    selectedBoc,
    selectedCa,
    selectedDayChuyen,
    selectedLoaiBanh,
    selectedLoaiCsr,
    selectedLoaiKn,
    selectedNgan,
    selectedTieuChuan,
    selectedTrangThai,
  ])

  const compareMonthOptions = useMemo(() => {
    return Array.from(new Set(compareBaseRecords.map((record) => getMonthBucket(record.ngay_kn))))
      .sort((a, b) => a.localeCompare(b))
      .reverse()
  }, [compareBaseRecords])

  const sigmaDistribution = useMemo(() => {
    const values = filteredRecords
      .map((record) => record.metrics[focusMetric]?.mean)
      .filter((value): value is number => typeof value === "number")

    if (!values.length) {
      return {
        mean: 0,
        sd: 0,
        points: [] as { sigmaLabel: string; valueLabel: string; density: number }[],
      }
    }

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
    const sd = Math.sqrt(variance)

    if (!sd) {
      return {
        mean,
        sd,
        points: [
          {
            sigmaLabel: "0σ",
            valueLabel: fmtNumber(mean, 2),
            density: values.length,
          },
        ],
      }
    }

    const points = Array.from({ length: 13 }, (_, index) => {
      const sigma = -3 + index * 0.5
      const x = mean + sigma * sd
      const density = Math.exp(-0.5 * sigma * sigma) * values.length
      return {
        sigmaLabel: `${sigma > 0 ? "+" : ""}${Number.isInteger(sigma) ? sigma : sigma.toFixed(1)}σ`,
        valueLabel: fmtNumber(x, 2),
        density,
      }
    })

    return { mean, sd, points }
  }, [filteredRecords, focusMetric])

  const processCapability = useMemo(() => {
    const metricRecords = filteredRecords.filter((record) => record.metrics[focusMetric]?.mean != null)
    const values = metricRecords.map((record) => record.metrics[focusMetric]?.mean as number)
    if (!values.length) return { cp: null as number | null, cpk: null as number | null, lsl: null as number | null, usl: null as number | null }

    const specPairs = Array.from(
      new Set(
        metricRecords.map((record) => {
          const bounds = getMetricSpecBounds(focusMetric, getLimitRow(record.loai_csr, record.tieu_chuan, customStdMap))
          return `${bounds.lsl ?? "null"}|${bounds.usl ?? "null"}`
        }),
      ),
    )

    if (specPairs.length !== 1) return { cp: null, cpk: null, lsl: null, usl: null }

    const [lslRaw, uslRaw] = specPairs[0].split("|")
    const lsl = lslRaw === "null" ? null : Number(lslRaw)
    const usl = uslRaw === "null" ? null : Number(uslRaw)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
    const sd = Math.sqrt(variance)
    if (!sd) return { cp: null, cpk: null, lsl, usl }

    const cp = lsl != null && usl != null ? (usl - lsl) / (6 * sd) : null
    const cpu = usl != null ? (usl - mean) / (3 * sd) : null
    const cpl = lsl != null ? (mean - lsl) / (3 * sd) : null
    const cpk = cpu != null && cpl != null ? Math.min(cpu, cpl) : cpu ?? cpl ?? null

    return { cp, cpk, lsl, usl }
  }, [customStdMap, filteredRecords, focusMetric])

  useEffect(() => {
    if (!compareMonthOptions.length) {
      if (compareMonthA) setCompareMonthA("")
      if (compareMonthB) setCompareMonthB("")
      return
    }

    if (!compareMonthA || !compareMonthOptions.includes(compareMonthA)) {
      setCompareMonthA(compareMonthOptions[0] || "")
    }

    if (!compareMonthB || !compareMonthOptions.includes(compareMonthB) || compareMonthB === compareMonthA) {
      setCompareMonthB(compareMonthOptions[1] || compareMonthOptions[0] || "")
    }
  }, [compareMonthA, compareMonthB, compareMonthOptions])

  const compareMonthRecordsA = useMemo(
    () => compareBaseRecords.filter((record) => getMonthBucket(record.ngay_kn) === compareMonthA),
    [compareBaseRecords, compareMonthA],
  )

  const compareMonthRecordsB = useMemo(
    () => compareBaseRecords.filter((record) => getMonthBucket(record.ngay_kn) === compareMonthB),
    [compareBaseRecords, compareMonthB],
  )

  const compareLabels = useMemo(() => {
    return {
      a: compareMonthA ? formatBucket(compareMonthA, "month") : "Tháng A",
      b: compareMonthB ? formatBucket(compareMonthB, "month") : "Tháng B",
    }
  }, [compareMonthA, compareMonthB])

  const compareTrendData = useMemo(() => {
    const pointMap = new Map<string, { day: number; label: string; monthA: number | null; monthB: number | null }>()
    const pushMonth = (items: QualityRecord[], key: "monthA" | "monthB") => {
      items.forEach((record) => {
        const day = Number(record.ngay_kn.slice(8, 10))
        const mapKey = String(day).padStart(2, "0")
        const existing = pointMap.get(mapKey) || { day, label: mapKey, monthA: null, monthB: null }
        const metricValue = record.metrics[focusMetric]?.mean ?? null
        const current = existing[key]
        if (metricValue != null) {
          existing[key] = current == null ? metricValue : (current + metricValue) / 2
        }
        pointMap.set(mapKey, existing)
      })
    }

    pushMonth(compareMonthRecordsA, "monthA")
    pushMonth(compareMonthRecordsB, "monthB")

    return Array.from(pointMap.values()).sort((a, b) => a.day - b.day)
  }, [compareMonthRecordsA, compareMonthRecordsB, focusMetric])

  const compareControlStats = useMemo(() => {
    const getStats = (items: QualityRecord[]) => {
      const values = items.map((record) => record.metrics[focusMetric]?.mean).filter((value): value is number => value != null)
      if (!values.length) return { center: 0, ucl: 0, lcl: 0 }
      const center = values.reduce((sum, value) => sum + value, 0) / values.length
      const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length
      const sd = Math.sqrt(variance)
      return { center, ucl: center + 3 * sd, lcl: Math.max(center - 3 * sd, 0) }
    }
    return {
      a: getStats(compareMonthRecordsA),
      b: getStats(compareMonthRecordsB),
    }
  }, [compareMonthRecordsA, compareMonthRecordsB, focusMetric])

  const compareSigmaDistribution = useMemo(() => {
    const build = (items: QualityRecord[]) => {
      const values = items.map((record) => record.metrics[focusMetric]?.mean).filter((value): value is number => value != null)
      if (!values.length) {
        return { mean: 0, points: [] as { sigmaLabel: string; density: number }[] }
      }
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
      const sd = Math.sqrt(variance)
      if (!sd) return { mean, points: [{ sigmaLabel: "0σ", density: values.length }] }
      return {
        mean,
        points: Array.from({ length: 13 }, (_, index) => {
          const sigma = -3 + index * 0.5
          return {
            sigmaLabel: `${sigma > 0 ? "+" : ""}${Number.isInteger(sigma) ? sigma : sigma.toFixed(1)}σ`,
            density: Math.exp(-0.5 * sigma * sigma) * values.length,
          }
        }),
      }
    }

    const distA = build(compareMonthRecordsA)
    const distB = build(compareMonthRecordsB)
    const labels = Array.from(new Set([...distA.points.map((p) => p.sigmaLabel), ...distB.points.map((p) => p.sigmaLabel)]))
    return labels.map((label) => ({
      sigmaLabel: label,
      monthA: distA.points.find((point) => point.sigmaLabel === label)?.density ?? null,
      monthB: distB.points.find((point) => point.sigmaLabel === label)?.density ?? null,
    }))
  }, [compareMonthRecordsA, compareMonthRecordsB, focusMetric])

  const kpis = useMemo(() => {
    const focusMetricRecords = filteredRecords.filter((record) => record.metrics[focusMetric])
    const total = focusMetricRecords.length
    const datCount = focusMetricRecords.filter((record) => isMetricPass(record, focusMetric)).length
    const failCount = focusMetricRecords.filter((record) => isMetricFail(record, focusMetric)).length
    const failRate = total ? (failCount / total) * 100 : 0
    const datRate = total ? (datCount / total) * 100 : 0

    const worst = selectedMetrics
      .map((metric) => {
        const metricRecords = filteredRecords.filter((record) => record.metrics[metric])
        const failCount = metricRecords.filter((record) => record.metrics[metric]?.pass === false).length
        const failPercent = metricRecords.length ? (failCount / metricRecords.length) * 100 : 0
        return { metric, failPercent }
      })
      .sort((a, b) => b.failPercent - a.failPercent)[0]

    const riskyGroups = new Set(
      focusMetricRecords
        .filter((record) => isMetricFail(record, focusMetric))
        .map((record) => `${record.loai_csr}|${record.ca}|${record.boc}|${record.loai_banh}`),
    ).size

    const trendSlice = trendData.slice(-7)
    const trendValues = trendSlice.map((row) => row[focusMetric]).filter((value): value is number => typeof value === "number")
    const first = trendValues[0]
    const last = trendValues[trendValues.length - 1]
    let trendText = "Ổn định"
    if (trendValues.length >= 2 && first != null && last != null) {
      if (last > first) trendText = "Tăng"
      else if (last < first) trendText = "Giảm"
    }

    return {
      datRate,
      failRate,
      riskyGroups,
      trendText,
      worstMetric: worst ? METRIC_LABEL_MAP[worst.metric] : "Chưa có",
    }
  }, [filteredRecords, focusMetric, selectedMetrics, trendData])

  const driversData = useMemo(() => {
    const groups = new Map<string, QualityRecord[]>()
    filteredRecords.forEach((record) => {
      const key = record[driversDimension] || "Chưa rõ"
      const arr = groups.get(key) || []
      arr.push(record)
      groups.set(key, arr)
    })

    return Array.from(groups.entries())
      .map(([key, items]) => {
        const values = items.map((item) => item.metrics[focusMetric]?.mean).filter((value): value is number => value != null)
        const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
        const failCount = items.filter((item) => isMetricFail(item, focusMetric)).length
        const failRate = items.length ? (failCount / items.length) * 100 : 0
        return { key, total: items.length, mean, failRate }
      })
      .sort((a, b) => b.failRate - a.failRate || b.mean - a.mean)
      .slice(0, 8)
  }, [driversDimension, filteredRecords, focusMetric])

  const heatmapRows = useMemo(() => {
    const groups = new Map<string, QualityRecord[]>()
    filteredRecords.forEach((record) => {
      const key = record[driversDimension] || "Chưa rõ"
      const arr = groups.get(key) || []
      arr.push(record)
      groups.set(key, arr)
    })

    return Array.from(groups.entries())
      .map(([label, items]) => ({
        label,
        cells: selectedMetrics.map((metric) => {
          const metricItems = items.filter((item) => item.metrics[metric])
          const failCount = metricItems.filter((item) => item.metrics[metric]?.pass === false).length
          const means = metricItems.map((item) => item.metrics[metric]?.mean).filter((value): value is number => value != null)
          return {
            metric,
            count: metricItems.length,
            failRate: metricItems.length ? (failCount / metricItems.length) * 100 : 0,
            mean: means.length ? means.reduce((sum, value) => sum + value, 0) / means.length : null,
          }
        }),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "vi"))
  }, [driversDimension, filteredRecords, selectedMetrics])

  const drillGroups = useMemo(() => {
    const groups = new Map<string, QualityRecord[]>()

    filteredRecords.forEach((record) => {
      const key = `${record.loai_csr}|${record.tieu_chuan}|${record.ca}|${record.loai_banh}|${record.boc}`
      const arr = groups.get(key) || []
      arr.push(record)
      groups.set(key, arr)
    })

    return Array.from(groups.entries())
      .map(([key, items]) => {
        const failCount = items.filter((item) => isMetricFail(item, focusMetric)).length
        const dateMap = new Map<string, QualityRecord[]>()

        items.forEach((item) => {
          const arr = dateMap.get(item.ngay_kn) || []
          arr.push(item)
          dateMap.set(item.ngay_kn, arr)
        })

        const dates = Array.from(dateMap.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([date, dateItems]) => {
            const values = dateItems.map((item) => item.metrics[focusMetric]?.mean).filter((value): value is number => value != null)
            return {
              date,
              records: dateItems.sort((a, b) => a.ma_lo.localeCompare(b.ma_lo, "vi")),
              mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
            }
          })

        const [loaiCsr, tieuChuanRaw, ca, loaiBanh, boc] = key.split("|")
        const tieuChuan = standardLabel(normalizeStandard(tieuChuanRaw) || "tckh")
        return {
          key,
          label: `${loaiCsr} / ${tieuChuan} / Ca ${ca} / Bành ${loaiBanh} / ${boc}`,
          records: items,
          failRate: items.length ? (failCount / items.length) * 100 : 0,
          dates,
        }
      })
      .sort((a, b) => b.records.length - a.records.length)
  }, [filteredRecords, focusMetric])

  const summaryFilters = [
    {
      label: "Kỳ báo cáo",
      value: `${fromDate.split("-").reverse().join("/")} - ${toDate.split("-").reverse().join("/")}`,
    },
    {
      label: "Loại CSR",
      value: selectedLoaiCsr === "all" ? "Tất cả" : selectedLoaiCsr,
    },
    {
      label: "Tiêu chuẩn",
      value: standardLabel(selectedTieuChuan),
    },
    {
      label: "Chỉ tiêu đang xem",
      value: selectedMetrics.map((metric) => METRIC_LABEL_MAP[metric]).join(", "),
    },
  ]

  const resetFilters = () => {
    setFromDate(daysAgo(30))
    setToDate(today())
    setSelectedLoaiCsr("all")
    setSelectedTieuChuan("all")
    setSelectedLoaiKn("all")
    setSelectedTrangThai("all")
    setSelectedDayChuyen("all")
    setSelectedCa("all")
    setSelectedLoaiBanh("all")
    setSelectedBoc("all")
    setSelectedNgan("all")
    setSelectedMetrics(["pri", "po", "mooney"])
    setFocusMetric("pri")
    setGranularity("day")
    setCompareMonthA("")
    setCompareMonthB("")
    setDriversDimension("ca")
    setExpandedGroupKeys(new Set())
    setExpandedDateKeys(new Set())
  }

  const toggleMetric = (metric: MetricKey) => {
    setSelectedMetrics((prev) => {
      if (prev.includes(metric)) {
        if (prev.length === 1) return prev
        const next = prev.filter((item) => item !== metric)
        if (focusMetric === metric) {
          setFocusMetric(next[0] || "pri")
        }
        return next
      }
      setFocusMetric(metric)
      return [...prev, metric]
    })
  }

  const toggleGroup = (key: string) => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleDate = (key: string) => {
    setExpandedDateKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Thống kê chất lượng</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Màn tổng hợp chất lượng theo kỳ báo cáo, đọc xu hướng nhanh rồi drill-down đến từng lô kiểm nghiệm.
            </p>
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
          >
            <RefreshCw size={14} />
            Đặt lại bộ lọc
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-emerald-50 via-white to-blue-50 p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summaryFilters.map((item) => (
            <div key={item.label}>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{item.label}</div>
              <div className="mt-1 text-sm font-extrabold text-slate-800 md:text-base">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <Filter size={15} className="text-emerald-600" />
            Bộ lọc báo cáo
          </div>
          {embedded && (
            <button
              type="button"
              onClick={resetFilters}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
            >
              <RefreshCw size={14} />
              Đặt lại bộ lọc
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FilterField label="Từ ngày">
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={INPUT_CLASS} />
          </FilterField>
          <FilterField label="Đến ngày">
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={INPUT_CLASS} />
          </FilterField>
          <FilterField label="Dây chuyền">
            <select value={selectedDayChuyen} onChange={(e) => setSelectedDayChuyen(e.target.value)} className={INPUT_CLASS}>
              <option value="all">Tất cả</option>
              {filterOptions.dayChuyen.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </FilterField>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FilterField label="Tiêu chuẩn">
            <select value={selectedTieuChuan} onChange={(e) => setSelectedTieuChuan(e.target.value as StandardFilter)} className={INPUT_CLASS}>
              <option value="all">Tất cả</option>
              {filterOptions.has3769 && <option value="tcvn3769">TCVN 3769:2016</option>}
              {filterOptions.has112 && <option value="tcvn112">TCCS 112:2022</option>}
              {filterOptions.hasTckh && <option value="tckh">TCKH</option>}
            </select>
          </FilterField>
          <FilterField label="Loại kiểm nghiệm">
            <select value={selectedLoaiKn} onChange={(e) => setSelectedLoaiKn(e.target.value as LoaiKnFilter)} className={INPUT_CLASS}>
              <option value="all">Tất cả</option>
              <option value="thuong">Thường</option>
              <option value="ngat">Ngặt</option>
            </select>
          </FilterField>
          <FilterField label="Trạng thái xếp hạng">
            <select value={selectedTrangThai} onChange={(e) => setSelectedTrangThai(e.target.value)} className={INPUT_CLASS}>
              <option value="all">Tất cả</option>
              <option value="dat">Đạt</option>
              <option value="khong_dat">Không đạt</option>
            </select>
          </FilterField>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FilterField label="Loại CSR">
            <select value={selectedLoaiCsr} onChange={(e) => setSelectedLoaiCsr(e.target.value)} className={INPUT_CLASS}>
              <option value="all">Tất cả</option>
              {filterOptions.loaiCsr.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Loại bành">
            <select value={selectedLoaiBanh} onChange={(e) => setSelectedLoaiBanh(e.target.value)} className={INPUT_CLASS}>
              <option value="all">Tất cả</option>
              {filterOptions.loaiBanh.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Ca">
            <select value={selectedCa} onChange={(e) => setSelectedCa(e.target.value)} className={INPUT_CLASS}>
              <option value="all">Tất cả</option>
              {filterOptions.ca.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </FilterField>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FilterField label="Loại bọc">
            <select value={selectedBoc} onChange={(e) => setSelectedBoc(e.target.value)} className={INPUT_CLASS}>
              <option value="all">Tất cả</option>
              {filterOptions.boc.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Ngăn lưu" className="md:col-span-2">
            <select value={selectedNgan} onChange={(e) => setSelectedNgan(e.target.value)} className={INPUT_CLASS}>
              <option value="all">Tất cả</option>
              {filterOptions.ngan.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </FilterField>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FilterField label="Chỉ tiêu phân tích" className="md:col-span-2">
            <div className="flex flex-wrap gap-2">
              {METRICS.map((metric) => {
                const active = selectedMetrics.includes(metric.key)
                return (
                  <button
                    key={metric.key}
                    type="button"
                    onClick={() => toggleMetric(metric.key)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
                      active
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {metric.label}
                  </button>
                )
              })}
            </div>
          </FilterField>
          <FilterField label="Tiêu chí phân tích rủi ro">
            <select value={driversDimension} onChange={(e) => setDriversDimension(e.target.value as DriverDimension)} className={INPUT_CLASS}>
              <option value="ca">Ca</option>
              <option value="day_chuyen">Dây chuyền</option>
              <option value="boc">Loại bọc</option>
              <option value="loai_banh">Loại bành</option>
              <option value="ngan_label">Ngăn lưu</option>
              <option value="tieu_chuan">Tiêu chuẩn</option>
            </select>
          </FilterField>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {[
          { label: "Tổng lô kiểm", value: loading ? "..." : filteredRecords.length.toLocaleString(), icon: ClipboardCheck, color: "text-slate-700", bg: "bg-slate-100 text-slate-600" },
          { label: "Tỷ lệ đạt", value: loading ? "..." : fmtPercent(kpis.datRate), icon: TrendingUp, color: "text-emerald-700", bg: "bg-emerald-100 text-emerald-700" },
          { label: "Tỷ lệ rớt hạng", value: loading ? "..." : fmtPercent(kpis.failRate), icon: AlertTriangle, color: "text-red-700", bg: "bg-red-100 text-red-700" },
          { label: "Chỉ tiêu cảnh báo", value: loading ? "..." : kpis.worstMetric, icon: BarChart2, color: "text-amber-700", bg: "bg-amber-100 text-amber-700" },
          { label: "Nhóm rủi ro", value: loading ? "..." : kpis.riskyGroups.toLocaleString(), icon: Filter, color: "text-blue-700", bg: "bg-blue-100 text-blue-700" },
          { label: "Xu hướng 7 ngày", value: loading ? "..." : kpis.trendText, icon: CalendarDays, color: "text-purple-700", bg: "bg-purple-100 text-purple-700" },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.bg}`}>
                <item.icon size={16} />
              </span>
              <span className="text-xs font-bold text-slate-500">{item.label}</span>
            </div>
            <div className={`break-words text-lg font-extrabold ${item.color}`}>{item.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-700">Xu hướng chỉ tiêu</h2>
              <p className="mt-0.5 text-xs text-slate-400">Theo dõi biến động theo ngày, tuần hoặc tháng trên cùng một mặt bằng lọc.</p>
            </div>
            <div className="flex items-center gap-2">
              {(["day", "week", "month"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setGranularity(mode)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                    granularity === mode
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {mode === "day" ? "Ngày" : mode === "week" ? "Tuần" : "Tháng"}
                </button>
              ))}
            </div>
          </div>

          <div className="h-80">
            {loading ? (
              <StateMessage text="Đang tải dữ liệu..." />
            ) : trendData.length === 0 ? (
              <StateMessage text="Không có dữ liệu theo bộ lọc hiện tại" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ bottom: 24 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" height={44} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<DashboardTooltip />} />
                  <Legend />
                  {selectedMetrics.map((metric, index) => (
                    <Line
                      key={metric}
                      type="monotone"
                      dataKey={metric}
                      name={METRIC_LABEL_MAP[metric]}
                      stroke={CHART_COLORS[index % CHART_COLORS.length]}
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-700">Biểu đồ Kiểm soát</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Chỉ tiêu đang xem: <span className="font-bold text-slate-600">{METRIC_LABEL_MAP[focusMetric]}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedMetrics.map((metric) => (
                <button
                  key={`focus-control-${metric}`}
                  type="button"
                  onClick={() => setFocusMetric(metric)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                    focusMetric === metric
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {METRIC_LABEL_MAP[metric]}
                </button>
              ))}
            </div>
          </div>

          <div className="h-80">
            {loading ? (
              <StateMessage text="Đang tải dữ liệu..." />
            ) : trendData.length === 0 ? (
              <StateMessage text="Không có dữ liệu control chart" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData} margin={{ bottom: 24 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" height={44} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<DashboardTooltip />} />
                  <ReferenceLine y={focusMetricTrend.center} stroke="#0f766e" strokeDasharray="4 4" label="CL" />
                  <ReferenceLine y={focusMetricTrend.ucl} stroke="#dc2626" strokeDasharray="4 4" label="UCL" />
                  <ReferenceLine y={focusMetricTrend.lcl} stroke="#d97706" strokeDasharray="4 4" label="LCL" />
                  <Line
                    type="monotone"
                    dataKey={focusMetric}
                    name={METRIC_LABEL_MAP[focusMetric]}
                    stroke="#2563eb"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <SummaryMini label="Đường tâm" value={fmtNumber(focusMetricTrend.center, 2)} />
            <SummaryMini label="UCL / LCL" value={`${fmtNumber(focusMetricTrend.ucl, 2)} / ${fmtNumber(focusMetricTrend.lcl, 2)}`} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-700">Phân bố Chuẩn</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Đường phân bố của chỉ tiêu đang xem theo dải ±3σ quanh giá trị trung bình, kèm đường trung bình.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedMetrics.map((metric) => (
                <button
                  key={`focus-distribution-${metric}`}
                  type="button"
                  onClick={() => setFocusMetric(metric)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                    focusMetric === metric
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {METRIC_LABEL_MAP[metric]}
                </button>
              ))}
            </div>
          </div>

          <div className="h-80">
            {loading ? (
              <StateMessage text="Đang tải dữ liệu..." />
            ) : sigmaDistribution.points.length === 0 ? (
              <StateMessage text="Không có dữ liệu phân bố 6 sigma" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sigmaDistribution.points}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="sigmaLabel" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const point = payload[0]?.payload as { valueLabel: string; density: number } | undefined
                      return (
                        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl">
                          <p className="mb-1 text-xs font-bold text-slate-500">{label}</p>
                          <p className="text-sm font-semibold text-slate-700">Giá trị xấp xỉ: {point?.valueLabel || "—"}</p>
                          <p className="text-sm font-semibold text-blue-700">Mật độ: {fmtNumber(point?.density, 2)}</p>
                        </div>
                      )
                    }}
                  />
                  <ReferenceLine x="0σ" stroke="#0f766e" strokeDasharray="4 4" label="TB" />
                  <Line type="monotone" dataKey="density" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 2.5 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
            <SummaryMini label="Trung bình" value={fmtNumber(sigmaDistribution.mean, 2)} />
            <SummaryMini label="1σ" value={fmtNumber(sigmaDistribution.sd, 2)} />
            <SummaryMini label="Cp" value={fmtNumber(processCapability.cp, 2)} />
            <SummaryMini label="Cpk" value={fmtNumber(processCapability.cpk, 2)} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
          <FilterField label="Tháng/Năm A" className="xl:col-span-3">
            <select value={compareMonthA} onChange={(e) => setCompareMonthA(e.target.value)} className={INPUT_CLASS}>
              {compareMonthOptions.map((value) => (
                <option key={value} value={value}>
                  {formatBucket(value, "month")}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Tháng/Năm B" className="xl:col-span-3">
            <select value={compareMonthB} onChange={(e) => setCompareMonthB(e.target.value)} className={INPUT_CLASS}>
              {compareMonthOptions.map((value) => (
                <option key={value} value={value}>
                  {formatBucket(value, "month")}
                </option>
              ))}
            </select>
          </FilterField>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-700">Xu hướng chỉ tiêu</h2>
            <p className="mt-0.5 text-xs text-slate-400">{compareLabels.a} so với {compareLabels.b} theo chỉ tiêu đang xem.</p>
          </div>
          <div className="h-80">
            {loading ? (
              <StateMessage text="Đang tải dữ liệu..." />
            ) : compareTrendData.length === 0 ? (
              <StateMessage text="Không có dữ liệu so sánh tháng" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={compareTrendData} margin={{ bottom: 24 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" height={44} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<DashboardTooltip />} />
                  <Legend />
                  <Line type="monotone" dataKey="monthA" name={compareLabels.a} stroke="#0f766e" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="monthB" name={compareLabels.b} stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-700">Biểu đồ Kiểm soát</h2>
            <p className="mt-0.5 text-xs text-slate-400">{compareLabels.a} và {compareLabels.b} trên cùng trục ngày kiểm nghiệm.</p>
          </div>
          <div className="h-80">
            {loading ? (
              <StateMessage text="Đang tải dữ liệu..." />
            ) : compareTrendData.length === 0 ? (
              <StateMessage text="Không có dữ liệu so sánh tháng" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={compareTrendData} margin={{ bottom: 24 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" height={44} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<DashboardTooltip />} />
                  <Legend />
                  <ReferenceLine y={compareControlStats.a.center} stroke="#0f766e" strokeDasharray="4 4" label={`${compareLabels.a} CL`} />
                  <ReferenceLine y={compareControlStats.b.center} stroke="#2563eb" strokeDasharray="4 4" label={`${compareLabels.b} CL`} />
                  <Line type="monotone" dataKey="monthA" name={compareLabels.a} stroke="#0f766e" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="monthB" name={compareLabels.b} stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-700">Phân bố Chuẩn</h2>
            <p className="mt-0.5 text-xs text-slate-400">So sánh phân bố chuẩn giữa {compareLabels.a} và {compareLabels.b}, có kèm đường trung bình.</p>
          </div>
          <div className="h-80">
            {loading ? (
              <StateMessage text="Đang tải dữ liệu..." />
            ) : compareSigmaDistribution.length === 0 ? (
              <StateMessage text="Không có dữ liệu so sánh tháng" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={compareSigmaDistribution}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="sigmaLabel" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<DashboardTooltip />} />
                  <Legend />
                  <ReferenceLine x="0σ" stroke="#0f766e" strokeDasharray="4 4" label="TB" />
                  <Line type="monotone" dataKey="monthA" name={compareLabels.a} stroke="#0f766e" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
                  <Line type="monotone" dataKey="monthB" name={compareLabels.b} stroke="#2563eb" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-700">Top nhóm rủi ro</h2>
            <p className="mt-0.5 text-xs text-slate-400">Xếp hạng theo tỷ lệ không đạt và mức lệch của chỉ tiêu đang xem.</p>
          </div>

          <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
            {driversData.length === 0 ? (
              <StateMessage text="Không có dữ liệu phân nhóm" compact />
            ) : (
              driversData.map((item) => (
                <div key={item.key} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-bold text-slate-700">{item.key}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {item.total} lô · Trung bình {METRIC_LABEL_MAP[focusMetric]}: {fmtNumber(item.mean, 2)}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold ${
                        item.failRate >= 20
                          ? "bg-red-100 text-red-700"
                          : item.failRate >= 10
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {fmtPercent(item.failRate)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full ${item.failRate >= 20 ? "bg-red-500" : item.failRate >= 10 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(item.failRate, 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-700">Heatmap dấu hiệu ảnh hưởng</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Hàng là nhóm theo trục phân tích, cột là chỉ tiêu; màu cho biết tỷ lệ không đạt của từng ô.
            </p>
          </div>

          {heatmapRows.length === 0 ? (
            <StateMessage text="Không có dữ liệu heatmap" compact />
          ) : (
            <div className="max-h-[640px] overflow-auto">
              <div className="min-w-[520px]">
                <div className="grid gap-2" style={{ gridTemplateColumns: `220px repeat(${selectedMetrics.length}, minmax(0, 1fr))` }}>
                  <div className="px-3 py-2 text-xs font-bold text-slate-500">Nhóm</div>
                  {selectedMetrics.map((metric) => (
                    <div key={metric} className="px-3 py-2 text-center text-xs font-bold text-slate-500">
                      {METRIC_LABEL_MAP[metric]}
                    </div>
                  ))}
                  {heatmapRows.map((row) => (
                    <HeatmapRow key={row.label} row={row} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-700">Drill-down chi tiết</h2>
            <p className="mt-0.5 text-xs text-slate-400">Đi từ nhóm {"->"} ngày kiểm {"->"} lô / PKN để soi xuống dữ liệu gốc.</p>
          </div>

          {drillGroups.length === 0 ? (
            <StateMessage text="Không có dữ liệu drill-down" compact />
          ) : (
            <div className="max-h-[640px] space-y-4 overflow-y-auto pr-1">
              {drillGroups.map((group) => {
                const expanded = expandedGroupKeys.has(group.key)
                return (
                  <div key={group.key} className="overflow-hidden rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="flex w-full items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        {expanded ? (
                          <ChevronDown size={16} className="mt-0.5 shrink-0 text-slate-400" />
                        ) : (
                          <ChevronRight size={16} className="mt-0.5 shrink-0 text-slate-400" />
                        )}
                        <div>
                          <div className="break-words text-sm font-bold text-slate-800">{group.label}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {group.records.length} lô · fail {fmtPercent(group.failRate)}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-extrabold text-blue-700">{group.dates.length} ngày</div>
                      </div>
                    </button>

                    {expanded && (
                      <div className="divide-y divide-slate-100">
                        {group.dates.map((dateGroup) => {
                          const dateKey = `${group.key}|${dateGroup.date}`
                          const dateExpanded = expandedDateKeys.has(dateKey)
                          return (
                            <div key={dateKey}>
                              <button
                                type="button"
                                onClick={() => toggleDate(dateKey)}
                                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                              >
                                <div className="flex min-w-0 items-start gap-2">
                                  {dateExpanded ? (
                                    <ChevronDown size={15} className="mt-0.5 shrink-0 text-slate-400" />
                                  ) : (
                                    <ChevronRight size={15} className="mt-0.5 shrink-0 text-slate-400" />
                                  )}
                                  <div>
                                    <div className="text-sm font-semibold text-slate-700">{dateGroup.date.split("-").reverse().join("/")}</div>
                                    <div className="mt-1 text-xs text-slate-500">
                                      {dateGroup.records.length} lô · trung bình {METRIC_LABEL_MAP[focusMetric]}: {fmtNumber(dateGroup.mean, 2)}
                                    </div>
                                  </div>
                                </div>
                              </button>

                              {dateExpanded && (
                                <div className="px-4 pb-4">
                                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                                    <table className="w-full text-sm">
                                      <thead className="bg-slate-50 text-slate-500">
                                        <tr>
                                          {["Lô", "PKN", "CSR", "KN", "Ca", "Bọc", "Ngăn", METRIC_LABEL_MAP[focusMetric], "KQ"].map((head) => (
                                            <th key={head} className="px-3 py-2 text-left font-bold">
                                              {head}
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {dateGroup.records.map((record) => (
                                          <tr key={record.id} className="border-t border-slate-100">
                                            <td className="px-3 py-2 font-bold text-slate-700">{record.ma_lo}</td>
                                            <td className="px-3 py-2 text-slate-500">{record.pkn}</td>
                                            <td className="px-3 py-2 text-slate-500">{record.loai_csr}</td>
                                            <td className="px-3 py-2 text-slate-500">{loaiKnLabel(record.loai_kn)}</td>
                                            <td className="px-3 py-2 text-slate-500">{record.ca}</td>
                                            <td className="px-3 py-2 text-slate-500">{record.boc}</td>
                                            <td className="px-3 py-2 text-slate-500">{record.ngan_label}</td>
                                            <td className="px-3 py-2 font-semibold text-slate-700">{fmtNumber(record.metrics[focusMetric]?.mean, 2)}</td>
                                            <td className="px-3 py-2">
                                              <span
                                                className={`rounded-full px-2 py-1 text-xs font-bold ${
                                                  record.trang_thai === "dat" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                                                }`}
                                              >
                                                {statusText(record.trang_thai)}
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
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
  )
}

function FilterField({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-bold text-slate-600">{label}</label>
      {children}
    </div>
  )
}

function SummaryMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-[11px] font-bold text-slate-500">{label}</div>
      <div className="text-sm font-extrabold text-slate-700">{value}</div>
    </div>
  )
}

function StateMessage({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={`flex h-full items-center justify-center text-sm text-slate-400 ${compact ? "py-12" : ""}`}>{text}</div>
}

function HeatmapRow({
  row,
}: {
  row: {
    label: string
    cells: {
      metric: MetricKey
      count: number
      failRate: number
      mean: number | null
    }[]
  }
}) {
  return (
    <>
      <div className="border-t border-slate-100 px-3 py-3 text-sm font-semibold text-slate-700">{row.label}</div>
      {row.cells.map((cell) => {
        const bg =
          cell.count === 0
            ? "bg-slate-50 text-slate-400"
            : cell.failRate >= 20
              ? "bg-red-100 text-red-700"
              : cell.failRate >= 10
                ? "bg-amber-100 text-amber-700"
                : "bg-emerald-100 text-emerald-700"

        return (
          <div
            key={cell.metric}
            className={`rounded-lg border border-white px-3 py-3 text-center ${bg}`}
            title={`${METRIC_LABEL_MAP[cell.metric]} | ${cell.count} lô | không đạt ${fmtPercent(cell.failRate)} | trung bình ${fmtNumber(cell.mean, 2)}`}
          >
            <div className="text-sm font-extrabold">{cell.count ? fmtPercent(cell.failRate) : "—"}</div>
            <div className="mt-1 text-[11px]">{cell.count ? fmtNumber(cell.mean, 2) : "Không có dữ liệu"}</div>
          </div>
        )
      })}
    </>
  )
}
