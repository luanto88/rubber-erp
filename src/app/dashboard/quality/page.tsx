"use client"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import * as XLSX from "xlsx"
import { supabase } from "@/lib/supabase"
import QualityAnalyticsPage from "@/app/dashboard/quality-analytics/page"
import { getActiveFactoryId } from "@/lib/auth"
import {
  ClipboardCheck, Plus, X, Search, ChevronDown, ChevronRight,
  Edit2, Trash2, Check, AlertTriangle, BarChart2, XCircle,
  RefreshCw, Clock, Star, ArrowLeft, Printer, Eye,
  Upload, Download
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
type Samples = Record<string, (string | number)[]>

type NoteEntry = {
  field: string; old_val: string | number; new_val: string | number
  timestamp: string; user: string
}

type QcResult = {
  id: string; factory_id: string; lot_id: string | null
  ma_lo: string; pkn: number; lo_kn: number; batch_id?: string
  ngay_kn: string; ngay_sx: string
  chung_loai: string; loai_csr: string; loai_kn: string; tieu_chuan: string
  so_mau: number; samples: Samples
  grade: Record<string, { dat: boolean; tb?: number; detail?: string }>
  dat_hang: string; trang_thai: string
  parent_id?: string | null; lan?: number; notes?: NoteEntry[]
  created_at?: string
  lots?: { ma_lo: string; ngay_sx: string; ngay_ht?: string | null }
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
  ngay_sx: string; ngay_ht?: string | null; trang_thai: string; tong_banh: number
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

// Explicit indicator profile by chung_loai (overrides TCCS-derived logic)
const LOAI_PROFILE: Record<string, { mooney: boolean; mau: boolean }> = {
  "10":   { mooney: true,  mau: false },
  "20":   { mooney: true,  mau: false },
  "L":    { mooney: false, mau: true  },
  "3L":   { mooney: false, mau: true  },
  "CV50": { mooney: true,  mau: false },
  "CV60": { mooney: true,  mau: false },
}

// getVisibleFields now takes chung_loai (e.g. "10", "L", "CV60")
function getVisibleFields(chungLoai: string): string[] {
  const base = ["tap_chat","tro","bay_hoi","nito","po","pri"] // Po always included
  const p = LOAI_PROFILE[chungLoai] || { mooney: false, mau: false }
  if (p.mooney) base.push("mooney")
  if (p.mau)    base.push("mau_sac")
  return base
}

function normalizeLotCode(maLo: string): string {
  return String(maLo || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\\/g, "/")
}

// stripYear: "345cs/26" → "345cs"
function stripYear(maLo: string): string {
  return normalizeLotCode(maLo).replace(/\/\d{2,4}$/, "")
}

function getLotLookupKeys(maLo: string): string[] {
  const normalized = normalizeLotCode(maLo)
  if (!normalized) return []
  const base = stripYear(normalized)
  return normalized === base ? [base] : [normalized, base]
}

function summarizeImportWarnings(warnings: string[]) {
  return warnings.reduce((acc, warning) => {
    if (warning.includes("đã có phiếu kiểm nghiệm")) acc.duplicateQc++
    else if (warning.includes("không khớp ngày hoàn thành lô")) acc.wrongDate++
    else if (warning.includes("trùng lặp trong file import")) acc.duplicateInFile++
    else acc.other++
    return acc
  }, {
    duplicateQc: 0,
    wrongDate: 0,
    duplicateInFile: 0,
    other: 0,
  })
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
  const chungLoai = loaiCsr.replace(/^(CSR|SVR)/,"")
  const nums = (arr: (number|string)[] | undefined) =>
    (arr || []).map(Number).filter(v => !isNaN(v) && v > 0)
  const avg = (a: number[]) => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0
  const sd  = (a: number[]) => { const m=avg(a); return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length) }
  const mx  = (a: number[]) => a.length ? Math.max(...a) : 0
  const mn  = (a: number[]) => a.length ? Math.min(...a) : Infinity

  const visible = getVisibleFields(chungLoai)
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
  const po = nums(samples.po); if (po.length && visible.includes("po")) {
    if (lim.po_min === null) {
      // Po recorded but no limit (e.g. CV types) — always Đạt
      grade.po={dat:true,tb:avg(po),detail:"Không có giới hạn"}
    } else {
      const mi=mn(po),dr=+(mx(po)-mi).toFixed(2)
      const dat=mi>=lim.po_min&&(lim.po_dr===null||dr<=lim.po_dr)
      grade.po={dat,tb:avg(po),detail:`Min=${mi}≥${lim.po_min}${lim.po_dr!==null?`, DR=${dr}≤${lim.po_dr}`:""}`}
    }
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

function matchesLotCode(candidateMaLo: string, qcMaLo?: string | null): boolean {
  if (!qcMaLo) return false
  const candidateKeys = new Set(getLotLookupKeys(candidateMaLo))
  return getLotLookupKeys(qcMaLo).some(key => candidateKeys.has(key))
}

function getLotQcDate(lot: { ngay_sx: string; ngay_ht?: string | null }): string {
  return lot.ngay_ht || lot.ngay_sx
}

function getLotRank(lot: { trang_thai?: string; tong_banh?: number; ngay_ht?: string | null }): number {
  if (lot.trang_thai === "Xuất hàng") return 4
  if (lot.trang_thai === "Hoàn thành") return 3
  if (lot.trang_thai === "Dở dang") return 2
  return lot.tong_banh ? 1 : 0
}

function pickCanonicalLot<T extends { trang_thai?: string; tong_banh?: number; ngay_ht?: string | null }>(
  current: T | null | undefined,
  candidate: T,
): T {
  if (!current) return candidate
  const currentRank = getLotRank(current)
  const candidateRank = getLotRank(candidate)
  if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current
  const currentDate = current.ngay_ht || ""
  const candidateDate = candidate.ngay_ht || ""
  if (candidateDate !== currentDate) return candidateDate > currentDate ? candidate : current
  return (candidate.tong_banh || 0) >= (current.tong_banh || 0) ? candidate : current
}

function emptyTabSamples(soMau: number): Samples {
  return Object.fromEntries(ALL_FIELDS.map(f => [f.key, Array(soMau).fill("")]))
}

// Build one page of the print HTML for a single batch
function buildBatchPage(batchResults: QcResult[], factoryName: string, fCode: string, isFirst: boolean): string {
  const sorted = [...batchResults].sort((a,b)=>(a.lo_kn||0)-(b.lo_kn||0))
  const r0 = sorted[0]
  const pknCode = formatPKN(r0.pkn, r0.ngay_kn, fCode)
  const ngaySXStr = new Date(r0.ngay_sx).toLocaleDateString("vi-VN")
  const ngayInStr = (() => {
    const d = new Date(r0.ngay_kn)
    return `ngày ${d.getUTCDate()} tháng ${d.getUTCMonth()+1} năm ${d.getUTCFullYear()}`
  })()

  // Stats helpers
  const nums = (arr: (string|number)[]|undefined) => (arr||[]).map(Number).filter(v=>!isNaN(v)&&v>0)
  const avg  = (a: number[]) => a.length ? a.reduce((s,v)=>s+v,0)/a.length : null
  const sd3  = (a: number[]) => { if(!a.length) return null; const m=avg(a)!; return 3*Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length) }
  const mx   = (a: number[]) => a.length ? Math.max(...a) : null
  const mn   = (a: number[]) => a.length ? Math.min(...a) : null
  const fmt  = (v: number|null, d=3) => v===null ? "—" : v.toFixed(d)

  // For Tạp chất/Tro: X | 3SD | X+3SD
  const statA = (vals: (string|number)[]|undefined) => {
    const a = nums(vals); if (!a.length) return ["—","—","—"]
    const m = avg(a)!, s3 = sd3(a)!
    return [fmt(m), fmt(s3), fmt(m+s3)]
  }
  // For Bay hơi: X̄ | Xmax (2 cột, không DR)
  const statBH = (vals: (string|number)[]|undefined) => {
    const a = nums(vals); if (!a.length) return ["—","—"]
    return [fmt(avg(a)!), fmt(mx(a)!)]
  }
  // For Nitơ/Màu: X̄ | Xmin | Xmax
  const statNi = (vals: (string|number)[]|undefined) => {
    const a = nums(vals); if (!a.length) return ["—","—","—"]
    return [fmt(avg(a)!), fmt(mn(a)!), fmt(mx(a)!)]
  }
  // For Po/PRI: X̄ | Xmin | Xmax (1 decimal)
  const statC = (vals: (string|number)[]|undefined) => {
    const a = nums(vals); if (!a.length) return ["—","—","—"]
    return [fmt(avg(a)!,1), fmt(mn(a)!,1), fmt(mx(a)!,1)]
  }
  // For Mooney: X̄ | Xmin | Xmax
  const statD = (vals: (string|number)[]|undefined) => {
    const a = nums(vals); if (!a.length) return ["—","—","—"]
    return [fmt(avg(a),1), fmt(mn(a),1), fmt(mx(a),1)]
  }

  const rows = sorted.map(r => {
    const s = r.samples || {}
    const g = r.grade   || {}
    const resOk = !r.dat_hang?.endsWith("RH")
    const resCl = resOk ? "#065f46" : "#dc2626"
    const [tc1,tc2,tc3] = statA(s.tap_chat)
    const [tr1,tr2,tr3] = statA(s.tro)
    const [bh1,bh2]     = statBH(s.bay_hoi)
    const [ni1,ni2,ni3] = statNi(s.nito)
    const [po1,po2,po3] = statC(s.po)
    const [pr1,pr2,pr3] = statC(s.pri)
    const [ma1,ma2,ma3] = statNi(s.mau_sac)
    const [ml1,ml2,ml3] = statD(s.mooney)
    const nmLo = stripYear(r.ma_lo)

    const c = (ok: boolean|undefined, v: string) =>
      ok===undefined ? `<td style="text-align:center;color:#94a3b8">${v}</td>`
      : ok ? `<td style="text-align:center;color:#065f46">${v}</td>`
           : `<td style="text-align:center;color:#dc2626;font-weight:700">${v}</td>`

    return `<tr>
      <td style="text-align:center">${r.lo_kn||"—"}</td>
      <td style="text-align:center;font-weight:600">${nmLo}</td>
      <td style="text-align:center">${r.loai_csr}</td>
      ${c(g.tap_chat?.dat,tc1)}${c(undefined,tc2)}${c(g.tap_chat?.dat,tc3)}
      ${c(g.tro?.dat,tr1)}${c(undefined,tr2)}${c(g.tro?.dat,tr3)}
      ${c(g.bay_hoi?.dat,bh1)}${c(g.bay_hoi?.dat,bh2)}
      ${c(g.nito?.dat,ni1)}${c(undefined,ni2)}${c(g.nito?.dat,ni3)}
      ${c(g.po?.dat,po1)}${c(undefined,po2)}${c(g.po?.dat,po3)}
      ${c(g.pri?.dat,pr1)}${c(undefined,pr2)}${c(g.pri?.dat,pr3)}
      <td style="text-align:center">${ma1}</td><td style="text-align:center">${ma2}</td><td style="text-align:center">${ma3}</td>
      <td style="text-align:center">${ml1}</td><td style="text-align:center">${ml2}</td><td style="text-align:center">${ml3}</td>
      <td style="text-align:center;font-weight:700;color:${resCl}">${r.dat_hang}</td>
    </tr>`
  }).join("")

  const pageBreak = isFirst ? "" : '<div style="page-break-before:always"></div>'
  return `${pageBreak}
  <div style="text-align:center;font-weight:bold;font-size:13px;margin-bottom:6px">BẢNG KẾT QUẢ KIỂM NGHIỆM CAO SU CSR</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:4px;font-size:9px">
    <tr>
      <td style="width:40%"><b>Mã phiếu:</b> <span style="color:#6d28d9;font-weight:bold">${pknCode}</span></td>
      <td style="width:35%;text-align:center"><b>NGÀY SẢN XUẤT:</b> ${ngaySXStr}</td>
      <td style="width:25%;text-align:right"><b>NHÀ MÁY:</b> ${fCode}</td>
    </tr>
  </table>
  <table style="width:100%;border-collapse:collapse;font-size:8px">
    <thead>
      <tr style="background:#f1f5f9">
        <th rowspan="2" style="border:1px solid #cbd5e1;padding:3px 4px;text-align:center;font-size:8px">LÔ<br>PKN</th>
        <th rowspan="2" style="border:1px solid #cbd5e1;padding:3px 4px;text-align:center">LÔ<br>NM</th>
        <th rowspan="2" style="border:1px solid #cbd5e1;padding:3px 4px;text-align:center">HẠNG<br>DK</th>
        <th colspan="3" style="border:1px solid #cbd5e1;padding:2px 4px;text-align:center">TẠP CHẤT</th>
        <th colspan="3" style="border:1px solid #cbd5e1;padding:2px 4px;text-align:center">TRO</th>
        <th colspan="2" style="border:1px solid #cbd5e1;padding:2px 4px;text-align:center">BAY HƠI</th>
        <th colspan="3" style="border:1px solid #cbd5e1;padding:2px 4px;text-align:center">NITƠ</th>
        <th colspan="3" style="border:1px solid #cbd5e1;padding:2px 4px;text-align:center">Po</th>
        <th colspan="3" style="border:1px solid #cbd5e1;padding:2px 4px;text-align:center">PRI</th>
        <th colspan="3" style="border:1px solid #cbd5e1;padding:2px 4px;text-align:center">MÀU</th>
        <th colspan="3" style="border:1px solid #cbd5e1;padding:2px 4px;text-align:center">ML(1'+4')100°C</th>
        <th rowspan="2" style="border:1px solid #cbd5e1;padding:3px 4px;text-align:center">ĐẠT<br>HẠNG</th>
      </tr>
      <tr style="background:#f8fafc">
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">X̄</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">3SD</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">X̄+3SD</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">X̄</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">3SD</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">X̄+3SD</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">X̄</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmax</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">X̄</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmin</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmax</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">X̄</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmin</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmax</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">X̄</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmin</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmax</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">X̄</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmin</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmax</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">X̄</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmin</th>
        <th style="border:1px solid #cbd5e1;padding:2px 3px;text-align:center">Xmax</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:6px;font-size:9px"><b>TỔNG SỐ LÔ KIỂM NGHIỆM:</b> ${sorted.length}</div>
  <div style="text-align:right;margin-top:4px;font-size:9px">Kampong Thom, ${ngayInStr}</div>
  <div style="display:flex;justify-content:space-between;margin-top:32px;font-size:9px;padding:0 40px">
    <div style="text-align:center"><p style="margin-bottom:36px"><b>LẬP BIỂU</b></p><p>________________________</p></div>
    <div style="text-align:center"><p style="margin-bottom:36px"><b>TRƯỞNG PHÒNG QLCL</b></p><p>________________________</p></div>
  </div>
  <div style="margin-top:8px;font-size:8px;color:#94a3b8">QLCL-QT21-F08 (01-10/01/2025)</div>`
}

function buildPrintHTML(
  dateResults: QcResult[], factoryName: string, date: string, fCode: string
): string {
  // Group by batch_id (or pkn as fallback), print each as a separate page
  const batchMap = new Map<string, QcResult[]>()
  dateResults.forEach(r => {
    const key = r.batch_id || String(r.pkn)
    if (!batchMap.has(key)) batchMap.set(key, [])
    batchMap.get(key)!.push(r)
  })
  const batches = Array.from(batchMap.values()).sort((a,b)=>(a[0].pkn||0)-(b[0].pkn||0))

  const pages = batches.map((b, i) => buildBatchPage(b, factoryName, fCode, i===0)).join("")

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Phiếu KQKN - ${new Date(date).toLocaleDateString("vi-VN")}</title>
  <style>
    body{font-family:"Times New Roman",serif;font-size:9px;margin:15px 20px}
    table td,table th{border:1px solid #cbd5e1;padding:2px 3px}
    @media print{@page{size:A4 landscape;margin:10mm} body{margin:0}}
  </style></head><body>
  ${pages}
  <script>window.onload=()=>{ window.print() }</script>
  </body></html>`
}

const padSamples = (arr: (string|number)[]|undefined, n: number): string[] =>
  (arr||[]).map(String).concat(Array(Math.max(0, n-(arr?.length||0))).fill(""))

// ─── Main Component ───────────────────────────────────────────────────────────
export default function QualityPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [factoryId,   setFactoryId]   = useState<string|null>(null)
  const [factoryCode, setFactoryCode] = useState("NM")
  const [factoryName, setFactoryName] = useState("")
  const [results,      setResults]      = useState<QcResult[]>([])
  const [statsResults, setStatsResults] = useState<QcResult[]>([])
  const [customStds,  setCustomStds]  = useState<CustomStd[]>([])
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)

  // ── Navigation ───────────────────────────────────────────────────────────────
  const [mainTab,  setMainTab]  = useState<"xep_hang"|"giam_sat"|"thong_ke">("xep_hang")
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
  const [parentMap,     setParentMap]    = useState<Map<string,QcResult>>(new Map())

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
  const eligibleLotsReqRef = useRef(0)

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

  // ── KN lại date filter (ngay_sx dropdown cho kl_rot_hang & kl_6thang) ─────────
  const [knDateFilter, setKnDateFilter] = useState<string>("")

  // ── Admin / Import ───────────────────────────────────────────────────────────
  const [userRole,     setUserRole]     = useState("")
  const [importing,    setImporting]    = useState(false)
  const [importResult, setImportResult] = useState<{
    ok: number
    skipped: number
    warnings: string[]
    errors: string[]
  } | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  // ── Toast ────────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{msg:string;ok:boolean}|null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null)
  const showToast = useCallback((msg: string, ok=true) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({msg,ok})
    toastTimerRef.current = setTimeout(()=>setToast(null),3500)
  }, [])
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current) }, [])

  // ── Load results ─────────────────────────────────────────────────────────────
  const loadResults = useCallback(async (fid: string) => {
    setLoading(true)
    let q = supabase.from("qc_results")
      .select("*")
      .eq("factory_id", fid)
      .order("ngay_kn", { ascending: false })
      .order("pkn",     { ascending: false })
    if (filterLoai) q = q.eq("loai_csr",  filterLoai)
    if (filterTT === "dat_hang") q = q.not("dat_hang", "ilike", "%RH")
    else if (filterTT === "rot_hang") q = q.ilike("dat_hang", "%RH")
    if (filterFrom) q = q.gte("ngay_kn",  filterFrom)
    if (filterTo)   q = q.lte("ngay_kn",  filterTo)
    const { data } = await q
    setResults(data || [])
    setLoading(false)
  }, [filterLoai, filterTT, filterFrom, filterTo])

  // ── Load stats (không filter trang_thai để stats luôn phản ánh thực tế) ───────
  const loadStats = useCallback(async (fid: string) => {
    let q = supabase.from("qc_results")
      .select("*")
      .eq("factory_id", fid)
    if (filterLoai) q = q.eq("loai_csr", filterLoai)
    if (filterFrom) q = q.gte("ngay_kn", filterFrom)
    if (filterTo)   q = q.lte("ngay_kn", filterTo)
    const { data } = await q
    setStatsResults(data || [])
  }, [filterLoai, filterFrom, filterTo])

  // ── Load custom standards ────────────────────────────────────────────────────
  const loadCustomStds = useCallback(async (fid: string) => {
    const { data } = await supabase.from("qc_custom_std")
      .select("*").eq("factory_id", fid).order("ten_kh")
    setCustomStds(data || [])
  }, [])

  const backfillQcLotLinks = useCallback(async (fid: string, loaiCsr: string) => {
    const { data: orphanQc, error: orphanError } = await supabase.from("qc_results")
      .select("id,ma_lo")
      .eq("factory_id", fid)
      .eq("loai_csr", loaiCsr)
      .is("lot_id", null)
    if (orphanError) throw orphanError
    if (!orphanQc?.length) return

    const { data: lots, error: lotsError } = await supabase.from("lots")
      .select("id,ma_lo,ngay_sx,ngay_ht")
      .eq("factory_id", fid)
      .eq("loai_csr", loaiCsr)
    if (lotsError) throw lotsError

    const lotByExact = new Map<string, { id: string; ma_lo: string; ngay_sx: string; ngay_ht?: string | null; trang_thai?: string; tong_banh?: number }>()
    const lotByBase = new Map<string, { id: string; ma_lo: string; ngay_sx: string; ngay_ht?: string | null; trang_thai?: string; tong_banh?: number } | null>()
    ;(lots || []).forEach(lot => {
      const exactKey = normalizeLotCode(lot.ma_lo)
      const baseKey = stripYear(lot.ma_lo)
      lotByExact.set(exactKey, pickCanonicalLot(lotByExact.get(exactKey), lot))
      lotByBase.set(baseKey, pickCanonicalLot(lotByBase.get(baseKey), lot))
    })

    const updates = orphanQc
      .map(row => {
        const exactKey = normalizeLotCode(row.ma_lo || "")
        const baseKey = stripYear(row.ma_lo || "")
        const matched = lotByExact.get(exactKey) || lotByBase.get(baseKey) || null
        return matched
          ? { id: row.id, lot_id: matched.id, ma_lo: matched.ma_lo, ngay_sx: getLotQcDate(matched) }
          : null
      })
      .filter(Boolean) as { id: string; lot_id: string; ma_lo: string; ngay_sx: string }[]

    if (!updates.length) return

    const results = await Promise.all(
      updates.map(u =>
        supabase.from("qc_results")
          .update({ lot_id: u.lot_id, ma_lo: u.ma_lo, ngay_sx: u.ngay_sx })
          .eq("id", u.id)
      )
    )
    const failed = results.find(r => r.error)
    if (failed?.error) throw failed.error
  }, [])

  // ── Load eligible lots ───────────────────────────────────────────────────────
  const loadEligibleLots = useCallback(async () => {
    if (!factoryId || !createForm.chung_loai) { setEligibleLots([]); return }
    const loaiCsr = getLoaiCSR(createForm.chung_loai, factoryCode)
    const reqId = ++eligibleLotsReqRef.current
    setLotsLoading(true)
    try {
      await backfillQcLotLinks(factoryId, loaiCsr)

      if (createForm.loai_kn === "kl_rot_hang") {
        // Fetch failed qc_results
        const { data: failed, error: failedError } = await supabase.from("qc_results")
          .select("*").eq("factory_id", factoryId).eq("loai_csr", loaiCsr)
          .ilike("dat_hang", "%RH")
          .order("created_at", { ascending: false })
        if (failedError) throw failedError

        // Dedup failed: group by lot_id (UUID) hoặc ma_lo (fallback khi lot_id null)
        const latestByLotId = new Map<string,QcResult>()
        const latestByMaLo  = new Map<string,QcResult>()
        ;(failed||[]).forEach(r => {
          if (r.lot_id) {
            if (!latestByLotId.has(r.lot_id)) latestByLotId.set(r.lot_id, r)
          } else if (r.ma_lo) {
            getLotLookupKeys(r.ma_lo).forEach(key => {
              if (!latestByMaLo.has(key)) latestByMaLo.set(key, r)
            })
          }
        })

        // Fetch ALL results để cross-check "vẫn còn rớt hạng"
        const { data: allRes, error: allResError } = await supabase.from("qc_results")
          .select("*").eq("factory_id", factoryId).eq("loai_csr", loaiCsr)
          .order("created_at", { ascending: false })
        if (allResError) throw allResError

        const latestAllById   = new Map<string,QcResult>()
        const latestAllByMaLo = new Map<string,QcResult>()
        ;(allRes||[]).forEach(r => {
          if (r.lot_id) {
            if (!latestAllById.has(r.lot_id)) latestAllById.set(r.lot_id, r)
          } else if (r.ma_lo) {
            getLotLookupKeys(r.ma_lo).forEach(key => {
              if (!latestAllByMaLo.has(key)) latestAllByMaLo.set(key, r)
            })
          }
        })

        const isStillFailed = (r: QcResult|undefined) =>
          r?.dat_hang?.endsWith("RH") === true
        const stillFailedIds   = Array.from(latestByLotId.keys())
          .filter(lid => isStillFailed(latestAllById.get(lid)))
        const stillFailedMaLos = Array.from(latestByMaLo.keys())
          .filter(mlo => isStillFailed(latestAllByMaLo.get(mlo)))

        if (!stillFailedIds.length && !stillFailedMaLos.length) {
          if (reqId === eligibleLotsReqRef.current) setEligibleLots([])
          return
        }

        const [resById, resByMaLo] = await Promise.all([
          stillFailedIds.length
            ? supabase.from("lots").select("id,factory_id,ma_lo,loai_csr,ngay_sx,ngay_ht,trang_thai,tong_banh")
                .in("id", stillFailedIds)
            : Promise.resolve({ data: [] as {id:string;factory_id:string;ma_lo:string;loai_csr:string;ngay_sx:string;ngay_ht?:string|null;trang_thai:string;tong_banh:number}[], error: null }),
          stillFailedMaLos.length
            ? supabase.from("lots").select("id,factory_id,ma_lo,loai_csr,ngay_sx,ngay_ht,trang_thai,tong_banh")
                .eq("factory_id", factoryId)
                .or(stillFailedMaLos.map(mlo => `ma_lo.eq.${mlo},ma_lo.ilike.${mlo}/%`).join(","))
            : Promise.resolve({ data: [] as {id:string;factory_id:string;ma_lo:string;loai_csr:string;ngay_sx:string;ngay_ht?:string|null;trang_thai:string;tong_banh:number}[], error: null }),
        ])
        if (resById.error) throw resById.error
        if (resByMaLo.error) throw resByMaLo.error

        const combined = [
          ...(resById.data||[]).map(l => ({ ...l, prev_qc: latestByLotId.get(l.id) })),
          ...(resByMaLo.data||[]).map(l => ({
            ...l,
            prev_qc: latestByMaLo.get(normalizeLotCode(l.ma_lo))
              ?? latestByMaLo.get(stripYear(l.ma_lo)),
          })),
        ]
        const seen = new Set<string>()
        if (reqId === eligibleLotsReqRef.current) {
          setEligibleLots(combined.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true }))
        }

      } else if (createForm.loai_kn === "kl_6thang") {
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-6)
        const { data: lots, error: lotsError } = await supabase.from("lots")
          .select("id,factory_id,ma_lo,loai_csr,ngay_sx,ngay_ht,trang_thai,tong_banh")
          .eq("factory_id", factoryId).eq("loai_csr", loaiCsr)
          .neq("trang_thai","Xuất hàng")
          .order("ngay_sx", { ascending: true })
        if (lotsError) throw lotsError

        // Attach latest qc_result if exists
        const { data: qcAll, error: qcAllError } = await supabase.from("qc_results")
          .select("*").eq("factory_id",factoryId).eq("loai_csr",loaiCsr)
          .order("created_at",{ascending:false})
        if (qcAllError) throw qcAllError

        const latestQCById = new Map<string,QcResult>()
        const latestQCByMaLo = new Map<string,QcResult>()
        ;(qcAll||[]).forEach(r => {
          if (r.lot_id) {
            if (!latestQCById.has(r.lot_id)) latestQCById.set(r.lot_id, r)
          } else if (r.ma_lo) {
            getLotLookupKeys(r.ma_lo).forEach(key => {
              if (!latestQCByMaLo.has(key)) latestQCByMaLo.set(key, r)
            })
          }
        })
        if (reqId === eligibleLotsReqRef.current) {
          setEligibleLots((lots||[])
            .filter(l => getLotQcDate(l) <= cutoff.toISOString().slice(0,10))
            .map(l => ({
            ...l,
            prev_qc: latestQCById.get(l.id)
              ?? latestQCByMaLo.get(normalizeLotCode(l.ma_lo))
              ?? latestQCByMaLo.get(stripYear(l.ma_lo)),
          })))
        }

      } else {
        // Normal: Hoàn thành + not yet in qc_results
        if (!createForm.ngay_sx) {
          if (reqId === eligibleLotsReqRef.current) setEligibleLots([])
          return
        }
        const { data: existingQC, error: existingQcError } = await supabase.from("qc_results")
          .select("lot_id,ma_lo").eq("factory_id", factoryId).eq("loai_csr", loaiCsr)
        if (existingQcError) throw existingQcError

        const excludeIds = new Set((existingQC||[]).map(r=>r.lot_id).filter(Boolean))
        const excludeRows = (existingQC || []).filter(r => r.ma_lo)

        const { data: lots, error: lotsError } = await supabase.from("lots")
          .select("id,factory_id,ma_lo,loai_csr,ngay_sx,ngay_ht,trang_thai,tong_banh")
          .eq("factory_id", factoryId).eq("loai_csr", loaiCsr)
          .eq("trang_thai","Hoàn thành")
          .order("num", {ascending:true})
        if (lotsError) throw lotsError

        if (reqId === eligibleLotsReqRef.current) {
          setEligibleLots((lots||[]).filter(l =>
            getLotQcDate(l) === createForm.ngay_sx &&
            !excludeIds.has(l.id) &&
            !excludeRows.some(r => matchesLotCode(l.ma_lo, r.ma_lo))
          ))
        }
      }
    } catch (error) {
      console.error("load eligible lots failed", error)
      if (reqId === eligibleLotsReqRef.current) setEligibleLots([])
    } finally {
      if (reqId === eligibleLotsReqRef.current) setLotsLoading(false)
    }
  }, [backfillQcLotLinks, factoryId, factoryCode, createForm.chung_loai, createForm.ngay_sx, createForm.loai_kn])

  // ── Giám sát: results that are re-tests (have parent_id) ────────────────────
  const gmsResults = useMemo(() => results.filter(r=>r.parent_id).filter(r=>{
    if (gmsFilter==="rot_ct") return !r.dat_hang?.endsWith("RH")
    if (gmsFilter==="6thang") return r.loai_kn==="kl_6thang"
    return true
  }).filter(r=>{
    if (gmsLoai && r.loai_csr!==gmsLoai) return false
    if (gmsFrom && r.ngay_kn<gmsFrom) return false
    if (gmsTo   && r.ngay_kn>gmsTo)   return false
    return true
  }), [results, gmsFilter, gmsLoai, gmsFrom, gmsTo])

  // ── Fetch missing parent records for monitoring tab ──────────────────────────
  useEffect(() => {
    if (mainTab !== "giam_sat" || !factoryId) return
    const missingIds = gmsResults
      .map(r => r.parent_id)
      .filter((pid): pid is string => !!pid && !results.some(r => r.id === pid))
    if (!missingIds.length) { setParentMap(new Map()); return }
    supabase.from("qc_results").select("*").in("id", missingIds)
      .then(({ data }) => {
        setParentMap(new Map((data||[]).map(r => [r.id, r])))
      })
  }, [gmsResults, mainTab, factoryId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bootstrap — chỉ chạy 1 lần khi mount để lấy factory ID ─────────────────
  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) {
        setLoading(false)
        setLotsLoading(false)
        return
      }
    setFactoryId(fid)
    loadResults(fid)
    loadStats(fid)
    loadCustomStds(fid)
    const u = JSON.parse(localStorage.getItem("erp_user") || "{}")
    setUserRole(u.role || "")
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
    }
    void bootstrap()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload khi filter thay đổi (sau khi đã có factoryId)
  useEffect(() => {
    if (factoryId) {
      loadResults(factoryId)
      loadStats(factoryId)
    }
  }, [factoryId, loadResults, loadStats])

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

  const getNextLoKN = async (fid: string): Promise<number> => {
    const { count } = await supabase.from("qc_results")
      .select("id",{count:"exact",head:true}).eq("factory_id",fid)
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
    setEditDateModal(null); setKnDateFilter("")
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
      loai_csr: r.loai_csr, ngay_sx: r.ngay_sx, ngay_ht: r.ngay_sx, trang_thai:"Hoàn thành", tong_banh:0
    }
    setEligibleLots([fakeLot])
    setSelectedLotIds(new Set([fakeLot.id]))
    setTabData({ [fakeLot.id]: {
      samples: Object.fromEntries(ALL_FIELDS.map(f=>[f.key,padSamples((r.samples as any)?.[f.key],r.so_mau)])),
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
      const initSamples: Samples = lot.prev_qc
        ? Object.fromEntries(ALL_FIELDS.map(f=>[f.key,padSamples((lot.prev_qc!.samples as any)?.[f.key],createForm.so_mau)]))
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
    return getVisibleFields(createForm.chung_loai).every(field => {
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
      // Insert batch — ALL lots share same pkn + batch_id (one phiếu)
      const [batchPKN, startLoKN] = await Promise.all([
        getNextPKN(factoryId, year),
        getNextLoKN(factoryId),
      ])
      let nextLoKN = startLoKN
      const batchId  = crypto.randomUUID()
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
          batch_id:batchId, pkn:batchPKN, lo_kn:nextLoKN,
          ngay_kn:createForm.ngay_kn, ngay_sx:getLotQcDate(lot),
          chung_loai:createForm.chung_loai, loai_csr:loaiCsr,
          loai_kn:createForm.loai_kn, tieu_chuan:createForm.tieu_chuan,
          so_mau:createForm.so_mau, samples, grade, dat_hang, trang_thai,
          parent_id:parentId||null, lan, notes,
        })
        if (error) { showToast(`Lỗi lô ${lot.ma_lo}: ${error.message}`, false); setSaving(false); return }
        nextLoKN++
      }
      showToast(`Đã lưu phiếu ${formatPKN(batchPKN, createForm.ngay_kn, factoryCode)} — ${selectedLotIds.size} lô`)
    }
    setSaving(false)
    setView("list")
    loadResults(factoryId)
    loadStats(factoryId)
    setEditDateModal(null)
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!factoryId) return
    const { data: affectedResults, error: fetchError } = await supabase
      .from("qc_results")
      .select("lot_id")
      .eq("factory_id", factoryId)
      .eq("id", id)
    if (fetchError) { showToast("Lỗi tải phiếu cần xóa: " + fetchError.message, false); return }

    const { error } = await supabase.from("qc_results").delete().eq("id",id)
    if (error) { showToast("Lỗi xóa: "+error.message, false); return }

    const affectedLotIds = Array.from(
      new Set((affectedResults || []).map(r => r.lot_id).filter(Boolean) as string[])
    )
    if (affectedLotIds.length) {
      const { error: lotError } = await supabase
        .from("lots")
        .update({ trang_thai: "Hoàn thành" })
        .eq("factory_id", factoryId)
        .in("id", affectedLotIds)
      if (lotError) { showToast("Đã xóa phiếu nhưng lỗi cập nhật lô: " + lotError.message, false); return }
    }

    setDelConfirm(null); showToast("Đã xóa phiếu kiểm nghiệm")
    loadResults(factoryId)
    loadStats(factoryId)
  }

  const handleBulkDelete = async () => {
    if (!factoryId || selectedDeleteIds.size===0) return
    const count = selectedDeleteIds.size
    const ids = Array.from(selectedDeleteIds)
    const { data: affectedResults, error: fetchError } = await supabase
      .from("qc_results")
      .select("lot_id")
      .eq("factory_id", factoryId)
      .in("id", ids)
    if (fetchError) { showToast("Lỗi tải phiếu cần xóa: " + fetchError.message, false); return }

    const { error } = await supabase.from("qc_results")
      .delete().in("id", ids)
    if (error) { showToast("Lỗi xóa: "+error.message, false); return }

    const affectedLotIds = Array.from(
      new Set((affectedResults || []).map(r => r.lot_id).filter(Boolean) as string[])
    )
    if (affectedLotIds.length) {
      const { error: lotError } = await supabase
        .from("lots")
        .update({ trang_thai: "Hoàn thành" })
        .eq("factory_id", factoryId)
        .in("id", affectedLotIds)
      if (lotError) { showToast("Đã xóa phiếu nhưng lỗi cập nhật lô: " + lotError.message, false); return }
    }

    setSelectedDeleteIds(new Set()); setDeleteMode(null)
    showToast(`Đã xóa ${count} phiếu`)
    loadResults(factoryId)
    loadStats(factoryId)
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

  // ── Import Excel/CSV ─────────────────────────────────────────────────────────
  const handleImport = async (file: File) => {
    if (!factoryId) return
    setImporting(true)
    setImportResult(null)

    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array", cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: "yyyy-mm-dd" }) as string[][]

      if (rows.length < 4) { showToast("File không đúng định dạng (cần ≥4 hàng)", false); setImporting(false); return }

      const metaH = rows[0].map(h => String(h || "").trim().toUpperCase())
      const metaV = rows[1].map(v => String(v || "").trim())
      const meta: Record<string, string> = {}
      metaH.forEach((h, i) => { if (h) meta[h] = metaV[i] })

      const normDate = (raw: string) => {
        if (!raw) return new Date().toISOString().slice(0,10)
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
        const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
        if (m) { const [,a,b,y] = m; return `${y}-${b.padStart(2, "0")}-${a.padStart(2, "0")}` }
        return raw
      }

      const ngayKN = normDate(meta["NGAY_KN"] || "")
      const ngaySX = normDate(meta["NGAY_SX"] || "")
      const rawLoai = meta["CHUNG_LOAI"] || "10"
      const cl = rawLoai.replace(/^(CSR|SVR)/i, "")
      const tieuChuan = meta["TIEU_CHUAN"] || "TCCS 112:2022"

      const colH = rows[2].map(h => String(h || "").trim().toUpperCase())
      const colIdx: Record<string, number> = {}
      colH.forEach((h, i) => { if (h) colIdx[h] = i })

      const soMau = colH.filter(h => /^TC_M\d+$/.test(h)).length || 6
      const loaiKN = soMau >= 14 ? "ngat" : "thuong"

      const loaiCsr = getLoaiCSR(cl, factoryCode)
      const customLimits = customStds.find(s => s.id === tieuChuan)?.limits
      const fieldMap: [string, string][] = [
        ["TC","tap_chat"],["TRO","tro"],["BH","bay_hoi"],
        ["NI","nito"],["PO","po"],["PRI","pri"],
        ["ML","mooney"],["MAU","mau_sac"],
      ]

      const dataRows: { loNM: string; row: string[] }[] = []
      for (let ri = 3; ri < rows.length; ri++) {
        const row = rows[ri]
        if (!row || row.every(v => !v)) continue
        const loNM = String(row[colIdx["LO_NM"]] || "").trim()
        if (loNM) dataRows.push({ loNM, row })
      }

      const { data: factoryLots, error: factoryLotsError } = await supabase.from("lots")
        .select("id,ma_lo,ngay_sx,ngay_ht,trang_thai,tong_banh")
        .eq("factory_id", factoryId)
        .eq("loai_csr", loaiCsr)
      if (factoryLotsError) throw factoryLotsError

      const lotByExact = new Map<string, { id: string; ma_lo: string; ngay_sx: string; ngay_ht?: string | null; trang_thai?: string; tong_banh?: number }>()
      const lotByBase = new Map<string, { id: string; ma_lo: string; ngay_sx: string; ngay_ht?: string | null; trang_thai?: string; tong_banh?: number } | null>()
      ;(factoryLots || []).forEach(lot => {
        const exactKey = normalizeLotCode(lot.ma_lo)
        const baseKey = stripYear(lot.ma_lo)
        lotByExact.set(exactKey, pickCanonicalLot(lotByExact.get(exactKey), lot))
        lotByBase.set(baseKey, pickCanonicalLot(lotByBase.get(baseKey), lot))
      })

      const { data: existingQcRows, error: existingQcRowsError } = await supabase
        .from("qc_results")
        .select("id,lot_id,ma_lo,ngay_kn")
        .eq("factory_id", factoryId)
        .eq("loai_csr", loaiCsr)
      if (existingQcRowsError) throw existingQcRowsError

      const warnings: string[] = []
      const errors: string[] = []
      const seenImportLots = new Set<string>()
      const preparedRows: {
        sourceLot: string
        matchedLot: { id: string; ma_lo: string; ngay_sx: string; ngay_ht?: string | null; trang_thai?: string; tong_banh?: number }
        samples: Samples
      }[] = []

      for (const { loNM, row } of dataRows) {
        const samples: Samples = {}
        for (const [prefix, fieldKey] of fieldMap) {
          const vals: (string | number)[] = []
          for (let m = 1; m <= soMau; m++) {
            const idx = colIdx[`${prefix}_M${m}`]
            vals.push(idx !== undefined ? (row[idx] || "") : "")
          }
          samples[fieldKey] = vals
        }

        const exactKey = normalizeLotCode(loNM)
        const baseKey = stripYear(loNM)
        const matched = lotByExact.get(exactKey) || lotByBase.get(baseKey) || null
        if (!matched) {
          errors.push(`Lô ${loNM}: không tìm thấy lô thành phẩm tương ứng để gắn lot_id`)
          continue
        }

        const canonicalKey = normalizeLotCode(matched.ma_lo)
        if (seenImportLots.has(canonicalKey)) {
          warnings.push(`Lô ${loNM}: trùng lặp trong file import, chỉ giữ lại dòng đầu tiên`)
          continue
        }

        const lotNgaySX = getLotQcDate(matched)
        if (lotNgaySX !== ngaySX) {
          warnings.push(`Lô ${loNM}: bỏ qua vì ngày SX file ${ngaySX} không khớp ngày hoàn thành lô ${lotNgaySX}`)
          continue
        }

        const existingQc = (existingQcRows || []).find(qc =>
          qc.lot_id === matched.id || matchesLotCode(matched.ma_lo, qc.ma_lo)
        )
        if (existingQc) {
          warnings.push(`Lô ${loNM}: đã có phiếu kiểm nghiệm${existingQc.ngay_kn ? ` ngày ${existingQc.ngay_kn}` : ""}, tự động bỏ qua`)
          continue
        }

        seenImportLots.add(canonicalKey)
        preparedRows.push({ sourceLot: loNM, matchedLot: matched, samples })
      }

      if (!preparedRows.length) {
        setImportResult({ ok: 0, skipped: warnings.length, warnings, errors })
        showToast("Không có lô hợp lệ để nhập", false)
        return
      }

      const year = new Date(ngayKN).getFullYear()
      const [batchPKN, startLoKN] = await Promise.all([
        getNextPKN(factoryId, year),
        getNextLoKN(factoryId),
      ])
      let nextLoKN = startLoKN
      const batchId = crypto.randomUUID()
      let okCount = 0

      for (const { sourceLot, matchedLot, samples } of preparedRows) {
        const { grade, dat_hang, trang_thai } = calcGrade(samples, loaiCsr, tieuChuan, customLimits)

        const { error } = await supabase.from("qc_results").insert({
          factory_id: factoryId, lot_id: matchedLot.id, ma_lo: matchedLot.ma_lo,
          batch_id: batchId, pkn: batchPKN, lo_kn: nextLoKN,
          ngay_kn: ngayKN, ngay_sx: getLotQcDate(matchedLot) || ngaySX,
          chung_loai: cl, loai_csr: loaiCsr,
          loai_kn: loaiKN, tieu_chuan: tieuChuan,
          so_mau: soMau, samples, grade, dat_hang, trang_thai,
          parent_id: null, lan: 1, notes: [],
        })

        if (error) errors.push(`Lô ${sourceLot}: ${error.message}`)
        else { okCount++; nextLoKN++ }
      }

      setImportResult({
        ok: okCount,
        skipped: warnings.length,
        warnings,
        errors,
      })
      if (okCount > 0) {
        const skippedText = warnings.length ? `, bỏ qua ${warnings.length} lô` : ""
        showToast(`Đã nhập ${okCount} lô${skippedText} — ${formatPKN(batchPKN, ngayKN, factoryCode)}`)
        loadResults(factoryId)
        loadStats(factoryId)
      } else {
        showToast("Không nhập được lô nào", false)
      }
    } catch (e: unknown) {
      showToast("Lỗi đọc file: " + (e instanceof Error ? e.message : String(e)), false)
    } finally {
      setImporting(false)
      if (importFileRef.current) importFileRef.current.value = ""
    }
  }

  const handleDownloadTemplate = () => {
    const m1 = "NGAY_KN,NGAY_SX,CHUNG_LOAI,LOAI_KN,TIEU_CHUAN,SO_MAU"
    const today = new Date().toISOString().slice(0,10)
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10)
    const m2 = `${today},${yesterday},10,thuong,TCCS 112:2022,6`
    const cols = ["LO_NM",
      ...["TC","TRO","BH","NI","PO","PRI","ML","MAU"].flatMap(p =>
        Array.from({length:6},(_,i)=>`${p}_M${i+1}`)
      )
    ].join(",")
    const ex = "01cs/26,0.050,0.052,0.051,0.050,0.051,0.052,0.44,0.45,0.44,0.45,0.44,0.45,0.55,0.56,0.55,0.56,0.55,0.56,0.42,0.43,0.42,0.43,0.42,0.43,47,48,47,48,47,48,63,64,63,64,63,64,82,83,82,83,82,83,,,,,,"
    const csv = [m1, m2, cols, ex].join("\n")
    const blob = new Blob(["﻿"+csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href=url; a.download="Mau_KN_thuong.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Derived data ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => results.filter(r => {
    if (search && !r.ma_lo?.toLowerCase().includes(search.toLowerCase())
        && !String(r.lo_kn).includes(search)) return false
    return true
  }), [results, search])

  // Ẩn phiếu kl_rot_hang khỏi danh sách chính (chỉ hiện trong Giám sát KN)
  const mainFiltered = useMemo(
    () => filtered.filter(r => r.loai_kn !== "kl_rot_hang"),
    [filtered]
  )

  const dateGroups = useMemo(() => Array.from(
    mainFiltered.reduce((m,r)=>{ const d=r.ngay_kn?.slice(0,10)||"?"; if(!m.has(d)) m.set(d,[]); m.get(d)!.push(r); return m }, new Map<string,QcResult[]>())
  ).sort((a,b)=>b[0].localeCompare(a[0])), [mainFiltered])

  // Dropdown ngày SX cho kl_rot_hang và kl_6thang
  const eligibleDates = useMemo(() => {
    if (!["kl_rot_hang","kl_6thang"].includes(createForm.loai_kn)) return []
    const dates = new Set<string>()
    eligibleLots.forEach(l => { const lotDate = getLotQcDate(l); if (lotDate) dates.add(lotDate) })
    return [...dates].sort().reverse()
  }, [createForm.loai_kn, eligibleLots])

  // Lots hiển thị sau khi filter ngày SX
  const displayLots = useMemo(() => {
    if (!["kl_rot_hang","kl_6thang"].includes(createForm.loai_kn) || !knDateFilter)
      return eligibleLots
    return eligibleLots.filter(l => getLotQcDate(l) === knDateFilter)
  }, [createForm.loai_kn, eligibleLots, knDateFilter])

  // Map: qc_result.id gốc → kết quả KN lại rớt hạng mới nhất (để hiện badge)
  const retestByParentId = useMemo(() => {
    const map = new Map<string, QcResult>()
    results
      .filter(r => r.loai_kn === "kl_rot_hang" && r.parent_id)
      .forEach(r => {
        const ex = map.get(r.parent_id!)
        if (!ex || new Date(r.created_at||0) > new Date(ex.created_at||0))
          map.set(r.parent_id!, r)
      })
    return map
  }, [results])

  const { latestPerLot, stats } = useMemo(() => {
    // latestPerLot: dùng results (có filter) để hiển thị đúng trong list view
    const map = new Map<string,QcResult>()
    results.forEach(r=>{
      const k=r.lot_id||r.ma_lo
      const ex=map.get(k)
      const rLan=r.lan||1, exLan=ex?.lan||1
      if(!ex || rLan > exLan || (rLan === exLan && new Date(r.created_at||0)>new Date(ex.created_at||0)))
        map.set(k,r)
    })

    // stats: dùng statsResults (không filter trang_thai) để phản ánh thực tế
    const statsMap = new Map<string,QcResult>()
    statsResults.forEach(r=>{
      const k=r.lot_id||r.ma_lo
      const ex=statsMap.get(k)
      const rLan=r.lan||1, exLan=ex?.lan||1
      if(!ex || rLan > exLan || (rLan === exLan && new Date(r.created_at||0)>new Date(ex.created_at||0)))
        statsMap.set(k,r)
    })
    const deduped = Array.from(statsMap.values())
    const khongDatCount = deduped.filter(r=>r.dat_hang?.endsWith("RH")).length
    const datCount = deduped.length - khongDatCount
    return {
      latestPerLot: map,
      stats: {
        total: deduped.length,
        dat: datCount,
        khongDat: khongDatCount,
        tyLe:      deduped.length ? Math.round(datCount/deduped.length*100) : 0,
        tyLeKhongDat: deduped.length ? Math.round(khongDatCount/deduped.length*100) : 0,
      }
    }
  }, [results, statsResults])

  const gmsStats = useMemo(() => ({
    rotCT: results.filter(r=>r.parent_id&&!r.dat_hang?.endsWith("RH")).length,
    thang6: results.filter(r=>r.loai_kn==="kl_6thang"&&r.parent_id).length,
    total: results.filter(r=>r.parent_id).length,
  }), [results])

  // Create view: loaiCsr derived from form
  const createLoaiCSR = getLoaiCSR(createForm.chung_loai, factoryCode)
  const createVisibleFields = ALL_FIELDS.filter(f=>getVisibleFields(createForm.chung_loai).includes(f.key))

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
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Ngày SX {!["kl_rot_hang","kl_6thang"].includes(createForm.loai_kn) && <span className="text-red-500">*</span>}
                </label>
                {["kl_rot_hang","kl_6thang"].includes(createForm.loai_kn) ? (
                  <select value={knDateFilter} onChange={e=>setKnDateFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    <option value="">Tất cả</option>
                    {eligibleDates.map(d=>(
                      <option key={d} value={d}>
                        {new Date(d+"T00:00:00").toLocaleDateString("vi-VN")}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="date" value={createForm.ngay_sx}
                    onChange={e=>{
                      handleCreateFormChange({ngay_sx:e.target.value})
                      setSelectedLotIds(new Set())
                      setTabData({})
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
                )}
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
                    const patch: Partial<CreateForm> = {loai_kn:e.target.value, so_mau: opt?.defaultMau||6}
                    if (e.target.value==="kl_rot_hang") patch.ngay_sx = ""
                    handleCreateFormChange(patch)
                    setKnDateFilter("")
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
            <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 mb-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-bold text-slate-700">
                  {createForm.loai_kn==="kl_6thang" ? "Lô tồn kho > 6 tháng" :
                   createForm.loai_kn==="kl_rot_hang" ? "Lô rớt hạng cần KN lại" :
                   "Lô chưa kiểm nghiệm"}
                </span>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">
                  {lotsLoading ? "..." : displayLots.length}
                </span>
                {selectedLotIds.size > 0 && (
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">
                    Đã chọn {selectedLotIds.size}
                  </span>
                )}
              </div>
              {lotsLoading ? (
                <div className="text-sm text-slate-400 py-4 text-center">Đang tải lô...</div>
              ) : displayLots.length === 0 ? (
                <div className="text-sm text-slate-400 py-4 text-center">
                  {!createForm.ngay_sx && createForm.loai_kn==="thuong"
                    ? "Vui lòng chọn Ngày SX"
                    : knDateFilter && eligibleLots.length > 0
                    ? "Không có lô phù hợp trong ngày đã chọn"
                    : "Không có lô phù hợp"}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {displayLots.map(lot => {
                    const sel = selectedLotIds.has(lot.id)
                    return (
                      <button key={lot.id} onClick={()=>toggleLot(lot)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all btn-press ${
                          sel ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
                        {sel && <span className="mr-1">✓</span>}
                        {lot.ma_lo}
                        {lot.prev_qc && <span className="ml-1 opacity-60">{lot.prev_qc.dat_hang?.endsWith("RH")?"✗":"↺"}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab panel */}
          {selectedLotIds.size > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
              {/* Tab bar */}
              <div className="flex border-b border-slate-200 overflow-x-auto bg-slate-50">
                {Array.from(selectedLotIds).map(lotId => {
                  const lot = eligibleLots.find(l=>l.id===lotId)
                  const filled = isTabFilled(lotId)
                  const preview = tabData[lotId]?.preview
                  const active = activeTabLotId===lotId
                  const icon = !filled ? "⏳" : !preview?.dat_hang?.endsWith("RH") ? "✓" : "✗"
                  const iconColor = !filled ? "text-slate-400" : !preview?.dat_hang?.endsWith("RH") ? "text-emerald-600" : "text-red-500"
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
                          !preview.dat_hang?.endsWith("RH") ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                          {!preview.dat_hang?.endsWith("RH") ? <Check size={14}/> : <X size={14}/>}
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
          {/* Hidden file input for import */}
          <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f=e.target.files?.[0]; if (f) handleImport(f) }}/>

          {/* Page header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800">Kiểm nghiệm</h1>
              <p className="text-sm text-slate-500 mt-0.5">Kết quả kiểm nghiệm — TCCS / TCVN / TCKH</p>
            </div>
            {mainTab !== "thong_ke" && (
              <div className="flex items-center gap-2">
                {userRole === "admin" && (
                  <>
                    <button onClick={handleDownloadTemplate}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all border border-slate-200">
                      <Download size={14}/> Tải mẫu
                    </button>
                    <button onClick={()=>importFileRef.current?.click()} disabled={importing}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 rounded-xl transition-all border border-blue-200 disabled:opacity-40">
                      {importing ? <RefreshCw size={14} className="animate-spin"/> : <Upload size={14}/>}
                      {importing ? "Đang nhập..." : "Nhập KN"}
                    </button>
                  </>
                )}
                <button onClick={()=>openCreate()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all btn-press">
                  <Plus size={16}/> Tạo phiếu KN
                </button>
              </div>
            )}
          </div>

          {/* Tab nav */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5 w-fit">
            {([
              { val:"xep_hang", label:"Xếp hạng", icon:Star },
              { val:"giam_sat", label:"Giám sát KN", icon:Eye },
              { val:"thong_ke", label:"Thống kê", icon:BarChart2 },
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
              <div className="grid grid-cols-4 gap-3 mb-5">
                {[
                  { label:"Tổng lô (mới nhất)", value:stats.total,                                            color:"text-slate-700",   Icon:ClipboardCheck, ic:"text-slate-400"   },
                  { label:"Đạt hạng",            value:`${stats.dat} lô`,                                     color:"text-emerald-600", Icon:Check,          ic:"text-emerald-400" },
                  { label:"Rớt hạng",            value:`${stats.khongDat} lô (${stats.tyLeKhongDat}%)`,       color:"text-red-500",     Icon:XCircle,        ic:"text-red-400"     },
                  { label:"Tỷ lệ đạt",           value:stats.tyLe+"%",                                        color:"text-blue-600",    Icon:BarChart2,      ic:"text-blue-400"    },
                ].map(s=>(
                  <div key={s.label} className="bg-white rounded-xl border border-slate-200 shadow-md p-4 text-center">
                    <s.Icon size={20} className={`mx-auto mb-1 ${s.ic} opacity-80`}/>
                    <div className={`text-2xl font-extrabold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Filter bar */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
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
                  <option value="dat_hang">Đạt hạng</option>
                  <option value="rot_hang">Rớt hạng</option>
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
                <div className="space-y-3">
                  {dateGroups.map(([date, dateResults]) => {
                    const expanded = expandedDates.has(date)
                    const inDeleteMode = deleteMode===date
                    const dateDat = dateResults.filter(r=>!r.dat_hang?.endsWith("RH")).length
                    const hasRetest = dateResults.some(r=>r.parent_id || retestByParentId.has(r.id))

                    // Distinct batches in this date group (dedup by batch_id or pkn)
                    const batches = Array.from(
                      dateResults.reduce((m,r)=>{
                        const key=r.batch_id||String(r.pkn)
                        if(!m.has(key)) m.set(key, {pkn:r.pkn, ngay_kn:r.ngay_kn, batch_id:r.batch_id})
                        return m
                      }, new Map<string,{pkn:number;ngay_kn:string;batch_id?:string}>())
                    ).map(([,v])=>v)

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
                              {dateResults.length} lô
                            </span>
                            {/* Batch PKN badges */}
                            {batches.map(b=>(
                              <span key={b.pkn} className="px-2 py-0.5 bg-violet-50 border border-violet-200 text-violet-700 text-[10px] font-bold rounded-full">
                                {formatPKN(b.pkn, b.ngay_kn, factoryCode)}
                              </span>
                            ))}
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
                                <button onClick={async e=>{e.stopPropagation();
                                  // Nếu lô đã kiểm lại → dùng kết quả mới nhất (samples+grade+dat_hang)
                                  const parentIds = dateResults.map(r=>r.id)
                                  const { data: retests } = await supabase.from("qc_results")
                                    .select("*")
                                    .in("parent_id", parentIds)
                                    .order("created_at", { ascending: false })
                                  const retestMap = new Map<string,QcResult>()
                                  ;(retests||[]).forEach(r=>{ if(r.parent_id&&!retestMap.has(r.parent_id)) retestMap.set(r.parent_id, r) })
                                  // Substitute re-test record but keep lo_kn từ bản gốc để PDF đúng số thứ tự
                                  const resolved = dateResults.map(r=> {
                                    const rt = retestMap.get(r.id)
                                    return rt ? {...rt, lo_kn: r.lo_kn, ma_lo: r.ma_lo} : r
                                  })
                                  const w=window.open("","_blank","width=960,height=680")
                                  if(w){w.document.write(buildPrintHTML(resolved,factoryName,date,factoryCode));w.document.close()}}}
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
                                {["Lô PKN","Lô KN","Loại","Tiêu chuẩn","Tạp chất","Tro","PRI","Kết quả",""].map(h=>(
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
                                    <td className="px-3 py-2.5 text-center font-bold text-violet-700 text-xs font-mono">
                                      {r.lo_kn||"—"}
                                      {r.parent_id && <span className="ml-1 px-1 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded">KN lại</span>}
                                      {retestByParentId.has(r.id) && <span className="ml-1 px-1 py-0.5 bg-violet-100 text-violet-700 text-[9px] font-bold rounded">↺ KN lại</span>}
                                    </td>
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
                                        !r.dat_hang?.endsWith("RH")?"bg-emerald-100 text-emerald-700":"bg-red-100 text-red-600"}`}>
                                        {!r.dat_hang?.endsWith("RH")?`✓ ${r.dat_hang}`:`✗ ${r.dat_hang||"Rớt hạng"}`}
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
                                      <td colSpan={inDeleteMode?10:9} className="px-4 py-4 bg-slate-50">
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
              <div className="grid grid-cols-3 gap-3 mb-5">
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
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
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
                <div className="space-y-3">
                  {gmsResults.map(r => {
                    const parent = results.find(p=>p.id===r.parent_id) ?? parentMap.get(r.parent_id!)
                    return (
                      <div key={r.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        {/* Card header */}
                        <div className="px-5 py-3 flex items-center gap-4 border-b border-slate-100 bg-slate-50">
                          <span className="font-extrabold text-slate-800">Lô {r.ma_lo}</span>
                          <span className="text-xs text-slate-500">{formatPKN(r.pkn, r.ngay_kn, factoryCode)}</span>
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">{r.loai_csr}</span>
                          <span className="text-xs text-slate-400">KN: {new Date(r.ngay_kn).toLocaleDateString("vi-VN")}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${!r.dat_hang?.endsWith("RH")?"bg-emerald-100 text-emerald-700":"bg-red-100 text-red-600"}`}>
                            {!r.dat_hang?.endsWith("RH")?`✓ ${r.dat_hang}`:`✗ ${r.dat_hang}`}
                          </span>
                          <button onClick={()=>{
                            const batchLots = results.filter(r2=>
                              r.batch_id ? r2.batch_id===r.batch_id : (r2.pkn===r.pkn&&r2.ngay_kn===r.ngay_kn&&!!r2.parent_id)
                            )
                            const w=window.open("","_blank","width=960,height=680")
                            if(w){w.document.write(buildPrintHTML(batchLots.length?batchLots:[r],factoryName,r.ngay_kn,factoryCode));w.document.close()}
                          }} className="ml-auto flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors">
                            <Printer size={11}/> PDF
                          </button>
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

          {mainTab === "thong_ke" && <QualityAnalyticsPage embedded factoryId={factoryId} />}
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
                  <span className="text-xs text-slate-400">Lô PKN {r.lo_kn}</span>
                  <span className="font-semibold text-emerald-700">{r.ma_lo}</span>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">{r.loai_csr}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ml-auto ${!r.dat_hang?.endsWith("RH")?"bg-emerald-100 text-emerald-700":"bg-red-100 text-red-600"}`}>
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

      {/* ── IMPORT RESULT MODAL ─────────────────────────────────────────────── */}
      {importResult && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-extrabold text-slate-800">Kết quả nhập dữ liệu</h2>
              <button onClick={()=>setImportResult(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={16}/></button>
            </div>
            <div className="p-6 space-y-3">
              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${importResult.ok>0?"bg-emerald-50 text-emerald-700":"bg-slate-50 text-slate-600"}`}>
                <Check size={18} className={importResult.ok>0?"text-emerald-600":"text-slate-400"}/>
                <span className="font-bold">Nhập thành công: {importResult.ok} lô</span>
              </div>
              {importResult.warnings.length > 0 && (
                <div className="bg-amber-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-amber-700 font-bold text-sm mb-2">
                    <AlertTriangle size={14}/> {importResult.warnings.length} cảnh báo, đã bỏ qua {importResult.skipped} lô
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(() => {
                      const warningSummary = summarizeImportWarnings(importResult.warnings)
                      return (
                        <>
                          <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700">
                            Trùng KN: {warningSummary.duplicateQc}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
                            Sai ngày hoàn thành: {warningSummary.wrongDate}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-700">
                            Trùng trong file: {warningSummary.duplicateInFile}
                          </span>
                          {warningSummary.other > 0 && (
                            <span className="inline-flex items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                              Lý do khác: {warningSummary.other}
                            </span>
                          )}
                        </>
                      )
                    })()}
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {importResult.warnings.map((e,i)=>(
                      <div key={i} className="text-xs text-amber-700 font-mono">{e}</div>
                    ))}
                  </div>
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div className="bg-red-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-red-700 font-bold text-sm mb-2">
                    <AlertTriangle size={14}/> {importResult.errors.length} lỗi
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {importResult.errors.map((e,i)=>(
                      <div key={i} className="text-xs text-red-600 font-mono">{e}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end">
              <button onClick={()=>setImportResult(null)}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md">
                Đóng
              </button>
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
