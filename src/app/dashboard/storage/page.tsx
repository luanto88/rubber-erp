"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { Warehouse, Plus, X, Search, Eye, Edit2 } from "lucide-react"

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

const LOAI_NL_OPTS  = ["Mủ đông chén","Mủ nước","Mủ tạp","Mủ skim"]
const NGUON_GOC_OPTS = ["NT","M","GCA"]
const XU_LY_OPTS    = ["Xé","Cán","Hỗn hợp"]
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

export default function StoragePage() {
  const [ngans, setNgans]         = useState<Ngan[]>([])
  const [loading, setLoading]     = useState(true)
  const [factoryId, setFactoryId] = useState<string|null>(null)
  const [search, setSearch]       = useState("")
  const [filterTT, setFilterTT]   = useState("")
  const [filterNL, setFilterNL]   = useState("")

  // Modal
  const [modal, setModal]   = useState<"add"|"edit"|"view"|null>(null)
  const [form, setForm]     = useState(emptyForm())
  const [editId, setEditId] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)
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
    const { data } = await q
    setNgans(data || [])
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
  const stats = {
    total: ngans.length,
    dangSX: ngans.filter(n => n.trang_thai === "Đang sản xuất").length,
    tongTuoi: ngans.reduce((s,n) => s+(n.tong_tuoi||0), 0),
    tongKho: ngans.reduce((s,n) => s+(n.tong_kho||0), 0),
  }

  // ── Curing days ───────────────────────────────────────────────────────────
  const curingDays = (ngay_bd: string) => {
    if (!ngay_bd) return null
    const diff = Math.floor((Date.now() - new Date(ngay_bd).getTime()) / 86400000)
    return diff
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

  // ── Delete ────────────────────────────────────────────────────────────────
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
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
          <Plus size={16}/> Thêm ngăn
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Tổng ngăn", value: stats.total, color: "text-slate-700" },
          { label: "Đang sản xuất", value: stats.dangSX, color: "text-emerald-600" },
          { label: "Tổng KL tươi (kg)", value: stats.tongTuoi.toLocaleString(), color: "text-blue-600" },
          { label: "Tổng KL khô (kg)", value: stats.tongKho.toLocaleString(), color: "text-purple-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
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

      {/* Grid cards */}
      {loading ? (
        <div className="p-12 text-center text-slate-400">Đang tải...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <Warehouse size={40} className="mx-auto mb-3 opacity-30"/>
          <p>Không có ngăn lưu nào</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filtered.map(n => {
            const days = curingDays(n.ngay_bd)
            const minDays = 21
            const pct = days !== null ? Math.min((days/minDays)*100, 100) : 0
            const ready = days !== null && days >= minDays
            return (
              <div key={n.id} className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all overflow-hidden">
                {/* Card header */}
                <div className={`px-4 py-3 flex items-center justify-between ${
                  n.trang_thai === "Đang sản xuất" ? "bg-emerald-50 border-b border-emerald-100" :
                  n.trang_thai === "Hoàn thành" ? "bg-blue-50 border-b border-blue-100" :
                  "bg-slate-50 border-b border-slate-100"}`}>
                  <div>
                    <span className="font-extrabold text-slate-800 text-base">{n.ten_ngan}</span>
                    <span className="ml-2 text-xs text-slate-500">{n.ma_ngan?.split("-")[0]}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setViewNgan(n); setModal("view") }}
                      className="p-1.5 hover:bg-white rounded-lg text-slate-500 transition-colors">
                      <Eye size={14}/>
                    </button>
                    <button onClick={() => openEdit(n)}
                      className="p-1.5 hover:bg-white rounded-lg text-blue-500 transition-colors">
                      <Edit2 size={14}/>
                    </button>
                    <button onClick={() => setDelConfirm(n.id)}
                      className="p-1.5 hover:bg-white rounded-lg text-red-400 transition-colors">
                      <X size={14}/>
                    </button>
                  </div>
                </div>

                {/* Card body */}
                <div className="p-4 space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Loại NL</span>
                    <span className="font-semibold text-slate-700">{n.loai_nl}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Nguồn gốc</span>
                    <span className="font-semibold text-slate-700">{n.nguon_goc} · {n.xu_ly}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Chứng nhận</span>
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold">{n.chung_nhan}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">KL tươi / khô</span>
                    <span className="font-semibold text-slate-700">
                      {(n.tong_tuoi||0).toLocaleString()} / {(n.tong_kho||0).toLocaleString()} kg
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Ngày bắt đầu</span>
                    <span className="font-semibold text-slate-700">
                      {n.ngay_bd ? new Date(n.ngay_bd).toLocaleDateString("vi-VN") : "—"}
                    </span>
                  </div>

                  {/* Curing progress */}
                  {days !== null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-500">Thời gian ủ</span>
                        <span className={`font-bold ${ready ? "text-emerald-600" : "text-amber-600"}`}>
                          {days} ngày {ready ? "✓ Đủ 21 ngày" : `(còn ${minDays-days} ngày)`}
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${ready ? "bg-emerald-500" : "bg-amber-400"}`}
                          style={{ width: `${pct}%` }}/>
                      </div>
                    </div>
                  )}

                  {/* Status badge */}
                  <div className="pt-1">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                      n.trang_thai === "Đang sản xuất" ? "bg-emerald-100 text-emerald-700" :
                      n.trang_thai === "Hoàn thành"    ? "bg-blue-100 text-blue-700" :
                      n.trang_thai === "Chờ sản xuất"  ? "bg-amber-100 text-amber-700" :
                      "bg-slate-100 text-slate-600"}`}>
                      {n.trang_thai}
                    </span>
                  </div>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-800">{viewNgan.ten_ngan}</h2>
              <button onClick={() => setModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
            </div>
            <div className="p-6 space-y-3 text-sm">
              {[
                ["Mã ngăn", viewNgan.ma_ngan],
                ["Loại NL", viewNgan.loai_nl],
                ["Nguồn gốc", viewNgan.nguon_goc],
                ["Xử lý", viewNgan.xu_ly],
                ["Chứng nhận", viewNgan.chung_nhan],
                ["Ngày BD", viewNgan.ngay_bd ? new Date(viewNgan.ngay_bd).toLocaleDateString("vi-VN") : "—"],
                ["Ngày KT", viewNgan.ngay_kt ? new Date(viewNgan.ngay_kt).toLocaleDateString("vi-VN") : "—"],
                ["KL tươi", (viewNgan.tong_tuoi||0).toLocaleString()+" kg"],
                ["KL khô",  (viewNgan.tong_kho||0).toLocaleString()+" kg"],
                ["Số chuyến", (viewNgan.trips||[]).length+" chuyến"],
                ["Trạng thái", viewNgan.trang_thai],
              ].map(([k,v]) => (
                <div key={k} className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-semibold text-slate-700">{v}</span>
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
