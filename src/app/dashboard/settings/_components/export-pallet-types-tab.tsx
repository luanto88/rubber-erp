"use client"

// Cài đặt → Cấu hình nhà máy → Loại pallet xuất (2026-10-27).
// Thay mảng hard-code ở màn Xuất hàng. Mỗi loại khai báo "hình thức" quyết định pallet đi đâu khi xuất —
// dùng để tính tồn pallet ở Kho vật tư → Tồn (xem src/app/dashboard/inventory/pallet-flow-actions.ts).

import { useCallback, useEffect, useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import {
  EXPORT_PALLET_FORM_LABEL,
  PALLET_COMPONENT_LABEL,
  PALLET_COMPONENT_ORDER,
  type ExportPalletForm,
  type ExportPalletType,
  type PalletComponent,
} from "@/lib/pallet-usage"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"

type FormState = {
  id: string | null
  ten: string
  hinh_thuc: ExportPalletForm
  mat_thanh_phan: PalletComponent[]
  sort_order: string
  is_active: boolean
}

const emptyForm = (): FormState => ({
  id: null,
  ten: "",
  hinh_thuc: "kien",
  mat_thanh_phan: [],
  sort_order: "100",
  is_active: true,
})

const FORMS: ExportPalletForm[] = ["roi", "kien", "boc_mang"]

const formBadge: Record<ExportPalletForm, string> = {
  roi: "bg-emerald-100 text-emerald-700",
  kien: "bg-rose-100 text-rose-700",
  boc_mang: "bg-sky-100 text-sky-700",
}

export function ExportPalletTypesTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [rows, setRows] = useState<ExportPalletType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [delTarget, setDelTarget] = useState<ExportPalletType | null>(null)

  const load = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from("export_pallet_types")
        .select("id, ten, hinh_thuc, mat_thanh_phan, sort_order, is_active")
        .eq("factory_id", fid)
        .order("sort_order")
        .order("ten")
      if (err) {
        setError(
          err.message.includes("export_pallet_types")
            ? "Chưa có bảng export_pallet_types — chạy migration 20261027_export_pallet_types.sql."
            : err.message,
        )
        setRows([])
        return
      }
      setError(null)
      setRows((data || []) as ExportPalletType[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void load(factoryId)
  }, [factoryId, load])

  const save = async () => {
    if (!factoryId || !form) return
    const ten = form.ten.trim()
    if (!ten) {
      setError("Nhập tên loại pallet xuất.")
      return
    }
    if (form.hinh_thuc === "boc_mang" && form.mat_thanh_phan.length === 0) {
      setError("Bọc màng PE: chọn ít nhất 1 thành phần bị mất (vd Đế gỗ).")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        factory_id: factoryId,
        ten,
        hinh_thuc: form.hinh_thuc,
        mat_thanh_phan: form.hinh_thuc === "boc_mang" ? form.mat_thanh_phan : [],
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      }
      const { error: err } = form.id
        ? await supabase.from("export_pallet_types").update(payload).eq("id", form.id).eq("factory_id", factoryId)
        : await supabase.from("export_pallet_types").insert(payload)
      if (err) {
        setError(err.code === "23505" ? `Loại "${ten}" đã tồn tại.` : err.message)
        return
      }
      setForm(null)
      void load(factoryId)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!factoryId || !delTarget) return
    setSaving(true)
    try {
      const { error: err } = await supabase
        .from("export_pallet_types")
        .delete()
        .eq("id", delTarget.id)
        .eq("factory_id", factoryId)
      if (err) {
        setError(err.message)
        return
      }
      setDelTarget(null)
      void load(factoryId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          Danh sách hiện ở ô &quot;Loại pallet xuất&quot; của đơn xuất hàng. <b>Xuất rời</b>: pallet của kiện trả về kho.
          <b> Xuất khẩu dạng kiện</b>: mất pallet của kiện. <b>Bọc màng PE</b>: pallet trả về, chỉ mất các thành phần
          khai báo (mỗi kiện 1 cái). Tắt loại không dùng thay vì xoá để giữ đúng đơn cũ.
        </p>
        {canManage ? (
          <button
            type="button"
            onClick={() => setForm(emptyForm())}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
          >
            <Plus size={15} /> Thêm loại
          </button>
        ) : null}
      </div>

      {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}

      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[640px]">
          <thead>
            <tr>
              <th>Tên loại</th>
              <th>Hình thức</th>
              <th>Thành phần bị mất</th>
              <th className="text-right">Thứ tự</th>
              <th>Trạng thái</th>
              {canManage ? <th className="text-right">Thao tác</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  Đang tải...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  Chưa có loại pallet xuất nào
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                  <td className="font-semibold text-slate-700">{r.ten}</td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${formBadge[r.hinh_thuc]}`}>
                      {EXPORT_PALLET_FORM_LABEL[r.hinh_thuc]}
                    </span>
                  </td>
                  <td className="text-slate-600">
                    {r.hinh_thuc === "kien"
                      ? "Toàn bộ pallet của kiện"
                      : r.hinh_thuc === "roi"
                        ? "—"
                        : (r.mat_thanh_phan || []).map((c) => PALLET_COMPONENT_LABEL[c] || c).join(", ")}
                  </td>
                  <td className="text-right">{r.sort_order}</td>
                  <td>{r.is_active ? "Đang dùng" : "Đã tắt"}</td>
                  {canManage ? (
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() =>
                            setForm({
                              id: r.id,
                              ten: r.ten,
                              hinh_thuc: r.hinh_thuc,
                              mat_thanh_phan: r.mat_thanh_phan || [],
                              sort_order: String(r.sort_order ?? 0),
                              is_active: r.is_active,
                            })
                          }
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          title="Xoá"
                          onClick={() => setDelTarget(r)}
                          className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
                        >
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

      {form ? (
        <ModalShell
          title={form.id ? "Sửa loại pallet xuất" : "Thêm loại pallet xuất"}
          onClose={() => setForm(null)}
          maxWidth="lg"
          footer={
            <>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">Tên loại *</label>
              <input
                value={form.ten}
                onChange={(e) => setForm({ ...form, ten: e.target.value })}
                placeholder="VD: PE đế gỗ"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">Hình thức *</label>
              <div className="grid gap-2">
                {FORMS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setForm({ ...form, hinh_thuc: f })}
                    className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                      form.hinh_thuc === f ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {EXPORT_PALLET_FORM_LABEL[f]}
                  </button>
                ))}
              </div>
            </div>
            {form.hinh_thuc === "boc_mang" ? (
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Thành phần bị mất (mỗi kiện 1 cái) *</label>
                <div className="flex flex-wrap gap-2">
                  {PALLET_COMPONENT_ORDER.map((c) => {
                    const on = form.mat_thanh_phan.includes(c)
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            mat_thanh_phan: on ? form.mat_thanh_phan.filter((x) => x !== c) : [...form.mat_thanh_phan, c],
                          })
                        }
                        className={`rounded-full border px-3 py-1 text-xs font-bold ${
                          on ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-500"
                        }`}
                      >
                        {PALLET_COMPONENT_LABEL[c]}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Thứ tự</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Đang dùng
              </label>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {delTarget ? (
        <ModalShell
          title="Xoá loại pallet xuất"
          onClose={() => setDelTarget(null)}
          maxWidth="sm"
          footer={
            <>
              <button
                type="button"
                onClick={() => setDelTarget(null)}
                className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void remove()}
                className="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                Xoá
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xoá loại <b>{delTarget.ten}</b>? Đơn xuất cũ đang dùng loại này sẽ bị tính tạm như &quot;xuất khẩu dạng
            kiện&quot;. Nên <b>tắt</b> thay vì xoá.
          </p>
        </ModalShell>
      ) : null}
    </div>
  )
}
