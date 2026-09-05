// ⚠️ Hàm này tính ngày theo UTC — sai 1 ngày với thao tác diễn ra trong khoảng 00:00–06:59 sáng
// giờ địa phương (UTC+7). CỐ Ý KHÔNG sửa: đang được module KPI dùng để so ngày, đổi ở đây sẽ
// thay đổi hành vi ngoài phạm vi. Code MỚI cần ngày "hôm nay" theo giờ nhà máy phải dùng
// getFactoryTodayISO() bên dưới.
export function getTodayISODate() {
  return new Date().toISOString().slice(0, 10)
}

// ── Ngày theo múi giờ nhà máy ────────────────────────────────────────────────
// Nhà máy đặt tại Kampong Thom (Campuchia) — cùng múi UTC+7 với Việt Nam. Server chạy trên
// Vercel dùng UTC, nên mọi chỗ cần "ngày hôm nay" theo nghiệp vụ (ngày phê duyệt, ngày in lên
// chứng từ...) PHẢI quy đổi qua múi giờ này; nếu không, thao tác lúc 00:00–06:59 sáng sẽ bị ghi
// nhận thành ngày hôm trước.
export const FACTORY_TIME_ZONE = "Asia/Ho_Chi_Minh"

/** `YYYY-MM-DD` theo giờ nhà máy — dùng thay `getTodayISODate()` cho dữ liệu nghiệp vụ. */
export function getFactoryTodayISO(d: Date = new Date()): string {
  // "en-CA" cho ra sẵn định dạng YYYY-MM-DD, không phải tự ghép chuỗi.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FACTORY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

/** `dd/mm/yyyy` theo giờ nhà máy — dùng cho ngày in lên PDF / thay tag Office. */
export function formatFactoryDateVN(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: FACTORY_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d)
}

/**
 * `dd/mm/yyyy hh:mm:ss` theo giờ nhà máy — dùng cho tag "Văn bản được ký ..." đóng lên PDF.
 * Cần tới giây nên KHÔNG dùng lại `formatFactoryDateVN()`; `en-GB` cho ra sẵn khung 24h
 * `dd/mm/yyyy, hh:mm:ss`, chỉ cần bỏ dấu phẩy ngăn cách.
 */
export function formatFactoryDateTimeVN(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: FACTORY_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(",", "")
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

  const dashMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (dashMatch) {
    const day = Number(dashMatch[1])
    const month = Number(dashMatch[2])
    const year = Number(dashMatch[3])
    if (!isValidDateParts(year, month, day)) return ""
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
  }

  const digits8Match = raw.match(/^(\d{2})(\d{2})(\d{4})$/)
  if (digits8Match) {
    const day = Number(digits8Match[1])
    const month = Number(digits8Match[2])
    const year = Number(digits8Match[3])
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

// Ngày đầu tháng chứa `dateISO` (mặc định hôm nay) — dùng làm giá trị mặc định cho bộ lọc
// "Từ ngày" của các báo cáo theo kỳ.
export function getFirstDayOfMonthISO(dateISO?: string): string {
  const iso = dateISO ? normalizeDateInput(dateISO) : getTodayISODate()
  const parts = getDateParts(iso)
  if (!parts) return getTodayISODate()
  return `${parts.year}-${parts.month}-01`
}
