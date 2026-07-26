export function getTodayISODate() {
  return new Date().toISOString().slice(0, 10)
}

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function isValidDateParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (year < 1900 || year > 9999) return false
  if (month < 1 || month > 12) return false
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  return day >= 1 && day <= daysInMonth[month - 1]
}

export function normalizeDateInput(value: string | null | undefined) {
  const raw = String(value ?? "").trim()
  if (!raw) return ""

  const isoDateTimeMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s].*$/)
  if (isoDateTimeMatch) {
    const year = Number(isoDateTimeMatch[1])
    const month = Number(isoDateTimeMatch[2])
    const day = Number(isoDateTimeMatch[3])
    if (!isValidDateParts(year, month, day)) return ""
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    if (!isValidDateParts(year, month, day)) return ""
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
  }

  const displayMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (displayMatch) {
    const day = Number(displayMatch[1])
    const month = Number(displayMatch[2])
    const year = Number(displayMatch[3])
    if (!isValidDateParts(year, month, day)) return ""
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
  }

  return ""
}

export function getDateParts(value: string | null | undefined) {
  const iso = normalizeDateInput(value)
  if (!iso) return null
  const [year, month, day] = iso.split("-")
  return {
    iso,
    year,
    month,
    day,
    yearNumber: Number(year),
    monthNumber: Number(month),
    dayNumber: Number(day),
  }
}

export function formatDateDisplay(value: string | null | undefined) {
  const parts = getDateParts(value)
  if (!parts) return ""
  return `${parts.day}/${parts.month}/${parts.year}`
}

export function isDateInRange(date: string, fromDate?: string | null, toDate?: string | null) {
  const iso = normalizeDateInput(date)
  const from = normalizeDateInput(fromDate)
  const to = normalizeDateInput(toDate)
  if (!iso) return false
  if (from && iso < from) return false
  if (to && iso > to) return false
  return true
}

export function addDaysISO(dateISO: string, days: number): string {
  const parts = getDateParts(dateISO)
  if (!parts) return dateISO
  const d = new Date(Date.UTC(parts.yearNumber, parts.monthNumber - 1, parts.dayNumber))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Thứ Hai của tuần chứa `dateISO` (mặc định hôm nay) — quy ước tuần bắt đầu Thứ Hai (ISO week),
// tính bằng thành phần năm/tháng/ngày UTC để tránh lệch múi giờ (đồng bộ getTodayISODate()).
export function getIsoWeekStart(dateISO?: string): string {
  const iso = dateISO ? normalizeDateInput(dateISO) : getTodayISODate()
  const parts = getDateParts(iso)
  if (!parts) return getTodayISODate()
  const d = new Date(Date.UTC(parts.yearNumber, parts.monthNumber - 1, parts.dayNumber))
  const dow = d.getUTCDay() || 7 // Chủ nhật (0) -> 7
  if (dow !== 1) d.setUTCDate(d.getUTCDate() - (dow - 1))
  return d.toISOString().slice(0, 10)
}

export function formatWeekRangeLabel(weekStartISO: string): string {
  const end = addDaysISO(weekStartISO, 6)
  return `${formatDateDisplay(weekStartISO)} — ${formatDateDisplay(end)}`
}
