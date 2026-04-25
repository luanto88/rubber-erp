"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { useScrollReveal } from "@/lib/useScrollReveal"
import {
  ClipboardCheck, Plus, X, Search, ChevronDown, ChevronRight,
  Edit2, Trash2, Check, AlertTriangle, BarChart2, XCircle,
  FileText, RefreshCw, Clock, Star, ArrowLeft, Printer, Eye
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type Samples = Record<string, (string | number)[]>

type NoteEntry = {
  field: string; old_val: string | number; new_val: string | number
  timestamp: string; user: string
}

type QcResult = {
  id: string; factory_id: string; lot_id: string | null
  ma_lo: string; pkn: number; lo_kn: number
  ngay_kn: string; ngay_sx: string
  chung_loai: string; loai_csr: string; loai_kn: string; tieu_chuan: string
  so_mau: number; samples: Samples
  grade: Record<string, { dat: boolean; tb?: number; detail?: string }>
  dat_hang: string; trang_thai: string
  parent_id?: string | null; lan?: number; notes?: NoteEntry[]
  created_at?: string
  lots?: { ma_lo: string; ngay_sx: string }
}

type LimitRow = {
  tap_chat: number; tro: number
  bay_hoi: number; bay_hoi_dr: number | null
  nito: number; nito_dr: number | null
  po_min: number | null; po_dr: number | null
  pri_min: number; pri_tb: number; pri_dr: number | null
  mooney_min: number | null; mooney_max: number | null
  mau_max: number | null; mau_dr: number | null
}

type CustomStd = {
  id: string; factory_id: string; ten_kh: string; limits: LimitRow; created_at?: string
}

type LotItem = {
  id: string; factory_id: string; ma_lo: string; loai_csr: string
  ngay_sx: string; trang_thai: string; tong_banh: number
}

type LotChip = LotItem & { prev_qc?: QcResult }

type TabState = {
  samples: Samples
  preview: { grade: QcResult["grade"]; dat_hang: string; trang_thai: string } | null
}

type CreateForm = {
  ngay_kn: string; ngay_sx: string; chung_loai: string
  loai_kn: string; so_mau: number; tuy_chon_mau: number
  tieu_chuan: string // "TCCS 112:2022" | "TCVN 3769:2016" | UUID of custom std | "new"
}

// ─── Constants ────────────────────────────────────────────────────────────────
const FACTORY_CODE: Record<string, string> = { phuochoa_kt: "PHK", cuaparis: "CP" }

const CHUNG_LOAI = ["10","20","L","3L","CV50","CV60","5"]

const LOAI_KN_OPTIONS = [
  { val:"thuong",      label:"Kiểm thường (6 mẫu)",      defaultMau: 6  },
  { val:"ngat",        label:"Kiểm ngặt (14 mẫu)",       defaultMau: 14 },
  { val:"tuy_chon",   label:"Tùy chọn",                  defaultMau: 6  },
  { val:"kl_6thang",  label:"Kiểm lại (6 tháng)",        defaultMau: 6  },
  { val:"kl_rot_hang",label:"Kiểm lại (Rớt hạng)",       defaultMau: 6  },
]

const ALL_FIELDS = [
  { key:"tap_chat", label:"Tạp chất (%)" },
  { key:"tro",      label:"Tro (%)"       },
  { key:"bay_hoi",  label:"Bay hơi (%)"   },
  { key:"nito",     label:"Nitơ (%)"      },
  { key:"po",       label:"Po"            },
  { key:"pri",      label:"PRI"           },
  { key:"mooney",   label:"Mooney"        },
  { key:"mau_sac",  label:"Màu sắc"       },
]

// TCCS 112:2022 (correct values — bay_hoi=0.7 w/ DR, nito=0.5 w/ DR)
const TCCS: Record<string, LimitRow> = {
  CSRL:    { tap_chat:0.02,tro:0.4,bay_hoi:0.7,bay_hoi_dr:0.1,nito:0.5,nito_dr:0.06,po_min:35,  po_dr:8,   pri_min:60,pri_tb:70,pri_dr:10,mooney_min:null,mooney_max:null,mau_max:4,  mau_dr:1    },
  CSR3L:   { tap_chat:0.03,tro:0.4,bay_hoi:0.7,bay_hoi_dr:0.1,nito:0.5,nito_dr:0.06,po_min:35,  po_dr:8,   pri_min:60,pri_tb:70,pri_dr:10,mooney_min:73,  mooney_max:93,  mau_max:6,  mau_dr:1    },
  CSR5:    { tap_chat:0.04,tro:0.5,bay_hoi:0.7,bay_hoi_dr:0.1,nito:0.5,nito_dr:0.06,po_min:30,  po_dr:null,pri_min:60,pri_tb:70,pri_dr:10,mooney_min:null,mooney_max:null,mau_max:null,mau_dr:null },
  CSRCV50: { tap_chat:0.02,tro:0.4,bay_hoi:0.7,bay_hoi_dr:0.1,nito:0.5,nito_dr:0.06,po_min:null,po_dr:null,pri_min:60,pri_tb:70,pri_dr:10,mooney_min:45,  mooney_max:55,  mau_max:null,mau_dr:null },
  CSRCV60: { tap_chat:0.02,tro:0.4,bay_hoi:0.7,bay_hoi_dr:0.1,nito:0.5,nito_dr:0.06,po_min:null,po_dr:null,pri_min:60,pri_tb:70,pri_dr:10,mooney_min:55,  mooney_max:65,  mau_max:null,mau_dr:null },
  CSR10:   { tap_chat:0.07,tro:0.6,bay_hoi:0.7,bay_hoi_dr:0.1,nito:0.5,nito_dr:0.06,po_min:30,  po_dr:8,   pri_min:50,pri_tb:60,pri_dr:10,mooney_min:73,  mooney_max:93,  mau_max:null,mau_dr:null },
  CSR20:   { tap_chat:0.15,tro:0.7,bay_hoi:0.7,bay_hoi_dr:0.1,nito:0.5,nito_dr:0.06,po_min:30,  po_dr:8,   pri_min:40,pri_tb:50,pri_dr:10,mooney_min:null,mooney_max:null,mau_max:null,mau_dr:null },
}

// TCVN 3769:2016 (bay_hoi=0.8 no DR, nito=0.6 no DR)
const TCVN: Record<string, LimitRow> = {
  CSRL:    { tap_chat:0.02,tro:0.4,bay_hoi:0.8,bay_hoi_dr:null,nito:0.6,nito_dr:null,po_min:35,  po_dr:null,pri_min:60,pri_tb:70,pri_dr:null,mooney_min:null,mooney_max:null,mau_max:4,  mau_dr:null },
  CSR3L:   { tap_chat:0.03,tro:0.5,bay_hoi:0.8,bay_hoi_dr:null,nito:0.6,nito_dr:null,po_min:35,  po_dr:null,pri_min:60,pri_tb:70,pri_dr:null,mooney_min:73,  mooney_max:93,  mau_max:6,  mau_dr:null },
  CSR5:    { tap_chat:0.05,tro:0.6,bay_hoi:0.8,bay_hoi_dr:null,nito:0.6,nito_dr:null,po_min:30,  po_dr:null,pri_min:60,pri_tb:70,pri_dr:null,mooney_min:null,mooney_max:null,mau_max:null,mau_dr:null },
  CSRCV50: { tap_chat:0.02,tro:0.4,bay_hoi:0.8,bay_hoi_dr:null,nito:0.6,nito_dr:null,po_min:null,po_dr:null,pri_min:60,pri_tb:70,pri_dr:null,mooney_min:45,  mooney_max:55,  mau_max:null,mau_dr:null },
  CSRCV60: { tap_chat:0.02,tro:0.4,bay_hoi:0.8,bay_hoi_dr:null,nito:0.6,nito_dr:null,po_min:null,po_dr:null,pri_min:60,pri_tb:70,pri_dr:null,mooney_min:55,  mooney_max:65,  mau_max:null,mau_dr:null },
  CSR10:   { tap_chat:0.08,tro:0.6,bay_hoi:0.8,bay_hoi_dr:null,nito:0.6,nito_dr:null,po_min:30,  po_dr:null,pri_min:50,pri_tb:60,pri_dr:null,mooney_min:73,  mooney_max:93,  mau_max:null,mau_dr:null },
  CSR20:   { tap_chat:0.16,tro:0.8,bay_hoi:0.8,bay_hoi_dr:null,nito:0.6,nito_dr:null,po_min:30,  po_dr:null,pri_min:40,pri_tb:50,pri_dr:null,mooney_min:null,mooney_max:null,mau_max:null,mau_dr:null },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const limitKey = (loaiCsr: string) => loaiCsr.replace(/^SVR/, "CSR")

function getVisibleFields(loaiCsr: string): string[] {
  const base = ["tap_chat","tro","bay_hoi","nito","pri"]
  const lim = TCCS[limitKey(loaiCsr)] || TCCS.CSR10
  if (lim.po_min !== null) base.push("po")
  if (lim.mooney_min !== null) base.push("mooney")
  if (lim.mau_max !== null) base.push("mau_sac")
  return base
}

function getLimits(loaiCsr: string, tieuChuan: string, customLimits?: LimitRow): LimitRow {
  const lk = limitKey(loaiCsr)
  if (tieuChuan === "TCVN 3769:2016") return TCVN[lk] || TCVN.CSR10
  if (customLimits) return customLimits
  return TCCS[lk] || TCCS.CSR10
}

function calcGrade(
  samples: Samples, loaiCsr: string, tieuChuan: string, customLimits?: LimitRow
) {
  const lim = getLimits(loaiCsr, tieuChuan, customLimits)
  const nums = (arr: (number|string)[] | undefined) =>
    (arr || []).map(Number).filter(v => !isNaN(v) && v > 0)
  const avg = (a: number[]) => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0
  const sd  = (a: number[]) => { const m=avg(a); return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length) }
  const mx  = (a: number[]) => a.length ? Math.max(...a) : 0
  const mn  = (a: number[]) => a.length ? Math.min(...a) : Infinity

  const visible = getVisibleFields(loaiCsr)
  const grade: Record<string, { dat: boolean; tb: number; detail: string }> = {}

  const tc = nums(samples.tap_chat); if (tc.length && visible.includes("tap_chat")) {
    const tb=avg(tc),s=sd(tc),x3sd=+(tb+3*s).toFixed(4)
    grade.tap_chat={dat:x3sd<=lim.tap_chat,tb,detail:`X̄+3SD=${x3sd}≤${lim.tap_chat}`}
  }
  const tr = nums(samples.tro); if (tr.length && visible.includes("tro")) {
    const tb=avg(tr),s=sd(tr),x3sd=+(tb+3*s).toFixed(4)
    grade.tro={dat:x3sd<=lim.tro,tb,detail:`X̄+3SD=${x3sd}≤${lim.tro}`}
  }
  const bh = nums(samples.bay_hoi); if (bh.length && visible.includes("bay_hoi")) {
    const m=mx(bh),dr=+(m-mn(bh)).toFixed(4)
    const dat=m<=lim.bay_hoi&&(lim.bay_hoi_dr===null||dr<=lim.bay_hoi_dr)
    grade.bay_hoi={dat,tb:avg(bh),detail:`Max=${m}≤${lim.bay_hoi}${lim.bay_hoi_dr!==null?`, DR=${dr}≤${lim.bay_hoi_dr}`:""}`}
  }
  const ni = nums(samples.nito); if (ni.length && visible.includes("nito")) {
    const m=mx(ni),dr=+(m-mn(ni)).toFixed(4)
    const dat=m<=lim.nito&&(lim.nito_dr===null||dr<=lim.nito_dr)
    grade.nito={dat,tb:avg(ni),detail:`Max=${m}≤${lim.nito}${lim.nito_dr!==null?`, DR=${dr}≤${lim.nito_dr}`:""}`}
  }
  const po = nums(samples.po); if (po.length && visible.includes("po") && lim.po_min!==null) {
    const mi=mn(po),dr=+(mx(po)-mi).toFixed(2)
    const dat=mi>=lim.po_min!&&(lim.po_dr===null||dr<=lim.po_dr)
    grade.po={dat,tb:avg(po),detail:`Min=${mi}≥${lim.po_min}${lim.po_dr!==null?`, DR=${dr}≤${lim.po_dr}`:""}`}
  }
  const pr = nums(samples.pri); if (pr.length && visible.includes("pri")) {
    const tb=avg(pr),mi=mn(pr),dr=+(mx(pr)-mi).toFixed(2)
    const dat=mi>=lim.pri_min&&tb>=lim.pri_tb&&(lim.pri_dr===null||dr<=lim.pri_dr)
    grade.pri={dat,tb,detail:`Min=${mi}≥${lim.pri_min}, X̄=${tb.toFixed(1)}≥${lim.pri_tb}${lim.pri_dr!==null?`, DR=${dr}≤${lim.pri_dr}`:""}`}
  }
  const mo = nums(samples.mooney); if (mo.length && visible.includes("mooney") && lim.mooney_min!==null) {
    const mi=mn(mo),ma=mx(mo)
    grade.mooney={dat:mi>=lim.mooney_min!&&ma<=lim.mooney_max!,tb:avg(mo),detail:`Min=${mi}≥${lim.mooney_min}, Max=${ma}≤${lim.mooney_max}`}
  }
  const ms = nums(samples.mau_sac); if (ms.length && visible.includes("mau_sac") && lim.mau_max!==null) {
    const tb=avg(ms),datMax=ms.every(v=>v<=lim.mau_max!),datDr=lim.mau_dr===null||tb<=lim.mau_dr
    grade.mau_sac={dat:datMax&&datDr,tb,detail:`Mỗi mẫu≤${lim.mau_max}${lim.mau_dr!==null?`, X̄=${tb.toFixed(1)}≤${lim.mau_dr}`:""}`}
  }

  const allDat = Object.values(grade).length > 0 && Object.values(grade).every(g=>g.dat)
  return { grade, dat_hang: allDat ? loaiCsr : loaiCsr+"RH", trang_thai: allDat ? "dat" : "khong_dat" }
}

function formatPKN(pkn: number, ngayKN: string, fCode: string): string {
  const d = new Date(ngayKN)
  const dd = String(d.getUTCDate()).padStart(2,"0")
  const mm = String(d.getUTCMonth()+1).padStart(2,"0")
  const yy = String(d.getUTCFullYear()).slice(2)
  return `PKN-${fCode}-${dd}${mm}${yy}/${pkn}`
}

function getLoaiCSR(chungLoai: string, fCode: string): string {
  const prefix = fCode === "CP" ? "SVR" : "CSR"
  return prefix + chungLoai
}

function emptyTabSamples(soMau: number): Samples {
  return Object.fromEntries(ALL_FIELDS.map(f => [f.key, Array(soMau).fill("")]))
}

function buildPrintHTML(
  dateResults: QcResult[], factoryName: string, date: string, fCode: string
): string {
  const loaiGroups = Array.from(new Set(dateResults.map(r=>r.loai_csr)))
  const sorted = [...dateResults].sort((a,b)=>{
    if (a.loai_csr < b.loai_csr) return -1
    if (a.loai_csr > b.loai_csr) return 1
    return (a.lo_kn||0)-(b.lo_kn||0)
  })
  const dateStr = new Date(date).toLocaleDateString("vi-VN")
  const tieuChuan = dateResults[0]?.tieu_chuan || "TCCS 112:2022"

  const rows = sorted.map((r,i) => {
    const g = r.grade || {}
    const cell = (k: string) => {
      const gk = g[k]
      if (!gk) return '<td style="text-align:center">—</td>'
      const color = gk.dat ? "#065f46" : "#dc2626"
      return `<td style="text-align:center;color:${color};font-weight:600">${gk.tb?.toFixed(3)??""} ${gk.dat?"✓":"✗"}</td>`
    }
    const resColor = r.trang_thai==="dat" ? "#065f46" : "#dc2626"
    return `<tr style="border-bottom:1px solid #e2e8f0">
      <td style="text-align:center;padding:4px 6px">${i+1}</td>
      <td style="padding:4px 6px;font-weight:600">${r.ma_lo}</td>
      <td style="text-align:center">${r.lo_kn||"—"}</td>
      <td style="text-align:center">${formatPKN(r.pkn, r.ngay_kn, fCode)}</td>
      ${cell("tap_chat")}${cell("tro")}${cell("bay_hoi")}${cell("nito")}${cell("po")}${cell("pri")}${cell("mooney")}${cell("mau_sac")}
      <td style="text-align:center;font-weight:700;color:${resColor}">${r.dat_hang}</td>
    </tr>`
  }).join("")

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Phiếu KQKN - ${dateStr}</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:11px;margin:20px}
    h2{text-align:center;font-size:14px;margin:8px 0}
    .info{display:flex;gap:24px;margin:8px 0;font-size:11px}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th{background:#f8fafc;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px;text-align:center}
    td{border:1px solid #e2e8f0;padding:4px 6px;font-size:10px}
    .sign{display:flex;justify-content:space-around;margin-top:40px}
    .sign div{text-align:center}
    @media print{body{margin:10px}}
  </style></head><body>
  <div style="text-align:center;font-size:10px;color:#64748b">${factoryName.toUpperCase()}</div>
  <h2>PHIẾU KẾT QUẢ KIỂM NGHIỆM</h2>
  <div class="info">
    <span><b>Ngày KN:</b> ${dateStr}</span>
    <span><b>Tiêu chuẩn:</b> ${tieuChuan}</span>
    <span><b>Chủng loại:</b> ${loaiGroups.join(", ")}</span>
  </div>
  <table>
    <thead><tr>
      <th>STT</th><th>Mã lô</th><th>Lô KN</th><th>PKN</th>
      <th>Tạp chất</th><th>Tro</th><th>Bay hơi</th><th>Nitơ</th>
      <th>Po</th><th>PRI</th><th>Mooney</th><th>Màu</th><th>Xếp hạng</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sign">
    <div><p style="margin-bottom:40px"><b>Người thử nghiệm</b></p><p>________________________</p></div>
    <div><p style="margin-bottom:40px"><b>Trưởng phòng KN</b></p><p>________________________</p></div>
  </div>
  <script>window.onload=()=>{ window.print() }</script>
  </body></html>`
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function QualityPage() {
  useScrollReveal()

  // ── Core state ──────────────────────────────────────────────────────────────
  const [factoryId,   setFactoryId]   = useState<string|null>(null)
  const [factoryCode, setFactoryCode] = useState("NM")
  const [factoryName, setFactoryName] = useState("")
  const [results,     setResults]     = useState<QcResult[]>([])
  const [customStds,  setCustomStds]  = useState<CustomStd[]>([])
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)

  // ── Navigation ───────────────────────────────────────────────────────────────
  const [mainTab,  setMainTab]  = useState<"xep_hang"|"giam_sat">("xep_hang")
  const [view,     setView]     = useState<"list"|"create">("list")

  // ── List-view state ──────────────────────────────────────────────────────────
  const [search,      setSearch]      = useState("")
  const [filterLoai,  setFilterLoai]  = useState("")
  const [filterTT,    setFilterTT]    = useState("")
  const [filterFrom,  setFilterFrom]  = useState("")
  const [filterTo,    setFilterTo]    = useState("")
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())
  const [editDateModal, setEditDateModal] = useState<string|null>(null)
  const [deleteMode,    setDeleteMode]   = useState<string|null>(null)
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(new Set())
  const [delConfirm,    setDelConfirm]   = useState<string|null>(null)
  const [expandedId,    setExpandedId]   = useState<string|null>(null)

  // ── Create-view state ────────────────────────────────────────────────────────
  const [createForm, setCreateForm] = useState<CreateForm>({
    ngay_kn: new Date().toISOString().slice(0,10),
    ngay_sx: new Date(Date.now()-86400000).toISOString().slice(0,10),
    chung_loai: "10", loai_kn: "thuong", so_mau: 6, tuy_chon_mau: 6,
    tieu_chuan: "TCCS 112:2022",
  })
  const [eligibleLots,   setEligibleLots]   = useState<LotChip[]>([])
  const [selectedLotIds, setSelectedLotIds] = useState<Set<string>>(new Set())
  const [activeTabLotId, setActiveTabLotId] = useState<string|null>(null)
  const [tabData,        setTabData]        = useState<Record<string, TabState>>({})
  const [editingResultId,setEditingResultId]= useState<string|null>(null)
  const [lotsLoading,    setLotsLoading]    = useState(false)

  // ── TCKH modal ───────────────────────────────────────────────────────────────
  const [tkhModal,    setTkhModal]    = useState(false)
  const [tkhName,     setTkhName]     = useState("")
  const [tkhLimits,   setTkhLimits]   = useState<LimitRow>(TCCS.CSR10)
  const [tkhSaving,   setTkhSaving]   = useState(false)

  // ── Giám sát state ───────────────────────────────────────────────────────────
  const [gmsFilter, setGmsFilter] = useState<"rot_ct"|"6thang"|"">("rot_ct")
  const [gmsFrom,   setGmsFrom]   = useState("")
  const [gmsTo,     setGmsTo]     = useState("")
  const [gmsLoai,   setGmsLoai]   = useState("")

  // ── Toast ────────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{msg:string;ok:boolean}|null>(null)
  const showToast = (msg: string, ok=true) => {
    setToast({msg,ok}); setTimeout(()=>setToast(null),3500)
  }

  // ── Load results ─────────────────────────────────────────────────────────────
  const loadResults = useCallback(async (fid: string) => {
    setLoading(true)
    let q = supabase.from("qc_results")
      .select("*")
      .eq("factory_id", fid)
      .order("ngay_kn", { ascending: false })
      .order("pkn",     { ascending: false })
    if (filterLoai) q = q.eq("loai_csr",  filterLoai)
    if (filterTT)   q = q.eq("trang_thai", filterTT)
    if (filterFrom) q = q.gte("ngay_kn",  filterFrom)
    if (filterTo)   q = q.lte("ngay_kn",  filterTo)
    const { data } = await q
    setResults(data || [])
    setLoading(false)
  }, [filterLoai, filterTT, filterFrom, filterTo])

  // ── Load custom standards ────────────────────────────────────────────────────
  const loadCustomStds = useCallback(async (fid: string) => {
    const { data } = await supabase.from("qc_custom_std")
      .select("*").eq("factory_id", fid).order("ten_kh")
    setCustomStds(data || [])
  }, [])

  // ── Load eligible lots ───────────────────────────────────────────────────────
  const loadEligibleLots = useCallback(async () => {
    if (!factoryId || !createForm.chung_loai) { setEligibleLots([]); return }
    const loaiCsr = getLoaiCSR(createForm.chung_loai, factoryCode)
    setLotsLoading(true)

    if (createForm.loai_kn === "kl_rot_hang") {
      // Fetch failed qc_results (no parent = original failures)
      const { data: failed } = await supabase.from("qc_results")
        .select("*").eq("factory_id", factoryId).eq("loai_csr", loaiCsr)
        .eq("trang_thai","khong_dat")
        .order("created_at", { ascending: false })

      // Dedup: keep latest per lot
      const latest = new Map<string,QcResult>()
      ;(failed||[]).forEach(r => {
        if (!r.lot_id) return
        if (!latest.has(r.lot_id)) latest.set(r.lot_id, r)
      })
      // Check none of those lot_ids have a passing result after the failure
      const latestAll = new Map<string,QcResult>()
      const { data: allRes } = await supabase.from("qc_results")
        .select("*").eq("factory_id", factoryId).eq("loai_csr", loaiCsr)
        .order("created_at", { ascending: false })
      ;(allRes||[]).forEach(r => { if(r.lot_id && !latestAll.has(r.lot_id)) latestAll.set(r.lot_id,r) })
      // Only keep lots whose LATEST result is still failing
      const stillFailed = Array.from(latest.entries()).filter(([lid]) => {
        const l = latestAll.get(lid); return l && l.trang_thai === "khong_dat"
      })
      if (!stillFailed.length) { setEligibleLots([]); setLotsLoading(false); return }
      const lotIds = stillFailed.map(([lid]) => lid)
      const { data: lots } = await supabase.from("lots")
        .select("id,factory_id,ma_lo,loai_csr,ngay_sx,trang_thai,tong_banh")
        .in("id", lotIds)
      setEligibleLots((lots||[]).map(l => ({ ...l, prev_qc: latest.get(l.id) })))

    } else if (createForm.loai_kn === "kl_6thang") {
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-6)
      const { data: lots } = await supabase.from("lots")
        .select("id,factory_id,ma_lo,loai_csr,ngay_sx,trang_thai,tong_banh")
        .eq("factory_id", factoryId).eq("loai_csr", loaiCsr)
        .neq("trang_thai","Xuất hàng")
        .lte("ngay_sx", cutoff.toISOString().slice(0,10))
        .order("ngay_sx", { ascending: true })
      // Attach latest qc_result if exists
      const { data: qcAll } = await supabase.from("qc_results")
        .select("*").eq("factory_id",factoryId).eq("loai_csr",loaiCsr)
        .order("created_at",{ascending:false})
      const latestQC = new Map<string,QcResult>()
      ;(qcAll||[]).forEach(r=>{ if(r.lot_id&&!latestQC.has(r.lot_id)) latestQC.set(r.lot_id,r) })
      setEligibleLots((lots||[]).map(l=>({...l,prev_qc:latestQC.get(l.id)})))

    } else {
      // Normal: Hoàn thành + not yet in qc_results
      if (!createForm.ngay_sx) { setEligibleLots([]); setLotsLoading(false); return }
      const { data: existingQC } = await supabase.from("qc_results")
        .select("lot_id").eq("factory_id", factoryId).not("lot_id","is",null)
      const excludeIds = new Set((existingQC||[]).map(r=>r.lot_id))
      const { data: lots } = await supabase.from("lots")
        .select("id,factory_id,ma_lo,loai_csr,ngay_sx,trang_thai,tong_banh")
        .eq("factory_id", factoryId).eq("loai_csr", loaiCsr)
        .eq("ngay_sx", createForm.ngay_sx).eq("trang_thai","Hoàn thành")
        .order("num", {ascending:true})
      setEligibleLots((lots||[]).filter(l=>!excludeIds.has(l.id)))
    }
    setLotsLoading(false)
  }, [factoryId, factoryCode, createForm.chung_loai, createForm.ngay_sx, createForm.loai_kn])

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fid = localStorage.getItem("erp_factory")
    if (!fid) return
    setFactoryId(fid)
    loadResults(fid)
    loadCustomStds(fid)
    supabase.from("factories").select("*").eq("id",fid).limit(1)
      .then(({data}) => {
        const f = data?.[0]
        if (!f) return
        const allVals = Object.values(f).filter(Boolean).join(" ").toLowerCase()
        const code = allVals.includes("phuoc")||allVals.includes("kampong") ? "PHK"
          : allVals.includes("cua")||allVals.includes("paris") ? "CP" : "NM"
        setFactoryCode(code)
        setFactoryName(f.ten_nha_may || f.name || f.slug || "Nhà máy")
      })
  }, [loadResults, loadCustomStds])

  useEffect(() => {
    if (view === "create") loadEligibleLots()
  }, [loadEligibleLots, view])

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const getNextPKN = async (fid: string, year: number): Promise<number> => {
    const { data } = await supabase.from("qc_results").select("pkn")
      .eq("factory_id",fid).gte("ngay_kn",`${year}-01-01`).lte("ngay_kn",`${year}-12-31`)
      .order("pkn",{ascending:false}).limit(1)
    return (data?.[0]?.pkn ?? 0) + 1
  }

  const getNextLoKN = async (fid: string, ngayKN: string): Promise<number> => {
    const { count } = await supabase.from("qc_results")
      .select("id",{count:"exact",head:true}).eq("factory_id",fid).eq("ngay_kn",ngayKN)
    return (count ?? 0) + 1
  }

  // ── Create flow ──────────────────────────────────────────────────────────────
  const openCreate = (prefillDate?: string) => {
    const kn = prefillDate || new Date().toISOString().slice(0,10)
    const sx = new Date(new Date(kn).getTime()-86400000).toISOString().slice(0,10)
    setCreateForm({ ngay_kn:kn, ngay_sx:sx, chung_loai:"10", loai_kn:"thuong",
      so_mau:6, tuy_chon_mau:6, tieu_chuan:"TCCS 112:2022" })
    setEligibleLots([]); setSelectedLotIds(new Set())
    setActiveTabLotId(null); setTabData({}); setEditingResultId(null)
    setEditDateModal(null)
    setView("create")
  }

  const openEditResult = (r: QcResult) => {
    const cl = r.chung_loai || r.loai_csr.replace(/^(CSR|SVR)/,"")
    setCreateForm({
      ngay_kn: r.ngay_kn, ngay_sx: r.ngay_sx, chung_loai: cl,
      loai_kn: r.loai_kn, so_mau: r.so_mau, tuy_chon_mau: r.so_mau,
      tieu_chuan: r.tieu_chuan,
    })
    const fakeLot: LotChip = {
      id: r.lot_id || r.id, factory_id: r.factory_id, ma_lo: r.ma_lo,
      loai_csr: r.loai_csr, ngay_sx: r.ngay_sx, trang_thai:"Hoàn thành", tong_banh:0
    }
    const pad = (arr: any[]|undefined, n: number) =>
      (arr||[]).map(String).concat(Array(Math.max(0,n-(arr?.length||0))).fill(""))
    setEligibleLots([fakeLot])
    setSelectedLotIds(new Set([fakeLot.id]))
    setTabData({ [fakeLot.id]: {
      samples: Object.fromEntries(ALL_FIELDS.map(f=>[f.key,pad((r.samples as any)?.[f.key],r.so_mau)])),
      preview: null
    }})
    setActiveTabLotId(fakeLot.id)
    setEditingResultId(r.id)
    setEditDateModal(null)
    setView("create")
  }

  const toggleLot = (lot: LotChip) => {
    const next = new Set(selectedLotIds)
    if (next.has(lot.id)) {
      next.delete(lot.id)
      const nextTab = { ...tabData }; delete nextTab[lot.id]; setTabData(nextTab)
      setActiveTabLotId(next.size > 0 ? Array.from(next)[next.size-1] : null)
    } else {
      next.add(lot.id)
      const pad = (arr: any[]|undefined, n: number) =>
        (arr||[]).map(String).concat(Array(Math.max(0,n-(arr?.length||0))).fill(""))
      const initSamples: Samples = lot.prev_qc
        ? Object.fromEntries(ALL_FIELDS.map(f=>[f.key,pad((lot.prev_qc!.samples as any)?.[f.key],createForm.so_mau)]))
        : emptyTabSamples(createForm.so_mau)
      setTabData(prev => ({ ...prev, [lot.id]: { samples:initSamples, preview:null } }))
      setActiveTabLotId(lot.id)
    }
    setSelectedLotIds(next)
  }

  const updateSample = (lotId: string, field: string, idx: number, val: string) => {
    setTabData(prev => {
      const td = prev[lotId]
      if (!td) return prev
      const newSamples = {
        ...td.samples,
        [field]: td.samples[field].map((v,i) => i===idx ? val : v)
      }
      const loaiCsr = getLoaiCSR(createForm.chung_loai, factoryCode)
      const customLimits = customStds.find(s=>s.id===createForm.tieu_chuan)?.limits
      const preview = calcGrade(newSamples, loaiCsr, createForm.tieu_chuan, customLimits)
      return { ...prev, [lotId]: { samples:newSamples, preview } }
    })
  }

  const handleCreateFormChange = (patch: Partial<CreateForm>) => {
    setCreateForm(prev => {
      const next = { ...prev, ...patch }
      // Resize all tab samples if so_mau changed
      if (patch.so_mau !== undefined && patch.so_mau !== prev.so_mau) {
        setTabData(td => Object.fromEntries(
          Object.entries(td).map(([lid,ts]) => [lid, {
            samples: Object.fromEntries(
              Object.entries(ts.samples).map(([k,v]) => [k, Array(patch.so_mau!).fill("").map((_,i)=>v[i]??"")])
            ), preview: null
          }])
        ))
      }
      return next
    })
  }

  const isTabFilled = (lotId: string): boolean => {
    const td = tabData[lotId]; if (!td) return false
    const loaiCsr = getLoaiCSR(createForm.chung_loai, factoryCode)
    return getVisibleFields(loaiCsr).every(field => {
      const vals = (td.samples[field]||[]).filter(v=>v!==""&&!isNaN(Number(v)))
      return vals.length >= createForm.so_mau
    })
  }

  // ── Save batch ───────────────────────────────────────────────────────────────
  const handleSaveBatch = async () => {
    if (!factoryId || selectedLotIds.size === 0) return
    const unfilledLots = Array.from(selectedLotIds).filter(id=>!isTabFilled(id))
    if (unfilledLots.length > 0) {
      const names = unfilledLots.map(id=>eligibleLots.find(l=>l.id===id)?.ma_lo||id).join(", ")
      showToast(`Chưa nhập đủ số liệu: ${names}`, false); return
    }
    setSaving(true)
    const year = new Date(createForm.ngay_kn).getFullYear()
    const loaiCsr = getLoaiCSR(createForm.chung_loai, factoryCode)
    const customLimits = customStds.find(s=>s.id===createForm.tieu_chuan)?.limits
    const user = JSON.parse(localStorage.getItem("erp_user")||"{}")

    if (editingResultId) {
      // Update single existing result
      const lotId = Array.from(selectedLotIds)[0]
      const td = tabData[lotId]
      if (!td) { setSaving(false); return }
      const samples = Object.fromEntries(Object.entries(td.samples).map(([k,v])=>[k,v.map(Number)]))
      const { grade, dat_hang, trang_thai } = calcGrade(td.samples, loaiCsr, createForm.tieu_chuan, customLimits)
      const { error } = await supabase.from("qc_results").update({
        ma_lo: eligibleLots[0]?.ma_lo,
        ngay_kn: createForm.ngay_kn, ngay_sx: createForm.ngay_sx,
        chung_loai: createForm.chung_loai, loai_csr: loaiCsr,
        loai_kn: createForm.loai_kn, tieu_chuan: createForm.tieu_chuan,
        so_mau: createForm.so_mau, samples, grade, dat_hang, trang_thai,
      }).eq("id", editingResultId)
      if (error) { showToast("Lỗi: "+error.message, false); setSaving(false); return }
      showToast("Đã cập nhật phiếu kiểm nghiệm")
    } else {
      // Insert batch
      let nextPKN = await getNextPKN(factoryId, year)
      let nextLoKN = await getNextLoKN(factoryId, createForm.ngay_kn)
      const isRetest = createForm.loai_kn==="kl_rot_hang"||createForm.loai_kn==="kl_6thang"

      for (const lotId of selectedLotIds) {
        const lot = eligibleLots.find(l=>l.id===lotId)
        const td  = tabData[lotId]
        if (!lot||!td) continue
        const samples = Object.fromEntries(Object.entries(td.samples).map(([k,v])=>[k,v.map(Number)]))
        const { grade, dat_hang, trang_thai } = calcGrade(td.samples, loaiCsr, createForm.tieu_chuan, customLimits)
        const parentId = isRetest ? lot.prev_qc?.id : null
        const lan = parentId ? ((lot.prev_qc?.lan||1)+1) : 1

        // Compute notes for re-test
        const notes: NoteEntry[] = []
        if (parentId && lot.prev_qc) {
          ALL_FIELDS.forEach(f => {
            const origVals = ((lot.prev_qc!.samples as any)?.[f.key]||[]).map(Number)
            ;(samples[f.key]||[]).forEach((v:number,i:number)=>{
              if (v!==(origVals[i]||0)) notes.push({
                field:`${f.label} M${i+1}`, old_val:origVals[i]||0, new_val:v,
                timestamp: new Date().toISOString(), user: user.full_name||"—"
              })
            })
          })
        }

        const { error } = await supabase.from("qc_results").insert({
          factory_id:factoryId, lot_id:lot.id, ma_lo:lot.ma_lo,
          pkn:nextPKN, lo_kn:nextLoKN,
          ngay_kn:createForm.ngay_kn, ngay_sx:lot.ngay_sx,
          chung_loai:createForm.chung_loai, loai_csr:loaiCsr,
          loai_kn:createForm.loai_kn, tieu_chuan:createForm.tieu_chuan,
          so_mau:createForm.so_mau, samples, grade, dat_hang, trang_thai,
          parent_id:parentId||null, lan, notes,
        })
        if (error) { showToast(`Lỗi lô ${lot.ma_lo}: ${error.message}`, false); setSaving(false); return }
        nextPKN++; nextLoKN++
      }
      showToast(`Đã lưu ${selectedLotIds.size} phiếu kiểm nghiệm`)
    }
    setSaving(false)
    setView("list")
    loadResults(factoryId)
    setEditDateModal(null)
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!factoryId) return
    const { error } = await supabase.from("qc_results").delete().eq("id",id)
    if (error) { showToast("Lỗi xóa: "+error.message, false); return }
    setDelConfirm(null); showToast("Đã xóa phiếu kiểm nghiệm")
    loadResults(factoryId)
  }

  const handleBulkDelete = async () => {
    if (!factoryId || selectedDeleteIds.size===0) return
    for (const id of selectedDeleteIds) {
      await supabase.from("qc_results").delete().eq("id",id)
    }
    setSelectedDeleteIds(new Set()); setDeleteMode(null)
    showToast(`Đã xóa ${selectedDeleteIds.size} phiếu`)
    loadResults(factoryId)
  }

  // ── TCKH save ────────────────────────────────────────────────────────────────
  const handleSaveTKH = async () => {
    if (!factoryId || !tkhName.trim()) return
    setTkhSaving(true)
    const { error } = await supabase.from("qc_custom_std").insert({
      factory_id:factoryId, ten_kh:tkhName.trim(), limits:tkhLimits
    })
    if (error) { showToast("Lỗi lưu tiêu chuẩn: "+error.message, false) }
    else { showToast("Đã lưu tiêu chuẩn "+tkhName); loadCustomStds(factoryId) }
    setTkhSaving(false); setTkhModal(false); setTkhName("")
  }

  // ── Derived data ──────────────────────────────────────────────────────────────
  const filtered = results.filter(r => {
    if (search && !r.ma_lo?.toLowerCase().includes(search.toLowerCase())
        && !String(r.pkn).includes(search)) return false
    return true
  })

  const dateGroups = Array.from(
    filtered.reduce((m,r)=>{ const d=r.ngay_kn?.slice(0,10)||"?"; if(!m.has(d)) m.set(d,[]); m.get(d)!.push(r); return m }, new Map<string,QcResult[]>())
  ).sort((a,b)=>b[0].localeCompare(a[0]))

  const latestPerLot = new Map<string,QcResult>()
  results.forEach(r=>{
    const k=r.lot_id||r.ma_lo
    const ex=latestPerLot.get(k)
    if(!ex||(r.lan||1)>(ex.lan||1)||new Date(r.created_at||0)>new Date(ex.created_at||0))
      latestPerLot.set(k,r)
  })
  const deduped = Array.from(latestPerLot.values())
  const stats = {
    total:deduped.length,
    dat:deduped.filter(r=>r.trang_thai==="dat").length,
    khongDat:deduped.filter(r=>r.trang_thai==="khong_dat").length,
    tyLe: deduped.length ? Math.round(deduped.filter(r=>r.trang_thai==="dat").length/deduped.length*100) : 0,
  }

  // Giám sát: results that are re-tests (have parent_id)
  const gmsResults = results.filter(r=>r.parent_id).filter(r=>{
    if (gmsFilter==="rot_ct") return r.trang_thai==="dat" // passed after failing
    if (gmsFilter==="6thang") return r.loai_kn==="kl_6thang"
    return true
  }).filter(r=>{
    if (gmsLoai && r.loai_csr!==gmsLoai) return false
    if (gmsFrom && r.ngay_kn<gmsFrom) return false
    if (gmsTo   && r.ngay_kn>gmsTo)   return false
    return true
  })

  const gmsStats = {
    rotCT: results.filter(r=>r.parent_id&&r.trang_thai==="dat").length,
    thang6: results.filter(r=>r.loai_kn==="kl_6thang"&&r.parent_id).length,
    total: results.filter(r=>r.parent_id).length,
  }

  // Create view: loaiCsr derived from form
  const createLoaiCSR = getLoaiCSR(createForm.chung_loai, factoryCode)
  const createVisibleFields = ALL_FIELDS.filter(f=>getVisibleFields(createLoaiCSR).includes(f.key))

  // ── Tiêu chuẩn options for dropdown ──────────────────────────────────────────
  const tieuChuanOptions = [
    { val:"TCCS 112:2022", label:"TCCS 112:2022" },
    { val:"TCVN 3769:2016", label:"TCVN 3769:2016" },
    ...customStds.map(s=>({ val:s.id, label:`TCKH: ${s.ten_kh}` })),
    { val:"new", label:"+ Thêm tiêu chuẩn KH mới..." },
  ]

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="pb-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-bold ${toast.ok?"bg-emerald-600":"bg-red-600"}`}>
          {toast.ok ? <Check size={16}/> : <AlertTriangle size={16}/>} {toast.msg}
        </div>
      )}

      {/* ── CREATE VIEW ─────────────────────────────────────────────────────── */}
      {view === "create" && (
        <div>
          {/* Top bar */}
          <div className="flex items-center justify-between mb-5">
            <button onClick={()=>{setView("list");setEditingResultId(null)}}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
              <ArrowLeft size={16}/> Quay lại
            </button>
            <div className="flex items-center gap-2">
              <ClipboardCheck size={18} className="text-emerald-600"/>
              <h2 className="text-lg font-extrabold text-slate-800">
                {editingResultId ? "Sửa phiếu kiểm nghiệm" : "Tạo phiếu kiểm nghiệm"}
              </h2>
            </div>
            <button onClick={handleSaveBatch} disabled={saving||selectedLotIds.size===0}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-40">
              {saving ? <RefreshCw size={15} className="animate-spin"/> : <Check size={15}/>}
              {saving ? "Đang lưu..." : editingResultId ? "Lưu thay đổi" : `Lưu ${selectedLotIds.size} phiếu`}
            </button>
          </div>

          {/* Form header card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 mb-4">
            <div className="grid grid-cols-5 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày KN <span className="text-red-500">*</span></label>
                <input type="date" value={createForm.ngay_kn}
                  onChange={e=>handleCreateFormChange({ngay_kn:e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày SX <span className="text-red-500">*</span></label>
                <input type="date" value={createForm.ngay_sx}
                  onChange={e=>handleCreateFormChange({ngay_sx:e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Chủng loại <span className="text-red-500">*</span></label>
                <select value={createForm.chung_loai}
                  onChange={e=>{ handleCreateFormChange({chung_loai:e.target.value}); setSelectedLotIds(new Set()); setTabData({}) }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  {CHUNG_LOAI.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại KN <span className="text-red-500">*</span></label>
                <select value={createForm.loai_kn}
                  onChange={e=>{
                    const opt = LOAI_KN_OPTIONS.find(o=>o.val===e.target.value)
                    handleCreateFormChange({loai_kn:e.target.value, so_mau: opt?.defaultMau||6})
                    setSelectedLotIds(new Set()); setTabData({})
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  {LOAI_KN_OPTIONS.map(o=><option key={o.val} value={o.val}>{o.label}</option>)}
                </select>
                {createForm.loai_kn==="tuy_chon" && (
                  <input type="number" min={1} max={30} value={createForm.tuy_chon_mau}
                    onChange={e=>handleCreateFormChange({tuy_chon_mau:+e.target.value, so_mau:+e.target.value})}
                    placeholder="Số mẫu" className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tiêu chuẩn <span className="text-red-500">*</span></label>
                <select value={createForm.tieu_chuan}
                  onChange={e=>{
                    if (e.target.value==="new") {
                      const lk = limitKey(createLoaiCSR)
                      setTkhLimits(TCCS[lk]||TCCS.CSR10); setTkhModal(true)
                    } else {
                      handleCreateFormChange({tieu_chuan:e.target.value})
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  {tieuChuanOptions.map(o=><option key={o.val} value={o.val}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Lot chip panel — hidden in edit mode */}
          {!editingResultId && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 mb-4 scroll-reveal">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-bold text-slate-700">
                  {createForm.loai_kn==="kl_6thang" ? "Lô tồn kho > 6 tháng" :
                   createForm.loai_kn==="kl_rot_hang" ? "Lô rớt hạng cần KN lại" :
                   "Lô chưa kiểm nghiệm"}
                </span>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">
                  {lotsLoading ? "..." : eligibleLots.length}
                </span>
                {selectedLotIds.size > 0 && (
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">
                    Đã chọn {selectedLotIds.size}
                  </span>
                )}
              </div>
              {lotsLoading ? (
                <div className="text-sm text-slate-400 py-4 text-center">Đang tải lô...</div>
              ) : eligibleLots.length === 0 ? (
                <div className="text-sm text-slate-400 py-4 text-center">
                  {!createForm.ngay_sx && createForm.loai_kn==="thuong" ? "Vui lòng chọn Ngày SX" : "Không có lô phù hợp"}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {eligibleLots.map(lot => {
                    const sel = selectedLotIds.has(lot.id)
                    return (
                      <button key={lot.id} onClick={()=>toggleLot(lot)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all btn-press ${
                          sel ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
                        {sel && <span className="mr-1">✓</span>}
                        {lot.ma_lo}
                        {lot.prev_qc && <span className="ml-1 opacity-60">{lot.prev_qc.trang_thai==="khong_dat"?"✗":"↺"}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab panel */}
          {selectedLotIds.size > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden scroll-reveal">
              {/* Tab bar */}
              <div className="flex border-b border-slate-200 overflow-x-auto bg-slate-50">
                {Array.from(selectedLotIds).map(lotId => {
                  const lot = eligibleLots.find(l=>l.id===lotId)
                  const filled = isTabFilled(lotId)
                  const preview = tabData[lotId]?.preview
                  const active = activeTabLotId===lotId
                  const icon = !filled ? "⏳" : preview?.trang_thai==="dat" ? "✓" : "✗"
                  const iconColor = !filled ? "text-slate-400" : preview?.trang_thai==="dat" ? "text-emerald-600" : "text-red-500"
                  return (
                    <button key={lotId} onClick={()=>setActiveTabLotId(lotId)}
                      className={`flex items-center gap-1.5 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-all ${
                        active ? "border-emerald-500 text-emerald-700 bg-white"
                               : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                      <span className={iconColor}>{icon}</span>
                      {lot?.ma_lo || lotId.slice(0,8)}
                    </button>
                  )
                })}
              </div>

              {/* Tab content */}
              {activeTabLotId && tabData[activeTabLotId] && (() => {
                const lot = eligibleLots.find(l=>l.id===activeTabLotId)
                const td  = tabData[activeTabLotId]
                const preview = td.preview
                return (
                  <div className="p-5">
                    {/* Lot header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-extrabold text-slate-800">{lot?.ma_lo}</span>
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">{createLoaiCSR}</span>
                        <span className="text-xs text-slate-400">• {createForm.so_mau} mẫu</span>
                      </div>
                      {preview && (
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-bold ${
                          preview.trang_thai==="dat" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                          {preview.trang_thai==="dat" ? <Check size={14}/> : <X size={14}/>}
                          {preview.dat_hang}
                        </div>
                      )}
                    </div>

                    {/* Indicator cards grid */}
                    <div className="grid grid-cols-1 gap-4">
                      {createVisibleFields.map(f => {
                        const g = preview?.grade?.[f.key]
                        return (
                          <div key={f.key} className={`rounded-xl border p-4 ${
                            g?.dat===false ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
                            <div className="flex items-center justify-between mb-3">
                              <span className="font-bold text-slate-700 text-sm">{f.label}</span>
                              {g && (
                                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                                  g.dat ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                                  {g.dat ? "✓ Đạt" : "✗ Không đạt"} · {g.detail}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              {Array.from({length:createForm.so_mau},(_,i)=>(
                                <div key={i} className="flex flex-col items-center gap-1">
                                  <span className="text-xs text-emerald-600 font-bold">M{i+1}</span>
                                  <input
                                    value={(td.samples[f.key]?.[i] ?? "") as string}
                                    onChange={e=>updateSample(activeTabLotId, f.key, i, e.target.value)}
                                    className="w-16 h-14 text-center border border-slate-200 rounded-xl text-sm font-mono outline-none focus:border-emerald-400 focus:bg-emerald-50 focus:ring-1 focus:ring-emerald-200"
                                    placeholder="—"/>
                                </div>
                              ))}
                            </div>
                            {/* Show previous values for re-test */}
                            {lot?.prev_qc && (
                              <div className="mt-2 flex gap-2 flex-wrap">
                                <span className="text-xs text-slate-400 self-center">KQ cũ:</span>
                                {((lot.prev_qc.samples as any)?.[f.key]||[]).map((v:number,i:number)=>(
                                  <span key={i} className="text-xs text-slate-400 font-mono">{v||"—"}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── LIST / GIÁM SÁT VIEW ─────────────────────────────────────────── */}
      {view === "list" && (
        <div>
          {/* Page header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800">Kiểm nghiệm</h1>
              <p className="text-sm text-slate-500 mt-0.5">Kết quả kiểm nghiệm — TCCS / TCVN / TCKH</p>
            </div>
            <button onClick={()=>openCreate()}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all btn-press">
              <Plus size={16}/> Tạo phiếu KN
            </button>
          </div>

          {/* Tab nav */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5 w-fit">
            {([
              { val:"xep_hang", label:"Xếp hạng", icon:Star },
              { val:"giam_sat", label:"Giám sát KN", icon:Eye },
            ] as const).map(t => (
              <button key={t.val} onClick={()=>setMainTab(t.val)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  mainTab===t.val ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>
                <t.icon size={14}/> {t.label}
              </button>
            ))}
          </div>

          {/* ── XẾP HẠNG TAB ─────────────────────────────────────────────── */}
          {mainTab === "xep_hang" && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3 mb-5 scroll-reveal">
                {[
                  { label:"Tổng lô (mới nhất)", value:stats.total,     color:"text-slate-700",   Icon:ClipboardCheck, ic:"text-slate-400"   },
                  { label:"Đạt",                 value:stats.dat,       color:"text-emerald-600", Icon:Check,          ic:"text-emerald-400" },
                  { label:"Không đạt",           value:stats.khongDat, color:"text-red-500",     Icon:XCircle,        ic:"text-red-400"     },
                  { label:"Tỷ lệ đạt",           value:stats.tyLe+"%", color:"text-blue-600",    Icon:BarChart2,      ic:"text-blue-400"    },
                ].map(s=>(
                  <div key={s.label} className="bg-white rounded-xl border border-slate-200 shadow-md p-4 text-center">
                    <s.Icon size={20} className={`mx-auto mb-1 ${s.ic} opacity-80`}/>
                    <div className={`text-2xl font-extrabold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Filter bar */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center scroll-reveal">
                <div className="flex items-center gap-2 flex-1 min-w-40">
                  <Search size={14} className="text-slate-400"/>
                  <input value={search} onChange={e=>setSearch(e.target.value)}
                    placeholder="Tìm mã lô, PKN..." className="flex-1 text-sm outline-none"/>
                </div>
                <select value={filterLoai} onChange={e=>setFilterLoai(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none">
                  <option value="">Tất cả loại</option>
                  {CHUNG_LOAI.map(c=><option key={c} value={getLoaiCSR(c,factoryCode)}>{getLoaiCSR(c,factoryCode)}</option>)}
                </select>
                <select value={filterTT} onChange={e=>setFilterTT(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none">
                  <option value="">Tất cả KQ</option>
                  <option value="dat">Đạt</option>
                  <option value="khong_dat">Không đạt</option>
                </select>
                <input type="date" value={filterFrom} onChange={e=>setFilterFrom(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none"/>
                <span className="text-slate-400">→</span>
                <input type="date" value={filterTo} onChange={e=>setFilterTo(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none"/>
                {(search||filterLoai||filterTT||filterFrom||filterTo) && (
                  <button onClick={()=>{setSearch("");setFilterLoai("");setFilterTT("");setFilterFrom("");setFilterTo("")}}
                    className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-500">
                    <X size={13}/> Xóa lọc
                  </button>
                )}
              </div>

              {/* Date-grouped list */}
              {loading ? (
                <div className="bg-white rounded-xl p-12 text-center text-slate-400">Đang tải...</div>
              ) : dateGroups.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
                  <ClipboardCheck size={40} className="mx-auto mb-3 opacity-30"/>
                  <p>Không có kết quả kiểm nghiệm nào</p>
                </div>
              ) : (
                <div className="space-y-3 scroll-reveal">
                  {dateGroups.map(([date, dateResults]) => {
                    const expanded = expandedDates.has(date)
                    const inDeleteMode = deleteMode===date
                    const dateDat = dateResults.filter(r=>r.trang_thai==="dat").length
                    const hasRetest = dateResults.some(r=>r.parent_id)

                    return (
                      <div key={date} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        {/* Date header */}
                        <div className={`px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors ${expanded?"border-b border-slate-100":""}`}>
                          <div className="flex items-center gap-3 cursor-pointer flex-1"
                            onClick={()=>{ const next=new Set(expandedDates); expanded?next.delete(date):next.add(date); setExpandedDates(next) }}>
                            {expanded ? <ChevronDown size={16} className="text-slate-400"/> : <ChevronRight size={16} className="text-slate-400"/>}
                            <span className="font-extrabold text-slate-800 text-base">
                              {new Date(date).toLocaleDateString("vi-VN")}
                            </span>
                            <span className="px-2 py-0.5 bg-white border border-slate-200 text-xs font-bold rounded-full text-slate-600">
                              {dateResults.length} phiếu
                            </span>
                            <span className="text-xs text-emerald-600 font-bold">{dateDat} đạt</span>
                            {hasRetest && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">↺ KN lại</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {inDeleteMode ? (
                              <>
                                <span className="text-xs text-red-600 font-bold">Chọn phiếu cần xóa...</span>
                                <button onClick={handleBulkDelete}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-red-600 text-white text-xs font-bold rounded-lg">
                                  <Trash2 size={11}/> Xóa {selectedDeleteIds.size}
                                </button>
                                <button onClick={()=>{setDeleteMode(null);setSelectedDeleteIds(new Set())}}
                                  className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg">Hủy</button>
                              </>
                            ) : (
                              <>
                                <button onClick={e=>{e.stopPropagation();openCreate(date)}}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition-colors">
                                  <Plus size={11}/> Thêm
                                </button>
                                <button onClick={e=>{e.stopPropagation();setEditDateModal(date);setExpandedDates(p=>{const n=new Set(p);n.add(date);return n})}}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg transition-colors">
                                  <Edit2 size={11}/> Sửa
                                </button>
                                <button onClick={e=>{e.stopPropagation();setDeleteMode(date);setSelectedDeleteIds(new Set());setExpandedDates(p=>{const n=new Set(p);n.add(date);return n})}}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg transition-colors">
                                  <Trash2 size={11}/> Xóa
                                </button>
                                <button onClick={e=>{e.stopPropagation();
                                  const w=window.open("","_blank","width=960,height=680")
                                  if(w){w.document.write(buildPrintHTML(dateResults,factoryName,date,factoryCode));w.document.close()}}}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-lg transition-colors">
                                  <Printer size={11}/> PDF
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Expanded rows */}
                        {expanded && (
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 border-b border-slate-100">
                              <tr>
                                {inDeleteMode && <th className="px-3 py-2 w-8"/>}
                                {["PKN","Lô KN","Mã lô","Loại","Tiêu chuẩn","Tạp chất","Tro","PRI","Kết quả",""].map(h=>(
                                  <th key={h} className="px-3 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {dateResults.map(r => (
                                <>
                                  <tr key={r.id} className="hover:bg-slate-50 transition-colors cursor-pointer row-hover"
                                    onClick={()=>setExpandedId(expandedId===r.id?null:r.id)}>
                                    {inDeleteMode && (
                                      <td className="px-3 py-2.5" onClick={e=>e.stopPropagation()}>
                                        <input type="checkbox" checked={selectedDeleteIds.has(r.id)}
                                          onChange={e=>{
                                            const n=new Set(selectedDeleteIds)
                                            e.target.checked?n.add(r.id):n.delete(r.id)
                                            setSelectedDeleteIds(n)
                                          }} className="rounded"/>
                                      </td>
                                    )}
                                    <td className="px-3 py-2.5 font-bold text-violet-700 text-xs">
                                      {formatPKN(r.pkn, r.ngay_kn, factoryCode)}
                                      {r.parent_id && <span className="ml-1 px-1 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded">KN lại</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-center text-xs text-slate-500 font-mono">{r.lo_kn||"—"}</td>
                                    <td className="px-3 py-2.5 font-semibold text-emerald-700">{r.ma_lo}</td>
                                    <td className="px-3 py-2.5">
                                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs font-bold">{r.loai_csr}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-slate-400 text-xs">{r.tieu_chuan}</td>
                                    <td className="px-3 py-2.5 text-xs text-slate-600">
                                      {r.grade?.tap_chat?.tb?.toFixed(3)??"-"}
                                      <span className={`ml-1 ${r.grade?.tap_chat?.dat?"text-emerald-500":"text-red-500"}`}>
                                        {r.grade?.tap_chat?.dat!=null?(r.grade.tap_chat.dat?"✓":"✗"):""}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-xs text-slate-600">
                                      {r.grade?.tro?.tb?.toFixed(3)??"-"}
                                      <span className={`ml-1 ${r.grade?.tro?.dat?"text-emerald-500":"text-red-500"}`}>
                                        {r.grade?.tro?.dat!=null?(r.grade.tro.dat?"✓":"✗"):""}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-xs text-slate-600">
                                      {r.grade?.pri?.tb?.toFixed(1)??"-"}
                                      <span className={`ml-1 ${r.grade?.pri?.dat?"text-emerald-500":"text-red-500"}`}>
                                        {r.grade?.pri?.dat!=null?(r.grade.pri.dat?"✓":"✗"):""}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                        r.trang_thai==="dat"?"bg-emerald-100 text-emerald-700":"bg-red-100 text-red-600"}`}>
                                        {r.trang_thai==="dat"?`✓ ${r.dat_hang}`:`✗ ${r.dat_hang||"Rớt"}`}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <button onClick={e=>{e.stopPropagation();setExpandedId(expandedId===r.id?null:r.id)}}
                                        className="p-1 hover:bg-slate-100 rounded-lg">
                                        {expandedId===r.id?<ChevronDown size={13} className="text-slate-400"/>:<ChevronRight size={13} className="text-slate-400"/>}
                                      </button>
                                    </td>
                                  </tr>
                                  {/* Expanded detail */}
                                  {expandedId===r.id && (
                                    <tr key={r.id+"_exp"}>
                                      <td colSpan={inDeleteMode?11:10} className="px-4 py-4 bg-slate-50">
                                        <div className="flex flex-wrap gap-3 text-xs">
                                          {ALL_FIELDS.filter(f=>r.grade?.[f.key]||(r.samples as any)?.[f.key]?.some((v:any)=>v>0)).map(f=>{
                                            const vals=((r.samples as any)?.[f.key]||[]) as number[]
                                            const g=r.grade?.[f.key]
                                            return (
                                              <div key={f.key} className={`rounded-xl p-3 border min-w-[110px] ${g?.dat===false?"border-red-200 bg-red-50":"border-slate-200 bg-white"}`}>
                                                <div className="font-bold text-slate-600 mb-1.5">{f.label}</div>
                                                {vals.map((v,i)=>(
                                                  <div key={i} className="flex justify-between gap-3">
                                                    <span className="text-slate-400">M{i+1}</span>
                                                    <span className="font-mono font-semibold">{v||"—"}</span>
                                                  </div>
                                                ))}
                                                {g && (
                                                  <div className={`mt-1.5 pt-1 border-t text-[10px] ${g.dat?"text-emerald-600":"text-red-500"}`}>
                                                    {g.dat?"✓ Đạt":"✗ Không đạt"}<br/>
                                                    <span className="text-slate-400">{g.detail}</span>
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
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ── GIÁM SÁT KN TAB ────────────────────────────────────────────── */}
          {mainTab === "giam_sat" && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-5 scroll-reveal">
                {[
                  { label:"KN lại rớt CT", value:gmsStats.rotCT, color:"text-amber-600", Icon:RefreshCw, ic:"text-amber-400" },
                  { label:"KN lại 6 tháng",value:gmsStats.thang6,color:"text-blue-600",  Icon:Clock,     ic:"text-blue-400"  },
                  { label:"Tổng giám sát", value:gmsStats.total, color:"text-slate-700", Icon:Eye,        ic:"text-slate-400" },
                ].map(s=>(
                  <div key={s.label} className="bg-white rounded-xl border border-slate-200 shadow-md p-4 text-center">
                    <s.Icon size={20} className={`mx-auto mb-1 ${s.ic} opacity-80`}/>
                    <div className={`text-2xl font-extrabold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Filter bar */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center scroll-reveal">
                <button onClick={()=>setGmsFilter("rot_ct")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-xl border-2 transition-all ${gmsFilter==="rot_ct"?"border-amber-500 bg-amber-50 text-amber-700":"border-slate-200 text-slate-500"}`}>
                  <RefreshCw size={13}/> KN lại rớt CT ({gmsStats.rotCT})
                </button>
                <button onClick={()=>setGmsFilter("6thang")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-xl border-2 transition-all ${gmsFilter==="6thang"?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-500"}`}>
                  <Clock size={13}/> KN lại 6 tháng ({gmsStats.thang6})
                </button>
                <button onClick={()=>setGmsFilter("")}
                  className={`px-3 py-1.5 text-sm font-bold rounded-xl border-2 transition-all ${gmsFilter===""?"border-slate-500 bg-slate-100 text-slate-700":"border-slate-200 text-slate-500"}`}>
                  Tất cả
                </button>
                <div className="flex items-center gap-2 ml-auto">
                  <input type="date" value={gmsFrom} onChange={e=>setGmsFrom(e.target.value)}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none"/>
                  <span className="text-slate-400">→</span>
                  <input type="date" value={gmsTo} onChange={e=>setGmsTo(e.target.value)}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none"/>
                  <select value={gmsLoai} onChange={e=>setGmsLoai(e.target.value)}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none">
                    <option value="">Tất cả loại</option>
                    {CHUNG_LOAI.map(c=><option key={c} value={getLoaiCSR(c,factoryCode)}>{getLoaiCSR(c,factoryCode)}</option>)}
                  </select>
                </div>
              </div>

              {/* Giám sát cards */}
              {gmsResults.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
                  <Eye size={40} className="mx-auto mb-3 opacity-30"/>
                  <p>Không có dữ liệu giám sát</p>
                </div>
              ) : (
                <div className="space-y-3 scroll-reveal">
                  {gmsResults.map(r => {
                    const parent = results.find(p=>p.id===r.parent_id)
                    return (
                      <div key={r.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        {/* Card header */}
                        <div className="px-5 py-3 flex items-center gap-4 border-b border-slate-100 bg-slate-50">
                          <span className="font-extrabold text-slate-800">Lô {r.ma_lo}</span>
                          <span className="text-xs text-slate-500">PKN {r.pkn}</span>
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">{r.loai_csr}</span>
                          <span className="text-xs text-slate-400">KN: {new Date(r.ngay_kn).toLocaleDateString("vi-VN")}</span>
                          <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-bold ${r.trang_thai==="dat"?"bg-emerald-100 text-emerald-700":"bg-red-100 text-red-600"}`}>
                            {r.trang_thai==="dat"?`✓ ${r.dat_hang}`:`✗ ${r.dat_hang}`}
                          </span>
                        </div>

                        {/* Comparison */}
                        <div className="px-5 py-3 grid grid-cols-2 gap-4">
                          {/* Old result */}
                          <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                            <div className="text-xs font-bold text-slate-500 mb-2">KQ CŨ — {parent?.dat_hang||"?"}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {ALL_FIELDS.filter(f=>parent?.grade?.[f.key]).map(f=>{
                                const g=parent!.grade[f.key]
                                return (
                                  <span key={f.key} className={`text-xs px-2 py-0.5 rounded-full font-bold ${g.dat?"bg-emerald-100 text-emerald-700":"bg-red-100 text-red-600"}`}>
                                    {f.label.split(" ")[0]}{g.dat?"✓":"✗"}
                                  </span>
                                )
                              })}
                            </div>
                          </div>
                          {/* New result */}
                          <div className="rounded-xl border border-emerald-200 p-3 bg-emerald-50">
                            <div className="text-xs font-bold text-emerald-700 mb-2">KQ MỚI — {r.dat_hang}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {ALL_FIELDS.filter(f=>r.grade?.[f.key]).map(f=>{
                                const g=r.grade[f.key]
                                return (
                                  <span key={f.key} className={`text-xs px-2 py-0.5 rounded-full font-bold ${g.dat?"bg-emerald-100 text-emerald-700":"bg-red-100 text-red-600"}`}>
                                    {f.label.split(" ")[0]}{g.dat?"✓":"✗"}
                                  </span>
                                )
                              })}
                            </div>
                          </div>
                        </div>

                        {/* Notes */}
                        {r.notes && r.notes.length > 0 && (
                          <div className="px-5 py-3 bg-amber-50 border-t border-amber-100">
                            <div className="text-xs font-bold text-amber-700 mb-1.5">📝 Ghi chú sửa đổi:</div>
                            {r.notes.map((n,i)=>(
                              <div key={i} className="text-xs text-amber-800">
                                {n.field} | cũ → mới: <b>{n.old_val} → {n.new_val}</b>
                                <span className="text-amber-600 ml-2">{n.user} | {new Date(n.timestamp).toLocaleString("vi-VN")}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── EDIT DATE MODAL ──────────────────────────────────────────────────── */}
      {editDateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="font-extrabold text-slate-800">
                Phiếu KN ngày {new Date(editDateModal).toLocaleDateString("vi-VN")}
              </h2>
              <button onClick={()=>setEditDateModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={16}/></button>
            </div>
            <div className="p-4 space-y-2">
              {(dateGroups.find(([d])=>d===editDateModal)?.[1]||[]).map(r=>(
                <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50">
                  <span className="text-xs font-bold text-violet-600">{formatPKN(r.pkn,r.ngay_kn,factoryCode)}</span>
                  <span className="text-xs text-slate-400">Lô KN {r.lo_kn}</span>
                  <span className="font-semibold text-emerald-700">{r.ma_lo}</span>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">{r.loai_csr}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ml-auto ${r.trang_thai==="dat"?"bg-emerald-100 text-emerald-700":"bg-red-100 text-red-600"}`}>
                    {r.dat_hang}
                  </span>
                  {r.trang_thai!=="dat" || true ? (
                    <button onClick={()=>openEditResult(r)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg hover:bg-blue-100">
                      <Edit2 size={11}/> Sửa
                    </button>
                  ) : null}
                  <button onClick={()=>setDelConfirm(r.id)}
                    className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors">
                    <Trash2 size={13}/>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM MODAL ──────────────────────────────────────────────── */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-extrabold text-slate-800 mb-2">Xác nhận xóa?</h3>
            <p className="text-sm text-slate-500 mb-5">Phiếu kiểm nghiệm này sẽ bị xóa vĩnh viễn.</p>
            <div className="flex gap-3">
              <button onClick={()=>setDelConfirm(null)} className="flex-1 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={()=>handleDelete(delConfirm)} className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-md">Xóa</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TCKH MODAL ───────────────────────────────────────────────────────── */}
      {tkhModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="font-extrabold text-slate-800">Thêm tiêu chuẩn khách hàng</h2>
              <button onClick={()=>setTkhModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={16}/></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên khách hàng *</label>
                <input value={tkhName} onChange={e=>setTkhName(e.target.value)}
                  placeholder="VD: KUMHO, Michelin..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-600">Giới hạn chỉ tiêu (dựa trên TCCS 112:2022)</label>
                  <button onClick={()=>setTkhLimits(TCCS[limitKey(createLoaiCSR)]||TCCS.CSR10)}
                    className="text-xs text-blue-600 hover:underline">Reset về TCCS</button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {(Object.entries(tkhLimits) as [string,number|null][]).map(([k,v])=>(
                    <div key={k}>
                      <label className="text-slate-500 block mb-0.5">{k}</label>
                      <input type="number" step="any"
                        value={v ?? ""} onChange={e=>setTkhLimits(p=>({...p,[k]:e.target.value===""?null:+e.target.value}))}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-500"/>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3">
              <button onClick={()=>setTkhModal(false)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={handleSaveTKH} disabled={tkhSaving||!tkhName.trim()}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-40">
                {tkhSaving?"Đang lưu...":"Lưu tiêu chuẩn"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
