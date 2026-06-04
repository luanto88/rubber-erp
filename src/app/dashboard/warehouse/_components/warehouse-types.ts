// Types và helpers cho module Quản lý kho thành phẩm

export type WarehouseCode = "kho1" | "kho2"

export type WarehouseSlot = {
  id: string
  factory_id: string
  warehouse_code: WarehouseCode
  slot_code: string        // '1A', '2A', '13B'
  row_label: string        // 'A' | 'B'
  col_number: number
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
}

export type KienLabel = "A" | "B" | "C" | "D"

export type DragKienData = {
  lotId: string
  maLo: string
  kienLabel: KienLabel
  kienBanh: number
  loaiCsr: string
  dayChuyen: string
}

// Thông tin 1 slot đã được merge với placements
export type SlotWithPlacements = WarehouseSlot & {
  placements: WarehousePlacement[]  // chỉ active (removed_at IS NULL)
  exportedPlacements: WarehousePlacement[]  // đã xuất (removed_at IS NOT NULL, hiện mờ)
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

export const WAREHOUSE_LABELS: Record<WarehouseCode, string> = {
  kho1: "KHO 1 — Mủ tạp",
  kho2: "KHO 2 — Mủ nước",
}

// Màu theo loại CSR
export function getCsrColor(loaiCsr: string): {
  bg: string
  text: string
  border: string
  dot: string
} {
  const v = loaiCsr.toLowerCase()
  if (v.includes("10")) return { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-300", dot: "bg-emerald-500" }
  if (v.includes("20")) return { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", dot: "bg-blue-500" }
  if (v === "csrl" || v === "svrl") return { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-300", dot: "bg-purple-500" }
  if (v.includes("cv50") || v.includes("cv60")) return { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-300", dot: "bg-orange-500" }
  if (v.includes("3l")) return { bg: "bg-teal-100", text: "text-teal-800", border: "border-teal-300", dot: "bg-teal-500" }
  return { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300", dot: "bg-slate-400" }
}

// Số bành tối đa theo loại bánh
export function getMaxBanh(loaiBanh: number): number {
  if (loaiBanh === 20) return 60
  return 36  // 35 hoặc 33.33
}

// Lô tròn: tong_banh đạt đủ 4 kiện đầy
export function isLotFull(lot: LotInfo): boolean {
  const maxPerKien = getMaxBanh(lot.loai_banh)
  return (
    lot.kien_a >= maxPerKien &&
    lot.kien_b >= maxPerKien &&
    lot.kien_c >= maxPerKien &&
    lot.kien_d >= maxPerKien
  )
}

// Kiện có đầy không
export function isKienFull(banh: number, loaiBanh: number): boolean {
  return banh >= getMaxBanh(loaiBanh)
}

// Lấy số bành của kiện theo label
export function getKienBanh(lot: LotInfo, kien: KienLabel): number {
  const map: Record<KienLabel, number> = {
    A: lot.kien_a,
    B: lot.kien_b,
    C: lot.kien_c,
    D: lot.kien_d,
  }
  return map[kien]
}

// Tìm tầng thấp nhất còn trống
export function findNextStackLevel(
  placements: WarehousePlacement[],
  maxStack: number
): number | null {
  const used = new Set(placements.filter(p => !p.removed_at).map(p => p.stack_level))
  for (let i = 1; i <= maxStack; i++) {
    if (!used.has(i)) return i
  }
  return null  // đầy
}

// Kho phù hợp với dây chuyền
export function getRecommendedWarehouse(dayChuyen: string): WarehouseCode | null {
  if (dayChuyen.toLowerCase().includes("tạp")) return "kho1"
  if (dayChuyen.toLowerCase().includes("nước")) return "kho2"
  return null
}

// Layout sơ đồ kho
export type SlotLayoutSection = {
  label?: string  // 'Lối đi', 'Cửa', hoặc undefined (slot)
  isGap?: boolean
  slots?: string[]  // slot codes
  restricted?: boolean[]  // per slot
}

export const KHO1_LAYOUT: {
  rowA: Array<{ code: string; restricted: boolean; gap?: boolean }>
  rowB: Array<{ code: string; restricted: boolean; gap?: boolean }>
} = {
  rowA: [
    ...[1,2,3,4,5,6,7,8,9,10,11,12].map(n => ({ code: `${n}A`, restricted: false })),
    { code: "gap", restricted: false, gap: true },
    ...[13,14,15].map(n => ({ code: `${n}A`, restricted: false })),
  ],
  rowB: [
    ...[1,2,3,4,5,6,7,8,9,10,11,12].map(n => ({ code: `${n}B`, restricted: false })),
    ...[13,14,15,16].map(n => ({ code: `${n}B`, restricted: true })),
  ],
}

export const KHO2_LAYOUT: {
  rowA: Array<{ code: string; restricted: boolean; gap?: boolean }>
  rowB: Array<{ code: string; restricted: boolean; gap?: boolean }>
} = {
  rowA: [
    ...[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(n => ({ code: `${n}A`, restricted: false })),
    { code: "15A", restricted: true },
    { code: "16A", restricted: true },
    { code: "gap", restricted: false, gap: true },
    ...[17,18,19,20,21].map(n => ({ code: `${n}A`, restricted: false })),
  ],
  rowB: [
    ...[1,2,3,4,5,6,7].map(n => ({ code: `${n}B`, restricted: false })),
    { code: "gap", restricted: false, gap: true },
    ...[8,9,10,11,12].map(n => ({ code: `${n}B`, restricted: false })),
    { code: "13B", restricted: true },
    ...[14,15].map(n => ({ code: `${n}B`, restricted: false })),
  ],
}
