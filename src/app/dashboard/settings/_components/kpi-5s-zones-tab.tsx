"use client"

// Cài đặt → KPI & 5S → Khu vực — CRUD kpi_5s_zones (tầng LỚN, vd "Văn phòng", "Kho 1",
// "Kho 2", "Ca SX mủ tạp", "Ca SX mủ nước") + quản lý thành viên đủ điều kiện random nội
// bộ khu vực đó (kpi_5s_zone_members). Khác hẳn "Vị trí 5S" (kpi-5s-locations-tab.tsx, PGĐ,
// PH01... — tầng NHỎ có QR riêng để chấm điểm) và khác hẳn "Nhóm chuyên môn"
// (personnel_groups, quản trị ở Cài đặt → Hệ thống → Nhân sự — dùng cho hệ số điểm KPI
// chuyên môn, một khái niệm hoàn toàn không liên quan). Xem đầy đủ
// .claude/rules/27-kpi-module.md.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Edit2, Plus, Power, Trash2, Users } from "lucide-react"
import { ModalShell } from "../../_components/modal-shell"
import { getKpi5sErrorMessage } from "@/lib/kpi-5s"
import {
  addKpi5sZoneMember,
  createKpi5sZone,
  deleteKpi5sZone,
  fetchAllZoneMemberships,
  fetchKpi5sZones,
  removeKpi5sZoneMember,
  updateKpi5sZone,
  type Kpi5sZone,
  type Kpi5sZoneInput,
} from "@/lib/kpi-5s-zones"
import { loadKpiTaskCandidates, type KpiTaskCandidate } from "@/lib/kpi-tasks"
import { fetchDepartmentOptions, type DepartmentOption } from "@/lib/kpi-department-leaders"

type FormState = {
  ten: string
  phong_ban_id: string
  is_active: boolean
  sort_order: string
}

function emptyForm(): FormState {
  return { ten: "", phong_ban_id: "", is_active: true, sort_order: "0" }
}

function zoneToForm(z: Kpi5sZone): FormState {
  return { ten: z.ten, phong_ban_id: z.phong_ban_id || "", is_active: z.is_active, sort_order: String(z.sort_order ?? 0) }
}

export function Kpi5sZonesTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [zones, setZones] = useState<Kpi5sZone[]>([])
  const [membershipByZone, setMembershipByZone] = useState<Map<string, string[]>>(new Map())
  const [candidates, setCandidates] = useState<KpiTaskCandidate[]>([])
  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [delConfirm, setDelConfirm] = useState<Kpi5sZone | null>(null)

  const [memberTarget, setMemberTarget] = useState<Kpi5sZone | null>(null)
  const [memberBusyUserId, setMemberBusyUserId] = useState<string | null>(null)
  const [memberError, setMemberError] = useState("")

  const nameByUserId = useMemo(() => Object.fromEntries(candidates.map((c) => [c.userId, c.ten])), [candidates])

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    setLoadError("")
    try {
      const [zoneRows, membershipMap, candidateData, deptRows] = await Promise.all([
        fetchKpi5sZones(fid, { includeInactive: true }),
        fetchAllZoneMemberships(fid),
        loadKpiTaskCandidates(fid),
        fetchDepartmentOptions(),
      ])
      setZones(zoneRows)
      setMembershipByZone(membershipMap)
      setCandidates(candidateData.people)
      setDepartments(deptRows)
    } catch (err) {
      setLoadError(getKpi5sErrorMessage(err, "Không tải được danh sách khu vực."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const openAdd = () => {
    setEditId(null)
    setForm(emptyForm())
    setSaveError("")
    setModalOpen(true)
  }

  const openEdit = (z: Kpi5sZone) => {
    setEditId(z.id)
    setForm(zoneToForm(z))
    setSaveError("")
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!factoryId) return
    if (!form.ten.trim()) {
      setSaveError("Vui lòng nhập Tên khu vực.")
      return
    }
    setSaving(true)
    setSaveError("")
    try {
      const payload: Kpi5sZoneInput = {
        factory_id: factoryId,
        ten: form.ten.trim(),
        phong_ban_id: form.phong_ban_id || null,
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 0,
      }
      if (editId) {
        await updateKpi5sZone(editId, payload)
      } else {
        await createKpi5sZone(payload)
      }
      setModalOpen(false)
      void loadData(factoryId)
    } catch (err) {
      setSaveError(getKpi5sErrorMessage(err, "Không lưu được khu vực."))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (z: Kpi5sZone) => {
    if (!factoryId) return
    setBusyId(z.id)
    try {
      await updateKpi5sZone(z.id, { is_active: !z.is_active })
      void loadData(factoryId)
    } catch (err) {
      setLoadError(getKpi5sErrorMessage(err, "Không cập nhật được trạng thái."))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async () => {
    if (!delConfirm || !factoryId) return
    setBusyId(delConfirm.id)
    try {
      await deleteKpi5sZone(delConfirm.id)
      setDelConfirm(null)
      void loadData(factoryId)
    } catch (err) {
      // Khu vực đang được gán cho ≥1 vị trí (kpi_5s_locations.zone_id) sẽ bị FK chặn xóa —
      // hướng dẫn dùng "Tạm ngưng" thay vì xóa.
      setLoadError(getKpi5sErrorMessage(err, "Không xóa được khu vực — có thể đang có vị trí gán vào, hãy dùng \"Tạm ngưng\" thay thế."))
      setDelConfirm(null)
    } finally {
      setBusyId(null)
    }
  }

  const openMembers = (z: Kpi5sZone) => {
    setMemberTarget(z)
    setMemberError("")
  }

  const toggleMember = async (userId: string) => {
    if (!factoryId || !memberTarget) return
    setMemberBusyUserId(userId)
    setMemberError("")
    try {
      const current = membershipByZone.get(memberTarget.id) || []
      if (current.includes(userId)) {
        await removeKpi5sZoneMember(memberTarget.id, userId)
      } else {
        await addKpi5sZoneMember(factoryId, memberTarget.id, userId)
      }
      const fresh = await fetchAllZoneMemberships(factoryId)
      setMembershipByZone(fresh)
    } catch (err) {
      setMemberError(getKpi5sErrorMessage(err, "Không cập nhật được thành viên."))
    } finally {
      setMemberBusyUserId(null)
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        Khu vực (vd &quot;Văn phòng&quot;, &quot;Kho 1&quot;, &quot;Kho 2&quot;, &quot;Ca SX mủ
        tạp&quot;...) chứa nhiều <strong>Vị trí 5S</strong> bên trong (xem tab &quot;Vị trí
        5S&quot; cạnh đây). Chỉ dùng để giới hạn &quot;Phân công thông minh&quot; random trong
        nội bộ khu vực — không liên quan tới Nhóm chuyên môn ở Cài đặt → Hệ thống → Nhân sự.
      </p>

      {loadError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{loadError}</div>}

      {canManage && (
        <div className="mb-4">
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm text-sm"
          >
            <Plus size={15} /> Thêm khu vực
          </button>
        </div>
      )}

      {zones.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 p-12 text-center text-slate-400">Chưa có khu vực nào.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {zones.map((z) => {
            const memberIds = membershipByZone.get(z.id) || []
            return (
              <div key={z.id} className={`rounded-2xl border shadow-sm p-4 ${z.is_active ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-extrabold text-slate-800">{z.ten}</div>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-lg ${z.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                    {z.is_active ? "Đang áp dụng" : "Tạm ngưng"}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  {memberIds.length} thành viên{memberIds.length > 0 && ": "}
                  {memberIds.length > 0 && (
                    <span className="text-slate-500">{memberIds.map((uid) => nameByUserId[uid] || "—").join(", ")}</span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
                  <button
                    onClick={() => openMembers(z)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-[11px] font-bold"
                  >
                    <Users size={11} /> Quản lý thành viên
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => openEdit(z)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-bold"
                      >
                        <Edit2 size={11} /> Sửa
                      </button>
                      <button
                        onClick={() => void handleToggleActive(z)}
                        disabled={busyId === z.id}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold disabled:opacity-60"
                      >
                        <Power size={11} /> {z.is_active ? "Tạm ngưng" : "Kích hoạt lại"}
                      </button>
                      <button
                        onClick={() => setDelConfirm(z)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold"
                      >
                        <Trash2 size={11} /> Xóa
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modalOpen && (
        <ModalShell
          title={editId ? "Sửa khu vực" : "Thêm khu vực"}
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
              <label className="mb-1 block text-xs font-bold text-slate-600">Tên khu vực *</label>
              <input
                value={form.ten}
                onChange={(e) => setForm((f) => ({ ...f, ten: e.target.value }))}
                placeholder="vd: Văn phòng"
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
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Phòng ban</label>
              <select
                value={form.phong_ban_id}
                onChange={(e) => setForm((f) => ({ ...f, phong_ban_id: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              >
                <option value="">-- Chưa gán --</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
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
          title="Xóa khu vực"
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
            Xóa <strong>&quot;{delConfirm.ten}&quot;</strong>? Nếu đang có vị trí 5S gán vào khu
            vực này, thao tác sẽ bị chặn — hãy gỡ gán ở tab &quot;Vị trí 5S&quot; hoặc dùng
            &quot;Tạm ngưng&quot; thay thế.
          </p>
        </ModalShell>
      )}

      {memberTarget && (
        <ModalShell title={`Thành viên — ${memberTarget.ten}`} onClose={() => setMemberTarget(null)} maxWidth="sm">
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Chỉ những người tick ở đây mới được &quot;Phân công thông minh&quot; random vào khu
              vực này.
            </p>
            {memberError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{memberError}</div>}
            {candidates.length === 0 ? (
              <div className="text-sm text-slate-400">Chưa có nhân sự đã liên kết tài khoản.</div>
            ) : (
              <div className="max-h-[50vh] space-y-1 overflow-y-auto">
                {candidates.map((c) => {
                  const checked = (membershipByZone.get(memberTarget.id) || []).includes(c.userId)
                  return (
                    <label key={c.userId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={memberBusyUserId === c.userId}
                        onChange={() => void toggleMember(c.userId)}
                        className="h-4 w-4 rounded accent-violet-600 disabled:opacity-50"
                      />
                      {c.ten}
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </div>
  )
}
