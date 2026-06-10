"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import {
  BarChart3, Plus, Upload, Search, AlertTriangle, X,
  ChevronDown, ChevronUp, Filter,
} from "lucide-react"
import type { ProductionRecord, OutputFormState } from "./_components/output-types"
import {
  WARN_LABELS, WARN_SEVERITY, parseVehicleCode, buildProductionRecordKey,
  writeBackToDispatch,
  type WarnCode,
} from "./_components/output-types"
import { OutputImport } from "./_components/output-import"
import { OutputForm } from "./_components/output-form"
import { loadRequiredNotes } from "@/lib/required-notes"
import { EMPTY_NOTE_FILTER, matchesNoteFilter } from "@/lib/note-filter"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"

// ────────────────────────────────────────────────────────────────
// Types for dispatch data used in matching
// ────────────────────────────────────────────────────────────────
interface DispatchEntry {
  id: string
  ngay: string
  rows: Array<{ uid: string; so_xe: string; chuyen: number; tai_xe: string; diem_gn: string[] }>
}
interface DeliveryPoint { ma_lo: string; doi: number }

const LATEX_FILTER_OPTIONS = ["Mủ nước", "Mủ chén", "Mủ đông chén", "Mủ đông khối", "Mủ dây"] as const
type LatexFilterOption = typeof LATEX_FILTER_OPTIONS[number]

const MATERIAL_DEFS = [
  { label: "Mủ nước", shortLabel: "Nước", tuoiKey: "mn_tuoi", khoKey: "mn_kho" },
  { label: "Mủ chén", shortLabel: "Chén", tuoiKey: "ct_tuoi", khoKey: "ct_kho" },
  { label: "Mủ đông chén", shortLabel: "ĐChén", tuoiKey: "dct_tuoi", khoKey: "dct_kho" },
  { label: "Mủ đông khối", shortLabel: "ĐKhối", tuoiKey: "dkt_tuoi", khoKey: "dkt_kho" },
  { label: "Mủ dây", shortLabel: "Dây", tuoiKey: "dt_tuoi", khoKey: "dt_kho" },
] as const satisfies ReadonlyArray<{
  label: LatexFilterOption
  shortLabel: string
  tuoiKey: keyof ProductionRecord
  khoKey: keyof ProductionRecord
}>

function getActiveMaterialDefs(selected: string[]) {
  if (selected.length === 0) return MATERIAL_DEFS
  return MATERIAL_DEFS.filter((def) => selected.includes(def.label))
}

function getMaterialFlags(record: ProductionRecord) {
  return {
    "Mủ nước": (record.mn_tuoi ?? 0) > 0 || (record.mn_kho ?? 0) > 0,
    "Mủ chén": (record.ct_tuoi ?? 0) > 0 || (record.ct_kho ?? 0) > 0,
    "Mủ đông chén": (record.dct_tuoi ?? 0) > 0 || (record.dct_kho ?? 0) > 0,
    "Mủ đông khối": (record.dkt_tuoi ?? 0) > 0 || (record.dkt_kho ?? 0) > 0,
    "Mủ dây": (record.dt_tuoi ?? 0) > 0 || (record.dt_kho ?? 0) > 0,
  } as const
}

function getMaterialSummary(record: ProductionRecord, selected: string[] = []) {
  return getActiveMaterialDefs(selected)
    .map((def) => {
      const tuoi = Number(record[def.tuoiKey] ?? 0)
      const kho = Number(record[def.khoKey] ?? 0)
      if (tuoi <= 0 && kho <= 0) return null
      const pieces: string[] = []
      if (tuoi > 0) pieces.push(`tươi ${fmtNum(tuoi)}`)
      if (kho > 0) pieces.push(`khô ${fmtNum(kho)}`)
      return `${def.shortLabel} ${pieces.join(" / ")}`
    })
    .filter((part): part is string => Boolean(part))
}

function getFilteredTotals(record: ProductionRecord, selected: string[]) {
  const totals = { tuoi: 0, kho: 0 }
  for (const def of getActiveMaterialDefs(selected)) {
    totals.tuoi += Number(record[def.tuoiKey] ?? 0)
    totals.kho += Number(record[def.khoKey] ?? 0)
  }
  return totals
}

function matchesMaterialFilter(record: ProductionRecord, selected: string[]) {
  if (selected.length === 0) return true
  const flags = getMaterialFlags(record)
  return selected.some((material) => flags[material as LatexFilterOption])
}

function formatMaterialBreakdown(records: ProductionRecord[], field: "tuoi" | "kho") {
  const totals = Object.fromEntries(LATEX_FILTER_OPTIONS.map((label) => [label, 0])) as Record<LatexFilterOption, number>

  for (const record of records) {
    for (const def of MATERIAL_DEFS) {
      totals[def.label] += field === "tuoi" ? Number(record[def.tuoiKey] ?? 0) : Number(record[def.khoKey] ?? 0)
    }
  }

  return MATERIAL_DEFS.map((def) => `${def.shortLabel} ${fmtNum(totals[def.label], 0)} kg`).join(" · ")
}
// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  if (!iso) return ""
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function fmtNum(n: number | null | undefined, decimals = 1) {
  if (!n) return "—"
  return n.toLocaleString("vi-VN", { maximumFractionDigits: decimals })
}

function WarnBadge({ code }: { code: WarnCode }) {
  const sev = WARN_SEVERITY[code]
  const cls = sev === "red" ? "bg-red-100 text-red-700" :
              sev === "amber" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
  return (
    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>
      {WARN_LABELS[code]}
    </span>
  )
}

// ────────────────────────────────────────────────────────────────
// Stats card
// ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "emerald" }: {
  label: string; value: string; sub?: string; color?: "emerald" | "blue" | "amber" | "red"
}) {
  const border = { emerald: "border-emerald-200", blue: "border-blue-200", amber: "border-amber-200", red: "border-red-200" }[color]
  const text   = { emerald: "text-emerald-700", blue: "text-blue-700", amber: "text-amber-700", red: "text-red-700" }[color]
  return (
    <div className={`bg-white rounded-xl border ${border} shadow-sm p-4`}>
      <p className="text-xs font-bold text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-extrabold ${text}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function compareProductionRecordPriority(a: ProductionRecord, b: ProductionRecord) {
  const aStamp = a.updated_at || a.created_at || ""
  const bStamp = b.updated_at || b.created_at || ""
  if (aStamp !== bStamp) return bStamp.localeCompare(aStamp)
  if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at)
  return b.id.localeCompare(a.id)
}

// ────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────
export default function OutputPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)

  // Data
  const [records, setRecords] = useState<ProductionRecord[]>([])
  const [dispatches, setDispatches] = useState<DispatchEntry[]>([])
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPoint[]>([])
  // UI state
  const [tab, setTab] = useState<"stats" | "list" | "import">("list")
  const [showImport, setShowImport] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editRecord, setEditRecord] = useState<ProductionRecord | null>(null)
  const [formInitialDate, setFormInitialDate] = useState<string | null>(null)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [cleaningDuplicates, setCleaningDuplicates] = useState(false)
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({})
  const [editingDay, setEditingDay] = useState<string | null>(null)
  const [deleteDay, setDeleteDay] = useState<string | null>(null)
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<string[]>([])
  const [deletingDay, setDeletingDay] = useState(false)

  // Filters
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [filterTo, setFilterTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [filterDoi, setFilterDoi] = useState("")
  const [filterXe, setFilterXe] = useState("")
  const [filterGhiChu, setFilterGhiChu] = useState("")
  const [filterLoai, setFilterLoai] = useState<string[]>([])
  const [filterWarnOnly, setFilterWarnOnly] = useState(false)
  const [requiredNotes, setRequiredNotes] = useState<string[]>([])

  // Sort
  const [sortCol] = useState<"ngay" | "doi" | "so_xe">("ngay")
  const [sortAsc] = useState(false)
  const isAdmin = currentUser?.role === "admin"

  // ── Load data ───────────────────────────────────────────────
  const loadRecords = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from("production_records")
        .select("*")
        .eq("factory_id", fid)
        .gte("ngay", filterFrom)
        .lte("ngay", filterTo)
        .order("ngay", { ascending: false })
        .order("so_xe")
        .order("chuyen")
      setRecords((data as ProductionRecord[]) || [])
    } finally {
      setLoading(false)
    }
  }, [filterFrom, filterTo])

  const loadSupportData = useCallback(async (fid: string) => {
    const { data: dp } = await supabase
      .from("dispatch_delivery_points")
      .select("ma_lo, doi")
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
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
      await loadSupportData(fid)
    }
    void bootstrap()
  }, [loadSupportData])

  useEffect(() => {
    if (!factoryId) return

    let active = true
    const refreshPageData = async () => {
      setLoading(true)
      try {
        const [recordsResult, dispatchResult, noteRows] = await Promise.all([
          supabase
            .from("production_records")
            .select("*")
            .eq("factory_id", factoryId)
            .gte("ngay", filterFrom)
            .lte("ngay", filterTo)
            .order("ngay", { ascending: false })
            .order("so_xe")
            .order("chuyen"),
          supabase
            .from("dispatch_entries")
            .select("id, ngay, rows")
            .eq("factory_id", factoryId),
          loadRequiredNotes(supabase, factoryId),
        ])

        if (!active) return

        setRecords((recordsResult.data as ProductionRecord[]) || [])
        setDispatches((dispatchResult.data as DispatchEntry[]) || [])
        setRequiredNotes(noteRows.map((row) => row.content))
      } catch {
        if (!active) return
        setRequiredNotes([])
      } finally {
        if (active) setLoading(false)
      }
    }

    void refreshPageData()
    return () => {
      active = false
    }
  }, [factoryId, filterFrom, filterTo])

  // ── Filtered + sorted records ────────────────────────────────
  const filtered = records
    .filter(r => {
      if (filterDoi && r.doi !== parseInt(filterDoi)) return false
      if (filterXe && !r.so_xe.toUpperCase().includes(filterXe.toUpperCase())) return false
      if (!matchesNoteFilter(r.ghi_chu, filterGhiChu)) return false
      if (!matchesMaterialFilter(r, filterLoai)) return false
      if (filterWarnOnly && r.warn_codes.length === 0) return false
      return true
    })
    .sort((a, b) => {
      let cmp = 0
      if (sortCol === "ngay") cmp = a.ngay.localeCompare(b.ngay)
      else if (sortCol === "doi") cmp = a.doi - b.doi
      else cmp = a.so_xe.localeCompare(b.so_xe)
      return sortAsc ? cmp : -cmp
    })

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

  // ── Stats aggregation ─────────────────────────────────────────
  const statsFiltered = records.filter((r) => {
    if (!matchesNoteFilter(r.ghi_chu, filterGhiChu)) return false
    if (filterDoi && r.doi !== parseInt(filterDoi)) return false
    if (!matchesMaterialFilter(r, filterLoai)) return false
    return true
  })

  const groupedByDate = filtered.reduce((acc, record) => {
    const bucket = acc.get(record.ngay)
    if (bucket) bucket.push(record)
    else acc.set(record.ngay, [record])
    return acc
  }, new Map<string, ProductionRecord[]>())

  const groupedDates = Array.from(groupedByDate.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([ngay, dayRecords]) => ({
      ngay,
      records: [...dayRecords].sort((a, b) => {
        if (a.doi !== b.doi) return a.doi - b.doi
        const xeCompare = a.so_xe.localeCompare(b.so_xe)
        if (xeCompare !== 0) return xeCompare
        return a.chuyen - b.chuyen
      }),
      totalTuoi: dayRecords.reduce((sum, record) => sum + getFilteredTotals(record, filterLoai).tuoi, 0),
      totalKho: dayRecords.reduce((sum, record) => sum + getFilteredTotals(record, filterLoai).kho, 0),
    }))

  const totalT = statsFiltered.reduce((s, r) => s + getFilteredTotals(r, filterLoai).tuoi, 0)
  const totalK = statsFiltered.reduce((s, r) => s + getFilteredTotals(r, filterLoai).kho, 0)
  const warnCount = statsFiltered.filter(r => r.warn_codes.length > 0).length

  // KL khô theo đội
  const byDoi = new Map<number, number>()
  for (const r of statsFiltered) {
    const kho = getFilteredTotals(r, filterLoai).kho
    byDoi.set(r.doi, (byDoi.get(r.doi) ?? 0) + kho)
  }

  // Thống kê pivot xe + tài xế
  const byXe = new Map<string, { doi: number; tai_xe: string; chuyen_count: number; tuoi: number; kho: number; loaiSet: Set<string> }>()
  for (const r of statsFiltered) {
    const key = `${r.doi}:${r.so_xe}:${r.chuyen}`
    const materials = getMaterialSummary(r, filterLoai)
    const filteredTotals = getFilteredTotals(r, filterLoai)
    const existing = byXe.get(key)
    if (existing) {
      existing.tuoi += filteredTotals.tuoi
      existing.kho  += filteredTotals.kho
      for (const material of materials) existing.loaiSet.add(material)
    } else {
      byXe.set(key, {
        doi: r.doi,
        tai_xe: r.tai_xe ?? "",
        chuyen_count: r.chuyen,
        tuoi: filteredTotals.tuoi,
        kho: filteredTotals.kho,
        loaiSet: new Set(materials),
      })
    }
  }

  // ── Handlers ─────────────────────────────────────────────────
  const handleSave = async (form: OutputFormState) => {
    if (!factoryId) return
    if (!isAdmin) {
      setSaveError("Chỉ tài khoản admin mới được thêm hoặc sửa từng dòng sản lượng.")
      return
    }
    setSaveError(null)
    const payload = {
      factory_id: factoryId,
      ngay: form.ngay,
      doi: Number(form.doi),
      so_xe: parseVehicleCode(form.so_xe).base_xe,
      chuyen: Number(form.chuyen),
      tai_xe: form.tai_xe || null,
      mn_tuoi:  parseFloat(form.mn_tuoi)  || 0, mn_drc:  parseFloat(form.mn_drc)  || 0, mn_kho:  parseFloat(form.mn_kho)  || 0,
      ct_tuoi:  parseFloat(form.ct_tuoi)  || 0, ct_drc:  parseFloat(form.ct_drc)  || 0, ct_kho:  parseFloat(form.ct_kho)  || 0,
      dct_tuoi: parseFloat(form.dct_tuoi) || 0, dct_drc: parseFloat(form.dct_drc) || 0, dct_kho: parseFloat(form.dct_kho) || 0,
      dkt_tuoi: parseFloat(form.dkt_tuoi) || 0, dkt_drc: parseFloat(form.dkt_drc) || 0, dkt_kho: parseFloat(form.dkt_kho) || 0,
      dt_tuoi:  parseFloat(form.dt_tuoi)  || 0, dt_drc:  parseFloat(form.dt_drc)  || 0, dt_kho:  parseFloat(form.dt_kho)  || 0,
      ghi_chu: form.ghi_chu || null,
    }
    let error
    if (editRecord) {
      ({ error } = await supabase.from("production_records").update(payload).eq("id", editRecord.id))
    } else {
      ({ error } = await supabase.from("production_records").upsert(payload, { onConflict: "factory_id,ngay,so_xe,chuyen,doi" }))
    }
    if (error) throw new Error(error.message)
    setShowForm(false)
    setEditRecord(null)
    void loadRecords(factoryId)
    void writeBackToDispatch(factoryId, form.ngay, supabase).catch(() => {})
  }

  const handleDelete = async (id: string) => {
    if (!factoryId) return
    if (!isAdmin) {
      setSaveError("Chỉ tài khoản admin mới được xóa từng dòng sản lượng.")
      return
    }
    const rec = records.find(r => r.id === id)
    await supabase.from("production_records").delete().eq("id", id)
    setDelConfirm(null)
    void loadRecords(factoryId)
    if (rec) void writeBackToDispatch(factoryId, rec.ngay, supabase).catch(() => {})
  }

  const handleCleanupDuplicates = async () => {
    if (!factoryId || !isAdmin || redundantRecordCount === 0) return
    setCleaningDuplicates(true)
    setSaveError(null)
    try {
      const deleteIds = redundantRecords.map((record) => record.id)
      const affectedDates = [...new Set(redundantRecords.map((record) => record.ngay))]
      const { error } = await supabase.from("production_records").delete().in("id", deleteIds)
      if (error) throw new Error(error.message)
      await Promise.all(affectedDates.map((ngay) => writeBackToDispatch(factoryId, ngay, supabase)))
      await loadRecords(factoryId)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Khong the don cac dong san luong thua.")
    } finally {
      setCleaningDuplicates(false)
    }
  }

  const openCreateForDate = (ngay: string) => {
    setEditRecord(null)
    setFormInitialDate(ngay)
    setShowForm(true)
  }

  const openEditRecord = (record: ProductionRecord) => {
    setFormInitialDate(record.ngay)
    setEditRecord(record)
    setShowForm(true)
  }

  const toggleDayExpanded = (ngay: string) => {
    setExpandedDays((current) => ({ ...current, [ngay]: !current[ngay] }))
  }

  const beginDeleteDay = (ngay: string) => {
    setDeleteDay((current) => current === ngay ? null : ngay)
    setSelectedDeleteIds([])
    setEditingDay((current) => current === ngay ? null : current)
    setExpandedDays((current) => ({ ...current, [ngay]: true }))
  }

  const toggleDeleteSelection = (id: string) => {
    setSelectedDeleteIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const handleDeleteSelectedDay = async () => {
    if (!factoryId || !isAdmin || !deleteDay || selectedDeleteIds.length === 0) return
    setDeletingDay(true)
    try {
      const { error } = await supabase.from("production_records").delete().in("id", selectedDeleteIds)
      if (error) throw new Error(error.message)
      await loadRecords(factoryId)
      await writeBackToDispatch(factoryId, deleteDay, supabase)
      setDeleteDay(null)
      setSelectedDeleteIds([])
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Khong the xoa cac dong san luong da chon.")
    } finally {
      setDeletingDay(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
            <BarChart3 size={26} className="text-emerald-600" />Sản lượng
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý và thống kê sản lượng mủ theo xe, tài xế, đội</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all text-sm"
          >
            <Upload size={15} />Import file
          </button>
          {isAdmin && (
          <button
            onClick={() => { setEditRecord(null); setFormInitialDate(null); setShowForm(true) }}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all"
          >
            <Plus size={16} />Thêm mới
          </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5 w-fit">
        {(["list", "stats", "import"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${tab === t ? "bg-white shadow text-emerald-700" : "text-slate-600 hover:text-slate-800"}`}
          >
            {t === "list" ? "Danh sách" : t === "stats" ? "Thống kê" : "Hướng dẫn Import"}
          </button>
        ))}
      </div>

      {/* Date range filter (shared) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-500">Từ ngày</label>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-500">Đến ngày</label>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
        </div>
        {(tab === "list" || tab === "stats") && (
          <>
            {tab === "list" && (
              <>
                <select value={filterDoi} onChange={e => setFilterDoi(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  <option value="">Tất cả đội</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>Đội {d}</option>
                  ))}
                </select>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={filterXe} onChange={e => setFilterXe(e.target.value)}
                    placeholder="Tìm số xe..." className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 w-36" />
                </div>
                <FilterMultiSelect
                  options={LATEX_FILTER_OPTIONS}
                  selected={filterLoai}
                  onChange={setFilterLoai}
                  placeholder="Tất cả nguyên liệu"
                  className="min-w-64"
                />
              </>
            )}
            {tab === "stats" && (
              <>
                <select value={filterDoi} onChange={e => setFilterDoi(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  <option value="">Tất cả đội</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>Đội {d}</option>
                  ))}
                </select>
                <FilterMultiSelect
                  options={LATEX_FILTER_OPTIONS}
                  selected={filterLoai}
                  onChange={setFilterLoai}
                  placeholder="Tất cả loại nguyên liệu"
                  className="min-w-64"
                />
              </>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-500">Ghi chú Đội</label>
              <select value={filterGhiChu} onChange={e => setFilterGhiChu(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                <option value="">Tất cả ghi chú đội</option>
                <option value={EMPTY_NOTE_FILTER}>Không có ghi chú</option>
                {requiredNotes.map(note => <option key={note} value={note}>{note}</option>)}
              </select>
            </div>
            {tab === "list" && (
              <button
                onClick={() => setFilterWarnOnly(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${filterWarnOnly ? "bg-amber-100 text-amber-700 border border-amber-300" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
              >
                <Filter size={12} />Chỉ cảnh báo
              </button>
            )}
          </>
        )}
        {isAdmin && redundantRecordCount > 0 && (
          <button
            onClick={() => void handleCleanupDuplicates()}
            disabled={cleaningDuplicates}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AlertTriangle size={12} />
            {cleaningDuplicates ? "Đang dọn..." : `Dọn ${redundantRecordCount} dòng thừa`}
          </button>
        )}
        {(filterFrom || filterTo || filterDoi || filterXe || filterGhiChu || filterLoai.length > 0 || filterWarnOnly) && (
          <button
            onClick={() => {
              setFilterFrom("")
              setFilterTo("")
              setFilterDoi("")
              setFilterXe("")
              setFilterGhiChu("")
              setFilterLoai([])
              setFilterWarnOnly(false)
            }}
            className="text-xs font-bold text-slate-500 hover:text-red-600"
          >
            Xóa lọc
          </button>
        )}
        <span className={`${isAdmin && redundantRecordCount > 0 ? "" : "ml-auto "}text-xs text-slate-400`}>{records.length} bản ghi trong kỳ</span>
      </div>

      {/* ── Tab: Danh sách ── */}
      {tab === "list" && (
        <>
          {loading ? (
            <div className="p-12 text-center text-slate-400">Đang tải...</div>
          ) : groupedDates.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <BarChart3 size={40} className="mx-auto mb-3 opacity-30" />
              <p>Không có dữ liệu sản lượng trong kỳ này</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedDates.map(({ ngay, records: dayRecords, totalTuoi: dayTuoi, totalKho: dayKho }) => {
                const expanded = !!expandedDays[ngay]
                const isEditingDay = editingDay === ngay
                const isDeleteDay = deleteDay === ngay
                const selectedCount = dayRecords.filter((record) => selectedDeleteIds.includes(record.id)).length

                return (
                  <div key={ngay} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleDayExpanded(ngay)}
                        className="flex items-center gap-2 rounded-xl px-2 py-1 text-left text-slate-700 transition-colors hover:bg-slate-100"
                      >
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        <span className="text-lg font-extrabold">{fmtDate(ngay)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{dayRecords.length} dòng</span>
                      </button>

                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="rounded-full bg-blue-50 px-3 py-1 font-bold text-blue-700">Tươi {fmtNum(dayTuoi, 0)} kg</span>
                        <span className="rounded-full bg-emerald-50 px-3 py-1 font-bold text-emerald-700">Khô {fmtNum(dayKho, 0)} kg</span>
                      </div>

                      {isAdmin && (
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                          {isDeleteDay && (
                            <span className="text-xs font-bold text-amber-700">{selectedCount} dòng đã chọn</span>
                          )}
                          {isDeleteDay ? (
                            <>
                              <button
                                onClick={() => void handleDeleteSelectedDay()}
                                disabled={selectedDeleteIds.length === 0 || deletingDay}
                                className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {deletingDay ? "Đang xóa..." : `Xóa ${selectedCount || ""}`.trim()}
                              </button>
                              <button
                                onClick={() => { setDeleteDay(null); setSelectedDeleteIds([]) }}
                                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                              >
                                Hủy
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => openCreateForDate(ngay)}
                                className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                              >
                                + Thêm
                              </button>
                              <button
                                onClick={() => { setEditingDay((current) => current === ngay ? null : ngay); setDeleteDay(null); setExpandedDays((current) => ({ ...current, [ngay]: true })) }}
                                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                                  isEditingDay ? "bg-blue-600 text-white" : "border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                }`}
                              >
                                Sửa
                              </button>
                              <button
                                onClick={() => beginDeleteDay(ngay)}
                                className="rounded-xl border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                              >
                                Xóa
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {expanded && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              {isDeleteDay && <th className="w-12 px-3 py-3"></th>}
                              <th className="px-3 py-3 text-center font-bold text-slate-600">Đội</th>
                              <th className="px-3 py-3 text-left font-bold text-slate-600">Số xe</th>
                              <th className="px-3 py-3 text-center font-bold text-slate-600">Chuyến</th>
                              <th className="px-3 py-3 text-left font-bold text-slate-600">Tài xế</th>
                              <th className="px-3 py-3 text-right font-bold text-slate-600">Tươi (kg)</th>
                              <th className="px-3 py-3 text-right font-bold text-slate-600">Khô (kg)</th>
                              <th className="px-3 py-3 text-left font-bold text-slate-600">Nguyên liệu</th>
                              <th className="px-3 py-3 text-left font-bold text-slate-600">Cảnh báo</th>
                              <th className="px-3 py-3 text-left font-bold text-slate-600">Ghi chú</th>
                              {isEditingDay && <th className="px-3 py-3 w-16"></th>}
                            </tr>
                          </thead>
                          <tbody>
                            {dayRecords.map((record, index) => {
                              const hasRed = record.warn_codes.some((code) => WARN_SEVERITY[code as WarnCode] === "red")
                              const hasAmb = !hasRed && record.warn_codes.some((code) => WARN_SEVERITY[code as WarnCode] === "amber")
                              const rowCls = hasRed ? "bg-red-50" : hasAmb ? "bg-amber-50/40" : index % 2 === 0 ? "" : "bg-slate-50/50"
                              const latexParts = getMaterialSummary(record)
                              const filteredTotals = getFilteredTotals(record, filterLoai)

                              return (
                                <tr key={record.id} className={`border-t border-slate-100 transition-colors duration-150 hover:bg-slate-50 ${rowCls}`}>
                                  {isDeleteDay && (
                                    <td className="px-3 py-2 text-center">
                                      <input
                                        type="checkbox"
                                        checked={selectedDeleteIds.includes(record.id)}
                                        onChange={() => toggleDeleteSelection(record.id)}
                                        className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                                      />
                                    </td>
                                  )}
                                  <td className="px-3 py-2 text-center font-bold text-slate-700">{record.doi}</td>
                                  <td className="px-3 py-2 font-mono font-bold text-slate-800">{record.so_xe}</td>
                                  <td className="px-3 py-2 text-center text-slate-600">{record.chuyen}</td>
                                  <td className="px-3 py-2 text-slate-600">{record.tai_xe || <span className="text-slate-300">—</span>}</td>
                                  <td className="px-3 py-2 text-right text-slate-700">{fmtNum(filteredTotals.tuoi)}</td>
                                  <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtNum(filteredTotals.kho)}</td>
                                  <td className="px-3 py-2 text-slate-500 text-xs">{latexParts.join(" · ") || "—"}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex flex-wrap gap-0.5">
                                      {(record.warn_codes as WarnCode[]).map((code) => <WarnBadge key={code} code={code} />)}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-slate-500">{record.ghi_chu || "—"}</td>
                                  {isEditingDay && (
                                    <td className="px-3 py-2">
                                      <button
                                        onClick={() => openEditRecord(record)}
                                        className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
                                      >
                                        Sửa
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Tab: Thống kê ── */}
      {tab === "stats" && (
        <div className="space-y-5">
          {/* KPI */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
            <StatCard label="Tổng KL tươi" value={`${fmtNum(totalT, 0)} kg`} color="blue" />
            <StatCard label="Tổng KL khô" value={`${fmtNum(totalK, 0)} kg`} color="emerald" />
            <StatCard label="Số bản ghi" value={String(statsFiltered.length)} color="blue" />
            <StatCard label="Cảnh báo" value={String(warnCount)} sub={warnCount > 0 ? "Cần kiểm tra" : "Tất cả OK"} color={warnCount > 0 ? "amber" : "emerald"} />
            <StatCard label="Tươi theo loại" value={`${filterLoai.length || LATEX_FILTER_OPTIONS.length} loại`} sub={formatMaterialBreakdown(statsFiltered, "tuoi")} color="blue" />
            <StatCard label="Khô theo loại" value={`${filterLoai.length || LATEX_FILTER_OPTIONS.length} loại`} sub={formatMaterialBreakdown(statsFiltered, "kho")} color="emerald" />
          </div>

          {/* KL khô theo đội */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="font-bold text-slate-700 mb-4">KL khô theo đội (kg)</h3>
            <div className="space-y-2">
              {Array.from(byDoi.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([doi, kho]) => {
                  const maxKho = Math.max(...Array.from(byDoi.values()), 1)
                  const pct = Math.round(kho / maxKho * 100)
                  return (
                    <div key={doi} className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-500 w-12 text-right">Đội {doi}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-bold text-emerald-700 w-24 text-right">
                        {fmtNum(kho, 0)} kg
                      </span>
                    </div>
                  )
                })}
              {byDoi.size === 0 && <p className="text-slate-400 text-sm">Không có dữ liệu</p>}
            </div>
          </div>

          {/* Pivot theo xe + tài xế */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-700">Chi tiết theo xe</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-center font-bold text-slate-600">Đội</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Số xe</th>
                    <th className="px-3 py-2 text-center font-bold text-slate-600">Chuyến</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Tài xế</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Nguyên liệu</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600">Tươi (kg)</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600">Khô (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(byXe.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, v], i) => {
                      const [, xe, ch] = key.split(":")
                      return (
                        <tr key={key} className={`border-t border-slate-100 ${i % 2 === 0 ? "" : "bg-slate-50/50"}`}>
                          <td className="px-3 py-2 text-center font-bold text-slate-700">{v.doi}</td>
                          <td className="px-3 py-2 font-mono font-bold text-slate-800">{xe}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{ch}</td>
                          <td className="px-3 py-2 text-slate-600">{v.tai_xe || "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{Array.from(v.loaiSet).join(" · ") || "—"}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{fmtNum(v.tuoi)}</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtNum(v.kho)}</td>
                        </tr>
                      )
                    })}
                  {byXe.size === 0 && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Không có dữ liệu</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Hướng dẫn Import ── */}
      {tab === "import" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 text-sm text-slate-700">
          <h3 className="font-bold text-slate-800 text-base">Hướng dẫn import file sản lượng</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="font-bold mb-2">Cấu trúc file (19 cột A–S):</p>
              <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-left">Cột</th><th className="px-2 py-1 text-left">Nội dung</th></tr></thead>
                <tbody>
                  {[
                    ["A", "Ngày (dd/mm/yyyy hoặc Excel date)"],
                    ["B", "Đội (số nguyên 1–12)"],
                    ["C", "Số xe (1A, 1A2, 01A, ...)"],
                    ["D–F", "Mủ nước: Tươi / DRC% / Khô"],
                    ["G–I", "Mủ chén: Tươi / DRC% / Khô"],
                    ["J–L", "Mủ đông chén: Tươi / DRC% / Khô"],
                    ["M–O", "Mủ đông khối: Tươi / DRC% / Khô"],
                    ["P–R", "Mủ dây: Tươi / DRC% / Khô"],
                    ["S", "Ghi chú"],
                  ].map(([col, desc]) => (
                    <tr key={col} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-mono font-bold text-emerald-700">{col}</td>
                      <td className="px-2 py-1 text-slate-600">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3">
              <div>
                <p className="font-bold mb-1">Quy tắc mã xe:</p>
                <ul className="list-disc list-inside space-y-1 text-slate-600">
                  <li><code className="font-mono bg-slate-100 px-1 rounded">1A</code> = xe 1A, chuyến 1</li>
                  <li><code className="font-mono bg-slate-100 px-1 rounded">1A2</code> = xe 1A, chuyến 2</li>
                  <li><code className="font-mono bg-slate-100 px-1 rounded">01A</code> và <code className="font-mono bg-slate-100 px-1 rounded">1A</code> được hiểu như nhau</li>
                </ul>
              </div>
              <div>
                <p className="font-bold mb-1">Cảnh báo sau import:</p>
                <ul className="space-y-1">
                  {(Object.entries(WARN_LABELS) as [WarnCode, string][]).map(([code, label]) => (
                    <li key={code} className="flex items-start gap-2">
                      <WarnBadge code={code} />
                      <span className="text-slate-600">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-3 bg-blue-50 rounded-xl text-blue-700 text-xs">
                Dòng có cảnh báo vẫn được nhập vào hệ thống. Import lại file sẽ cập nhật (upsert) theo Ngày + Xe + Chuyến.
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowImport(true)}
            className="mt-4 flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all"
          >
            <Upload size={16} />Bắt đầu import
          </button>
        </div>
      )}

      {/* ── Modals ── */}
      {showImport && factoryId && (
        <OutputImport
          factoryId={factoryId}
          dispatches={dispatches}
          deliveryPoints={deliveryPoints}
          supabase={supabase}
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <p className="font-bold text-slate-800 mb-2">Xóa bản ghi?</p>
            <p className="text-sm text-slate-500 mb-5">Thao tác này không thể hoàn tác.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={() => handleDelete(delConfirm)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm">Xóa</button>
            </div>
          </div>
        </div>
      )}

      {saveError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-bold">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
