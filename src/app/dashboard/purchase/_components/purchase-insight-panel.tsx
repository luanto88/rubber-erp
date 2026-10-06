"use client"

import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, History, Loader2, TrendingDown } from "lucide-react"
import {
  formatMoney, formatQty, formatSoPhieuFull, insightDaysLeft, insightWarnings, PURCHASE_STATUS_LABEL,
  type PurchaseItemInsight,
} from "@/lib/purchase/types"

// Panel "tồn kho / tiêu hao / lần mua trước" của 1 vật tư — dùng chung cho:
//  - form lập phiếu (số liệu SỐNG, tải khi chọn vật tư),
//  - trang chi tiết phiếu + màn ký (BẢN CHỤP lúc gửi ký — `capturedAt` có giá trị).

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : iso
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })
}

function MovementList({ rows, color, unit }: { rows: { ngay: string; soLuong: number }[]; color: string; unit: string | null }) {
  if (rows.length === 0) return <p className="text-slate-400">Chưa có</p>
  return (
    <ul className="space-y-0.5">
      {rows.map((r, i) => (
        <li key={i} className="flex items-baseline justify-between gap-2">
          <span className="text-slate-500">{fmtDate(r.ngay)}:</span>
          <span className={`font-bold ${color}`}>
            {Number.isFinite(r.soLuong) ? <>{formatQty(r.soLuong)} <span className="font-normal text-slate-500">{unit}</span></> : "—"}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PurchaseInsightPanel({
  insight,
  unit,
  loading = false,
  capturedAt = null,
  compact = false,
}: {
  insight: PurchaseItemInsight | null
  unit: string | null
  loading?: boolean
  /** Có giá trị → đây là bản chụp lúc gửi ký: hiện mốc thời gian + cảnh báo nổi bật. */
  capturedAt?: string | null
  /** Khung hẹp (ngăn kéo màn ký): tối đa 2 cột thẻ, không theo breakpoint màn hình. */
  compact?: boolean
}) {
  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-slate-500 rounded-b-lg bg-sky-50/60 border-l-4 border-sky-200 p-3"><Loader2 size={12} className="animate-spin" /> Đang tải thông tin vật tư...</div>
  }
  const ins = insight
  if (!ins) return null
  const daysLeft = insightDaysLeft(ins)
  // Dữ liệu cũ (API chưa trả recent*) → dựng 1 dòng từ ngày gần nhất, không có số lượng.
  const imports = ins.recentImports ?? (ins.lastImportDate ? [{ ngay: ins.lastImportDate, soLuong: NaN }] : [])
  const exports = ins.recentExports ?? (ins.lastExportDate ? [{ ngay: ins.lastExportDate, soLuong: NaN }] : [])
  const warnings = capturedAt ? insightWarnings(ins) : []
  return (
    <div className="rounded-b-lg bg-sky-50/60 border-l-4 border-sky-200 p-3 space-y-3 text-xs">
      {capturedAt && (
        <p className="text-[11px] text-slate-500">
          Số liệu chụp lúc gửi ký <span className="font-semibold text-slate-700">{fmtDateTime(capturedAt)}</span> — không đổi theo kho sau đó.
        </p>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-red-700 font-semibold space-y-0.5">
          {warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{w}</p>
          ))}
        </div>
      )}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${compact ? "" : "lg:grid-cols-4"}`}>
        <div className="rounded-lg bg-white border border-slate-200 border-l-4 border-l-emerald-500 p-2.5 shadow-sm">
          <p className="flex items-center gap-1.5 font-bold text-emerald-700"><Boxes size={13} /> Tồn thực tế</p>
          <p className="mt-1 text-xl font-extrabold text-slate-800">{formatQty(ins.totalStock)} <span className="text-xs font-normal text-slate-500">{unit}</span></p>
          {ins.stock.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {ins.stock.map((s) => (
                <span key={s.warehouseId} className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] text-emerald-800">
                  <span className="font-semibold">{s.code || s.name}</span>: {formatQty(s.onHand)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg bg-white border border-slate-200 border-l-4 border-l-sky-500 p-2.5 shadow-sm">
          <p className="flex items-center gap-1.5 font-bold text-sky-700 mb-1"><ArrowDownToLine size={13} /> Nhập kho (3 lần gần nhất)</p>
          <MovementList rows={imports} color="text-sky-800" unit={unit} />
        </div>
        <div className="rounded-lg bg-white border border-slate-200 border-l-4 border-l-amber-500 p-2.5 shadow-sm">
          <p className="flex items-center gap-1.5 font-bold text-amber-700 mb-1"><ArrowUpFromLine size={13} /> Xuất dùng (3 lần gần nhất)</p>
          <MovementList rows={exports} color="text-amber-800" unit={unit} />
        </div>
        <div className="rounded-lg bg-white border border-slate-200 border-l-4 border-l-violet-500 p-2.5 shadow-sm">
          <p className="flex items-center gap-1.5 font-bold text-violet-700"><TrendingDown size={13} /> Tiêu hao 90 ngày</p>
          <p className="mt-1 text-xl font-extrabold text-slate-800">{formatQty(ins.export90)} <span className="text-xs font-normal text-slate-500">{unit}</span></p>
          {daysLeft !== null && <p className={daysLeft <= 14 ? "text-red-600 font-semibold" : "text-slate-500"}>Đủ dùng ~{daysLeft} ngày</p>}
        </div>
      </div>
      <div className="rounded-lg bg-white border border-slate-200 p-2.5">
        <p className="font-bold text-slate-700 text-[13px] mb-1.5 flex items-center gap-1.5"><History size={14} className="text-slate-500" /> 5 lần đề nghị mua đã duyệt gần nhất</p>
        {ins.recentPurchases.length === 0 ? (
          <p className="text-slate-400">Chưa có lần mua nào được duyệt qua hệ thống.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-500"><th className="text-left py-0.5">Ngày</th><th className="text-left">Phiếu</th><th className="text-right">SL</th><th className="text-right">Đơn giá</th></tr></thead>
              <tbody>
                {ins.recentPurchases.map((p, i) => (
                  <tr key={i} className="border-t border-slate-200">
                    <td className="py-0.5">{fmtDate(p.ngay)}</td>
                    <td>{formatSoPhieuFull(p.so, p.nam)}</td>
                    <td className="text-right">{formatQty(p.soLuong)}</td>
                    <td className="text-right">{formatMoney(p.donGia, p.loaiTien)} {p.loaiTien}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!capturedAt && ins.openRequests.length > 0 && (
        <p className="flex items-start gap-1.5 text-amber-700 font-semibold">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          Vật tư này đang có trong phiếu đề nghị khác chưa hoàn tất:{" "}
          {ins.openRequests.map((r) => `${formatSoPhieuFull(r.so, r.nam)} (${PURCHASE_STATUS_LABEL[r.trangThai as keyof typeof PURCHASE_STATUS_LABEL] || r.trangThai}, SL ${formatQty(r.soLuong)})`).join("; ")}
        </p>
      )}
      {capturedAt && ins.openRequests.length > 0 && (
        <p className="text-slate-600">
          Phiếu khác còn mở lúc gửi ký:{" "}
          {ins.openRequests.map((r) => `${formatSoPhieuFull(r.so, r.nam)} (${PURCHASE_STATUS_LABEL[r.trangThai as keyof typeof PURCHASE_STATUS_LABEL] || r.trangThai}, SL ${formatQty(r.soLuong)})`).join("; ")}
        </p>
      )}
    </div>
  )
}
