// Thành phần pallet theo nhà máy (bảng pallet_components, migration 20261117) — GĐ3 phần A.
// THUẦN (client + server), không import supabase.
//
// Thay bảng cứng PALLET_COMPONENT_ITEMS / PALLET_COMPONENT_LABEL. Bảng chưa có / lỗi / rỗng ⇒ DEFAULT = đúng bảng cứng cũ
// + Nắp sắt (NS), Nắp gỗ (NG). DEFAULT không biết id vật tư kho ⇒ gắn theo MÃ vật tư (item_codes).

export type PalletComponentDef = {
  id: string
  /** Mã nội bộ bất biến (sat_day, nap_sat, ...). */
  code: string
  ten: string
  /** Mã nhóm hiển thị ở Kho vật tư → Tồn (DPH, PM, NS...). */
  group_code: string
  inventory_item_ids: string[]
  /** Chỉ dùng cho DEFAULT (chưa có bảng): gắn vật tư kho theo mã. */
  item_codes: string[]
  la_nap: boolean
  co_nap: boolean
  sort_order: number
  is_active: boolean
}

export type PalletComponentsConfig = {
  items: PalletComponentDef[]
  fromDb: boolean
}

export const PALLET_COMPONENTS_SELECT =
  "id, code, ten, group_code, inventory_item_ids, la_nap, co_nap, sort_order, is_active"

export const PALLET_COMPONENT_CODE_RE = /^[a-z0-9_]{2,40}$/

/** Mã có đúng định dạng thành phần không (dùng để lọc dữ liệu rác trong mảng thanh_phan / mat_thanh_phan). */
export const isPalletComponentCode = (c: string) => PALLET_COMPONENT_CODE_RE.test(c)

type Seed = Omit<PalletComponentDef, "id" | "inventory_item_ids" | "is_active">

// PHẢI khớp phần seed của supabase/migrations/20261117_pallet_components.sql.
const SEED: Seed[] = [
  { code: "sat_day", ten: "Pallet sắt dày", group_code: "DPH", item_codes: ["DPH"], la_nap: false, co_nap: true, sort_order: 10 },
  { code: "sat_mong", ten: "Pallet sắt mỏng", group_code: "PM", item_codes: ["MUBEZ", "MCH"], la_nap: false, co_nap: false, sort_order: 20 },
  { code: "de_go", ten: "Đế gỗ", group_code: "ĐG", item_codes: ["ĐG"], la_nap: false, co_nap: false, sort_order: 30 },
  { code: "de_nhua", ten: "Đế nhựa", group_code: "ĐN", item_codes: ["ĐN"], la_nap: false, co_nap: false, sort_order: 40 },
  { code: "mb5", ten: "Pallet MB5", group_code: "PMB5", item_codes: ["PMB5"], la_nap: false, co_nap: false, sort_order: 50 },
  { code: "mb4", ten: "Pallet MB4", group_code: "PMB4", item_codes: ["PMB4"], la_nap: false, co_nap: false, sort_order: 60 },
  { code: "pallet_go", ten: "Pallet gỗ", group_code: "PG", item_codes: ["PG"], la_nap: false, co_nap: false, sort_order: 70 },
  { code: "nap_sat", ten: "Nắp sắt", group_code: "NS", item_codes: ["NS"], la_nap: true, co_nap: false, sort_order: 80 },
  { code: "nap_go", ten: "Nắp gỗ", group_code: "NG", item_codes: ["NG"], la_nap: true, co_nap: false, sort_order: 90 },
]

export const DEFAULT_PALLET_COMPONENTS: PalletComponentsConfig = {
  items: SEED.map((s) => ({ ...s, id: `default-${s.code}`, inventory_item_ids: [], is_active: true })),
  fromDb: false,
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []

export function parsePalletComponentRows(rows: unknown[] | null | undefined): PalletComponentDef[] {
  const out: PalletComponentDef[] = []
  for (const raw of rows || []) {
    const r = raw as Record<string, unknown>
    const code = String(r.code || "").trim()
    const ten = String(r.ten || "").normalize("NFC").trim()
    if (!isPalletComponentCode(code) || !ten) continue
    out.push({
      id: String(r.id || code),
      code,
      ten,
      group_code: String(r.group_code || "").normalize("NFC").trim() || code.toUpperCase(),
      inventory_item_ids: asStrings(r.inventory_item_ids),
      item_codes: [],
      la_nap: r.la_nap === true,
      co_nap: r.co_nap === true,
      sort_order: Number(r.sort_order) || 0,
      is_active: r.is_active !== false,
    })
  }
  return out
}

export function buildPalletComponentsConfig(rows: unknown[] | null | undefined, hasError: boolean): PalletComponentsConfig {
  if (hasError) return DEFAULT_PALLET_COMPONENTS
  const items = parsePalletComponentRows(rows)
  if (items.length === 0) return DEFAULT_PALLET_COMPONENTS
  return { items, fromDb: true }
}

export function ensurePalletComponents(cfg: PalletComponentsConfig | null | undefined): PalletComponentsConfig {
  return cfg && Array.isArray(cfg.items) && cfg.items.length > 0 ? cfg : DEFAULT_PALLET_COMPONENTS
}

/** Danh sách theo thứ tự. Mặc định chỉ thành phần đang dùng. */
export function sortedComponents(
  cfg: PalletComponentsConfig | null | undefined,
  opts: { includeInactive?: boolean } = {},
): PalletComponentDef[] {
  return [...ensurePalletComponents(cfg).items]
    .filter((c) => opts.includeInactive || c.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.ten.localeCompare(b.ten, "vi"))
}

/** Tìm theo mã — kể cả thành phần đã tắt (lô / cấu hình cũ vẫn tham chiếu). */
export function componentByCode(cfg: PalletComponentsConfig | null | undefined, code: string): PalletComponentDef | null {
  return ensurePalletComponents(cfg).items.find((c) => c.code === code) || null
}

export function componentLabel(cfg: PalletComponentsConfig | null | undefined, code: string): string {
  return componentByCode(cfg, code)?.ten || code
}

export function componentGroupCode(cfg: PalletComponentsConfig | null | undefined, code: string): string {
  return componentByCode(cfg, code)?.group_code || code.toUpperCase()
}

/** Nắp đang dùng (Nắp sắt, Nắp gỗ...). */
export function napComponents(cfg: PalletComponentsConfig | null | undefined): PalletComponentDef[] {
  return sortedComponents(cfg).filter((c) => c.la_nap)
}

/**
 * Vật tư kho → thành phần. Có bảng ⇒ theo inventory_item_ids; chưa có ⇒ theo mã vật tư của DEFAULT.
 * Mỗi vật tư thuộc tối đa 1 thành phần (gặp trước theo thứ tự).
 */
export function itemComponentMap(
  cfg: PalletComponentsConfig | null | undefined,
  items: { id: string; code: string | null }[],
): Map<string, PalletComponentDef> {
  const c = ensurePalletComponents(cfg)
  const out = new Map<string, PalletComponentDef>()
  const all = sortedComponents(c, { includeInactive: true })
  if (c.fromDb) {
    for (const comp of all) for (const id of comp.inventory_item_ids) if (!out.has(id)) out.set(id, comp)
    return out
  }
  const byCode = new Map<string, PalletComponentDef>()
  for (const comp of all) for (const code of comp.item_codes) {
    const k = code.trim().toUpperCase()
    if (!byCode.has(k)) byCode.set(k, comp)
  }
  for (const it of items) {
    const comp = byCode.get(String(it.code || "").trim().toUpperCase())
    if (comp) out.set(it.id, comp)
  }
  return out
}
