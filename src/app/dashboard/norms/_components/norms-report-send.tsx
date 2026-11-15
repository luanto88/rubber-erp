"use client"

// Định mức KTKT GĐ4 — hộp "Gửi ký" báo cáo kỳ (dùng chung form lập bộ + trang chi tiết). Rule 30.
// Mặc định ký 2 người: Người lập (người đang tạo, đổi được sang người có quyền lập báo cáo) → Ban giám đốc
// (Giám đốc tick "Người ký mặc định"). Cần nhiều người ký ⇒ "Ký nhiều bước qua Văn bản nội bộ" (1 mẫu).

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FileStack, Send } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { fetchNormApprovers, sendReportToVanBan, submitReportForSigning, type NormApprovers } from "@/lib/norms/report-client"
import { overLines } from "@/lib/norms/report-templates"
import type { NormReport, NormReportSnapshot } from "@/lib/norms/report-types"
import { btnCls, btnPrimaryCls, errText, inputCls } from "./norms-ui"

export function NormsReportSendDialog({
  reports,
  snapshot,
  onClose,
  onDone,
}: {
  reports: NormReport[]
  snapshot: NormReportSnapshot
  onClose: () => void
  onDone: (result: { yeuCauIds: string[]; docId?: string }) => void
}) {
  const router = useRouter()
  const [ap, setAp] = useState<NormApprovers | null>(null)
  const [nguoiLapId, setNguoiLapId] = useState("")
  const [bgdId, setBgdId] = useState("")
  const [soText, setSoText] = useState("")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const single = reports.length === 1 ? reports[0] : null

  useEffect(() => {
    void (async () => {
      try {
        const a = await fetchNormApprovers()
        setAp(a)
        setNguoiLapId((reports[0]?.nguoi_lap_id as string) || a.defaultNguoiLapId)
        setBgdId((reports[0]?.bgd_id as string) || a.defaultBgdId || "")
      } catch (e) {
        setError(errText(e, "Không tải được danh sách người ký."))
      }
    })()
  }, [reports])

  const missing = useMemo(() => {
    const over = overLines(snapshot)
    return reports
      .filter((r) => r.template_kieu === "thang_8a")
      .flatMap((r) => over.filter((l) => !String(r.giai_trinh?.[l.key] || "").trim()).map((l) => `${r.template_code}: ${l.itemName}`))
  }, [reports, snapshot])

  const nguoiLap = ap?.nguoiLap.find((p) => p.id === nguoiLapId) || null
  const bgd = ap?.bgd.find((p) => p.id === bgdId) || null
  const so = soText.trim() ? Math.trunc(Number(soText.trim())) : null
  const soInvalid = soText.trim() !== "" && !(so && so >= 1)
  const blocked = !nguoiLap || !bgd || nguoiLapId === bgdId || soInvalid || missing.length > 0

  const send = async () => {
    if (!nguoiLap || !bgd) return
    setBusy(true)
    setError(null)
    const ids: string[] = []
    const log: string[] = []
    try {
      for (const r of reports) {
        log.push(`Đang gửi ${r.template_code}…`)
        setProgress([...log])
        const id = await submitReportForSigning(r, snapshot, { nguoiLap, bgd, so: single ? so : null })
        ids.push(id)
        log[log.length - 1] = `${r.template_code}: đã gửi ký`
        setProgress([...log])
      }
      onDone({ yeuCauIds: ids })
    } catch (e) {
      setError(errText(e, "Gửi ký thất bại."))
      if (ids.length) onDone({ yeuCauIds: ids })
    } finally {
      setBusy(false)
    }
  }

  const toVanBan = async () => {
    if (!single || !nguoiLap || !bgd) return
    setBusy(true)
    setError(null)
    try {
      const docId = await sendReportToVanBan(single, snapshot, { nguoiLap, bgd, so })
      onDone({ yeuCauIds: [], docId })
      router.push(`/dashboard/documents/${docId}`)
    } catch (e) {
      setError(errText(e, "Không tạo được văn bản nội bộ."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title={single ? `Gửi ký ${single.template_code}` : `Gửi ký ${reports.length} mẫu báo cáo`}
      onClose={() => !busy && onClose()}
      maxWidth="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={btnCls} disabled={busy} onClick={onClose}>
            Để sau
          </button>
          {single && (
            <button type="button" className={btnCls} disabled={busy || blocked} onClick={() => void toVanBan()} title="Tạo văn bản nội bộ nháp (đúng số báo cáo) để thêm nhiều bước ký">
              <FileStack size={15} /> Ký nhiều bước qua Văn bản nội bộ
            </button>
          )}
          <button type="button" className={btnPrimaryCls} disabled={busy || blocked} onClick={() => void send()}>
            <Send size={15} /> {busy ? "Đang gửi…" : `Gửi ký${reports.length > 1 ? ` ${reports.length} mẫu` : ""}`}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Ký 2 bước: <b>Người lập</b> ký trước, <b>Ban giám đốc</b> phê duyệt cuối. Số báo cáo cấp theo dãy Văn bản nội bộ (BC-NMCB) lúc gửi.
          Mẫu 8A / 09 đang ký hoặc đã ký sẽ <b>khoá</b> nhập liệu (đồng hồ, kiểm kê, bỏ tick xuất kho) của kỳ đó.
        </p>
        {!ap && !error && <p className="text-slate-500">Đang tải người ký…</p>}
        {ap && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-600">Người lập (ký bước 1) *</span>
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
            {single && (
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Số báo cáo (bỏ trống = tự cấp số kế tiếp)</span>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={soText}
                  placeholder={single.ma_bao_cao || "Tự cấp, vd 54"}
                  onChange={(e) => setSoText(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </label>
            )}
          </div>
        )}
        {nguoiLapId && nguoiLapId === bgdId && <p className="font-semibold text-red-700">Người lập và Ban giám đốc phải là 2 người khác nhau.</p>}
        {missing.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-800">
            <b>Chưa giải trình dòng vượt định mức (bắt buộc):</b> {missing.join("; ")}
          </div>
        )}
        {progress.map((p) => (
          <div key={p} className="text-xs text-slate-600">
            {p}
          </div>
        ))}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 font-semibold text-red-800">{error}</div>}
      </div>
    </ModalShell>
  )
}
