"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Edit2, Trash2, Wand2, X, AlertTriangle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"
import {
  CHI_TIEU_META,
  CHUNG_LOAI,
  TIEU_CHUAN_OPTIONS,
  buildMucTieuText,
  chiTieuDisplayLabel,
  type ChiTieuKey,
  type QualityTargetForm,
  type QualityTargetRow,
} from "@/lib/quality-stats"

const CHI_TIEU_OPTIONS: ChiTieuKey[] = ["tap_chat", "tro", "bay_hoi", "nito", "po", "pri", "mooney", "mau_sac", "tccs_tong"]

type FormState = {
  nam: string
  san_pham: string
  chi_tieu: ChiTieuKey
  nguong_min: string
  nguong_max: string
  tieu_chuan: string
  ty_le_muc_tieu: string
  noi_dung_muc_tieu: string
}

function emptyForm(nam: number): FormState {
  return {
    nam: String(nam),
    san_pham: "10",
    chi_tieu: "tap_chat",
    nguong_min: "",
    nguong_max: "",
    tieu_chuan: TIEU_CHUAN_OPTIONS[0],
    ty_le_muc_tieu: "",
    noi_dung_muc_tieu: "",
  }
}

function toFormPreview(f: FormState): QualityTargetForm {
  return {
    chi_tieu: f.chi_tieu,
    san_pham: f.san_pham,
    nguong_min: f.nguong_min.trim() ? Number(f.nguong_min) : null,
    nguong_max: f.nguong_max.trim() ? Number(f.nguong_max) : null,
    tieu_chuan: f.chi_tieu === "tccs_tong" ? f.tieu_chuan : null,
    ty_le_muc_tieu: Number(f.ty_le_muc_tieu) || 0,
  }
}

export function QualityTargetsTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [rows, setRows] = useState<QualityTargetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm(currentYear))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [delConfirm, setDelConfirm] = useState<{ id: string; label: string } | null>(null)

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from("quality_targets")
        .select("*")
        .eq("factory_id", fid)
        .order("nam", { ascending: false })
        .order("sort_order", { ascending: true })
      if (err) { setError(err.message); return }
      setRows((data as QualityTargetRow[]) || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const rowsForYear = useMemo(() => rows.filter((r) => r.nam === year), [rows, year])
  const yearsAvailable = useMemo(() => {
    const set = new Set(rows.map((r) => r.nam))
    set.add(currentYear)
    return Array.from(set).sort((a, b) => b - a)
  }, [rows, currentYear])

  const meta = CHI_TIEU_META[form.chi_tieu]

  const openAdd = () => {
    setError("")
    setEditId(null)
    setForm(emptyForm(year))
    setModalOpen(true)
  }

  const openEdit = (row: QualityTargetRow) => {
    setError("")
    setEditId(row.id)
    setForm({
      nam: String(row.nam),
      san_pham: row.san_pham,
      chi_tieu: row.chi_tieu,
      nguong_min: row.nguong_min != null ? String(row.nguong_min) : "",
      nguong_max: row.nguong_max != null ? String(row.nguong_max) : "",
      tieu_chuan: row.tieu_chuan || TIEU_CHUAN_OPTIONS[0],
      ty_le_muc_tieu: String(row.ty_le_muc_tieu),
      noi_dung_muc_tieu: row.noi_dung_muc_tieu || "",
    })
    setModalOpen(true)
  }

  const handleAutoGen = () => {
    setForm((p) => ({ ...p, noi_dung_muc_tieu: buildMucTieuText(toFormPreview(p)) }))
  }

  const handleSave = async () => {
    if (!factoryId) return
    setError("")
    const namNum = Number(form.nam)
    if (!namNum || namNum < 2000) { setError("Năm không hợp lệ"); return }
    const tyLe = Number(form.ty_le_muc_tieu)
    if (!form.ty_le_muc_tieu.trim() || Number.isNaN(tyLe)) { setError("Tỷ lệ mục tiêu không hợp lệ"); return }
    if (meta.bound === "max" && !form.nguong_max.trim()) { setError("Vui lòng nhập ngưỡng"); return }
    if (meta.bound === "min" && !form.nguong_min.trim()) { setError("Vui lòng nhập ngưỡng"); return }
    if (meta.bound === "range" && (!form.nguong_min.trim() || !form.nguong_max.trim())) { setError("Vui lòng nhập đủ ngưỡng min/max"); return }

    setSaving(true)
    try {
      const preview = toFormPreview(form)
      const payload = {
        factory_id: factoryId,
        nam: namNum,
        chi_tieu: form.chi_tieu,
        san_pham: form.san_pham,
        nguong_min: preview.nguong_min,
        nguong_max: preview.nguong_max,
        tieu_chuan: preview.tieu_chuan,
        ty_le_muc_tieu: tyLe,
        noi_dung_muc_tieu: form.noi_dung_muc_tieu.trim() || buildMucTieuText(preview),
        sort_order: rowsForYear.length + 1,
      }
      const result = editId
        ? await supabase.from("quality_targets").update(payload).eq("id", editId).eq("factory_id", factoryId)
        : await supabase.from("quality_targets").insert(payload)
      if (result.error) {
        setError(
          result.error.message.includes("duplicate") || result.error.code === "23505"
            ? "Đã tồn tại mục tiêu cho đúng năm + chỉ tiêu + sản phẩm này. Vui lòng sửa mục tiêu đã có."
            : result.error.message,
        )
        return
      }
      setModalOpen(false)
      void loadData(factoryId)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!factoryId || !delConfirm) return
    await supabase.from("quality_targets").delete().eq("id", delConfirm.id).eq("factory_id", factoryId)
    setDelConfirm(null)
    void loadData(factoryId)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-500">Năm</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
          >
            {yearsAvailable.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {canManage && (
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
          >
            <Plus size={13} /> Thêm mục tiêu
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
      ) : (
        <ResponsiveTableWrapper>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["STT", "Nội dung mục tiêu", "Sản phẩm", "Chỉ tiêu", "Tỷ lệ mục tiêu", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rowsForYear.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Chưa có mục tiêu nào cho năm {year}.</td></tr>
              ) : rowsForYear.map((row, idx) => (
                <tr key={row.id} className="row-hover">
                  <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-xl">{row.noi_dung_muc_tieu || "—"}</td>
                  <td className="px-4 py-3 font-mono font-bold text-emerald-700">CSR{row.san_pham}</td>
                  <td className="px-4 py-3 text-slate-700">{chiTieuDisplayLabel(row.chi_tieu, row.san_pham)}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{row.ty_le_muc_tieu}%</td>
                  <td className="px-4 py-3">
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(row)} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors">
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => setDelConfirm({ id: row.id, label: row.noi_dung_muc_tieu || `${row.chi_tieu}/${row.san_pham}` })}
                          className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      {modalOpen && (
        <ModalShell
          title={editId ? "Sửa mục tiêu chất lượng" : "Thêm mục tiêu chất lượng"}
          onClose={() => setModalOpen(false)}
          maxWidth="lg"
          footer={
            <>
              <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
                <span className="flex-1">{error}</span>
                <button onClick={() => setError("")}><X size={14} /></button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Năm</label>
                <input
                  type="number"
                  value={form.nam}
                  onChange={(e) => setForm((p) => ({ ...p, nam: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Sản phẩm</label>
                <select
                  value={form.san_pham}
                  onChange={(e) => setForm((p) => ({ ...p, san_pham: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  {CHUNG_LOAI.map((c) => <option key={c} value={c}>CSR{c}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Chỉ tiêu</label>
              <select
                value={form.chi_tieu}
                onChange={(e) => setForm((p) => ({ ...p, chi_tieu: e.target.value as ChiTieuKey }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              >
                {CHI_TIEU_OPTIONS.map((c) => (
                  <option key={c} value={c}>{chiTieuDisplayLabel(c, form.san_pham)}</option>
                ))}
              </select>
            </div>

            {form.chi_tieu === "tccs_tong" ? (
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tiêu chuẩn</label>
                <select
                  value={form.tieu_chuan}
                  onChange={(e) => setForm((p) => ({ ...p, tieu_chuan: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  {TIEU_CHUAN_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {(meta.bound === "min" || meta.bound === "range") && (
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngưỡng tối thiểu (≥)</label>
                    <input
                      value={form.nguong_min}
                      onChange={(e) => setForm((p) => ({ ...p, nguong_min: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
                {(meta.bound === "max" || meta.bound === "range") && (
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngưỡng tối đa (≤)</label>
                    <input
                      value={form.nguong_max}
                      onChange={(e) => setForm((p) => ({ ...p, nguong_max: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Tỷ lệ mục tiêu (%)</label>
              <input
                value={form.ty_le_muc_tieu}
                onChange={(e) => setForm((p) => ({ ...p, ty_le_muc_tieu: e.target.value }))}
                placeholder="vd 96, 98.75, 100"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-600">Nội dung mục tiêu</label>
                <button
                  type="button"
                  onClick={handleAutoGen}
                  className="flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800"
                >
                  <Wand2 size={12} /> Tự sinh mô tả
                </button>
              </div>
              <textarea
                value={form.noi_dung_muc_tieu}
                onChange={(e) => setForm((p) => ({ ...p, noi_dung_muc_tieu: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                placeholder="Bấm 'Tự sinh mô tả' để điền sẵn theo cấu hình phía trên, có thể sửa lại"
              />
            </div>
          </div>
        </ModalShell>
      )}

      {delConfirm && (
        <ModalShell
          title={
            <span className="flex items-center gap-3">
              <span className="p-2 bg-red-100 text-red-600 rounded-xl"><AlertTriangle size={18} /></span>
              {`Xóa "${delConfirm.label}"?`}
            </span>
          }
          onClose={() => setDelConfirm(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={() => void handleDelete()} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl">Xóa</button>
            </>
          }
        >
          <p className="text-sm text-slate-500">Hành động này không thể hoàn tác.</p>
        </ModalShell>
      )}
    </div>
  )
}
