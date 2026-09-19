import type { FeatureCollection } from "geojson"

export type ForestPlotRow = {
  ten: string
  ma_lo_full: string | null
  geometry: unknown
  nong_truong: string | null
  doi: number | null
  giong: string | null
  dien_tich_ha: number | null
  nam_trong: number | null
  nam_cao_up: number | null
}

export type EudrPlotProperties = {
  ID?: string
  Ma_lo_2026?: string
  Ten?: string
  Nong_truong?: string
  Doi_2026?: string | number | null
  Doi_nho?: string
  Giong?: string
  Dtich2026_ha?: string | number | null
  Nam_trong?: string | number | null
  Nam_mo_cao?: string | number | null
  Tuoi_cao?: string | number | null
  Tong_so_cay_KK?: string | number | null
  Mat_cao_2026?: string
  CD_cao_2026?: string
  ToadoX?: string | number | null
  ToadoY?: string | number | null
  Khoang_cach_m?: string
  Hang_dat?: string
  Ma_lo?: string
  Cao_trinh_min_m?: string | number | null
  Cao_trinh_max_m?: string | number | null
  Phuong_phap?: string
  ma_lo_full?: string
  ProducerName?: string
  ProducerCountry?: string
  producerCountry?: string
  ProductionPlace?: string
  Area?: string | number | null
  external_id?: string
  export_date?: string
  /** Diện tích CẢ LÔ (không phải phần chia của mảnh này) — chỉ có khi lô bị tách nhiều mảnh,
   *  giống nhau trên mọi mảnh cùng mã lô. Xem `eudr-feature-collection.ts`'s `expandPlotFeatures`. */
  Dtich_lo_ha?: string | number | null
  /** "1/3" = mảnh 1 trong tổng 3 mảnh của cùng 1 lô — chỉ có khi lô bị tách nhiều mảnh. */
  Manh?: string
  [key: string]: unknown
}

export function toDisplayText(value: unknown, fallback = "—") {
  if (value === null || value === undefined) return fallback
  const text = String(value).trim()
  return text ? text : fallback
}

export function toDisplayNumber(value: unknown, digits = 0, fallback = "—") {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return digits > 0 ? number.toFixed(digits) : number.toLocaleString("vi-VN")
}

export function parseFiniteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

export type ForestPlotCodeAliasRow = {
  alias_ten: string
  canonical_ten: string
}

/**
 * Dựng map tra cứu bí danh mã lô (`alias_ten` → danh sách `canonical_ten`) từ các dòng đã query
 * trong bảng `forest_plot_code_aliases` (xem migration `20260919_forest_plot_code_aliases.sql`).
 *
 * Một `alias_ten` có thể ứng với NHIỀU `canonical_ten` (vd "M6" = hợp của "M6S" + "M6T" — 2 mảnh
 * con đã digitize riêng, kề nhau thành 1 thửa liền mạch) — mỗi tổ hợp là 1 dòng riêng trong bảng
 * (`UNIQUE(factory_id, alias_ten, canonical_ten)`, KHÔNG unique trên riêng `alias_ten`).
 *
 * Hàm thuần — không I/O. Caller tự query DB rồi truyền dòng kết quả vào đây, cùng nguyên tắc
 * với `buildStaticPlotFeatureMap()` ở trên.
 */
export function buildForestPlotAliasMap(rows: ForestPlotCodeAliasRow[] | null | undefined) {
  const map = new globalThis.Map<string, string[]>()
  for (const row of rows || []) {
    const alias = String(row.alias_ten || "").trim()
    const canonical = String(row.canonical_ten || "").trim()
    if (!alias || !canonical) continue
    const list = map.get(alias)
    if (list) list.push(canonical)
    else map.set(alias, [canonical])
  }
  return map
}

export function buildStaticPlotFeatureMap(full: FeatureCollection | null) {
  const mapped = new globalThis.Map<string, FeatureCollection["features"][number]>()
  for (const feature of full?.features || []) {
    const key = String((feature.properties as EudrPlotProperties | undefined)?.Ten || "").trim()
    if (key) mapped.set(key, feature)
  }
  return mapped
}

export function mergePlotProperties(
  plotCode: string,
  dbRow?: ForestPlotRow | null,
  reference?: FeatureCollection["features"][number] | null,
  exportDate?: string,
): EudrPlotProperties {
  const refProps = ((reference?.properties as EudrPlotProperties | undefined) || {})
  const normalizedArea = dbRow?.dien_tich_ha ?? refProps.Dtich2026_ha ?? null
  const normalizedTeam = dbRow?.doi ?? refProps.Doi_2026 ?? null
  const normalizedPlantYear = dbRow?.nam_trong ?? refProps.Nam_trong ?? null
  const normalizedOpenYear = dbRow?.nam_cao_up ?? refProps.Nam_mo_cao ?? null
  const areaNumber = parseFiniteNumber(normalizedArea)
  const canonicalMaLo = toDisplayText(refProps.Ma_lo_2026, dbRow?.ma_lo_full || plotCode)

  return {
    ...refProps,
    // Thuộc tính bắt buộc chuẩn TRACES / Cổng khách hàng EUDR
    ProducerName: "PHUOC HOA KAMPONG THOM PROCESSING FACTORY",
    ProducerCountry: "KH",
    producerCountry: "KH", // Tương thích parser khách hàng yêu cầu chữ thường ký tự đầu
    ProductionPlace: canonicalMaLo,
    Area: areaNumber ?? (typeof normalizedArea === "number" ? normalizedArea : parseFloat(String(normalizedArea)) || 0),
    external_id: canonicalMaLo,
    export_date: exportDate || new Date().toISOString().split("T")[0],

    // Giữ nguyên 100% toàn bộ thuộc tính nội bộ hiện có
    Ten: plotCode || refProps.Ten || refProps.Ma_lo_2026 || refProps.Ma_lo,
    Ma_lo: toDisplayText(refProps.Ma_lo, dbRow?.ma_lo_full || plotCode),
    Ma_lo_2026: canonicalMaLo,
    Nong_truong: toDisplayText(dbRow?.nong_truong, refProps.Nong_truong || ""),
    Doi_2026: normalizedTeam,
    Giong: toDisplayText(dbRow?.giong, refProps.Giong || ""),
    Dtich2026_ha: areaNumber ?? normalizedArea,
    Nam_trong: normalizedPlantYear,
    Nam_mo_cao: normalizedOpenYear,
    ma_lo_full: dbRow?.ma_lo_full || refProps.ma_lo_full || refProps.Ma_lo_2026 || "",
  }
}
