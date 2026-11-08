// Quy cách chủng loại thành phẩm theo nhà máy (bảng product_grade_types, migration 20261116) — GĐ2:
// Chủng loại × Loại bành → bành/kiện, lô tròn (= 4 × bành/kiện). THUẦN (client + server), không import supabase.
//
// Bảng chưa có / lỗi / rỗng ⇒ `fromDb = false` ⇒ mọi hàm dùng QUY TẮC CŨ (legacy*) — khớp 100% hành vi trước.
// Có bảng: tra dòng đúng (chủng loại, loại bành) KỂ CẢ dòng đã tắt (lô cũ vẫn đúng) → dòng mặc định của chủng
// loại → quy tắc cũ (chủng loại lạ / "Ngoại lệ"). Phải khớp hàm SQL product_grade_lo_tron().

import type { SupabaseClient } from "@supabase/supabase-js"

export type CsrPrefix = "CSR" | "SVR"

export const DAY_CHUYEN_MU_TAP = "Mủ tạp"
export const DAY_CHUYEN_MU_NUOC = "Mủ nước"
export const GRADE_DAY_CHUYEN = [DAY_CHUYEN_MU_TAP, DAY_CHUYEN_MU_NUOC] as const
export const NGOAI_LE_CSR = "Ngoại lệ"
export const KIEN_PER_LOT = 4

export type LoaiBanhConfig = {
  loai_banh: number
  max_per_kien: number
  lo_tron: number
}

export type GradeRow = {
  id: string
  day_chuyen: string
  loai_csr: string
  loai_banh: number
  max_per_kien: number
  is_default: boolean
  sort_order: number
  is_active: boolean
}

export type GradeConfig = {
  rows: GradeRow[]
  /** true = đọc từ bảng; false = quy tắc cũ. */
  fromDb: boolean
  /** Tiền tố chủng loại của nhà máy (factories.prefix). */
  prefix: CsrPrefix
}

export const GRADE_SELECT = "id, day_chuyen, loai_csr, loai_banh, max_per_kien, is_default, sort_order, is_active"

export const normCsr = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, "").toUpperCase()
export const roundBanh = (n: number) => Math.round(Number(n) * 100) / 100

/** factories.prefix → CSR/SVR; thiếu thì suy từ tên (dữ liệu cũ: "cuaparis" = SVR). */
export function resolveFactoryPrefix(prefix: string | null | undefined, name?: string | null): CsrPrefix {
  const p = normCsr(prefix)
  if (p === "SVR" || p === "CSR") return p
  return String(name || "").toLowerCase().includes("cuaparis") ? "SVR" : "CSR"
}

// ── Quy tắc cũ (giữ nguyên từng dòng của product-lot-config.ts / product/page.tsx trước GĐ2) ──
const CV = ["CSRCV50", "CSRCV60", "SVRCV50", "SVRCV60"]
const LL = ["CSRL", "CSR3L", "SVRL", "SVR3L"]

export function legacyLoaiBanhConfig(loai_csr: string, selected_banh?: number): LoaiBanhConfig {
  if (CV.includes(loai_csr)) {
    const b = selected_banh || 35
    return b === 20 ? { loai_banh: 20, max_per_kien: 60, lo_tron: 240 } : { loai_banh: 35, max_per_kien: 36, lo_tron: 144 }
  }
  if (LL.includes(loai_csr)) {
    const b = selected_banh || 33.33
    return { loai_banh: b, max_per_kien: 36, lo_tron: 144 }
  }
  return { loai_banh: 35, max_per_kien: 36, lo_tron: 144 }
}

export function legacyLoaiBanhOptions(loai_csr: string): number[] {
  if (CV.includes(loai_csr)) return [35, 20]
  if (LL.includes(loai_csr)) return [35, 33.33]
  return [35]
}

export function legacyLoaiCSRByDayChuyen(dc: string, prefix: CsrPrefix): string[] {
  if (dc === DAY_CHUYEN_MU_NUOC) return [`${prefix}L`, `${prefix}3L`, `${prefix}CV50`, `${prefix}CV60`, NGOAI_LE_CSR]
  return [`${prefix}10`, `${prefix}20`, NGOAI_LE_CSR]
}

// ── Cấu hình ──
export function defaultGradeConfig(prefix: CsrPrefix = "CSR"): GradeConfig {
  return { rows: [], fromDb: false, prefix }
}

export function parseGradeRows(rows: unknown[] | null | undefined): GradeRow[] {
  const out: GradeRow[] = []
  for (const raw of rows || []) {
    const r = raw as Record<string, unknown>
    const loai_csr = normCsr(String(r.loai_csr || ""))
    const loai_banh = roundBanh(Number(r.loai_banh))
    const max_per_kien = Math.round(Number(r.max_per_kien))
    const day_chuyen = String(r.day_chuyen || "")
    if (!loai_csr || !(loai_banh > 0) || !(max_per_kien > 0)) continue
    out.push({
      id: String(r.id || `${loai_csr}-${loai_banh}`),
      day_chuyen,
      loai_csr,
      loai_banh,
      max_per_kien,
      is_default: r.is_default === true,
      sort_order: Number(r.sort_order) || 0,
      is_active: r.is_active !== false,
    })
  }
  return out
}

export function buildGradeConfig(rows: unknown[] | null | undefined, hasError: boolean, prefix: CsrPrefix): GradeConfig {
  if (hasError) return defaultGradeConfig(prefix)
  const parsed = parseGradeRows(rows)
  if (parsed.length === 0) return defaultGradeConfig(prefix)
  return { rows: parsed, fromDb: true, prefix }
}

/** Gói offline / dữ liệu chưa rõ ⇒ config dùng được. */
export function ensureGradeConfig(cfg: GradeConfig | null | undefined, prefix: CsrPrefix = "CSR"): GradeConfig {
  return cfg && Array.isArray(cfg.rows) && (cfg.prefix === "CSR" || cfg.prefix === "SVR") ? cfg : defaultGradeConfig(prefix)
}

const sortRows = (rows: GradeRow[]) =>
  [...rows].sort((a, b) => a.sort_order - b.sort_order || b.loai_banh - a.loai_banh)

function rowsOfCsr(cfg: GradeConfig, csr: string): GradeRow[] {
  const k = normCsr(csr)
  return sortRows(cfg.rows.filter((r) => r.loai_csr === k))
}

const toConfig = (r: GradeRow): LoaiBanhConfig => ({
  loai_banh: r.loai_banh,
  max_per_kien: r.max_per_kien,
  lo_tron: KIEN_PER_LOT * r.max_per_kien,
})

/** Dòng mặc định của 1 chủng loại: is_default (đang dùng trước) → dòng đang dùng đầu tiên → dòng đầu tiên. */
function defaultRow(rows: GradeRow[]): GradeRow | undefined {
  return (
    rows.find((r) => r.is_default && r.is_active) ||
    rows.find((r) => r.is_default) ||
    rows.find((r) => r.is_active) ||
    rows[0]
  )
}

/** Bành/kiện + lô tròn của (chủng loại, loại bành). */
export function gradeLoaiBanhConfig(cfg: GradeConfig | null | undefined, loai_csr: string, selected_banh?: number): LoaiBanhConfig {
  if (!cfg || !cfg.fromDb) return legacyLoaiBanhConfig(loai_csr, selected_banh)
  const rows = rowsOfCsr(cfg, loai_csr)
  if (rows.length === 0) return legacyLoaiBanhConfig(loai_csr, selected_banh)
  if (selected_banh) {
    const hit = rows.find((r) => r.loai_banh === roundBanh(selected_banh))
    if (hit) return toConfig(hit)
  }
  return toConfig(defaultRow(rows)!)
}

/**
 * Loại bành chọn được cho 1 chủng loại (dòng đang dùng), mặc định đứng đầu.
 * `current` (giá trị đang lưu trên lô/phiếu) luôn được giữ trong danh sách.
 */
export function gradeLoaiBanhOptions(cfg: GradeConfig | null | undefined, loai_csr: string, current?: number | null): number[] {
  let list: number[]
  if (!cfg || !cfg.fromDb) list = legacyLoaiBanhOptions(loai_csr)
  else {
    const rows = rowsOfCsr(cfg, loai_csr).filter((r) => r.is_active)
    if (rows.length === 0 && rowsOfCsr(cfg, loai_csr).length === 0) list = legacyLoaiBanhOptions(loai_csr)
    else {
      const def = rows.find((r) => r.is_default)
      list = [...(def ? [def] : []), ...rows.filter((r) => r !== def)].map((r) => r.loai_banh)
    }
  }
  const cur = Number(current)
  if (cur > 0 && !list.some((b) => roundBanh(b) === roundBanh(cur))) list = [...list, roundBanh(cur)]
  return list
}

/** Chủng loại của 1 dây chuyền (dòng đang dùng, theo thứ tự), luôn kèm "Ngoại lệ" cuối. */
export function gradeLoaiCSRByDayChuyen(cfg: GradeConfig | null | undefined, dc: string, prefix?: CsrPrefix): string[] {
  const p = prefix || cfg?.prefix || "CSR"
  if (!cfg || !cfg.fromDb) return legacyLoaiCSRByDayChuyen(dc, p)
  const out: string[] = []
  for (const r of sortRows(cfg.rows.filter((x) => x.is_active && x.day_chuyen === dc))) {
    if (!out.includes(r.loai_csr)) out.push(r.loai_csr)
  }
  return [...out, NGOAI_LE_CSR]
}

/** Mọi chủng loại đang dùng (cả 2 dây chuyền), không kèm "Ngoại lệ" — vd danh sách CSR của Xuất hàng. */
export function gradeAllCsr(cfg: GradeConfig | null | undefined, prefix?: CsrPrefix): string[] {
  return GRADE_DAY_CHUYEN.flatMap((dc) => gradeLoaiCSRByDayChuyen(cfg, dc, prefix)).filter((c) => c !== NGOAI_LE_CSR)
}

/** Dây chuyền của chủng loại theo cấu hình; không có ⇒ null (người gọi tự suy theo hậu tố). */
export function gradeDayChuyenOf(cfg: GradeConfig | null | undefined, loai_csr: string): string | null {
  if (!cfg || !cfg.fromDb) return null
  return rowsOfCsr(cfg, loai_csr)[0]?.day_chuyen || null
}

/** Nạp cấu hình bằng client Supabase truyền vào (browser hoặc service role). Lỗi ⇒ quy tắc cũ. */
export async function loadGradeConfigWith(client: SupabaseClient, factoryId: string | null | undefined): Promise<GradeConfig> {
  if (!factoryId) return defaultGradeConfig()
  let prefix: CsrPrefix = "CSR"
  try {
    const { data: f } = await client.from("factories").select("name, prefix").eq("id", factoryId).maybeSingle()
    prefix = resolveFactoryPrefix(f?.prefix, f?.name)
    const { data, error } = await client
      .from("product_grade_types")
      .select(GRADE_SELECT)
      .eq("factory_id", factoryId)
      .order("sort_order")
    if (error) console.warn("[grade] dùng quy tắc mặc định:", error.message)
    return buildGradeConfig(data, !!error, prefix)
  } catch (e) {
    console.warn("[grade] dùng quy tắc mặc định:", e)
    return defaultGradeConfig(prefix)
  }
}
