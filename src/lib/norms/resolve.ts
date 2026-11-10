// Định mức KTKT — tra định mức hiệu lực theo NGÀY (module THUẦN). Dùng cho đối soát GĐ3.
// Chỉ khung active/locked có [effective_from, effective_to] chứa ngày; dòng theo dây chuyền + CSR + nguồn.

import type { NguonCode, NormRow, NormValue, NormVersion, NormVersionItem } from "./types"

export type NormDataset = {
  versions: NormVersion[]
  versionItems: NormVersionItem[]
  rows: NormRow[]
  values: NormValue[]
}

/** Khung có hiệu lực ngày `isoDate` (YYYY-MM-DD). Nháp không bao giờ được dùng. */
export function versionForDate(versions: NormVersion[], isoDate: string): NormVersion | null {
  return (
    versions.find(
      (v) =>
        v.status !== "draft" && v.effective_from <= isoDate && (v.effective_to === null || v.effective_to >= isoDate),
    ) ?? null
  )
}

export type ResolvedNorm = {
  version: NormVersion
  versionItem: NormVersionItem
  row: NormRow | null
  value: number
}

/**
 * Định mức của chỉ tiêu `itemId` cho 1 ngày + (dây chuyền, CSR, nguồn). Cột 100 km: bỏ qua dây chuyền/CSR/nguồn.
 * null = không có khung / chỉ tiêu không thuộc khung / không có dòng phủ / ô trống.
 */
export function resolveNormValue(
  data: NormDataset,
  isoDate: string,
  itemId: string,
  key: { dayChuyen?: string; csr?: string; nguon?: NguonCode | null } = {},
): ResolvedNorm | null {
  const version = versionForDate(data.versions, isoDate)
  if (!version) return null
  const versionItem = data.versionItems.find((vi) => vi.version_id === version.id && vi.item_id === itemId)
  if (!versionItem) return null
  if (versionItem.basis === "km100") {
    const v = data.values.find((x) => x.version_id === version.id && x.item_id === itemId && x.row_id === null)
    return v ? { version, versionItem, row: null, value: Number(v.value) } : null
  }
  const csr = (key.csr || "").toUpperCase()
  const row = data.rows.find(
    (r) =>
      r.version_id === version.id &&
      r.day_chuyen === key.dayChuyen &&
      r.csr_codes.some((c) => c.toUpperCase() === csr) &&
      (r.nguon_codes.length === 0 || (!!key.nguon && r.nguon_codes.includes(key.nguon))),
  )
  if (!row) return null
  const v = data.values.find((x) => x.row_id === row.id && x.item_id === itemId)
  return v ? { version, versionItem, row, value: Number(v.value) } : null
}
