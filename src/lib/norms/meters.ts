// Định mức KTKT GĐ2 — tính tiêu thụ đồng hồ điện / nước (module THUẦN, client lẫn server). Rule 30.
//
// Quy ước lần ghi:
//  - Tiêu thụ giữa 2 lần ghi liên tiếp A → B = (B.chi_so − A.chi_so) × B.he_so.
//  - B là lần THAY / RESET đồng hồ (thay_dong_ho): đồng hồ cũ chạy tới B.chi_so_chot_cu rồi tháo ⇒
//    tiêu thụ A → B = (B.chi_so_chot_cu − A.chi_so) × B.he_so; B.chi_so là chỉ số ĐẦU của đồng hồ mới.
//  - Kỳ đồng hồ [lần ghi cũ, lần ghi mới] = cộng mọi đoạn liên tiếp nằm giữa (tự xử lý thay đồng hồ giữa kỳ).

import { addDaysISO } from "@/lib/date-utils"
import { EQUIPMENT_QR_DEFAULT_ORIGIN } from "@/lib/equipment-qr"

export type MeterReadingLike = {
  ngay: string
  chi_so: number
  he_so: number
  thay_dong_ho: boolean
  chi_so_chot_cu: number | null
}

/** Chỉ số thô (chưa nhân hệ số) giữa 2 lần ghi liên tiếp. */
export function rawStep(prev: MeterReadingLike, next: MeterReadingLike): number {
  const end = next.thay_dong_ho ? Number(next.chi_so_chot_cu ?? 0) : Number(next.chi_so)
  return end - Number(prev.chi_so)
}

/** Tiêu thụ (đã nhân hệ số của lần ghi sau) giữa 2 lần ghi liên tiếp. */
export function stepConsumption(prev: MeterReadingLike, next: MeterReadingLike): number {
  return rawStep(prev, next) * Number(next.he_so || 1)
}

export function sortReadings<T extends MeterReadingLike>(readings: T[]): T[] {
  return [...readings].sort((a, b) => a.ngay.localeCompare(b.ngay))
}

/** Lần ghi gần nhất có ngày < `date` (dùng làm "chỉ số cũ" khi nhập ngày `date`). */
export function previousReading<T extends MeterReadingLike>(readings: T[], date: string): T | null {
  let best: T | null = null
  for (const r of readings) if (r.ngay < date && (!best || r.ngay > best.ngay)) best = r
  return best
}

export type MeterPeriodResult = {
  /** Tiêu thụ đã nhân hệ số. null khi thiếu 1 trong 2 mốc. */
  value: number | null
  raw: number | null
  fromDate: string | null
  toDate: string | null
  /** Có lần thay đồng hồ nằm trong kỳ. */
  hasReplacement: boolean
  warnings: string[]
}

/**
 * Tiêu thụ từ lần ghi ngày `fromDate` tới lần ghi ngày `toDate` (2 ngày phải là ngày có lần ghi).
 * Cộng từng đoạn liên tiếp ⇒ đúng cả khi giữa kỳ có thay đồng hồ hoặc đổi hệ số.
 */
export function consumptionBetween(readings: MeterReadingLike[], fromDate: string, toDate: string): MeterPeriodResult {
  const sorted = sortReadings(readings)
  const i = sorted.findIndex((r) => r.ngay === fromDate)
  const j = sorted.findIndex((r) => r.ngay === toDate)
  const warnings: string[] = []
  if (i < 0 || j < 0 || j <= i) {
    return { value: null, raw: null, fromDate: i >= 0 ? fromDate : null, toDate: j >= 0 ? toDate : null, hasReplacement: false, warnings: ["Thiếu lần ghi đầu hoặc cuối kỳ đồng hồ."] }
  }
  let value = 0
  let raw = 0
  let hasReplacement = false
  for (let k = i + 1; k <= j; k++) {
    const step = rawStep(sorted[k - 1], sorted[k])
    if (sorted[k].thay_dong_ho) hasReplacement = true
    if (step < 0) warnings.push(`Chỉ số ngày ${sorted[k].ngay} nhỏ hơn lần ghi trước — kiểm tra lại hoặc đánh dấu thay đồng hồ.`)
    raw += step
    value += step * Number(sorted[k].he_so || 1)
  }
  return { value, raw, fromDate, toDate, hasReplacement, warnings }
}

/**
 * Gợi ý kỳ đồng hồ cho kỳ báo cáo [F, T]: lần ghi MỚI = lần ghi gần nhất ≤ T; lần ghi CŨ = lần ghi gần
 * nhất ≤ F − 1 (cuối ngày trước kỳ). Người lập báo cáo đổi được (đã chốt 2026-11-11).
 */
export function suggestMeterPeriod(readingDates: string[], from: string, to: string): { fromDate: string | null; toDate: string | null } {
  const dates = [...new Set(readingDates)].sort()
  const before = addDaysISO(from, -1)
  let toDate: string | null = null
  let fromDate: string | null = null
  for (const d of dates) {
    if (d <= to) toDate = d
    if (d <= before) fromDate = d
  }
  if (fromDate && toDate && fromDate >= toDate) fromDate = null
  return { fromDate, toDate }
}

export type StepWarning = { level: "danger" | "warn"; text: string }

/**
 * Cảnh báo cho 1 lần ghi mới so với lần trước: chỉ số giảm (không đánh dấu thay đồng hồ) ⇒ đỏ;
 * tiêu thụ lệch > 30% so trung bình tối đa 3 đoạn trước ⇒ vàng.
 */
export function readingWarnings(history: MeterReadingLike[], next: MeterReadingLike, threshold = 0.3): StepWarning[] {
  const sorted = sortReadings(history.filter((r) => r.ngay < next.ngay))
  const prev = sorted[sorted.length - 1]
  if (!prev) return []
  const out: StepWarning[] = []
  const step = rawStep(prev, next)
  if (step < 0) {
    out.push({ level: "danger", text: next.thay_dong_ho ? "Chỉ số chốt đồng hồ cũ nhỏ hơn lần ghi trước." : "Chỉ số mới nhỏ hơn chỉ số cũ — nếu đã thay / reset đồng hồ hãy tick \"Thay đồng hồ\"." })
    return out
  }
  const steps: number[] = []
  for (let k = sorted.length - 1; k >= 1 && steps.length < 3; k--) {
    const s = rawStep(sorted[k - 1], sorted[k])
    if (s >= 0) steps.push(s * Number(sorted[k].he_so || 1))
  }
  if (steps.length) {
    const avg = steps.reduce((a, b) => a + b, 0) / steps.length
    const cur = step * Number(next.he_so || 1)
    if (avg > 0 && Math.abs(cur - avg) / avg > threshold) {
      const pct = Math.round(((cur - avg) / avg) * 100)
      out.push({ level: "warn", text: `Tiêu thụ ${pct > 0 ? "cao" : "thấp"} hơn ${Math.abs(pct)}% so với trung bình ${steps.length} kỳ trước.` })
    }
  }
  return out
}

/** Đồng hồ có được tính vào định mức tại ngày `date` không (tick + hiệu lực). */
export function meterCountsForNormAt(
  meter: { dung_dinh_muc: boolean; hieu_luc_tu: string | null; hieu_luc_den: string | null; is_active?: boolean },
  date: string,
): boolean {
  if (!meter.dung_dinh_muc) return false
  if (meter.hieu_luc_tu && date < meter.hieu_luc_tu) return false
  if (meter.hieu_luc_den && date > meter.hieu_luc_den) return false
  return true
}

/** URL nhập nhanh chỉ số (in lên tem QR dán tại đồng hồ). */
export function buildNormMeterPath(meterId: string): string {
  return `/dashboard/norms/meter/${meterId}`
}

/** URL tuyệt đối in lên tem (cùng domain cố định với tem thiết bị). */
export function buildNormMeterUrl(meterId: string): string {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || EQUIPMENT_QR_DEFAULT_ORIGIN).replace(/\/+$/, "")
  return `${origin}${buildNormMeterPath(meterId)}`
}

/** Nhận diện QR tem đồng hồ: trả meter id hoặc null. */
export function parseNormMeterQr(text: string): string | null {
  const m = String(text || "").match(/\/dashboard\/norms\/meter\/([0-9a-f-]{36})/i)
  return m ? m[1] : null
}
