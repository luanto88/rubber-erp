"use client"

// Phân công trực ca cố định theo nhà máy (mục 5, .claude/rules/06-module-production.md mục 4.6
// "Cập nhật 2026-07-15") — cho phép admin gán trước "ai luôn trực Ca A/B/C" để trang quét QR
// (product/confirm) tự gợi ý đúng Ca thay vì luôn mặc định "Ca A". Cố ý đơn giản: đúng 3 dòng cố
// định (Ca A/B/C), không có lịch sử effective_from/to như "Tài xế chính theo xe".

import { useCallback, useEffect, useState } from "react"
import { Save } from "lucide-react"
import { supabase } from "@/lib/supabase"

export type ShiftAssignmentUserOption = { id: string; label: string }

type ShiftAssignmentRow = {
  id: string
  ca: string
  assigned_user_id: string | null
  assigned_name: string | null
  ghi_chu: string | null
  is_active: boolean
}

type CaFormState = {
  assigned_user_id: string
  assigned_name: string
  ghi_chu: string
  is_active: boolean
}

const CA_LIST = ["A", "B", "C"] as const

function emptyForm(): CaFormState {
  return { assigned_user_id: "", assigned_name: "", ghi_chu: "", is_active: true }
}

export function ShiftAssignmentsTab({
  factoryId,
  canManage,
  userOptions,
}: {
  factoryId: string | null
  canManage: boolean
  userOptions: ShiftAssignmentUserOption[]
}) {
  const [rows, setRows] = useState<Record<string, ShiftAssignmentRow>>({})
  const [forms, setForms] = useState<Record<string, CaFormState>>({ A: emptyForm(), B: emptyForm(), C: emptyForm() })
  const [loading, setLoading] = useState(true)
  const [savingCa, setSavingCa] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [savedCa, setSavedCa] = useState<string | null>(null)

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from("production_shift_assignments")
        .select("id, ca, assigned_user_id, assigned_name, ghi_chu, is_active")
        .eq("factory_id", fid)
      if (err) { setError(err.message); return }
      const byCa: Record<string, ShiftAssignmentRow> = {}
      const nextForms: Record<string, CaFormState> = { A: emptyForm(), B: emptyForm(), C: emptyForm() }
      for (const row of (data || []) as ShiftAssignmentRow[]) {
        byCa[row.ca] = row
        nextForms[row.ca] = {
          assigned_user_id: row.assigned_user_id || "",
          assigned_name: row.assigned_name || "",
          ghi_chu: row.ghi_chu || "",
          is_active: row.is_active,
        }
      }
      setRows(byCa)
      setForms(nextForms)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const updateForm = (ca: string, patch: Partial<CaFormState>) => {
    setForms((prev) => ({ ...prev, [ca]: { ...prev[ca], ...patch } }))
  }

  const handleSave = async (ca: string) => {
    if (!factoryId) return
    setError("")
    setSavingCa(ca)
    setSavedCa(null)
    try {
      const form = forms[ca]
      const payload = {
        factory_id: factoryId,
        ca,
        assigned_user_id: form.assigned_user_id || null,
        assigned_name: form.assigned_name.trim() || null,
        ghi_chu: form.ghi_chu.trim() || null,
        is_active: form.is_active,
      }
      const existing = rows[ca]
      const result = existing
        ? await supabase.from("production_shift_assignments").update(payload).eq("id", existing.id)
        : await supabase.from("production_shift_assignments").upsert(payload, { onConflict: "factory_id,ca" })
      if (result.error) { setError(result.error.message); return }
      setSavedCa(ca)
      void loadData(factoryId)
    } finally {
      setSavingCa(null)
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
  }

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        Gán sẵn người luôn trực từng ca để trang quét QR xác nhận sản xuất tự động gợi ý đúng Ca sản xuất theo tài khoản đang đăng nhập.
        Nếu không tìm thấy tài khoản, có thể chỉ ghi tên hiển thị (không bắt buộc chọn tài khoản).
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CA_LIST.map((ca) => {
          const form = forms[ca]
          return (
            <div key={ca} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-lg bg-blue-100 px-2.5 py-1 text-sm font-extrabold text-blue-700">Ca {ca}</span>
                {savedCa === ca && <span className="text-xs font-bold text-emerald-600">Đã lưu</span>}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Tài khoản trực ca</label>
                  <select
                    disabled={!canManage}
                    value={form.assigned_user_id}
                    onChange={(e) => updateForm(ca, { assigned_user_id: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                  >
                    <option value="">-- Không chọn tài khoản --</option>
                    {userOptions.map((u) => (
                      <option key={u.id} value={u.id}>{u.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Tên hiển thị (nếu chưa có tài khoản)</label>
                  <input
                    disabled={!canManage}
                    value={form.assigned_name}
                    onChange={(e) => updateForm(ca, { assigned_name: e.target.value })}
                    placeholder="vd: Tổ trưởng ca A"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Ghi chú</label>
                  <input
                    disabled={!canManage}
                    value={form.ghi_chu}
                    onChange={(e) => updateForm(ca, { ghi_chu: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={form.is_active}
                    onChange={(e) => updateForm(ca, { is_active: e.target.checked })}
                  />
                  Đang áp dụng
                </label>

                {canManage && (
                  <button
                    onClick={() => void handleSave(ca)}
                    disabled={savingCa === ca}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Save size={13} /> {savingCa === ca ? "Đang lưu..." : "Lưu"}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
