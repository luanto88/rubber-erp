"use client"

import { useEffect, useState } from "react"
import { Loader2, Send } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { fetchApprovers, type ApproversResponse } from "./purchase-client"

const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
const labelCls = "text-xs font-bold text-slate-600 block mb-1"

/**
 * Panel "Gửi ký duyệt": chọn Giám đốc / Kế toán ngay khi gửi (thay vì báo lỗi rồi bắt vào Sửa phiếu).
 * Giá trị đầu = người đã lưu trên phiếu, trống thì lấy gợi ý mặc định theo chức vụ (/api/purchase/approvers).
 */
export function PurchaseApproverModal({
  soPhieu, userId, initialGiamDocId, initialKeToanId, takeOver, busy, error, onClose, onConfirm,
}: {
  soPhieu: string
  /** Người sẽ đứng tên đề nghị (ký bước 1) — không được chọn làm người duyệt. */
  userId: string
  initialGiamDocId: string | null
  initialKeToanId: string | null
  /** Phiếu từ biên bản, người xem chưa là người đề nghị: gửi = nhận xử lý. */
  takeOver: boolean
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (giamDocId: string, keToanId: string) => void
}) {
  const [approvers, setApprovers] = useState<ApproversResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [giamDocId, setGiamDocId] = useState(initialGiamDocId || "")
  const [keToanId, setKeToanId] = useState(initialKeToanId || "")

  useEffect(() => {
    let alive = true
    fetchApprovers()
      .then((a) => {
        if (!alive) return
        setApprovers(a)
        // Gợi ý mặc định chỉ điền ô còn trống, bỏ qua nếu trùng chính người đề nghị.
        setGiamDocId((cur) => cur || (a.defaultGiamDocId && a.defaultGiamDocId !== userId ? a.defaultGiamDocId : ""))
        setKeToanId((cur) => cur || (a.defaultKeToanId && a.defaultKeToanId !== userId ? a.defaultKeToanId : ""))
      })
      .catch((err) => { if (alive) setLoadError(err instanceof Error ? err.message : "Không tải được danh sách người ký") })
    return () => { alive = false }
  }, [userId])

  const invalid =
    !giamDocId || !keToanId ? "Chọn đủ Giám đốc và Kế toán." :
    giamDocId === keToanId ? "Giám đốc và Kế toán phải là 2 người khác nhau." :
    giamDocId === userId || keToanId === userId ? "Người đề nghị không được đồng thời là người duyệt." : null

  return (
    <ModalShell
      title={`Gửi ký duyệt phiếu ${soPhieu}`}
      onClose={() => { if (!busy) onClose() }}
      maxWidth="md"
      footer={
        <>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Đóng</button>
          <button
            onClick={() => onConfirm(giamDocId, keToanId)}
            disabled={busy || !approvers || !!invalid}
            className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Lưu & gửi ký duyệt
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Chọn người ký theo thứ tự: <b>Người đề nghị → Giám đốc → Kế toán</b>.
          {takeOver && " Bạn sẽ nhận xử lý phiếu này: đứng tên người đề nghị, ký bước 1 và ghi nhận mua."}
        </p>
        {loadError && <p className="text-sm font-semibold text-red-600">{loadError}</p>}
        {!approvers && !loadError ? (
          <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Đang tải danh sách người ký...</div>
        ) : approvers && (
          <>
            <div>
              <label className={labelCls}>Giám đốc nhà máy *</label>
              <select className={inputCls} value={giamDocId} onChange={(e) => setGiamDocId(e.target.value)}>
                <option value="">— Chọn —</option>
                {approvers.giamDoc.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.id === userId}>{a.full_name} — {a.chuc_vu}</option>
                ))}
              </select>
              {approvers.giamDocFallback && <p className="text-[11px] text-amber-600 mt-1">Không tìm thấy lãnh đạo thuộc NMCB — đang hiện toàn nhà máy.</p>}
            </div>
            <div>
              <label className={labelCls}>Kế toán *</label>
              <select className={inputCls} value={keToanId} onChange={(e) => setKeToanId(e.target.value)}>
                <option value="">— Chọn —</option>
                {approvers.keToan.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.id === userId}>{a.full_name} — {a.chuc_vu}</option>
                ))}
              </select>
              {approvers.keToanFallback && <p className="text-[11px] text-amber-600 mt-1">Không tìm thấy kế toán thuộc NMCB — đang hiện toàn nhà máy.</p>}
            </div>
          </>
        )}
        {invalid && approvers && <p className="text-xs font-semibold text-amber-700">{invalid}</p>}
        {error && <p className="whitespace-pre-line text-sm font-semibold text-red-600">{error}</p>}
      </div>
    </ModalShell>
  )
}
