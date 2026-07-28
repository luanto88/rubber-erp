"use client"

// Banner "Đăng ký người thay thế đang chờ bạn duyệt" — dùng chung ở cả /dashboard/kpi/tasks
// (nhân viên thường, chỉ tự đăng ký cho chính mình) và /dashboard/kpi/templates (lãnh đạo/admin
// quản lý toàn bộ). Mirror đúng UX banner "lời mời chuyển giao" đã có ở
// kpi/tasks/[id]/page.tsx — luôn cần CHÍNH người bị ảnh hưởng bấm Đồng ý/Từ chối, không tự động.
// Xem đầy đủ .claude/rules/27-kpi-module.md, mục "Phase C".

import { useState } from "react"
import { Check, UserCog, X } from "lucide-react"
import {
  approveKpiUserSubstitution,
  rejectKpiUserSubstitution,
  type KpiUserSubstitution,
} from "@/lib/kpi-templates"
import { getKpiErrorMessage, formatKpiDateTime } from "@/lib/kpi-tasks"

type PendingSubstitutionsBannerProps = {
  items: KpiUserSubstitution[]
  resolveName: (uid: string) => string
  onChanged: () => void
}

export function PendingSubstitutionsBanner({ items, resolveName, onChanged }: PendingSubstitutionsBannerProps) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<KpiUserSubstitution | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (items.length === 0) return null

  const handleApprove = async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      await approveKpiUserSubstitution(id)
      onChanged()
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không duyệt được đăng ký này."))
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async () => {
    if (!rejectTarget) return
    setBusyId(rejectTarget.id)
    setError(null)
    try {
      await rejectKpiUserSubstitution(rejectTarget.id, rejectReason)
      setRejectTarget(null)
      setRejectReason("")
      onChanged()
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không từ chối được đăng ký này."))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 space-y-2.5">
      <div className="flex items-center gap-2 text-sm font-extrabold text-amber-800">
        <UserCog size={16} /> Đăng ký người thay thế đang chờ bạn duyệt ({items.length})
      </div>
      {error && <div className="text-xs font-semibold text-red-600">{error}</div>}
      {items.map((s) => (
        <div key={s.id} className="rounded-xl bg-white border border-amber-200 p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div>
              <strong className="text-slate-700">{resolveName(s.original_user_id)}</strong>
              <span className="text-slate-400"> → thay thế bởi </span>
              <strong className="text-slate-700">{resolveName(s.substitute_user_id)}</strong>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{s.tu_ngay} — {s.den_ngay}</div>
            {s.ly_do && <div className="text-xs text-slate-400 mt-0.5 italic">&quot;{s.ly_do}&quot;</div>}
            <div className="text-[11px] text-slate-300 mt-0.5">Đăng ký lúc {formatKpiDateTime(s.created_at)}</div>
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            <button
              onClick={() => void handleApprove(s.id)}
              disabled={busyId === s.id}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-60"
            >
              <Check size={12} /> Đồng ý
            </button>
            <button
              onClick={() => { setRejectTarget(s); setRejectReason("") }}
              disabled={busyId === s.id}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold disabled:opacity-60"
            >
              <X size={12} /> Từ chối
            </button>
          </div>
        </div>
      ))}

      {rejectTarget && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-rose-700">
            Từ chối đăng ký thay thế cho {resolveName(rejectTarget.original_user_id)}?
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
            placeholder="Lý do (tuỳ chọn)"
            className="w-full px-3 py-2 border border-rose-300 rounded-xl text-sm outline-none focus:border-rose-500"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setRejectTarget(null)} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-white rounded-lg">
              Hủy
            </button>
            <button
              onClick={() => void handleReject()}
              disabled={busyId === rejectTarget.id}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg disabled:opacity-60"
            >
              Xác nhận từ chối
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
