export const STORAGE_STATUS_RECEIVING = "Đang nhận"
export const STORAGE_STATUS_CLOSED = "Đóng"
export const STORAGE_STATUS_WAITING = "Chờ sản xuất"
export const STORAGE_STATUS_IN_PRODUCTION = "Đang sản xuất"
export const STORAGE_STATUS_PRODUCED = "Đã sản xuất"

const LEGACY_RECEIVING_STATUS = "Đang nhận (Cần cập nhật)"

export function normalizeStorageStatus(value?: string | null) {
  const status = String(value || "").trim()
  if (!status) return ""
  if (status === LEGACY_RECEIVING_STATUS) return STORAGE_STATUS_RECEIVING
  return status
}

export function getStorageAgingDays(ngayBd?: string | null, nowMs = Date.now()) {
  const value = String(ngayBd || "").trim()
  if (!value) return null
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return null
  return Math.floor((nowMs - time) / 86400000)
}

export function deriveStorageStatus(params: {
  ngayBd?: string | null
  ngayKt?: string | null
  current?: string | null
  nowMs?: number
}) {
  const current = normalizeStorageStatus(params.current)
  const agingDays = getStorageAgingDays(params.ngayBd, params.nowMs)
  const hasNgayBd = Boolean(String(params.ngayBd || "").trim())
  const hasNgayKt = Boolean(String(params.ngayKt || "").trim())

  if (current === STORAGE_STATUS_PRODUCED || current === STORAGE_STATUS_IN_PRODUCTION) {
    return current
  }

  if (!hasNgayBd) return current || STORAGE_STATUS_RECEIVING
  if (!hasNgayKt) return STORAGE_STATUS_RECEIVING
  if (agingDays !== null && agingDays >= 21) return STORAGE_STATUS_WAITING
  if (current === STORAGE_STATUS_WAITING && agingDays !== null && agingDays >= 6) {
    return STORAGE_STATUS_WAITING
  }
  return STORAGE_STATUS_CLOSED
}

export function canManuallyMoveClosedToWaiting(
  ngayBd?: string | null,
  nowMs = Date.now(),
) {
  const agingDays = getStorageAgingDays(ngayBd, nowMs)
  return agingDays !== null && agingDays >= 6
}

export function isProductSelectableStorageStatus(status?: string | null) {
  const normalized = normalizeStorageStatus(status)
  return (
    normalized === STORAGE_STATUS_WAITING ||
    normalized === STORAGE_STATUS_IN_PRODUCTION
  )
}

const STORAGE_STATUS_LABEL_EN: Record<string, string> = {
  [STORAGE_STATUS_RECEIVING]: "Receiving",
  [STORAGE_STATUS_CLOSED]: "Closed",
  [STORAGE_STATUS_WAITING]: "Awaiting production",
  [STORAGE_STATUS_IN_PRODUCTION]: "In production",
  [STORAGE_STATUS_PRODUCED]: "Produced",
}

export function getStorageStatusLabelEn(status?: string | null) {
  const normalized = normalizeStorageStatus(status)
  return STORAGE_STATUS_LABEL_EN[normalized] || (normalized ? normalized : "Unknown")
}

export type StorageStatusTheme = {
  badge: string
  dot: string
  gradient: string
}

export function getStorageStatusTheme(status?: string | null): StorageStatusTheme {
  const normalized = normalizeStorageStatus(status)
  if (normalized === STORAGE_STATUS_IN_PRODUCTION) {
    return { badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", gradient: "from-emerald-50 via-white to-teal-50" }
  }
  if (normalized === STORAGE_STATUS_PRODUCED) {
    return { badge: "bg-blue-100 text-blue-700", dot: "bg-blue-500", gradient: "from-blue-50 via-white to-cyan-50" }
  }
  if (normalized === STORAGE_STATUS_WAITING) {
    return { badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500", gradient: "from-amber-50 via-white to-yellow-50" }
  }
  if (normalized === STORAGE_STATUS_CLOSED) {
    return { badge: "bg-rose-100 text-rose-700", dot: "bg-rose-500", gradient: "from-rose-50 via-white to-orange-50" }
  }
  if (normalized === STORAGE_STATUS_RECEIVING) {
    return { badge: "bg-slate-100 text-slate-600", dot: "bg-slate-400", gradient: "from-slate-50 via-white to-gray-100" }
  }
  return { badge: "bg-slate-100 text-slate-600", dot: "bg-slate-400", gradient: "from-slate-50 via-white to-gray-100" }
}
