// Hằng số & helper tiền tệ dùng chung — trước đây định nghĩa cục bộ/rải rác trong module Bảo trì
// (`CURRENCIES` chỉ có trong records/[id]/page.tsx, `currencySymbol` chỉ export từ
// maintenance-data.ts, tỷ giá quy USD viết tay inline trong suggestLoaiSuaChua). Tách ra đây để
// module Kho vật tư (Đơn giá cho inventory_items) và Bảo trì dùng chung 1 nguồn, tránh lệch tỷ
// giá về sau. Xem .claude/rules/14-maintenance-module.md.

export const CURRENCIES = ["USD", "KHR", "VND"] as const
export type CurrencyCode = (typeof CURRENCIES)[number]

// Tỷ giá quy đổi ra USD — giữ đúng số liệu đang dùng trong suggestLoaiSuaChua trước khi tách
// (KHR÷4100, VND÷25000). Lưu ý: khác với số liệu cũ đã lỗi thời trong
// .claude/rules/14-maintenance-module.md (4000/26500) — số ở đây là số THẬT đang chạy trong code.
const USD_RATE: Record<string, number> = { USD: 1, KHR: 4100, VND: 25000 }

export function currencySymbol(loaiTien: string): string {
  if (loaiTien === "KHR") return "៛"
  if (loaiTien === "VND") return "₫"
  return "$"
}

function toUsd(amount: number, currency: string): number {
  const rate = USD_RATE[currency]
  if (!rate) return 0
  return amount / rate
}

function fromUsd(usdAmount: number, currency: string): number {
  const rate = USD_RATE[currency]
  if (!rate) return usdAmount
  return usdAmount * rate
}

/** Quy đổi `amount` từ `from` sang `to`, đi qua USD làm trung gian. */
export function convertCurrency(amount: number, from: string, to: string): number {
  if (from === to) return amount
  return fromUsd(toUsd(amount, from), to)
}
