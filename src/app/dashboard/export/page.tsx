"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { FileOutput, Plus, X, Search, Truck, Package, ChevronDown, ChevronUp, Edit2, Trash2, Check } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type Vehicle = {
  id: string
  loai_xe: string
  bien_truoc: string
  bien_sau: string
  ghi_chu: string
}

type Assignment = {
  lot_id: string
  ma_lo: string
  vehicleIdx: number
  kien_a: number
  kien_b: number
  kien_c: number
  kien_d: number
}

type ExportOrder = {
  id: string
  factory_id: string
  ma_don: string
  ngay: string
  so_thong_bao: string
  so_hoa_don: string
  so_hop_dong: string
  customer_id: string | null
  chung_loai: string
  loai_pallet: string
  loai_banh: number
  loai_boc: string
  vehicles: Vehicle[]
  assignments: Assignment[]
  tong_banh: number
  customers?: { ma_kh: string; ten_kh_en: string }
}

type Lot = { id: string; ma_lo: string; loai_csr: string; tong_banh: number; tong_kg: number; trang_thai: string }
type Customer = { id: string; ma_kh: string; ten_kh_en: string }

const LOAI_XE_OPTS = ["Container 20ft","Container 40ft","Xe tải mui bạt","Khác"]
const LOAI_PALLET  = ["Xuất rời","Pallet gỗ","Pallet sắt"]
const LOAI_CSR     = ["CSR10","CSR20","CSR3L","CSRL","CSRCV50","CSRCV60","CSR5","Ngoại lệ"]
const BOC_OPTS = [
  "Bọc nhãn 0,04 VRG CSR10","Bọc nhãn 0,04 VRG CSR20",
  "Bọc nhãn 0,04 VRG CSRL","Bọc nhãn 0,04 VRG CSR3L",
  "Bọc nhãn 0,04 VRG CSRCV50","Bọc nhãn 0,04 VRG CSRCV60",
]

const emptyVehicle = (): Vehicle => ({
  id: `v_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
  loai_xe: "Container 40ft", bien_truoc: "", bien_sau: "", ghi_chu: "",
})

const emptyForm = () => ({
  ma_don: "", ngay: new Date().toISOString().slice(0,10),
  so_thong_bao: "", so_hoa_don: "", so_hop_dong: "",
  customer_id: "", chung_loai: "CSR10", loai_pallet: "Xuất rời",
  loai_banh: 35, loai_boc: "Bọc nhãn 0,04 VRG CSR10",
  vehicles: [emptyVehicle()] as Vehicle[],
  assignments: [] as Assignment[],
})

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ExportPage() {
  const [orders, setOrders]       = useState<ExportOrder[]>([])
  const [lots, setLots]           = useState<Lot[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading]     = useState(true)
  const [factoryId, setFactoryId] = useState<string|null>(null)

  const [search, setSearch]       = useState("")
  const [filterLoai, setFilterLoai] = useState("")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo]   = useState("")

  // Views
  const [view, setView]           = useState<"list"|"add"|"detail">("list")
  const [form, setForm]           = useState(emptyForm())
  const [editId, setEditId]       = useState<string|null>(null)
  const [saving, setSaving]       = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<ExportOrder|null>(null)
  const [expandedId, setExpandedId] = useState<string|null>(null)

  // Delete
  const [delConfirm, setDelConfirm] = useState<string|null>(null)

  // Lot selection for assignments
  const [lotSearch, setLotSearch] = useState("")

  // Toast
  const [toast, setToast] = useState<string|null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    let q = supabase.from("export_orders")
      .select("*, customers(ma_kh,ten_kh_en)")
      .eq("factory_id", fid)
      .order("ngay", { ascending: false })
    if (filterLoai) q = q.eq("chung_loai", filterLoai)
    if (filterFrom) q = q.gte("ngay", filterFrom)
    if (filterTo)   q = q.lte("ngay", filterTo)
    const { data } = await q
    setOrders(data || [])
    setLoading(false)
  }, [filterLoai, filterFrom, filterTo])

  const loadLots = useCallback(async (fid: string) => {
    const { data } = await supabase.from("lots")
      .select("id,ma_lo,loai_csr,tong_banh,tong_kg,trang_thai")
      .eq("factory_id", fid).eq("trang_thai","Hoàn thành")
      .order("num", { ascending: false })
    setLots(data || [])
  }, [])

  useEffect(() => {
    const fid = localStorage.getItem("erp_factory")
    if (!fid) return
    setFactoryId(fid)
    loadData(fid)
    loadLots(fid)
    supabase.from("customers").select("id,ma_kh,ten_kh_en").eq("factory_id", fid)
      .then(({ data }) => setCustomers(data || []))
  }, [loadData, loadLots])

  const filtered = orders.filter(o =>
    !search ||
    o.ma_don?.toLowerCase().includes(search.toLowerCase()) ||
    o.customers?.ten_kh_en?.toLowerCase().includes(search.toLowerCase()) ||
    o.customers?.ma_kh?.toLowerCase().includes(search.toLowerCase())
  )

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    total: orders.length,
    tongBanh: orders.reduce((s,o) => s+(o.tong_banh||0), 0),
    tongXe: orders.reduce((s,o) => s+(o.vehicles?.length||0), 0),
  }

  // ── Open Edit ─────────────────────────────────────────────────────────────
  const openEdit = (order: ExportOrder) => {
    setForm({
      ma_don: order.ma_don || "",
      ngay: order.ngay?.slice(0,10) || new Date().toISOString().slice(0,10),
      so_thong_bao: order.so_thong_bao || "",
      so_hoa_don: order.so_hoa_don || "",
      so_hop_dong: order.so_hop_dong || "",
      customer_id: order.customer_id || "",
      chung_loai: order.chung_loai || "CSR10",
      loai_pallet: order.loai_pallet || "Xuất rời",
      loai_banh: order.loai_banh || 35,
      loai_boc: order.loai_boc || "Bọc nhãn 0,04 VRG CSR10",
      vehicles: order.vehicles?.length ? order.vehicles.map(v => ({...v})) : [emptyVehicle()],
      assignments: order.assignments?.length ? order.assignments.map(a => ({...a})) : [],
    })
    setEditId(order.id)
    setView("add")
  }

  // ── Assignment helpers ────────────────────────────────────────────────────
  const toggleLot = (lot: Lot, vehicleIdx: number) => {
    setForm(prev => {
      const exists = prev.assignments.find(a => a.lot_id===lot.id && a.vehicleIdx===vehicleIdx)
      if (exists) {
        return { ...prev, assignments: prev.assignments.filter(a => !(a.lot_id===lot.id && a.vehicleIdx===vehicleIdx)) }
      }
      return {
        ...prev,
        assignments: [...prev.assignments, {
          lot_id: lot.id, ma_lo: lot.ma_lo, vehicleIdx,
          kien_a: 36, kien_b: 36, kien_c: 36, kien_d: 36,
        }]
      }
    })
  }

  const updateAssignment = (lot_id: string, vehicleIdx: number, field: string, val: number) => {
    setForm(prev => ({
      ...prev,
      assignments: prev.assignments.map(a =>
        a.lot_id===lot_id && a.vehicleIdx===vehicleIdx ? { ...a, [field]: val } : a
      )
    }))
  }

  const totalBanh = form.assignments.reduce((s,a) =>
    s+(a.kien_a||0)+(a.kien_b||0)+(a.kien_c||0)+(a.kien_d||0), 0)

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!factoryId) return
    setSaving(true)
    const payload = {
      factory_id: factoryId,
      ma_don: form.ma_don, ngay: form.ngay,
      so_thong_bao: form.so_thong_bao, so_hoa_don: form.so_hoa_don,
      so_hop_dong: form.so_hop_dong,
      customer_id: form.customer_id || null,
      chung_loai: form.chung_loai, loai_pallet: form.loai_pallet,
      loai_banh: form.loai_banh, loai_boc: form.loai_boc,
      vehicles: form.vehicles,
      assignments: form.assignments,
      tong_banh: totalBanh,
    }
    const newLotIds = [...new Set(form.assignments.map(a => a.lot_id))]
    if (editId) {
      // Revert lots của đơn cũ về "Hoàn thành" trước khi cập nhật
      const oldOrder = orders.find(o => o.id === editId)
      if (oldOrder?.assignments?.length) {
        const oldLotIds = [...new Set(oldOrder.assignments.map((a: Assignment) => a.lot_id))]
        await supabase.from("lots").update({ trang_thai: "Hoàn thành" }).in("id", oldLotIds)
      }
      await supabase.from("export_orders").update(payload).eq("id", editId)
      showToast("Đã cập nhật đơn xuất hàng")
    } else {
      await supabase.from("export_orders").insert(payload)
      showToast("Đã tạo đơn xuất hàng mới")
    }
    // Cập nhật lots được gán vào đơn này → "Xuất hàng"
    if (newLotIds.length > 0) {
      await supabase.from("lots").update({ trang_thai: "Xuất hàng" }).in("id", newLotIds)
    }
    setSaving(false)
    setView("list")
    setEditId(null)
    setForm(emptyForm())
    loadData(factoryId)
    loadLots(factoryId)
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!factoryId) return
    // Revert lots của đơn bị xóa về "Hoàn thành"
    const order = orders.find(o => o.id === id)
    if (order?.assignments?.length) {
      const lotIds = [...new Set(order.assignments.map((a: Assignment) => a.lot_id))]
      await supabase.from("lots").update({ trang_thai: "Hoàn thành" }).in("id", lotIds)
    }
    await supabase.from("export_orders").delete().eq("id", id)
    setDelConfirm(null)
    showToast("Đã xóa đơn xuất hàng")
    loadData(factoryId)
    loadLots(factoryId)
  }

  // ── Filtered lots for assignment ──────────────────────────────────────────
  const availLots = lots.filter(l =>
    l.loai_csr === form.chung_loai &&
    (!lotSearch || l.ma_lo.toLowerCase().includes(lotSearch.toLowerCase()))
  )

  // ── Toast ─────────────────────────────────────────────────────────────────
  const ToastNotification = () => toast ? (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl shadow-lg animate-[fadeInUp_0.3s_ease-out]">
      <Check size={16}/> {toast}
    </div>
  ) : null

  // ── RENDER: LIST ──────────────────────────────────────────────────────────
  if (view === "list") return (
    <div>
      <ToastNotification/>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Xuất hàng</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý đơn xuất hàng</p>
        </div>
        <button onClick={() => { setForm(emptyForm()); setEditId(null); setView("add") }}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
          <Plus size={16}/> Tạo đơn xuất
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label:"Tổng đơn xuất",  value: stats.total,                    color:"text-slate-700"  },
          { label:"Tổng bành xuất", value: stats.tongBanh.toLocaleString(), color:"text-emerald-600"},
          { label:"Tổng xe",        value: stats.tongXe,                   color:"text-blue-600"   },
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
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Tìm mã đơn, khách hàng..." className="flex-1 text-sm outline-none"/>
        </div>
        <select value={filterLoai} onChange={e=>setFilterLoai(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400">
          <option value="">Tất cả loại</option>
          {LOAI_CSR.map(l=><option key={l}>{l}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e=>setFilterFrom(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"/>
        <span className="text-slate-400 text-sm">→</span>
        <input type="date" value={filterTo} onChange={e=>setFilterTo(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"/>
        {(search||filterLoai||filterFrom||filterTo) &&
          <button onClick={()=>{setSearch("");setFilterLoai("");setFilterFrom("");setFilterTo("")}}
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
            <FileOutput size={40} className="mx-auto mb-3 opacity-30"/>
            <p>Không có đơn xuất hàng nào</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Mã đơn","Ngày","Khách hàng","Loại","Xe","Tổng bành","Hợp đồng",""].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(order => (
                <>
                  <tr key={order.id} className="hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={()=>setExpandedId(expandedId===order.id?null:order.id)}>
                    <td className="px-4 py-3 font-bold text-emerald-700">{order.ma_don}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {order.ngay ? new Date(order.ngay).toLocaleDateString("vi-VN") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-700">{order.customers?.ten_kh_en || "—"}</div>
                      <div className="text-xs text-slate-400">{order.customers?.ma_kh}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">{order.chung_loai}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{order.vehicles?.length || 0} xe</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{(order.tong_banh||0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{order.so_hop_dong || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); openEdit(order) }}
                          className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors" title="Sửa">
                          <Edit2 size={14}/>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setDelConfirm(order.id) }}
                          className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors" title="Xóa">
                          <Trash2 size={14}/>
                        </button>
                        {expandedId===order.id ? <ChevronUp size={16} className="text-slate-400"/> : <ChevronDown size={16} className="text-slate-400"/>}
                      </div>
                    </td>
                  </tr>
                  {expandedId===order.id && (
                    <tr key={order.id+"_exp"}>
                      <td colSpan={8} className="px-4 py-4 bg-slate-50 border-t border-slate-100">
                        <div className="grid grid-cols-2 gap-4 text-xs mb-3">
                          <div className="space-y-1">
                            <div className="flex gap-2"><span className="text-slate-500 w-28">Số thông báo:</span><span className="font-semibold">{order.so_thong_bao||"—"}</span></div>
                            <div className="flex gap-2"><span className="text-slate-500 w-28">Số hóa đơn:</span><span className="font-semibold">{order.so_hoa_don||"—"}</span></div>
                            <div className="flex gap-2"><span className="text-slate-500 w-28">Loại pallet:</span><span className="font-semibold">{order.loai_pallet||"—"}</span></div>
                          </div>
                          <div>
                            <div className="font-bold text-slate-600 mb-1.5">Xe ({order.vehicles?.length})</div>
                            <div className="space-y-1">
                              {(order.vehicles||[]).map((v,i) => (
                                <div key={v.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-slate-200">
                                  <Truck size={12} className="text-slate-400"/>
                                  <span className="font-semibold text-slate-700">{v.loai_xe}</span>
                                  <span className="text-slate-500">{v.bien_truoc}</span>
                                  {v.bien_sau && <><span className="text-slate-300">/</span><span className="text-slate-500">{v.bien_sau}</span></>}
                                  <span className="ml-auto text-emerald-600 font-bold">
                                    {(order.assignments||[]).filter(a=>a.vehicleIdx===i).length} lô
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        {/* Assignments */}
                        {(order.assignments||[]).length > 0 && (
                          <div>
                            <div className="font-bold text-slate-600 mb-1.5 text-xs">Lô hàng ({order.assignments.length})</div>
                            <div className="flex flex-wrap gap-1.5">
                              {(order.assignments||[]).map(a => (
                                <span key={a.lot_id+a.vehicleIdx}
                                  className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700">
                                  {a.ma_lo} · Xe {a.vehicleIdx+1}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirm */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-extrabold text-slate-800 mb-2">Xác nhận xóa?</h3>
            <p className="text-sm text-slate-500 mb-5">Đơn xuất hàng này sẽ bị xóa vĩnh viễn.</p>
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

  // ── RENDER: ADD / EDIT ────────────────────────────────────────────────────
  return (
    <div>
      <ToastNotification/>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={()=>{ setView("list"); setEditId(null) }} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">
            {editId ? "Sửa đơn xuất hàng" : "Tạo đơn xuất hàng"}
          </h1>
        </div>
      </div>

      <div className="flex gap-4" style={{ height: "calc(100vh - 200px)" }}>
        {/* LEFT PANEL: Thông tin đơn + Xe */}
        <div className="w-1/2 overflow-y-auto pr-2 space-y-4">
          {/* Thông tin đơn */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="font-bold text-slate-700 mb-4">Thông tin đơn</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã đơn *</label>
                <input value={form.ma_don} onChange={e=>setForm(p=>({...p,ma_don:e.target.value}))}
                  placeholder="XH_KUMHO_14_240226"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày xuất</label>
                <input type="date" value={form.ngay} onChange={e=>setForm(p=>({...p,ngay:e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Khách hàng</label>
                <select value={form.customer_id} onChange={e=>setForm(p=>({...p,customer_id:e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  <option value="">-- Chọn khách hàng --</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.ten_kh_en} ({c.ma_kh})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại CSR</label>
                <select value={form.chung_loai} onChange={e=>setForm(p=>({...p,chung_loai:e.target.value,assignments:[]}))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  {LOAI_CSR.map(l=><option key={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Số thông báo</label>
                <input value={form.so_thong_bao} onChange={e=>setForm(p=>({...p,so_thong_bao:e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Số hóa đơn</label>
                <input value={form.so_hoa_don} onChange={e=>setForm(p=>({...p,so_hoa_don:e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Số hợp đồng</label>
                <input value={form.so_hop_dong} onChange={e=>setForm(p=>({...p,so_hop_dong:e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại pallet</label>
                <select value={form.loai_pallet} onChange={e=>setForm(p=>({...p,loai_pallet:e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  {LOAI_PALLET.map(l=><option key={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại bành (kg)</label>
                <input type="number" value={form.loai_banh} onChange={e=>setForm(p=>({...p,loai_banh:+e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại bọc</label>
                <select value={form.loai_boc} onChange={e=>setForm(p=>({...p,loai_boc:e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  {BOC_OPTS.map(b=><option key={b}>{b}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Xe */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700">Xe ({form.vehicles.length})</h3>
              <button onClick={()=>setForm(p=>({...p,vehicles:[...p.vehicles,emptyVehicle()]}))}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg">
                <Plus size={13}/> Thêm xe
              </button>
            </div>
            <div className="space-y-3">
              {form.vehicles.map((v,idx) => (
                <div key={v.id} className="grid grid-cols-5 gap-2 items-end p-3 bg-slate-50 rounded-xl">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Xe {idx+1}</label>
                    <select value={v.loai_xe}
                      onChange={e=>setForm(p=>({...p,vehicles:p.vehicles.map((vv,i)=>i===idx?{...vv,loai_xe:e.target.value}:vv)}))}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400">
                      {LOAI_XE_OPTS.map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Biển trước</label>
                    <input value={v.bien_truoc} placeholder="3E2358"
                      onChange={e=>setForm(p=>({...p,vehicles:p.vehicles.map((vv,i)=>i===idx?{...vv,bien_truoc:e.target.value}:vv)}))}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Biển sau</label>
                    <input value={v.bien_sau} placeholder="4A9639"
                      onChange={e=>setForm(p=>({...p,vehicles:p.vehicles.map((vv,i)=>i===idx?{...vv,bien_sau:e.target.value}:vv)}))}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Ghi chú</label>
                    <input value={v.ghi_chu}
                      onChange={e=>setForm(p=>({...p,vehicles:p.vehicles.map((vv,i)=>i===idx?{...vv,ghi_chu:e.target.value}:vv)}))}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                  </div>
                  <button onClick={()=>setForm(p=>({...p,vehicles:p.vehicles.filter((_,i)=>i!==idx),assignments:p.assignments.filter(a=>a.vehicleIdx!==idx).map(a=>a.vehicleIdx>idx?{...a,vehicleIdx:a.vehicleIdx-1}:a)}))}
                    className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg self-end">
                    <X size={14}/>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Lot picker + Assignments */}
        <div className="w-1/2 overflow-y-auto pl-2 space-y-4">
          {/* Lot picker */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="font-bold text-slate-700 mb-3">Chọn lô ({form.chung_loai})</h3>
            <input value={lotSearch} onChange={e=>setLotSearch(e.target.value)}
              placeholder="Tìm mã lô..."
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:border-emerald-400 mb-3"/>

            {/* Vehicle selector */}
            <div className="flex gap-1 mb-3 flex-wrap">
              {form.vehicles.map((v,i) => (
                <span key={v.id} className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg">
                  Xe {i+1}
                </span>
              ))}
            </div>

            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {availLots.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">Không có lô {form.chung_loai} nào</p>
              ) : availLots.map(lot => {
                const assignedVehicles = form.assignments
                  .filter(a=>a.lot_id===lot.id)
                  .map(a=>`Xe ${a.vehicleIdx+1}`)
                const isAssigned = assignedVehicles.length > 0
                return (
                  <div key={lot.id} className={`rounded-xl border p-3 text-xs transition-all ${isAssigned?"border-emerald-300 bg-emerald-50":"border-slate-200 hover:border-emerald-300"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-slate-700">{lot.ma_lo}</span>
                      <span className="text-slate-500">{lot.tong_banh} bành</span>
                    </div>
                    {isAssigned && (
                      <div className="text-emerald-600 text-xs mb-2">✓ {assignedVehicles.join(", ")}</div>
                    )}
                    <div className="flex gap-1 flex-wrap">
                      {form.vehicles.map((v,vIdx) => {
                        const isInThisVehicle = form.assignments.some(a=>a.lot_id===lot.id&&a.vehicleIdx===vIdx)
                        return (
                          <button key={v.id} onClick={()=>toggleLot(lot,vIdx)}
                            className={`px-2 py-1 rounded-lg font-bold transition-all ${
                              isInThisVehicle
                                ? "bg-emerald-600 text-white"
                                : "bg-slate-100 text-slate-600 hover:bg-emerald-100"}`}>
                            Xe {vIdx+1}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Assignments per vehicle */}
          {form.vehicles.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="font-bold text-slate-700 mb-1">Lô hàng đã chọn</h3>
              <p className="text-xs text-slate-400 mb-4">Tổng: <strong className="text-emerald-600">{totalBanh.toLocaleString()} bành</strong></p>
              {form.vehicles.map((v,vIdx) => {
                const vAssigns = form.assignments.filter(a => a.vehicleIdx===vIdx)
                return (
                  <div key={v.id} className="mb-4">
                    <div className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-2">
                      <Truck size={12}/>
                      Xe {vIdx+1} — {v.loai_xe} {v.bien_truoc}
                      <span className="text-emerald-600">({vAssigns.length} lô)</span>
                    </div>
                    {vAssigns.length === 0 ? (
                      <p className="text-xs text-slate-400 italic pl-4">Chưa có lô nào</p>
                    ) : (
                      <div className="space-y-1.5 pl-4">
                        {vAssigns.map(a => (
                          <div key={a.lot_id} className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                            <Package size={12} className="text-emerald-500"/>
                            <span className="font-bold text-emerald-700 w-20">{a.ma_lo}</span>
                            {(["kien_a","kien_b","kien_c","kien_d"] as const).map((k,ki) => (
                              <div key={k} className="flex items-center gap-1">
                                <span className="text-slate-400">{["A","B","C","D"][ki]}:</span>
                                <input type="number" value={a[k]}
                                  onChange={e=>updateAssignment(a.lot_id,vIdx,k,+e.target.value)}
                                  className="w-12 px-1.5 py-1 border border-emerald-200 rounded text-center font-mono text-xs outline-none focus:border-emerald-400"/>
                              </div>
                            ))}
                            <button onClick={()=>setForm(p=>({...p,assignments:p.assignments.filter(aa=>!(aa.lot_id===a.lot_id&&aa.vehicleIdx===vIdx))}))}
                              className="ml-auto text-red-400 hover:text-red-600"><X size={12}/></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Save bar */}
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={()=>{ setView("list"); setEditId(null) }}
          className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-50">
          {saving ? "Đang lưu..." : editId ? "Lưu thay đổi" : `Lưu đơn xuất (${totalBanh.toLocaleString()} bành)`}
        </button>
      </div>
    </div>
  )
}
