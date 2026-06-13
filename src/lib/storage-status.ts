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
