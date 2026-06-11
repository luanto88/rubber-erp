"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChevronRight,
  Edit2,
  FileText,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import type { OutputFormState, ProductionRecord } from "./_components/output-types"
import {
  WARN_LABELS,
  WARN_SEVERITY,
  buildProductionRecordKey,
  parseVehicleCode,
  writeBackToDispatch,
  type WarnCode,
} from "./_components/output-types"
import { OutputImport } from "./_components/output-import"
import { OutputForm } from "./_components/output-form"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { loadRequiredNotes } from "@/lib/required-notes"
import { EMPTY_NOTE_FILTER, matchesNoteFilter } from "@/lib/note-filter"
import { downloadOutputDayPdf } from "@/lib/output-pdf"

interface DispatchEntry {
  id: string
  ngay: string
  rows: Array<{ uid: string; so_xe: string; chuyen: number; tai_xe: string; diem_gn: string[] }>
}

interface DeliveryPoint {
  ma_lo: string
  doi: number
}

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

function matchesMaterialFilter(record: ProductionRecord, selected: string[]) {
  if (selected.length === 0) return true
  const flags = getMaterialFlags(record)
  return selected.some((material) => flags[material as LatexFilterOption])
}

function fmtDate(iso: string) {
  if (!iso) return ""
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
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

function WarnBadge({ code }: { code: WarnCode }) {
  const sev = WARN_SEVERITY[code]
  const cls = sev === "red"
    ? "bg-red-100 text-red-700"
    : sev === "amber"
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-500"
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
      {WARN_LABELS[code]}
    </span>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-slate-800">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
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

export default function OutputPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [records, setRecords] = useState<ProductionRecord[]>([])
  const [dispatches, setDispatches] = useState<DispatchEntry[]>([])
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPoint[]>([])

  const [tab, setTab] = useState<"list" | "stats" | "import">("list")
  const [showImport, setShowImport] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editRecord, setEditRecord] = useState<ProductionRecord | null>(null)
  const [formInitialDate, setFormInitialDate] = useState<string | null>(null)
  const [detailDay, setDetailDay] = useState<string | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([])
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [cleaningDuplicates, setCleaningDuplicates] = useState(false)
  const [deletingRows, setDeletingRows] = useState(false)

  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [filterTo, setFilterTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [filterDoi, setFilterDoi] = useState("")
  const [filterXe, setFilterXe] = useState("")
  const [filterGhiChu, setFilterGhiChu] = useState("")
  const [filterLoai, setFilterLoai] = useState<string[]>([])
  const [filterWarnOnly, setFilterWarnOnly] = useState(false)
  const [requiredNotes, setRequiredNotes] = useState<string[]>([])

  const isAdmin = currentUser?.role === "admin"

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
      if (!fid) {
        setLoading(false)
        return
      }
      setFactoryId(fid)
      await loadSupportData(fid)
    }
    void bootstrap()
  }, [loadSupportData])

  useEffect(() => {
    if (!factoryId) return
    let active = true

    const refresh = async () => {
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
          supabase.from("dispatch_entries").select("id, ngay, rows").eq("factory_id", factoryId),
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

    void refresh()
    return () => {
      active = false
    }
  }, [factoryId, filterFrom, filterTo])

  const filtered = records
    .filter((record) => {
      if (filterDoi && record.doi !== Number(filterDoi)) return false
      if (filterXe && !record.so_xe.toUpperCase().includes(filterXe.toUpperCase())) return false
      if (!matchesNoteFilter(record.ghi_chu, filterGhiChu)) return false
      if (!matchesMaterialFilter(record, filterLoai)) return false
      if (filterWarnOnly && record.warn_codes.length === 0) return false
      return true
    })
    .sort((a, b) => {
      if (a.ngay !== b.ngay) return b.ngay.localeCompare(a.ngay)
      if (a.doi !== b.doi) return a.doi - b.doi
      const xeCompare = a.so_xe.localeCompare(b.so_xe)
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
    if (!matchesNoteFilter(record.ghi_chu, filterGhiChu)) return false
    if (filterDoi && record.doi !== Number(filterDoi)) return false
    if (!matchesMaterialFilter(record, filterLoai)) return false
    return true
  })
  const totalTuoiAll = statsFiltered.reduce((sum, record) => sum + getFilteredTotals(record, filterLoai).tuoi, 0)
  const totalKhoAll = statsFiltered.reduce((sum, record) => sum + getFilteredTotals(record, filterLoai).kho, 0)
  const warnCount = statsFiltered.filter((record) => record.warn_codes.length > 0).length

  const byDoi = new Map<number, number>()
  for (const record of statsFiltered) {
    const kho = getFilteredTotals(record, filterLoai).kho
    byDoi.set(record.doi, (byDoi.get(record.doi) ?? 0) + kho)
  }

  const byVehicle = new Map<string, { doi: number; taiXe: string; tuoi: number; kho: number }>()
  for (const record of statsFiltered) {
    const key = `${record.doi}:${record.so_xe}:${record.chuyen}`
    const totals = getFilteredTotals(record, filterLoai)
    const current = byVehicle.get(key)
    if (current) {
      current.tuoi += totals.tuoi
      current.kho += totals.kho
    } else {
      byVehicle.set(key, {
        doi: record.doi,
        taiXe: record.tai_xe ?? "",
        tuoi: totals.tuoi,
        kho: totals.kho,
      })
    }
  }

  const hasActiveFilters = Boolean(
    filterFrom || filterTo || filterDoi || filterXe || filterGhiChu || filterLoai.length > 0 || filterWarnOnly,
  )

  const resetFilters = () => {
    setFilterFrom("")
    setFilterTo("")
    setFilterDoi("")
    setFilterXe("")
    setFilterGhiChu("")
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
      })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không tạo được PDF ngày.")
    }
  }

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
    await loadRecords(factoryId)
    await writeBackToDispatch(factoryId, form.ngay, supabase).catch(() => {})
  }

  const handleDelete = async (id: string) => {
    if (!factoryId) return
    const record = records.find((item) => item.id === id)
    await supabase.from("production_records").delete().eq("id", id)
    setDelConfirm(null)
    await loadRecords(factoryId)
    if (record) await writeBackToDispatch(factoryId, record.ngay, supabase).catch(() => {})
  }

  const handleDeleteSelectedRows = async () => {
    if (!factoryId || !detailGroup || selectedRowIds.length === 0) return
    setDeletingRows(true)
    try {
      const { error } = await supabase.from("production_records").delete().in("id", selectedRowIds)
      if (error) throw new Error(error.message)
      await loadRecords(factoryId)
      await writeBackToDispatch(factoryId, detailGroup.ngay, supabase)
      setSelectedRowIds([])
      setDetailDay(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể xóa các dòng đã chọn.")
    } finally {
      setDeletingRows(false)
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
      await Promise.all(affectedDates.map((ngay) => writeBackToDispatch(factoryId, ngay, supabase)))
      await loadRecords(factoryId)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể dọn các dòng sản lượng thừa.")
    } finally {
      setCleaningDuplicates(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-800">
            <BarChart3 size={26} className="text-emerald-600" />
            Sản lượng
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Giữ nguyên dữ liệu Sản lượng, đổi giao diện theo cách hiển thị của module Điều xe.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-blue-700"
          >
            <Upload size={15} />
            Import file
          </button>
          {isAdmin && (
            <button
              onClick={() => { setEditRecord(null); setFormInitialDate(null); setShowForm(true) }}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 font-bold text-white shadow-md transition-colors hover:bg-emerald-700"
            >
              <Plus size={16} />
              Thêm mới
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {(["list", "stats", "import"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
              tab === item ? "bg-emerald-600 text-white" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {item === "list" ? "Danh sách" : item === "stats" ? "Thống kê" : "Hướng dẫn Import"}
          </button>
        ))}
      </div>

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <CalendarDays size={15} />
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400" />
            <span className="text-slate-300">→</span>
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400" />
          </div>

          {(tab === "list" || tab === "stats") && (
            <>
              <select value={filterDoi} onChange={(e) => setFilterDoi(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400">
                <option value="">Tất cả đội</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((doi) => (
                  <option key={doi} value={doi}>Đội {doi}</option>
                ))}
              </select>

              {tab === "list" && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <Search size={14} className="text-slate-400" />
                  <input value={filterXe} onChange={(e) => setFilterXe(e.target.value)} placeholder="Tìm số xe..." className="w-32 text-sm outline-none" />
                </div>
              )}

              <FilterMultiSelect
                options={LATEX_FILTER_OPTIONS}
                selected={filterLoai}
                onChange={setFilterLoai}
                placeholder="Tất cả nguyên liệu"
                className="min-w-64"
              />

              <select value={filterGhiChu} onChange={(e) => setFilterGhiChu(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400">
                <option value="">Tất cả ghi chú đội</option>
                <option value={EMPTY_NOTE_FILTER}>Không có ghi chú</option>
                {requiredNotes.map((note) => <option key={note} value={note}>{note}</option>)}
              </select>

              {tab === "list" && (
                <button
                  onClick={() => setFilterWarnOnly((value) => !value)}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                    filterWarnOnly
                      ? "border border-amber-300 bg-amber-100 text-amber-700"
                      : "border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  Chỉ cảnh báo
                </button>
              )}
            </>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      {tab === "list" && (
        <>
          {loading ? (
            <div className="p-12 text-center text-slate-400">Đang tải...</div>
          ) : groupedDates.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <BarChart3 size={40} className="mx-auto mb-3 opacity-30" />
              <p>Không có dữ liệu sản lượng trong kỳ này</p>
            </div>
          ) : detailGroup ? (
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
                  {isAdmin && (
                    <>
                      <button onClick={() => openCreateForDate(detailGroup.ngay)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                        <Plus size={14} />
                        Thêm dòng
                      </button>
                      <button
                        onClick={() => selectedDetailRecords.length === 1 && openEditRecord(selectedDetailRecords[0])}
                        disabled={selectedDetailRecords.length !== 1}
                        className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        <Edit2 size={14} />
                        Sửa
                      </button>
                      <button
                        onClick={() => void handleDeleteSelectedRows()}
                        disabled={selectedDetailRecords.length === 0 || deletingRows}
                        className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        {deletingRows ? "Đang xóa..." : `Xóa ${selectedDetailRecords.length || ""}`.trim()}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        {isAdmin && (
                          <th className="px-4 py-3 text-left">
                            <input
                              type="checkbox"
                              checked={detailGroup.records.length > 0 && selectedDetailRecords.length === detailGroup.records.length}
                              onChange={() => toggleSelectAllRows(detailGroup.records)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-600"
                            />
                          </th>
                        )}
                        {["Xe", "Chuyến", "Đội", "Tài xế", "Nguyên liệu", "KL tươi", "KL khô", "Cảnh báo", "Ghi chú"].map((header) => (
                          <th key={header} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">{header}</th>
                        ))}
                        {isAdmin && <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Thao tác</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
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
                              : "hover:bg-slate-50"
                        return (
                          <tr key={record.id} className={`transition-colors ${rowClass}`}>
                            {isAdmin && (
                              <td className="px-4 py-3">
                                <input type="checkbox" checked={selectedRowIds.includes(record.id)} onChange={() => toggleRowSelection(record.id)} className="h-4 w-4 rounded border-slate-300 text-blue-600" />
                              </td>
                            )}
                            <td className="px-4 py-3 font-bold text-emerald-700">{record.so_xe || "—"}</td>
                            <td className="px-4 py-3"><span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{record.chuyen}</span></td>
                            <td className="px-4 py-3 font-semibold text-slate-700">Đội {record.doi}</td>
                            <td className="px-4 py-3 text-slate-700">{record.tai_xe || "—"}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {materials.length > 0 ? materials.map((part) => (
                                  <span key={part} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{part}</span>
                                )) : <span className="text-slate-400">—</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-semibold text-slate-700">{fmtNum(totals.tuoi, 0)} kg</td>
                            <td className="px-4 py-3 font-bold text-emerald-700">{fmtNum(totals.kho, 0)} kg</td>
                            <td className="px-4 py-3">
                              {(record.warn_codes as WarnCode[]).length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {(record.warn_codes as WarnCode[]).map((code) => <WarnBadge key={code} code={code} />)}
                                </div>
                              ) : <span className="text-slate-400">Không có</span>}
                            </td>
                            <td className="px-4 py-3 text-slate-500">{record.ghi_chu || "—"}</td>
                            {isAdmin && (
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  <button onClick={() => openEditRecord(record)} className="rounded-lg p-1.5 text-blue-500 hover:bg-blue-50" title="Sửa"><Edit2 size={14} /></button>
                                  <button onClick={() => setDelConfirm(record.id)} className="rounded-lg p-1.5 text-red-400 hover:bg-red-50" title="Xóa"><Trash2 size={14} /></button>
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      {["Ngày", "Đội", "Số xe", "Ghi chú", "Cảnh báo", "Tổng KL tươi", "Tổng KL khô", "Thao tác"].map((header) => (
                        <th key={header} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groupedDates.map(({ ngay, records: dayRecords, totalTuoi, totalKho }) => {
                      const dois = [...new Set(dayRecords.map((record) => record.doi))].sort((a, b) => a - b)
                      const vehicleCount = [...new Set(dayRecords.map((record) => record.so_xe))].length
                      const notes = [...new Set(dayRecords.map((record) => record.ghi_chu).filter(Boolean))]
                      const dayWarnCount = dayRecords.reduce((sum, record) => sum + record.warn_codes.length, 0)
                      return (
                        <tr key={ngay} className="cursor-pointer transition-colors hover:bg-slate-50">
                          <td className="px-4 py-3 font-bold text-slate-700" onClick={() => openDayDetail(ngay)}>{fmtDate(ngay)}</td>
                          <td className="px-4 py-3" onClick={() => openDayDetail(ngay)}>
                            <div className="flex flex-wrap gap-1">
                              {dois.map((doi) => <span key={doi} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">Đội {doi}</span>)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700" onClick={() => openDayDetail(ngay)}>{vehicleCount} xe / {dayRecords.length} dòng</td>
                          <td className="px-4 py-3 text-slate-500" onClick={() => openDayDetail(ngay)}>{notes.length > 0 ? notes.join(", ") : "—"}</td>
                          <td className="px-4 py-3" onClick={() => openDayDetail(ngay)}>
                            {dayWarnCount > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">{dayWarnCount} cảnh báo</span> : <span className="text-slate-400">Không có</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-700" onClick={() => openDayDetail(ngay)}>{fmtNum(totalTuoi, 0)} kg</td>
                          <td className="px-4 py-3 font-semibold text-emerald-700" onClick={() => openDayDetail(ngay)}>{fmtNum(totalKho, 0)} kg</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button onClick={(e) => { e.stopPropagation(); void handleExportDayPdf(ngay, dayRecords) }} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50" title="Xuất PDF ngày"><FileText size={14} /></button>
                              {isAdmin && (
                                <>
                                  <button onClick={(e) => { e.stopPropagation(); if (dayRecords.length === 1) openEditRecord(dayRecords[0]); else openDayDetail(ngay) }} className="rounded-lg p-1.5 text-blue-500 hover:bg-blue-50" title="Sửa"><Edit2 size={14} /></button>
                                  <button onClick={(e) => { e.stopPropagation(); if (dayRecords.length === 1) setDelConfirm(dayRecords[0].id); else openDayDetail(ngay) }} className="rounded-lg p-1.5 text-red-400 hover:bg-red-50" title="Xóa"><Trash2 size={14} /></button>
                                </>
                              )}
                              <button onClick={() => openDayDetail(ngay)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" title="Xem chi tiết"><ChevronRight size={16} /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "stats" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Tổng KL Tươi" value={`${fmtNum(totalTuoiAll, 0)} kg`} />
            <StatCard label="Tổng KL Khô" value={`${fmtNum(totalKhoAll, 0)} kg`} />
            <StatCard label="Số Bản Ghi" value={String(statsFiltered.length)} />
            <StatCard label="Cảnh Báo" value={String(warnCount)} sub={warnCount > 0 ? "Cần kiểm tra dữ liệu" : "Tất cả ổn"} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 font-bold text-slate-700">KL khô theo đội (kg)</h3>
            <div className="space-y-2">
              {Array.from(byDoi.entries()).sort((a, b) => a[0] - b[0]).map(([doi, kho]) => {
                const maxKho = Math.max(...Array.from(byDoi.values()), 1)
                const pct = Math.round((kho / maxKho) * 100)
                return (
                  <div key={doi} className="flex items-center gap-3">
                    <span className="w-12 text-right text-xs font-bold text-slate-500">Đội {doi}</span>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    {["Đội", "Số xe", "Chuyến", "Tài xế", "Tươi (kg)", "Khô (kg)"].map((header) => (
                      <th key={header} className="px-3 py-2 text-left font-bold text-slate-600">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from(byVehicle.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value], index) => {
                    const [, soXe, chuyen] = key.split(":")
                    return (
                      <tr key={key} className={`border-t border-slate-100 ${index % 2 === 0 ? "" : "bg-slate-50/50"}`}>
                        <td className="px-3 py-2 font-bold text-slate-700">{value.doi}</td>
                        <td className="px-3 py-2 font-bold text-slate-800">{soXe}</td>
                        <td className="px-3 py-2 text-slate-600">{chuyen}</td>
                        <td className="px-3 py-2 text-slate-600">{value.taiXe || "—"}</td>
                        <td className="px-3 py-2 text-slate-700">{fmtNum(value.tuoi, 0)}</td>
                        <td className="px-3 py-2 font-bold text-emerald-700">{fmtNum(value.kho, 0)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "import" && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Hướng dẫn import file sản lượng</h3>
          <p>Giữ nguyên cấu trúc 19 cột A-S, import lại sẽ upsert theo Ngày + Xe + Chuyến + Đội.</p>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <p className="mb-2 font-bold">Cột chủ đạo:</p>
              <ul className="space-y-1 text-slate-600">
                <li>A: Ngày</li>
                <li>B: Đội</li>
                <li>C: Số xe</li>
                <li>D-R: 5 nhóm nguyên liệu, mỗi nhóm gồm Tươi / DRC / Khô</li>
                <li>S: Ghi chú</li>
              </ul>
            </div>
            <div>
              <p className="mb-2 font-bold">Cảnh báo sau import:</p>
              <ul className="space-y-1">
                {(Object.entries(WARN_LABELS) as [WarnCode, string][]).map(([code, label]) => (
                  <li key={code} className="flex items-start gap-2">
                    <WarnBadge code={code} />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white shadow-md hover:bg-blue-700">
            <Upload size={16} />
            Bắt đầu import
          </button>
        </div>
      )}

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
