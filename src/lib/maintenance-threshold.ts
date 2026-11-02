// Ngưỡng phân loại sửa chữa Lớn / Nhỏ (USD) — cấu hình theo nhà máy (factories.nguong_sua_chua_lon,
// Cài đặt → Bảo trì). Module THUẦN (không import gì) để dùng chung ở client (form biên bản, PDF) lẫn
// server (đồng bộ giá). Lớn/Nhỏ luôn tự tính theo ngưỡng này, không ai chọn tay (kể cả admin).
// Client gọi setRepairThresholdUsd() 1 lần lúc bootstrap trang (giống setCurrencyRates).

export const DEFAULT_REPAIR_THRESHOLD_USD = 200

let currentThresholdUsd = DEFAULT_REPAIR_THRESHOLD_USD

/** Giá trị hợp lệ (> 0) hoặc mặc định 200. */
export function normalizeRepairThreshold(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REPAIR_THRESHOLD_USD
}

export function setRepairThresholdUsd(value: unknown) {
  currentThresholdUsd = normalizeRepairThreshold(value)
}

export function getRepairThresholdUsd(): number {
  return currentThresholdUsd
}

/** Tổng quy USD > ngưỡng ⇒ Lớn. */
export function classifyRepairByUsd(usd: number, thresholdUsd: number = currentThresholdUsd): "lon" | "nho" {
  return usd > thresholdUsd ? "lon" : "nho"
}

export function formatRepairThreshold(thresholdUsd: number = currentThresholdUsd): string {
  return `${thresholdUsd.toLocaleString("vi-VN")}$`
}
