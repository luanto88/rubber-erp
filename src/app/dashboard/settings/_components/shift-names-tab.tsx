"use client"

// Tên ca A/B/C theo ca trưởng — có NGÀY HIỆU LỰC (GĐ5, 2026-09-29, bảng production_shift_names).
// Đổi ca trưởng = THÊM một mốc mới "từ ngày X", không sửa đè mốc cũ — nhờ vậy in lại phiếu báo
// thành phẩm (F09) / báo cáo sản xuất hằng ngày (F12) của ngày cũ vẫn ra đúng tên ca trưởng lúc đó.
// Thay cho 3 ô text cũ factories.ca_a_ten/ca_b_ten/ca_c_ten (nay chỉ còn làm dự phòng).

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Sun, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getFreshAuthSession } from "@/lib/auth"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { ModalShell } from "../../_components/modal-shell"

type ShiftNameRow = {
  id: string
  ca: string
  ca_truong: string
  hieu_luc_tu: string
  ghi_chu: string | null
}

const CA_LIST = ["A", "B", "C"] as const

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-")
  return y && m && d ? `${d}/${m}/${y}` : iso
}

export function ShiftNamesTab({ factoryId, canManage }: { factoryId: string; canManage: boolean }) {
  const [rows, setRows] = useState<ShiftNameRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [modalCa, setModalCa] = useState<string | null>(null)
  const [form, setForm] = useState({ ca_truong: "", hieu_luc_tu: "", ghi_chu: "" })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<ShiftNameRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const today = getFactoryTodayISO()

  const loadRows = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const { data, error } = await supabase
        .from("production_shift_names")
        .select("id, ca, ca_truong, hieu_luc_tu, ghi_chu")
        .eq("factory_id", factoryId)
        .order("hieu_luc_tu", { ascending: false })
      if (error) {
        setLoadError(
          /production_shift_names/.test(error.message)
            ? "Chưa có bảng lịch sử tên ca — cần chạy migration 20261002_production_shift_names.sql."
            : error.message,
        )
        setRows([])
        return
      }
      setRows((data ?? []) as ShiftNameRow[])
    } finally {
      setLoading(false)
    }
  }, [factoryId])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  // Mỗi ca: các mốc (mới → cũ) + id mốc đang áp dụng hôm nay (hieu_luc_tu ≤ hôm nay, mới nhất).
  const byCa = useMemo(() => {
    const out: Record<string, { list: ShiftNameRow[]; activeId: string | null }> = {}
    for (const ca of CA_LIST) {
      const list = rows.filter((r) => r.ca === ca)
      const active = list.find((r) => r.hieu_luc_tu <= today) ?? null
      out[ca] = { list, activeId: active?.id ?? null }
    }
    return out
  }, [rows, today])

  const openAdd = (ca: string) => {
    setForm({ ca_truong: "", hieu_luc_tu: today, ghi_chu: "" })
    setFormError("")
    setModalCa(ca)
  }

  const handleSave = async () => {
    if (!modalCa || !canManage) return
    const name = form.ca_truong.trim()
    if (!name) { setFormError("Nhập tên ca trưởng."); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.hieu_luc_tu)) { setFormError("Chọn ngày hiệu lực."); return }
    setSaving(true)
    setFormError("")
    try {
      const session = await getFreshAuthSession()
      const { error } = await supabase.from("production_shift_names").insert({
        factory_id: factoryId,
        ca: modalCa,
        ca_truong: name,
        hieu_luc_tu: form.hieu_luc_tu,
        ghi_chu: form.ghi_chu.trim() || null,
        created_by: session?.user?.id ?? null,
      })
      if (error) {
        setFormError(
          error.code === "23505"
            ? `Ca ${modalCa} đã có mốc hiệu lực ngày ${fmtDate(form.hieu_luc_tu)} — chọn ngày khác hoặc xóa mốc đó trước.`
            : error.message,
        )
        return
      }
      setModalCa(null)
      void loadRows()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || !canManage) return
    setDeleting(true)
    try {
      const { error } = await supabase.from("production_shift_names").delete().eq("id", deleteTarget.id)
      if (error) { setLoadError(error.message); return }
      setDeleteTarget(null)
      void loadRows()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden mt-4">
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Sun size={16} className="text-amber-600" />
          <span className="font-extrabold text-slate-700">Tên ca sản xuất (theo ca trưởng)</span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Ca A/B/C gọi theo ca trưởng. Khi đổi ca trưởng, bấm &quot;Đổi ca trưởng&quot; và chọn ngày bắt đầu hiệu lực —
          báo cáo các ngày trước đó vẫn in tên ca trưởng cũ. Ca 1/Ca 2 trên phiếu báo thành phẩm là ca ngày/ca đêm, khác với Ca A/B/C.
        </p>
      </div>

      <div className="p-5">
        {loadError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700">
            {loadError}
          </div>
        )}
        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Đang tải...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {CA_LIST.map((ca) => {
              const { list, activeId } = byCa[ca]
              return (
                <div key={ca} className="rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="font-extrabold text-slate-700">Ca {ca}</span>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => openAdd(ca)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold rounded-lg"
                      >
                        <Plus size={13} /> Đổi ca trưởng
                      </button>
                    )}
                  </div>
                  {list.length === 0 ? (
                    <p className="px-4 py-4 text-xs text-slate-400">Chưa đặt tên — báo cáo chỉ in &quot;Ca {ca}&quot;.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {list.map((r) => {
                        const isActive = r.id === activeId
                        const isFuture = r.hieu_luc_tu > today
                        return (
                          <li key={r.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`text-sm font-bold ${isActive ? "text-slate-800" : "text-slate-500"}`}>
                                  {r.ca_truong}
                                </span>
                                {isActive && (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Đang áp dụng</span>
                                )}
                                {isFuture && (
                                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">Sắp áp dụng</span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500">Từ {fmtDate(r.hieu_luc_tu)}</div>
                              {r.ghi_chu && <div className="text-xs text-slate-400 break-words">{r.ghi_chu}</div>}
                            </div>
                            {canManage && list.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(r)}
                                title="Xóa mốc nhập nhầm"
                                className="shrink-0 p-1.5 rounded-lg text-red-600 hover:bg-red-50"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modalCa && (
        <ModalShell
          title={`Đổi ca trưởng — Ca ${modalCa}`}
          onClose={() => setModalCa(null)}
          maxWidth="md"
          footer={
            <>
              <button type="button" onClick={() => setModalCa(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên ca trưởng *</label>
              <input
                value={form.ca_truong}
                onChange={(e) => setForm((p) => ({ ...p, ca_truong: e.target.value }))}
                placeholder="Vd: Sok Khum"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Hiệu lực từ ngày *</label>
              <input
                type="date"
                value={form.hieu_luc_tu}
                onChange={(e) => setForm((p) => ({ ...p, hieu_luc_tu: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              />
              <p className="text-xs text-slate-400 mt-1">Báo cáo từ ngày này trở đi in tên mới; các ngày trước giữ tên cũ.</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
              <input
                value={form.ghi_chu}
                onChange={(e) => setForm((p) => ({ ...p, ghi_chu: e.target.value }))}
                placeholder="Vd: Thay ca trưởng do điều chuyển"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              />
            </div>
            {formError && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{formError}</div>}
          </div>
        </ModalShell>
      )}

      {deleteTarget && (
        <ModalShell
          title="Xóa mốc tên ca"
          onClose={() => setDeleteTarget(null)}
          maxWidth="sm"
          footer={
            <>
              <button type="button" onClick={() => setDeleteTarget(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {deleting ? "Đang xóa..." : "Xóa"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xóa mốc <strong>Ca {deleteTarget.ca} – {deleteTarget.ca_truong}</strong> (từ {fmtDate(deleteTarget.hieu_luc_tu)})?
            Chỉ dùng khi nhập nhầm — báo cáo các ngày thuộc mốc này sẽ in theo mốc liền trước.
          </p>
        </ModalShell>
      )}
    </div>
  )
}
