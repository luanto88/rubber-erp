"use client"

// Cài đặt → KPI & 5S → Trọng số công thức — CRUD kpi_score_weights (Phase 4). Mỗi dòng áp dụng
// cho 1 Nhóm chuyên môn cụ thể (group_id) hoặc là dòng "Mặc định toàn nhà máy" (group_id = null).
// Engine tính điểm (kpi_compute_monthly_scores) ưu tiên dòng theo nhóm CHÍNH của user, fallback
// dòng mặc định, fallback cuối cùng là hằng số hard-code 30/25/20/25/24/0.75/1.10 (khớp
// defaultKpiScoreWeights()) nếu nhà máy chưa cấu hình gì cả. KHÔNG có phong_ban_id (giống Khung
// tiêu chí KPI cạnh đây) — canManage PHẢI là canManageKpiConfig thuần, không mở cho lãnh đạo
// phòng ban. Xem đầy đủ .claude/rules/27-kpi-module.md.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Edit2, Plus, Scale, Trash2 } from "lucide-react"
import { ModalShell } from "../../_components/modal-shell"
import {
  createKpiScoreWeights,
  defaultKpiScoreWeights,
  deleteKpiScoreWeights,
  fetchKpiScoreWeights,
  updateKpiScoreWeights,
  type KpiScoreWeights,
  type KpiScoreWeightsInput,
} from "@/lib/kpi-scores"
import { getKpiErrorMessage } from "@/lib/kpi-tasks"
import { loadAllPersonnelGroups, type KpiGroupOption } from "@/lib/kpi-templates"

type FormState = {
  group_id: string // "" = mặc định toàn nhà máy
  trong_so_hoan_thanh: string
  trong_so_dung_han: string
  trong_so_5s: string
  trong_so_chuyen_mon: string
  ngay_chuan_chuyen_can: string
  he_so_chuyen_can_min: string
  he_so_chuyen_can_max: string
}

function emptyForm(groupId?: string): FormState {
  const d = defaultKpiScoreWeights()
  return {
    group_id: groupId || "",
    trong_so_hoan_thanh: String(d.trong_so_hoan_thanh),
    trong_so_dung_han: String(d.trong_so_dung_han),
    trong_so_5s: String(d.trong_so_5s),
    trong_so_chuyen_mon: String(d.trong_so_chuyen_mon),
    ngay_chuan_chuyen_can: String(d.ngay_chuan_chuyen_can),
    he_so_chuyen_can_min: String(d.he_so_chuyen_can_min),
    he_so_chuyen_can_max: String(d.he_so_chuyen_can_max),
  }
}

function rowToForm(w: KpiScoreWeights): FormState {
  return {
    group_id: w.group_id || "",
    trong_so_hoan_thanh: String(w.trong_so_hoan_thanh),
    trong_so_dung_han: String(w.trong_so_dung_han),
    trong_so_5s: String(w.trong_so_5s),
    trong_so_chuyen_mon: String(w.trong_so_chuyen_mon),
    ngay_chuan_chuyen_can: String(w.ngay_chuan_chuyen_can),
    he_so_chuyen_can_min: String(w.he_so_chuyen_can_min),
    he_so_chuyen_can_max: String(w.he_so_chuyen_can_max),
  }
}

export function KpiScoreWeightsTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [groups, setGroups] = useState<KpiGroupOption[]>([])
  const [rows, setRows] = useState<KpiScoreWeights[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [delConfirm, setDelConfirm] = useState<KpiScoreWeights | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const groupNameById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups])

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    setLoadError("")
    try {
      const [groupRows, weightRows] = await Promise.all([loadAllPersonnelGroups(fid), fetchKpiScoreWeights(fid)])
      setGroups(groupRows)
      setRows(weightRows)
    } catch (err) {
      setLoadError(getKpiErrorMessage(err, "Không tải được trọng số công thức."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const defaultRow = rows.find((r) => r.group_id === null) || null
  const groupRows = rows.filter((r) => r.group_id !== null)
  const configuredGroupIds = new Set(groupRows.map((r) => r.group_id))
  const unconfiguredGroups = groups.filter((g) => !configuredGroupIds.has(g.id))

  const openAdd = (groupId?: string) => {
    setEditId(null)
    setForm(emptyForm(groupId))
    setSaveError("")
    setModalOpen(true)
  }

  const openEdit = (w: KpiScoreWeights) => {
    setEditId(w.id)
    setForm(rowToForm(w))
    setSaveError("")
    setModalOpen(true)
  }

  const totalWeight =
    (Number(form.trong_so_hoan_thanh) || 0) +
    (Number(form.trong_so_dung_han) || 0) +
    (Number(form.trong_so_5s) || 0) +
    (Number(form.trong_so_chuyen_mon) || 0)

  const handleSave = async () => {
    if (!factoryId) return
    setSaving(true)
    setSaveError("")
    try {
      const shared = {
        trongSoHoanThanh: Number(form.trong_so_hoan_thanh) || 0,
        trongSoDungHan: Number(form.trong_so_dung_han) || 0,
        trongSo5s: Number(form.trong_so_5s) || 0,
        trongSoChuyenMon: Number(form.trong_so_chuyen_mon) || 0,
        ngayChuanChuyenCan: Number(form.ngay_chuan_chuyen_can) || 24,
        heSoChuyenCanMin: Number(form.he_so_chuyen_can_min) || 0.75,
        heSoChuyenCanMax: Number(form.he_so_chuyen_can_max) || 1.1,
      }
      if (editId) {
        await updateKpiScoreWeights(editId, shared)
      } else {
        const payload: KpiScoreWeightsInput = { factoryId, groupId: form.group_id || null, ...shared }
        await createKpiScoreWeights(payload)
      }
      setModalOpen(false)
      void loadData(factoryId)
    } catch (err) {
      setSaveError(getKpiErrorMessage(err, "Không lưu được trọng số."))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!delConfirm || !factoryId) return
    setBusyId(delConfirm.id)
    try {
      await deleteKpiScoreWeights(delConfirm.id)
      setDelConfirm(null)
      void loadData(factoryId)
    } catch (err) {
      setLoadError(getKpiErrorMessage(err, "Không xóa được cấu hình trọng số."))
      setDelConfirm(null)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>

  const renderRow = (w: KpiScoreWeights | null, label: string) => {
    const d = defaultKpiScoreWeights()
    const a = w?.trong_so_hoan_thanh ?? d.trong_so_hoan_thanh
    const b = w?.trong_so_dung_han ?? d.trong_so_dung_han
    const c = w?.trong_so_5s ?? d.trong_so_5s
    const dd = w?.trong_so_chuyen_mon ?? d.trong_so_chuyen_mon
    return (
      <div key={w?.id || "default"} className="row-hover flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800">{label}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-lg bg-sky-100 px-2 py-0.5 font-bold text-sky-700">Hoàn thành {a}%</span>
            <span className="rounded-lg bg-amber-100 px-2 py-0.5 font-bold text-amber-700">Đúng hạn {b}%</span>
            <span className="rounded-lg bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">5S {c}%</span>
            <span className="rounded-lg bg-violet-100 px-2 py-0.5 font-bold text-violet-700">Chuyên môn {dd}%</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Ngày chuẩn chuyên cần: {w?.ngay_chuan_chuyen_can ?? d.ngay_chuan_chuyen_can} · Hệ số chuyên cần:{" "}
            {w?.he_so_chuyen_can_min ?? d.he_so_chuyen_can_min}–{w?.he_so_chuyen_can_max ?? d.he_so_chuyen_can_max}
            {!w && " (dùng hằng số mặc định, chưa cấu hình riêng)"}
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1.5">
            {w ? (
              <>
                <button
                  onClick={() => openEdit(w)}
                  className="flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[11px] font-bold text-sky-700 hover:bg-sky-100"
                >
                  <Edit2 size={11} /> Sửa
                </button>
                <button
                  onClick={() => setDelConfirm(w)}
                  className="flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                >
                  <Trash2 size={11} />
                </button>
              </>
            ) : (
              <button
                onClick={() => openAdd()}
                className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
              >
                <Plus size={11} /> Cấu hình riêng
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        Trọng số quyết định công thức <strong>KPI tháng = (A%×Hoàn thành + B%×Đúng hạn + C%×5S +
        D%×Chuyên môn) × Hệ số chuyên cần</strong>. Có thể cấu hình riêng theo từng Nhóm chuyên môn
        (ưu tiên) hoặc dùng chung 1 dòng mặc định cho toàn nhà máy. Tổng 4 trọng số phải bằng 100.
      </p>

      {loadError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{loadError}</div>}

      <div className="mb-4 space-y-3">
        <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-2 text-xs font-extrabold text-slate-500 uppercase">Mặc định toàn nhà máy</div>
          {renderRow(defaultRow, "Áp dụng cho mọi nhóm chưa có cấu hình riêng")}
        </div>

        {groupRows.length > 0 && (
          <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
            <div className="bg-violet-50 px-4 py-2 text-xs font-extrabold text-violet-600 uppercase">Cấu hình riêng theo nhóm</div>
            {groupRows.map((w) => renderRow(w, groupNameById[w.group_id!] || "—"))}
          </div>
        )}

        {canManage && unconfiguredGroups.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-3">
            <span className="text-xs font-bold text-slate-500">Thêm cấu hình riêng cho nhóm:</span>
            {unconfiguredGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => openAdd(g.id)}
                className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 border border-slate-300 hover:bg-slate-50"
              >
                <Plus size={11} /> {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <ModalShell
          title={editId ? "Sửa trọng số" : "Thêm cấu hình trọng số"}
          onClose={() => setModalOpen(false)}
          maxWidth="md"
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
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
              <Scale size={12} className="inline mr-1" />
              Áp dụng cho: {editId ? (form.group_id ? groupNameById[form.group_id] || "—" : "Mặc định toàn nhà máy") : form.group_id ? groupNameById[form.group_id] || "—" : "Mặc định toàn nhà máy"}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Hoàn thành (A) %</label>
                <input
                  type="number"
                  value={form.trong_so_hoan_thanh}
                  onChange={(e) => setForm((f) => ({ ...f, trong_so_hoan_thanh: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Đúng hạn (B) %</label>
                <input
                  type="number"
                  value={form.trong_so_dung_han}
                  onChange={(e) => setForm((f) => ({ ...f, trong_so_dung_han: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">5S (C) %</label>
                <input
                  type="number"
                  value={form.trong_so_5s}
                  onChange={(e) => setForm((f) => ({ ...f, trong_so_5s: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Chuyên môn (D) %</label>
                <input
                  type="number"
                  value={form.trong_so_chuyen_mon}
                  onChange={(e) => setForm((f) => ({ ...f, trong_so_chuyen_mon: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div className={`rounded-xl px-3 py-2 text-xs font-bold ${totalWeight === 100 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              Tổng: {totalWeight}% {totalWeight !== 100 && "— phải bằng 100 mới lưu được"}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Ngày chuẩn chuyên cần</label>
                <input
                  type="number"
                  value={form.ngay_chuan_chuyen_can}
                  onChange={(e) => setForm((f) => ({ ...f, ngay_chuan_chuyen_can: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Hệ số min</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.he_so_chuyen_can_min}
                  onChange={(e) => setForm((f) => ({ ...f, he_so_chuyen_can_min: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Hệ số max</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.he_so_chuyen_can_max}
                  onChange={(e) => setForm((f) => ({ ...f, he_so_chuyen_can_max: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>
        </ModalShell>
      )}

      {delConfirm && (
        <ModalShell
          title="Xóa cấu hình trọng số"
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
            Xóa cấu hình trọng số cho{" "}
            <strong>{delConfirm.group_id ? groupNameById[delConfirm.group_id] || "—" : "Mặc định toàn nhà máy"}</strong>?
            Sau khi xóa, nhóm này sẽ dùng lại dòng mặc định (hoặc hằng số 30/25/20/25 nếu chưa có
            dòng mặc định nào).
          </p>
        </ModalShell>
      )}
    </div>
  )
}
