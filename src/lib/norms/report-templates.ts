// Định mức KTKT GĐ4 — bộ dựng dữ liệu từng kiểu mẫu báo cáo (module THUẦN). Rule 30.
//   thang_8a  : Mẫu 8A-NMCB — kết quả sản xuất tháng (mục 1–11; mục 8 chỉ tiêu đề).
//   dong_ho   : Mẫu 09-NMCB — tổng hợp điện nước theo khu vực đồng hồ.
// Quy tắc chung: chỉ hiện dòng > 0; mục so sánh = dòng có định mức; "Phát sinh ngoài định mức" in đủ.

import type { NormReportSnapshot, SnapLine, SnapMeter, SnapOutside, Thang8aConfig } from "./report-types"
import { NL_MATERIALS, NORM_UNIT_LABEL } from "./types"

export const isOverSnapLine = (l: SnapLine): boolean => l.diff !== null && l.diff > 1e-9 && l.allowed > 0

/** Dòng vượt định mức (bắt buộc giải trình ở mục 10 Mẫu 8A). */
export function overLines(snap: NormReportSnapshot): SnapLine[] {
  return snap.lines.filter(isOverSnapLine)
}

export const lineTitle = (l: SnapLine): string => (l.dayChuyen ? `${l.itemName} · ${l.dayChuyen}` : l.itemName)
export const lineUnit = (l: SnapLine): string => NORM_UNIT_LABEL[l.unit] || l.unit

// ─── Mẫu 8A ──────────────────────────────────────────────────────────────────

export type Section8a = { title: string; lines: SnapLine[] }

export type Data8a = {
  nlCols: Array<{ key: string; label: string }>
  nlUnits: NormReportSnapshot["nlUnits"]
  nlTotalTuoi: Record<string, number>
  nlTotalKho: Record<string, number>
  tpByCsr: NormReportSnapshot["tpByCsr"]
  tpExport: NormReportSnapshot["tpExport"]
  /** Tấn TP theo nguồn (đầu mục 4.1 / 4.2 / 4.3). */
  tpByNguon: Record<string, number>
  sec4: SnapLine[]
  sec5: SnapLine[]
  sec6: SnapLine[]
  sec7: SnapLine[]
  outside: SnapOutside[]
  summary: Array<{ name: string; unit: string; actual: number; allowed: number; diff: number }>
  over: SnapLine[]
  kmByType: NormReportSnapshot["totals"]["kmByType"]
  nlKhoTons: number
}

export function build8a(snap: NormReportSnapshot, config: Thang8aConfig): Data8a {
  const xlnt = new Set((config.xlntItemCodes || []).map((c) => c.trim().toUpperCase()))
  // Mục 7: mã cấu hình + chỉ tiêu tên có "nước thải" / "XLNT" + nhóm Khác.
  const isXlnt = (l: SnapLine) => xlnt.has(l.itemCode.toUpperCase()) || l.group === "khac" || /nước thải|xlnt/i.test(l.itemName)
  const sec4 = snap.lines.filter((l) => !isXlnt(l) && (l.group === "hoa_chat" || l.group === "vat_tu"))
  const sec5 = snap.lines.filter((l) => !isXlnt(l) && l.group === "dien_nuoc")
  const sec6 = snap.lines.filter((l) => !isXlnt(l) && (l.group === "dau_nhot_mo" || l.group === "van_chuyen"))
  const sec7 = snap.lines.filter(isXlnt)

  const usedCols = NL_MATERIALS.filter((m) => snap.nlUnits.some((u) => (u.tuoi[m.key] || 0) > 0 || (u.kho[m.key] || 0) > 0))
  const nlTotalTuoi: Record<string, number> = {}
  const nlTotalKho: Record<string, number> = {}
  for (const u of snap.nlUnits)
    for (const m of usedCols) {
      nlTotalTuoi[m.key] = (nlTotalTuoi[m.key] || 0) + (u.tuoi[m.key] || 0)
      nlTotalKho[m.key] = (nlTotalKho[m.key] || 0) + (u.kho[m.key] || 0)
    }

  const tpByNguon: Record<string, number> = {}
  for (const r of snap.tpByCsr) for (const [k, v] of Object.entries(r.kg)) tpByNguon[k] = (tpByNguon[k] || 0) + v

  // Mục 9: tổng hợp theo tên chỉ tiêu (gộp dây chuyền).
  const sum = new Map<string, { name: string; unit: string; actual: number; allowed: number }>()
  for (const l of snap.lines) {
    const cur = sum.get(l.itemName) || { name: l.itemName, unit: lineUnit(l), actual: 0, allowed: 0 }
    cur.actual += l.actual ?? 0
    cur.allowed += l.allowed
    sum.set(l.itemName, cur)
  }
  const summary = [...sum.values()].map((s) => ({ ...s, diff: s.actual - s.allowed }))

  return {
    nlCols: usedCols.map((m) => ({ key: m.key, label: m.label })),
    nlUnits: snap.nlUnits.filter((u) => usedCols.some((m) => (u.tuoi[m.key] || 0) > 0)),
    nlTotalTuoi,
    nlTotalKho,
    tpByCsr: snap.tpByCsr.filter((r) => Object.values(r.kg).some((v) => v > 0)),
    tpExport: snap.tpExport.filter((r) => Object.values(r.kg).some((v) => v > 0)),
    tpByNguon,
    sec4,
    sec5,
    sec6,
    sec7,
    outside: snap.outside.filter((o) => o.qty === null || o.qty > 0),
    summary,
    over: overLines(snap),
    kmByType: snap.totals.kmByType,
    nlKhoTons: snap.totals.nlKhoTons,
  }
}

// ─── Mẫu 09 ──────────────────────────────────────────────────────────────────

export type DongHoGroup = { khuVuc: string; meters: SnapMeter[]; dien: number; nuoc: number; nuocThai: number }
export type DataDongHo = { groups: DongHoGroup[]; totalDien: number; totalNuoc: number; totalNuocThai: number }

export function buildDongHo(snap: NormReportSnapshot): DataDongHo {
  const groups: DongHoGroup[] = []
  for (const m of snap.meters) {
    let g = groups.find((x) => x.khuVuc === m.khuVuc)
    if (!g) {
      g = { khuVuc: m.khuVuc, meters: [], dien: 0, nuoc: 0, nuocThai: 0 }
      groups.push(g)
    }
    g.meters.push(m)
    const v = m.value ?? 0
    if (m.loai === "dien") g.dien += v
    else if (m.loai === "nuoc") g.nuoc += v
    else g.nuocThai += v
  }
  return {
    groups,
    totalDien: groups.reduce((s, g) => s + g.dien, 0),
    totalNuoc: groups.reduce((s, g) => s + g.nuoc, 0),
    totalNuocThai: groups.reduce((s, g) => s + g.nuocThai, 0),
  }
}
