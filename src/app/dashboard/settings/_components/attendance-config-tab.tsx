"use client"

// Cài đặt → Chấm công (GĐ C0, 2026-11-19): danh mục Công việc (theo dây chuyền + tổ, Việt + Khmer, số người
// gợi ý, loại xe) và Lý do vắng (Việt + Khmer). Tên Khmer hiện ở màn điểm danh của trực ca và phiếu F01/F02.
// Kế hoạch: .claude/plans/cham-cong-2026-11-19.md.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getErrorMessage } from "@/lib/error-message"
import {
  ATTENDANCE_DAY_CHUYEN,
  ATTENDANCE_TO_NHOM,
  toNhomLabel,
  type AttendanceAbsenceReason,
  type AttendanceDayChuyen,
  type AttendanceJobType,
  type AttendanceToNhom,
} from "@/lib/attendance/types"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"
import { AttendanceQrPointsCard } from "./attendance-qr-points-card"

type SubTab = "jobs" | "reasons" | "qr"

type JobForm = {
  id: string | null
  day_chuyen: AttendanceDayChuyen
  to_nhom: AttendanceToNhom
  ten: string
  ten_khmer: string
  so_nguoi_goi_y: string
  loai_xe: string
  sort_order: string
  is_active: boolean
  an_diem_danh: boolean
}

type ReasonForm = {
  id: string | null
  ten: string
  ten_khmer: string
  sort_order: string
  is_active: boolean
}

const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
const labelCls = "mb-1.5 block text-xs font-bold text-slate-600"

function tableMissingMessage(message: string) {
  return /attendance_(job_types|absence_reasons)/.test(message) && /does not exist|schema cache|Could not find/i.test(message)
    ? "Chưa có bảng danh mục chấm công — chạy migration 20261201_attendance_c0_foundation.sql."
    : message
}

export function AttendanceConfigTab({ factoryId, canManage, isAdmin = false }: { factoryId: string | null; canManage: boolean; isAdmin?: boolean }) {
  const [subTab, setSubTab] = useState<SubTab>("jobs")
  const [dayChuyen, setDayChuyen] = useState<AttendanceDayChuyen>("Mủ tạp")
  const [jobs, setJobs] = useState<AttendanceJobType[]>([])
  const [reasons, setReasons] = useState<AttendanceAbsenceReason[]>([])
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [jobForm, setJobForm] = useState<JobForm | null>(null)
  const [reasonForm, setReasonForm] = useState<ReasonForm | null>(null)
  const [delJob, setDelJob] = useState<AttendanceJobType | null>(null)
  const [delReason, setDelReason] = useState<AttendanceAbsenceReason | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const [jobRes, reasonRes, vehRes] = await Promise.all([
        supabase
          .from("attendance_job_types")
          .select("*")
          .eq("factory_id", fid)
          .order("sort_order")
          .order("ten"),
        supabase
          .from("attendance_absence_reasons")
          .select("id, factory_id, ten, ten_khmer, sort_order, is_active")
          .eq("factory_id", fid)
          .order("sort_order")
          .order("ten"),
        supabase.from("dispatch_vehicles").select("vehicle_type").eq("factory_id", fid),
      ])
      const err = jobRes.error || reasonRes.error
      if (err) {
        setError(tableMissingMessage(err.message))
        setJobs([])
        setReasons([])
        return
      }
      setError(null)
      setJobs((jobRes.data || []) as AttendanceJobType[])
      setReasons((reasonRes.data || []) as AttendanceAbsenceReason[])
      const types = new Set<string>()
      for (const v of vehRes.data || []) {
        const t = String(v.vehicle_type || "").trim()
        if (t) types.add(t)
      }
      setVehicleTypes([...types].sort((a, b) => a.localeCompare(b, "vi")))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void load(factoryId)
  }, [factoryId, load])

  const hasAnDiemDanhCol = jobs.length === 0 || "an_diem_danh" in jobs[0]

  const jobsByGroup = useMemo(() => {
    const shown = jobs.filter((j) => j.day_chuyen === dayChuyen)
    return ATTENDANCE_TO_NHOM.map((to) => ({ to, rows: shown.filter((j) => j.to_nhom === to) })).filter((g) => g.rows.length > 0)
  }, [jobs, dayChuyen])

  const openNewJob = () => {
    setFormError(null)
    const maxOrder = jobs.filter((j) => j.day_chuyen === dayChuyen).reduce((m, j) => Math.max(m, j.sort_order || 0), 0)
    setJobForm({
      id: null,
      day_chuyen: dayChuyen,
      to_nhom: "ca_san_xuat",
      ten: "",
      ten_khmer: "",
      so_nguoi_goi_y: "1",
      loai_xe: "",
      sort_order: String(maxOrder + 10),
      is_active: true,
      an_diem_danh: false,
    })
  }

  const saveJob = async () => {
    if (!factoryId || !jobForm) return
    const ten = jobForm.ten.trim()
    if (!ten) {
      setFormError("Nhập tên công việc.")
      return
    }
    const soNguoi = Number(jobForm.so_nguoi_goi_y)
    if (!Number.isInteger(soNguoi) || soNguoi < 0 || soNguoi > 50) {
      setFormError("Số người gợi ý phải là số nguyên từ 0 đến 50.")
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        factory_id: factoryId,
        day_chuyen: jobForm.day_chuyen,
        to_nhom: jobForm.to_nhom,
        ten,
        ten_khmer: jobForm.ten_khmer.trim() || null,
        so_nguoi_goi_y: soNguoi,
        loai_xe: jobForm.loai_xe.trim() || null,
        sort_order: Number(jobForm.sort_order) || 0,
        is_active: jobForm.is_active,
        // Cột có từ migration 20261207 — chưa chạy thì không gửi (giữ form chạy như cũ).
        ...(hasAnDiemDanhCol ? { an_diem_danh: jobForm.an_diem_danh } : {}),
      }
      const { error: err } = jobForm.id
        ? await supabase.from("attendance_job_types").update(payload).eq("id", jobForm.id).eq("factory_id", factoryId)
        : await supabase.from("attendance_job_types").insert(payload)
      if (err) {
        setFormError(
          err.code === "23505"
            ? `Công việc "${ten}" đã có trong ${toNhomLabel(jobForm.to_nhom, jobForm.day_chuyen)} (${jobForm.day_chuyen}).`
            : getErrorMessage(err, "Không lưu được, thử lại."),
        )
        return
      }
      setJobForm(null)
      void load(factoryId)
    } finally {
      setSaving(false)
    }
  }

  const saveReason = async () => {
    if (!factoryId || !reasonForm) return
    const ten = reasonForm.ten.trim()
    if (!ten) {
      setFormError("Nhập lý do.")
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        factory_id: factoryId,
        ten,
        ten_khmer: reasonForm.ten_khmer.trim() || null,
        sort_order: Number(reasonForm.sort_order) || 0,
        is_active: reasonForm.is_active,
      }
      const { error: err } = reasonForm.id
        ? await supabase.from("attendance_absence_reasons").update(payload).eq("id", reasonForm.id).eq("factory_id", factoryId)
        : await supabase.from("attendance_absence_reasons").insert(payload)
      if (err) {
        setFormError(err.code === "23505" ? `Lý do "${ten}" đã có.` : getErrorMessage(err, "Không lưu được, thử lại."))
        return
      }
      setReasonForm(null)
      void load(factoryId)
    } finally {
      setSaving(false)
    }
  }

  const removeTarget = async () => {
    if (!factoryId) return
    const table = delJob ? "attendance_job_types" : "attendance_absence_reasons"
    const id = delJob?.id || delReason?.id
    if (!id) return
    setSaving(true)
    try {
      const { error: err } = await supabase.from(table).delete().eq("id", id).eq("factory_id", factoryId)
      if (err) {
        setError(getErrorMessage(err, "Không lưu được, thử lại."))
        return
      }
      setDelJob(null)
      setDelReason(null)
      void load(factoryId)
    } finally {
      setSaving(false)
    }
  }

  const subTabBtn = (key: SubTab, label: string, count: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setSubTab(key)}
      className={
        "rounded-t-xl border-b-2 px-4 py-2 text-sm font-bold transition-all " +
        (subTab === key ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-transparent text-slate-500 hover:bg-slate-50")
      }
    >
      {label} <span className="ml-1 text-xs font-semibold text-slate-400">{count}</span>
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-slate-100">
        {subTabBtn("jobs", "Công việc", jobs.length)}
        {subTabBtn("reasons", "Lý do vắng", reasons.length)}
        <button
          type="button"
          onClick={() => setSubTab("qr")}
          className={
            "rounded-t-xl border-b-2 px-4 py-2 text-sm font-bold transition-all " +
            (subTab === "qr" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-transparent text-slate-500 hover:bg-slate-50")
          }
        >
          Điểm QR điểm danh
        </button>
      </div>

      {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}

      {subTab === "qr" ? <AttendanceQrPointsCard factoryId={factoryId} canManage={canManage} isAdmin={isAdmin} /> : subTab === "jobs" ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {ATTENDANCE_DAY_CHUYEN.map((dc) => (
                <button
                  key={dc}
                  type="button"
                  onClick={() => setDayChuyen(dc)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold ${
                    dayChuyen === dc ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"
                  }`}
                >
                  {dc} {dc === "Mủ tạp" ? "(F01)" : "(F02)"}
                </button>
              ))}
            </div>
            {canManage ? (
              <button
                type="button"
                onClick={openNewJob}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
              >
                <Plus size={15} /> Thêm công việc
              </button>
            ) : null}
          </div>
          <p className="text-xs leading-5 text-slate-500">
            Công việc hiện ở form điểm danh của trực ca theo tổ, đúng thứ tự dưới đây. <b>Số người gợi ý</b> = số dòng
            hiện sẵn như mẫu giấy (vd Ra lò 4 người). <b>Loại xe</b>: công việc lái xe thì form có thêm ô chọn xe, mặc
            định xe mà người đó là tài xế chính/phụ. Tên Khmer dùng khi trực ca chuyển sang tiếng Khmer và in phiếu
            F01/F02 song ngữ. Không dùng nữa thì <b>tắt</b> thay vì xoá.
          </p>

          <ResponsiveTableWrapper>
            <table className="enterprise-table dense min-w-[760px]">
              <thead>
                <tr>
                  <th>Công việc</th>
                  <th>Tên Khmer</th>
                  <th className="text-right">Số người gợi ý</th>
                  <th>Loại xe</th>
                  <th className="text-right">Thứ tự</th>
                  <th>Trạng thái</th>
                  {canManage ? <th className="text-right">Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">Đang tải...</td>
                  </tr>
                ) : jobsByGroup.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">Chưa có công việc nào cho {dayChuyen}</td>
                  </tr>
                ) : (
                  jobsByGroup.map((g) => [
                    <tr key={`h-${g.to}`} className="bg-slate-50">
                      <td colSpan={7} className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                        {toNhomLabel(g.to, dayChuyen)} · {g.rows.length}
                      </td>
                    </tr>,
                    ...g.rows.map((r) => (
                      <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                        <td className="font-semibold text-slate-700">{r.ten}</td>
                        <td className="text-slate-600">{r.ten_khmer || <span className="text-amber-600">Chưa có</span>}</td>
                        <td className="text-right">{r.so_nguoi_goi_y}</td>
                        <td className="text-slate-600">{r.loai_xe || "—"}</td>
                        <td className="text-right">{r.sort_order}</td>
                        <td>
                          {r.is_active ? "Đang dùng" : "Đã tắt"}
                          {r.an_diem_danh ? <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500">Ẩn ở điểm danh</span> : null}
                        </td>
                        {canManage ? (
                          <td className="text-right">
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                title="Sửa"
                                onClick={() => {
                                  setFormError(null)
                                  setJobForm({
                                    id: r.id,
                                    day_chuyen: r.day_chuyen,
                                    to_nhom: r.to_nhom,
                                    ten: r.ten,
                                    ten_khmer: r.ten_khmer || "",
                                    so_nguoi_goi_y: String(r.so_nguoi_goi_y),
                                    loai_xe: r.loai_xe || "",
                                    sort_order: String(r.sort_order ?? 0),
                                    is_active: r.is_active,
                                    an_diem_danh: !!r.an_diem_danh,
                                  })
                                }}
                                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                              >
                                <Pencil size={15} />
                              </button>
                              <button type="button" title="Xoá" onClick={() => setDelJob(r)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    )),
                  ])
                )}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-xs leading-5 text-slate-500">
              Lý do hiện khi trực ca chấm <b>Vắng không phép</b>. Trực ca thêm nhanh được lý do mới ngay trên form điểm
              danh; ở đây sửa tên, bổ sung tên Khmer, sắp xếp hoặc tắt.
            </p>
            {canManage ? (
              <button
                type="button"
                onClick={() => {
                  setFormError(null)
                  const maxOrder = reasons.reduce((m, r) => Math.max(m, r.sort_order || 0), 0)
                  setReasonForm({ id: null, ten: "", ten_khmer: "", sort_order: String(maxOrder + 10), is_active: true })
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
              >
                <Plus size={15} /> Thêm lý do
              </button>
            ) : null}
          </div>
          <ResponsiveTableWrapper>
            <table className="enterprise-table dense min-w-[560px]">
              <thead>
                <tr>
                  <th>Lý do</th>
                  <th>Tên Khmer</th>
                  <th className="text-right">Thứ tự</th>
                  <th>Trạng thái</th>
                  {canManage ? <th className="text-right">Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">Đang tải...</td>
                  </tr>
                ) : reasons.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">Chưa có lý do vắng nào</td>
                  </tr>
                ) : (
                  reasons.map((r) => (
                    <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                      <td className="font-semibold text-slate-700">{r.ten}</td>
                      <td className="text-slate-600">{r.ten_khmer || <span className="text-amber-600">Chưa có</span>}</td>
                      <td className="text-right">{r.sort_order}</td>
                      <td>{r.is_active ? "Đang dùng" : "Đã tắt"}</td>
                      {canManage ? (
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              title="Sửa"
                              onClick={() => {
                                setFormError(null)
                                setReasonForm({
                                  id: r.id,
                                  ten: r.ten,
                                  ten_khmer: r.ten_khmer || "",
                                  sort_order: String(r.sort_order ?? 0),
                                  is_active: r.is_active,
                                })
                              }}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                            >
                              <Pencil size={15} />
                            </button>
                            <button type="button" title="Xoá" onClick={() => setDelReason(r)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        </div>
      )}

      {jobForm ? (
        <ModalShell
          title={jobForm.id ? "Sửa công việc" : "Thêm công việc"}
          onClose={() => setJobForm(null)}
          maxWidth="lg"
          footer={
            <>
              <button type="button" onClick={() => setJobForm(null)} className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
                Huỷ
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveJob()}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {formError ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{formError}</div> : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Dây chuyền *</label>
                <select
                  value={jobForm.day_chuyen}
                  onChange={(e) => setJobForm({ ...jobForm, day_chuyen: e.target.value as AttendanceDayChuyen })}
                  className={inputCls}
                >
                  {ATTENDANCE_DAY_CHUYEN.map((dc) => (
                    <option key={dc} value={dc}>{dc}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Tổ *</label>
                <select
                  value={jobForm.to_nhom}
                  onChange={(e) => setJobForm({ ...jobForm, to_nhom: e.target.value as AttendanceToNhom })}
                  className={inputCls}
                >
                  {ATTENDANCE_TO_NHOM.map((to) => (
                    <option key={to} value={to}>{toNhomLabel(to, jobForm.day_chuyen)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Tên công việc (tiếng Việt) *</label>
              <input value={jobForm.ten} onChange={(e) => setJobForm({ ...jobForm, ten: e.target.value })} placeholder="VD: Ra lò" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Tên công việc (tiếng Khmer)</label>
              <input
                value={jobForm.ten_khmer}
                onChange={(e) => setJobForm({ ...jobForm, ten_khmer: e.target.value })}
                placeholder="VD: ចេញឡាំង"
                className={inputCls}
                lang="km"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={labelCls}>Số người gợi ý</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={jobForm.so_nguoi_goi_y}
                  onChange={(e) => setJobForm({ ...jobForm, so_nguoi_goi_y: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Loại xe</label>
                <select value={jobForm.loai_xe} onChange={(e) => setJobForm({ ...jobForm, loai_xe: e.target.value })} className={inputCls}>
                  <option value="">Không cần chọn xe</option>
                  {[...new Set([...vehicleTypes, ...(jobForm.loai_xe ? [jobForm.loai_xe] : [])])].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Thứ tự</label>
                <input type="number" value={jobForm.sort_order} onChange={(e) => setJobForm({ ...jobForm, sort_order: e.target.value })} className={inputCls} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              <input type="checkbox" checked={jobForm.is_active} onChange={(e) => setJobForm({ ...jobForm, is_active: e.target.checked })} />
              Đang dùng
            </label>
            {hasAnDiemDanhCol ? (
              <label className="flex items-start gap-2 text-sm font-semibold text-slate-600">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={jobForm.an_diem_danh}
                  onChange={(e) => setJobForm({ ...jobForm, an_diem_danh: e.target.checked })}
                />
                <span>
                  Ẩn ở màn điểm danh
                  <span className="block text-xs font-normal text-slate-500">
                    Trực ca không giao việc này (vd Trực xuất hàng — người tạo đơn xuất chọn người). Vẫn in trên phiếu F01/F02.
                  </span>
                </span>
              </label>
            ) : null}
          </div>
        </ModalShell>
      ) : null}

      {reasonForm ? (
        <ModalShell
          title={reasonForm.id ? "Sửa lý do vắng" : "Thêm lý do vắng"}
          onClose={() => setReasonForm(null)}
          maxWidth="md"
          footer={
            <>
              <button type="button" onClick={() => setReasonForm(null)} className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
                Huỷ
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveReason()}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {formError ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{formError}</div> : null}
            <div>
              <label className={labelCls}>Lý do (tiếng Việt) *</label>
              <input value={reasonForm.ten} onChange={(e) => setReasonForm({ ...reasonForm, ten: e.target.value })} placeholder="VD: Ốm, sốt" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Lý do (tiếng Khmer)</label>
              <input value={reasonForm.ten_khmer} onChange={(e) => setReasonForm({ ...reasonForm, ten_khmer: e.target.value })} className={inputCls} lang="km" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Thứ tự</label>
                <input type="number" value={reasonForm.sort_order} onChange={(e) => setReasonForm({ ...reasonForm, sort_order: e.target.value })} className={inputCls} />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-600">
                <input type="checkbox" checked={reasonForm.is_active} onChange={(e) => setReasonForm({ ...reasonForm, is_active: e.target.checked })} />
                Đang dùng
              </label>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {delJob || delReason ? (
        <ModalShell
          title={delJob ? "Xoá công việc" : "Xoá lý do vắng"}
          onClose={() => {
            setDelJob(null)
            setDelReason(null)
          }}
          maxWidth="sm"
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setDelJob(null)
                  setDelReason(null)
                }}
                className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void removeTarget()}
                className="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                Xoá
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xoá <b>{delJob?.ten || delReason?.ten}</b>?
            {delJob ? " Nhân sự đang lấy công việc này làm mặc định sẽ bị bỏ trống công việc mặc định." : ""} Nên{" "}
            <b>tắt</b> thay vì xoá để giữ đúng phiếu điểm danh cũ.
          </p>
        </ModalShell>
      ) : null}
    </div>
  )
}
