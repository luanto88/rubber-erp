"use client"

// Phân công trực ca cố định theo nhà máy (mục 5, .claude/rules/06-module-production.md mục 4.6
// "Cập nhật 2026-07-15") — cho phép admin gán trước "ai luôn trực Ca A/B/C" để trang quét QR
// (product/confirm) tự gợi ý đúng Ca thay vì luôn mặc định "Ca A".
//
// Cập nhật 2026-07-21: đổi từ 1 người/ca sang NHIỀU người/ca (mirror yêu cầu thực tế — 1 ca có
// thể có nhiều công nhân trực cùng lúc). Schema vốn đã hỗ trợ tự nhiên (mỗi dòng độc lập theo
// người) — chỉ cần bỏ UNIQUE (factory_id, ca) (migration 20260721_production_shift_assignments_multi.sql)
// và đổi UI từ 1 form/ca sang danh sách nhiều dòng/ca (thêm/sửa/xóa từng người).

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Save, Trash2 } from "lucide-react"
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

// Dòng đang chỉnh sửa trong UI — `isNew` đánh dấu dòng chưa từng lưu (id là temp, chỉ tồn tại
// phía client cho tới khi bấm "Lưu" thành công).
type EditableRow = ShiftAssignmentRow & { isNew?: boolean }

const CA_LIST = ["A", "B", "C"] as const

function emptyRow(ca: string): EditableRow {
  return {
    id: `new-${crypto.randomUUID()}`,
    ca,
    assigned_user_id: "",
    assigned_name: "",
    ghi_chu: "",
    is_active: true,
    isNew: true,
  }
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
  const [rowsByCa, setRowsByCa] = useState<Record<string, EditableRow[]>>({ A: [], B: [], C: [] })
  const [loading, setLoading] = useState(true)
  const [savingRowId, setSavingRowId] = useState<string | null>(null)
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState("")
  // Tập hợp id các dòng ĐANG hiện "Đã lưu" — trước đây dùng 1 state đơn `savedRowId`, khiến lưu
  // dòng B làm mất badge "Đã lưu" của dòng A đã lưu trước đó (chỉ dòng lưu gần nhất mới hiện).
  // Đổi sang Set để mỗi dòng tự giữ trạng thái "đã lưu" độc lập; tự gỡ khỏi Set ngay khi người
  // dùng sửa lại bất kỳ field nào của dòng đó (updateRow) — tránh hiện "Đã lưu" sai khi dữ liệu
  // trên form đã khác với dữ liệu thật trong DB.
  const [savedRowIds, setSavedRowIds] = useState<Set<string>>(new Set())

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from("production_shift_assignments")
        .select("id, ca, assigned_user_id, assigned_name, ghi_chu, is_active")
        .eq("factory_id", fid)
        .order("created_at", { ascending: true })
      if (err) { setError(err.message); return }
      const byCa: Record<string, EditableRow[]> = { A: [], B: [], C: [] }
      for (const row of (data || []) as ShiftAssignmentRow[]) {
        if (!byCa[row.ca]) byCa[row.ca] = []
        byCa[row.ca].push(row)
      }
      setRowsByCa(byCa)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const addRow = (ca: string) => {
    setRowsByCa((prev) => ({ ...prev, [ca]: [...(prev[ca] || []), emptyRow(ca)] }))
  }

  const updateRow = (ca: string, rowId: string, patch: Partial<EditableRow>) => {
    setRowsByCa((prev) => ({
      ...prev,
      [ca]: (prev[ca] || []).map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
    }))
    setSavedRowIds((prev) => {
      if (!prev.has(rowId)) return prev
      const next = new Set(prev)
      next.delete(rowId)
      return next
    })
  }

  const handleSaveRow = async (ca: string, rowId: string) => {
    if (!factoryId) return
    const row = (rowsByCa[ca] || []).find((r) => r.id === rowId)
    if (!row) return
    setError("")
    setSavingRowId(rowId)
    try {
      const payload = {
        factory_id: factoryId,
        ca,
        assigned_user_id: row.assigned_user_id || null,
        assigned_name: (row.assigned_name || "").trim() || null,
        ghi_chu: (row.ghi_chu || "").trim() || null,
        is_active: row.is_active,
      }
      if (row.isNew) {
        const { data, error: err } = await supabase
          .from("production_shift_assignments")
          .insert(payload)
          .select("id")
          .single()
        if (err) { setError(err.message); return }
        updateRow(ca, rowId, { id: data.id, isNew: false })
        setSavedRowIds((prev) => new Set(prev).add(data.id))
      } else {
        const { error: err } = await supabase
          .from("production_shift_assignments")
          .update(payload)
          .eq("id", row.id)
        if (err) { setError(err.message); return }
        setSavedRowIds((prev) => new Set(prev).add(row.id))
      }
      void loadData(factoryId)
    } finally {
      setSavingRowId(null)
    }
  }

  const handleDeleteRow = async (ca: string, rowId: string) => {
    const row = (rowsByCa[ca] || []).find((r) => r.id === rowId)
    if (!row) return
    if (row.isNew) {
      // Dòng chưa từng lưu — chỉ bỏ khỏi state, không cần gọi DB.
      setRowsByCa((prev) => ({ ...prev, [ca]: (prev[ca] || []).filter((r) => r.id !== rowId) }))
      setConfirmDeleteId(null)
      return
    }
    setDeletingRowId(rowId)
    try {
      const { error: err } = await supabase.from("production_shift_assignments").delete().eq("id", rowId)
      if (err) { setError(err.message); return }
      setConfirmDeleteId(null)
      setSavedRowIds((prev) => {
        if (!prev.has(rowId)) return prev
        const next = new Set(prev)
        next.delete(rowId)
        return next
      })
      if (factoryId) void loadData(factoryId)
    } finally {
      setDeletingRowId(null)
    }
  }

  // Người đã được gán ở dòng khác trong CÙNG ca (đã lưu) — chỉ để lọc bớt option trùng trong
  // dropdown, không chặn cứng (vẫn có thể gán trùng nếu người dùng cố tình chọn tay).
  const usedUserIdsByCa = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    for (const ca of CA_LIST) {
      map[ca] = new Set((rowsByCa[ca] || []).map((r) => r.assigned_user_id).filter((v): v is string => !!v))
    }
    return map
  }, [rowsByCa])

  if (loading) {
    return <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
  }

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        Gán sẵn (nhiều) người luôn trực từng ca để trang quét QR xác nhận sản xuất tự động gợi ý đúng Ca sản xuất theo tài khoản đang đăng nhập.
        Nếu không tìm thấy tài khoản, có thể chỉ ghi tên hiển thị (không bắt buộc chọn tài khoản).
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CA_LIST.map((ca) => {
          const rows = rowsByCa[ca] || []
          return (
            <div key={ca} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-lg bg-blue-100 px-2.5 py-1 text-sm font-extrabold text-blue-700">Ca {ca}</span>
                {canManage && (
                  <button
                    onClick={() => addRow(ca)}
                    className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                  >
                    <Plus size={12} /> Thêm người
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {rows.length === 0 && (
                  <p className="text-xs text-slate-400">Chưa có ai được phân công.</p>
                )}
                {rows.map((row) => (
                  <div key={row.id} className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Tài khoản trực ca</label>
                      <select
                        disabled={!canManage}
                        value={row.assigned_user_id || ""}
                        onChange={(e) => updateRow(ca, row.id, { assigned_user_id: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-100"
                      >
                        <option value="">-- Không chọn tài khoản --</option>
                        {userOptions.map((u) => (
                          <option
                            key={u.id}
                            value={u.id}
                            disabled={u.id !== row.assigned_user_id && usedUserIdsByCa[ca]?.has(u.id)}
                          >
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Tên hiển thị (nếu chưa có tài khoản)</label>
                      <input
                        disabled={!canManage}
                        value={row.assigned_name || ""}
                        onChange={(e) => updateRow(ca, row.id, { assigned_name: e.target.value })}
                        placeholder="vd: Tổ trưởng ca A"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Ghi chú</label>
                      <input
                        disabled={!canManage}
                        value={row.ghi_chu || ""}
                        onChange={(e) => updateRow(ca, row.id, { ghi_chu: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-100"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                      <input
                        type="checkbox"
                        disabled={!canManage}
                        checked={row.is_active}
                        onChange={(e) => updateRow(ca, row.id, { is_active: e.target.checked })}
                      />
                      Đang áp dụng
                    </label>

                    {canManage && (
                      confirmDeleteId === row.id ? (
                        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs font-bold text-red-700">
                          <span className="flex-1">Xóa người này khỏi ca?</span>
                          <button
                            onClick={() => void handleDeleteRow(ca, row.id)}
                            disabled={deletingRowId === row.id}
                            className="rounded-lg bg-red-600 px-2 py-1 text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {deletingRowId === row.id ? "Đang xóa..." : "Xóa"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100"
                          >
                            Hủy
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => void handleSaveRow(ca, row.id)}
                            disabled={savingRowId === row.id}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <Save size={13} /> {savingRowId === row.id ? "Đang lưu..." : "Lưu"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(row.id)}
                            className="flex items-center justify-center rounded-xl border border-red-200 px-3 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )
                    )}
                    {savedRowIds.has(row.id) && !row.isNew && (
                      <p className="text-center text-xs font-bold text-emerald-600">Đã lưu</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
