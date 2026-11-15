"use client"

// Định mức KTKT — "Xuất kho bù": thành phẩm xuất của LÔ NGOÀI HỆ THỐNG (lô sản xuất năm 2025, không có nhập TP nên
// không gán được vào đơn ở module Xuất hàng). Mẫu 8A mục 3 = đơn xuất đã duyệt + các dòng bù có ngày trong kỳ.
// Không đụng tồn kho thành phẩm / đơn xuất / EUDR. Rule 30.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Pencil, Plus, Trash2, Truck } from "lucide-react"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { loadGradeConfig } from "@/lib/product-grade-client"
import { deleteNormExportExtra, loadNormExportExtra, saveNormExportExtra, type NormExportExtra } from "@/lib/norms/client"
import { TP_NGUON_LABEL } from "@/lib/norms/report-types"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { btnCls, btnPrimaryCls, errText, Field, fmtDate, inputCls, parseQtyInput } from "./norms-ui"

type Nguon = NormExportExtra["nguon"]
const NGUON_KEYS: Nguon[] = ["cong_ty", "gia_cong", "thu_mua"]
const DEFAULT_NOTE = "Lô sản xuất 2025 — không có trong module Xuất hàng"

type Form = { id: string | null; thang: string; loai_csr: string; nguon: Nguon; tan: string; ghi_chu: string }

/** "2026-01" ⇒ "2026-01-31" (ngày cuối tháng — để cả 8A tháng lẫn kỳ tuỳ chọn chứa trọn tháng đều tính). */
function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${ym}-${String(last).padStart(2, "0")}`
}

const fmtTons = (kg: number) => (kg / 1000).toLocaleString("vi-VN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })

export function NormsExportExtra({
  factoryId,
  user,
  showToast,
}: {
  factoryId: string
  user: SessionUser | null
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const canEdit = hasPermission(user, "norms.periodic_entry")
  const [rows, setRows] = useState<NormExportExtra[]>([])
  const [csrOptions, setCsrOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [list, grade] = await Promise.all([loadNormExportExtra(factoryId), loadGradeConfig(factoryId)])
      setRows(list)
      setCsrOptions([...new Set(grade.rows.filter((r) => r.is_active).map((r) => r.loai_csr.trim()).filter(Boolean))])
    } catch (e) {
      setLoadError(errText(e, "Không tải được xuất kho bù. Kiểm tra đã chạy migration 20261127 chưa."))
    } finally {
      setLoading(false)
    }
  }, [factoryId])

  useEffect(() => {
    void load()
  }, [load])

  const totalKg = useMemo(() => rows.reduce((s, r) => s + r.kg, 0), [rows])

  const openNew = () =>
    setForm({ id: null, thang: getFactoryTodayISO().slice(0, 7), loai_csr: csrOptions[0] || "", nguon: "cong_ty", tan: "", ghi_chu: DEFAULT_NOTE })
  const openEdit = (r: NormExportExtra) =>
    setForm({
      id: r.id,
      thang: r.ngay.slice(0, 7),
      loai_csr: r.loai_csr,
      nguon: r.nguon,
      tan: (r.kg / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 3 }),
      ghi_chu: r.ghi_chu || "",
    })

  const tanParsed = form ? parseQtyInput(form.tan) : null
  const formError = !form
    ? null
    : !/^\d{4}-\d{2}$/.test(form.thang)
      ? "Chọn tháng."
      : !form.loai_csr.trim()
        ? "Chọn chủng loại."
        : tanParsed === null || Number.isNaN(tanParsed) || tanParsed <= 0
          ? "Nhập số tấn lớn hơn 0 (vd 1.527,120)."
          : tanParsed > 100000
            ? "Số tấn quá lớn — phần thập phân dùng dấu phẩy (vd 243,600 chứ không phải 243.600)."
            : null

  const save = async () => {
    if (!form || formError || tanParsed === null) return
    setSaving(true)
    try {
      await saveNormExportExtra(factoryId, form.id, {
        ngay: monthEnd(form.thang),
        loai_csr: form.loai_csr.trim(),
        nguon: form.nguon,
        kg: Math.round(tanParsed * 1000 * 1000) / 1000,
        ghi_chu: form.ghi_chu.trim() || null,
      })
      showToast("ok", form.id ? "Đã cập nhật dòng xuất kho bù." : "Đã thêm dòng xuất kho bù.")
      setForm(null)
      await load()
    } catch (e) {
      showToast("err", errText(e, "Không lưu được."))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (r: NormExportExtra) => {
    if (!window.confirm(`Xoá dòng xuất kho bù tháng ${fmtDate(r.ngay).slice(3)} — ${fmtTons(r.kg)} tấn ${r.loai_csr}?`)) return
    try {
      await deleteNormExportExtra(factoryId, r.id)
      showToast("ok", "Đã xoá.")
      await load()
    } catch (e) {
      showToast("err", errText(e, "Không xoá được."))
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <p className="max-w-3xl text-xs text-slate-600">
          Thành phẩm xuất kho của <b>lô ngoài hệ thống</b> (vd lô sản xuất năm 2025, không có nhập thành phẩm nên không có trong đơn ở module
          Xuất hàng). Số ở đây được <b>cộng vào mục 3 &quot;Thành phẩm xuất kho&quot; của Mẫu 8A</b> theo tháng, có dòng ghi chú bên dưới bảng.
          Không ảnh hưởng tồn kho thành phẩm, đơn xuất hay EUDR.
        </p>
        {canEdit ? (
          <button type="button" className={btnPrimaryCls} onClick={openNew} disabled={loading || !!loadError}>
            <Plus size={15} /> Thêm dòng bù
          </button>
        ) : (
          <span className="text-xs text-slate-500">Chỉ xem — cần quyền nhập liệu định mức.</span>
        )}
      </div>

      {loading ? (
        <ListState kind="loading" />
      ) : loadError ? (
        <ListState kind="error" message={loadError} />
      ) : !rows.length ? (
        <ListState kind="empty" message="Chưa có dòng xuất kho bù nào." />
      ) : (
        <ResponsiveTableWrapper>
          <table className="enterprise-table dense min-w-[720px]">
            <thead>
              <tr>
                <th>Tháng</th>
                <th>Chủng loại</th>
                <th>Nguồn</th>
                <th className="text-right">Số lượng (tấn)</th>
                <th>Ghi chú</th>
                {canEdit && <th className="w-24 text-right">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-sm font-semibold">
                    {fmtDate(r.ngay).slice(3)}
                    <span className="ml-1 text-[11px] font-normal text-slate-400">(tính ngày {fmtDate(r.ngay)})</span>
                  </td>
                  <td className="text-sm">{r.loai_csr}</td>
                  <td className="text-sm">{TP_NGUON_LABEL[r.nguon]}</td>
                  <td className="text-right text-sm font-semibold tabular-nums">{fmtTons(r.kg)}</td>
                  <td className="text-xs text-slate-600">{r.ghi_chu}</td>
                  {canEdit && (
                    <td className="text-right">
                      <div className="inline-flex gap-1">
                        <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100" title="Sửa" onClick={() => openEdit(r)}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50" title="Xoá" onClick={() => void remove(r)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold">
                <td colSpan={3} className="text-sm">
                  Tổng cộng
                </td>
                <td className="text-right text-sm tabular-nums">{fmtTons(totalKg)}</td>
                <td colSpan={canEdit ? 2 : 1} />
              </tr>
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      {form && (
        <ModalShell
          title={form.id ? "Sửa dòng xuất kho bù" : "Thêm dòng xuất kho bù"}
          onClose={() => setForm(null)}
          maxWidth="md"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className={btnCls} onClick={() => setForm(null)}>
                Huỷ
              </button>
              <button type="button" className={btnPrimaryCls} disabled={saving || !!formError} onClick={() => void save()}>
                <Truck size={15} /> {saving ? "Đang lưu…" : "Lưu"}
              </button>
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tháng xuất" hint={/^\d{4}-\d{2}$/.test(form.thang) ? `Tính vào ngày ${fmtDate(monthEnd(form.thang))}` : undefined}>
              <input type="month" className={inputCls} value={form.thang} onChange={(e) => setForm({ ...form, thang: e.target.value })} />
            </Field>
            <Field label="Chủng loại">
              <select className={inputCls} value={form.loai_csr} onChange={(e) => setForm({ ...form, loai_csr: e.target.value })}>
                {!csrOptions.includes(form.loai_csr) && form.loai_csr && <option value={form.loai_csr}>{form.loai_csr}</option>}
                {csrOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nguồn">
              <select className={inputCls} value={form.nguon} onChange={(e) => setForm({ ...form, nguon: e.target.value as Nguon })}>
                {NGUON_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {TP_NGUON_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Số lượng (tấn)" hint="Vd 1.527,120">
              <input
                className={`${inputCls} text-right tabular-nums`}
                inputMode="decimal"
                value={form.tan}
                onChange={(e) => setForm({ ...form, tan: e.target.value })}
                placeholder="0,000"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Ghi chú (in dưới mục 3 Mẫu 8A)">
                <input className={inputCls} value={form.ghi_chu} onChange={(e) => setForm({ ...form, ghi_chu: e.target.value })} />
              </Field>
            </div>
          </div>
          {formError && <p className="mt-3 text-xs font-semibold text-red-600">{formError}</p>}
        </ModalShell>
      )}
    </div>
  )
}
