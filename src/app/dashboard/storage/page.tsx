"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { useScrollReveal } from "@/lib/useScrollReveal"
import {
  Warehouse, Plus, X, Search, Eye, Edit2,
  Tag, Layers, MapPin, ShieldCheck, Weight, BarChart2, Activity, Droplets, Truck
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

type TripItem = {
  uid: string
  _date: string
  so_xe: string
  chuyen: number
  tai_xe: string
  kl_ct: number; kl_ck: number    // Mủ chén
  kl_dct: number; kl_dck: number  // Mủ đông chén
  kl_dkt: number; kl_dkk: number  // Mủ đông khối
  kl_dt: number;  kl_dk: number   // Mủ dây
  kl_mn: number;  kl_mnk: number  // Mủ nước
}

function getKLFromTrip(t: TripItem, loai_nl: string): { tuoi: number; kho: number } {
  switch (loai_nl) {
    case "Mủ chén":      return { tuoi: t.kl_ct,  kho: t.kl_ck }
    case "Mủ đông chén": return { tuoi: t.kl_dct, kho: t.kl_dck }
    case "Mủ đông khối": return { tuoi: t.kl_dkt, kho: t.kl_dkk }
    case "Mủ dây":       return { tuoi: t.kl_dt,  kho: t.kl_dk }
    case "Mủ nước":      return { tuoi: t.kl_mn,  kho: t.kl_mnk }
    default:             return { tuoi: 0, kho: 0 }
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const ALL_POSITIONS = [
  "N1","N2","N3","N4","N5","N6","N7","N8","N9","N10",
  "N11","N12","N13","N14","N15","N16","N17","N18","N19","N20",
  "N21","N22","N23","N24"
]

const NGUON_GOC_OPTS  = ["NT","M","GCA"]
const XU_LY_OPTS      = ["Xé","Không xé","Hỗn hợp"]
const CHUNG_NHAN_BASE = ["PEFC CS","PEFC FM","Không"]
const TRANG_THAI_OPTS = ["Đang nhận (Cần cập nhật)","Chờ sản xuất","Đang sản xuất","Đã sản xuất"]

const NL_ABBR: Record<string, string> = {
  "Mủ chén": "MC", "Mủ đông chén": "ĐC", "Mủ đông khối": "ĐK",
  "Mủ dây": "MD",  "Mủ dơ": "MDơ",       "Mủ tạp": "MT", "Mủ nước": "MN"
}

const loaiNLByDC = (dc: string, fCode: string): string[] => {
  if (dc === "Mủ nước") return ["Mủ nước"]
  const base = ["Mủ chén","Mủ đông chén","Mủ đông khối","Mủ dây","Mủ tạp"]
  return fCode === "cuaparis" ? [...base, "Mủ dơ"] : base
}

const emptyForm = (loaiNL = "Mủ đông chén") => ({
  ma_ngan: "", ten_ngan: "",
  loai_nl: loaiNL, nguon_goc: "NT",
  xu_ly: "Xé", chung_nhan: "PEFC CS",
  ngay_bd: new Date().toISOString().slice(0, 10),
  ngay_kt: "",
  trang_thai: "Đang nhận (Cần cập nhật)",
  tong_tuoi: 0, tong_kho: 0,
  lo_nguon_goc: "",
})

const headerStyle = (tt: string) => {
  if (tt === "Đang sản xuất")            return { grad: "from-emerald-50 to-teal-50",   icon: "text-emerald-600" }
  if (tt === "Đã sản xuất")              return { grad: "from-blue-50 to-cyan-50",       icon: "text-blue-600" }
  if (tt === "Chờ sản xuất")             return { grad: "from-amber-50 to-yellow-50",    icon: "text-amber-500" }
  if (tt === "Đang nhận (Cần cập nhật)") return { grad: "from-slate-50 to-gray-100",    icon: "text-slate-400" }
  return { grad: "from-slate-50 to-gray-100", icon: "text-slate-400" }
}

const badgeClass = (tt: string) => {
  if (tt === "Đang sản xuất")            return "bg-emerald-100 text-emerald-700"
  if (tt === "Đã sản xuất")              return "bg-blue-100 text-blue-700"
  if (tt === "Chờ sản xuất")             return "bg-amber-100 text-amber-700"
  if (tt === "Đang nhận (Cần cập nhật)") return "bg-slate-100 text-slate-500"
  return "bg-slate-100 text-slate-600"
}

const deriveTrangThai = (ngay_bd: string, ngay_kt: string, current: string): string => {
  if (current === "Đang sản xuất" || current === "Đã sản xuất") return current
  if (ngay_bd && ngay_kt) return "Chờ sản xuất"
  if (ngay_bd) return "Đang nhận (Cần cập nhật)"
  return current
}

const genMaNgan = (f: ReturnType<typeof emptyForm>) => {
  const xlAbbr = f.xu_ly === "Xé" ? "X" : f.xu_ly === "Không xé" ? "KX" : "HH"
  const fmt = (d: string) =>
    d ? new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "2-digit" }) : ""
  return [f.ten_ngan, f.nguon_goc, NL_ABBR[f.loai_nl] || "", xlAbbr, fmt(f.ngay_bd), fmt(f.ngay_kt)]
    .filter(Boolean).join("-")
}

// Normalize "dd/mm/yyyy" → "YYYY-MM-DD" (dispatch_entries.ngay can be either format)
const toISO = (d: string) =>
  d && d.includes("/") ? d.split("/").reverse().join("-") : d

// Format any date string → "dd/mm/yyyy" without timezone issues
const fmtDate = (d: string) => {
  if (!d) return "—"
  const iso = (d.includes("/") ? d.split("/").reverse().join("-") : d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return "—"
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function StoragePage() {
  const revealRef = useScrollReveal()

  // data
  const [ngans, setNgans]               = useState<Ngan[]>([])
  const [lotStats, setLotStats]         = useState<Record<string, number>>({})
  const [loading, setLoading]           = useState(true)
  const [factoryId, setFactoryId]       = useState<string | null>(null)
  const [factoryCode, setFactoryCode]   = useState("")

  // filters
  const [search, setSearch]     = useState("")
  const [filterTT, setFilterTT] = useState("")
  const [dayChuyen, setDayChuyen] = useState<"Mủ tạp" | "Mủ nước">("Mủ tạp")

  // modal / form
  const [modal, setModal]         = useState<"add" | "edit" | "view" | null>(null)
  const [form, setForm]           = useState(emptyForm())
  const [editId, setEditId]       = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [viewNgan, setViewNgan]   = useState<Ngan | null>(null)

  // unassigned summary
  const [unassignedSummary, setUnassignedSummary] = useState<{ total: number; byDate: Record<string, number> }>({ total: 0, byDate: {} })

  // trips
  const [dispatchTrips, setDispatchTrips]   = useState<TripItem[]>([])
  const [selectedTrips, setSelectedTrips]   = useState<Set<string>>(new Set())
  const [loadingTrips, setLoadingTrips]     = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadUnassigned = useCallback(async (fid: string, allNgans: Ngan[]) => {
    const assignedUIDs = new Set(allNgans.flatMap(n => n.trips || []))
    const { data } = await supabase
      .from("dispatch_entries")
      .select("rows,ngay")
      .eq("factory_id", fid)
      .order("ngay", { ascending: true })
    const byDate: Record<string, number> = {}
    for (const entry of (data || [])) {
      const dateKey = toISO(entry.ngay) // normalize to YYYY-MM-DD for consistent sorting & display
      for (const row of ((entry.rows || []) as { uid: string }[])) {
        if (!assignedUIDs.has(row.uid)) {
          byDate[dateKey] = (byDate[dateKey] || 0) + 1
        }
      }
    }
    const total = Object.values(byDate).reduce((s, v) => s + v, 0)
    setUnassignedSummary({ total, byDate })
  }, [])

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    let q = supabase.from("ngans").select("*")
      .eq("factory_id", fid)
      .order("ten_ngan", { ascending: true })
    if (filterTT) q = q.eq("trang_thai", filterTT)
    const [{ data }, { data: lotsData }] = await Promise.all([
      q,
      supabase.from("lots").select("ngan_id,tong_kg").eq("factory_id", fid).not("ngan_id", "is", null)
    ])
    const loaded = data || []
    setNgans(loaded)
    const ls: Record<string, number> = {}
    for (const l of lotsData || []) {
      if (l.ngan_id) ls[l.ngan_id] = (ls[l.ngan_id] || 0) + (l.tong_kg || 0)
    }
    setLotStats(ls)
    setLoading(false)
    loadUnassigned(fid, loaded)
  }, [filterTT, loadUnassigned])

  useEffect(() => {
    const fid = localStorage.getItem("erp_factory")
    if (!fid) return
    setFactoryId(fid)
    loadData(fid)
    supabase.from("factories").select("code").eq("id", fid).single().then(({ data: f }) => {
      if (f) setFactoryCode((f as Record<string, unknown>).code as string || "")
    })
  }, [loadData])

  // ── Fetch trips from dispatch ─────────────────────────────────────────────
  const fetchTrips = useCallback(async (ngay_bd: string, ngay_kt: string) => {
    if (!ngay_bd || !ngay_kt || !factoryId) return
    setLoadingTrips(true)
    const { data } = await supabase
      .from("dispatch_entries")
      .select("rows,ngay")
      .eq("factory_id", factoryId)
    // Filter by date range in JS — handles both "YYYY-MM-DD" and "dd/mm/yyyy" stored formats
    const trips: TripItem[] = (data || [])
      .filter((entry: { ngay: string }) => {
        const d = toISO(entry.ngay)
        return d >= ngay_bd && d <= ngay_kt
      })
      .flatMap(
        (entry: { rows: Record<string, string>[]; ngay: string }) =>
          (entry.rows || []).map((r: Record<string, string>) => ({
            uid: r.uid,
            _date: toISO(entry.ngay),
            so_xe: r.so_xe,
            chuyen: Number(r.chuyen) || 1,
            tai_xe: r.tai_xe,
            kl_ct:  +r.kl_ct  || 0, kl_ck:  +r.kl_ck  || 0,
            kl_dct: +r.kl_dct || 0, kl_dck: +r.kl_dck || 0,
            kl_dkt: +r.kl_dkt || 0, kl_dkk: +r.kl_dkk || 0,
            kl_dt:  +r.kl_dt  || 0, kl_dk:  +r.kl_dk  || 0,
            kl_mn:  +r.kl_mn  || 0, kl_mnk: +r.kl_mnk || 0,
          }))
      )
    setDispatchTrips(trips)
    setLoadingTrips(false)
  }, [factoryId])

  // ── Auto-calc KL from selected trips (filtered by loai_nl) ───────────────
  useEffect(() => {
    const sel = dispatchTrips.filter(t => selectedTrips.has(t.uid))
    const loaiNL = form.loai_nl
    const { tuoi, kho } = sel.reduce(
      (acc, t) => {
        const kl = getKLFromTrip(t, loaiNL)
        return { tuoi: acc.tuoi + kl.tuoi, kho: acc.kho + kl.kho }
      },
      { tuoi: 0, kho: 0 }
    )
    setForm(p => ({ ...p, tong_tuoi: tuoi, tong_kho: kho }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrips, dispatchTrips, form.loai_nl])

  // ── Form helpers ──────────────────────────────────────────────────────────
  const updateForm = (patch: Partial<ReturnType<typeof emptyForm>>) => {
    setForm(p => {
      const next = { ...p, ...patch }
      next.ma_ngan = genMaNgan(next)
      return next
    })
  }

  const chungNhanOpts = factoryCode === "cuaparis" ? CHUNG_NHAN_BASE : ["PEFC CS", "Không"]

  const busyPositions = new Set(
    ngans
      .filter(n =>
        (n.trang_thai === "Đang sản xuất" || n.trang_thai === "Chờ sản xuất" || n.trang_thai === "Đang nhận (Cần cập nhật)") &&
        (!editId || n.id !== editId)
      )
      .map(n => n.ten_ngan)
  )
  const availablePositions = ALL_POSITIONS.filter(p => !busyPositions.has(p))

  // ── Filter cards ──────────────────────────────────────────────────────────
  const dcLoaiNL = loaiNLByDC(dayChuyen, factoryCode)
  const filtered = ngans.filter(n => {
    if (!dcLoaiNL.includes(n.loai_nl)) return false
    if (filterTT && n.trang_thai !== filterTT) return false
    if (search &&
      !n.ten_ngan?.toLowerCase().includes(search.toLowerCase()) &&
      !n.ma_ngan?.toLowerCase().includes(search.toLowerCase())
    ) return false
    return true
  })

  const subTerm = dayChuyen === "Mủ tạp" ? "Ngăn" : "Hồ"

  // ── Stats ─────────────────────────────────────────────────────────────────
  const statsCards = [
    {
      label: `Tổng ${subTerm.toLowerCase()}`,
      value: filtered.length.toString(),
      color: "text-slate-700",
      icon: <Warehouse size={20} className="mx-auto mb-1 text-slate-500 opacity-70" />,
    },
    {
      label: "Đang sản xuất",
      value: filtered.filter(n => n.trang_thai === "Đang sản xuất").length.toString(),
      color: "text-emerald-600",
      icon: <Activity size={20} className="mx-auto mb-1 text-emerald-500 opacity-70" />,
    },
    {
      label: "Tổng KL tươi (kg)",
      value: filtered.reduce((s, n) => s + (n.tong_tuoi || 0), 0).toLocaleString(),
      color: "text-blue-600",
      icon: <Droplets size={20} className="mx-auto mb-1 text-blue-500 opacity-70" />,
    },
    {
      label: "Tổng KL khô (kg)",
      value: filtered.reduce((s, n) => s + (n.tong_kho || 0), 0).toLocaleString(),
      color: "text-purple-600",
      icon: <Weight size={20} className="mx-auto mb-1 text-purple-500 opacity-70" />,
    },
  ]

  const curingDays = (ngay_bd: string) => {
    if (!ngay_bd) return null
    return Math.floor((Date.now() - new Date(ngay_bd).getTime()) / 86400000)
  }

  // ── Save / Delete ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!factoryId) return
    setSaving(true)
    const trangThai = deriveTrangThai(form.ngay_bd, form.ngay_kt, form.trang_thai)
    const payload = {
      ...form,
      trang_thai: trangThai,
      factory_id: factoryId,
      ngay_kt: form.ngay_kt || null,
      trips: Array.from(selectedTrips),
    }
    if (editId) {
      await supabase.from("ngans").update(payload).eq("id", editId)
    } else {
      await supabase.from("ngans").insert(payload)
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

  const openAdd = () => {
    const loaiNL = dayChuyen === "Mủ nước" ? "Mủ nước" : "Mủ đông chén"
    const f = emptyForm(loaiNL)
    setForm({ ...f, ma_ngan: genMaNgan(f) })
    setEditId(null)
    setSelectedTrips(new Set())
    setDispatchTrips([])
    setModal("add")
  }

  const openEdit = (n: Ngan) => {
    const f = {
      ma_ngan: n.ma_ngan || "", ten_ngan: n.ten_ngan || "",
      loai_nl: n.loai_nl || "Mủ đông chén", nguon_goc: n.nguon_goc || "NT",
      xu_ly: n.xu_ly || "Xé", chung_nhan: n.chung_nhan || "PEFC CS",
      ngay_bd: n.ngay_bd?.slice(0, 10) || "",
      ngay_kt: n.ngay_kt?.slice(0, 10) || "",
      trang_thai: n.trang_thai || "Đang nhận (Cần cập nhật)",
      tong_tuoi: n.tong_tuoi || 0, tong_kho: n.tong_kho || 0,
      lo_nguon_goc: n.lo_nguon_goc || "",
    }
    setForm(f)
    setEditId(n.id)
    setSelectedTrips(new Set(n.trips || []))
    setDispatchTrips([])
    setModal("edit")
    if (f.ngay_bd && f.ngay_kt) fetchTrips(f.ngay_bd, f.ngay_kt)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Dây chuyền selector */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
        <label className="text-xs font-bold text-slate-600 block mb-1.5">
          Dây chuyền <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-3">
          {(["Mủ tạp", "Mủ nước"] as const).map(dc => (
            <button key={dc} onClick={() => { setDayChuyen(dc); setFilterTT("") }}
              className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
                dayChuyen === dc
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
              }`}>
              {dc}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-1">
          {dayChuyen === "Mủ tạp" ? "→ Ngăn lưu" : "→ Hồ chứa"}
        </p>
      </div>

      {/* Xe chưa vào ngăn */}
      {unassignedSummary.total > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Truck size={15} className="text-amber-600 shrink-0" />
            <span className="text-sm font-bold text-amber-800">
              Xe chưa vào {subTerm.toLowerCase()}: {unassignedSummary.total} chuyến
            </span>
          </div>
          <p className="text-xs text-amber-700 leading-relaxed">
            {Object.entries(unassignedSummary.byDate)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, cnt]) => `${fmtDate(date)}: ${cnt}`)
              .join(" • ")}
          </p>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">
            {dayChuyen === "Mủ tạp" ? "Ngăn lưu" : "Hồ chứa"}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý {dayChuyen === "Mủ tạp" ? "ngăn lưu" : "hồ chứa"} mủ cao su
          </p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all btn-press">
          <Plus size={16} /> Thêm {subTerm.toLowerCase()}
        </button>
      </div>

      {/* Scrollable content */}
      <div ref={revealRef} className="scroll-reveal">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
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
            <Search size={15} className="text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={`Tìm tên ${subTerm.toLowerCase()}, mã...`}
              className="flex-1 text-sm outline-none" />
          </div>
          <select value={filterTT} onChange={e => setFilterTT(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400">
            <option value="">Tất cả trạng thái</option>
            {TRANG_THAI_OPTS.map(t => <option key={t}>{t}</option>)}
          </select>
          {(search || filterTT) && (
            <button onClick={() => { setSearch(""); setFilterTT("") }}
              className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-500">
              <X size={14} /> Xóa lọc
            </button>
          )}
        </div>

        {/* Card grid */}
        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
            <Warehouse size={40} className="mx-auto mb-3 opacity-30" />
            <p>Không có {subTerm.toLowerCase()} nào</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {filtered.map(n => {
              const days  = curingDays(n.ngay_bd)
              const ready = days !== null && days >= 21
              const hs      = headerStyle(n.trang_thai)
              const tpKg    = lotStats[n.id] || 0
              const tpPct   = n.tong_kho > 0 ? (tpKg / n.tong_kho) * 100 : 0

              return (
                <div key={n.id} className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden hover-lift">
                  {/* Card header */}
                  <div className={`bg-gradient-to-r ${hs.grad} px-4 py-3 border-b border-slate-200 flex items-center justify-between`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Warehouse size={16} className={`${hs.icon} shrink-0`} />
                      <span className="font-extrabold text-slate-800 text-base truncate">{n.ten_ngan}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold shrink-0 ${badgeClass(n.trang_thai)}`}>
                        {n.trang_thai}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button onClick={() => { setViewNgan(n); setModal("view") }}
                        className="p-1.5 hover:bg-white/60 rounded-lg text-slate-500 transition-colors">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => openEdit(n)}
                        className="p-1.5 hover:bg-white/60 rounded-lg text-blue-500 transition-colors">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => setDelConfirm(n.id)}
                        className="p-1.5 hover:bg-white/60 rounded-lg text-red-400 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="p-4 space-y-0">
                    <div className="flex items-start gap-2 py-2 border-b border-dashed border-slate-200">
                      <Tag size={14} className="text-slate-400 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Mã {subTerm.toLowerCase()}</span>
                      <span className="text-xs font-semibold text-slate-700 break-all leading-relaxed">{n.ma_ngan || "—"}</span>
                    </div>
                    <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                      <Layers size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Loại NL</span>
                      <span className="text-sm font-semibold text-slate-800">{n.loai_nl}</span>
                    </div>
                    <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                      <MapPin size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Nguồn · Xử lý</span>
                      <span className="text-sm font-semibold text-slate-800">{n.nguon_goc} · {n.xu_ly}</span>
                    </div>
                    <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                      <ShieldCheck size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Chứng nhận</span>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">{n.chung_nhan}</span>
                    </div>
                    <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
                      <Weight size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">KL tươi / khô</span>
                      <span className="text-sm font-semibold text-slate-800">
                        {(n.tong_tuoi || 0).toLocaleString()} / <span className="text-emerald-700">{(n.tong_kho || 0).toLocaleString()}</span> kg
                      </span>
                    </div>
                    <div className="flex items-start gap-2 py-2 border-b border-dashed border-slate-200">
                      <BarChart2 size={14} className="text-slate-400 shrink-0 mt-1" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">TP / QK {subTerm.toLowerCase()}</span>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-slate-800">
                            {n.tong_kho > 0 ? `${tpPct.toFixed(1)}%` : "—"}
                          </span>
                          {n.tong_kho > 0 && (
                            <span className="text-xs text-slate-400">
                              ({tpKg.toLocaleString()} / {(n.tong_kho || 0).toLocaleString()} kg)
                            </span>
                          )}
                        </div>
                        {n.tong_kho > 0 && (
                          <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-1 bg-blue-400 rounded-full transition-all"
                              style={{ width: `${Math.min(tpPct, 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 py-2">
                      <Activity size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-500 w-24 shrink-0">Ngày lưu ủ</span>
                      <span className="text-sm font-semibold text-slate-800">
                        {fmtDate(n.ngay_bd)}{n.ngay_kt ? ` → ${fmtDate(n.ngay_kt)}` : ""}
                        {days !== null && (
                          <span className={`ml-1 text-xs ${ready ? "text-emerald-600" : "text-amber-600"}`}>
                            ({days} ngày{ready ? " ✓" : ""})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Add / Edit Modal ───────────────────────────────────────────────── */}
      {(modal === "add" || modal === "edit") && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <h2 className="text-lg font-extrabold text-slate-800">
                {modal === "add" ? `Tạo ${subTerm.toLowerCase()} mới` : `Sửa ${subTerm.toLowerCase()}`}
              </h2>
              <button onClick={() => setModal(null)} className="p-2 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Row 1: Vị trí · Loại NL · Nguồn gốc */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Vị trí {subTerm.toLowerCase()} <span className="text-red-500">*</span>
                  </label>
                  <input
                    list="positions-list"
                    value={form.ten_ngan}
                    onChange={e => updateForm({ ten_ngan: e.target.value.slice(0, 10) })}
                    placeholder="-- Chọn --"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                  <datalist id="positions-list">
                    {availablePositions.map(p => <option key={p} value={p} />)}
                  </datalist>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại nguyên liệu</label>
                  <select value={form.loai_nl} onChange={e => updateForm({ loai_nl: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {loaiNLByDC(dayChuyen, factoryCode).map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Nguồn gốc</label>
                  <select value={form.nguon_goc} onChange={e => updateForm({ nguon_goc: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {NGUON_GOC_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 2: Xử lý · Chứng nhận */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Xử lý</label>
                  <select value={form.xu_ly} onChange={e => updateForm({ xu_ly: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {XU_LY_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Chứng nhận</label>
                  <select value={form.chung_nhan} onChange={e => updateForm({ chung_nhan: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {chungNhanOpts.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 3: Ngày bắt đầu · Ngày kết thúc */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày bắt đầu (bắt buộc)</label>
                  <input type="date" value={form.ngay_bd}
                    onChange={e => {
                      updateForm({ ngay_bd: e.target.value })
                      fetchTrips(e.target.value, form.ngay_kt)
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày kết thúc (tùy chọn)</label>
                  <input type="date" value={form.ngay_kt}
                    onChange={e => {
                      updateForm({ ngay_kt: e.target.value })
                      fetchTrips(form.ngay_bd, e.target.value)
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                </div>
              </div>

              {/* Trips from Điều xe */}
              {form.ngay_bd && form.ngay_kt && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-200">
                    <div className="flex items-center gap-2">
                      <Truck size={14} className="text-slate-500" />
                      <span className="text-xs font-bold text-slate-700">
                        Chuyến xe từ Điều xe ({fmtDate(form.ngay_bd)} → {fmtDate(form.ngay_kt)})
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedTrips(new Set(dispatchTrips.map(t => t.uid)))}
                        className="text-xs px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-lg transition-colors">
                        Chọn tất cả
                      </button>
                      <button
                        onClick={() => setSelectedTrips(new Set())}
                        className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg transition-colors">
                        Bỏ tất cả
                      </button>
                    </div>
                  </div>

                  {loadingTrips ? (
                    <div className="p-6 text-center text-slate-400 text-sm">Đang tải chuyến xe...</div>
                  ) : dispatchTrips.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-sm">
                      Không có chuyến xe trong khoảng ngày này
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
                          <tr>
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 text-left text-slate-500 font-bold">Ngày</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-bold">Xe</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-bold">Chuyến</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-bold">Tài xế</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-bold">KL tươi</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-bold">KL khô</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {dispatchTrips.map(t => {
                            const checked = selectedTrips.has(t.uid)
                            const kl = getKLFromTrip(t, form.loai_nl)
                            return (
                              <tr key={t.uid}
                                onClick={() => {
                                  setSelectedTrips(prev => {
                                    const next = new Set(prev)
                                    checked ? next.delete(t.uid) : next.add(t.uid)
                                    return next
                                  })
                                }}
                                className={`cursor-pointer transition-colors ${checked ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
                                <td className="px-3 py-2">
                                  <input type="checkbox" readOnly checked={checked}
                                    className="accent-emerald-600 cursor-pointer" />
                                </td>
                                <td className="px-3 py-2 text-slate-600">
                                  {new Date(t._date).toLocaleDateString("vi-VN")}
                                </td>
                                <td className="px-3 py-2 font-bold text-slate-800">{t.so_xe}</td>
                                <td className="px-3 py-2 text-slate-600">C{t.chuyen}</td>
                                <td className="px-3 py-2 text-slate-600">{t.tai_xe}</td>
                                <td className="px-3 py-2 text-right font-semibold text-amber-600">
                                  {kl.tuoi.toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-amber-600">
                                  {kl.kho.toLocaleString()}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* KL tươi / khô — read-only, tự tính từ xe được chọn */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    KL tươi (kg) <span className="text-emerald-600 font-normal">(tự tính)</span>
                  </label>
                  <div className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-700 font-semibold">
                    {form.tong_tuoi.toLocaleString("vi-VN")}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    KL khô (kg) <span className="text-emerald-600 font-normal">(tự tính)</span>
                  </label>
                  <div className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-700 font-semibold">
                    {form.tong_kho.toLocaleString("vi-VN")}
                  </div>
                </div>
              </div>

              {/* Mã ngăn (auto-generated, read-only) */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Mã {subTerm.toLowerCase()} (tự sinh)
                </label>
                <div className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-700 font-mono break-all">
                  {form.ma_ngan || "—"}
                </div>
              </div>

              {/* Trạng thái (read-only, tự tính từ ngày) */}
              <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center gap-2">
                <span className="text-xs text-slate-500">Trạng thái:</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${badgeClass(deriveTrangThai(form.ngay_bd, form.ngay_kt, form.trang_thai))}`}>
                  {deriveTrangThai(form.ngay_bd, form.ngay_kt, form.trang_thai)}
                </span>
                <span className="text-xs text-slate-400">(tự động)</span>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setModal(null)}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-50">
                {saving ? "Đang lưu..." : modal === "add" ? `Tạo ${subTerm.toLowerCase()}` : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View detail modal ──────────────────────────────────────────────── */}
      {modal === "view" && viewNgan && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className={`bg-gradient-to-r ${headerStyle(viewNgan.trang_thai).grad} border-b border-slate-200 px-6 py-4 flex items-center justify-between`}>
              <div className="flex items-center gap-2">
                <Warehouse size={18} className={headerStyle(viewNgan.trang_thai).icon} />
                <h2 className="text-lg font-extrabold text-slate-800">{viewNgan.ten_ngan}</h2>
              </div>
              <button onClick={() => setModal(null)} className="p-2 hover:bg-white/60 rounded-xl">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-0 text-sm">
              {([
                [`Mã ${subTerm.toLowerCase()}`, viewNgan.ma_ngan],
                ["Loại NL",    viewNgan.loai_nl],
                ["Nguồn gốc",  viewNgan.nguon_goc],
                ["Xử lý",      viewNgan.xu_ly],
                ["Chứng nhận", viewNgan.chung_nhan],
                ["Ngày BD",    fmtDate(viewNgan.ngay_bd)],
                ["Ngày KT",    fmtDate(viewNgan.ngay_kt)],
                ["KL tươi",    (viewNgan.tong_tuoi || 0).toLocaleString() + " kg"],
                ["KL khô",     (viewNgan.tong_kho  || 0).toLocaleString() + " kg"],
                ["TP / QK",    viewNgan.tong_kho > 0
                  ? `${((lotStats[viewNgan.id] || 0) / viewNgan.tong_kho * 100).toFixed(1)}% (${(lotStats[viewNgan.id] || 0).toLocaleString()} kg)`
                  : "—"],
                ["Số chuyến",  (viewNgan.trips || []).length + " chuyến"],
                ["Trạng thái", viewNgan.trang_thai],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between py-2 border-b border-dashed border-slate-200 last:border-0">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-semibold text-slate-700 text-right max-w-[60%]">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────────────────────── */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-extrabold text-slate-800 mb-2">Xác nhận xóa?</h3>
            <p className="text-sm text-slate-500 mb-5">{subTerm} này sẽ bị xóa vĩnh viễn.</p>
            <div className="flex gap-3">
              <button onClick={() => setDelConfirm(null)}
                className="flex-1 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button onClick={() => handleDelete(delConfirm)}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-md">
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
