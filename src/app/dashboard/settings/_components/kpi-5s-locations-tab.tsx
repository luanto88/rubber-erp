"use client"

// Cài đặt → KPI & 5S → Vị trí 5S — CRUD kpi_5s_locations + in QR hàng loạt (dán tại hiện
// trường). "Vị trí" (vd PGĐ, PH01) là tầng NHỎ, khác "Khu vực" (vd Văn phòng, Kho 1 — xem
// kpi-5s-zones-tab.tsx) là tầng LỚN chứa nhiều vị trí bên trong.
// Xem đầy đủ .claude/rules/27-kpi-module.md, mục "UI" (Phase 2 — Đánh giá 5S).

import { useCallback, useEffect, useMemo, useState } from "react"
import { Edit2, Loader2, MapPin, Plus, Power, Printer, Shuffle, Trash2 } from "lucide-react"
import { ModalShell } from "../../_components/modal-shell"
import {
  createKpi5sLocation,
  deleteKpi5sLocation,
  fetchKpi5sLocations,
  getKpi5sErrorMessage,
  updateKpi5sLocation,
  type Kpi5sLocation,
  type Kpi5sLocationInput,
} from "@/lib/kpi-5s"
import { downloadKpi5sLocationBulkQrPdf } from "@/lib/kpi-5s-pdf"
import { sendKpiNotify } from "@/lib/kpi-notify"
import { fetchKpi5sZones, type Kpi5sZone } from "@/lib/kpi-5s-zones"
import { Kpi5sAutoAssignModal } from "./kpi-5s-auto-assign-modal"

type UserOption = { id: string; label: string }

type FormState = {
  ma_vi_tri: string
  ten_vi_tri: string
  mo_ta: string
  nguoi_don_id: string
  nguoi_cham_id: string
  zone_id: string
  is_active: boolean
  sort_order: string
}

function emptyForm(): FormState {
  return { ma_vi_tri: "", ten_vi_tri: "", mo_ta: "", nguoi_don_id: "", nguoi_cham_id: "", zone_id: "", is_active: true, sort_order: "0" }
}

function locationToForm(l: Kpi5sLocation): FormState {
  return {
    ma_vi_tri: l.ma_vi_tri,
    ten_vi_tri: l.ten_vi_tri,
    mo_ta: l.mo_ta || "",
    nguoi_don_id: l.nguoi_don_id || "",
    nguoi_cham_id: l.nguoi_cham_id || "",
    zone_id: l.zone_id || "",
    is_active: l.is_active,
    sort_order: String(l.sort_order ?? 0),
  }
}

export function Kpi5sLocationsTab({
  factoryId,
  canManage,
  userOptions,
}: {
  factoryId: string | null
  canManage: boolean
  userOptions: UserOption[]
}) {
  const [locations, setLocations] = useState<Kpi5sLocation[]>([])
  const [zones, setZones] = useState<Kpi5sZone[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [delConfirm, setDelConfirm] = useState<Kpi5sLocation | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState("")

  const [showAutoAssign, setShowAutoAssign] = useState(false)
  const [assignSummary, setAssignSummary] = useState<{ userId: string; ten: string; donZones: string[]; chamZones: string[] }[] | null>(null)

  const nameByUserId = useMemo(() => Object.fromEntries(userOptions.map((u) => [u.id, u.label])), [userOptions])
  const resolveName = useCallback((uid: string | null) => (uid ? nameByUserId[uid] || "Người dùng không xác định" : "— Chưa gán —"), [nameByUserId])
  const zoneNameById = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, z.ten])), [zones])

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    setLoadError("")
    try {
      const [rows, zoneRows] = await Promise.all([
        fetchKpi5sLocations(fid, { includeInactive: true }),
        fetchKpi5sZones(fid, { includeInactive: true }),
      ])
      setLocations(rows)
      setZones(zoneRows)
    } catch (err) {
      setLoadError(getKpi5sErrorMessage(err, "Không tải được danh sách vị trí."))
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

  const openEdit = (l: Kpi5sLocation) => {
    setEditId(l.id)
    setForm(locationToForm(l))
    setSaveError("")
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!factoryId) return
    if (!form.ma_vi_tri.trim() || !form.ten_vi_tri.trim()) {
      setSaveError("Vui lòng nhập Mã vị trí và Tên vị trí.")
      return
    }
    if (form.nguoi_don_id && form.nguoi_cham_id && form.nguoi_don_id === form.nguoi_cham_id) {
      setSaveError("Người dọn và Người chấm phải là 2 người khác nhau.")
      return
    }
    setSaving(true)
    setSaveError("")
    try {
      const payload: Kpi5sLocationInput = {
        factory_id: factoryId,
        ma_vi_tri: form.ma_vi_tri.trim(),
        ten_vi_tri: form.ten_vi_tri.trim(),
        mo_ta: form.mo_ta.trim() || null,
        nguoi_don_id: form.nguoi_don_id || null,
        nguoi_cham_id: form.nguoi_cham_id || null,
        zone_id: form.zone_id || null,
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 0,
      }
      if (editId) {
        await updateKpi5sLocation(editId, payload)
      } else {
        await createKpi5sLocation(payload)
      }
      setModalOpen(false)
      void loadData(factoryId)
    } catch (err) {
      setSaveError(getKpi5sErrorMessage(err, "Không lưu được vị trí."))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (l: Kpi5sLocation) => {
    if (!factoryId) return
    setBusyId(l.id)
    try {
      await updateKpi5sLocation(l.id, { is_active: !l.is_active })
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
      await deleteKpi5sLocation(delConfirm.id)
      setDelConfirm(null)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(delConfirm.id)
        return next
      })
      void loadData(factoryId)
    } catch (err) {
      // Vị trí đã có lịch sử chấm điểm (kpi_5s_evaluations.location_id NOT NULL, không CASCADE)
      // sẽ bị FK chặn xóa — hướng dẫn dùng "Tạm ngưng" thay vì xóa để giữ nguyên lịch sử minh bạch.
      setLoadError(getKpi5sErrorMessage(err, "Không xóa được vị trí — có thể vị trí đã có lịch sử chấm điểm, hãy dùng \"Tạm ngưng\" thay thế."))
      setDelConfirm(null)
    } finally {
      setBusyId(null)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(locations.map((l) => l.id)))
  const clearSelection = () => setSelectedIds(new Set())

  const handlePrintQr = async () => {
    const chosen = locations.filter((l) => selectedIds.has(l.id))
    if (chosen.length === 0) {
      setPrintError("Vui lòng chọn ít nhất 1 vị trí để in QR.")
      return
    }
    setPrinting(true)
    setPrintError("")
    try {
      await downloadKpi5sLocationBulkQrPdf(chosen)
    } catch (err) {
      setPrintError(getKpi5sErrorMessage(err, "Không tạo được file PDF."))
    } finally {
      setPrinting(false)
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        Mỗi vị trí có 1 QR cố định — người chấm quét QR để chấm điểm Đạt/Không đạt hàng tuần.
        Khi về tua, chỉ cần sửa lại &quot;Người dọn&quot;/&quot;Người chấm&quot; ngay tại đây, không cần thao tác gì thêm.
      </p>

      {loadError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{loadError}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canManage && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm text-sm"
          >
            <Plus size={15} /> Thêm vị trí
          </button>
        )}
        {canManage && locations.length > 0 && (
          <button
            onClick={() => { setAssignSummary(null); setShowAutoAssign(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-sm text-sm"
          >
            <Shuffle size={15} /> Phân công thông minh
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <span className="text-xs font-semibold text-slate-500">Đã chọn {selectedIds.size}/{locations.length}</span>
          <button onClick={selectAll} className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100">
            Chọn tất cả
          </button>
          <button onClick={clearSelection} className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100">
            Bỏ chọn
          </button>
          <button
            onClick={() => void handlePrintQr()}
            disabled={printing || selectedIds.size === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-50"
          >
            {printing ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
            In QR hàng loạt ({selectedIds.size})
          </button>
        </div>
      </div>
      {printError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700">{printError}</div>}

      {assignSummary && (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="font-bold mb-1">Đã giao xong:</div>
          <ul className="space-y-0.5 text-xs">
            {assignSummary.map((s) => (
              <li key={s.userId}>
                <strong>{s.ten}</strong>
                {s.donZones.length > 0 && ` — dọn: ${s.donZones.join(", ")}`}
                {s.chamZones.length > 0 && `${s.donZones.length > 0 ? " ·" : " —"} chấm: ${s.chamZones.join(", ")}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {locations.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 p-12 text-center text-slate-400">Chưa có vị trí 5S nào.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {locations.map((l) => (
            <div key={l.id} className={`rounded-2xl border shadow-sm p-4 ${l.is_active ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(l.id)}
                    onChange={() => toggleSelect(l.id)}
                    className="mt-0.5 w-4 h-4 rounded accent-violet-600"
                  />
                  <div>
                    <div className="text-[11px] font-bold text-violet-700">{l.ma_vi_tri}</div>
                    <div className="text-sm font-extrabold text-slate-800">{l.ten_vi_tri}</div>
                  </div>
                </label>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-lg ${l.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                  {l.is_active ? "Đang áp dụng" : "Tạm ngưng"}
                </span>
              </div>

              {l.mo_ta && (
                <div className="mt-1.5 flex items-start gap-1 text-xs text-slate-500">
                  <MapPin size={12} className="mt-0.5 shrink-0" /> {l.mo_ta}
                </div>
              )}

              <div className="mt-2.5 space-y-1 text-xs text-slate-600">
                <div>Người dọn: <strong className="text-slate-800">{resolveName(l.nguoi_don_id)}</strong></div>
                <div>Người chấm: <strong className="text-slate-800">{resolveName(l.nguoi_cham_id)}</strong></div>
                {l.zone_id && (
                  <div>Khu vực: <strong className="text-violet-700">{zoneNameById[l.zone_id] || "—"}</strong></div>
                )}
              </div>

              {canManage && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
                  <button
                    onClick={() => openEdit(l)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-bold"
                  >
                    <Edit2 size={11} /> Sửa
                  </button>
                  <button
                    onClick={() => void handleToggleActive(l)}
                    disabled={busyId === l.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold disabled:opacity-60"
                  >
                    <Power size={11} /> {l.is_active ? "Tạm ngưng" : "Kích hoạt lại"}
                  </button>
                  <button
                    onClick={() => setDelConfirm(l)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold"
                  >
                    <Trash2 size={11} /> Xóa
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <ModalShell
          title={editId ? "Sửa vị trí 5S" : "Thêm vị trí 5S"}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Mã vị trí *</label>
                <input
                  value={form.ma_vi_tri}
                  onChange={(e) => setForm((f) => ({ ...f, ma_vi_tri: e.target.value }))}
                  placeholder="vd: VP-KT"
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
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Tên vị trí *</label>
              <input
                value={form.ten_vi_tri}
                onChange={(e) => setForm((f) => ({ ...f, ten_vi_tri: e.target.value }))}
                placeholder="vd: Phòng Kế toán"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Mô tả</label>
              <input
                value={form.mo_ta}
                onChange={(e) => setForm((f) => ({ ...f, mo_ta: e.target.value }))}
                placeholder="vd: Tầng 1, dãy nhà văn phòng"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Người dọn hiện tại</label>
                <select
                  value={form.nguoi_don_id}
                  onChange={(e) => setForm((f) => ({ ...f, nguoi_don_id: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">— Chưa gán —</option>
                  {userOptions.map((u) => (
                    <option key={u.id} value={u.id} disabled={u.id === form.nguoi_cham_id}>{u.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Người chấm hiện tại</label>
                <select
                  value={form.nguoi_cham_id}
                  onChange={(e) => setForm((f) => ({ ...f, nguoi_cham_id: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">— Chưa gán —</option>
                  {userOptions.map((u) => (
                    <option key={u.id} value={u.id} disabled={u.id === form.nguoi_don_id}>{u.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Khu vực (random nội bộ)</label>
              <select
                value={form.zone_id}
                onChange={(e) => setForm((f) => ({ ...f, zone_id: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              >
                <option value="">— Không giới hạn (pool toàn nhà máy) —</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.ten}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                Dùng để giới hạn random nội bộ khi &quot;Phân công thông minh&quot; — không giới
                hạn khi chọn tay ở đây. Có thể tạo khu vực mới ở tab &quot;Khu vực&quot; cạnh đây
                (vd &quot;Văn phòng&quot;, &quot;Kho 1&quot;, &quot;Kho 2&quot;, &quot;Ca SX mủ tạp&quot;...).
              </p>
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
          title="Xóa vị trí 5S"
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
            Xóa <strong>&quot;{delConfirm.ten_vi_tri}&quot;</strong>? Nếu vị trí đã có lịch sử
            chấm điểm, thao tác này sẽ bị chặn — hãy dùng &quot;Tạm ngưng&quot; thay thế để giữ
            nguyên lịch sử minh bạch.
          </p>
        </ModalShell>
      )}

      {showAutoAssign && factoryId && (
        <Kpi5sAutoAssignModal
          factoryId={factoryId}
          locations={locations}
          onClose={() => setShowAutoAssign(false)}
          onAssigned={(summary) => {
            setShowAutoAssign(false)
            setAssignSummary(summary)
            sendKpiNotify({
              factoryId,
              title: "Phân công vị trí 5S",
              lines: summary.map((s) => {
                const parts: string[] = []
                if (s.donZones.length > 0) parts.push(`dọn: ${s.donZones.join(", ")}`)
                if (s.chamZones.length > 0) parts.push(`chấm: ${s.chamZones.join(", ")}`)
                return `👤 ${s.ten} — ${parts.join(" · ")}`
              }),
              link: "/dashboard/kpi/5s",
            })
            void loadData(factoryId)
          }}
        />
      )}
    </div>
  )
}
