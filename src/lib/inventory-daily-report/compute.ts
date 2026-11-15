// Kho vật tư — dựng ma trận "ngày × cột" của báo cáo sử dụng theo ngày. THUẦN (không DB). Rule 13.
//
// Nguồn: xuất kho thật (inventory_stock_movements export) + xuất kho LỊCH SỬ (inventory_legacy_movements, file NXT cũ).
// Quy tắc gộp theo từng (ngày, vật tư): có phát sinh thật ⇒ dùng thật, không có ⇒ dùng lịch sử — không bao giờ cộng trùng
// (người dùng chốt 2026-11-15: ngày 24/07 lấy số DB).

import type { DailyReportConfig, DailyReportKieu, DailyReportSnapshot, SnapColumn, SnapItem } from "./types"

export type DayQty = { ngay: string; itemId: string; qty: number }

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** Gộp thật + lịch sử theo (ngày, vật tư). Trả map "ngày|itemId" → số lượng và số ô lấy từ lịch sử. */
export function mergeRealAndLegacy(real: DayQty[], legacy: DayQty[]): { map: Map<string, number>; legacyCells: number } {
  const map = new Map<string, number>()
  for (const r of real) {
    const k = `${r.ngay}|${r.itemId}`
    map.set(k, (map.get(k) || 0) + r.qty)
  }
  const legacyAgg = new Map<string, number>()
  for (const r of legacy) {
    const k = `${r.ngay}|${r.itemId}`
    legacyAgg.set(k, (legacyAgg.get(k) || 0) + r.qty)
  }
  let legacyCells = 0
  for (const [k, q] of legacyAgg) {
    if (map.has(k)) continue
    map.set(k, q)
    legacyCells++
  }
  return { map, legacyCells }
}

/** Vật tư được tick ở >1 cột ⇒ bị cộng trùng vào tổng (vd 2026-11-15: MOCN ở cả "Mỡ chịu nhiệt SKF" và "Mỡ các loại"
 *  làm 55-BC T10 = 3.819 thay vì 3.801). Trả itemId → danh sách số thứ tự cột (1-based). */
export function duplicateItemColumns(columns: Array<{ itemIds: string[] }>): Map<string, number[]> {
  const where = new Map<string, number[]>()
  columns.forEach((c, j) => {
    for (const id of new Set(c.itemIds || [])) where.set(id, [...(where.get(id) || []), j + 1])
  })
  for (const [id, cols] of where) if (cols.length < 2) where.delete(id)
  return where
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

export function buildDailyMatrix(args: {
  from: string
  to: string
  kieu: DailyReportKieu
  config: DailyReportConfig
  items: Map<string, SnapItem>
  real: DayQty[]
  legacy: DayQty[]
}): DailyReportSnapshot {
  const { from, to, kieu, config, items } = args
  const days = daysBetween(from, to)
  const { map, legacyCells } = mergeRealAndLegacy(args.real, args.legacy)
  const warnings: string[] = []
  for (const [id, cols] of duplicateItemColumns(config.columns || [])) {
    const it = items.get(id)
    warnings.push(`Vật tư ${it ? `${it.code} ${it.name}` : id} nằm ở nhiều cột (${cols.join(", ")}) ⇒ bị cộng trùng vào tổng — sửa Mẫu báo cáo.`)
  }

  let columns: SnapColumn[] = (config.columns || []).map((c) => {
    const its = c.itemIds.map((id) => items.get(id)).filter((x): x is SnapItem => !!x)
    if (its.length < c.itemIds.length) warnings.push(`Cột "${c.label}": ${c.itemIds.length - its.length} vật tư không còn trong danh mục.`)
    const units = [...new Set(its.map((i) => i.unit.trim().toLowerCase()).filter(Boolean))]
    if (units.length > 1) warnings.push(`Cột "${c.label}" gộp vật tư khác đơn vị tính (${units.join(", ")}).`)
    return { label: c.label, subLabel: c.subLabel || "", items: its, unit: its[0]?.unit || "", total: 0 }
  })

  let values = days.map((d) => columns.map((c) => round6(c.items.reduce((s, it) => s + (map.get(`${d}|${it.id}`) || 0), 0))))
  columns = columns.map((c, j) => ({ ...c, total: round6(values.reduce((s, row) => s + row[j], 0)) }))

  if (config.hideZero) {
    const keep = columns.map((c) => Math.abs(c.total) > 1e-9)
    columns = columns.filter((_, j) => keep[j])
    values = values.map((row) => row.filter((_, j) => keep[j]))
  }
  if (!columns.length) warnings.push("Mẫu chưa có cột nào (vào Mẫu báo cáo để tick vật tư).")

  return {
    from,
    to,
    kieu,
    days,
    columns,
    values,
    grandTotal: round6(columns.reduce((s, c) => s + c.total, 0)),
    legacyCells,
    warnings,
  }
}
