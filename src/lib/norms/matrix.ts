// Định mức KTKT — dựng bố cục ma trận + kiểm tra (module THUẦN). Quy tắc trùng dòng / chồng hiệu lực
// PHẢI khớp trigger trong supabase/migrations/20261121_tech_norms_module.sql.

import {
  NORM_GROUPS,
  NGUON_CODES,
  type NguonCode,
  type NormGroup,
  type NormItem,
  type NormRow,
  type NormValue,
  type NormVersion,
  type NormVersionItem,
} from "./types"

export type MatrixColumn = { vi: NormVersionItem; item: NormItem }
export type MatrixColumnGroup = { group: NormGroup; columns: MatrixColumn[] }

/** Cột theo tấn (không phải 100 km), nhóm theo norm_group đúng thứ tự PDF. */
export function buildColumnGroups(versionItems: NormVersionItem[], items: NormItem[]): MatrixColumnGroup[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const cols: MatrixColumn[] = []
  for (const vi of versionItems) {
    const item = byId.get(vi.item_id)
    if (item && vi.basis !== "km100") cols.push({ vi, item })
  }
  cols.sort((a, b) => a.vi.sort_order - b.vi.sort_order || a.item.sort_order - b.item.sort_order)
  return NORM_GROUPS.map((group) => ({ group, columns: cols.filter((c) => c.item.norm_group === group) })).filter(
    (g) => g.columns.length > 0,
  )
}

export function buildKmColumns(versionItems: NormVersionItem[], items: NormItem[]): MatrixColumn[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  return versionItems
    .filter((vi) => vi.basis === "km100")
    .map((vi) => ({ vi, item: byId.get(vi.item_id) }))
    .filter((c): c is MatrixColumn => !!c.item)
    .sort((a, b) => a.vi.sort_order - b.vi.sort_order)
}

export function sortRows(rows: NormRow[]): NormRow[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order || a.day_chuyen.localeCompare(b.day_chuyen))
}

/** Khoá ô: `${row_id}|${item_id}`. */
export const cellKey = (rowId: string, itemId: string) => `${rowId}|${itemId}`

export function indexValues(values: NormValue[]): Map<string, NormValue> {
  const m = new Map<string, NormValue>()
  for (const v of values) if (v.row_id) m.set(cellKey(v.row_id, v.item_id), v)
  return m
}

/**
 * rowSpan cho từng ô: ô đầu của 1 dải dòng LIỀN KỀ cùng merge_key (cùng cột) ⇒ span = độ dài dải;
 * các ô sau trong dải ⇒ 0 (không render). Không gộp ⇒ 1.
 */
export function computeCellSpans(sortedRows: NormRow[], itemIds: string[], valueIndex: Map<string, NormValue>) {
  const span = new Map<string, number>()
  for (const itemId of itemIds) {
    let i = 0
    while (i < sortedRows.length) {
      const key = valueIndex.get(cellKey(sortedRows[i].id, itemId))?.merge_key ?? null
      let j = i + 1
      if (key) {
        while (j < sortedRows.length && valueIndex.get(cellKey(sortedRows[j].id, itemId))?.merge_key === key) j++
      }
      span.set(cellKey(sortedRows[i].id, itemId), j - i)
      for (let k = i + 1; k < j; k++) span.set(cellKey(sortedRows[k].id, itemId), 0)
      i = j
    }
  }
  return span
}

/** rowSpan cột Dây chuyền (các dòng liền kề cùng dây chuyền). */
export function computeLineSpans(sortedRows: NormRow[]): Map<string, number> {
  const span = new Map<string, number>()
  let i = 0
  while (i < sortedRows.length) {
    let j = i + 1
    while (j < sortedRows.length && sortedRows[j].day_chuyen === sortedRows[i].day_chuyen) j++
    span.set(sortedRows[i].id, j - i)
    for (let k = i + 1; k < j; k++) span.set(sortedRows[k].id, 0)
    i = j
  }
  return span
}

function nguonOverlap(a: NguonCode[], b: NguonCode[]): boolean {
  return a.length === 0 || b.length === 0 || a.some((x) => b.includes(x))
}

/** Dòng ứng viên trùng CSR + nguồn với dòng nào khác trong cùng khung + dây chuyền (khớp trigger NORM_ROW_OVERLAP). */
export function findRowOverlap(
  candidate: Pick<NormRow, "id" | "day_chuyen" | "csr_codes" | "nguon_codes">,
  rows: NormRow[],
): NormRow | null {
  const csr = new Set(candidate.csr_codes.map((c) => c.trim().toUpperCase()))
  for (const r of rows) {
    if (r.id === candidate.id || r.day_chuyen !== candidate.day_chuyen) continue
    if (!r.csr_codes.some((c) => csr.has(c.toUpperCase()))) continue
    if (nguonOverlap(r.nguon_codes, candidate.nguon_codes)) return r
  }
  return null
}

export type UncoveredCombo = { day_chuyen: string; csr: string; nguon: NguonCode }

/**
 * (dây chuyền, CSR, nguồn) có trong Quy cách chủng loại của nhà máy nhưng chưa thuộc dòng nào của khung.
 * `skipNguon` mặc định bỏ Thanh lý (không tính định mức).
 */
export function findUncoveredCombos(
  rows: NormRow[],
  csrByLine: Record<string, string[]>,
  skipNguon: NguonCode[] = ["thanh_ly"],
): UncoveredCombo[] {
  const out: UncoveredCombo[] = []
  for (const [line, csrs] of Object.entries(csrByLine)) {
    for (const csr of csrs) {
      for (const nguon of NGUON_CODES) {
        if (skipNguon.includes(nguon)) continue
        const covered = rows.some(
          (r) =>
            r.day_chuyen === line &&
            r.csr_codes.some((c) => c.toUpperCase() === csr.toUpperCase()) &&
            (r.nguon_codes.length === 0 || r.nguon_codes.includes(nguon)),
        )
        if (!covered) out.push({ day_chuyen: line, csr, nguon })
      }
    }
  }
  return out
}

const toTime = (d: string | null, fallback: number) => (d ? new Date(`${d}T00:00:00Z`).getTime() : fallback)

/** Khung ACTIVE/LOCKED khác chồng ngày với khung ứng viên (khớp trigger NORM_VERSION_OVERLAP). */
export function findVersionOverlap(
  candidate: Pick<NormVersion, "id" | "effective_from" | "effective_to">,
  versions: NormVersion[],
): NormVersion | null {
  const a0 = toTime(candidate.effective_from, -Infinity)
  const a1 = toTime(candidate.effective_to, Infinity)
  for (const v of versions) {
    if (v.id === candidate.id || v.status === "draft") continue
    const b0 = toTime(v.effective_from, -Infinity)
    const b1 = toTime(v.effective_to, Infinity)
    if (a0 <= b1 && b0 <= a1) return v
  }
  return null
}

/** Nhãn mặc định của dòng: "CV50 NT", "L, 3L, 5 TM". */
export function defaultRowLabel(csrCodes: string[], nguon: NguonCode[]): string {
  const csr = csrCodes.map((c) => c.replace(/^(CSR|SVR)/i, "") || c).join(", ")
  if (!nguon.length) return csr
  const short: Record<NguonCode, string> = { cong_ty: "NT", thu_mua: "TM", gia_cong: "GC", thanh_ly: "TL" }
  const primary = nguon.includes("cong_ty") ? ["cong_ty" as NguonCode] : nguon
  return `${csr} ${primary.map((n) => short[n]).join("+")}`
}

// ─── Gộp / tách nhiều ô đã chọn (Ctrl / Shift) ──────────────────────────────

export type SelectedCell = { rowId: string; itemId: string }

export type MergePlan = {
  itemId: string
  key: string
  value: number
  /** Ô đã có ⇒ cập nhật merge_key + value. */
  updateIds: string[]
  /** Dòng chưa có ô ⇒ chèn ô mới. */
  insertRowIds: string[]
}

export type MergeIssue = { itemId: string; reason: "not_contiguous" | "no_value" }

/**
 * Gộp các ô đã chọn THEO TỪNG CỘT (mô hình chỉ gộp dọc trong 1 cột). Ô đã chọn thuộc 1 ô gộp sẵn ⇒ lấy cả nhóm.
 * Cột chỉ có 1 dòng sau khi mở rộng ⇒ bỏ qua. Dòng phải liền nhau theo thứ tự hiển thị. Số = ô trên cùng có số.
 * Khoá gộp = khoá có sẵn đầu tiên (theo thứ tự dòng), không có ⇒ `newKey()`.
 */
export function planMergeSelection(
  sortedRows: NormRow[],
  values: NormValue[],
  selected: SelectedCell[],
  newKey: () => string,
): { plans: MergePlan[]; issues: MergeIssue[] } {
  const rowIndex = new Map(sortedRows.map((r, i) => [r.id, i]))
  const byItem = new Map<string, Set<number>>()
  for (const s of selected) {
    const i = rowIndex.get(s.rowId)
    if (i === undefined) continue
    const set = byItem.get(s.itemId) ?? new Set<number>()
    set.add(i)
    byItem.set(s.itemId, set)
  }
  const plans: MergePlan[] = []
  const issues: MergeIssue[] = []
  for (const [itemId, set] of byItem) {
    const cellOf = (rowId: string) => values.find((v) => v.item_id === itemId && v.row_id === rowId)
    // Mở rộng theo nhóm gộp sẵn
    for (const i of [...set]) {
      const key = cellOf(sortedRows[i].id)?.merge_key
      if (!key) continue
      for (const v of values) {
        if (v.item_id === itemId && v.merge_key === key && v.row_id) {
          const j = rowIndex.get(v.row_id)
          if (j !== undefined) set.add(j)
        }
      }
    }
    const idx = [...set].sort((a, b) => a - b)
    if (idx.length < 2) continue
    if (idx[idx.length - 1] - idx[0] + 1 !== idx.length) {
      issues.push({ itemId, reason: "not_contiguous" })
      continue
    }
    const cells = idx.map((i) => ({ row: sortedRows[i], cell: cellOf(sortedRows[i].id) }))
    const first = cells.find((c) => c.cell)
    if (!first?.cell) {
      issues.push({ itemId, reason: "no_value" })
      continue
    }
    const key = cells.find((c) => c.cell?.merge_key)?.cell?.merge_key || newKey()
    plans.push({
      itemId,
      key,
      value: first.cell.value,
      updateIds: cells.filter((c) => c.cell).map((c) => c.cell!.id),
      insertRowIds: cells.filter((c) => !c.cell).map((c) => c.row.id),
    })
  }
  return { plans, issues }
}

/** Id các ô thuộc mọi nhóm gộp có ô được chọn ⇒ đặt merge_key = null (giữ nguyên số). */
export function planSplitSelection(values: NormValue[], selected: SelectedCell[]): string[] {
  const keys = new Set<string>()
  for (const s of selected) {
    const v = values.find((x) => x.item_id === s.itemId && x.row_id === s.rowId)
    if (v?.merge_key) keys.add(`${v.item_id}|${v.merge_key}`)
  }
  return values.filter((v) => v.merge_key && keys.has(`${v.item_id}|${v.merge_key}`)).map((v) => v.id)
}
