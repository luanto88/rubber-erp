"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { ClipboardCheck, Plus, X, Search, ChevronDown, ChevronUp, Edit2, Trash2, Check, AlertTriangle, BarChart2, XCircle } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type Samples = {
  tap_chat: number[]
  tro: number[]
  bay_hoi: number[]
  nito: number[]
  po: number[]
  pri: number[]
  mooney: number[]
  mau_sac: number[]
}

type QcResult = {
  id: string
  factory_id: string
  lot_id: string | null
  ma_lo: string
  pkn: number
  ngay_kn: string
  ngay_sx: string
  chung_loai: string
  loai_csr: string
  loai_kn: string
  tieu_chuan: string
  ten_kh?: string
  so_mau: number
  samples: Samples
  grade: Record<string, { dat: boolean; tb?: number; detail?: string }>
  dat_hang: string
  trang_thai: string
  lots?: { ma_lo: string }
}

const LOAI_CSR   = ["CSR10","CSR20","CSR3L","CSRL","CSRCV50","CSRCV60","CSR5","Ngoại lệ"]
const LOAI_KN    = [
  { val:"thuong", label:"Kiểm thường (6 mẫu)" },
  { val:"ngat",   label:"Kiểm ngặt (14 mẫu)" },
  { val:"lai",    label:"Kiểm lại" },
]
const TIEU_CHUAN = ["TCCS 112:2022","TCVN 3769:2016","Tiêu chuẩn khách hàng"]

// ─── Standards Tables ─────────────────────────────────────────────────────────
type LimitRow = {
  tap_chat: number; tro: number;
  bay_hoi: number; bay_hoi_dr: number | null;
  nito: number; nito_dr: number | null;
  po_min: number | null; po_dr: number | null;
  pri_min: number; pri_tb: number; pri_dr: number | null;
  mooney_min: number | null; mooney_max: number | null;
  mau_max: number | null; mau_dr: number | null;
}

const TCCS: Record<string, LimitRow> = {
  CSRL:    { tap_chat:0.02, tro:0.4, bay_hoi:0.8, bay_hoi_dr:0.6, nito:0.6, nito_dr:null, po_min:35, po_dr:null, pri_min:60, pri_tb:70, pri_dr:null, mooney_min:null, mooney_max:null, mau_max:4, mau_dr:null },
  CSR3L:   { tap_chat:0.03, tro:0.5, bay_hoi:0.8, bay_hoi_dr:0.6, nito:0.6, nito_dr:null, po_min:35, po_dr:null, pri_min:60, pri_tb:70, pri_dr:null, mooney_min:73, mooney_max:93, mau_max:6, mau_dr:null },
  CSR5:    { tap_chat:0.05, tro:0.6, bay_hoi:0.8, bay_hoi_dr:0.6, nito:0.6, nito_dr:null, po_min:30, po_dr:null, pri_min:60, pri_tb:70, pri_dr:null, mooney_min:null, mooney_max:null, mau_max:null, mau_dr:null },
  CSRCV50: { tap_chat:0.02, tro:0.4, bay_hoi:0.8, bay_hoi_dr:0.6, nito:0.6, nito_dr:null, po_min:null, po_dr:null, pri_min:60, pri_tb:70, pri_dr:null, mooney_min:45, mooney_max:55, mau_max:null, mau_dr:null },
  CSRCV60: { tap_chat:0.02, tro:0.4, bay_hoi:0.8, bay_hoi_dr:0.6, nito:0.6, nito_dr:null, po_min:null, po_dr:null, pri_min:60, pri_tb:70, pri_dr:null, mooney_min:55, mooney_max:65, mau_max:null, mau_dr:null },
  CSR10:   { tap_chat:0.08, tro:0.6, bay_hoi:0.8, bay_hoi_dr:0.6, nito:0.6, nito_dr:null, po_min:30, po_dr:null, pri_min:50, pri_tb:60, pri_dr:null, mooney_min:73, mooney_max:93, mau_max:null, mau_dr:null },
  CSR20:   { tap_chat:0.16, tro:0.8, bay_hoi:0.8, bay_hoi_dr:0.6, nito:0.6, nito_dr:null, po_min:30, po_dr:null, pri_min:40, pri_tb:50, pri_dr:null, mooney_min:null, mooney_max:null, mau_max:null, mau_dr:null },
}

const TCVN: Record<string, LimitRow> = {
  CSRL:    { tap_chat:0.02, tro:0.4, bay_hoi:0.7, bay_hoi_dr:0.01, nito:0.5, nito_dr:0.06, po_min:35, po_dr:8, pri_min:60, pri_tb:70, pri_dr:10, mooney_min:null, mooney_max:null, mau_max:4, mau_dr:1 },
  CSR3L:   { tap_chat:0.03, tro:0.4, bay_hoi:0.7, bay_hoi_dr:0.01, nito:0.5, nito_dr:0.06, po_min:35, po_dr:8, pri_min:60, pri_tb:70, pri_dr:10, mooney_min:73, mooney_max:93, mau_max:6, mau_dr:1 },
  CSR5:    { tap_chat:0.04, tro:0.5, bay_hoi:0.7, bay_hoi_dr:0.01, nito:0.5, nito_dr:0.06, po_min:30, po_dr:null, pri_min:60, pri_tb:70, pri_dr:10, mooney_min:null, mooney_max:null, mau_max:null, mau_dr:null },
  CSRCV50: { tap_chat:0.02, tro:0.4, bay_hoi:0.7, bay_hoi_dr:0.01, nito:0.5, nito_dr:0.06, po_min:null, po_dr:null, pri_min:60, pri_tb:70, pri_dr:10, mooney_min:45, mooney_max:55, mau_max:null, mau_dr:null },
  CSRCV60: { tap_chat:0.02, tro:0.4, bay_hoi:0.7, bay_hoi_dr:0.01, nito:0.5, nito_dr:0.06, po_min:null, po_dr:null, pri_min:60, pri_tb:70, pri_dr:10, mooney_min:55, mooney_max:65, mau_max:null, mau_dr:null },
  CSR10:   { tap_chat:0.07, tro:0.6, bay_hoi:0.7, bay_hoi_dr:0.01, nito:0.5, nito_dr:0.06, po_min:30, po_dr:8, pri_min:50, pri_tb:60, pri_dr:10, mooney_min:73, mooney_max:93, mau_max:null, mau_dr:null },
  CSR20:   { tap_chat:0.15, tro:0.7, bay_hoi:0.7, bay_hoi_dr:0.01, nito:0.5, nito_dr:0.06, po_min:30, po_dr:8, pri_min:40, pri_tb:50, pri_dr:10, mooney_min:null, mooney_max:null, mau_max:null, mau_dr:null },
}

// Which fields to show per CSR type
function getVisibleFields(loaiCsr: string) {
  const base = ["tap_chat","tro","bay_hoi","nito","pri"]
  const lim = TCCS[loaiCsr] || TCCS.CSR10
  if (lim.po_min !== null) base.push("po")
  if (lim.mooney_min !== null) base.push("mooney")
  if (lim.mau_max !== null) base.push("mau_sac")
  return base
}

const ALL_FIELDS = [
  { key:"tap_chat",  label:"Tạp chất (%)" },
  { key:"tro",       label:"Tro (%)" },
  { key:"bay_hoi",   label:"Bay hơi (%)" },
  { key:"nito",      label:"Nitơ (%)" },
  { key:"po",        label:"Po" },
  { key:"pri",       label:"PRI" },
  { key:"mooney",    label:"Mooney" },
  { key:"mau_sac",   label:"Màu sắc" },
]

// ─── Grade calculation ────────────────────────────────────────────────────────
function calcGrade(
  samples: Record<string, (number|string)[]>,
  loaiCsr: string,
  tieuChuan: string,
  customLimits?: LimitRow
) {
  const nums = (arr: (number|string)[]) => arr.map(Number).filter(v => !isNaN(v) && v > 0)
  const avg  = (arr: number[]) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0
  const sd   = (arr: number[]) => { const m=avg(arr); return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length) }
  const mx   = (arr: number[]) => arr.length ? Math.max(...arr) : 0
  const mn   = (arr: number[]) => arr.length ? Math.min(...arr) : Infinity

  // Select limits
  const isTCVN = tieuChuan === "TCVN 3769:2016"
  const isTCKH = tieuChuan === "Tiêu chuẩn khách hàng"
  let lim: LimitRow
  if (isTCKH && customLimits) {
    lim = customLimits
  } else if (isTCVN) {
    lim = TCVN[loaiCsr] || TCVN.CSR10
  } else {
    lim = TCCS[loaiCsr] || TCCS.CSR10
  }

  const visible = getVisibleFields(loaiCsr)
  const grade: Record<string, { dat: boolean; tb: number; detail: string }> = {}

  // Tạp chất: X̄+3SD ≤ limit
  if (visible.includes("tap_chat")) {
    const tc = nums(samples.tap_chat || [])
    if (tc.length) {
      const tb = avg(tc); const s = sd(tc); const x3sd = +(tb + 3*s).toFixed(4)
      grade.tap_chat = { dat: x3sd <= lim.tap_chat, tb, detail: `X̄+3SD=${x3sd} ≤ ${lim.tap_chat}` }
    }
  }

  // Tro: X̄+3SD ≤ limit
  if (visible.includes("tro")) {
    const tr = nums(samples.tro || [])
    if (tr.length) {
      const tb = avg(tr); const s = sd(tr); const x3sd = +(tb + 3*s).toFixed(4)
      grade.tro = { dat: x3sd <= lim.tro, tb, detail: `X̄+3SD=${x3sd} ≤ ${lim.tro}` }
    }
  }

  // Bay hơi
  if (visible.includes("bay_hoi")) {
    const bh = nums(samples.bay_hoi || [])
    if (bh.length) {
      const m = mx(bh); const dr = +(m - mn(bh)).toFixed(4)
      if (isTCVN) {
        // TCVN: only compare each sample ≤ limit, no DR
        const dat = bh.every(v => v <= lim.bay_hoi)
        grade.bay_hoi = { dat, tb: avg(bh), detail: `Max=${m} ≤ ${lim.bay_hoi} (TCVN, ko tính DR)` }
      } else {
        // TCCS: Max ≤ limit AND DR ≤ dr_limit
        const dat = m <= lim.bay_hoi && (lim.bay_hoi_dr === null || dr <= lim.bay_hoi_dr)
        grade.bay_hoi = { dat, tb: avg(bh), detail: `Max=${m}≤${lim.bay_hoi}, DR=${dr}${lim.bay_hoi_dr!==null?`≤${lim.bay_hoi_dr}`:""}` }
      }
    }
  }

  // Nitơ
  if (visible.includes("nito")) {
    const ni = nums(samples.nito || [])
    if (ni.length) {
      const m = mx(ni); const dr = +(m - mn(ni)).toFixed(4)
      if (isTCVN) {
        const dat = ni.every(v => v <= lim.nito)
        grade.nito = { dat, tb: avg(ni), detail: `Max=${m} ≤ ${lim.nito} (TCVN, ko tính DR)` }
      } else {
        const dat = m <= lim.nito && (lim.nito_dr === null || dr <= lim.nito_dr)
        grade.nito = { dat, tb: avg(ni), detail: `Max=${m}≤${lim.nito}, DR=${dr}${lim.nito_dr!==null?`≤${lim.nito_dr}`:""}` }
      }
    }
  }

  // Po
  if (visible.includes("po") && lim.po_min !== null) {
    const po = nums(samples.po || [])
    if (po.length) {
      const mi = mn(po); const dr = +(mx(po) - mi).toFixed(2)
      if (isTCVN) {
        const dat = mi >= lim.po_min!
        grade.po = { dat, tb: avg(po), detail: `Min=${mi} ≥ ${lim.po_min} (TCVN, ko tính DR)` }
      } else {
        const dat = mi >= lim.po_min! && (lim.po_dr === null || dr <= lim.po_dr)
        grade.po = { dat, tb: avg(po), detail: `Min=${mi}≥${lim.po_min}${lim.po_dr!==null?`, DR=${dr}≤${lim.po_dr}`:""}` }
      }
    }
  }

  // PRI
  if (visible.includes("pri")) {
    const pr = nums(samples.pri || [])
    if (pr.length) {
      const tb = avg(pr); const mi = mn(pr); const dr = +(mx(pr) - mi).toFixed(2)
      if (isTCVN) {
        const dat = mi >= lim.pri_min && tb >= lim.pri_tb
        grade.pri = { dat, tb, detail: `Min=${mi}≥${lim.pri_min}, X̄=${tb.toFixed(1)}≥${lim.pri_tb} (TCVN, ko tính DR)` }
      } else {
        const dat = mi >= lim.pri_min && tb >= lim.pri_tb && (lim.pri_dr === null || dr <= lim.pri_dr)
        grade.pri = { dat, tb, detail: `Min=${mi}≥${lim.pri_min}, X̄=${tb.toFixed(1)}≥${lim.pri_tb}${lim.pri_dr!==null?`, DR=${dr}≤${lim.pri_dr}`:""}` }
      }
    }
  }

  // Mooney
  if (visible.includes("mooney") && lim.mooney_min !== null && lim.mooney_max !== null) {
    const mo = nums(samples.mooney || [])
    if (mo.length) {
      const mi = mn(mo); const ma = mx(mo)
      const dat = mi >= lim.mooney_min! && ma <= lim.mooney_max!
      grade.mooney = { dat, tb: avg(mo), detail: `Min=${mi}≥${lim.mooney_min}, Max=${ma}≤${lim.mooney_max}` }
    }
  }

  // Màu sắc (only L, 3L)
  if (visible.includes("mau_sac") && lim.mau_max !== null) {
    const ms = nums(samples.mau_sac || [])
    if (ms.length) {
      const tb = avg(ms)
      if (isTCVN) {
        // TCVN: each sample ≤ mau_max only
        const dat = ms.every(v => v <= lim.mau_max!)
        grade.mau_sac = { dat, tb, detail: `Mỗi mẫu ≤ ${lim.mau_max} (TCVN, ko tính DR)` }
      } else {
        // TCCS: each sample ≤ mau_max AND X̄ ≤ mau_dr
        const datMax = ms.every(v => v <= lim.mau_max!)
        const datDr = lim.mau_dr === null || tb <= lim.mau_dr
        grade.mau_sac = { dat: datMax && datDr, tb, detail: `Mỗi mẫu≤${lim.mau_max}${lim.mau_dr!==null?`, X̄=${tb.toFixed(1)}≤${lim.mau_dr}`:""}` }
      }
    }
  }

  const allDat = Object.values(grade).every(g => g.dat)
  const dat_hang = allDat ? loaiCsr : loaiCsr + "RH"
  return { grade, dat_hang, trang_thai: allDat ? "dat" : "khong_dat" }
}

const emptyForm = (soMau = 6) => ({
  ma_lo: "", pkn: 0,
  ngay_kn: new Date().toISOString().slice(0,10),
  ngay_sx: new Date(Date.now()-86400000).toISOString().slice(0,10),
  loai_csr: "CSR10", loai_kn: "thuong", tieu_chuan: "TCCS 112:2022",
  ten_kh: "",
  so_mau: soMau,
  samples: {
    tap_chat: Array(soMau).fill(""),
    tro:      Array(soMau).fill(""),
    bay_hoi:  Array(soMau).fill(""),
    nito:     Array(soMau).fill(""),
    po:       Array(soMau).fill(""),
    pri:      Array(soMau).fill(""),
    mooney:   Array(soMau).fill(""),
    mau_sac:  Array(soMau).fill(""),
  } as Record<string, (number|string)[]>,
})

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function QualityPage() {
  const [results, setResults]   = useState<QcResult[]>([])
  const [loading, setLoading]   = useState(true)
  const [factoryId, setFactoryId] = useState<string|null>(null)
  const [search, setSearch]     = useState("")
  const [filterLoai, setFilterLoai] = useState("")
  const [filterTT, setFilterTT] = useState("")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")

  // Modal
  const [modal, setModal]   = useState<"add"|"edit"|null>(null)
  const [form, setForm]     = useState(emptyForm(6))
  const [editId, setEditId] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string|null>(null)

  // Preview calc
  const [preview, setPreview] = useState<ReturnType<typeof calcGrade> | null>(null)

  // Delete
  const [delConfirm, setDelConfirm] = useState<string|null>(null)

  // Toast
  const [toast, setToast] = useState<string|null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    let q = supabase.from("qc_results")
      .select("*, lots(ma_lo)")
      .eq("factory_id", fid)
      .order("ngay_kn", { ascending: false })
      .order("pkn", { ascending: false })
    if (filterLoai) q = q.eq("loai_csr", filterLoai)
    if (filterTT)   q = q.eq("trang_thai", filterTT)
    if (filterFrom) q = q.gte("ngay_kn", filterFrom)
    if (filterTo)   q = q.lte("ngay_kn", filterTo)
    const { data } = await q
    setResults(data || [])
    setLoading(false)
  }, [filterLoai, filterTT, filterFrom, filterTo])

  useEffect(() => {
    const fid = localStorage.getItem("erp_factory")
    if (!fid) return
    setFactoryId(fid)
    loadData(fid)
  }, [loadData])

  const filtered = results.filter(r =>
    !search ||
    r.ma_lo?.toLowerCase().includes(search.toLowerCase()) ||
    String(r.pkn).includes(search)
  )

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    total: results.length,
    dat: results.filter(r => r.trang_thai === "dat").length,
    khongDat: results.filter(r => r.trang_thai === "khong_dat").length,
    tyLe: results.length ? Math.round(results.filter(r=>r.trang_thai==="dat").length/results.length*100) : 0,
  }

  // ── Update sample ─────────────────────────────────────────────────────────
  const updateSample = (field: string, idx: number, val: string) => {
    setForm(prev => {
      const next = {
        ...prev,
        samples: {
          ...prev.samples,
          [field]: prev.samples[field].map((v,i) => i===idx ? val : v)
        }
      }
      // Auto preview
      setPreview(calcGrade(next.samples, next.loai_csr, next.tieu_chuan))
      return next
    })
  }

  // ── Change so_mau ─────────────────────────────────────────────────────────
  const changeSoMau = (n: number) => {
    setForm(prev => ({
      ...prev, so_mau: n,
      samples: Object.fromEntries(
        Object.entries(prev.samples).map(([k,v]) => [k, Array(n).fill("").map((_, i) => v[i]??"")])
      ) as Record<string, (number|string)[]>
    }))
    setPreview(null)
  }

  // Visible fields for current CSR type
  const visibleFields = getVisibleFields(form.loai_csr)
  const activeFields = ALL_FIELDS.filter(f => visibleFields.includes(f.key))

  // ── Check if all required fields have data ────────────────────────────────
  const allFieldsFilled = activeFields.every(f => {
    const vals = (form.samples[f.key] || []).map(Number).filter(v => !isNaN(v) && v > 0)
    return vals.length >= form.so_mau
  })

  // ── Open Edit ─────────────────────────────────────────────────────────────
  const openEdit = (r: QcResult) => {
    const soMau = r.so_mau || 6
    const pad = (arr: any[], n: number) => (arr||[]).map(v => String(v)).concat(Array(Math.max(0, n - (arr?.length||0))).fill(""))
    setForm({
      ma_lo: r.ma_lo || "",
      pkn: r.pkn || 0,
      ngay_kn: r.ngay_kn?.slice(0,10) || new Date().toISOString().slice(0,10),
      ngay_sx: r.ngay_sx?.slice(0,10) || "",
      loai_csr: r.loai_csr || "CSR10",
      loai_kn: r.loai_kn || "thuong",
      tieu_chuan: r.tieu_chuan || "TCCS 112:2022",
      ten_kh: (r as any).ten_kh || "",
      so_mau: soMau,
      samples: {
        tap_chat: pad(r.samples?.tap_chat, soMau),
        tro:      pad(r.samples?.tro, soMau),
        bay_hoi:  pad(r.samples?.bay_hoi, soMau),
        nito:     pad(r.samples?.nito, soMau),
        po:       pad(r.samples?.po, soMau),
        pri:      pad(r.samples?.pri, soMau),
        mooney:   pad(r.samples?.mooney, soMau),
        mau_sac:  pad(r.samples?.mau_sac, soMau),
      } as Record<string, (number|string)[]>,
    })
    setEditId(r.id)
    setPreview(null)
    setModal("edit")
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!factoryId) return
    if (!allFieldsFilled) {
      showToast("⚠️ Chưa nhập đủ tất cả chỉ tiêu bắt buộc!")
      return
    }
    setSaving(true)
    const { grade, dat_hang, trang_thai } = calcGrade(form.samples, form.loai_csr, form.tieu_chuan)
    const payload = {
      factory_id: factoryId,
      ma_lo: form.ma_lo, pkn: form.pkn,
      ngay_kn: form.ngay_kn, ngay_sx: form.ngay_sx,
      chung_loai: form.loai_csr.replace("CSR",""),
      loai_csr: form.loai_csr, loai_kn: form.loai_kn,
      tieu_chuan: form.tieu_chuan,
      ten_kh: form.tieu_chuan === "Tiêu chuẩn khách hàng" ? form.ten_kh : null,
      so_mau: form.so_mau,
      samples: Object.fromEntries(
        Object.entries(form.samples).map(([k,v]) => [k, v.map(Number)])
      ),
      grade, dat_hang, trang_thai,
    }
    if (editId) {
      await supabase.from("qc_results").update(payload).eq("id", editId)
      showToast("Đã cập nhật kết quả kiểm nghiệm")
    } else {
      await supabase.from("qc_results").insert(payload)
      showToast("Đã thêm kết quả kiểm nghiệm mới")
    }
    setSaving(false)
    setModal(null)
    setEditId(null)
    setPreview(null)
    setForm(emptyForm(6))
    loadData(factoryId)
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!factoryId) return
    await supabase.from("qc_results").delete().eq("id", id)
    setDelConfirm(null)
    showToast("Đã xóa kết quả kiểm nghiệm")
    loadData(factoryId)
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  const ToastNotification = () => toast ? (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl shadow-lg animate-[fadeInUp_0.3s_ease-out]">
      <Check size={16}/> {toast}
    </div>
  ) : null

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <ToastNotification/>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Kiểm nghiệm</h1>
          <p className="text-sm text-slate-500 mt-0.5">Kiểm tra chất lượng — TCCS / TCVN / TCKH</p>
        </div>
        <button onClick={() => { setForm(emptyForm(6)); setEditId(null); setPreview(null); setModal("add") }}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
          <Plus size={16}/> Thêm kết quả
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {([
          { label:"Tổng phiếu KN", value: stats.total,     color:"text-slate-700",   Icon: ClipboardCheck, ic: "text-slate-400"   },
          { label:"Đạt",            value: stats.dat,       color:"text-emerald-600", Icon: Check,          ic: "text-emerald-400" },
          { label:"Không đạt",      value: stats.khongDat, color:"text-red-500",     Icon: XCircle,        ic: "text-red-400"     },
          { label:"Tỷ lệ đạt",      value: stats.tyLe+"%", color:"text-blue-600",    Icon: BarChart2,      ic: "text-blue-400"    },
        ] as const).map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 shadow-md p-4 text-center">
            <s.Icon size={20} className={`mx-auto mb-1 ${s.ic} opacity-80`}/>
            <div className={`text-2xl font-extrabold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 flex-1 min-w-48">
          <Search size={15} className="text-slate-400"/>
          <input value={search} onChange={e=>{setSearch(e.target.value)}}
            placeholder="Tìm mã lô, số PKN..." className="flex-1 text-sm outline-none"/>
        </div>
        <select value={filterLoai} onChange={e=>setFilterLoai(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400">
          <option value="">Tất cả loại</option>
          {LOAI_CSR.map(l=><option key={l}>{l}</option>)}
        </select>
        <select value={filterTT} onChange={e=>setFilterTT(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400">
          <option value="">Tất cả KQ</option>
          <option value="dat">Đạt</option>
          <option value="khong_dat">Không đạt</option>
        </select>
        <input type="date" value={filterFrom} onChange={e=>setFilterFrom(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"/>
        <span className="text-slate-400 text-sm">→</span>
        <input type="date" value={filterTo} onChange={e=>setFilterTo(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"/>
        {(search||filterLoai||filterTT||filterFrom||filterTo) &&
          <button onClick={()=>{setSearch("");setFilterLoai("");setFilterTT("");setFilterFrom("");setFilterTo("")}}
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
            <ClipboardCheck size={40} className="mx-auto mb-3 opacity-30"/>
            <p>Không có kết quả kiểm nghiệm nào</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["PKN","Mã lô","Ngày KN","Loại","Tiêu chuẩn","Tạp chất","Tro","PRI","Kết quả",""].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(r => (
                <>
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(expandedId===r.id ? null : r.id)}>
                    <td className="px-4 py-3 font-bold text-slate-700">{r.pkn}</td>
                    <td className="px-4 py-3 font-semibold text-emerald-700">{r.ma_lo}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.ngay_kn ? new Date(r.ngay_kn).toLocaleDateString("vi-VN") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">{r.loai_csr}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{r.tieu_chuan}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {r.grade?.tap_chat?.tb?.toFixed(3) ?? "—"}
                      {r.grade?.tap_chat && (
                        <span className={`ml-1 ${r.grade.tap_chat.dat?"text-emerald-500":"text-red-500"}`}>
                          {r.grade.tap_chat.dat?"✓":"✗"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {r.grade?.tro?.tb?.toFixed(3) ?? "—"}
                      {r.grade?.tro && (
                        <span className={`ml-1 ${r.grade.tro.dat?"text-emerald-500":"text-red-500"}`}>
                          {r.grade.tro.dat?"✓":"✗"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {r.grade?.pri?.tb?.toFixed(1) ?? "—"}
                      {r.grade?.pri && (
                        <span className={`ml-1 ${r.grade.pri.dat?"text-emerald-500":"text-red-500"}`}>
                          {r.grade.pri.dat?"✓":"✗"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        r.trang_thai==="dat" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                        {r.trang_thai==="dat" ? `✓ ${r.dat_hang}` : `✗ ${r.dat_hang || "Rớt hạng"}`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); openEdit(r) }}
                          className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors" title="Sửa">
                          <Edit2 size={14}/>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setDelConfirm(r.id) }}
                          className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors" title="Xóa">
                          <Trash2 size={14}/>
                        </button>
                        {expandedId===r.id ? <ChevronUp size={16} className="text-slate-400"/> : <ChevronDown size={16} className="text-slate-400"/>}
                      </div>
                    </td>
                  </tr>
                  {/* Expanded samples */}
                  {expandedId===r.id && (
                    <tr key={r.id+"_exp"}>
                      <td colSpan={10} className="px-4 py-4 bg-slate-50 border-t border-slate-100">
                        <div className="flex flex-wrap gap-3 text-xs">
                          {ALL_FIELDS.filter(f => r.grade?.[f.key] || (r.samples as any)?.[f.key]?.some((v:any)=>v>0)).map(f => {
                            const vals = ((r.samples as any)?.[f.key] || []) as number[]
                            const g = r.grade?.[f.key]
                            return (
                              <div key={f.key} className={`rounded-lg p-3 border min-w-[120px] flex-1 ${g?.dat===false?"border-red-200 bg-red-50":"border-slate-200 bg-white"}`}>
                                <div className="font-bold text-slate-600 mb-1.5">{f.label}</div>
                                <div className="space-y-0.5">
                                  {vals.map((v,i) => (
                                    <div key={i} className="flex justify-between">
                                      <span className="text-slate-400">M{i+1}</span>
                                      <span className="font-mono font-semibold text-slate-700">{v||"—"}</span>
                                    </div>
                                  ))}
                                </div>
                                {g && (
                                  <div className={`mt-2 pt-1.5 border-t text-[10px] ${g.dat?"text-emerald-600":"text-red-500"}`}>
                                    <div className="font-bold">{g.dat?"✓ Đạt":"✗ Không đạt"}</div>
                                    {g.detail && <div className="text-slate-500 mt-0.5">{g.detail}</div>}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Modal */}
      {(modal === "add" || modal === "edit") && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <h2 className="text-lg font-extrabold text-slate-800">
                {modal === "add" ? "Nhập kết quả kiểm nghiệm" : `Sửa kết quả — ${form.ma_lo}`}
              </h2>
              <button onClick={() => { setModal(null); setEditId(null); setPreview(null) }} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
            </div>
            <div className="p-6 space-y-5">
              {/* Info row 1 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã lô *</label>
                  <input value={form.ma_lo} onChange={e=>setForm(p=>({...p,ma_lo:e.target.value}))}
                    placeholder="01cs/26" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Số PKN</label>
                  <input type="number" value={form.pkn} onChange={e=>setForm(p=>({...p,pkn:+e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại CSR</label>
                  <select value={form.loai_csr} onChange={e=>{setForm(p=>({...p,loai_csr:e.target.value})); setPreview(null)}}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {LOAI_CSR.map(l=><option key={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              {/* Info row 2 */}
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày KN</label>
                  <input type="date" value={form.ngay_kn} onChange={e=>setForm(p=>({...p,ngay_kn:e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày SX</label>
                  <input type="date" value={form.ngay_sx} onChange={e=>setForm(p=>({...p,ngay_sx:e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại KN</label>
                  <select value={form.loai_kn} onChange={e=>{
                    const n = e.target.value==="ngat" ? 14 : 6
                    setForm(p=>({...p,loai_kn:e.target.value}))
                    changeSoMau(n)
                  }} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {LOAI_KN.map(l=><option key={l.val} value={l.val}>{l.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Tiêu chuẩn</label>
                  <select value={form.tieu_chuan} onChange={e=>{setForm(p=>({...p,tieu_chuan:e.target.value})); setPreview(null)}}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {TIEU_CHUAN.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* TCKH: customer name */}
              {form.tieu_chuan === "Tiêu chuẩn khách hàng" && (
                <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <label className="text-xs font-bold text-blue-700 block mb-1.5">Tên khách hàng *</label>
                  <input value={form.ten_kh} onChange={e=>setForm(p=>({...p,ten_kh:e.target.value}))}
                    placeholder="VD: Michelin, Bridgestone..."
                    className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm outline-none focus:border-blue-500"/>
                  <p className="text-[10px] text-blue-500 mt-1">Áp dụng bảng TCCS 112:2022 làm mặc định. Liên hệ Admin để chỉnh sửa giới hạn.</p>
                </div>
              )}

              {/* Active standard badge */}
              <div className="flex items-center gap-2">
                <span className={`text-xs px-3 py-1 rounded-full font-bold ${
                  form.tieu_chuan.includes("TCCS") ? "bg-emerald-100 text-emerald-700" :
                  form.tieu_chuan.includes("TCVN") ? "bg-blue-100 text-blue-700" :
                  "bg-purple-100 text-purple-700"
                }`}>
                  {form.tieu_chuan}
                </span>
                <span className="text-xs text-slate-400">
                  {form.tieu_chuan.includes("TCVN") ? "Không tính DR cho Bay hơi, Nitơ, Po, PRI, Màu" :
                   "Tính DR đầy đủ cho tất cả chỉ tiêu"}
                </span>
                <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">
                  {activeFields.length} chỉ tiêu · {form.so_mau} mẫu
                </span>
              </div>

              {/* Samples table */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-2">
                  Số liệu mẫu
                </label>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-slate-200 rounded-xl overflow-hidden">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold text-slate-600 border-b border-slate-200 w-32 sticky left-0 bg-slate-50 z-[1]">Chỉ tiêu</th>
                        {Array.from({length:form.so_mau},(_,i)=>(
                          <th key={i} className="px-2 py-2 text-center font-bold text-slate-500 border-b border-slate-200 min-w-16">M{i+1}</th>
                        ))}
                        {preview && <th className="px-3 py-2 text-center font-bold text-slate-600 border-b border-slate-200 w-28">Kết quả</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeFields.map(f => {
                        const g = preview?.grade?.[f.key]
                        return (
                          <tr key={f.key} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-semibold text-slate-600 bg-slate-50 border-r border-slate-200 sticky left-0 z-[1]">{f.label}</td>
                            {Array.from({length:form.so_mau},(_,i)=>(
                              <td key={i} className="px-1 py-1">
                                <input
                                  value={(form.samples[f.key]?.[i] ?? "") as string}
                                  onChange={e => updateSample(f.key, i, e.target.value)}
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-center font-mono text-xs outline-none focus:border-emerald-400 focus:bg-emerald-50"/>
                              </td>
                            ))}
                            {preview && (
                              <td className="px-2 py-1 text-center">
                                {g ? (
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${g.dat?"bg-emerald-100 text-emerald-700":"bg-red-100 text-red-600"}`}>
                                    {g.dat?"✓":"✗"}
                                  </span>
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Preview result */}
              {preview && (
                <div className={`rounded-xl border-2 p-4 ${preview.trang_thai==="dat"?"border-emerald-300 bg-emerald-50":"border-red-300 bg-red-50"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {preview.trang_thai==="dat" ? (
                        <Check size={24} className="text-emerald-600"/>
                      ) : (
                        <AlertTriangle size={24} className="text-red-500"/>
                      )}
                      <div>
                        <div className={`text-lg font-extrabold ${preview.trang_thai==="dat"?"text-emerald-700":"text-red-600"}`}>
                          {preview.trang_thai==="dat" ? "ĐẠT" : "KHÔNG ĐẠT"}
                        </div>
                        <div className="text-sm font-bold text-slate-600">
                          Xếp hạng: <span className={preview.trang_thai==="dat"?"text-emerald-700":"text-red-600"}>{preview.dat_hang}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      {Object.values(preview.grade).filter(g=>g.dat).length}/{Object.values(preview.grade).length} chỉ tiêu đạt
                    </div>
                  </div>
                  {/* Detail per field */}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {Object.entries(preview.grade).map(([key, g]) => (
                      <div key={key} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${g.dat?"bg-white/60":"bg-red-100"}`}>
                        <span className={`w-4 text-center font-bold ${g.dat?"text-emerald-500":"text-red-500"}`}>{g.dat?"✓":"✗"}</span>
                        <span className="font-semibold text-slate-600">{ALL_FIELDS.find(f=>f.key===key)?.label || key}:</span>
                        <span className="text-slate-500 truncate">{g.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warning if not all filled */}
              {!allFieldsFilled && (
                <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
                  <AlertTriangle size={14}/>
                  Chưa nhập đủ tất cả chỉ tiêu bắt buộc. Phải nhập đủ mới được xếp hạng.
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={()=>{ setModal(null); setEditId(null); setPreview(null) }}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-50">
                {saving ? "Đang lưu..." : modal === "add" ? "Lưu kết quả" : "Lưu thay đổi"}
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
            <p className="text-sm text-slate-500 mb-5">Kết quả kiểm nghiệm này sẽ bị xóa vĩnh viễn.</p>
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
