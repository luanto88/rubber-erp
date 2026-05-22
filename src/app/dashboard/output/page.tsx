"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"
import {
  BarChart3, Plus, Upload, Search, Trash2, Edit2, AlertTriangle, X,
  ChevronDown, ChevronUp, Filter,
} from "lucide-react"
import type { ProductionRecord, OutputFormState } from "./_components/output-types"
import {
  totalTuoi, totalKho, WARN_LABELS, WARN_SEVERITY, parseVehicleCode,
  writeBackToDispatch,
  type WarnCode,
} from "./_components/output-types"
import { OutputImport, matchRows } from "./_components/output-import"
import { OutputForm } from "./_components/output-form"

// ────────────────────────────────────────────────────────────────
// Types for dispatch data used in matching
// ────────────────────────────────────────────────────────────────
interface DispatchEntry {
  id: string
  ngay: string
  rows: Array<{ uid: string; so_xe: string; chuyen: number; tai_xe: string; diem_gn: string[] }>
}
interface DeliveryPoint { ma_lo: string; doi: number }
interface Vehicle { id: string; code: string; name: string }

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

// ────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────
export default function OutputPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Data
  const [records, setRecords] = useState<ProductionRecord[]>([])
  const [dispatches, setDispatches] = useState<DispatchEntry[]>([])
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPoint[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  // UI state
  const [tab, setTab] = useState<"stats" | "list" | "import">("list")
  const [showImport, setShowImport] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editRecord, setEditRecord] = useState<ProductionRecord | null>(null)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Filters
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [filterTo, setFilterTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [filterDoi, setFilterDoi] = useState("")
  const [filterXe, setFilterXe] = useState("")
  const [filterWarnOnly, setFilterWarnOnly] = useState(false)

  // Sort
  const [sortCol, setSortCol] = useState<"ngay" | "doi" | "so_xe">("ngay")
  const [sortAsc, setSortAsc] = useState(false)

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
    const [{ data: dp }, { data: ve }] = await Promise.all([
      supabase.from("dispatch_delivery_points").select("ma_lo, doi").eq("factory_id", fid).eq("is_active", true),
      supabase.from("dispatch_vehicles").select("id, code, name").eq("factory_id", fid).eq("is_active", true).order("sort_order"),
    ])
    setDeliveryPoints((dp as DeliveryPoint[]) || [])
    setVehicles((ve as Vehicle[]) || [])
  }, [])

  const loadDispatches = useCallback(async (fid: string) => {
    // load dispatch entries for the filter period (for matching)
    const { data } = await supabase
      .from("dispatch_entries")
      .select("id, ngay, rows")
      .eq("factory_id", fid)
      .gte("ngay", filterFrom)
      .lte("ngay", filterTo)
    setDispatches((data as DispatchEntry[]) || [])
  }, [filterFrom, filterTo])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
      await loadSupportData(fid)
    }
    void bootstrap()
  }, [loadSupportData])

  useEffect(() => {
    if (factoryId) {
      void loadRecords(factoryId)
      void loadDispatches(factoryId)
    }
  }, [factoryId, loadRecords, loadDispatches])

  // ── Filtered + sorted records ────────────────────────────────
  const filtered = records
    .filter(r => {
      if (filterDoi && r.doi !== parseInt(filterDoi)) return false
      if (filterXe && !r.so_xe.toUpperCase().includes(filterXe.toUpperCase())) return false
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

  // ── Stats aggregation ─────────────────────────────────────────
  const totalT = records.reduce((s, r) => s + totalTuoi(r), 0)
  const totalK = records.reduce((s, r) => s + totalKho(r), 0)
  const warnCount = records.filter(r => r.warn_codes.length > 0).length

  // KL khô theo đội
  const byDoi = new Map<number, number>()
  for (const r of records) {
    const kho = totalKho(r)
    byDoi.set(r.doi, (byDoi.get(r.doi) ?? 0) + kho)
  }

  // Thống kê pivot xe + tài xế
  const byXe = new Map<string, { tai_xe: string; chuyen_count: number; tuoi: number; kho: number }>()
  for (const r of records) {
    const key = `${r.so_xe}:${r.chuyen}`
    const existing = byXe.get(key)
    if (existing) {
      existing.tuoi += totalTuoi(r)
      existing.kho  += totalKho(r)
    } else {
      byXe.set(key, { tai_xe: r.tai_xe ?? "", chuyen_count: r.chuyen, tuoi: totalTuoi(r), kho: totalKho(r) })
    }
  }

  // ── Handlers ─────────────────────────────────────────────────
  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  const handleSave = async (form: OutputFormState) => {
    if (!factoryId) return
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
    void writeBackToDispatch(factoryId, form.ngay, supabase)
  }

  const handleDelete = async (id: string) => {
    if (!factoryId) return
    const rec = records.find(r => r.id === id)
    await supabase.from("production_records").delete().eq("id", id)
    setDelConfirm(null)
    void loadRecords(factoryId)
    if (rec) void writeBackToDispatch(factoryId, rec.ngay, supabase)
  }

  const SortIcon = ({ col }: { col: typeof sortCol }) =>
    sortCol === col ? (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null

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
          <button
            onClick={() => { setEditRecord(null); setShowForm(true) }}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all"
          >
            <Plus size={16} />Thêm mới
          </button>
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
            <button
              onClick={() => setFilterWarnOnly(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${filterWarnOnly ? "bg-amber-100 text-amber-700 border border-amber-300" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
            >
              <Filter size={12} />Chỉ cảnh báo
            </button>
          </>
        )}
        <span className="ml-auto text-xs text-slate-400">{records.length} bản ghi trong kỳ</span>
      </div>

      {/* ── Tab: Danh sách ── */}
      {tab === "list" && (
        <>
          {loading ? (
            <div className="p-12 text-center text-slate-400">Đang tải...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <BarChart3 size={40} className="mx-auto mb-3 opacity-30" />
              <p>Không có dữ liệu sản lượng trong kỳ này</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th onClick={() => toggleSort("ngay")} className="px-3 py-3 text-left font-bold text-slate-600 cursor-pointer hover:text-emerald-700 select-none">
                        <span className="flex items-center gap-1">Ngày <SortIcon col="ngay" /></span>
                      </th>
                      <th onClick={() => toggleSort("doi")} className="px-3 py-3 text-center font-bold text-slate-600 cursor-pointer hover:text-emerald-700 select-none">
                        <span className="flex items-center gap-1 justify-center">Đội <SortIcon col="doi" /></span>
                      </th>
                      <th onClick={() => toggleSort("so_xe")} className="px-3 py-3 text-left font-bold text-slate-600 cursor-pointer hover:text-emerald-700 select-none">
                        <span className="flex items-center gap-1">Số xe <SortIcon col="so_xe" /></span>
                      </th>
                      <th className="px-3 py-3 text-center font-bold text-slate-600">Chuyến</th>
                      <th className="px-3 py-3 text-left font-bold text-slate-600">Tài xế</th>
                      <th className="px-3 py-3 text-right font-bold text-slate-600">Tươi (kg)</th>
                      <th className="px-3 py-3 text-right font-bold text-slate-600">Khô (kg)</th>
                      <th className="px-3 py-3 text-left font-bold text-slate-600">Loại mủ</th>
                      <th className="px-3 py-3 text-left font-bold text-slate-600">Cảnh báo</th>
                      <th className="px-3 py-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      const hasRed  = r.warn_codes.some(c => WARN_SEVERITY[c as WarnCode] === "red")
                      const hasAmb  = !hasRed && r.warn_codes.some(c => WARN_SEVERITY[c as WarnCode] === "amber")
                      const rowCls  = hasRed ? "bg-red-50" : hasAmb ? "bg-amber-50/40" : i % 2 === 0 ? "" : "bg-slate-50/50"
                      const tTuoi   = totalTuoi(r)
                      const tKho    = totalKho(r)
                      // Loại mủ summary
                      const latexParts: string[] = []
                      if (r.mn_tuoi > 0) latexParts.push(`Nước ${fmtNum(r.mn_tuoi)}`)
                      if (r.ct_tuoi > 0) latexParts.push(`Chén ${fmtNum(r.ct_tuoi)}`)
                      if (r.dct_tuoi > 0) latexParts.push(`ĐChén ${fmtNum(r.dct_tuoi)}`)
                      if (r.dkt_tuoi > 0) latexParts.push(`ĐKhối ${fmtNum(r.dkt_tuoi)}`)
                      if (r.dt_tuoi > 0) latexParts.push(`Dây ${fmtNum(r.dt_tuoi)}`)

                      return (
                        <tr key={r.id} className={`border-t border-slate-100 transition-colors duration-150 hover:bg-slate-50 ${rowCls}`}>
                          <td className="px-3 py-2 text-slate-700">{fmtDate(r.ngay)}</td>
                          <td className="px-3 py-2 text-center font-bold text-slate-700">{r.doi}</td>
                          <td className="px-3 py-2 font-mono font-bold text-slate-800">{r.so_xe}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{r.chuyen}</td>
                          <td className="px-3 py-2 text-slate-600">{r.tai_xe || <span className="text-slate-300">—</span>}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{fmtNum(tTuoi)}</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtNum(tKho)}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{latexParts.join(" · ") || "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-0.5">
                              {(r.warn_codes as WarnCode[]).map(c => <WarnBadge key={c} code={c} />)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setEditRecord(r); setShowForm(true) }}
                                className="p-1 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-700">
                                <Edit2 size={13} />
                              </button>
                              <button onClick={() => setDelConfirm(r.id)}
                                className="p-1 hover:bg-red-100 rounded-lg text-slate-400 hover:text-red-600">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-xs font-bold text-slate-500">
                        Tổng {filtered.length} dòng đã lọc
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-slate-700">
                        {fmtNum(filtered.reduce((s, r) => s + totalTuoi(r), 0))}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-700">
                        {fmtNum(filtered.reduce((s, r) => s + totalKho(r), 0))}
                      </td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Tab: Thống kê ── */}
      {tab === "stats" && (
        <div className="space-y-5">
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Tổng KL tươi" value={`${fmtNum(totalT, 0)} kg`} color="blue" />
            <StatCard label="Tổng KL khô" value={`${fmtNum(totalK, 0)} kg`} color="emerald" />
            <StatCard label="Số bản ghi" value={String(records.length)} color="blue" />
            <StatCard label="Cảnh báo" value={String(warnCount)} sub={warnCount > 0 ? "Cần kiểm tra" : "Tất cả OK"} color={warnCount > 0 ? "amber" : "emerald"} />
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
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Số xe</th>
                    <th className="px-3 py-2 text-center font-bold text-slate-600">Chuyến</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Tài xế</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600">Tươi (kg)</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600">Khô (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(byXe.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, v], i) => {
                      const [xe, ch] = key.split(":")
                      return (
                        <tr key={key} className={`border-t border-slate-100 ${i % 2 === 0 ? "" : "bg-slate-50/50"}`}>
                          <td className="px-3 py-2 font-mono font-bold text-slate-800">{xe}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{ch}</td>
                          <td className="px-3 py-2 text-slate-600">{v.tai_xe || "—"}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{fmtNum(v.tuoi)}</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtNum(v.kho)}</td>
                        </tr>
                      )
                    })}
                  {byXe.size === 0 && (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Không có dữ liệu</td></tr>
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
              <p className="font-bold mb-2">Cấu trúc file (18 cột A–R):</p>
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
          vehicles={vehicles}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditRecord(null) }}
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
