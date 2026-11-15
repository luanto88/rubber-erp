"use client"

// Kho vật tư — hộp "Gửi ký" báo cáo sử dụng theo ngày: Người lập (mặc định người đang lập) ký trước → Ban giám đốc
// (Giám đốc tick "Người ký mặc định") phê duyệt. Số BC-NMCB cấp lúc gửi (bỏ trống = số kế tiếp). Rule 13.

import { useEffect, useState } from "react"
import { Send } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { fetchDailyApprovers, submitDailyReportForSigning, type ReportApprovers } from "@/lib/inventory-daily-report/client"
import type { DailyReport } from "@/lib/inventory-daily-report/types"
import { btnCls, btnPrimaryCls, dailyErrText, inputCls } from "./daily-ui"

export function DailyReportSendDialog({ report, onClose, onDone }: { report: DailyReport; onClose: () => void; onDone: (yeuCauId: string) => void }) {
  const [ap, setAp] = useState<ReportApprovers | null>(null)
  const [nguoiLapId, setNguoiLapId] = useState("")
  const [bgdId, setBgdId] = useState("")
  const [soText, setSoText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const a = await fetchDailyApprovers()
        setAp(a)
        setNguoiLapId(report.nguoi_lap_id || a.defaultNguoiLapId)
        setBgdId(report.bgd_id || a.defaultBgdId || "")
      } catch (e) {
        setError(dailyErrText(e, "Không tải được danh sách người ký."))
      }
    })()
  }, [report])

  const nguoiLap = ap?.nguoiLap.find((p) => p.id === nguoiLapId) || null
  const bgd = ap?.bgd.find((p) => p.id === bgdId) || null
  const so = soText.trim() ? Math.trunc(Number(soText.trim())) : null
  const soInvalid = soText.trim() !== "" && !(so && so >= 1)
  const blocked = !nguoiLap || !bgd || nguoiLapId === bgdId || soInvalid

  const send = async () => {
    if (!nguoiLap || !bgd) return
    setBusy(true)
    setError(null)
    try {
      onDone(await submitDailyReportForSigning(report, { nguoiLap, bgd, so }))
    } catch (e) {
      setError(dailyErrText(e, "Gửi ký thất bại."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title={`Gửi ký ${report.template_name}`}
      onClose={() => !busy && onClose()}
      maxWidth="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={btnCls} disabled={busy} onClick={onClose}>
            Để sau
          </button>
          <button type="button" className={btnPrimaryCls} disabled={busy || blocked} onClick={() => void send()}>
            <Send size={15} /> {busy ? "Đang gửi…" : "Gửi ký"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Ký 2 bước: <b>Người lập bảng</b> ký trước, <b>Ban giám đốc</b> phê duyệt cuối. Số báo cáo cấp theo dãy BC-NMCB (chung Văn bản nội bộ) lúc gửi.
        </p>
        {!ap && !error && <p className="text-slate-500">Đang tải người ký…</p>}
        {ap && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-600">Người lập bảng (ký bước 1) *</span>
              <select className={inputCls} value={nguoiLapId} onChange={(e) => setNguoiLapId(e.target.value)}>
                <option value="">— Chọn —</option>
                {ap.nguoiLap.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                    {p.chuc_vu ? ` — ${p.chuc_vu}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-600">Ban giám đốc (phê duyệt) *</span>
              <select className={inputCls} value={bgdId} onChange={(e) => setBgdId(e.target.value)}>
                <option value="">— Chọn —</option>
                {ap.bgd.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} — {p.chuc_vu}
                  </option>
                ))}
              </select>
              {ap.bgdFallback && <span className="block text-[11px] text-amber-700">Không có Giám đốc thuộc NMCB — đang liệt kê toàn nhà máy.</span>}
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-slate-600">Số báo cáo (bỏ trống = tự cấp số kế tiếp)</span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={soText}
                placeholder={report.ma_bao_cao || "Tự cấp, vd 55"}
                onChange={(e) => setSoText(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </label>
          </div>
        )}
        {nguoiLapId && nguoiLapId === bgdId && <p className="font-semibold text-red-700">Người lập và Ban giám đốc phải là 2 người khác nhau.</p>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 font-semibold text-red-800">{error}</div>}
      </div>
    </ModalShell>
  )
}
