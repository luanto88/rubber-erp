"use client"

// Cài đặt → KPI & 5S → Khung tiêu chí KPI — CRUD kpi_criteria_templates (Phase 3). Mỗi tiêu chí
// thuộc đúng 1 Nhóm chuyên môn (personnel_groups, quản trị ở Cài đặt → Hệ thống → Nhân sự) —
// dùng để chấm điểm chuyên môn theo ngày (xem tab "Chấm điểm chuyên môn" trong module
// /dashboard/kpi). KHÔNG có phong_ban_id (personnel_groups không mang khái niệm phòng ban) —
// canManage ở đây PHẢI là canManageKpiConfig thuần (admin/kpi.manage_config), KHÔNG mở rộng cho
// lãnh đạo phòng ban như 2 tab "Vị trí 5S"/"Khu vực" cạnh đây. Xem đầy đủ
// .claude/rules/27-kpi-module.md.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Edit2, ListChecks, Plus, Power, Trash2 } from "lucide-react"
import { ModalShell } from "../../_components/modal-shell"
import {
  createKpiCriteriaTemplate,
  deleteKpiCriteriaTemplate,
  fetchKpiCriteriaTemplates,
  setKpiCriteriaTemplateActive,
  updateKpiCriteriaTemplate,
  type KpiCriteriaTemplate,
  type KpiCriteriaTemplateInput,
} from "@/lib/kpi-criteria"
import { getKpiErrorMessage } from "@/lib/kpi-tasks"
import { loadAllPersonnelGroups, type KpiGroupOption } from "@/lib/kpi-templates"

type FormState = {
  group_id: string
  ten_tieu_chi: string
  mo_ta: string
  sort_order: string
  is_active: boolean
}

function emptyForm(defaultGroupId?: string): FormState {
  return { group_id: defaultGroupId || "", ten_tieu_chi: "", mo_ta: "", sort_order: "0", is_active: true }
}

function criteriaToForm(c: KpiCriteriaTemplate): FormState {
  return {
    group_id: c.group_id,
    ten_tieu_chi: c.ten_tieu_chi,
    mo_ta: c.mo_ta || "",
    sort_order: String(c.sort_order ?? 0),
    is_active: c.is_active,
  }
}

export function KpiCriteriaTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [groups, setGroups] = useState<KpiGroupOption[]>([])
  const [criteria, setCriteria] = useState<KpiCriteriaTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [delConfirm, setDelConfirm] = useState<KpiCriteriaTemplate | null>(null)

  const groupNameById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups])

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    setLoadError("")
    try {
      const [groupRows, criteriaRows] = await Promise.all([
        loadAllPersonnelGroups(fid),
        fetchKpiCriteriaTemplates(fid, { includeInactive: true }),
      ])
      setGroups(groupRows)
      setCriteria(criteriaRows)
    } catch (err) {
      setLoadError(getKpiErrorMessage(err, "Không tải được khung tiêu chí."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const criteriaByGroup = useMemo(() => {
    const map = new Map<string, KpiCriteriaTemplate[]>()
    for (const c of criteria) map.set(c.group_id, [...(map.get(c.group_id) || []), c])
    return map
  }, [criteria])

  const openAdd = (groupId?: string) => {
    setEditId(null)
    setForm(emptyForm(groupId))
    setSaveError("")
    setModalOpen(true)
  }

  const openEdit = (c: KpiCriteriaTemplate) => {
    setEditId(c.id)
    setForm(criteriaToForm(c))
    setSaveError("")
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!factoryId) return
    if (!form.group_id) {
      setSaveError("Vui lòng chọn Nhóm chuyên môn.")
      return
    }
    if (!form.ten_tieu_chi.trim()) {
      setSaveError("Vui lòng nhập Tên tiêu chí.")
      return
    }
    setSaving(true)
    setSaveError("")
    try {
      const payload: KpiCriteriaTemplateInput = {
        factory_id: factoryId,
        group_id: form.group_id,
        ten_tieu_chi: form.ten_tieu_chi.trim(),
        mo_ta: form.mo_ta.trim() || null,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      }
      if (editId) {
        await updateKpiCriteriaTemplate(editId, payload)
      } else {
        await createKpiCriteriaTemplate(payload)
      }
      setModalOpen(false)
      void loadData(factoryId)
    } catch (err) {
      setSaveError(getKpiErrorMessage(err, "Không lưu được tiêu chí."))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (c: KpiCriteriaTemplate) => {
    if (!factoryId) return
    setBusyId(c.id)
    try {
      await setKpiCriteriaTemplateActive(c.id, !c.is_active)
      void loadData(factoryId)
    } catch (err) {
      setLoadError(getKpiErrorMessage(err, "Không cập nhật được trạng thái."))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async () => {
    if (!delConfirm || !factoryId) return
    setBusyId(delConfirm.id)
    try {
      await deleteKpiCriteriaTemplate(delConfirm.id)
      setDelConfirm(null)
      void loadData(factoryId)
    } catch (err) {
      // Tiêu chí đã có lượt chấm điểm (kpi_daily_evaluation_items.criteria_id, không CASCADE) sẽ
      // bị FK chặn xóa — hướng dẫn dùng "Tạm ngưng" để giữ nguyên lịch sử chấm điểm cũ.
      setLoadError(getKpiErrorMessage(err, "Không xóa được tiêu chí — có thể đã có lượt chấm điểm dùng tiêu chí này, hãy dùng \"Tạm ngưng\" thay thế."))
      setDelConfirm(null)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        Mỗi tiêu chí thuộc đúng 1 <strong>Nhóm chuyên môn</strong> (quản trị ở Cài đặt → Hệ thống
        → Nhân sự) — dùng khi chấm điểm chuyên môn theo ngày ở module KPI. Chỉ tạo được tiêu chí
        cho nhóm đã tồn tại; chưa có nhóm nào thì vào Cài đặt → Hệ thống → Nhân sự tạo trước.
      </p>

      {loadError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{loadError}</div>}

      {canManage && groups.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => openAdd()}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm text-sm"
          >
            <Plus size={15} /> Thêm tiêu chí
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
          Chưa có Nhóm chuyên môn nào — vào Cài đặt → Hệ thống → Nhân sự để tạo nhóm trước.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const rows = criteriaByGroup.get(g.id) || []
            return (
              <div key={g.id} className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-2 bg-violet-50 px-4 py-2.5">
                  <div className="flex items-center gap-1.5 text-sm font-extrabold text-violet-700">
                    <ListChecks size={14} /> {g.name}
                    <span className="text-[11px] font-bold text-violet-400">({rows.length} tiêu chí)</span>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => openAdd(g.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-violet-100 text-violet-700 text-[11px] font-bold border border-violet-200"
                    >
                      <Plus size={11} /> Thêm vào nhóm này
                    </button>
                  )}
                </div>
                {rows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-slate-400">Chưa có tiêu chí nào cho nhóm này.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {rows.map((c) => (
                      <div key={c.id} className={`row-hover flex items-center justify-between gap-3 px-4 py-2.5 ${c.is_active ? "" : "opacity-60"}`}>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-800 truncate">{c.ten_tieu_chi}</div>
                          {c.mo_ta && <div className="text-xs text-slate-500 truncate">{c.mo_ta}</div>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${c.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                            {c.is_active ? "Đang áp dụng" : "Tạm ngưng"}
                          </span>
                          {canManage && (
                            <>
                              <button
                                onClick={() => openEdit(c)}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-bold"
                              >
                                <Edit2 size={11} /> Sửa
                              </button>
                              <button
                                onClick={() => void handleToggleActive(c)}
                                disabled={busyId === c.id}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold disabled:opacity-60"
                              >
                                <Power size={11} />
                              </button>
                              <button
                                onClick={() => setDelConfirm(c)}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold"
                              >
                                <Trash2 size={11} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalOpen && (
        <ModalShell
          title={editId ? "Sửa tiêu chí" : "Thêm tiêu chí"}
          onClose={() => setModalOpen(false)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            {saveError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{saveError}</div>}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Nhóm chuyên môn *</label>
              <select
                value={form.group_id}
                onChange={(e) => setForm((f) => ({ ...f, group_id: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              >
                <option value="">-- Chọn nhóm --</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Tên tiêu chí *</label>
              <input
                value={form.ten_tieu_chi}
                onChange={(e) => setForm((f) => ({ ...f, ten_tieu_chi: e.target.value }))}
                placeholder="vd: Vệ sinh khu vực làm việc"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Mô tả</label>
              <input
                value={form.mo_ta}
                onChange={(e) => setForm((f) => ({ ...f, mo_ta: e.target.value }))}
                placeholder="vd: Đúng quy trình 5S đã ban hành"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Thứ tự hiển thị</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 rounded accent-emerald-600"
              />
              Đang áp dụng
            </label>
          </div>
        </ModalShell>
      )}

      {delConfirm && (
        <ModalShell
          title="Xóa tiêu chí"
          onClose={() => setDelConfirm(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDelConfirm(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Không
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={busyId === delConfirm.id}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {busyId === delConfirm.id ? "Đang xóa..." : "Xác nhận xóa"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xóa <strong>&quot;{delConfirm.ten_tieu_chi}&quot;</strong> (nhóm{" "}
            <strong>{groupNameById[delConfirm.group_id] || "—"}</strong>)? Nếu tiêu chí này đã
            từng được dùng để chấm điểm, thao tác sẽ bị chặn — hãy dùng &quot;Tạm ngưng&quot;
            thay thế.
          </p>
        </ModalShell>
      )}
    </div>
  )
}
