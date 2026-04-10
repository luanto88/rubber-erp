"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { ClipboardCheck, Plus, X, Search, Eye, ChevronDown, ChevronUp } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type Samples = {
  tap_chat: number[]
  tro: number[]
  bay_hoi: number[]
  nito: number[]
  po: number[]
  pri: number[]
  mooney: number[]
  mau_sac: string[]
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
  so_mau: number
  samples: Samples
  grade: Record<string, { dat: boolean; tb?: number; detail?: string }>
  dat_hang: string
  trang_thai: string
  lots?: { ma_lo: string }
}

const LOAI_CSR   = ["CSR10","CSR20","CSR3L","CSRL","CSRCV50","CSRCV60","CSR5","Ngoại lệ"]
const LOAI_KN    = [{ val:"thuong", label:"Thường (6 mẫu)" }, { val:"ngat", label:"Kiểm ngặt (14 mẫu)" }]
const TIEU_CHUAN = ["TCCS","ISO 2000","ASTM"]

const FIELDS = [
  { key:"tap_chat", label:"Tạp chất (%)", unit:"%" },
  { key:"tro",      label:"Tro (%)",      unit:"%" },
  { key:"bay_hoi",  label:"Bay hơi (%)",  unit:"%" },
  { key:"nito",     label:"Nitơ (%)",     unit:"%" },
  { key:"po",       label:"Po",           unit:""  },
  { key:"pri",      label:"PRI",          unit:""  },
  { key:"mooney",   label:"Mooney",       unit:""  },
]

const emptyForm = (soMau = 6) => ({
  ma_lo: "", pkn: 0,
  ngay_kn: new Date().toISOString().slice(0,10),
  ngay_sx: new Date(Date.now()-86400000).toISOString().slice(0,10),
  loai_csr: "CSR10", loai_kn: "thuong", tieu_chuan: "TCCS",
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

// ─── Simple grade calc ────────────────────────────────────────────────────────
function calcGrade(samples: Record<string, (number|string)[]>, loaiCsr: string) {
  const nums = (arr: (number|string)[]) => arr.map(Number).filter(v => !isNaN(v) && v > 0)
  const avg  = (arr: number[]) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0
  const max  = (arr: number[]) => arr.length ? Math.max(...arr) : 0
  const min  = (arr: number[]) => arr.length ? Math.min(...arr) : 0

  const tc  = nums(samples.tap_chat||[])
  const tro = nums(samples.tro||[])
  const bh  = nums(samples.bay_hoi||[])
  const ni  = nums(samples.nito||[])
  const po  = nums(samples.po||[])
  const pri = nums(samples.pri||[])
  const mn  = nums(samples.mooney||[])

  // Simplified limits for CSR10
  const lim = {
    tap_chat: 0.07, tro: 0.6, bay_hoi: 0.7,
    nito: 0.5, po_min: 30, pri_min: 50, pri_tb: 60,
    mooney_min: 73, mooney_max: 93,
  }

  const grade: Record<string, { dat: boolean; tb: number; detail: string }> = {}

  if (tc.length) {
    const tb = avg(tc)
    const sd = Math.sqrt(tc.reduce((s,v)=>s+(v-tb)**2,0)/tc.length)
    const x3sd = tb + 3*sd
    grade.tap_chat = { dat: x3sd<=lim.tap_chat, tb, detail: `X̄+3SD=${x3sd.toFixed(3)} (giới hạn ${lim.tap_chat})` }
  }
  if (tro.length) {
    const tb = avg(tro)
    const sd = Math.sqrt(tro.reduce((s,v)=>s+(v-tb)**2,0)/tro.length)
    const x3sd = tb + 3*sd
    grade.tro = { dat: x3sd<=lim.tro, tb, detail: `X̄+3SD=${x3sd.toFixed(3)} (giới hạn ${lim.tro})` }
  }
  if (bh.length) {
    const mx = max(bh); const dr = mx - min(bh)
    grade.bay_hoi = { dat: mx<=lim.bay_hoi && dr<=0.1, tb: avg(bh), detail: `Max=${mx} DR=${dr.toFixed(2)}` }
  }
  if (ni.length) {
    const mx = max(ni); const dr = mx - min(ni)
    grade.nito = { dat: mx<=lim.nito && dr<=0.06, tb: avg(ni), detail: `Max=${mx} DR=${dr.toFixed(2)}` }
  }
  if (po.length) {
    grade.po = { dat: min(po)>=lim.po_min, tb: avg(po), detail: `Min=${min(po)} (≥${lim.po_min})` }
  }
  if (pri.length) {
    const tb = avg(pri); const dr = max(pri)-min(pri)
    grade.pri = { dat: tb>=lim.pri_tb && dr<=10, tb, detail: `X̄=${tb.toFixed(1)} DR=${dr} (X̄≥${lim.pri_tb}, DR≤10)` }
  }
  if (mn.length) {
    const mx = max(mn); const mi = min(mn)
    grade.mooney = { dat: mi>=lim.mooney_min && mx<=lim.mooney_max, tb: avg(mn),
      detail: `Min=${mi} Max=${mx} (${lim.mooney_min}–${lim.mooney_max})` }
  }

  const allDat = Object.values(grade).every(g => g.dat)
  return { grade, dat_hang: allDat ? loaiCsr : "Không đạt", trang_thai: allDat ? "dat" : "khong_dat" }
}

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
  const [modal, setModal]   = useState<"add"|"view"|null>(null)
  const [form, setForm]     = useState(emptyForm(6))
  const [saving, setSaving] = useState(false)
  const [viewItem, setViewItem] = useState<QcResult|null>(null)
  const [expandedId, setExpandedId] = useState<string|null>(null)

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
    setForm(prev => ({
      ...prev,
      samples: {
        ...prev.samples,
        [field]: prev.samples[field].map((v,i) => i===idx ? val : v)
      }
    }))
  }

  // ── Change so_mau ─────────────────────────────────────────────────────────
  const changeSoMau = (n: number) => {
    setForm(prev => ({
      ...prev, so_mau: n,
      samples: Object.fromEntries(
        Object.entries(prev.samples).map(([k,v]) => [k, Array(n).fill("").map((_, i) => v[i]??"")])
      ) as Record<string, (number|string)[]>
    }))
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!factoryId) return
    setSaving(true)
    const { grade, dat_hang, trang_thai } = calcGrade(form.samples, form.loai_csr)
    const payload = {
      factory_id: factoryId,
      ma_lo: form.ma_lo, pkn: form.pkn,
      ngay_kn: form.ngay_kn, ngay_sx: form.ngay_sx,
      chung_loai: form.loai_csr.replace("CSR",""),
      loai_csr: form.loai_csr, loai_kn: form.loai_kn,
      tieu_chuan: form.tieu_chuan, so_mau: form.so_mau,
      samples: Object.fromEntries(
        Object.entries(form.samples).map(([k,v]) => [k, v.map(Number)])
      ),
      grade, dat_hang, trang_thai,
    }
    await supabase.from("qc_results").insert(payload)
    setSaving(false)
    setModal(null)
    setForm(emptyForm(6))
    loadData(factoryId)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Kiểm nghiệm</h1>
          <p className="text-sm text-slate-500 mt-0.5">Kết quả kiểm tra chất lượng cao su</p>
        </div>
        <button onClick={() => { setForm(emptyForm(6)); setModal("add") }}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
          <Plus size={16}/> Thêm kết quả
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label:"Tổng phiếu KN",  value: stats.total,        color:"text-slate-700"  },
          { label:"Đạt",             value: stats.dat,          color:"text-emerald-600"},
          { label:"Không đạt",       value: stats.khongDat,     color:"text-red-500"    },
          { label:"Tỷ lệ đạt",       value: stats.tyLe+"%",     color:"text-blue-600"   },
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
                {["PKN","Mã lô","Ngày KN","Loại","Tiêu chuẩn","Tạp chất","Tro","PRI","Mooney","Kết quả",""].map(h=>(
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
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {r.grade?.mooney?.tb?.toFixed(1) ?? "—"}
                      {r.grade?.mooney && (
                        <span className={`ml-1 ${r.grade.mooney.dat?"text-emerald-500":"text-red-500"}`}>
                          {r.grade.mooney.dat?"✓":"✗"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        r.trang_thai==="dat" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                        {r.trang_thai==="dat" ? `✓ ${r.dat_hang}` : "✗ Không đạt"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {expandedId===r.id ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                    </td>
                  </tr>
                  {/* Expanded samples */}
                  {expandedId===r.id && (
                    <tr key={r.id+"_exp"}>
                      <td colSpan={11} className="px-4 py-4 bg-slate-50 border-t border-slate-100">
                        <div className="grid grid-cols-7 gap-3 text-xs">
                          {FIELDS.map(f => {
                            const vals = (r.samples?.[f.key as keyof Samples] || []) as number[]
                            const g = r.grade?.[f.key]
                            return (
                              <div key={f.key} className={`rounded-lg p-3 border ${g?.dat===false?"border-red-200 bg-red-50":"border-slate-200 bg-white"}`}>
                                <div className="font-bold text-slate-600 mb-1.5">{f.label}</div>
                                <div className="space-y-0.5">
                                  {vals.map((v,i) => (
                                    <div key={i} className="flex justify-between">
                                      <span className="text-slate-400">M{i+1}</span>
                                      <span className="font-mono font-semibold text-slate-700">{v}</span>
                                    </div>
                                  ))}
                                </div>
                                {g && (
                                  <div className={`mt-2 pt-1.5 border-t text-xs font-semibold ${g.dat?"text-emerald-600":"text-red-500"}`}>
                                    {g.dat?"✓ Đạt":"✗ Không đạt"}
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

      {/* Add Modal */}
      {modal === "add" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">Nhập kết quả kiểm nghiệm</h2>
              <button onClick={() => setModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
            </div>
            <div className="p-6 space-y-5">
              {/* Info */}
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
                  <select value={form.loai_csr} onChange={e=>setForm(p=>({...p,loai_csr:e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {LOAI_CSR.map(l=><option key={l}>{l}</option>)}
                  </select>
                </div>
              </div>
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
                  <select value={form.tieu_chuan} onChange={e=>setForm(p=>({...p,tieu_chuan:e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {TIEU_CHUAN.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Samples table */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-2">
                  Số liệu mẫu ({form.so_mau} mẫu)
                </label>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-slate-200 rounded-xl overflow-hidden">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold text-slate-600 border-b border-slate-200 w-32">Chỉ tiêu</th>
                        {Array.from({length:form.so_mau},(_,i)=>(
                          <th key={i} className="px-2 py-2 text-center font-bold text-slate-500 border-b border-slate-200 min-w-16">M{i+1}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {FIELDS.map(f => (
                        <tr key={f.key} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-600 bg-slate-50 border-r border-slate-200">{f.label}</td>
                          {Array.from({length:form.so_mau},(_,i)=>(
                            <td key={i} className="px-1 py-1">
                              <input
                                value={(form.samples[f.key]?.[i] ?? "") as string}
                                onChange={e => updateSample(f.key, i, e.target.value)}
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-center font-mono text-xs outline-none focus:border-emerald-400 focus:bg-emerald-50"/>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={()=>setModal(null)}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-50">
                {saving ? "Đang lưu..." : "Lưu kết quả"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
