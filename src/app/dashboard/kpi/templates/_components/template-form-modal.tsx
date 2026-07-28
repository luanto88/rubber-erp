"use client"

// Modal Thêm/Sửa "Việc định kỳ theo nhóm" (kpi_task_templates).
// Xem đầy đủ .claude/rules/27-kpi-module.md mục "Việc định kỳ theo nhóm".

import { useEffect, useState } from "react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import type { DepartmentOption } from "@/lib/kpi-department-leaders"
import {
  KPI_REPORT_REQ_LABEL,
  getKpiErrorMessage,
  loadKpiTaskCandidates,
  type KpiReportRequirement,
  type KpiTaskCandidate,
} from "@/lib/kpi-tasks"
import {
  createKpiTaskTemplate,
  KPI_WEEKDAY_LABEL,
  KPI_WEEKDAY_OPTIONS,
  updateKpiTaskTemplate,
  type KpiGroupOption,
  type KpiTaskTemplate,
} from "@/lib/kpi-templates"

const REPORT_REQ_OPTIONS: KpiReportRequirement[] = ["anh", "file", "dinh_vi", "van_ban"]

type TemplateFormModalProps = {
  factoryId: string
  createdBy: string
  groups: KpiGroupOption[]
  candidates: KpiTaskCandidate[]
  departments: DepartmentOption[]
  editing: KpiTaskTemplate | null
  onClose: () => void
  onSaved: () => void
}

export function TemplateFormModal({ factoryId, createdBy, groups, candidates, departments, editing, onClose, onSaved }: TemplateFormModalProps) {
  const [groupId, setGroupId] = useState(editing?.group_id || "")
  const [phongBanId, setPhongBanId] = useState(editing?.phong_ban_id || "")
  const [assignedUserId, setAssignedUserId] = useState(editing?.assigned_user_id || "")
  // Ứng viên "Người nhận cố định" thu hẹp theo phòng ban đã chọn — mặc định = candidates chung
  // (toàn nhà máy) khi chưa chọn phòng ban, để không chặn dữ liệu cũ chưa gán phòng ban.
  const [scopedCandidates, setScopedCandidates] = useState<KpiTaskCandidate[]>(candidates)
  const [tieuDe, setTieuDe] = useState(editing?.tieu_de || "")
  const [moTa, setMoTa] = useState(editing?.mo_ta || "")
  const [weekdays, setWeekdays] = useState<number[]>(editing?.apply_weekdays || [1, 2, 3, 4, 5, 6, 7])
  const [gioHan, setGioHan] = useState((editing?.gio_han || "17:00:00").slice(0, 5))
  const [yeuCau, setYeuCau] = useState<KpiReportRequirement[]>(editing?.yeu_cau_bao_cao || [])
  const [isActive, setIsActive] = useState(editing?.is_active ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleWeekday = (d: number) => {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)))
  }

  // Đổi phòng ban → tải lại ứng viên đúng phòng ban đó; gỡ người nhận đã chọn nếu không còn
  // thuộc danh sách mới (tránh <select> hiển thị sai do value không khớp option nào).
  useEffect(() => {
    let alive = true
    if (!phongBanId) {
      setScopedCandidates(candidates)
      return
    }
    void loadKpiTaskCandidates(factoryId, { departmentId: phongBanId }).then(({ people }) => {
      if (alive) setScopedCandidates(people)
    })
    return () => { alive = false }
  }, [phongBanId, factoryId, candidates])

  useEffect(() => {
    setAssignedUserId((prev) => (prev && !scopedCandidates.some((c) => c.userId === prev) ? "" : prev))
  }, [scopedCandidates])

  const handleSave = async () => {
    if (!phongBanId) { setError("Vui lòng chọn phòng ban."); return }
    if (!groupId) { setError("Vui lòng chọn nhóm."); return }
    if (!assignedUserId) { setError("Vui lòng chọn người nhận cố định."); return }
    if (!tieuDe.trim()) { setError("Vui lòng nhập tiêu đề."); return }
    if (weekdays.length === 0) { setError("Vui lòng chọn ít nhất 1 ngày áp dụng."); return }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        groupId,
        assignedUserId,
        phongBanId,
        tieuDe,
        moTa,
        applyWeekdays: weekdays,
        gioHan: `${gioHan}:00`,
        yeuCauBaoCao: yeuCau,
        isActive,
      }
      if (editing) {
        await updateKpiTaskTemplate(editing.id, payload)
      } else {
        await createKpiTaskTemplate({ factoryId, createdBy, ...payload })
      }
      onSaved()
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không lưu được việc định kỳ."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={editing ? "Sửa việc định kỳ" : "Thêm việc định kỳ"}
      onClose={onClose}
      maxWidth="lg"
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
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Tiêu đề *</label>
          <input
            value={tieuDe}
            onChange={(e) => setTieuDe(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            placeholder="VD: Tạo phiếu điều xe trước 17h"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Mô tả</label>
          <textarea
            value={moTa}
            onChange={(e) => setMoTa(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Phòng ban *</label>
          <select
            value={phongBanId}
            onChange={(e) => setPhongBanId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="">-- Chọn phòng ban --</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            Quyết định ai được phép quản lý việc định kỳ này (lãnh đạo đúng phòng ban, hoặc
            admin/kpi.manage_config) và thu hẹp danh sách người nhận bên dưới.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Nhóm (phân loại chính/choàng) *</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            >
              <option value="">-- Chọn nhóm --</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">
              Người nhận có nhóm chính = nhóm này → &quot;Chính&quot;, khác/chưa có → &quot;Choàng&quot;.
            </p>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Người nhận cố định *</label>
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            >
              <option value="">-- Chọn người --</option>
              {scopedCandidates.map((c) => (
                <option key={c.userId} value={c.userId}>{c.ten}</option>
              ))}
            </select>
            {phongBanId && scopedCandidates.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">Chưa có nhân sự nào thuộc phòng ban này.</p>
            )}
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Thứ áp dụng *</label>
          <div className="flex flex-wrap gap-1.5">
            {KPI_WEEKDAY_OPTIONS.map((d) => {
              const checked = weekdays.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleWeekday(d)}
                  className={
                    "px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors " +
                    (checked ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {KPI_WEEKDAY_LABEL[d]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Giờ hạn mỗi ngày *</label>
            <input
              type="time"
              value={gioHan}
              onChange={(e) => setGioHan(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-violet-600" />
            Đang áp dụng
          </label>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Yêu cầu báo cáo kèm theo</label>
          <div className="flex flex-wrap gap-2">
            {REPORT_REQ_OPTIONS.map((req) => {
              const checked = yeuCau.includes(req)
              return (
                <button
                  key={req}
                  type="button"
                  onClick={() => setYeuCau((prev) => (checked ? prev.filter((r) => r !== req) : [...prev, req]))}
                  className={
                    "px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors " +
                    (checked ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {KPI_REPORT_REQ_LABEL[req]}
                </button>
              )
            })}
          </div>
        </div>

        {error && <div className="text-sm font-semibold text-red-600">{error}</div>}
      </div>
    </ModalShell>
  )
}
