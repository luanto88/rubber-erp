"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { Truck, Plus, Eye, ChevronRight, X, Search, Calendar, Edit2, Trash2, Check } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type DxRow = {
  uid: string
  _date: string
  so_xe: string
  chuyen: number
  tai_xe: string
  diem_gn: string[]
  phien: string[]
  lo_thu_hoach: string
  xu_ly: string
  lo_trinh: string[]
  so_km: number
  kl_dct: string
  drc_dc: string
  kl_dck: string
  kl_dkt: string
  drc_dk: string
  kl_dkk: string
  kl_dt: string
  drc_d: string
  kl_dk: string
  ngan_ref: string[]
}

type DispatchEntry = {
  id: string
  factory_id: string
  ngay: string
  chung_nhan: string
  rows: DxRow[]
}

const PHIEN_OPTS = ["Phiên A","Phiên B","Phiên C","Phiên D"]
const XU_LY_OPTS = ["Xé","Cán"]

const emptyRow = (): DxRow => ({
  uid: `r_${Date.now()}`,
  _date: new Date().toISOString().slice(0,10),
  so_xe: "", chuyen: 1, tai_xe: "",
  diem_gn: [], phien: [], lo_thu_hoach: "",
  xu_ly: "Xé", lo_trinh: [],
  so_km: 0, kl_dct: "", drc_dc: "", kl_dck: "",
  kl_dkt: "", drc_dk: "", kl_dkk: "",
  kl_dt: "", drc_d: "65", kl_dk: "",
  ngan_ref: [],
})

// ─── Main component ───────────────────────────────────────────────────────────
export default function DispatchPage() {
  const [entries, setEntries]     = useState<DispatchEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [factoryId, setFactoryId] = useState<string|null>(null)
  const [search, setSearch]       = useState("")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo]   = useState("")

  // Views: list | detail | add | edit
  const [view, setView]           = useState<"list"|"detail"|"add"|"edit">("list")
  const [selected, setSelected]   = useState<DispatchEntry|null>(null)

  // Add/Edit form
  const [formNgay, setFormNgay]   = useState(new Date().toISOString().slice(0,10))
  const [formCN, setFormCN]       = useState("PEFC CS")
  const [formRows, setFormRows]   = useState<DxRow[]>([emptyRow()])
  const [editId, setEditId]       = useState<string|null>(null)
  const [saving, setSaving]       = useState(false)

  // Delete
  const [delConfirm, setDelConfirm] = useState<string|null>(null)

  // Toast
  const [toast, setToast]         = useState<string|null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    let q = supabase.from("dispatch_entries")
      .select("*")
      .eq("factory_id", fid)
      .order("ngay", { ascending: false })
    if (filterFrom) q = q.gte("ngay", filterFrom)
    if (filterTo)   q = q.lte("ngay", filterTo)
    const { data } = await q
    setEntries(data || [])
    setLoading(false)
  }, [filterFrom, filterTo])

  useEffect(() => {
    const fid = localStorage.getItem("erp_factory")
    if (!fid) return
    setFactoryId(fid)
    loadData(fid)
  }, [loadData])

  // ── Filtered ──────────────────────────────────────────────────────────────
  const filtered = entries.filter(e =>
    !search || e.ngay?.includes(search) ||
    e.rows?.some(r => r.so_xe?.toLowerCase().includes(search.toLowerCase()) ||
      r.tai_xe?.toLowerCase().includes(search.toLowerCase()))
  )

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    total: entries.length,
    totalXe: entries.reduce((s,e) => s + (e.rows?.length||0), 0),
    totalKg: entries.reduce((s,e) =>
      s + (e.rows||[]).reduce((ss,r) => ss + (parseFloat(r.kl_dck)||0), 0), 0),
  }

  // ── Open Edit ─────────────────────────────────────────────────────────────
  const openEdit = (entry: DispatchEntry) => {
    setEditId(entry.id)
    setFormNgay(entry.ngay?.includes("/") ? entry.ngay.split("/").reverse().join("-") : entry.ngay || new Date().toISOString().slice(0,10))
    setFormCN(entry.chung_nhan || "PEFC CS")
    setFormRows(entry.rows?.length ? entry.rows.map(r => ({ ...r })) : [emptyRow()])
    setView("edit")
  }

  // ── Save (add or edit) ────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!factoryId) return
    setSaving(true)
    const payload = {
      factory_id: factoryId,
      ngay: formNgay,
      chung_nhan: formCN,
      rows: formRows.map((r,i) => ({ ...r, uid: r.uid || `r_${i}_${Date.now()}`, _date: formNgay })),
    }
    if (editId) {
      await supabase.from("dispatch_entries").update(payload).eq("id", editId)
      showToast("Đã cập nhật bảng phân xe")
    } else {
      await supabase.from("dispatch_entries").insert(payload)
      showToast("Đã thêm bảng phân xe mới")
    }
    setSaving(false)
    setView("list")
    setEditId(null)
    setFormRows([emptyRow()])
    loadData(factoryId)
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!factoryId) return
    await supabase.from("dispatch_entries").delete().eq("id", id)
    setDelConfirm(null)
    showToast("Đã xóa bảng phân xe")
    loadData(factoryId)
  }

  // ── Update row field ──────────────────────────────────────────────────────
  const updateRow = (idx: number, field: keyof DxRow, val: unknown) => {
    setFormRows(prev => prev.map((r,i) => i===idx ? {...r, [field]: val} : r))
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  const ToastNotification = () => toast ? (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl shadow-lg animate-[fadeInUp_0.3s_ease-out]">
      <Check size={16}/> {toast}
    </div>
  ) : null

  // ── Render: LIST ──────────────────────────────────────────────────────────
  if (view === "list") return (
    <div>
      <ToastNotification/>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Điều xe</h1>
          <p className="text-sm text-slate-500 mt-0.5">Bảng phân xe thu mủ hàng ngày</p>
        </div>
        <button onClick={() => { setFormNgay(new Date().toISOString().slice(0,10)); setFormCN("PEFC CS"); setFormRows([emptyRow()]); setEditId(null); setView("add") }}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
          <Plus size={16}/> Thêm bảng
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Tổng bảng phân xe", value: stats.total },
          { label: "Tổng chuyến xe", value: stats.totalXe },
          { label: "Tổng KL khô (tấn)", value: (stats.totalKg/1000).toFixed(1)+"T" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
            <div className="text-2xl font-extrabold text-emerald-700">{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 flex-1 min-w-48">
          <Search size={15} className="text-slate-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Tìm ngày, xe, tài xế..."
            className="flex-1 text-sm outline-none"/>
        </div>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"/>
        <span className="text-slate-400 text-sm">→</span>
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"/>
        {(search||filterFrom||filterTo) &&
          <button onClick={() => { setSearch(""); setFilterFrom(""); setFilterTo("") }}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-500">
            <X size={14}/> Xóa lọc
          </button>}
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Truck size={40} className="mx-auto mb-3 opacity-30"/>
            <p>Không có bảng phân xe nào</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Ngày","Chứng nhận","Số xe","Tổng KL tươi (kg)","Tổng KL khô (kg)",""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(entry => {
                const totalKLT = (entry.rows||[]).reduce((s,r) => s+(parseFloat(r.kl_dct)||0),0)
                const totalKLK = (entry.rows||[]).reduce((s,r) => s+(parseFloat(r.kl_dck)||0),0)
                return (
                  <tr key={entry.id} className="hover:bg-slate-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-700"
                      onClick={() => { setSelected(entry); setView("detail") }}>
                      {entry.ngay ? new Date(entry.ngay.includes("/")?
                        entry.ngay.split("/").reverse().join("-") : entry.ngay
                      ).toLocaleDateString("vi-VN") : "—"}
                    </td>
                    <td className="px-4 py-3" onClick={() => { setSelected(entry); setView("detail") }}>
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-bold">
                        {entry.chung_nhan || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700"
                      onClick={() => { setSelected(entry); setView("detail") }}>
                      {entry.rows?.length || 0} xe
                    </td>
                    <td className="px-4 py-3 text-slate-600"
                      onClick={() => { setSelected(entry); setView("detail") }}>
                      {totalKLT.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-600"
                      onClick={() => { setSelected(entry); setView("detail") }}>
                      {totalKLK.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); openEdit(entry) }}
                          className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors" title="Sửa">
                          <Edit2 size={14}/>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setDelConfirm(entry.id) }}
                          className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors" title="Xóa">
                          <Trash2 size={14}/>
                        </button>
                        <button onClick={() => { setSelected(entry); setView("detail") }}
                          className="p-1.5 hover:bg-slate-100 text-slate-400 rounded-lg transition-colors" title="Xem">
                          <ChevronRight size={16}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirm */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-extrabold text-slate-800 mb-2">Xác nhận xóa?</h3>
            <p className="text-sm text-slate-500 mb-5">Bảng phân xe này sẽ bị xóa vĩnh viễn khỏi hệ thống.</p>
            <div className="flex gap-3">
              <button onClick={() => setDelConfirm(null)}
                className="flex-1 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={() => handleDelete(delConfirm)}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-md">Xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // ── Render: DETAIL ─────────────────────────────────────────────────────────
  if (view === "detail" && selected) return (
    <div>
      <ToastNotification/>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setView("list")}
          className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
          <X size={18}/>
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold text-slate-800">
            Bảng phân xe — {selected.ngay}
          </h1>
          <p className="text-sm text-slate-500">{selected.rows?.length} xe · {selected.chung_nhan}</p>
        </div>
        <button onClick={() => openEdit(selected)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl text-sm transition-colors">
          <Edit2 size={14}/> Sửa
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {["Xe","Chuyến","Tài xế","Điểm GN","Phiên","Xử lý","KM","KL tươi","DRC%","KL khô","KL dập","DRC dập","KL dập khô"].map(h => (
                <th key={h} className="px-3 py-3 text-left font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(selected.rows||[]).map((row, i) => (
              <tr key={row.uid||i} className="hover:bg-slate-50">
                <td className="px-3 py-2.5 font-bold text-emerald-700">{row.so_xe}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">{row.chuyen}</span>
                </td>
                <td className="px-3 py-2.5 text-slate-700">{row.tai_xe}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {(row.diem_gn||[]).map(d => (
                      <span key={d} className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">{d}</span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-slate-500">{(row.phien||[]).join(", ")}</td>
                <td className="px-3 py-2.5 text-slate-600">{row.xu_ly}</td>
                <td className="px-3 py-2.5 text-slate-600">{row.so_km}</td>
                <td className="px-3 py-2.5 font-semibold text-slate-700">{row.kl_dct}</td>
                <td className="px-3 py-2.5 text-slate-600">{row.drc_dc}%</td>
                <td className="px-3 py-2.5 font-semibold text-emerald-700">{row.kl_dck}</td>
                <td className="px-3 py-2.5 text-slate-600">{row.kl_dt}</td>
                <td className="px-3 py-2.5 text-slate-600">{row.drc_d}</td>
                <td className="px-3 py-2.5 text-slate-600">{row.kl_dk}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 border-t-2 border-slate-200">
            <tr>
              <td colSpan={7} className="px-3 py-2.5 font-bold text-slate-600">TỔNG</td>
              <td className="px-3 py-2.5 font-bold text-slate-700">
                {(selected.rows||[]).reduce((s,r)=>s+(parseFloat(r.kl_dct)||0),0).toLocaleString()}
              </td>
              <td/>
              <td className="px-3 py-2.5 font-bold text-emerald-700">
                {(selected.rows||[]).reduce((s,r)=>s+(parseFloat(r.kl_dck)||0),0).toLocaleString()}
              </td>
              <td colSpan={3}/>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )

  // ── Render: ADD / EDIT ────────────────────────────────────────────────────
  return (
    <div>
      <ToastNotification/>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => { setView("list"); setEditId(null) }}
          className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
          <X size={18}/>
        </button>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">
            {editId ? "Sửa bảng phân xe" : "Thêm bảng phân xe"}
          </h1>
        </div>
      </div>

      {/* Header form */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày *</label>
            <input type="date" value={formNgay} onChange={e => setFormNgay(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Chứng nhận</label>
            <select value={formCN} onChange={e => setFormCN(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
              {["PEFC CS","PEFC FM","ISO","Không"].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Rows */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-slate-700 text-sm">{formRows.length} xe</span>
          <button onClick={() => setFormRows(prev => [...prev, emptyRow()])}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition-colors">
            <Plus size={13}/> Thêm xe
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {formRows.map((row, idx) => (
            <div key={row.uid} className="p-4 grid grid-cols-6 gap-3 items-end">
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Số xe</label>
                <input value={row.so_xe} onChange={e => updateRow(idx,"so_xe",e.target.value)}
                  placeholder="5B" className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Tài xế</label>
                <input value={row.tai_xe} onChange={e => updateRow(idx,"tai_xe",e.target.value)}
                  placeholder="Tên tài xế" className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">KL tươi (kg)</label>
                <input value={row.kl_dct} onChange={e => updateRow(idx,"kl_dct",e.target.value)}
                  placeholder="0" className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">DRC (%)</label>
                <input value={row.drc_dc} onChange={e => updateRow(idx,"drc_dc",e.target.value)}
                  placeholder="49.5" className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">KL khô (kg)</label>
                <input value={row.kl_dck} onChange={e => updateRow(idx,"kl_dck",e.target.value)}
                  placeholder="0" className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Km</label>
                <div className="flex gap-1">
                  <input type="number" value={row.so_km} onChange={e => updateRow(idx,"so_km",+e.target.value)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-emerald-400"/>
                  <button onClick={() => setFormRows(prev => prev.filter((_,i) => i!==idx))}
                    className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                    <X size={14}/>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end gap-3">
        <button onClick={() => { setView("list"); setEditId(null) }}
          className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-50">
          {saving ? "Đang lưu..." : editId ? "Lưu thay đổi" : "Lưu bảng phân xe"}
        </button>
      </div>
    </div>
  )
}
