"use client"

// Modal "Đăng ký người thay thế tạm thời" (kpi_user_substitutions) — trả lời "về tua thì sao":
// đăng ký 1 lần cho cả khoảng ngày nghỉ, áp dụng tự động cho mọi việc định kỳ (hoặc chỉ 1 việc
// cụ thể) trong khoảng đó, không cần bấm chuyển việc mỗi ngày.
// Xem .claude/rules/27-kpi-module.md mục "Người thay thế tạm thời".

import { useEffect, useState } from "react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { getTodayISODate } from "@/lib/date-utils"
import { sendKpiNotify } from "@/lib/kpi-notify"
import { getKpiErrorMessage, type KpiTaskCandidate } from "@/lib/kpi-tasks"
import { createKpiUserSubstitution, type KpiTaskTemplate } from "@/lib/kpi-templates"

type SubstitutionFormModalProps = {
  factoryId: string
  createdBy: string
  candidates: KpiTaskCandidate[]
  templates: KpiTaskTemplate[]
  canChooseOriginal: boolean
  defaultOriginalUserId: string
  onClose: () => void
  onSaved: () => void
}

export function SubstitutionFormModal({
  factoryId,
  createdBy,
  candidates,
  templates,
  canChooseOriginal,
  defaultOriginalUserId,
  onClose,
  onSaved,
}: SubstitutionFormModalProps) {
  const [originalUserId, setOriginalUserId] = useState(defaultOriginalUserId)
  const [substituteUserId, setSubstituteUserId] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [tuNgay, setTuNgay] = useState(getTodayISODate())
  const [denNgay, setDenNgay] = useState(getTodayISODate())
  const [lyDo, setLyDo] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameOf = (uid: string) => candidates.find((c) => c.userId === uid)?.ten || uid
  const today = getTodayISODate()
  const includesToday = tuNgay <= today && denNgay >= today

  // Danh sách template áp dụng phụ thuộc originalUserId — đổi người đi vắng thì lựa chọn
  // template cũ (nếu có) không còn hợp lệ, phải reset về "Tất cả việc định kỳ".
  useEffect(() => {
    setTemplateId((prev) => (templates.some((t) => t.id === prev && t.assigned_user_id === originalUserId) ? prev : ""))
  }, [originalUserId, templates])

  // Người thay thế không được trùng người đi vắng — nếu đổi originalUserId khiến trùng, gỡ
  // lựa chọn hiện tại (tránh <select> hiển thị sai do value không khớp option nào).
  useEffect(() => {
    setSubstituteUserId((prev) => (prev === originalUserId ? "" : prev))
  }, [originalUserId])

  const handleSave = async () => {
    if (!originalUserId) { setError("Vui lòng chọn người đi vắng."); return }
    if (!substituteUserId) { setError("Vui lòng chọn người thay thế."); return }
    setSaving(true)
    setError(null)
    try {
      await createKpiUserSubstitution({
        factoryId,
        createdBy,
        originalUserId,
        substituteUserId,
        templateId: templateId || null,
        tuNgay,
        denNgay,
        lyDo,
      })
      sendKpiNotify({
        factoryId,
        title: "Đăng ký người thay thế tạm thời",
        lines: [
          `👤 ${nameOf(originalUserId)} → thay thế bởi ${nameOf(substituteUserId)}`,
          `📅 Từ ${tuNgay} đến ${denNgay}${templateId ? " (1 việc định kỳ cụ thể)" : " (tất cả việc định kỳ)"}`,
          lyDo.trim() ? `📝 Lý do: ${lyDo.trim()}` : null,
        ].filter((l): l is string => !!l),
        link: "/dashboard/kpi/templates",
      })
      onSaved()
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không đăng ký được người thay thế."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Đăng ký người thay thế tạm thời"
      onClose={onClose}
      maxWidth="md"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
            Hủy
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
          >
            {saving ? "Đang lưu..." : "Đăng ký"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Trong khoảng ngày đã chọn, mọi việc định kỳ sinh ra cho người đi vắng sẽ tự động gán
          cho người thay thế — không cần bấm chuyển giao từng ngày. Hết khoảng ngày, việc định kỳ
          tự quay lại đúng người gốc.
        </p>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Người đi vắng *</label>
          {canChooseOriginal ? (
            <select
              value={originalUserId}
              onChange={(e) => setOriginalUserId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            >
              <option value="">-- Chọn người --</option>
              {candidates.map((c) => (
                <option key={c.userId} value={c.userId}>{c.ten}</option>
              ))}
            </select>
          ) : (
            <div className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-600">
              {nameOf(originalUserId)} (bạn)
            </div>
          )}
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Người thay thế *</label>
          <select
            value={substituteUserId}
            onChange={(e) => setSubstituteUserId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="">-- Chọn người --</option>
            {candidates.filter((c) => c.userId !== originalUserId).map((c) => (
              <option key={c.userId} value={c.userId}>{c.ten}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Từ ngày *</label>
            <input
              type="date"
              value={tuNgay}
              onChange={(e) => setTuNgay(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Đến ngày *</label>
            <input
              type="date"
              value={denNgay}
              onChange={(e) => setDenNgay(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            />
          </div>
        </div>
        {includesToday && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Khoảng ngày này bao gồm hôm nay. Nếu việc định kỳ hôm nay <strong>đã được sinh sẵn</strong>{" "}
            cho người đi vắng trước khi đăng ký này lưu xong, việc đó sẽ <strong>không tự đổi người
            ngay</strong> — người đi vắng cần bấm &quot;Chuyển giao&quot; ở trang chi tiết việc đó, hoặc
            để hệ thống tự gán đúng người thay thế từ lần sinh việc tiếp theo (ngày mai trở đi).
          </p>
        )}
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Áp dụng cho</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="">Tất cả việc định kỳ của người đi vắng</option>
            {templates.filter((t) => t.assigned_user_id === originalUserId).map((t) => (
              <option key={t.id} value={t.id}>Chỉ: {t.tieu_de}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Lý do (tuỳ chọn)</label>
          <textarea
            value={lyDo}
            onChange={(e) => setLyDo(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            placeholder="VD: Về tua từ ngày mai"
          />
        </div>
        {error && <div className="text-xs font-semibold text-red-600">{error}</div>}
      </div>
    </ModalShell>
  )
}
