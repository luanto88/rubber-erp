"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { useScrollReveal } from "@/lib/useScrollReveal"
import {
  Warehouse, Plus, X, Search, Eye, Edit2,
  Tag, Layers, MapPin, ShieldCheck, Weight, BarChart2, Activity, Droplets
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type Ngan = {
  id: string
  factory_id: string
  ma_ngan: string
  ten_ngan: string
  loai_nl: string
  nguon_goc: string
  xu_ly: string
  chung_nhan: string
  ngay_bd: string
  ngay_kt: string
  trang_thai: string
  tong_tuoi: number
  tong_kho: number
  trips: string[]
  lo_nguon_goc: string
}

const LOAI_NL_OPTS    = ["Mủ đông chén","Mủ nước","Mủ tạp","Mủ skim"]
const NGUON_GOC_OPTS  = ["NT","M","GCA"]
const XU_LY_OPTS      = ["Xé","Cán","Hỗn hợp"]
const CHUNG_NHAN_OPTS = ["PEFC CS","PEFC FM","ISO","Không"]
const TRANG_THAI_OPTS = ["Đang sản xuất","Chờ sản xuất","Hoàn thành","Đóng"]

const emptyForm = () => ({
  ma_ngan: "", ten_ngan: "",
  loai_nl: "Mủ đông chén", nguon_goc: "NT",
  xu_ly: "Xé", chung_nhan: "PEFC CS",
  ngay_bd: new Date().toISOString().slice(0,10),
  ngay_kt: "",
  trang_thai: "Đang sản xuất",
  tong_tuoi: 0, tong_kho: 0,
  lo_nguon_goc: "",
})

// header gradient + icon color theo trạng thái
const headerStyle = (tt: string) => {
  if (tt === "Đang sản xuất") return { grad: "from-emerald-50 to-teal-50", icon: "text-emerald-600" }
  if (tt === "Hoàn thành")   return { grad: "from-blue-50 to-cyan-50",    icon: "text-blue-600" }
  if (tt === "Chờ sản xuất") return { grad: "from-amber-50 to-yellow-50", icon: "text-amber-500" }
  return { grad: "from-slate-50 to-gray-100", icon: "text-slate-400" }
}

const badgeClass = (tt: string) => {
  if (tt === "Đang sản xuất") return "bg-emerald-100 text-emerald-700"
  if (tt === "Hoàn thành")   return "bg-blue-100 text-blue-700"
  if (tt === "Chờ sản xuất") return "bg-amber-100 text-amber-700"
  return "bg-slate-100 text-slate-600"
}

export default function StoragePage() {
  useScrollReveal()

  const [ngans, setNgans]         = useState<Ngan[]>([])
  const [lotStats, setLotStats]   = useState<Record<string, number>>({})
  const [loading, setLoading]     = useState(true)
  const [factoryId, setFactoryId] = useState<string|null>(null)
  const [search, setSearch]       = useState("")
  const [filterTT, setFilterTT]   = useState("")
  const [filterNL, setFilterNL]   = useState("")

  const [modal, setModal]         = useState<"add"|"edit"|"view"|null>(null)
  const [form, setForm]           = useState(emptyForm())
  const [editId, setEditId]       = useState<string|null>(null)
  const [saving, setSaving]       = useState(false)
  const [delConfirm, setDelConfirm] = useState<string|null>(null)
  const [viewNgan, setViewNgan]   = useState<Ngan|null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    let q = supabase.from("ngans").select("*")
      .eq("factory_id", fid)
      .order("ten_ngan", { ascending: true })
    if (filterTT) q = q.eq("trang_thai", filterTT)
    if (filterNL) q = q.eq("loai_nl", filterNL)
    const [{ data }, { data: lotsData }] = await Promise.all([
      q,
      supabase.from("lots").select("ngan_id,tong_kg").eq("factory_id", fid).not("ngan_id","is",null)
    ])
    setNgans(data || [])
    // group tong_kg theo ngan_id
    const ls: Record<string, number> = {}
    for (const l of lotsData || []) {
      if (l.ngan_id) ls[l.ngan_id] = (ls[l.ngan_id] || 0) + (l.tong_kg || 0)
    }
    setLotStats(ls)
    setLoading(false)
  }, [filterTT, filterNL])

  useEffect(() => {
    const fid = localStorage.getItem("erp_factory")
    if (!fid) return
    setFactoryId(fid)
    loadData(fid)
  }, [loadData])

  const filtered = ngans.filter(n =>
    !search ||
    n.ten_ngan?.toLowerCase().includes(search.toLowerCase()) ||
    n.ma_ngan?.toLowerCase().includes(search.toLowerCase())
  )

  // ── Stats ─────────────────────────────────────────────────────────────────
  const statsCards = [
    { label: "Tổng ngăn",        value: ngans.length.toString(),                        color: "text-slate-700",  icon: <Warehouse size={20} className="mx-auto mb-1 text-slate-500 opacity-70"/> },
    { label: "Đang sản xuất",    value: ngans.filter(n=>n.trang_thai==="Đang sản xuất").length.toString(), color: "text-emerald-600", icon: <Activity size={20} className="mx-auto mb-1 text-emerald-500 opacity-70"/> },
    { label: "Tổng KL tươi (kg)",value: ngans.reduce((s,n)=>s+(n.tong_tuoi||0),0).toLocaleString(), color: "text-blue-600",    icon: <Droplets size={20} className="mx-auto mb-1 text-blue-500 opacity-70"/> },
    { label: "Tổng KL khô (kg)", value: ngans.reduce((s,n)=>s+(n.tong_kho||0),0).toLocaleString(),  color: "text-purple-600", icon: <Weight size={20} className="mx-auto mb-1 text-purple-500 opacity-70"/> },
  ]

  const curingDays = (ngay_bd: string) => {
    if (!ngay_bd) return null
    return Math.floor((Date.now() - new Date(ngay_bd).getTime()) / 86400000)
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!factoryId) return
    setSaving(true)
    const payload = { ...form, factory_id: factoryId, ngay_kt: form.ngay_kt || null }
    if (editId) {
      await supabase.from("ngans").update(payload).eq("id", editId)
    } else {
      await supabase.from("ngans").insert({ ...payload, trips: [] })
    }
    setSaving(false)
    setModal(null)
    loadData(factoryId)
  }

  const handleDelete = async (id: string) => {
    if (!factoryId) return
    await supabase.from("ngans").delete().eq("id", id)
    setDelConfirm(null)
    loadData(factoryId)
  }

  const openEdit = (n: Ngan) => {
    setForm({
      ma_ngan: n.ma_ngan||"", ten_ngan: n.ten_ngan||"",
      loai_nl: n.loai_nl||"Mủ đông chén", nguon_goc: n.nguon_goc||"NT",
      xu_ly: n.xu_ly||"Xé", chung_nhan: n.chung_nhan||"PEFC CS",
      ngay_bd: n.ngay_bd?.slice(0,10)||"",
      ngay_kt: n.ngay_kt?.slice(0,10)||"",
      trang_thai: n.trang_thai||"Đang sản xuất",
      tong_tuoi: n.tong_tuoi||0, tong_kho: n.tong_kho||0,
      lo_nguon_goc: n.lo_nguon_goc||"",
    })
    setEditId(n.id)
    setModal("edit")
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Ngăn lưu</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý ngăn lưu trữ mủ cao su</p>
        </div>
        <button onClick={() => { setForm(emptyForm()); setEditId(null); setModal("add") }}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all btn-press">
          <Plus size={16}/> Thêm ngăn
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6 scroll-reveal">
        {statsCards.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 shadow-md p-4 text-center">
            {s.icon}
            <div className={`text-2xl font-extrabold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 flex-1 min-w-48">
          <Search size={15} className="text-slate-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Tìm tên ngăn, mã ngăn..."
            className="flex-1 text-sm outline-none"/>
        </div>
        <select value={filterTT} onChange={e => setFilterTT(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400">
          <option value="">Tất cả trạng thái</option>
          {TRANG_THAI_OPTS.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={filterNL} onChange={e => setFilterNL(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400">
          <option value="">Tất cả loại NL</option>
          {LOAI_NL_OPTS.map(t => <option key={t}>{t}</option>)}
        </select>
        {(search||filterTT||filterNL) &&
          <button onClick={() => { setSearch(""); setFilterTT(""); setFilterNL("") }}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-500">
            <X size={14}/> Xóa lọc
          </button>}
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="p-12 text-center text-slate-400">Đang tải...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <Warehouse size={40} className="mx-auto mb-3 opacity-30"/>
          <p>Không có ngăn lưu nào</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 scroll-reveal">
          {filtered.map(n => {
            const days   = curingDays(n.ngay_bd)
            const minDays = 21
            const pct    = days !== null ? Math.min((days / minDays) * 100, 100) : 0
            const ready  = days !== null && days >= minDays
            const hs     = headerStyle(n.trang_thai)
            const tpKg   = lotStats[n.id] || 0
            const tpPct  = n.tong_kho > 0 ? (tpKg / n.tong_kho) * 100 : 0

            return (
              <div key={n.id} className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden hover-lift">

                {/* Card header — gradient */}
                <div className={`bg-gradient-to-r ${hs.grad} px-4 py-3 border-b border-slate-200 flex items-center justify-between`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Warehouse size={16} className={`${hs.icon} shrink-0`}/>
                    <span className="font-extrabold text-slate-800 text-base truncate">{n.ten_ngan}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold shrink-0 ${badgeClass(n.trang_thai)}`}>
                      {n.trang_thai}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button onClick={() => { setViewNgan(n); setModal("view") }}
                      className="p-1.5 hover:bg-white/60 rounded-lg text-slate-500 transition-colors">
                      <Eye size={14}/>
                    </button>
                    <button onClick={() => openEdit(n)}
                      className="p-1.5 hover:bg-white/60 rounded-lg text-blue-500 transition-colors">
                      <Edit2 size={14}/>
                    </button>
                    <button onClick={() => setDelConfirm(n.id)}
                      className="p-1.5 hover:bg-white/60 rounded-lg text-red-400 transition-colors">
                      <X size={14}/>
                    </button>
                  </div>
                </div>

                {/* Card body — icon + label + value + border-dashed */}
                <div className="p-4 space-y-0">

                  {/* Mã ngăn — đầy đủ */}
                  <div className="flex items-start gap-2 py-2 border-b border-dashed border-slate-200">
                    <Tag size={14} className="text-slate-400 shrink-0 mt-0.5"/>
                    <span className="text-xs text-slate-500 w-24 shrink-0">Mã ngăn</span>
                    <span className="text-xs font-semibold text-slate-700 break-all leading-relaxed">{n.ma_ngan || "—"}</span>
                  </div>

                  {/* Loại NL */}
                  <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                    <Layers size={14} className="text-slate-400 shrink-0"/>
                    <span className="text-xs text-slate-500 w-24 shrink-0">Loại NL</span>
                    <span className="text-sm font-semibold text-slate-800">{n.loai_nl}</span>
                  </div>

                  {/* Nguồn gốc · Xử lý */}
                  <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                    <MapPin size={14} className="text-slate-400 shrink-0"/>
                    <span className="text-xs text-slate-500 w-24 shrink-0">Nguồn · Xử lý</span>
                    <span className="text-sm font-semibold text-slate-800">{n.nguon_goc} · {n.xu_ly}</span>
                  </div>

                  {/* Chứng nhận */}
                  <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                    <ShieldCheck size={14} className="text-slate-400 shrink-0"/>
                    <span className="text-xs text-slate-500 w-24 shrink-0">Chứng nhận</span>
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">{n.chung_nhan}</span>
                  </div>

                  {/* KL tươi / khô */}
                  <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                    <Weight size={14} className="text-slate-400 shrink-0"/>
                    <span className="text-xs text-slate-500 w-24 shrink-0">KL tươi / khô</span>
                    <span className="text-sm font-semibold text-slate-800">
                      {(n.tong_tuoi||0).toLocaleString()} / <span className="text-emerald-700">{(n.tong_kho||0).toLocaleString()}</span> kg
                    </span>
                  </div>

                  {/* Tỷ lệ TP/QK — trường mới */}
                  <div className="flex items-start gap-2 py-2 border-b border-dashed border-slate-200">
                    <BarChart2 size={14} className="text-slate-400 shrink-0 mt-1"/>
                    <span className="text-xs text-slate-500 w-24 shrink-0">TP / QK ngăn</span>
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-slate-800">
                          {n.tong_kho > 0 ? `${tpPct.toFixed(1)}%` : "—"}
                        </span>
                        {n.tong_kho > 0 && (
                          <span className="text-xs text-slate-400">
                            ({tpKg.toLocaleString()} / {(n.tong_kho||0).toLocaleString()} kg)
                          </span>
                        )}
                      </div>
                      {n.tong_kho > 0 && (
                        <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-1 bg-blue-400 rounded-full transition-all"
                            style={{ width: `${Math.min(tpPct, 100)}%` }}/>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Thời gian ủ */}
                  {days !== null && (
                    <div className="py-2">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-slate-500">Thời gian ủ</span>
                        <span className={`font-bold ${ready ? "text-emerald-600" : "text-amber-600"}`}>
                          {days} ngày {ready ? "✓ Đủ 21 ngày" : `(còn ${minDays - days} ngày)`}
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${ready ? "bg-emerald-500" : "bg-amber-400"}`}
                          style={{ width: `${pct}%` }}/>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {(modal === "add" || modal === "edit") && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">
                {modal === "add" ? "Thêm ngăn lưu" : "Sửa ngăn lưu"}
              </h2>
              <button onClick={() => setModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên ngăn *</label>
                  <input value={form.ten_ngan} onChange={e => setForm(p=>({...p,ten_ngan:e.target.value}))}
                    placeholder="N11" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã ngăn</label>
                  <input value={form.ma_ngan} onChange={e => setForm(p=>({...p,ma_ngan:e.target.value}))}
                    placeholder="N11-NT-ĐC-X-..." className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại nguyên liệu</label>
                  <select value={form.loai_nl} onChange={e => setForm(p=>({...p,loai_nl:e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {LOAI_NL_OPTS.map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Nguồn gốc</label>
                  <select value={form.nguon_goc} onChange={e => setForm(p=>({...p,nguon_goc:e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {NGUON_GOC_OPTS.map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Xử lý</label>
                  <select value={form.xu_ly} onChange={e => setForm(p=>({...p,xu_ly:e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {XU_LY_OPTS.map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Chứng nhận</label>
                  <select value={form.chung_nhan} onChange={e => setForm(p=>({...p,chung_nhan:e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {CHUNG_NHAN_OPTS.map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày bắt đầu</label>
                  <input type="date" value={form.ngay_bd} onChange={e => setForm(p=>({...p,ngay_bd:e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày kết thúc</label>
                  <input type="date" value={form.ngay_kt} onChange={e => setForm(p=>({...p,ngay_kt:e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">KL tươi (kg)</label>
                  <input type="number" value={form.tong_tuoi} onChange={e => setForm(p=>({...p,tong_tuoi:+e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">KL khô (kg)</label>
                  <input type="number" value={form.tong_kho} onChange={e => setForm(p=>({...p,tong_kho:+e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Trạng thái</label>
                <select value={form.trang_thai} onChange={e => setForm(p=>({...p,trang_thai:e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  {TRANG_THAI_OPTS.map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setModal(null)}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-50">
                {saving ? "Đang lưu..." : modal === "add" ? "Thêm ngăn" : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View detail modal */}
      {modal === "view" && viewNgan && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className={`bg-gradient-to-r ${headerStyle(viewNgan.trang_thai).grad} border-b border-slate-200 px-6 py-4 flex items-center justify-between`}>
              <div className="flex items-center gap-2">
                <Warehouse size={18} className={headerStyle(viewNgan.trang_thai).icon}/>
                <h2 className="text-lg font-extrabold text-slate-800">{viewNgan.ten_ngan}</h2>
              </div>
              <button onClick={() => setModal(null)} className="p-2 hover:bg-white/60 rounded-xl"><X size={18}/></button>
            </div>
            <div className="p-6 space-y-0 text-sm">
              {[
                ["Mã ngăn",   viewNgan.ma_ngan],
                ["Loại NL",   viewNgan.loai_nl],
                ["Nguồn gốc", viewNgan.nguon_goc],
                ["Xử lý",     viewNgan.xu_ly],
                ["Chứng nhận",viewNgan.chung_nhan],
                ["Ngày BD",   viewNgan.ngay_bd ? new Date(viewNgan.ngay_bd).toLocaleDateString("vi-VN") : "—"],
                ["Ngày KT",   viewNgan.ngay_kt ? new Date(viewNgan.ngay_kt).toLocaleDateString("vi-VN") : "—"],
                ["KL tươi",   (viewNgan.tong_tuoi||0).toLocaleString()+" kg"],
                ["KL khô",    (viewNgan.tong_kho||0).toLocaleString()+" kg"],
                ["TP / QK",   viewNgan.tong_kho > 0 ? `${((lotStats[viewNgan.id]||0)/viewNgan.tong_kho*100).toFixed(1)}% (${(lotStats[viewNgan.id]||0).toLocaleString()} kg)` : "—"],
                ["Số chuyến", (viewNgan.trips||[]).length+" chuyến"],
                ["Trạng thái",viewNgan.trang_thai],
              ].map(([k,v]) => (
                <div key={k} className="flex justify-between py-2 border-b border-dashed border-slate-200 last:border-0">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-semibold text-slate-700 text-right max-w-[60%]">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-extrabold text-slate-800 mb-2">Xác nhận xóa?</h3>
            <p className="text-sm text-slate-500 mb-5">Ngăn lưu này sẽ bị xóa vĩnh viễn.</p>
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
}
