"use client"
import { useState, useEffect, useCallback, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import { Truck, Plus, Eye, ChevronRight, X, Search, Calendar, Edit2, Trash2, Check, MapPin } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type DxRow = {
  uid: string
  _date: string
  so_xe: string
  chuyen: number
  tai_xe: string
  diem_gn: string[]
  phien: string[]
  lo_thu_hoach: string[]
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

// ─── Master Data ──────────────────────────────────────────────────────────────
const FACTORY_LAT = 12.581870
const FACTORY_LNG = 105.497249

type VehicleInfo = { key: string; ten: string; loai: string; ma_hieu: string; tai_xe: string }
const VEHICLES: VehicleInfo[] = [
  { key:"xe001", ten:"Cozon nội bộ 1B",      loai:"Cozon nội bộ",     ma_hieu:"1B",  tai_xe:"Sreng Seng Hoang" },
  { key:"xe002", ten:"Cozon nội bộ 2B",      loai:"Cozon nội bộ",     ma_hieu:"2B",  tai_xe:"Young Sok Khum" },
  { key:"xe003", ten:"Cozon nội bộ 3B",      loai:"Cozon nội bộ",     ma_hieu:"3B",  tai_xe:"Uk SaRath" },
  { key:"xe004", ten:"Cozon vận chuyển 4B",  loai:"Cozon vận chuyển", ma_hieu:"4B",  tai_xe:"Mao Borey" },
  { key:"xe005", ten:"Cozon vận chuyển 5B",  loai:"Cozon vận chuyển", ma_hieu:"5B",  tai_xe:"Seng Sam Nang" },
  { key:"xe006", ten:"Cozon vận chuyển 6B",  loai:"Cozon vận chuyển", ma_hieu:"6B",  tai_xe:"Kum Dat" },
  { key:"xe007", ten:"Cozon vận chuyển 7B",  loai:"Cozon vận chuyển", ma_hieu:"7B",  tai_xe:"Mao Borey" },
  { key:"xe008", ten:"Cozon vận chuyển 8B",  loai:"Cozon vận chuyển", ma_hieu:"8B",  tai_xe:"Nut An" },
  { key:"xe009", ten:"Cozon vận chuyển 9B",  loai:"Cozon vận chuyển", ma_hieu:"9B",  tai_xe:"Ren Makara" },
  { key:"xe010", ten:"ISUZU 1A",  loai:"Isuzu vận chuyển", ma_hieu:"1A",  tai_xe:"Nut An" },
  { key:"xe011", ten:"ISUZU 2A",  loai:"Isuzu vận chuyển", ma_hieu:"2A",  tai_xe:"Moa Morn" },
  { key:"xe012", ten:"ISUZU 3A",  loai:"Isuzu vận chuyển", ma_hieu:"3A",  tai_xe:"Men Sam Nang" },
  { key:"xe013", ten:"ISUZU 4A",  loai:"Isuzu vận chuyển", ma_hieu:"4A",  tai_xe:"Seng Chhun Ly" },
  { key:"xe014", ten:"ISUZU 5A",  loai:"Isuzu vận chuyển", ma_hieu:"5A",  tai_xe:"Seng Sam Nang" },
  { key:"xe015", ten:"ISUZU 6A",  loai:"Isuzu vận chuyển", ma_hieu:"6A",  tai_xe:"Yim Kun" },
  { key:"xe016", ten:"ISUZU 7A",  loai:"Isuzu vận chuyển", ma_hieu:"7A",  tai_xe:"Vorn RoThy" },
  { key:"xe017", ten:"ISUZU 8A",  loai:"Isuzu vận chuyển", ma_hieu:"8A",  tai_xe:"Vorn Rany" },
  { key:"xe018", ten:"ISUZU 9A",  loai:"Isuzu vận chuyển", ma_hieu:"9A",  tai_xe:"Yath Ry" },
  { key:"xe019", ten:"ISUZU 10A", loai:"Isuzu vận chuyển", ma_hieu:"10A", tai_xe:"Chhov Sok Khum" },
  { key:"xe020", ten:"ISUZU 11A", loai:"Isuzu vận chuyển", ma_hieu:"11A", tai_xe:"Say Chom Rong" },
  { key:"xe021", ten:"ISUZU 12A", loai:"Isuzu vận chuyển", ma_hieu:"12A", tai_xe:"Sok Thy" },
  { key:"xe022", ten:"ISUZU 13A", loai:"Isuzu vận chuyển", ma_hieu:"13A", tai_xe:"Yim Kun" },
  { key:"xe023", ten:"ISUZU 14A", loai:"Isuzu vận chuyển", ma_hieu:"14A", tai_xe:"Chhoun Khet" },
  { key:"xe024", ten:"ISUZU 15A", loai:"Isuzu vận chuyển", ma_hieu:"15A", tai_xe:"Ren Makara" },
  { key:"xe025", ten:"ISUZU 16A", loai:"Isuzu vận chuyển", ma_hieu:"16A", tai_xe:"Nhorm Pov PaNha" },
  { key:"xe026", ten:"ISUZU 17A", loai:"Isuzu vận chuyển", ma_hieu:"17A", tai_xe:"Phorn Khim" },
  { key:"xe027", ten:"ISUZU 18A", loai:"Isuzu vận chuyển", ma_hieu:"18A", tai_xe:"Choun Khea" },
  { key:"xe028", ten:"ISUZU 19A", loai:"Isuzu vận chuyển", ma_hieu:"19A", tai_xe:"Sun Seng Ly" },
  { key:"xe029", ten:"ISUZU 20A", loai:"Isuzu vận chuyển", ma_hieu:"20A", tai_xe:"Yoeng Nha" },
  { key:"xe030", ten:"ISUZU 21A", loai:"Isuzu vận chuyển", ma_hieu:"21A", tai_xe:"Chhun Khea" },
  { key:"xe031", ten:"ISUZU 22A", loai:"Isuzu vận chuyển", ma_hieu:"22A", tai_xe:"Seng Sam Nang" },
  { key:"xe032", ten:"ISUZU 23A", loai:"Isuzu vận chuyển", ma_hieu:"23A", tai_xe:"Phun Nang" },
  { key:"xe033", ten:"Xúc SX 01", loai:"Xúc sản xuất",     ma_hieu:"X01", tai_xe:"Uk SaRath" },
  { key:"xe034", ten:"Xúc SX 02", loai:"Xúc sản xuất",     ma_hieu:"X02", tai_xe:"Pheap Phin" },
  { key:"xe035", ten:"Xúc Biomass",loai:"Xúc Biomass",     ma_hieu:"X03", tai_xe:"Anh 3 bảo" },
  { key:"xe036", ten:"Nâng 01",   loai:"Nâng sản xuất",    ma_hieu:"N01", tai_xe:"Ban So Sieng" },
  { key:"xe037", ten:"Nâng 02",   loai:"Nâng sản xuất",    ma_hieu:"N02", tai_xe:"Keo Sarath" },
  { key:"xe038", ten:"Ford",      loai:"Ford bán tải",     ma_hieu:"XF",  tai_xe:"Bao Thea" },
]

// Điểm giao nhận with phiên data
type DiemGN = { ma_lo: string; lat: number; lng: number; phien_a: string[]; phien_b: string[]; phien_c: string[]; phien_d: string[] }
const DIEM_GN: DiemGN[] = [
  { ma_lo:"B5",  lat:12.632736, lng:105.495549, phien_a:["A3","A4","A5","A6","A7","B4","B5","B6","B7","C4","C5D","C5T","D4","D5D","D5T","E4","E5"], phien_b:["B4","C4","D4","E4"], phien_c:["E5","D5D","C5D","C5T"], phien_d:["A3","A4","A5"] },
  { ma_lo:"C16", lat:12.628052, lng:105.546290, phien_a:["A14","A15","A16","A17","A18","B14","B15","B16","B17","B18","C14","C15D","C15T","C16","C17","C18"], phien_b:["A14","B15","B14","C14"], phien_c:["A15","A16","A17","A18"], phien_d:["B18","B17","C17","C18"] },
  { ma_lo:"C17", lat:12.628048, lng:105.550884, phien_a:["A14","A15","A16","A17","A18","B14","B15","B16","B17","B18","C14","C15D","C15T","C16","C17","C18"], phien_b:["A14","B15","B14","C14"], phien_c:["A15","A16","A17","A18"], phien_d:["B18","B17","C17","C18"] },
  { ma_lo:"D9",  lat:12.623630, lng:105.513983, phien_a:["A8","A9","A10","B8","B9","B10","C7","C8","C9","C10","D6","D7","D8","D10"], phien_b:["A8","A9","A10","B8"], phien_c:["B9","B10","C9","C10"], phien_d:["D6","D7","C6","C7"] },
  { ma_lo:"D11", lat:12.623617, lng:105.523006, phien_a:["A11","A12","A13","B11","B12","B13","C11","C12","C13","D11","D12","E11","E12","F11","F12"], phien_b:["A11","A12","B11","B12"], phien_c:["A13","B13","C13","D12"], phien_d:["C11","C12","D11","F12"] },
  { ma_lo:"E1",  lat:12.619189, lng:105.477754, phien_a:["A1","A2","B1","B2","B3","C1","C2","C3","D1","D2","D3","E1","E2D","E2T","E3","F1","F2","F3D","F3T"], phien_b:["A1","A2","B1","B2","B3"], phien_c:["C1","C2","C3","D1"], phien_d:["D2","E1","E2D","E2T","E3"] },
  { ma_lo:"F16", lat:12.614454, lng:105.546214, phien_a:["D13","D14","D15S","D15T","D16","D17","D18","E13","E14","E15","E16","E17","E18","F13","F14","F15"], phien_b:["D13","D14","D15S","D15T","D16","D17"], phien_c:["D17","D18","E16","E17","E18"], phien_d:["E16","E14","E15","E13"] },
  { ma_lo:"G3",  lat:12.610155, lng:105.486360, phien_a:["F4","F5","G1","G2","G3","G4","G5","H1","H2","H2D","H3","H3D","H4T","H4S","H5","H6T","H6S","I3","I4","I5","J4"], phien_b:["G1","G2","G3","H1","H2"], phien_c:["H3","H4T","G4","F4"], phien_d:["F5","G5","G6"] },
  { ma_lo:"G5",  lat:12.610102, lng:105.495616, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"G8",  lat:12.609511, lng:105.509254, phien_a:["E6","E7","E8","E9","F6D","F6T","F7","F8","F9D","F9T","G7","G8","G9","H8","H9"], phien_b:["E6","E7","E8","F6D","F6T"], phien_c:["D9","E9","F9D","F9T","F8"], phien_d:["F7","G7","G8","G9"] },
  { ma_lo:"G9",  lat:12.610070, lng:105.513951, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"H11", lat:12.605554, lng:105.524477, phien_a:["F10","G10","G11","G12","H10","H11","H12","I10","I11","I12","J13","J14"], phien_b:["F10","G10","H10"], phien_c:["G11","H11","I11"], phien_d:["G12","H12","J14"] },
  { ma_lo:"I16", lat:12.600919, lng:105.546180, phien_a:["F16","F17","F18","G17","G18","H16","H17","H18","I16","I17","I18","J16","J17","J18"], phien_b:["F16","F17","F18","G17"], phien_c:["G17","G18","H18","H17"], phien_d:["H17","H16","I16","I17","I18"] },
  { ma_lo:"J7",  lat:12.596465, lng:105.504800, phien_a:["H7","I6","I7","I8","I9","J5","J6T","J6S","J7","J8","J9","K5","K6","K7","K8","K9D","K9T","L6T","L7T","L7S","L8T","L8S"], phien_b:["H7","I7","I8","I9"], phien_c:["I6","J5","J6T","J6S","K5","K6","L6T"], phien_d:["J7","J8","J9","I9"] },
  { ma_lo:"K10", lat:12.591972, lng:105.518578, phien_a:["M9D","M9T","M10","M12","L9","L10","L11","L12","K9D","K9T","K10","K11","K12B","K12N","J10","J11","J12"], phien_b:["M9D","M9T","M10","M11","L9","L10","L11","K9D","K9T"], phien_c:["K10","K11","L11","J10"], phien_d:["J11","J12","L12","K12B","K12N"] },
  { ma_lo:"L2",  lat:12.587526, lng:105.481750, phien_a:["I1","I2","J1T","J1D","J2","K1","K2","K3","K4","K5D","K5T","L1","L2","L3","L4","L5D","M1","M2","M3","N1","N2"], phien_b:["I1","I2","J1T","J1D","J2","K1"], phien_c:["K2","K3","K4","K5D","K5T","L4","L5T","L3"], phien_d:["L1","L2","L3","M3"] },
  { ma_lo:"L12", lat:12.587459, lng:105.526876, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"L14", lat:12.586751, lng:105.537313, phien_a:["N13","N14","N15","N16","M13S","M13T","M14","M15","M16","L14","L15","L16","K15","K16"], phien_b:["N14","N15","N16"], phien_c:["N13","M13S","M13T","M14","L14","L15"], phien_d:["L15","M15","M16"] },
  { ma_lo:"C2",  lat:12.628201, lng:105.481744, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
]

const XU_LY_OPTS = ["Xé","Cán"]

// ─── Manhattan distance calc ──────────────────────────────────────────────────
function calcManhattanKm(stops: string[]) {
  if (stops.length === 0) return 0
  const coords: [number,number][] = []
  for (const s of stops) {
    const d = DIEM_GN.find(g => g.ma_lo === s)
    if (d) coords.push([d.lat, d.lng])
  }
  if (coords.length === 0) return 0

  let total = 0
  // Factory → first stop
  total += Math.abs(FACTORY_LAT - coords[0][0]) + Math.abs(FACTORY_LNG - coords[0][1])
  // Between stops
  for (let i = 1; i < coords.length; i++) {
    total += Math.abs(coords[i][0] - coords[i-1][0]) + Math.abs(coords[i][1] - coords[i-1][1])
  }
  // Last stop → factory
  total += Math.abs(coords[coords.length-1][0] - FACTORY_LAT) + Math.abs(coords[coords.length-1][1] - FACTORY_LNG)

  return Math.round(total * 111.32 * 10) / 10  // degrees to km
}

// ─── Auto-calc KL khô ────────────────────────────────────────────────────────
function autoCalcKLK(kl_tuoi: string, drc: string): string {
  const t = parseFloat(kl_tuoi); const d = parseFloat(drc)
  if (isNaN(t) || isNaN(d)) return ""
  return (t * d / 100).toFixed(1)
}

const emptyRow = (): DxRow => ({
  uid: `r_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
  _date: new Date().toISOString().slice(0,10),
  so_xe: "", chuyen: 1, tai_xe: "",
  diem_gn: [], phien: [], lo_thu_hoach: [],
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

  // ── Update row field with auto-calc ───────────────────────────────────────
  const updateRow = (idx: number, field: keyof DxRow, val: unknown) => {
    setFormRows(prev => prev.map((r,i) => {
      if (i !== idx) return r
      const next = { ...r, [field]: val }

      // Auto-fill tài xế khi chọn xe
      if (field === "so_xe") {
        const v = VEHICLES.find(x => x.ma_hieu === val)
        if (v) next.tai_xe = v.tai_xe
      }

      // Auto-calc KL khô
      if (field === "kl_dct" || field === "drc_dc") {
        next.kl_dck = autoCalcKLK(field === "kl_dct" ? val as string : next.kl_dct, field === "drc_dc" ? val as string : next.drc_dc)
      }
      if (field === "kl_dt" || field === "drc_d") {
        next.kl_dk = autoCalcKLK(field === "kl_dt" ? val as string : next.kl_dt, field === "drc_d" ? val as string : next.drc_d)
      }
      if (field === "kl_dkt" || field === "drc_dk") {
        next.kl_dkk = autoCalcKLK(field === "kl_dkt" ? val as string : next.kl_dkt, field === "drc_dk" ? val as string : next.drc_dk)
      }

      // Auto-calc khoảng cách Manhattan when lộ trình changes
      if (field === "lo_trinh" || field === "diem_gn") {
        const stops = field === "lo_trinh" ? val as string[] : next.lo_trinh
        next.so_km = calcManhattanKm(stops.length > 0 ? stops : (next.diem_gn || []))
      }

      // Auto-fill lô thu hoạch from phiên
      if (field === "phien" || field === "diem_gn") {
        const phiens = field === "phien" ? val as string[] : next.phien
        const dgns = field === "diem_gn" ? val as string[] : next.diem_gn
        const lots: string[] = []
        for (const dgn of dgns) {
          const d = DIEM_GN.find(g => g.ma_lo === dgn)
          if (!d) continue
          for (const p of phiens) {
            const key = `phien_${p.toLowerCase()}` as keyof DiemGN
            const pLots = d[key]
            if (Array.isArray(pLots)) lots.push(...(pLots as string[]))
          }
        }
        next.lo_thu_hoach = [...new Set(lots)]
      }

      return next
    }))
  }

  // Toggle phien for a row
  const togglePhien = (idx: number, p: string) => {
    const row = formRows[idx]
    const cur = row.phien || []
    const next = cur.includes(p) ? cur.filter(x=>x!==p) : [...cur, p]
    updateRow(idx, "phien", next)
  }

  // Toggle diem_gn for a row
  const toggleDiemGN = (idx: number, d: string) => {
    const row = formRows[idx]
    const cur = row.diem_gn || []
    const next = cur.includes(d) ? cur.filter(x=>x!==d) : [...cur, d]
    updateRow(idx, "diem_gn", next)
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
                {["Ngày","Chứng nhận","Số xe","Tổng KL tươi","Tổng KL khô",""].map(h => (
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
                      {totalKLT.toLocaleString()} kg
                    </td>
                    <td className="px-4 py-3 text-slate-600"
                      onClick={() => { setSelected(entry); setView("detail") }}>
                      {totalKLK.toLocaleString()} kg
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
            <p className="text-sm text-slate-500 mb-5">Bảng phân xe này sẽ bị xóa vĩnh viễn.</p>
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
        <button onClick={() => setView("list")} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X size={18}/></button>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold text-slate-800">Bảng phân xe — {selected.ngay}</h1>
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
              {["Xe","Chuyến","Tài xế","Điểm GN","Phiên","Lô thu hoạch","Xử lý","KM","KL tươi","DRC%","KL khô"].map(h => (
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
                <td className="px-3 py-2.5 text-slate-500 text-[10px] max-w-48 truncate">{Array.isArray(row.lo_thu_hoach) ? row.lo_thu_hoach.join(", ") : row.lo_thu_hoach}</td>
                <td className="px-3 py-2.5 text-slate-600">{row.xu_ly}</td>
                <td className="px-3 py-2.5 text-slate-600">{row.so_km} km</td>
                <td className="px-3 py-2.5 font-semibold text-slate-700">{row.kl_dct}</td>
                <td className="px-3 py-2.5 text-slate-600">{row.drc_dc}%</td>
                <td className="px-3 py-2.5 font-semibold text-emerald-700">{row.kl_dck}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 border-t-2 border-slate-200">
            <tr>
              <td colSpan={8} className="px-3 py-2.5 font-bold text-slate-600">TỔNG</td>
              <td className="px-3 py-2.5 font-bold text-slate-700">
                {(selected.rows||[]).reduce((s,r)=>s+(parseFloat(r.kl_dct)||0),0).toLocaleString()}
              </td>
              <td/>
              <td className="px-3 py-2.5 font-bold text-emerald-700">
                {(selected.rows||[]).reduce((s,r)=>s+(parseFloat(r.kl_dck)||0),0).toLocaleString()}
              </td>
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
          className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X size={18}/></button>
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
      <div className="space-y-3 mb-4">
        {formRows.map((row, idx) => (
          <div key={row.uid} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500">Xe #{idx+1}</span>
              <button onClick={() => setFormRows(prev => prev.filter((_,i) => i!==idx))}
                className="p-1 text-red-400 hover:bg-red-50 rounded transition-colors"><X size={14}/></button>
            </div>
            {/* Row 1: Xe, Tài xế, Chuyến, Xử lý */}
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Số xe</label>
                <select value={row.so_xe} onChange={e => updateRow(idx,"so_xe",e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400">
                  <option value="">-- Chọn --</option>
                  {VEHICLES.map(v => <option key={v.key} value={v.ma_hieu}>{v.ma_hieu} — {v.loai}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Tài xế</label>
                <input value={row.tai_xe} onChange={e => updateRow(idx,"tai_xe",e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Chuyến</label>
                <select value={row.chuyen} onChange={e => updateRow(idx,"chuyen",+e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400">
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Xử lý</label>
                <select value={row.xu_ly} onChange={e => updateRow(idx,"xu_ly",e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400">
                  {XU_LY_OPTS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
            {/* Row 2: Điểm GN + Phiên */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Điểm giao nhận</label>
                <div className="flex flex-wrap gap-1 min-h-[28px] p-1.5 border border-slate-200 rounded-lg bg-slate-50">
                  {DIEM_GN.map(d => (
                    <button key={d.ma_lo} onClick={() => toggleDiemGN(idx, d.ma_lo)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                        (row.diem_gn||[]).includes(d.ma_lo)
                          ? "bg-amber-500 text-white"
                          : "bg-white text-slate-500 hover:bg-slate-100 border border-slate-200"
                      }`}>{d.ma_lo}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Phiên</label>
                <div className="flex gap-2 items-center">
                  {["A","B","C","D"].map(p => (
                    <button key={p} onClick={() => togglePhien(idx, p)}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        (row.phien||[]).includes(p)
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}>Phiên {p}</button>
                  ))}
                </div>
              </div>
            </div>
            {/* Row 3: Lô thu hoạch (auto-fill) */}
            {(row.lo_thu_hoach||[]).length > 0 && (
              <div className="mb-3">
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Lô thu hoạch (tự động)</label>
                <div className="flex flex-wrap gap-1 p-1.5 border border-emerald-200 rounded-lg bg-emerald-50 max-h-16 overflow-y-auto">
                  {(row.lo_thu_hoach||[]).map((l,li) => (
                    <span key={li} className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-semibold">{l}</span>
                  ))}
                </div>
              </div>
            )}
            {/* Row 4: Lộ trình + KM */}
            <div className="grid grid-cols-5 gap-3 mb-3">
              <div className="col-span-4">
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Lộ trình (mã lô xe đi qua)</label>
                <input value={(row.lo_trinh||[]).join(",")} onChange={e => {
                  const val = e.target.value.split(",").map(s=>s.trim()).filter(Boolean)
                  updateRow(idx,"lo_trinh",val)
                }} placeholder="E1,G3" className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Km (auto)</label>
                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700">
                  <MapPin size={12} className="text-emerald-500"/> {row.so_km} km
                </div>
              </div>
            </div>
            {/* Row 5: KL tươi, DRC, KL khô — auto-calc */}
            <div className="grid grid-cols-6 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">KL tươi</label>
                <input value={row.kl_dct} onChange={e => updateRow(idx,"kl_dct",e.target.value)}
                  placeholder="0" className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">DRC%</label>
                <input value={row.drc_dc} onChange={e => updateRow(idx,"drc_dc",e.target.value)}
                  placeholder="49.5" className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-[10px] font-bold text-emerald-600 block mb-1">KL khô ✓</label>
                <input value={row.kl_dck} readOnly
                  className="w-full px-2 py-1.5 border border-emerald-200 rounded-lg text-xs bg-emerald-50 text-emerald-700 font-bold"/>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">KL dập tươi</label>
                <input value={row.kl_dkt} onChange={e => updateRow(idx,"kl_dkt",e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">DRC dập%</label>
                <input value={row.drc_dk} onChange={e => updateRow(idx,"drc_dk",e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
              </div>
              <div>
                <label className="text-[10px] font-bold text-emerald-600 block mb-1">KL dập khô ✓</label>
                <input value={row.kl_dkk} readOnly
                  className="w-full px-2 py-1.5 border border-emerald-200 rounded-lg text-xs bg-emerald-50 text-emerald-700 font-bold"/>
              </div>
            </div>
          </div>
        ))}

        {/* Add row button */}
        <button onClick={() => setFormRows(prev => [...prev, emptyRow()])}
          className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-sm font-bold text-slate-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors">
          + Thêm xe
        </button>
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
