"use client"
import { useState, useEffect, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"
import { Truck, Plus, ChevronRight, X, Search, Calendar, Edit2, Trash2, Check, Weight, Info, Download, Map, Lock, Unlock, Upload } from "lucide-react"

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
  kl_ct: string
  drc_c: string
  kl_ck: string
  kl_dct: string
  drc_dc: string
  kl_dck: string
  kl_dkt: string
  drc_dk: string
  kl_dkk: string
  kl_dt: string
  drc_d: string
  kl_dk: string
  kl_mn: string    // Mủ nước tươi (kg) — dây chuyền Mủ nước
  drc_mn: string   // DRC% mủ nước
  kl_mnk: string   // Mủ nước khô — AUTO-CALC
  ngan_ref: string[]
  locked?: boolean
  _warn?: string
}

type DispatchEntry = {
  id: string
  factory_id: string
  ngay: string
  chung_nhan: string
  day_chuyen?: string  // "Mủ tạp" | "Mủ nước"
  rows: DxRow[]
  created_at?: string
  ma_dx?: string
}

type GeoJsonFeature = {
  type: string
  properties: Record<string, string>
  geometry: unknown
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
type DiemGN = { ma_lo: string; lat: number; lng: number; doi: number; phien_a: string[]; phien_b: string[]; phien_c: string[]; phien_d: string[] }
const DIEM_GN: DiemGN[] = [
  { ma_lo:"B5",  doi:2,  lat:12.632736, lng:105.495549, phien_a:["A3","A4","A5","A6","A7","B4","B5","B6","B7","C4","C5D","C5T","D4","D5D","D5T","E4","E5"], phien_b:["B4","C4","D4","E4"], phien_c:["E5","D5D","C5D","C5T"], phien_d:["A3","A4","A5"] },
  { ma_lo:"C16", doi:5,  lat:12.628052, lng:105.546290, phien_a:["A14","A15","A16","A17","A18","B14","B15","B16","B17","B18","C14","C15D","C15T","C16","C17","C18"], phien_b:["A14","B15","B14","C14"], phien_c:["A15","A16","A17","A18"], phien_d:["B18","B17","C17","C18"] },
  { ma_lo:"C17", doi:5,  lat:12.628048, lng:105.550884, phien_a:["A14","A15","A16","A17","A18","B14","B15","B16","B17","B18","C14","C15D","C15T","C16","C17","C18"], phien_b:["A14","B15","B14","C14"], phien_c:["A15","A16","A17","A18"], phien_d:["B18","B17","C17","C18"] },
  { ma_lo:"D9",  doi:2,  lat:12.623630, lng:105.513983, phien_a:["A8","A9","A10","B8","B9","B10","C7","C8","C9","C10","D6","D7","D8","D10"], phien_b:["A8","A9","A10","B8"], phien_c:["B9","B10","C9","C10"], phien_d:["D6","D7","C6","C7"] },
  { ma_lo:"D11", doi:5,  lat:12.623617, lng:105.523006, phien_a:["A11","A12","A13","B11","B12","B13","C11","C12","C13","D11","D12","E11","E12","F11","F12"], phien_b:["A11","A12","B11","B12"], phien_c:["A13","B13","C13","D12"], phien_d:["C11","C12","D11","F12"] },
  { ma_lo:"E1",  doi:1,  lat:12.619189, lng:105.477754, phien_a:["A1","A2","B1","B2","B3","C1","C2","C3","D1","D2","D3","E1","E2D","E2T","E3","F1","F2","F3D","F3T"], phien_b:["A1","A2","B1","B2","B3"], phien_c:["C1","C2","C3","D1"], phien_d:["D2","E1","E2D","E2T","E3"] },
  { ma_lo:"F16", doi:8,  lat:12.614454, lng:105.546214, phien_a:["D13","D14","D15S","D15T","D16","D17","D18","E13","E14","E15","E16","E17","E18","F13","F14","F15"], phien_b:["D13","D14","D15S","D15T","D16","D17"], phien_c:["D17","D18","E16","E17","E18"], phien_d:["E16","E14","E15","E13"] },
  { ma_lo:"G3",  doi:1,  lat:12.610155, lng:105.486360, phien_a:["F4","F5","G1","G2","G3","G4","G5","H1","H2","H2D","H3","H3D","H4T","H4S","H5","H6T","H6S","I3","I4","I5","J4"], phien_b:["G1","G2","G3","H1","H2"], phien_c:["H3","H4T","G4","F4"], phien_d:["F5","G5","G6"] },
  { ma_lo:"G5",  doi:1,  lat:12.610102, lng:105.495616, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"G8",  doi:3,  lat:12.609511, lng:105.509254, phien_a:["E6","E7","E8","E9","F6D","F6T","F7","F8","F9D","F9T","G7","G8","G9","H8","H9"], phien_b:["E6","E7","E8","F6D","F6T"], phien_c:["D9","E9","F9D","F9T","F8"], phien_d:["F7","G7","G8","G9"] },
  { ma_lo:"G9",  doi:3,  lat:12.610070, lng:105.513951, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"H11", doi:6,  lat:12.605554, lng:105.524477, phien_a:["F10","G10","G11","G12","H10","H11","H12","I10","I11","I12","J13","J14"], phien_b:["F10","G10","H10"], phien_c:["G11","H11","I11"], phien_d:["G12","H12","J14"] },
  { ma_lo:"I16", doi:8,  lat:12.600919, lng:105.546180, phien_a:["F16","F17","F18","G17","G18","H16","H17","H18","I16","I17","I18","J16","J17","J18"], phien_b:["F16","F17","F18","G17"], phien_c:["G17","G18","H18","H17"], phien_d:["H17","H16","I16","I17","I18"] },
  { ma_lo:"J7",  doi:3,  lat:12.596465, lng:105.504800, phien_a:["H7","I6","I7","I8","I9","J5","J6T","J6S","J7","J8","J9","K5","K6","K7","K8","K9D","K9T","L6T","L7T","L7S","L8T","L8S"], phien_b:["H7","I7","I8","I9"], phien_c:["I6","J5","J6T","J6S","K5","K6","L6T"], phien_d:["J7","J8","J9","I9"] },
  { ma_lo:"K10", doi:6,  lat:12.591972, lng:105.518578, phien_a:["M9D","M9T","M10","M12","L9","L10","L11","L12","K9D","K9T","K10","K11","K12B","K12N","J10","J11","J12"], phien_b:["M9D","M9T","M10","M11","L9","L10","L11","K9D","K9T"], phien_c:["K10","K11","L11","J10"], phien_d:["J11","J12","L12","K12B","K12N"] },
  { ma_lo:"L2",  doi:4,  lat:12.587526, lng:105.481750, phien_a:["I1","I2","J1T","J1D","J2","K1","K2","K3","K4","K5D","K5T","L1","L2","L3","L4","L5D","M1","M2","M3","N1","N2"], phien_b:["I1","I2","J1T","J1D","J2","K1"], phien_c:["K2","K3","K4","K5D","K5T","L4","L5T","L3"], phien_d:["L1","L2","L3","M3"] },
  { ma_lo:"L12", doi:6,  lat:12.587459, lng:105.526876, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"L14", doi:7,  lat:12.586751, lng:105.537313, phien_a:["N13","N14","N15","N16","M13S","M13T","M14","M15","M16","L14","L15","L16","K15","K16"], phien_b:["N14","N15","N16"], phien_c:["N13","M13S","M13T","M14","L14","L15"], phien_d:["L15","M15","M16"] },
  { ma_lo:"C2",  doi:1,  lat:12.628201, lng:105.481744, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"Q7",  doi:10, lat:12.564886, lng:105.504734, phien_a:["O4","O5","O6","O7","O8","P5","P6","P7","P8","P9","Q5","Q6","Q7","Q8","Q9","R5","R6","R7","R8","R9","R10","S4","S5S"], phien_b:["O4","O5","O7","Q5","R5","R6","S4","S5T"], phien_c:["O6","P5","P6","Q6","Q7","R7","R8"], phien_d:["O8","P7","P8","P9","Q8","Q9","R9","R10"] },
  { ma_lo:"P11", doi:10, lat:12.569342, lng:105.523130, phien_a:["O9","O10","O11","P10","P11","Q10"], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"U2",  doi:9,  lat:12.546942, lng:105.482256, phien_a:["T1","T2","T3","T4","U1","U2","U3","U4","V1S","V2S","V2T","V3S","V3T","V4S","V4T","V5S","V5T"], phien_b:["S1","S2","S3","T1","T2","T3"], phien_c:["U1","V1S","V2S","V2T","U2"], phien_d:["T4","U3","U4"] },
  { ma_lo:"P3",  doi:9,  lat:12.569427, lng:105.486326, phien_a:["O1","O2","O3","P1","P2","P3","P4","Q1","Q2","Q3","Q4","R1","R2","R3","R4"], phien_b:["O1","O2","P1","P2"], phien_c:["Q1","Q2","R1","R2"], phien_d:["O3","P3","Q3","R3"] },
  { ma_lo:"T7",  doi:11, lat:12.551328, lng:105.504718, phien_a:["S5T","S6","T5","T6","T7","T8","U5","U6","U7","U8","V6S","V6T","V7S","V7T","V8T"], phien_b:["S5T","S6","T5","T6"], phien_c:["T7","T8","U7"], phien_d:["U5","U6","V6S","V6T"] },
  { ma_lo:"U11", doi:11, lat:12.545692, lng:105.523100, phien_a:["S8","S9","S10T","S10D","S11","T9","T10","T11","T12","U9","U10","U11","U12","U13","V9T","V10T","V8S","V9S","V10S"], phien_b:["S8","S9","T9","U9"], phien_c:["U10","V9T","V10T","V8S","V9S","V10S"], phien_d:["S10D","S10T","S11","T10","T11T","U11"] },
  { ma_lo:"S15", doi:12, lat:12.555721, lng:105.541486, phien_a:["R15","R16","S14","S15","S16","T14","T15","T16"], phien_b:[], phien_c:[], phien_d:["R15","R16","S15","S16"] },
  { ma_lo:"S12", doi:12, lat:12.555755, lng:105.527695, phien_a:["O12","P12","Q11","Q12","Q13T","R11","R12","R13T","R14","S12","S13","T13"], phien_b:["O12","P12","Q11","Q12","Q13T","R11","R13D","R14"], phien_c:["R12","S12","S13","T13"], phien_d:[] },
  { ma_lo:"P14", doi:12, lat:12.569299, lng:105.536918, phien_a:["O13","O14","O15","O16","P13","P14","P15","P16","Q13D","Q14","Q15","Q16"], phien_b:[], phien_c:["O13","O14","P13","P14"], phien_d:["O15","O16","P15","P16"] },
  { ma_lo:"H13", doi:7,  lat:12.605372, lng:105.532396, phien_a:["G13Đ","G14Đ","G14T","G13T","G15Đ","G15T","G16Đ","G16T"], phien_b:["G16T","G15Đ","G15T","H13Đ","H13T","H14Đ","H14T","H15T"], phien_c:["H15Đ","H15T","I-13Đ","I-13T","I-14Đ","I-14T","I-15Đ","I-15T"], phien_d:["I-13Đ","J15Đ","J15T","K13Đ","K13T","K14Đ","K14T"] },
]

const XU_LY_OPTS = ["Xé","Không xé","Hỗn hợp"]
const DRIVERS = [...new Set(VEHICLES.map(v => v.tai_xe))].sort()

function getAllowedDoi(diemGn: string[]): number[] {
  return [...new Set(diemGn.map(d => DIEM_GN.find(g => g.ma_lo === d)?.doi ?? 0).filter(x => x > 0))]
}

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

function autoCalcKLK(kl_tuoi: string, drc: string): string {
  const t = parseFloat(kl_tuoi); const d = parseFloat(drc)
  if (isNaN(t) || isNaN(d)) return ""
  return (t * d / 100).toFixed(1)
}

// DD/MM/YYYY or YYYY-MM-DD → YYYY-MM-DD
const toISO = (ngay: string) =>
  ngay.includes("/") ? ngay.split("/").reverse().join("-") : ngay

function buildLoThuHoach(diem_gn: string[], phien: string[]): string[] {
  const lots: string[] = []
  for (const dgn of diem_gn) {
    const d = DIEM_GN.find(g => g.ma_lo === dgn)
    if (!d) continue
    for (const p of phien) {
      const key = `phien_${p.replace(/Phiên\s*/i, "").toLowerCase()}` as keyof DiemGN
      const pLots = d[key]
      if (Array.isArray(pLots)) lots.push(...(pLots as string[]))
    }
  }
  return [...new Set(lots)]
}

const emptyRow = (): DxRow => ({
  uid: `r_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
  _date: new Date().toISOString().slice(0,10),
  so_xe: "", chuyen: 1, tai_xe: "",
  diem_gn: [], phien: [], lo_thu_hoach: [],
  xu_ly: "Xé", lo_trinh: [],
  so_km: 0,
  kl_ct: "", drc_c: "", kl_ck: "",
  kl_dct: "", drc_dc: "", kl_dck: "",
  kl_dkt: "", drc_dk: "", kl_dkk: "",
  kl_dt: "", drc_d: "65", kl_dk: "",
  kl_mn: "", drc_mn: "", kl_mnk: "",
  ngan_ref: [],
  locked: false,
})

// ─── MultiSelect inline dropdown ─────────────────────────────────────────────
function MultiSelect({ options, selected, onChange, placeholder }: {
  options: string[]
  selected: string[]
  onChange: (val: string[]) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, openUp: false })
  const [search, setSearch] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const dropH = 280
      const openUp = window.innerHeight - rect.bottom < dropH
      setPos({
        top: openUp ? rect.top + window.scrollY - dropH : rect.bottom + window.scrollY,
        left: Math.min(rect.left + window.scrollX, window.innerWidth - 260),
        openUp,
      })
      setTimeout(() => searchRef.current?.focus(), 50)
    }
    setOpen(o => !o)
    if (open) setSearch("")
  }

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
  const allSelected = filtered.length > 0 && filtered.every(o => selected.includes(o))

  return (
    <div ref={ref} className="relative">
      <button ref={btnRef} type="button" onClick={handleToggle}
        className="w-full min-h-[30px] px-2 py-1 border border-slate-300 rounded-lg text-xs text-left bg-white flex flex-wrap gap-1 items-center hover:border-emerald-400 transition-colors">
        {selected.length === 0
          ? <span className="text-slate-400">{placeholder || "Chọn..."}</span>
          : selected.map(s => <span key={s} className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-semibold">{s}</span>)
        }
      </button>
      {open && (
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, width: 248 }}
          className="bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Search */}
          <div className="p-2 border-b border-slate-100">
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Tìm kiếm..." onClick={e => e.stopPropagation()}
              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-emerald-400"/>
          </div>
          {/* Select all / Clear */}
          <div className="flex gap-1 px-2 py-1.5 border-b border-slate-100">
            <button type="button" onClick={() => onChange([...new Set([...selected, ...filtered])])}
              className="flex-1 text-[10px] font-bold text-emerald-600 hover:bg-emerald-50 rounded px-1 py-0.5 transition-colors">
              {allSelected ? "✓ Tất cả" : "+ Chọn tất cả"}
            </button>
            <button type="button" onClick={() => onChange(selected.filter(s => !filtered.includes(s)))}
              className="flex-1 text-[10px] font-bold text-slate-400 hover:bg-slate-50 rounded px-1 py-0.5 transition-colors">
              Bỏ chọn
            </button>
          </div>
          {/* Options */}
          <div className="max-h-52 overflow-y-auto p-1">
            {filtered.length === 0
              ? <p className="text-xs text-slate-400 text-center py-3">Không tìm thấy</p>
              : filtered.map(opt => (
                <label key={opt} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer text-xs">
                  <input type="checkbox" checked={selected.includes(opt)}
                    onChange={e => onChange(e.target.checked ? [...selected, opt] : selected.filter(x => x !== opt))}
                    className="accent-amber-500 shrink-0"/>
                  <span className={selected.includes(opt) ? "font-semibold text-amber-700" : "text-slate-700"}>{opt}</span>
                </label>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

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
  const [formNgay, setFormNgay]         = useState(new Date().toISOString().slice(0,10))
  const [formCN, setFormCN]             = useState("PEFC CS")
  const [formDayChuyen, setFormDayChuyen] = useState("Mủ tạp")
  const [formRows, setFormRows]         = useState<DxRow[]>([emptyRow()])
  const [editId, setEditId]       = useState<string|null>(null)
  const [saving, setSaving]       = useState(false)

  // Delete
  const [delConfirm, setDelConfirm] = useState<string|null>(null)

  // KL modal, nhà máy, admin
  const [klModal, setKlModal]       = useState(false)
  const [factoryName, setFactoryName] = useState("NMCB Phước Hòa Kampong Thom")
  const [factoryCode, setFactoryCode] = useState("")
  const [isAdmin, setIsAdmin]       = useState(false)
  const [importing, setImporting]   = useState(false)
  const importRef                   = useRef<HTMLInputElement>(null)

  // Toast
  const [toast, setToast]         = useState<string|null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      let q = supabase.from("dispatch_entries")
        .select("*")
        .eq("factory_id", fid)
        .order("ngay", { ascending: false })
      if (filterFrom) q = q.gte("ngay", filterFrom)
      if (filterTo)   q = q.lte("ngay", filterTo)
      const { data } = await q
      const raw = (data || []) as DispatchEntry[]

    // Re-hydrate lo_thu_hoach for legacy rows saved before auto-fill was implemented
    const rehydrated = raw.map(e => ({
      ...e,
      rows: (e.rows || []).map(r => ({
        ...r,
        lo_thu_hoach: r.lo_thu_hoach?.length
          ? r.lo_thu_hoach
          : buildLoThuHoach(r.diem_gn || [], r.phien || [])
      }))
    }))

    // Sort by ISO date desc, then created_at desc (handles mixed DD/MM/YYYY & YYYY-MM-DD)
    rehydrated.sort((a, b) => {
      const da = toISO(a.ngay), db = toISO(b.ngay)
      if (da !== db) return da > db ? -1 : 1
      return (b.created_at || "") > (a.created_at || "") ? 1 : -1
    })

    const byDate: Record<string, DispatchEntry[]> = {}
    for (const e of rehydrated) { const k = toISO(e.ngay); if (!byDate[k]) byDate[k] = []; byDate[k].push(e) }
    const withCode = rehydrated.map(e => {
      const key = toISO(e.ngay)
      const group = [...(byDate[key] || [])].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))
      const seq = group.findIndex(x => x.id === e.id) + 1
      const d = new Date(key)
      const dd = String(d.getDate()).padStart(2,"0")
      const mm = String(d.getMonth()+1).padStart(2,"0")
      const yy = String(d.getFullYear()).slice(-2)
      return { ...e, ma_dx: `DX-${dd}${mm}${yy}/${seq}` }
    })
      setEntries(withCode)
    } finally {
      setLoading(false)
    }
  }, [filterFrom, filterTo])

  // Bootstrap: chỉ chạy 1 lần để lấy factoryId, không có loadData trong deps
  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
      // Factory name + code + isAdmin
      supabase.from("factories").select("*").eq("id", fid).single().then(({ data: f }) => {
        if (f) {
          const fd = f as Record<string, unknown>
          setFactoryName((fd.ten as string) || (fd.name as string) || "NMCB Phước Hòa Kampong Thom")
          setFactoryCode((fd.code as string) || "")
        }
      })
      const u = JSON.parse(localStorage.getItem("erp_user") || "{}")
      setIsAdmin(u.role === "admin")
    }
    void bootstrap()
  }, [])

  // Reload khi factoryId hoặc filter thay đổi
  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

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

  // ── Open Add ─────────────────────────────────────────────────────────────
  const openAdd = () => {
    // Default ngày = max(entries) + 1
    const today = new Date().toISOString().slice(0,10)
    const maxDate = entries.reduce((mx, e) => { const d = toISO(e.ngay); return d > mx ? d : mx }, today)
    const nextDay = new Date(maxDate)
    nextDay.setDate(nextDay.getDate() + 1)
    setFormNgay(nextDay.toISOString().slice(0,10))
    const latest = entries.find(e => toISO(e.ngay) === maxDate)
    if (latest?.rows?.length) {
      setFormRows(latest.rows.map(r => ({
        ...r,
        uid: `r_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        kl_ct: "", drc_c: "", kl_ck: "",
        kl_dct: "", drc_dc: "", kl_dck: "",
        kl_dkt: "", drc_dk: "", kl_dkk: "",
        kl_dt: "", kl_dk: "",
        locked: false, _warn: undefined,
      })))
    } else {
      setFormRows([emptyRow()])
    }
    setFormCN("PEFC CS")
    setFormDayChuyen(latest?.day_chuyen || "Mủ tạp")
    setEditId(null)
    setView("add")
  }

  // ── Open Edit ─────────────────────────────────────────────────────────────
  const openEdit = (entry: DispatchEntry) => {
    setEditId(entry.id)
    setFormNgay(entry.ngay ? toISO(entry.ngay) : new Date().toISOString().slice(0,10))
    setFormCN(entry.chung_nhan || "PEFC CS")
    setFormDayChuyen(entry.day_chuyen || "Mủ tạp")
    setFormRows(entry.rows?.length ? entry.rows.map(r => ({ ...r })) : [emptyRow()])
    setView("edit")
  }

  // ── Save (add or edit) ────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!factoryId) return
    setSaving(true)
    try {
      const payload = {
        factory_id: factoryId,
        ngay: formNgay,
        chung_nhan: formCN,
        day_chuyen: formDayChuyen,
        rows: formRows.map((r,i) => ({ ...r, uid: r.uid || `r_${i}_${Date.now()}`, _date: formNgay })),
      }
      if (editId) {
        const { error } = await supabase.from("dispatch_entries").update(payload).eq("id", editId)
        if (error) { showToast(error.message, "error"); return }
        showToast("Đã cập nhật bảng phân xe")
      } else {
        const { error } = await supabase.from("dispatch_entries").insert(payload)
        if (error) { showToast(error.message, "error"); return }
        showToast("Đã thêm bảng phân xe mới")
      }
      setView("list")
      setEditId(null)
      setFormRows([emptyRow()])
      void loadData(factoryId)
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Lỗi không xác định", "error")
    } finally {
      setSaving(false)
    }
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
    setFormRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const next = { ...r, [field]: val }

      // Auto-fill tài xế + auto-assign chuyến khi chọn xe
      if (field === "so_xe") {
        const v = VEHICLES.find(x => x.ma_hieu === val)
        if (v) next.tai_xe = v.tai_xe
        if (val) {
          const sameXe = prev.filter((r2, i2) => i2 !== idx && r2.so_xe === val)
          next.chuyen = sameXe.length + 1
          next._warn = sameXe.length >= 2 ? `Xe ${val} đã có ${sameXe.length} chuyến trong ngày này!` : undefined
        }
      }

      // Auto-calc KL khô: [kl_field, drc_field, result_field]
      for (const [kf, df, rf] of [
        ["kl_ct",  "drc_c",  "kl_ck" ],
        ["kl_dct", "drc_dc", "kl_dck"],
        ["kl_dkt", "drc_dk", "kl_dkk"],
        ["kl_dt",  "drc_d",  "kl_dk" ],
        ["kl_mn",  "drc_mn", "kl_mnk"],
      ] as [keyof DxRow, keyof DxRow, keyof DxRow][]) {
        if (field === kf || field === df) {
          ;(next as unknown as Record<string, string>)[rf] = autoCalcKLK(
            (field === kf ? val : next[kf]) as string,
            (field === df ? val : next[df]) as string,
          )
        }
      }

      // Khi Điểm GN thay đổi: lọc lộ trình theo đội
      if (field === "diem_gn") {
        const allowed = getAllowedDoi(val as string[])
        if (allowed.length > 0) {
          next.lo_trinh = next.lo_trinh.filter(lt => {
            const d = DIEM_GN.find(g => g.ma_lo === lt)
            return d && allowed.includes(d.doi)
          })
        }
      }

      // Auto-calc khoảng cách Manhattan khi lộ trình / điểm GN thay đổi
      if (field === "lo_trinh" || field === "diem_gn") {
        const stops = field === "lo_trinh" ? val as string[] : next.lo_trinh
        next.so_km = calcManhattanKm(stops.length > 0 ? stops : (next.diem_gn || []))
      }

      if (field === "phien" || field === "diem_gn") {
        next.lo_thu_hoach = buildLoThuHoach(
          field === "diem_gn" ? val as string[] : next.diem_gn,
          field === "phien"   ? val as string[] : next.phien,
        )
      }

      return next
    }))
  }

  // ── Download CSV template ─────────────────────────────────────────────────
  const downloadTemplate = () => {
    const header = "ngay;so_xe;chuyen;tai_xe;diem_giao_nhan;phien_boc;xu_ly;lo_trinh;so_km;kl_ct;drc_c;kl_dct;drc_dc;kl_dkt;drc_dk;kl_dt;drc_d"
    const rows = formRows.map(r => [
      formNgay.split("-").reverse().join("/"),
      r.so_xe, r.chuyen, r.tai_xe,
      r.diem_gn.join(","), r.phien.join(","),
      r.xu_ly, r.lo_trinh.join(","), r.so_km,
      "", "", "", "", "", "", "", "65"
    ].join(";"))
    const csv = [header, ...rows].join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = `dieu_xe_${formNgay}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Download GeoJSON ──────────────────────────────────────────────────────
  const downloadGeoJSON = async () => {
    const allLots = [...new Set(formRows.flatMap(r => r.lo_thu_hoach || []))]
    if (allLots.length === 0) { showToast("Không có lô thu hoạch để xuất GeoJSON"); return }
    try {
      const res = await fetch("/geojson/Lo%20cao%20su%20-%202026_Full.geojson")
      const gj = await res.json()
      const features = (gj.features as GeoJsonFeature[]).filter(f =>
        allLots.includes(f.properties?.Ten || f.properties?.ma_lo || "")
      )
      const output = { type: "FeatureCollection", features, metadata: { ngay: formNgay, factory: factoryName, totalLots: features.length } }
      const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/geo+json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a"); a.href = url; a.download = `dieu_xe_${formNgay}.geojson`; a.click()
      URL.revokeObjectURL(url)
      showToast(`Đã xuất GeoJSON ${features.length} lô`)
    } catch { showToast("Lỗi tải GeoJSON") }
  }

  // ── Parse rows from CSV lines ─────────────────────────────────────────────
  const parseCSVLines = (lines: string[]): Record<string, DxRow[]> => {
    const byDate: Record<string, DxRow[]> = {}
    let uidCounter = Date.now()
    for (const line of lines) {
      const cols = line.split(";")
      const [ngayRaw, so_xe, chuyen, tai_xe, diem_gn_raw, phien_raw, xu_ly, lo_trinh_raw, so_km,
             kl_ct_raw, drc_c_raw, kl_dct_raw, drc_dc_raw, , drc_dk_raw, kl_dt_raw, drc_d_raw] = cols
      if (!ngayRaw || !so_xe?.trim()) continue
      const parts = ngayRaw.trim().split("/")
      const ngay = parts.length === 3 ? `20${parts[2].slice(-2)}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}` : ngayRaw.trim()
      const kl_ct = (kl_ct_raw || "").trim()
      const drc_c = (drc_c_raw || "").replace(",", ".").trim()
      const kl_dct = (kl_dct_raw || "").trim()
      const drc_dc = (drc_dc_raw || "").replace(",", ".").trim()
      const drc_dk = (drc_dk_raw || "").replace(",", ".").trim()
      const dgns = diem_gn_raw.split(",").map(s => s.trim()).filter(Boolean)
      const phiens = phien_raw.split(",").map(s => s.trim()).filter(Boolean)
      const row: DxRow = {
        uid: `r_${uidCounter++}_${Math.random().toString(36).slice(2,6)}`,
        _date: ngay, so_xe: so_xe.trim(),
        chuyen: parseInt(chuyen) || 1, tai_xe: tai_xe.trim(),
        diem_gn: dgns,
        phien: phiens,
        lo_thu_hoach: buildLoThuHoach(dgns, phiens), xu_ly: xu_ly.trim() || "Xé",
        lo_trinh: lo_trinh_raw.split(",").map(s => s.trim()).filter(Boolean),
        so_km: parseFloat(so_km) || 0,
        kl_ct, drc_c, kl_ck: autoCalcKLK(kl_ct, drc_c),
        kl_dct, drc_dc, kl_dck: autoCalcKLK(kl_dct, drc_dc),
        kl_dkt: "", drc_dk, kl_dkk: "",
        kl_dt: (kl_dt_raw || "").trim(), drc_d: drc_d_raw?.trim() || "65", kl_dk: "",
        kl_mn: "", drc_mn: "", kl_mnk: "",
        ngan_ref: [], locked: false,
      }
      if (!byDate[ngay]) byDate[ngay] = []
      byDate[ngay].push(row)
    }
    return byDate
  }

  // ── Import CSV / XLSX ─────────────────────────────────────────────────────
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !factoryId) return
    setImporting(true)
    let byDate: Record<string, DxRow[]> = {}

    let csvText: string
    if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      const XLSX = await import("xlsx")
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
      csvText = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: ";" })
    } else {
      csvText = await file.text()
    }
    byDate = parseCSVLines(csvText.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith("ngay")))

    for (const [ngay, rows] of Object.entries(byDate)) {
      const { data: existing } = await supabase.from("dispatch_entries")
        .select("id").eq("factory_id", factoryId).eq("ngay", ngay).single()
      if (existing) {
        await supabase.from("dispatch_entries").update({ rows, chung_nhan: "PEFC CS" }).eq("id", existing.id)
      } else {
        await supabase.from("dispatch_entries").insert({ factory_id: factoryId, ngay, chung_nhan: "PEFC CS", rows })
      }
    }
    setImporting(false)
    showToast(`Import ${Object.keys(byDate).length} ngày thành công`)
    loadData(factoryId)
    e.target.value = ""
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
        <button onClick={openAdd}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
          <Plus size={16}/> Thêm bảng
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {([
          { label: "Tổng bảng phân xe", value: stats.total,                         Icon: Calendar, ic: "text-slate-400"   },
          { label: "Tổng chuyến xe",    value: stats.totalXe,                        Icon: Truck,    ic: "text-emerald-400" },
          { label: "Tổng KL khô (tấn)", value: (stats.totalKg/1000).toFixed(1)+"T", Icon: Weight,   ic: "text-blue-400"    },
        ] as const).map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 shadow-md p-4 text-center">
            <s.Icon size={20} className={`mx-auto mb-1 ${s.ic} opacity-80`}/>
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
                {["Mã ĐX","Ngày","Dây chuyền","Chứng nhận","Số xe","Tổng KL tươi","Tổng KL khô",""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(entry => {
                const isMN = entry.day_chuyen === "Mủ nước"
                const totalKLT = (entry.rows||[]).reduce((s,r) => s + (isMN ? (parseFloat(r.kl_mn)||0) : (parseFloat(r.kl_dct)||0)), 0)
                const totalKLK = (entry.rows||[]).reduce((s,r) => s + (isMN ? (parseFloat(r.kl_mnk)||0) : (parseFloat(r.kl_dck)||0)), 0)
                return (
                  <tr key={entry.id} className="hover:bg-slate-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-slate-500"
                      onClick={() => { setSelected(entry); setView("detail") }}>
                      {entry.ma_dx || "—"}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700"
                      onClick={() => { setSelected(entry); setView("detail") }}>
                      {entry.ngay ? new Date(entry.ngay.includes("/")?
                        entry.ngay.split("/").reverse().join("-") : entry.ngay
                      ).toLocaleDateString("vi-VN") : "—"}
                    </td>
                    <td className="px-4 py-3" onClick={() => { setSelected(entry); setView("detail") }}>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        isMN ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                      }`}>{entry.day_chuyen || "Mủ tạp"}</span>
                    </td>
                    <td className="px-4 py-3" onClick={() => { setSelected(entry); setView("detail") }}>
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-bold">
                        {entry.chung_nhan || "PEFC CS"}
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
          <h1 className="text-2xl font-extrabold text-slate-800">{selected.ma_dx || "Bảng phân xe"} — {selected.ngay}</h1>
          <p className="text-sm text-slate-500 flex items-center gap-2">
            {selected.rows?.length} xe · {selected.chung_nhan}
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              selected.day_chuyen === "Mủ nước" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
            }`}>{selected.day_chuyen || "Mủ tạp"}</span>
          </p>
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

      {/* Page title */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => { setView("list"); setEditId(null) }}
          className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X size={18}/></button>
        <h1 className="text-xl font-extrabold text-slate-800">
          {editId ? "Sửa bảng phân xe" : "Bảng phân xe vận chuyển"}
        </h1>
      </div>

      {/* Dây chuyền — luôn đặt đầu tiên */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-3">
        <label className="text-xs font-bold text-slate-600 block mb-2">Dây chuyền <span className="text-red-500">*</span></label>
        <div className="flex gap-3 items-center">
          {["Mủ tạp", "Mủ nước"].map(dc => (
            <button key={dc} type="button" onClick={() => setFormDayChuyen(dc)}
              className={`px-5 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
                formDayChuyen === dc
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
              }`}>{dc}</button>
          ))}
          <span className="text-xs text-slate-400 ml-2">
            {formDayChuyen === "Mủ tạp" ? "→ Ngăn lưu · NL: Mủ chén / Đông chén / Đông khối / Mủ dây" : "→ Hồ chứa · NL: Mủ nước"}
          </span>
        </div>
      </div>

      {/* Header form — 3 columns */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-3">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày vận chuyển</label>
            <input type="date" value={formNgay} onChange={e => setFormNgay(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Nhà máy (điểm đến)</label>
            <input value={factoryName} disabled
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-500 cursor-not-allowed"/>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Chứng nhận</label>
            <select value={formCN} onChange={e => setFormCN(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
              {(factoryCode === "cuaparis" ? ["PEFC CS","PEFC FM","Không"] : ["PEFC CS","Không"]).map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Toolbar — info bar + action buttons */}
      <div className="flex items-center justify-between mb-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
        <p className="text-xs text-amber-700 flex items-center gap-1.5">
          <Info size={14}/> Lộ trình: chọn từng điểm theo đội.
        </p>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <button onClick={downloadTemplate}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-white border border-slate-300 rounded-lg transition-colors">
              <Download size={12}/> Tải bảng
            </button>
          )}
          {isAdmin && (
            <>
              <input ref={importRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImport}/>
              <button onClick={() => importRef.current?.click()} disabled={importing}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-violet-600 hover:bg-violet-50 border border-violet-300 rounded-lg transition-colors disabled:opacity-50">
                <Upload size={12}/> {importing ? "Đang xử lý..." : "Nhập CSV/XLSX"}
              </button>
            </>
          )}
          <button onClick={() => setKlModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-orange-600 hover:bg-orange-50 border border-orange-300 rounded-lg transition-colors">
            <Weight size={12}/> Nhập KL
          </button>
          <button onClick={downloadGeoJSON}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 border border-blue-300 rounded-lg transition-colors">
            <Map size={12}/> GeoJSON
          </button>
          <button onClick={() => setFormRows(r => [...r, emptyRow()])}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors">
            <Plus size={12}/> Thêm xe
          </button>
        </div>
      </div>

      {/* Compact table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm mb-4">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {["Xe","Chuyến","Tài xế","Điểm GN","Phiên","Lô thu hoạch","Xử lý","Lộ trình","Km",""].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {formRows.map((row, idx) => (
              <tr key={row.uid}
                className={`${row.locked ? "bg-slate-50 opacity-70" : "hover:bg-amber-50"} transition-colors`}>

                {/* Xe */}
                <td className="px-2 py-1.5">
                  <select value={row.so_xe} disabled={!!row.locked}
                    onChange={e => updateRow(idx,"so_xe",e.target.value)}
                    className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-xs disabled:bg-transparent disabled:border-transparent outline-none focus:border-emerald-400">
                    <option value="">--</option>
                    {VEHICLES.map(v => <option key={v.key} value={v.ma_hieu}>{v.ma_hieu}</option>)}
                  </select>
                </td>

                {/* Chuyến — read-only badge */}
                <td className="px-2 py-1.5">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    row.chuyen === 1 ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                  }`}>{row.chuyen}</span>
                  {row._warn && <span className="ml-1 text-red-500 text-[10px]" title={row._warn}>⚠</span>}
                </td>

                {/* Tài xế — dropdown */}
                <td className="px-2 py-1.5">
                  {row.locked
                    ? <span className="text-slate-600 text-xs">{row.tai_xe}</span>
                    : <select value={row.tai_xe} onChange={e => updateRow(idx,"tai_xe",e.target.value)}
                        className="w-32 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400">
                        <option value="">-- Chọn --</option>
                        {DRIVERS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                  }
                </td>

                {/* Điểm GN */}
                <td className="px-2 py-1.5 min-w-[140px]">
                  {row.locked
                    ? <span className="text-slate-600">{row.diem_gn.join(", ") || "—"}</span>
                    : <MultiSelect options={DIEM_GN.map(d => d.ma_lo)} selected={row.diem_gn}
                        onChange={val => updateRow(idx,"diem_gn",val)} placeholder="Chọn điểm..."/>
                  }
                </td>

                {/* Phiên */}
                <td className="px-2 py-1.5 min-w-[130px]">
                  {row.locked
                    ? <span className="text-slate-600">{row.phien.join(", ") || "—"}</span>
                    : <MultiSelect
                        options={["Phiên A","Phiên B","Phiên C","Phiên D"]}
                        selected={row.phien}
                        onChange={val => updateRow(idx,"phien",val)}
                        placeholder="Chọn phiên..."/>
                  }
                </td>

                {/* Lô thu hoạch — chip list */}
                <td className="px-2 py-1.5 max-w-[130px]">
                  {(row.lo_thu_hoach?.length ?? 0) > 0
                    ? <div className="flex flex-wrap gap-0.5">
                        {row.lo_thu_hoach.slice(0,4).map(l => (
                          <span key={l} className="px-1 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px]">{l}</span>
                        ))}
                        {row.lo_thu_hoach.length > 4 && <span className="text-slate-400 text-[10px]">+{row.lo_thu_hoach.length - 4}</span>}
                      </div>
                    : <span className="text-slate-300">—</span>
                  }
                </td>

                {/* Xử lý */}
                <td className="px-2 py-1.5">
                  <select value={row.xu_ly} disabled={!!row.locked}
                    onChange={e => updateRow(idx,"xu_ly",e.target.value)}
                    className="w-16 px-2 py-1 border border-slate-300 rounded-lg text-xs disabled:bg-transparent disabled:border-transparent outline-none focus:border-emerald-400">
                    {XU_LY_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </td>

                {/* Lộ trình — lọc theo đội của Điểm GN */}
                <td className="px-2 py-1.5 min-w-[130px]">
                  {row.locked
                    ? <span className="text-slate-600">{row.lo_trinh.join(", ") || "—"}</span>
                    : (() => {
                        const allowed = getAllowedDoi(row.diem_gn)
                        const opts = allowed.length > 0
                          ? DIEM_GN.filter(d => allowed.includes(d.doi)).map(d => d.ma_lo)
                          : DIEM_GN.map(d => d.ma_lo)
                        return <MultiSelect options={opts} selected={row.lo_trinh}
                          onChange={val => updateRow(idx,"lo_trinh",val)} placeholder="Chọn lộ trình..."/>
                      })()
                  }
                </td>

                {/* Km */}
                <td className="px-2 py-1.5 text-center font-bold text-slate-700 whitespace-nowrap">
                  {row.so_km ? `${row.so_km} km` : "—"}
                </td>

                {/* Lock / Delete */}
                <td className="px-2 py-1.5">
                  {row.locked
                    ? <button onClick={() => updateRow(idx,"locked",false)}
                        title="Mở khóa" className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition-colors">
                        <Lock size={14}/>
                      </button>
                    : <div className="flex gap-0.5">
                        <button onClick={() => updateRow(idx,"locked",true)}
                          title="Khóa hàng" className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors">
                          <Unlock size={14}/>
                        </button>
                        <button onClick={() => setFormRows(r => r.filter((_,i) => i !== idx))}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                          <X size={14}/>
                        </button>
                      </div>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Save footer */}
      <div className="flex justify-end gap-3">
        <button onClick={() => { setView("list"); setEditId(null) }}
          className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-50 transition-all">
          {saving ? "Đang lưu..." : editId ? "Lưu thay đổi" : "Lưu bảng phân xe"}
        </button>
      </div>

      {/* Modal Nhập KL */}
      {klModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                <Weight size={18} className="text-orange-500"/> Nhập khối lượng
              </h3>
              <button onClick={() => setKlModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={18}/></button>
            </div>
            <div className="p-4 overflow-x-auto">
              {/* KL badge dây chuyền */}
              <div className="mb-3 flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  formDayChuyen === "Mủ nước" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                }`}>{formDayChuyen}</span>
                <span className="text-xs text-slate-400">
                  {formDayChuyen === "Mủ tạp" ? "4 nhóm: Mủ chén · Đông chén · Đông khối · Mủ dây" : "1 nhóm: Mủ nước"}
                </span>
              </div>

              {formDayChuyen === "Mủ tạp" ? (
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold text-slate-500 whitespace-nowrap" rowSpan={2}>Xe</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-500 whitespace-nowrap" rowSpan={2}>Tài xế</th>
                    <th className="px-3 py-2 text-center font-bold text-lime-600 whitespace-nowrap border-l border-slate-200" colSpan={3}>Mủ chén</th>
                    <th className="px-3 py-2 text-center font-bold text-amber-600 whitespace-nowrap border-l border-slate-200" colSpan={3}>Đông chén</th>
                    <th className="px-3 py-2 text-center font-bold text-blue-600 whitespace-nowrap border-l border-slate-200" colSpan={3}>Đông khối</th>
                    <th className="px-3 py-2 text-center font-bold text-emerald-600 whitespace-nowrap border-l border-slate-200" colSpan={3}>Mủ dây</th>
                  </tr>
                  <tr className="text-[10px]">
                    {["Tươi (kg)","DRC%","Khô","Tươi (kg)","DRC%","Khô","Tươi (kg)","DRC%","Khô","Tươi (kg)","DRC%","Khô"].map((h,i) => (
                      <th key={i} className={`px-2 py-1 font-bold text-slate-400 whitespace-nowrap ${i===0||i===3||i===6||i===9?"border-l border-slate-200":""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {formRows.map((row, idx) => (
                    <tr key={row.uid} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-emerald-700 whitespace-nowrap">{row.so_xe || "—"}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.tai_xe}</td>
                      <td className="px-2 py-2 border-l border-slate-100">
                        <input value={row.kl_ct} onChange={e => updateRow(idx,"kl_ct",e.target.value)}
                          placeholder="0" className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                      </td>
                      <td className="px-2 py-2">
                        <input value={row.drc_c} onChange={e => updateRow(idx,"drc_c",e.target.value)}
                          placeholder="0" className="w-14 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                      </td>
                      <td className="px-2 py-2 font-semibold text-lime-700 whitespace-nowrap">{row.kl_ck || "—"}</td>
                      <td className="px-2 py-2 border-l border-slate-100">
                        <input value={row.kl_dct} onChange={e => updateRow(idx,"kl_dct",e.target.value)}
                          placeholder="0" className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                      </td>
                      <td className="px-2 py-2">
                        <input value={row.drc_dc} onChange={e => updateRow(idx,"drc_dc",e.target.value)}
                          placeholder="0" className="w-14 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                      </td>
                      <td className="px-2 py-2 font-semibold text-amber-700 whitespace-nowrap">{row.kl_dck || "—"}</td>
                      <td className="px-2 py-2 border-l border-slate-100">
                        <input value={row.kl_dkt} onChange={e => updateRow(idx,"kl_dkt",e.target.value)}
                          placeholder="0" className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                      </td>
                      <td className="px-2 py-2">
                        <input value={row.drc_dk} onChange={e => updateRow(idx,"drc_dk",e.target.value)}
                          placeholder="0" className="w-14 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                      </td>
                      <td className="px-2 py-2 font-semibold text-blue-700 whitespace-nowrap">{row.kl_dkk || "—"}</td>
                      <td className="px-2 py-2 border-l border-slate-100">
                        <input value={row.kl_dt} onChange={e => updateRow(idx,"kl_dt",e.target.value)}
                          placeholder="0" className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                      </td>
                      <td className="px-2 py-2">
                        <input value={row.drc_d} onChange={e => updateRow(idx,"drc_d",e.target.value)}
                          placeholder="65" className="w-14 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                      </td>
                      <td className="px-2 py-2 font-semibold text-emerald-700 whitespace-nowrap">{row.kl_dk || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold text-slate-500 whitespace-nowrap" rowSpan={2}>Xe</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-500 whitespace-nowrap" rowSpan={2}>Tài xế</th>
                    <th className="px-3 py-2 text-center font-bold text-blue-600 whitespace-nowrap border-l border-slate-200" colSpan={3}>Mủ nước</th>
                  </tr>
                  <tr className="text-[10px]">
                    {["Tươi (kg)","DRC%","Khô"].map((h,i) => (
                      <th key={i} className={`px-2 py-1 font-bold text-slate-400 whitespace-nowrap ${i===0?"border-l border-slate-200":""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {formRows.map((row, idx) => (
                    <tr key={row.uid} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-emerald-700 whitespace-nowrap">{row.so_xe || "—"}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.tai_xe}</td>
                      <td className="px-2 py-2 border-l border-slate-100">
                        <input value={row.kl_mn} onChange={e => updateRow(idx,"kl_mn",e.target.value)}
                          placeholder="0" className="w-24 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                      </td>
                      <td className="px-2 py-2">
                        <input value={row.drc_mn} onChange={e => updateRow(idx,"drc_mn",e.target.value)}
                          placeholder="0" className="w-14 px-2 py-1 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"/>
                      </td>
                      <td className="px-2 py-2 font-semibold text-blue-700 whitespace-nowrap">{row.kl_mnk || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end">
              <button onClick={() => setKlModal(false)}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all">Xong</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
