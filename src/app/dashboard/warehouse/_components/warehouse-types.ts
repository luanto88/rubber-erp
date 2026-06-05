// Types và helpers cho module Quản lý kho thành phẩm
// Slot_code format: "{frameCode}-R{row}C{col}"  ví dụ "1A-R1C1"

export type WarehouseCode = "kho1" | "kho2"

export type WarehouseSlot = {
  id: string
  factory_id: string
  warehouse_code: WarehouseCode
  slot_code: string      // "1A-R1C1"
  frame_code: string     // "1A"
  row_label: string      // 'A' | 'B'
  col_number: number     // frame number (1-21)
  frame_row: number      // row in frame (1=front, Nmax=back)
  frame_col: number      // col in frame (1=left, 2=right)
  is_restricted: boolean
  max_stack: number
  is_active: boolean
  sort_order: number
}

export type WarehousePlacement = {
  id: string
  factory_id: string
  warehouse_code: WarehouseCode
  slot_code: string
  stack_level: number      // 1 = tầng dưới cùng
  lot_id: string
  kien_label: KienLabel    // 'A' | 'B' | 'C' | 'D'
  placed_at: string
  placed_by: string | null
  removed_at: string | null
  removed_by: string | null
  export_order_id: string | null
  // join
  lots?: LotInfo | null
}

export type LotInfo = {
  id: string
  ma_lo: string
  loai_csr: string
  loai_banh: number
  boc: string
  pallet: string[]
  kien_a: number
  kien_b: number
  kien_c: number
  kien_d: number
  tong_banh: number
  tong_kg: number
  trang_thai: string
  ngay_sx: string
  ngay_ht: string | null
  day_chuyen: string
  suffix: string
  ghi_chu?: string | null
}

export type KienLabel = "A" | "B" | "C" | "D"

export type DragKienData = {
  lotId: string
  maLo: string
  kienLabel: KienLabel
  kienBanh: number
  loaiCsr: string
  dayChuyen: string
  placementId?: string  // set khi drag từ sơ đồ → drag-back về panel
}

// Kéo cả lô — 4 kiện tự phân bổ
export type DragLotData = {
  lotId: string
  maLo: string
  loaiCsr: string
  dayChuyen: string
  kienLabels: KienLabel[]   // kiện nào còn trong lô (kien_X > 0)
  kiensData: { label: KienLabel; banh: number }[]
}

// Khung (frame) config — dùng để render sơ đồ
export type FrameConfig = {
  code: string          // "1A"
  rowLabel: "A" | "B"
  frameNum: number      // 1–21
  numCols: 1 | 2        // 2 = khung lớn, 1 = khung nhỏ
  numRows: number       // 6 (KHO1) | 8 (KHO2)
  isRestricted: boolean
  aisleAfterThis?: boolean  // true = thêm lối đi nhỏ sau khung này
}

// Kết quả phân bổ tự động (sap_kien)
export type PlacementTarget = {
  slotCode: string
  kienLabel: KienLabel
  stackLevel: number
}

// ────────────────────────────────────────────────────────────
// Layout configs (frame definitions)
// ────────────────────────────────────────────────────────────

export const KHO1_FRAMES: FrameConfig[] = [
  // Row A — khối trái (1A-12A)
  ...[1,2,3,4,5,6,7,8,9,10].map(n => ({
    code: `${n}A`, rowLabel: "A" as const, frameNum: n,
    numCols: 2 as const, numRows: 6, isRestricted: false,
  })),
  { code: "11A", rowLabel: "A", frameNum: 11, numCols: 1, numRows: 6, isRestricted: false },
  { code: "12A", rowLabel: "A", frameNum: 12, numCols: 1, numRows: 6, isRestricted: false, aisleAfterThis: true },
  // Row A — khối phải (13A-15A)
  { code: "13A", rowLabel: "A", frameNum: 13, numCols: 1, numRows: 6, isRestricted: false },
  { code: "14A", rowLabel: "A", frameNum: 14, numCols: 2, numRows: 6, isRestricted: false },
  { code: "15A", rowLabel: "A", frameNum: 15, numCols: 2, numRows: 6, isRestricted: false },

  // Row B — khối trái (1B-12B)
  ...[1,2,3,4,5,6,7,8,9,10].map(n => ({
    code: `${n}B`, rowLabel: "B" as const, frameNum: n,
    numCols: 2 as const, numRows: 6, isRestricted: false,
  })),
  { code: "11B", rowLabel: "B", frameNum: 11, numCols: 1, numRows: 6, isRestricted: false },
  { code: "12B", rowLabel: "B", frameNum: 12, numCols: 1, numRows: 6, isRestricted: false, aisleAfterThis: true },
  // Row B — khối phải (13B-16B, restricted)
  { code: "13B", rowLabel: "B", frameNum: 13, numCols: 2, numRows: 6, isRestricted: true },
  { code: "14B", rowLabel: "B", frameNum: 14, numCols: 1, numRows: 6, isRestricted: true },
  { code: "15B", rowLabel: "B", frameNum: 15, numCols: 2, numRows: 6, isRestricted: true },
  { code: "16B", rowLabel: "B", frameNum: 16, numCols: 2, numRows: 6, isRestricted: true },
]

export const KHO2_FRAMES: FrameConfig[] = [
  // Row A — khối chính (1A-14A)
  ...[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(n => ({
    code: `${n}A`, rowLabel: "A" as const, frameNum: n,
    numCols: 2 as const, numRows: 8, isRestricted: false,
  })),
  // Row A — restricted nhỏ (15A-16A) → aisleAfterThis trước 17A
  { code: "15A", rowLabel: "A", frameNum: 15, numCols: 1, numRows: 8, isRestricted: true },
  { code: "16A", rowLabel: "A", frameNum: 16, numCols: 1, numRows: 8, isRestricted: true, aisleAfterThis: true },
  // Row A — khối phải (17A-21A)
  ...[17,18,19,20,21].map(n => ({
    code: `${n}A`, rowLabel: "A" as const, frameNum: n,
    numCols: 2 as const, numRows: 8, isRestricted: false,
  })),

  // Row B — khối trái (1B-6B)
  ...[1,2,3,4,5,6].map(n => ({
    code: `${n}B`, rowLabel: "B" as const, frameNum: n,
    numCols: 2 as const, numRows: 8, isRestricted: false,
  })),
  // Row B — khung nhỏ 7B, aisleAfterThis
  { code: "7B", rowLabel: "B", frameNum: 7, numCols: 1, numRows: 8, isRestricted: false, aisleAfterThis: true },
  // Row B — khối phải (8B-15B)
  ...[8,9,10,11,12].map(n => ({
    code: `${n}B`, rowLabel: "B" as const, frameNum: n,
    numCols: 2 as const, numRows: 8, isRestricted: false,
  })),
  { code: "13B", rowLabel: "B", frameNum: 13, numCols: 2, numRows: 8, isRestricted: true },
  { code: "14B", rowLabel: "B", frameNum: 14, numCols: 2, numRows: 8, isRestricted: false },
  { code: "15B", rowLabel: "B", frameNum: 15, numCols: 2, numRows: 8, isRestricted: false },
]

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

export const WAREHOUSE_LABELS: Record<WarehouseCode, string> = {
  kho1: "KHO 1 — Mủ tạp",
  kho2: "KHO 2 — Mủ nước",
}

// Lấy frame code từ slot_code
export function getFrameFromSlotCode(slotCode: string): string {
  const idx = slotCode.indexOf("-R")
  return idx !== -1 ? slotCode.substring(0, idx) : slotCode
}

// Màu theo loại CSR
export function getCsrColor(loaiCsr: string): {
  bg: string; text: string; border: string; dot: string; bgDark: string
} {
  const v = (loaiCsr || "").toLowerCase()
  if (v.includes("10")) return { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-300", dot: "bg-emerald-500", bgDark: "bg-emerald-400" }
  if (v.includes("20")) return { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", dot: "bg-blue-500", bgDark: "bg-blue-400" }
  if (v === "csrl" || v === "svrl") return { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-300", dot: "bg-purple-500", bgDark: "bg-purple-400" }
  if (v.includes("cv50") || v.includes("cv60")) return { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-300", dot: "bg-orange-500", bgDark: "bg-orange-400" }
  if (v.includes("3l")) return { bg: "bg-teal-100", text: "text-teal-800", border: "border-teal-300", dot: "bg-teal-500", bgDark: "bg-teal-400" }
  return { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300", dot: "bg-slate-400", bgDark: "bg-slate-400" }
}

// Số bành tối đa theo loại bành
export function getMaxBanh(loaiBanh: number): number {
  if (loaiBanh === 20) return 60
  return 36  // 35 hoặc 33.33
}

// Kiện có đầy không
export function isKienFull(banh: number, loaiBanh: number): boolean {
  return banh >= getMaxBanh(loaiBanh)
}

// Lấy số bành của kiện theo label
export function getKienBanh(lot: LotInfo, kien: KienLabel): number {
  const map: Record<KienLabel, number> = {
    A: lot.kien_a, B: lot.kien_b, C: lot.kien_c, D: lot.kien_d,
  }
  return map[kien]
}

// Tìm tầng thấp nhất còn trống trong slot
export function findNextStackLevel(
  placements: WarehousePlacement[],
  maxStack: number
): number | null {
  const used = new Set(placements.filter(p => !p.removed_at).map(p => p.stack_level))
  for (let i = 1; i <= maxStack; i++) {
    if (!used.has(i)) return i
  }
  return null
}

// Kho phù hợp với dây chuyền
export function getRecommendedWarehouse(dayChuyen: string): WarehouseCode | null {
  if (dayChuyen.toLowerCase().includes("tạp")) return "kho1"
  if (dayChuyen.toLowerCase().includes("nước")) return "kho2"
  return null
}

// Phân bổ kiện vào khung theo quy tắc sap_kien
// Trả về danh sách PlacementTarget, hoặc null nếu không đủ chỗ
export function distributeKienToFrame(
  frameCode: string,
  frameConfig: FrameConfig,
  frameSlots: WarehouseSlot[],
  activePlacements: WarehousePlacement[],
  kienLabels: KienLabel[]
): PlacementTarget[] | null {
  if (kienLabels.length === 0) return []
  const maxStack = 3

  // Index placements theo slot_code
  const placementsBySlot = new Map<string, WarehousePlacement[]>()
  for (const p of activePlacements) {
    if (!placementsBySlot.has(p.slot_code)) placementsBySlot.set(p.slot_code, [])
    placementsBySlot.get(p.slot_code)!.push(p)
  }

  // Tìm stack level tiếp theo cho một slot
  const getNextLevel = (slotCode: string): number | null => {
    const existing = placementsBySlot.get(slotCode) || []
    const used = new Set(existing.map(p => p.stack_level))
    for (let i = 1; i <= maxStack; i++) {
      if (!used.has(i)) return i
    }
    return null
  }

  const assignment: PlacementTarget[] = []

  if (frameConfig.numCols === 2) {
    // Khung lớn: A→front-left(C1), B→front-right(C2)
    //            D→back-left(C1),  C→back-right(C2)
    // Nhóm AB dùng 1 hàng, nhóm DC dùng hàng KHÁC
    const needA = kienLabels.includes("A")
    const needB = kienLabels.includes("B")
    const needD = kienLabels.includes("D")
    const needC = kienLabels.includes("C")

    const usedRows = new Set<number>()

    // Tìm hàng cho nhóm AB
    if (needA || needB) {
      for (let row = 1; row <= frameConfig.numRows; row++) {
        const sc1 = `${frameCode}-R${row}C1`
        const sc2 = `${frameCode}-R${row}C2`
        const lvl1 = getNextLevel(sc1)
        const lvl2 = getNextLevel(sc2)
        const okA = !needA || lvl1 !== null
        const okB = !needB || lvl2 !== null
        if (okA && okB) {
          if (needA) assignment.push({ slotCode: sc1, kienLabel: "A", stackLevel: lvl1! })
          if (needB) assignment.push({ slotCode: sc2, kienLabel: "B", stackLevel: lvl2! })
          usedRows.add(row)
          break
        }
      }
      if ((needA || needB) && usedRows.size === 0) return null
    }

    // Tìm hàng KHÁC cho nhóm DC
    if (needD || needC) {
      let placed = false
      for (let row = 1; row <= frameConfig.numRows; row++) {
        if (usedRows.has(row)) continue
        const sc1 = `${frameCode}-R${row}C1`
        const sc2 = `${frameCode}-R${row}C2`
        const lvl1 = getNextLevel(sc1)
        const lvl2 = getNextLevel(sc2)
        const okD = !needD || lvl1 !== null
        const okC = !needC || lvl2 !== null
        if (okD && okC) {
          if (needD) assignment.push({ slotCode: sc1, kienLabel: "D", stackLevel: lvl1! })
          if (needC) assignment.push({ slotCode: sc2, kienLabel: "C", stackLevel: lvl2! })
          placed = true
          break
        }
      }
      if ((needD || needC) && !placed) return null
    }
  } else {
    // Khung nhỏ (1 cột): A→R1, B→R2, C→R3, D→R4 (từ phía trước)
    const kOrder: KienLabel[] = ["A", "B", "C", "D"]
    const kQueue = kOrder.filter(k => kienLabels.includes(k))
    let qi = 0
    for (let row = 1; row <= frameConfig.numRows && qi < kQueue.length; row++) {
      const sc = `${frameCode}-R${row}C1`
      const lvl = getNextLevel(sc)
      if (lvl !== null) {
        assignment.push({ slotCode: sc, kienLabel: kQueue[qi], stackLevel: lvl })
        qi++
      }
    }
    if (assignment.length < kienLabels.length) return null
  }

  return assignment.length === kienLabels.length ? assignment : null
}

// Filter state cho filter bar
export type FilterState = {
  csrTypes: string[]
  banhValues: string[]   // "35", "33.33", "20"
  bocValues: string[]
  maLo: string
  ghiChu: string
  ngayFrom: string
  ngayTo: string
}

export const EMPTY_FILTER: FilterState = {
  csrTypes: [], banhValues: [], bocValues: [],
  maLo: "", ghiChu: "", ngayFrom: "", ngayTo: "",
}

export function isFilterActive(f: FilterState): boolean {
  return (
    f.csrTypes.length > 0 || f.banhValues.length > 0 || f.bocValues.length > 0 ||
    !!f.maLo || !!f.ghiChu || !!f.ngayFrom || !!f.ngayTo
  )
}

export function isLotMatching(lot: LotInfo, filter: FilterState): boolean {
  if (!isFilterActive(filter)) return true
  if (filter.csrTypes.length > 0 && !filter.csrTypes.includes(lot.loai_csr)) return false
  if (filter.banhValues.length > 0 && !filter.banhValues.includes(String(lot.loai_banh))) return false
  if (filter.bocValues.length > 0 && !filter.bocValues.includes(lot.boc)) return false
  if (filter.maLo && !lot.ma_lo.toLowerCase().includes(filter.maLo.toLowerCase())) return false
  if (filter.ghiChu && !(lot.ghi_chu || "").toLowerCase().includes(filter.ghiChu.toLowerCase())) return false
  const ngay = lot.ngay_ht || lot.ngay_sx
  if (filter.ngayFrom && ngay < filter.ngayFrom) return false
  if (filter.ngayTo && ngay > filter.ngayTo) return false
  return true
}
