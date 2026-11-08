"use client"

// Cài đặt → Cấu hình nhà máy → Quy cách chủng loại (2026-11-08, GĐ2). Bảng product_grade_types.
// Mỗi dòng = 1 (chủng loại × loại bành): bành/kiện, lô tròn = 4 × bành/kiện. Thành phẩm, màn quét QR, Dự đoán số
// lô, Xuất hàng, Kho thành phẩm và hàm SQL tính trạng thái lô (Hoàn thành / Dở dang) đọc bảng này.
// Dòng đã có lô / lô dự đoán / nháp dùng ⇒ KHÔNG đổi chủng loại, loại bành, bành/kiện và KHÔNG xoá (DB cũng
// chặn bằng trigger) — chỉ tắt/bật, đổi thứ tự, mặc định.

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Lock, Pencil, Plus, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getErrorMessage } from "@/lib/error-message"
import { matchesSearchQuery } from "@/lib/text-normalize"
import {
  GRADE_DAY_CHUYEN,
  GRADE_SELECT,
  KIEN_PER_LOT,
  normCsr,
  parseGradeRows,
  resolveFactoryPrefix,
  roundBanh,
  type CsrPrefix,
  type GradeRow,
} from "@/lib/product-grade"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"
import { ListSearch, noSearchMatchText } from "./list-search"

const TABLE = "product_grade_types"

type FormState = {
  id: string | null
  used: number
  day_chuyen: string
  loai_csr: string
  loai_banh: string
  max_per_kien: string
  is_default: boolean
  sort_order: string
  is_active: boolean
}

const emptyForm = (prefix: CsrPrefix): FormState => ({
  id: null,
  used: 0,
  day_chuyen: GRADE_DAY_CHUYEN[0],
  loai_csr: prefix,
  loai_banh: "35",
  max_per_kien: "36",
  is_default: false,
  sort_order: "100",
  is_active: true,
})

const fmtBanh = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 })

/** Thông báo lỗi DB dễ hiểu (trigger chặn dòng đã dùng / trùng khoá). */
function dbErrorText(err: { code?: string; message?: string } | null | undefined): string {
  const msg = err?.message || ""
  if (msg.includes("PRODUCT_GRADE_IN_USE")) return msg.replace(/^.*PRODUCT_GRADE_IN_USE:\s*/, "")
  if (err?.code === "23505") {
    return msg.includes("default")
      ? "Chủng loại này đã có 1 loại bành mặc định khác."
      : "Chủng loại + loại bành này đã tồn tại."
  }
  return msg || "Lỗi không xác định."
}

export function ProductGradeTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [rows, setRows] = useState<GradeRow[]>([])
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [prefix, setPrefix] = useState<CsrPrefix>("CSR")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [delTarget, setDelTarget] = useState<GradeRow | null>(null)

  const load = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data: f } = await supabase.from("factories").select("name, prefix").eq("id", fid).maybeSingle()
      setPrefix(resolveFactoryPrefix(f?.prefix, f?.name))
      const { data, error: err } = await supabase
        .from(TABLE)
        .select(GRADE_SELECT)
        .eq("factory_id", fid)
        .order("sort_order")
      if (err) {
        setError(
          err.message.includes(TABLE)
            ? "Chưa có bảng product_grade_types — chạy migration 20261116_product_grade_types.sql. Các màn hình đang dùng quy tắc mặc định."
            : err.message,
        )
        setRows([])
        return
      }
      setError(null)
      const parsed = parseGradeRows(data)
      setRows(parsed)
      // Số lô / lô dự đoán / nháp đang dùng từng dòng (ít dòng ⇒ gọi song song).
      const counts = await Promise.all(
        parsed.map(async (r) => {
          const { data: n, error: cErr } = await supabase.rpc("product_grade_usage_count", {
            p_factory_id: fid,
            p_loai_csr: r.loai_csr,
            p_loai_banh: r.loai_banh,
          })
          // Lỗi ⇒ coi như ĐÃ dùng (thà khoá nhầm còn hơn cho sửa số đang dùng).
          return [r.id, cErr ? 1 : Number(n) || 0] as const
        }),
      )
      setUsage(Object.fromEntries(counts))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void load(factoryId)
  }, [factoryId, load])

  const shownRows = useMemo(
    () =>
      [...rows]
        .sort(
          (a, b) =>
            GRADE_DAY_CHUYEN.indexOf(a.day_chuyen as (typeof GRADE_DAY_CHUYEN)[number]) -
              GRADE_DAY_CHUYEN.indexOf(b.day_chuyen as (typeof GRADE_DAY_CHUYEN)[number]) ||
            a.sort_order - b.sort_order ||
            b.loai_banh - a.loai_banh,
        )
        .filter((r) => matchesSearchQuery(search, [r.loai_csr, r.day_chuyen, String(r.loai_banh)])),
    [rows, search],
  )

  const save = async () => {
    if (!factoryId || !form) return
    const loai_csr = normCsr(form.loai_csr)
    const loai_banh = roundBanh(Number(String(form.loai_banh).replace(",", ".")))
    const max_per_kien = Math.round(Number(form.max_per_kien))
    if (!loai_csr || loai_csr === "CSR" || loai_csr === "SVR") return setError("Nhập chủng loại đầy đủ (vd CSR10).")
    if (!(loai_banh > 0)) return setError("Loại bành (kg) phải > 0.")
    if (!(max_per_kien > 0) || max_per_kien > 500) return setError("Bành/kiện phải từ 1 đến 500.")
    const dup = rows.find((r) => r.id !== form.id && r.loai_csr === loai_csr && r.loai_banh === loai_banh)
    if (dup) return setError(`${loai_csr} · ${fmtBanh(loai_banh)} kg đã có.`)
    setSaving(true)
    setError(null)
    try {
      // Chỉ 1 dòng mặc định / chủng loại: bỏ mặc định dòng khác TRƯỚC (index unique từng phần).
      if (form.is_default) {
        const { error: defErr } = await supabase
          .from(TABLE)
          .update({ is_default: false })
          .eq("factory_id", factoryId)
          .eq("loai_csr", loai_csr)
          .eq("is_default", true)
          .neq("id", form.id || "00000000-0000-0000-0000-000000000000")
        if (defErr) return setError(dbErrorText(defErr))
      }
      const locked = form.used > 0
      const payload = {
        factory_id: factoryId,
        day_chuyen: form.day_chuyen,
        is_default: form.is_default,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
        // Dòng đã dùng: không gửi 3 trường khoá (trigger DB cũng chặn).
        ...(locked ? {} : { loai_csr, loai_banh, max_per_kien }),
      }
      const { error: err } = form.id
        ? await supabase.from(TABLE).update(payload).eq("id", form.id).eq("factory_id", factoryId)
        : await supabase.from(TABLE).insert({ ...payload, loai_csr, loai_banh, max_per_kien })
      if (err) return setError(dbErrorText(err))
      setForm(null)
      void load(factoryId)
    } catch (e) {
      setError(getErrorMessage(e, "Không lưu được."))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!factoryId || !delTarget) return
    setSaving(true)
    try {
      const { error: err } = await supabase.from(TABLE).delete().eq("id", delTarget.id).eq("factory_id", factoryId)
      if (err) {
        setError(dbErrorText(err))
        setDelTarget(null)
        return
      }
      setDelTarget(null)
      void load(factoryId)
    } catch (e) {
      setError(getErrorMessage(e, "Không xoá được."))
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (r: GradeRow) => {
    setError(null)
    setForm({
      id: r.id,
      used: usage[r.id] ?? 1,
      day_chuyen: r.day_chuyen,
      loai_csr: r.loai_csr,
      loai_banh: String(r.loai_banh),
      max_per_kien: String(r.max_per_kien),
      is_default: r.is_default,
      sort_order: String(r.sort_order),
      is_active: r.is_active,
    })
  }

  const formLoTron = form ? KIEN_PER_LOT * (Math.round(Number(form.max_per_kien)) || 0) : 0
  const formLocked = !!form && form.used > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          Chủng loại và loại bành chọn được khi nhập thành phẩm, quét QR, dự đoán số lô, xuất hàng. <b>Lô tròn = 4 ×
          bành/kiện</b> (dùng để xác định lô Hoàn thành / Dở dang). Dòng đã có lô dùng thì <b>không đổi số / không xoá</b>{" "}
          được (đổi sẽ làm sai trạng thái lô cũ) — chỉ tắt. Tiền tố của nhà máy: <b>{prefix}</b>.
        </p>
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setForm(emptyForm(prefix))
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
          >
            <Plus size={15} /> Thêm chủng loại / loại bành
          </button>
        ) : null}
      </div>

      <div className="flex justify-end">
        <ListSearch value={search} onChange={setSearch} shown={shownRows.length} total={rows.length} />
      </div>

      {error && !form ? (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div>
      ) : null}

      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[820px]">
          <thead>
            <tr>
              <th>Dây chuyền</th>
              <th>Chủng loại</th>
              <th className="text-right">Loại bành (kg)</th>
              <th className="text-right">Bành/kiện</th>
              <th className="text-right">Lô tròn</th>
              <th className="text-right">Kg/kiện</th>
              <th className="text-right">Đã dùng</th>
              <th>Trạng thái</th>
              {canManage ? <th className="text-right">Thao tác</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">
                  Đang tải...
                </td>
              </tr>
            ) : shownRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">
                  {rows.length === 0 ? "Chưa có cấu hình — đang dùng quy tắc mặc định" : noSearchMatchText(search)}
                </td>
              </tr>
            ) : (
              shownRows.map((r) => {
                const used = usage[r.id] ?? 0
                return (
                  <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                    <td className="text-slate-600">{r.day_chuyen}</td>
                    <td className="font-semibold text-slate-700">
                      {r.loai_csr}
                      {r.is_default ? (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                          Mặc định
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right">{fmtBanh(r.loai_banh)}</td>
                    <td className="text-right">{r.max_per_kien}</td>
                    <td className="text-right font-semibold">{KIEN_PER_LOT * r.max_per_kien}</td>
                    <td className="text-right text-slate-500">{fmtBanh(roundBanh(r.max_per_kien * r.loai_banh))}</td>
                    <td className="text-right">
                      {used > 0 ? (
                        <span className="inline-flex items-center gap-1 text-slate-600">
                          <Lock size={12} /> {used.toLocaleString("vi-VN")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{r.is_active ? "Đang dùng" : "Đã tắt"}</td>
                    {canManage ? (
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            title="Sửa"
                            onClick={() => openEdit(r)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            title={used > 0 ? "Đã dùng — chỉ tắt được" : "Xoá"}
                            disabled={used > 0}
                            onClick={() => setDelTarget(r)}
                            className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      {form ? (
        <ModalShell
          title={form.id ? "Sửa chủng loại / loại bành" : "Thêm chủng loại / loại bành"}
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
            {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
            {formLocked ? (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                Đã dùng ở {form.used.toLocaleString("vi-VN")} lô / lô dự đoán / nháp — không đổi được chủng loại, loại bành,
                bành/kiện. Cần quy cách khác ⇒ tắt dòng này và thêm dòng mới.
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Dây chuyền *</label>
                <select
                  value={form.day_chuyen}
                  onChange={(e) => setForm({ ...form, day_chuyen: e.target.value })}
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500"
                >
                  {GRADE_DAY_CHUYEN.map((dc) => (
                    <option key={dc}>{dc}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Chủng loại *</label>
                <input
                  value={form.loai_csr}
                  disabled={formLocked}
                  onChange={(e) => setForm({ ...form, loai_csr: e.target.value.toUpperCase() })}
                  placeholder={`VD: ${prefix}10`}
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-100"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Loại bành (kg/bành) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.loai_banh}
                  disabled={formLocked}
                  onChange={(e) => setForm({ ...form, loai_banh: e.target.value })}
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-100"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Bành/kiện *</label>
                <input
                  type="number"
                  value={form.max_per_kien}
                  disabled={formLocked}
                  onChange={(e) => setForm({ ...form, max_per_kien: e.target.value })}
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-100"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Lô tròn = {KIEN_PER_LOT} × {form.max_per_kien || 0} = <b>{formLoTron}</b> bành
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Thứ tự</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                />
                Mặc định
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Đang dùng
              </label>
            </div>
            <p className="text-[11px] text-slate-500">
              &quot;Mặc định&quot; = loại bành gợi ý đầu tiên của chủng loại trên form. Thứ tự quyết định thứ tự chủng loại
              trong danh sách chọn.
            </p>
          </div>
        </ModalShell>
      ) : null}

      {delTarget ? (
        <ModalShell
          title="Xoá chủng loại / loại bành"
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
                {saving ? "Đang xoá..." : "Xoá"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xoá <b>{delTarget.loai_csr} · {fmtBanh(delTarget.loai_banh)} kg</b>? Chỉ xoá được khi chưa có lô nào dùng.
          </p>
        </ModalShell>
      ) : null}
    </div>
  )
}
