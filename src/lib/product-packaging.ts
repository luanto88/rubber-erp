// Quy cách đóng gói thành phẩm theo nhà máy (bảng product_packaging_types, migration 20261108) — GĐ1:
// Bọc / Pallet sản xuất / Thảm. THUẦN (client + server), không import supabase.
//
// Bảng chỉ quyết định LỰA CHỌN cho phiếu MỚI; chuỗi đã lưu trên lô cũ giữ nguyên (mergeWithLegacy).
// Bảng chưa có / lỗi / rỗng ⇒ DEFAULT_PACKAGING = đúng danh sách hard-code trước đây.

import { palletComponents, type PalletComponent } from "@/lib/pallet-usage"
import { isPalletComponentCode } from "@/lib/pallet-components"

export type PackagingKind = "boc" | "pallet_sx" | "tham"

export const PACKAGING_KIND_LABEL: Record<PackagingKind, string> = {
  boc: "Loại bọc",
  pallet_sx: "Pallet sản xuất",
  tham: "Loại thảm",
}

export type PackagingType = {
  id: string
  kind: PackagingKind
  /** Có thể chứa token {CSR}. */
  ten: string
  /** Rỗng = mọi dây chuyền. */
  day_chuyen: string[]
  /** Rỗng = mọi chủng loại. */
  loai_csr: string[]
  inventory_item_ids: string[]
  /** Chỉ pallet_sx: mã thành phần pallet (bảng pallet_components). */
  thanh_phan: string[]
  is_default: boolean
  sort_order: number
  is_active: boolean
}

export type PackagingConfig = {
  items: PackagingType[]
  /** true = đọc từ bảng; false = dùng danh sách mặc định. */
  fromDb: boolean
}

export const PACKAGING_CSR_TOKEN = "{CSR}"
export const PACKAGING_SELECT =
  "id, kind, ten, day_chuyen, loai_csr, inventory_item_ids, thanh_phan, is_default, sort_order, is_active"

type Seed = Omit<PackagingType, "id" | "loai_csr" | "inventory_item_ids">

// PHẢI khớp phần seed của supabase/migrations/20261108_product_packaging_types.sql.
const SEED: Seed[] = [
  { kind: "boc", ten: "Bọc trơn 0,04", day_chuyen: [], thanh_phan: [], is_default: false, sort_order: 10, is_active: true },
  { kind: "boc", ten: "Bọc nhãn 0,04 VRG {CSR}", day_chuyen: [], thanh_phan: [], is_default: true, sort_order: 20, is_active: true },
  { kind: "boc", ten: "Bọc trơn 0,13", day_chuyen: ["Mủ nước"], thanh_phan: [], is_default: false, sort_order: 30, is_active: true },
  { kind: "boc", ten: "Bọc nhãn 0,13 VRG {CSR}", day_chuyen: ["Mủ nước"], thanh_phan: [], is_default: false, sort_order: 40, is_active: true },
  { kind: "pallet_sx", ten: "Sắt đế gỗ", day_chuyen: [], thanh_phan: ["sat_day", "de_go"], is_default: true, sort_order: 10, is_active: true },
  { kind: "pallet_sx", ten: "Sắt đế nhựa", day_chuyen: [], thanh_phan: ["sat_day", "de_nhua"], is_default: false, sort_order: 20, is_active: true },
  { kind: "pallet_sx", ten: "Sắt mỏng", day_chuyen: [], thanh_phan: ["sat_mong"], is_default: false, sort_order: 30, is_active: true },
  { kind: "pallet_sx", ten: "MB5", day_chuyen: [], thanh_phan: ["mb5"], is_default: false, sort_order: 40, is_active: true },
  { kind: "pallet_sx", ten: "Gỗ", day_chuyen: [], thanh_phan: ["pallet_go"], is_default: false, sort_order: 50, is_active: true },
  { kind: "pallet_sx", ten: "MB4", day_chuyen: [], thanh_phan: ["mb4"], is_default: false, sort_order: 60, is_active: false },
  { kind: "tham", ten: "Cũ", day_chuyen: [], thanh_phan: [], is_default: true, sort_order: 10, is_active: true },
  { kind: "tham", ten: "Mới", day_chuyen: [], thanh_phan: [], is_default: false, sort_order: 20, is_active: true },
]

export const DEFAULT_PACKAGING: PackagingConfig = {
  items: SEED.map((s, i) => ({ ...s, id: `default-${i}`, loai_csr: [], inventory_item_ids: [] })),
  fromDb: false,
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []

/** Chuẩn hoá dòng DB → PackagingType (bỏ dòng hỏng). */
export function parsePackagingRows(rows: unknown[] | null | undefined): PackagingType[] {
  const out: PackagingType[] = []
  for (const raw of rows || []) {
    const r = raw as Record<string, unknown>
    const kind = String(r.kind || "") as PackagingKind
    const ten = String(r.ten || "").normalize("NFC").trim()
    if (!ten || !(kind === "boc" || kind === "pallet_sx" || kind === "tham")) continue
    out.push({
      id: String(r.id || ten),
      kind,
      ten,
      day_chuyen: asStrings(r.day_chuyen),
      loai_csr: asStrings(r.loai_csr).map((c) => c.replace(/\s+/g, "").toUpperCase()),
      inventory_item_ids: asStrings(r.inventory_item_ids),
      thanh_phan: asStrings(r.thanh_phan).filter(isPalletComponentCode),
      is_default: r.is_default === true,
      sort_order: Number(r.sort_order) || 0,
      is_active: r.is_active !== false,
    })
  }
  return out
}

/**
 * Dựng config từ kết quả query. Lỗi / bảng rỗng ⇒ DEFAULT. Nhà máy đã cấu hình nhưng thiếu hẳn 1 loại
 * (vd xoá hết thảm) ⇒ bổ sung loại đó từ DEFAULT để dropdown không trống.
 */
export function buildPackagingConfig(rows: unknown[] | null | undefined, hasError: boolean): PackagingConfig {
  if (hasError) return DEFAULT_PACKAGING
  const items = parsePackagingRows(rows)
  if (items.length === 0) return DEFAULT_PACKAGING
  const kinds = new Set(items.map((i) => i.kind))
  const filled = [...items]
  for (const d of DEFAULT_PACKAGING.items) if (!kinds.has(d.kind)) filled.push(d)
  return { items: filled, fromDb: true }
}

/** Gói offline / dữ liệu chưa rõ ⇒ config dùng được (thiếu ⇒ DEFAULT). */
export function ensurePackagingConfig(cfg: PackagingConfig | null | undefined): PackagingConfig {
  return cfg && Array.isArray(cfg.items) && cfg.items.length > 0 ? cfg : DEFAULT_PACKAGING
}

const normCsr = (s: string) => s.replace(/\s+/g, "").toUpperCase()
const normKey = (s: string) => s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ")

export function applyCsrToken(ten: string, csr: string): string {
  return ten.split(PACKAGING_CSR_TOKEN).join(csr || "").replace(/\s+/g, " ").trim()
}

function matches(item: PackagingType, dc: string | null | undefined, csr: string | null | undefined): boolean {
  if (!item.is_active) return false
  // Không rõ dây chuyền ⇒ chỉ lấy mục áp cho mọi dây chuyền (giống getBocsForLoaiCSR cũ).
  if (item.day_chuyen.length > 0 && !item.day_chuyen.includes(dc || "")) return false
  if (item.loai_csr.length > 0) {
    if (!csr) return false
    if (!item.loai_csr.includes(normCsr(csr))) return false
  }
  return true
}

function sorted(items: PackagingType[]): PackagingType[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order || a.ten.localeCompare(b.ten, "vi"))
}

function resolve(cfg: PackagingConfig | null | undefined, kind: PackagingKind, dc?: string | null, csr?: string | null) {
  const c = ensurePackagingConfig(cfg)
  const out: { ten: string; isDefault: boolean }[] = []
  const seen = new Set<string>()
  for (const it of sorted(c.items.filter((i) => i.kind === kind && matches(i, dc, csr)))) {
    const ten = applyCsrToken(it.ten, csr || "")
    const key = normKey(ten)
    if (!ten || seen.has(key)) continue
    seen.add(key)
    out.push({ ten, isDefault: it.is_default })
  }
  return out
}

/** Danh sách bọc cho (dây chuyền, chủng loại). */
export function resolveBocOptions(cfg: PackagingConfig | null | undefined, dc: string | null | undefined, csr: string | null | undefined): string[] {
  return resolve(cfg, "boc", dc, csr).map((x) => x.ten)
}

export function resolvePalletOptions(cfg: PackagingConfig | null | undefined, dc?: string | null, csr?: string | null): string[] {
  return resolve(cfg, "pallet_sx", dc, csr).map((x) => x.ten)
}

export function resolveThamOptions(cfg: PackagingConfig | null | undefined, dc?: string | null, csr?: string | null): string[] {
  return resolve(cfg, "tham", dc, csr).map((x) => x.ten)
}

function pickDefault(list: { ten: string; isDefault: boolean }[]): string {
  return (list.find((x) => x.isDefault) || list[0])?.ten || ""
}

export function defaultBoc(cfg: PackagingConfig | null | undefined, dc: string | null | undefined, csr: string | null | undefined): string {
  return pickDefault(resolve(cfg, "boc", dc, csr))
}

export function defaultPallet(cfg: PackagingConfig | null | undefined, dc?: string | null, csr?: string | null): string {
  return pickDefault(resolve(cfg, "pallet_sx", dc, csr))
}

export function defaultTham(cfg: PackagingConfig | null | undefined, dc?: string | null, csr?: string | null): string {
  return pickDefault(resolve(cfg, "tham", dc, csr))
}

/**
 * Giữ giá trị đang lưu (lô / phiếu cũ) khi nó không còn trong danh sách cấu hình — để form sửa
 * không làm mất dữ liệu cũ. Giá trị cũ đứng đầu.
 */
export function mergeWithLegacy(options: string[], current: string | string[] | null | undefined): string[] {
  const cur = (Array.isArray(current) ? current : [current])
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
  const keys = new Set(options.map(normKey))
  const extra = cur.filter((v) => !keys.has(normKey(v)))
  return [...new Set(extra), ...options]
}

/** Giá trị có nằm trong danh sách cấu hình không (so khớp bỏ hoa thường / khoảng trắng thừa). */
export function isConfiguredOption(options: string[], value: string | null | undefined): boolean {
  const k = normKey(String(value ?? ""))
  return !!k && options.some((o) => normKey(o) === k)
}

/** "cũ" / "Cu" / "CŨ" ⇒ "Cũ"; "mới"/"moi" ⇒ "Mới"; giá trị khác giữ nguyên. */
export function normalizeTham(value: string | null | undefined): string {
  const raw = String(value ?? "").normalize("NFC").trim()
  const k = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  if (k === "cu") return "Cũ"
  if (k === "moi") return "Mới"
  return raw
}

const stripPallet = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/^pallet\s+/, "")
    .replace(/\s+/g, " ")
    .trim()

/**
 * Thành phần pallet của 1 loại pallet sản xuất: ưu tiên cấu hình (kể cả mục đã tắt — lô cũ vẫn dùng),
 * không có ⇒ quy đổi cứng cũ trong pallet-usage.ts.
 */
export function palletComponentsFromConfig(
  cfg: PackagingConfig | null | undefined,
  palletName: string,
): PalletComponent[] | null {
  const key = stripPallet(palletName)
  if (!key) return null
  const c = ensurePackagingConfig(cfg)
  const hit = c.items.find((i) => i.kind === "pallet_sx" && i.thanh_phan.length > 0 && stripPallet(i.ten) === key)
  if (hit) return hit.thanh_phan as PalletComponent[]
  return palletComponents(palletName)
}
