"use client"

// Cài đặt → Chấm công → Điểm QR điểm danh (GĐ C2, rule 31). Mỗi điểm = 1 tem QR dán tại ca; trực ca quét ⇒
// /dashboard/attendance/shift?qr=<token>. "Tạo lại QR" = token mới, tem cũ ngừng hoạt động ngay.
// Xem QR có nút tải PNG; CHỈ admin xoá được điểm QR (tem đã dán ngừng hoạt động).

import { useCallback, useEffect, useState } from "react"
import { Pencil, Plus, Printer, QrCode, RefreshCw, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getErrorMessage } from "@/lib/error-message"
import { ATTENDANCE_DAY_CHUYEN } from "@/lib/attendance/types"
import { UNIT_SELECT, buildAttendanceQrUrl, type AttendanceQrPoint, type AttendanceUnit } from "@/lib/attendance/shift"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"
import { OrderQrDownload } from "../../export/_components/order-qr-download"

type Form = { id: string | null; ten_diem: string; day_chuyen_mac_dinh: string; unit_code: string; unit_codes: string[]; sort_order: string; is_active: boolean }

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
  const [units, setUnits] = useState<AttendanceUnit[]>([])
  const unitName = (code: string) => units.find((u) => u.code === code)?.ten || code

  useEffect(() => {
    if (!factoryId) return
    void supabase
      .from("attendance_units")
      .select(UNIT_SELECT)
      .eq("factory_id", factoryId)
      .order("sort_order")
      .then(({ data }) => setUnits((data || []) as AttendanceUnit[]))
  }, [factoryId])

  const load = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data, error: e } = await supabase
        .from("attendance_qr_points")
        .select("*")
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

  useEffect(() => {
    if (!factoryId) return
    void load(factoryId)
  }, [factoryId, load])


  const save = async () => {
    if (!form || !factoryId) return
    if (!form.ten_diem.trim()) {
      setError("Nhập tên điểm QR.")
      return
    }
    if (form.unit_code && form.unit_codes.length > 0 && !form.unit_codes.includes(form.unit_code)) {
      setError("Ca/Tổ mặc định phải nằm trong danh sách Ca/Tổ được mở bằng QR này.")
      return
    }
    setSaving(true)
    try {
      const payload = {
        factory_id: factoryId,
        ten_diem: form.ten_diem.trim(),
        day_chuyen_mac_dinh: form.day_chuyen_mac_dinh || null,
        unit_code: form.unit_code || null,
        unit_codes: form.unit_codes.length > 0 ? form.unit_codes : null,
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
              onClick={() => setForm({ id: null, ten_diem: "", day_chuyen_mac_dinh: "", unit_code: "", unit_codes: [], sort_order: String(rows.length + 1), is_active: true })}
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
              <th>Ca/Tổ mặc định</th>
              <th className="text-right">Thứ tự</th>
              <th>Trạng thái</th>
              <th className="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">Đang tải...</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">Chưa có điểm QR nào.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.ten_diem}</td>
                  <td>{r.day_chuyen_mac_dinh || "— (trực ca chọn)"}</td>
                  <td>
                    {r.unit_code ? unitName(r.unit_code) : "— (theo phân công)"}
                    {r.unit_codes && r.unit_codes.length > 0 ? (
                      <div className="mt-0.5 text-[11px] text-slate-500">Mở được: {r.unit_codes.map(unitName).join(", ")}</div>
                    ) : null}
                  </td>
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
                              setForm({ id: r.id, ten_diem: r.ten_diem, day_chuyen_mac_dinh: r.day_chuyen_mac_dinh || "", unit_code: r.unit_code || "", unit_codes: r.unit_codes || [], sort_order: String(r.sort_order), is_active: r.is_active })
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
              <span className="mb-1 block text-xs font-bold text-slate-600">Ca/Tổ mặc định</span>
              <select value={form.unit_code} onChange={(e) => setForm({ ...form, unit_code: e.target.value })} className={inputCls}>
                <option value="">— Theo phân công của người quét —</option>
                {units
                  .filter((u) => u.is_active || u.code === form.unit_code)
                  .map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.ten}
                    </option>
                  ))}
              </select>
              <span className="mt-1 block text-[11px] text-slate-400">Quét QR mở sẵn Ca/Tổ này nếu người quét được phân công (hoặc chấm toàn nhà máy).</span>
            </label>
            <div>
              <span className="mb-1 block text-xs font-bold text-slate-600">Ca/Tổ được mở bằng QR này</span>
              <div className="flex flex-wrap gap-1.5">
                {units
                  .filter(
                    (u) =>
                      (u.is_active || form.unit_codes.includes(u.code)) &&
                      (!form.day_chuyen_mac_dinh || !u.day_chuyen || u.day_chuyen === form.day_chuyen_mac_dinh),
                  )
                  .map((u) => {
                    const on = form.unit_codes.includes(u.code)
                    return (
                      <button
                        key={u.code}
                        type="button"
                        onClick={() =>
                          setForm({ ...form, unit_codes: on ? form.unit_codes.filter((c) => c !== u.code) : [...form.unit_codes, u.code] })
                        }
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-600"}`}
                      >
                        {u.ten}
                      </button>
                    )
                  })}
              </div>
              <span className="mt-1 block text-[11px] text-slate-400">
                Không chọn = mọi Ca/Tổ. Quét QR chỉ thấy các Ca/Tổ đã chọn; QR có dây chuyền mặc định thì khoá luôn dây chuyền đó.
              </span>
            </div>
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
