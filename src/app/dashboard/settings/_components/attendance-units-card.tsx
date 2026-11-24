"use client"

// Danh mục Ca / Tổ điểm danh (migration 20261210, rule 31). Mỗi Ca/Tổ = 1 phiếu con trong phiếu TKSX của dây chuyền
// người điểm danh chọn. Ca ⇒ Ca trưởng / Ca phó; Tổ ⇒ Tổ trưởng / Tổ phó (gán ở hồ sơ Nhân sự). Không xoá — chỉ tắt.

import { useCallback, useEffect, useState } from "react"
import { Pencil, Plus } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getErrorMessage } from "@/lib/error-message"
import { UNIT_SELECT, type AttendanceUnit } from "@/lib/attendance/shift"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"

type Form = {
  id: string | null
  code: string
  ten: string
  ten_khmer: string
  loai: "ca" | "to"
  to_nhom: string
  day_chuyen: string
  sort_order: string
  is_active: boolean
}

// Dây chuyền của Ca/Tổ (migration 20261211). "" = chọn khi điểm danh (Ca A/B/C) hoặc tổ độc lập.
const DAY_CHUYEN_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Chọn khi điểm danh / tổ độc lập" },
  { value: "Mủ tạp", label: "Chỉ Mủ tạp" },
  { value: "Mủ nước", label: "Chỉ Mủ nước" },
]
function dayChuyenLabel(u: { loai: string; day_chuyen?: string | null }) {
  if (u.day_chuyen) return `Chỉ ${u.day_chuyen}`
  return u.loai === "ca" ? "Chọn khi điểm danh" : "Độc lập (in cả 2 phiếu)"
}

const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"

export function AttendanceUnitsCard({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [rows, setRows] = useState<AttendanceUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data, error: e } = await supabase.from("attendance_units").select(UNIT_SELECT).eq("factory_id", fid).order("sort_order")
      if (e) throw e
      setRows((data || []) as AttendanceUnit[])
      setError(null)
    } catch (err) {
      const m = getErrorMessage(err, "Không tải được danh mục Ca/Tổ.")
      setError(/attendance_units/.test(m) ? "Chưa có bảng Ca/Tổ — chạy migration 20261210_attendance_units.sql." : m)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void load(factoryId)
  }, [factoryId, load])

  const openNew = () =>
    setForm({ id: null, code: "", ten: "", ten_khmer: "", loai: "to", to_nhom: "", day_chuyen: "", sort_order: String((rows.at(-1)?.sort_order ?? 0) + 10), is_active: true })
  const openEdit = (u: AttendanceUnit) =>
    setForm({
      id: u.id,
      code: u.code,
      ten: u.ten,
      ten_khmer: u.ten_khmer || "",
      loai: u.loai,
      to_nhom: u.to_nhom || "",
      day_chuyen: u.day_chuyen || "",
      sort_order: String(u.sort_order),
      is_active: u.is_active,
    })

  const save = async () => {
    if (!factoryId || !form) return
    const code = form.code.trim().toUpperCase()
    if (!/^[A-Z0-9_]{1,12}$/.test(code)) {
      setFormError("Mã chỉ gồm chữ in hoa không dấu, số, dấu _ (tối đa 12 ký tự), vd XLNT, CD, A.")
      return
    }
    if (!form.ten.trim()) {
      setFormError("Nhập tên Ca/Tổ.")
      return
    }
    if (!form.id && rows.some((r) => r.code === code)) {
      setFormError(`Mã ${code} đã có.`)
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        factory_id: factoryId,
        ten: form.ten.trim(),
        ten_khmer: form.ten_khmer.trim() || null,
        loai: form.loai,
        to_nhom: form.loai === "ca" ? "ca_san_xuat" : form.to_nhom && form.to_nhom !== "ca_san_xuat" ? form.to_nhom : "co_dien",
        day_chuyen: form.day_chuyen || null,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      }
      const { error: e } = form.id
        ? await supabase.from("attendance_units").update(payload).eq("id", form.id).eq("factory_id", factoryId)
        : await supabase.from("attendance_units").insert({ ...payload, code })
      if (e) throw e
      setForm(null)
      void load(factoryId)
    } catch (err) {
      setFormError(getErrorMessage(err, "Không lưu được."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          Mỗi Ca/Tổ điểm danh 1 phần trong phiếu TKSX của dây chuyền. Ca A/B/C và tổ độc lập (Cơ điện, Xử lý nước thải,
          Đội xe cơ khí…) chọn dây chuyền khi điểm danh — mỗi dây chuyền phân công riêng, in ở cả TKSXMT lẫn TKSXMN; tổ
          &ldquo;Chỉ Mủ tạp / Mủ nước&rdquo; chỉ có ở phiếu đó. Thành viên = nhân sự có “Ca/Tổ mặc định” là đơn vị đó; trưởng/phó gán ở
          hồ sơ Nhân sự; việc của tổ khai ở tab Công việc. Ai được điểm danh: Cài đặt → Cấu hình nhà máy → Phân công điểm
          danh ca/tổ.
        </p>
        {canManage ? (
          <button type="button" onClick={openNew} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white">
            <Plus size={15} /> Thêm Ca/Tổ
          </button>
        ) : null}
      </div>
      {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="enterprise-table dense min-w-[720px]">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên</th>
              <th>Tên Khmer</th>
              <th>Loại</th>
              <th>Dây chuyền</th>
              <th className="text-right">Thứ tự</th>
              <th>Trạng thái</th>
              <th className="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center text-slate-400">Đang tải...</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-slate-400">Chưa có Ca/Tổ nào.</td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id}>
                  <td className="font-code font-semibold">{u.code}</td>
                  <td className="font-semibold">{u.ten}</td>
                  <td>{u.ten_khmer || "—"}</td>
                  <td>{u.loai === "ca" ? "Ca (Ca trưởng/phó)" : "Tổ (Tổ trưởng/phó)"}</td>
                  <td>{dayChuyenLabel(u)}</td>
                  <td className="text-right">{u.sort_order}</td>
                  <td>
                    <StatusBadge tone={u.is_active ? "valid" : "draft"} label={u.is_active ? "Đang dùng" : "Ngừng dùng"} size="xs" />
                  </td>
                  <td className="text-right">
                    {canManage ? (
                      <button type="button" onClick={() => openEdit(u)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Sửa">
                        <Pencil size={15} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {form ? (
        <ModalShell title={form.id ? `Sửa ${form.code}` : "Thêm Ca/Tổ"} onClose={() => setForm(null)} maxWidth="lg">
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Mã *</span>
                <input
                  value={form.code}
                  disabled={!!form.id}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })}
                  className={`${inputCls} disabled:bg-slate-100`}
                  placeholder="vd XLNT"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Loại *</span>
                <select value={form.loai} onChange={(e) => setForm({ ...form, loai: e.target.value as "ca" | "to" })} className={inputCls}>
                  <option value="to">Tổ (Tổ trưởng / Tổ phó)</option>
                  <option value="ca">Ca (Ca trưởng / Ca phó)</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">Tên *</span>
              <input value={form.ten} onChange={(e) => setForm({ ...form, ten: e.target.value })} className={inputCls} placeholder="vd Tổ xử lý nước thải" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">Tên Khmer (in trên phiếu TKSX)</span>
              <input value={form.ten_khmer} onChange={(e) => setForm({ ...form, ten_khmer: e.target.value })} className={inputCls} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Dây chuyền</span>
                <select value={form.day_chuyen} onChange={(e) => setForm({ ...form, day_chuyen: e.target.value })} className={inputCls}>
                  {DAY_CHUYEN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Thứ tự trên phiếu</span>
                <input inputMode="numeric" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value.replace(/[^\d]/g, "") })} className={inputCls} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Đang dùng
            </label>
            {form.id ? <p className="text-xs text-slate-500">Mã không đổi được (phiếu cũ và hồ sơ nhân sự tham chiếu theo mã).</p> : null}
            {formError ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{formError}</div> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600">
                Huỷ
              </button>
              <button type="button" onClick={() => void save()} disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  )
}
