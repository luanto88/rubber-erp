"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { Plus, Search, Filter, X, ChevronDown, Edit2, Trash2, Eye, Package } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type Lot = {
  id: string
  ma_lo: string
  num: number
  suffix: string
  year: string
  ngay_sx: string
  ca: string
  ngan_id: string | null
  loai_csr: string
  loai_banh: number
  boc: string
  tham: string
  pallet: string[]
  chi_thi: string
  kien_a: number
  kien_b: number
  kien_c: number
  kien_d: number
  tong_banh: number
  tong_kg: number
  trang_thai: string
  ghi_chu: string
  ngans?: { ten_ngan: string }
}

type Ngan = { id: string; ten_ngan: string; ma_ngan: string }

const LOAI_CSR = ["CSR10","CSR20","CSR3L","CSRL","CSRCV50","CSRCV60","CSR5","Ngoại lệ"]
const CA_OPTS  = ["A","B"]
const TRANG_THAI_OPTS = ["Hoàn thành","Dở dang","Xuất hàng"]
const BOC_OPTS = [
  "Bọc nhãn 0,04 VRG CSR10","Bọc nhãn 0,04 VRG CSR20",
  "Bọc nhãn 0,04 VRG CSRL","Bọc nhãn 0,04 VRG CSR3L",
  "Bọc nhãn 0,04 VRG CSRCV50","Bọc nhãn 0,04 VRG CSRCV60",
]
const THAM_OPTS  = ["Củ","Mới"]
const PALLET_OPTS = ["Sắt đế gỗ","Sắt mỏng","Gỗ","Nhựa"]

// ─── Business Rules: bành/kiện by CSR type ─────────────────────────────────
function getLoaiBanhConfig(loai_csr: string) {
  if (loai_csr === "CSRCV50" || loai_csr === "CSRCV60") {
    return { loai_banh: 20, max_per_kien: 60, lo_tron: 240 }
  }
  if (loai_csr === "CSRL" || loai_csr === "CSR3L") {
    return { loai_banh: 33.33, max_per_kien: 36, lo_tron: 144 }
  }
  // CSR10, CSR20, CSR5, Ngoại lệ
  return { loai_banh: 35, max_per_kien: 36, lo_tron: 144 }
}

function autoTrangThai(tong_banh: number, lo_tron: number, current: string) {
  if (current === "Xuất hàng") return "Xuất hàng"
  if (tong_banh >= lo_tron) return "Hoàn thành"
  if (tong_banh > 0) return "Dở dang"
  return "Dở dang"
}

// ─── Empty form ───────────────────────────────────────────────────────────────
const emptyForm = () => ({
  ma_lo: "", num: 0, suffix: "cs", year: new Date().getFullYear().toString().slice(-2),
  ngay_sx: new Date().toISOString().slice(0,10),
  ca: "A", ngan_id: "", loai_csr: "CSR10", loai_banh: 35,
  boc: "Bọc nhãn 0,04 VRG CSR10", tham: "Củ", pallet: ["Sắt đế gỗ","Sắt mỏng"],
  chi_thi: "1", kien_a: 36, kien_b: 36, kien_c: 36, kien_d: 36,
  tong_banh: 144, tong_kg: 5040, trang_thai: "Hoàn thành", ghi_chu: "",
})

// ─── Component ───────────────────────────────────────────────────────────────
export default function ProductPage() {
  const [lots, setLots]       = useState<Lot[]>([])
  const [ngans, setNgans]     = useState<Ngan[]>([])
  const [loading, setLoading] = useState(true)
  const [factoryId, setFactoryId] = useState<string | null>(null)

  // Filters
  const [search, setSearch]       = useState("")
  const [filterLoai, setFilterLoai] = useState("")
  const [filterTT, setFilterTT]   = useState("")
  const [filterCa, setFilterCa]   = useState("")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo]   = useState("")

  // Modal
  const [modal, setModal]   = useState<"add"|"edit"|"view"|null>(null)
  const [form, setForm]     = useState(emptyForm())
  const [editId, setEditId] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)
  const [delConfirm, setDelConfirm] = useState<string|null>(null)

  // Pagination
  const [page, setPage]     = useState(1)
  const PER_PAGE = 20

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    let q = supabase
      .from("lots")
      .select("*, ngans(ten_ngan)")
      .eq("factory_id", fid)
      .order("ngay_sx", { ascending: false })
      .order("num", { ascending: false })

    if (filterLoai) q = q.eq("loai_csr", filterLoai)
    if (filterTT)   q = q.eq("trang_thai", filterTT)
    if (filterFrom) q = q.gte("ngay_sx", filterFrom)
    if (filterTo)   q = q.lte("ngay_sx", filterTo)

    const { data } = await q
    setLots(data || [])
    setLoading(false)
  }, [filterLoai, filterTT, filterFrom, filterTo])

  useEffect(() => {
    const fid = localStorage.getItem("erp_factory")
    if (!fid) return
    setFactoryId(fid)
    // Load ngans
    supabase.from("ngans").select("id,ten_ngan,ma_ngan").eq("factory_id", fid)
      .then(({ data }) => setNgans(data || []))
    loadData(fid)
  }, [loadData])

  // ── Filtered + searched lots ───────────────────────────────────────────────
  const filtered = lots.filter(l =>
    (!search || l.ma_lo.toLowerCase().includes(search.toLowerCase()) ||
    (l.ngans?.ten_ngan || "").toLowerCase().includes(search.toLowerCase())) &&
    (!filterCa || l.ca === filterCa)
  )
  const paginated = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE)
  const totalPages = Math.ceil(filtered.length / PER_PAGE)

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = {
    total: filtered.length,
    hoanThanh: filtered.filter(l => l.trang_thai === "Hoàn thành").length,
    dorDang: filtered.filter(l => l.trang_thai === "Dở dang").length,
    tongBanh: filtered.reduce((s,l) => s + (l.tong_banh||0), 0),
    tongKg: filtered.reduce((s,l) => s + (l.tong_kg||0), 0),
  }

  // ── Auto-calc tong_banh & tong_kg + auto loai_banh + auto trang_thai ────
  const updateForm = (patch: Partial<typeof form>) => {
    setForm(prev => {
      const next = { ...prev, ...patch }

      // Auto-set loai_banh when loai_csr changes
      if (patch.loai_csr !== undefined) {
        const cfg = getLoaiBanhConfig(patch.loai_csr)
        next.loai_banh = cfg.loai_banh
        // Clamp existing kiện values to new max
        const max = cfg.max_per_kien
        next.kien_a = Math.min(next.kien_a, max)
        next.kien_b = Math.min(next.kien_b, max)
        next.kien_c = Math.min(next.kien_c, max)
        next.kien_d = Math.min(next.kien_d, max)
      }

      // Clamp kiện values to max_per_kien
      const cfg = getLoaiBanhConfig(next.loai_csr)
      const max = cfg.max_per_kien
      if (patch.kien_a !== undefined) next.kien_a = Math.min(Math.max(0, next.kien_a), max)
      if (patch.kien_b !== undefined) next.kien_b = Math.min(Math.max(0, next.kien_b), max)
      if (patch.kien_c !== undefined) next.kien_c = Math.min(Math.max(0, next.kien_c), max)
      if (patch.kien_d !== undefined) next.kien_d = Math.min(Math.max(0, next.kien_d), max)

      const tb = (next.kien_a||0)+(next.kien_b||0)+(next.kien_c||0)+(next.kien_d||0)
      next.tong_banh = tb
      next.tong_kg   = Math.round(tb * (next.loai_banh||35) * 100) / 100

      // Auto trang_thai
      next.trang_thai = autoTrangThai(tb, cfg.lo_tron, next.trang_thai)

      // Auto ma_lo
      if (patch.num !== undefined || patch.suffix !== undefined || patch.year !== undefined) {
        next.ma_lo = `${next.num}${next.suffix}/${next.year}`
      }
      return next
    })
  }

  // ── Open add modal ─────────────────────────────────────────────────────────
  const openAdd = () => {
    const maxNum = lots.length > 0 ? Math.max(...lots.map(l => l.num||0)) : 0
    const f = emptyForm()
    f.num = maxNum + 1
    f.ma_lo = `${f.num}${f.suffix}/${f.year}`
    setForm(f); setEditId(null); setModal("add")
  }

  // ── Open edit modal ────────────────────────────────────────────────────────
  const openEdit = (lot: Lot) => {
    setForm({
      ma_lo: lot.ma_lo, num: lot.num, suffix: lot.suffix, year: lot.year,
      ngay_sx: lot.ngay_sx?.slice(0,10) || "",
      ca: lot.ca, ngan_id: lot.ngan_id || "",
      loai_csr: lot.loai_csr, loai_banh: lot.loai_banh||35,
      boc: lot.boc, tham: lot.tham, pallet: lot.pallet||[],
      chi_thi: lot.chi_thi, kien_a: lot.kien_a, kien_b: lot.kien_b,
      kien_c: lot.kien_c, kien_d: lot.kien_d,
      tong_banh: lot.tong_banh, tong_kg: lot.tong_kg,
      trang_thai: lot.trang_thai, ghi_chu: lot.ghi_chu||"",
    })
    setEditId(lot.id); setModal("edit")
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!factoryId) return
    setSaving(true)
    try {
      const cfg = getLoaiBanhConfig(form.loai_csr)
      const dd_snapshot = form.trang_thai === "Dở dang" ? {
        kien_a: form.kien_a, kien_b: form.kien_b,
        kien_c: form.kien_c, kien_d: form.kien_d,
        max_per_kien: cfg.max_per_kien,
        timestamp: new Date().toISOString(),
      } : null
      const payload = {
        ...form,
        factory_id: factoryId,
        ngan_id: form.ngan_id || null,
        dd_snapshot,
      }
      if (editId) {
        await supabase.from("lots").update(payload).eq("id", editId)
      } else {
        await supabase.from("lots").insert(payload)
      }
      setModal(null)
      loadData(factoryId)
    } catch (err) {
      console.error("handleSave error:", err)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!factoryId) return
    await supabase.from("lots").delete().eq("id", id)
    setDelConfirm(null)
    loadData(factoryId)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Thành phẩm</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý lô cao su thành phẩm</p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
          <Plus size={16}/> Thêm lô
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: "Tổng lô", value: stats.total, color: "text-slate-700" },
          { label: "Hoàn thành", value: stats.hoanThanh, color: "text-emerald-600" },
          { label: "Dở dang", value: stats.dorDang, color: "text-amber-600" },
          { label: "Tổng bành", value: stats.tongBanh.toLocaleString(), color: "text-blue-600" },
          { label: "Tổng kg", value: (stats.tongKg/1000).toFixed(1)+"T", color: "text-purple-600" },
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
          <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}
            placeholder="Tìm mã lô, ngăn..." className="flex-1 text-sm outline-none"/>
        </div>
        <select value={filterLoai} onChange={e=>{setFilterLoai(e.target.value);setPage(1)}}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400">
          <option value="">Tất cả loại</option>
          {LOAI_CSR.map(l=><option key={l}>{l}</option>)}
        </select>
        <select value={filterTT} onChange={e=>{setFilterTT(e.target.value);setPage(1)}}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400">
          <option value="">Tất cả trạng thái</option>
          {TRANG_THAI_OPTS.map(t=><option key={t}>{t}</option>)}
        </select>
        <select value={filterCa} onChange={e=>{setFilterCa(e.target.value);setPage(1)}}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400">
          <option value="">Tất cả ca</option>
          {CA_OPTS.map(c=><option key={c} value={c}>Ca {c}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e=>{setFilterFrom(e.target.value);setPage(1)}}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"/>
        <span className="text-slate-400 text-sm">→</span>
        <input type="date" value={filterTo} onChange={e=>{setFilterTo(e.target.value);setPage(1)}}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"/>
        {(filterLoai||filterTT||filterCa||filterFrom||filterTo||search) &&
          <button onClick={()=>{setFilterLoai("");setFilterTT("");setFilterCa("");setFilterFrom("");setFilterTo("");setSearch("");setPage(1)}}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-500">
            <X size={14}/> Xóa lọc
          </button>}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Package size={40} className="mx-auto mb-3 opacity-30"/>
            <p>Không có lô nào</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Mã lô","Ngày SX","Ca","Ngăn","Loại","Bành","Trọng lượng","Trạng thái",""].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.map(lot => (
                <tr key={lot.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-bold text-emerald-700">{lot.ma_lo}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {lot.ngay_sx ? new Date(lot.ngay_sx).toLocaleDateString("vi-VN") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">Ca {lot.ca}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{lot.ngans?.ten_ngan || "—"}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">{lot.loai_csr}</span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{lot.tong_banh}</td>
                  <td className="px-4 py-3 text-slate-600">{((lot.tong_kg||0)/1000).toFixed(3)} T</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      lot.trang_thai === "Hoàn thành" ? "bg-emerald-100 text-emerald-700" :
                      lot.trang_thai === "Dở dang"    ? "bg-amber-100 text-amber-700" :
                      "bg-slate-100 text-slate-600"}`}>
                      {lot.trang_thai}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={()=>{openEdit(lot)}}
                        className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors">
                        <Edit2 size={14}/>
                      </button>
                      <button onClick={()=>setDelConfirm(lot.id)}
                        className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors">
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">{filtered.length} lô · Trang {page}/{totalPages}</span>
            <div className="flex gap-1">
              {Array.from({length: Math.min(totalPages,7)}, (_,i) => i+1).map(p => (
                <button key={p} onClick={()=>setPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${p===page?"bg-emerald-600 text-white":"hover:bg-slate-100 text-slate-600"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {(modal === "add" || modal === "edit") && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">
                {modal === "add" ? "Thêm lô mới" : `Sửa lô ${form.ma_lo}`}
              </h2>
              <button onClick={()=>setModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Row 1 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Số lô *</label>
                  <input type="number" value={form.num} onChange={e=>updateForm({num:+e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã lô</label>
                  <input value={form.ma_lo} readOnly
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-500"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Hậu tố</label>
                  <input value={form.suffix} onChange={e=>updateForm({suffix:e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
              </div>
              {/* Row 2 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày sản xuất *</label>
                  <input type="date" value={form.ngay_sx} onChange={e=>updateForm({ngay_sx:e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ca *</label>
                  <select value={form.ca} onChange={e=>updateForm({ca:e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {CA_OPTS.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại CSR *</label>
                  <select value={form.loai_csr} onChange={e=>updateForm({loai_csr:e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {LOAI_CSR.map(l=><option key={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              {/* Row 3 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngăn lưu</label>
                  <select value={form.ngan_id} onChange={e=>updateForm({ngan_id:e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    <option value="">-- Chọn ngăn --</option>
                    {ngans.map(n=><option key={n.id} value={n.id}>{n.ten_ngan} — {n.ma_ngan}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại bành (kg/bành)</label>
                  <input type="number" value={form.loai_banh} readOnly
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-500"/>
                  <p className="text-[10px] text-slate-400 mt-1">Tự động theo loại CSR</p>
                </div>
              </div>
              {/* Kiện A B C D — with lock logic */}
              {(() => {
                const cfg = getLoaiBanhConfig(form.loai_csr)
                const maxK = cfg.max_per_kien
                const loTron = cfg.lo_tron
                return (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-600">Số bành kiện (A / B / C / D)</label>
                      <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-bold">
                        Max {maxK} bành/kiện · Lô tròn = {loTron} bành
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {(["kien_a","kien_b","kien_c","kien_d"] as const).map((k,i)=>{
                        const val = form[k]
                        const isLocked = val >= maxK
                        return (
                          <div key={k} className="relative">
                            <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold ${isLocked ? "text-emerald-500" : "text-slate-400"}`}>{["A","B","C","D"][i]}</span>
                            <input type="number" value={val}
                              min={0} max={maxK}
                              disabled={isLocked}
                              onChange={e=>updateForm({[k]:+e.target.value} as any)}
                              className={`w-full pl-7 pr-3 py-2 border rounded-xl text-sm outline-none transition-colors ${
                                isLocked
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 font-bold cursor-not-allowed"
                                  : val > 0
                                    ? "border-amber-300 bg-amber-50 text-amber-700 font-semibold focus:border-amber-500"
                                    : "border-slate-300 focus:border-emerald-500"
                              }`}/>
                            {isLocked && (
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500 text-[10px] font-bold">🔒</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {/* Warning for partially filled kiện */}
                    {form.tong_banh > 0 && form.tong_banh < loTron && (
                      <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-center gap-2">
                        <span>⚠️</span>
                        <span>Lô dở dang: {form.tong_banh}/{loTron} bành. Còn thiếu {loTron - form.tong_banh} bành để thành lô tròn.</span>
                      </div>
                    )}
                    {form.tong_banh >= loTron && (
                      <div className="mt-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-center gap-2">
                        <span>✅</span>
                        <span>Lô tròn hoàn thành: {form.tong_banh} bành · {form.tong_kg.toLocaleString()} kg</span>
                      </div>
                    )}
                    <div className="mt-2 flex gap-4 text-xs text-slate-500">
                      <span>Tổng bành: <strong className="text-slate-700">{form.tong_banh}</strong></span>
                      <span>Tổng kg: <strong className="text-slate-700">{form.tong_kg.toLocaleString()}</strong></span>
                      <span>Trạng thái: <strong className={form.trang_thai === "Hoàn thành" ? "text-emerald-600" : "text-amber-600"}>{form.trang_thai}</strong></span>
                    </div>
                  </div>
                )
              })()}
              {/* Bọc, Thảm */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Bọc</label>
                  <select value={form.boc} onChange={e=>updateForm({boc:e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {BOC_OPTS.map(b=><option key={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Thảm</label>
                  <select value={form.tham} onChange={e=>updateForm({tham:e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {THAM_OPTS.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {/* Trạng thái + Ghi chú */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Trạng thái</label>
                  <input value={form.trang_thai} readOnly
                    className={`w-full px-3 py-2 border rounded-xl text-sm font-bold cursor-not-allowed ${
                      form.trang_thai === "Hoàn thành" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
                      form.trang_thai === "Dở dang" ? "border-amber-200 bg-amber-50 text-amber-700" :
                      "border-blue-200 bg-blue-50 text-blue-700"
                    }`}/>
                  <p className="text-[10px] text-slate-400 mt-1">Tự động: Hoàn thành khi đủ bành, Dở dang khi thiếu</p>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
                  <input value={form.ghi_chu} onChange={e=>updateForm({ghi_chu:e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
              </div>
            </div>
            {/* Footer */}
            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={()=>setModal(null)}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
                Hủy
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50">
                {saving ? "Đang lưu..." : modal === "add" ? "Thêm lô" : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-extrabold text-slate-800 mb-2">Xác nhận xóa?</h3>
            <p className="text-sm text-slate-500 mb-5">Lô này sẽ bị xóa vĩnh viễn khỏi hệ thống.</p>
            <div className="flex gap-3">
              <button onClick={()=>setDelConfirm(null)}
                className="flex-1 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={()=>handleDelete(delConfirm)}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-md">Xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
