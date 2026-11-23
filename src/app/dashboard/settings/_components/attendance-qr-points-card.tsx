"use client"

// Cài đặt → Chấm công → Điểm QR điểm danh (GĐ C2, rule 31). Mỗi điểm = 1 tem QR dán tại ca; trực ca quét ⇒
// /dashboard/attendance/shift?qr=<token>. "Tạo lại QR" = token mới, tem cũ ngừng hoạt động ngay.
// Xem QR có nút tải PNG; CHỈ admin xoá được điểm QR (tem đã dán ngừng hoạt động).

import { useCallback, useEffect, useState } from "react"
import { Pencil, Plus, Printer, QrCode, RefreshCw, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getErrorMessage } from "@/lib/error-message"
import { ATTENDANCE_DAY_CHUYEN } from "@/lib/attendance/types"
import { buildAttendanceQrUrl, type AttendanceQrPoint } from "@/lib/attendance/shift"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"
import { OrderQrDownload } from "../../export/_components/order-qr-download"

type GroupRow = { id: string; name: string; code: string | null; hien_diem_danh: boolean; is_active: boolean; diem_danh_to_nhom?: string | null }

// Loại việc hiện ở thẻ nhóm (personnel_groups.diem_danh_to_nhom, migration 20261207).
const TAB_JOB_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Mọi tổ (trừ ca sản xuất)" },
  { value: "tiep_nhan", label: "Tổ tiếp nhận" },
  { value: "co_dien", label: "Cơ điện – nâng hàng" },
  { value: "ca_san_xuat", label: "Ca sản xuất" },
]

type Form = { id: string | null; ten_diem: string; day_chuyen_mac_dinh: string; sort_order: string; is_active: boolean }

const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"

function newToken() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let bin = ""
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
}

export function AttendanceQrPointsCard({ factoryId, canManage, isAdmin = false }: { factoryId: string | null; canManage: boolean; isAdmin?: boolean }) {
  const [rows, setRows] = useState<AttendanceQrPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [viewQr, setViewQr] = useState<AttendanceQrPoint | null>(null)
  const [regen, setRegen] = useState<AttendanceQrPoint | null>(null)
  const [regenAck, setRegenAck] = useState(false)
  const [delRow, setDelRow] = useState<AttendanceQrPoint | null>(null)
  const [printing, setPrinting] = useState(false)
  const [groups, setGroups] = useState<GroupRow[] | null>(null)
  const [groupError, setGroupError] = useState<string | null>(null)

  const load = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data, error: e } = await supabase
        .from("attendance_qr_points")
        .select("id, factory_id, token, ten_diem, day_chuyen_mac_dinh, is_active, sort_order")
        .eq("factory_id", fid)
        .order("sort_order")
        .order("ten_diem")
      if (e) throw e
      setRows((data || []) as AttendanceQrPoint[])
      setError(null)
    } catch (err) {
      const m = getErrorMessage(err, "Không tải được điểm QR.")
      setError(/attendance_qr_points/.test(m) ? "Chưa có bảng điểm QR — chạy migration 20261205_attendance_c2_shift_sheets.sql." : m)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadGroups = useCallback(async (fid: string) => {
    const { data, error: e } = await supabase
      .from("personnel_groups")
      .select("*")
      .eq("factory_id", fid)
      .order("sort_order")
      .order("name")
    if (e) {
      setGroupError(/hien_diem_danh/.test(e.message) ? "Chưa có cột hien_diem_danh — chạy migration 20261206_attendance_c2b_grid.sql." : e.message)
      setGroups([])
      return
    }
    setGroupError(null)
    setGroups((data || []) as GroupRow[])
  }, [])

  useEffect(() => {
    if (!factoryId) return
    void load(factoryId)
    void loadGroups(factoryId)
  }, [factoryId, load, loadGroups])

  const toggleGroup = async (g: GroupRow) => {
    if (!factoryId) return
    const { error: e } = await supabase.from("personnel_groups").update({ hien_diem_danh: !g.hien_diem_danh }).eq("id", g.id).eq("factory_id", factoryId)
    if (e) {
      setGroupError(getErrorMessage(e, "Không lưu được."))
      return
    }
    setGroups((prev) => (prev || []).map((x) => (x.id === g.id ? { ...x, hien_diem_danh: !x.hien_diem_danh } : x)))
  }

  const setGroupJobs = async (g: GroupRow, value: string) => {
    if (!factoryId) return
    const { error: e } = await supabase
      .from("personnel_groups")
      .update({ diem_danh_to_nhom: value || null })
      .eq("id", g.id)
      .eq("factory_id", factoryId)
    if (e) {
      setGroupError(/diem_danh_to_nhom/.test(e.message) ? "Chưa có cột diem_danh_to_nhom — chạy migration 20261207_attendance_tabs_snapshots.sql." : getErrorMessage(e, "Không lưu được."))
      return
    }
    setGroups((prev) => (prev || []).map((x) => (x.id === g.id ? { ...x, diem_danh_to_nhom: value || null } : x)))
  }

  const save = async () => {
    if (!form || !factoryId) return
    if (!form.ten_diem.trim()) {
      setError("Nhập tên điểm QR.")
      return
    }
    setSaving(true)
    try {
      const payload = {
        factory_id: factoryId,
        ten_diem: form.ten_diem.trim(),
        day_chuyen_mac_dinh: form.day_chuyen_mac_dinh || null,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      }
      const res = form.id
        ? await supabase.from("attendance_qr_points").update(payload).eq("id", form.id).eq("factory_id", factoryId)
        : await supabase.from("attendance_qr_points").insert(payload)
      if (res.error) throw res.error
      setForm(null)
      void load(factoryId)
    } catch (err) {
      setError(getErrorMessage(err, "Không lưu được điểm QR."))
    } finally {
      setSaving(false)
    }
  }

  const doRegen = async () => {
    if (!regen || !factoryId) return
    setSaving(true)
    try {
      const { error: e } = await supabase.from("attendance_qr_points").update({ token: newToken() }).eq("id", regen.id).eq("factory_id", factoryId)
      if (e) throw e
      setRegen(null)
      setRegenAck(false)
      void load(factoryId)
    } catch (err) {
      setError(getErrorMessage(err, "Không tạo lại được QR."))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!delRow || !factoryId || !isAdmin) return
    setSaving(true)
    try {
      const { error: e } = await supabase.from("attendance_qr_points").delete().eq("id", delRow.id).eq("factory_id", factoryId)
      if (e) throw e
      setDelRow(null)
      void load(factoryId)
    } catch (err) {
      setError(getErrorMessage(err, "Không xoá được điểm QR."))
    } finally {
      setSaving(false)
    }
  }

  const printLabels = async () => {
    const active = rows.filter((r) => r.is_active)
    if (active.length === 0) return
    setPrinting(true)
    try {
      const { buildQrLabelsPdf } = await import("@/lib/equipment-qr-pdf")
      const doc = await buildQrLabelsPdf(
        active.map((r) => ({ code: r.ten_diem, name: r.day_chuyen_mac_dinh ? `Điểm danh · ${r.day_chuyen_mac_dinh}` : "Điểm danh ca", url: buildAttendanceQrUrl(r.token) })),
        "Tem QR điểm danh ca — cắt theo đường viền",
      )
      doc.save("Tem QR diem danh ca.pdf")
    } catch (err) {
      setError(getErrorMessage(err, "Không in được tem."))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          Dán tem tại ca. Trực ca quét bằng điện thoại ⇒ mở màn <b>Điểm danh ca</b> (chưa đăng nhập thì đăng nhập trước). Dây chuyền mặc định
          chọn sẵn dây chuyền trên màn điểm danh. <b>Tạo lại QR</b> làm tem cũ ngừng hoạt động ngay.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={printLabels}
            disabled={printing || rows.every((r) => !r.is_active)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
          >
            <Printer size={15} /> In tem QR
          </button>
          {canManage ? (
            <button
              type="button"
              onClick={() => setForm({ id: null, ten_diem: "", day_chuyen_mac_dinh: "", sort_order: String(rows.length + 1), is_active: true })}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
            >
              <Plus size={15} /> Thêm điểm QR
            </button>
          ) : null}
        </div>
      </div>
      {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[640px]">
          <thead>
            <tr>
              <th>Tên điểm</th>
              <th>Dây chuyền mặc định</th>
              <th className="text-right">Thứ tự</th>
              <th>Trạng thái</th>
              <th className="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">Đang tải...</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">Chưa có điểm QR nào.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.ten_diem}</td>
                  <td>{r.day_chuyen_mac_dinh || "— (trực ca chọn)"}</td>
                  <td className="text-right">{r.sort_order}</td>
                  <td>{r.is_active ? <span className="text-emerald-700">Đang dùng</span> : <span className="text-slate-400">Ngừng</span>}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button type="button" title="Xem QR" onClick={() => setViewQr(r)} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100">
                        <QrCode size={15} />
                      </button>
                      {canManage ? (
                        <>
                          <button
                            type="button"
                            title="Sửa"
                            onClick={() =>
                              setForm({ id: r.id, ten_diem: r.ten_diem, day_chuyen_mac_dinh: r.day_chuyen_mac_dinh || "", sort_order: String(r.sort_order), is_active: r.is_active })
                            }
                            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
                          >
                            <Pencil size={15} />
                          </button>
                          <button type="button" title="Tạo lại QR" onClick={() => setRegen(r)} className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50">
                            <RefreshCw size={15} />
                          </button>
                        </>
                      ) : null}
                      {isAdmin ? (
                        <button type="button" title="Xoá điểm QR" onClick={() => setDelRow(r)} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50">
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-bold text-slate-800">Thẻ nhóm ở màn điểm danh</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Ngoài thẻ công nhân của ca, màn điểm danh hiện thêm 1 thẻ cho mỗi nhóm nhân sự được tick (vd Cơ điện, Bảo trì) để trực ca
          giao việc cơ điện – nâng hàng. Thành viên nhóm quản lý ở Cài đặt → Nhân sự. Thành viên nhóm có thẻ riêng KHÔNG hiện ở
          thẻ Ca. Mục &ldquo;Loại việc&rdquo; quyết định các việc trực ca chọn được trong thẻ đó.
        </p>
        {groupError ? <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{groupError}</div> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {(groups || []).filter((g) => g.is_active).map((g) => (
            <label
              key={g.id}
              className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-semibold ${g.hien_diem_danh ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600"}`}
            >
              <input type="checkbox" checked={g.hien_diem_danh} disabled={!canManage} onChange={() => void toggleGroup(g)} />
              {g.name}
              {g.code ? <span className="text-xs font-normal text-slate-400">({g.code})</span> : null}
            </label>
          ))}
        </div>
        {(groups || []).some((g) => g.is_active && g.hien_diem_danh) ? (
          <div className="mt-3 space-y-1.5">
            <div className="text-xs font-bold text-slate-600">Loại việc của từng thẻ</div>
            {(groups || [])
              .filter((g) => g.is_active && g.hien_diem_danh)
              .map((g) => (
                <div key={g.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-sm font-semibold text-slate-700 sm:w-48 sm:shrink-0">{g.name}</span>
                  <select
                    value={g.diem_danh_to_nhom || ""}
                    disabled={!canManage}
                    onChange={(e) => void setGroupJobs(g, e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm sm:w-72"
                  >
                    {TAB_JOB_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
          </div>
        ) : null}
      </div>

      {form ? (
        <ModalShell title={form.id ? "Sửa điểm QR" : "Thêm điểm QR"} onClose={() => setForm(null)} maxWidth="md">
          <div className="space-y-3 p-4">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">Tên điểm *</span>
              <input value={form.ten_diem} onChange={(e) => setForm({ ...form, ten_diem: e.target.value })} className={inputCls} placeholder="vd Xưởng Mủ tạp — cửa ca" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">Dây chuyền mặc định</span>
              <select value={form.day_chuyen_mac_dinh} onChange={(e) => setForm({ ...form, day_chuyen_mac_dinh: e.target.value })} className={inputCls}>
                <option value="">— Trực ca tự chọn —</option>
                {ATTENDANCE_DAY_CHUYEN.map((dc) => (
                  <option key={dc} value={dc}>
                    {dc}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">Thứ tự</span>
              <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} className={inputCls} />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Đang dùng
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold">
                Huỷ
              </button>
              <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {viewQr ? (
        <ModalShell title={viewQr.ten_diem} onClose={() => setViewQr(null)} maxWidth="sm">
          <div className="flex flex-col items-center gap-3 p-5">
            <OrderQrDownload value={buildAttendanceQrUrl(viewQr.token)} code={viewQr.ten_diem} size={220} />
            <div className="break-all text-center text-xs text-slate-500">{buildAttendanceQrUrl(viewQr.token)}</div>
          </div>
        </ModalShell>
      ) : null}

      {delRow ? (
        <ModalShell title="Xoá điểm QR" onClose={() => setDelRow(null)} maxWidth="md">
          <div className="space-y-3 p-4 text-sm">
            <p>
              Xoá điểm <b>{delRow.ten_diem}</b>? Tem QR đang dán tại điểm này sẽ <b>ngừng hoạt động</b>. Phiếu điểm danh đã lập không bị ảnh
              hưởng. Muốn tạm ngừng mà giữ lại, hãy Sửa và bỏ tick &ldquo;Đang dùng&rdquo;.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDelRow(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-bold">
                Huỷ
              </button>
              <button type="button" onClick={doDelete} disabled={saving} className="rounded-xl bg-rose-600 px-4 py-2 font-bold text-white disabled:opacity-50">
                {saving ? "Đang xoá..." : "Xoá"}
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {regen ? (
        <ModalShell title="Tạo lại QR" onClose={() => { setRegen(null); setRegenAck(false) }} maxWidth="md">
          <div className="space-y-3 p-4 text-sm">
            <p>
              Tạo mã mới cho <b>{regen.ten_diem}</b>. Tem đang dán sẽ <b>ngừng hoạt động ngay</b> — nhớ in và dán tem mới.
            </p>
            <label className="flex items-start gap-2 font-semibold text-slate-700">
              <input type="checkbox" checked={regenAck} onChange={(e) => setRegenAck(e.target.checked)} className="mt-0.5" /> Tôi hiểu tem cũ sẽ ngừng hoạt động.
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setRegen(null); setRegenAck(false) }} className="rounded-xl border border-slate-300 px-4 py-2 font-bold">
                Huỷ
              </button>
              <button type="button" onClick={doRegen} disabled={!regenAck || saving} className="rounded-xl bg-amber-600 px-4 py-2 font-bold text-white disabled:opacity-50">
                Tạo lại
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  )
}
