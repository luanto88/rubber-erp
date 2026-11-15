// Kho vật tư — báo cáo sử dụng theo ngày: lớp CSS + chuẩn hoá lỗi dùng chung. Rule 13.
import { getErrorMessage } from "@/lib/error-message"

export const inputCls =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-mod-600 focus:ring-2 focus:ring-mod-200 disabled:bg-slate-50 disabled:text-slate-500"
export const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
export const btnPrimaryCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"

const MIGRATION_HINT = "Kiểm tra đã chạy migration 20261125_inventory_daily_reports.sql chưa."

export function dailyErrText(e: unknown, fallback: string): string {
  const msg = getErrorMessage(e, fallback)
  const m = msg.match(/(?:INV|NORM)_[A-Z_]+:\s*([\s\S]*)$/)
  if (m) return m[1]
  if (/inventory_daily_report|inventory_legacy_movements|schema cache|does not exist/i.test(msg)) return `${fallback} ${MIGRATION_HINT}`
  return msg
}

/** Tháng hiện tại → [ngày 1, ngày cuối] (theo giờ nhà máy truyền vào dạng yyyy-mm-dd). */
export function monthRange(todayIso: string, offset = 0): { from: string; to: string } {
  const [y, m] = todayIso.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + offset, 1))
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
  return { from: d.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
}
