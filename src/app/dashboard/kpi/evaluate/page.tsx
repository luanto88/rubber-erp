"use client"

// Tab "Chấm điểm chuyên môn" (Phase 3) — nộp kpi_daily_evaluations theo (người, ngày, nhóm) +
// xem lịch sử chấm điểm trong ngày. Xem đầy đủ .claude/rules/27-kpi-module.md mục "D — Điểm
// chuyên môn" + "Database Schema" ("Nhóm & Chuyên môn (D)").
//
// Nộp/sửa lại đều đi qua RPC atomic kpi_submit_daily_evaluation (upsert theo
// factory_id+user_id+ngay+group_id, tự tính `loai` chính/choàng server-side) — trang này chỉ thu
// thập input, không tự tính `loai` để hiển thị chính thức (chỉ preview tham khảo trước khi lưu).

import { useCallback, useEffect, useMemo, useState } from "react"
import { ClipboardCheck, Pencil, Save, Trash2 } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { getTodayISODate } from "@/lib/date-utils"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { KpiShell } from "@/app/dashboard/kpi/_components/kpi-shell"
import { getKpiErrorMessage, loadKpiTaskCandidates, type KpiTaskCandidate } from "@/lib/kpi-tasks"
import { loadAllPersonnelGroups, type KpiGroupOption } from "@/lib/kpi-templates"
import { fetchKpiCriteriaTemplatesByGroup, type KpiCriteriaTemplate } from "@/lib/kpi-criteria"
import {
  computeDailyPercent,
  deleteKpiDailyEvaluation,
  fetchKpiDailyEvaluationOne,
  fetchKpiDailyEvaluationsForDay,
  submitKpiDailyEvaluation,
  KPI_DAILY_RESULT_BADGE_CLASS,
  KPI_DAILY_RESULT_LABEL,
  type KpiDailyEvaluationWithItems,
  type KpiDailyResult,
} from "@/lib/kpi-daily-evaluations"

const RESULT_OPTIONS: KpiDailyResult[] = ["dat", "tuong_doi", "chua_dat"]

export default function KpiEvaluatePage() {
  const revealRef = useScrollReveal()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [candidates, setCandidates] = useState<KpiTaskCandidate[]>([])
  const [groups, setGroups] = useState<KpiGroupOption[]>([])
  const [dayHistory, setDayHistory] = useState<KpiDailyEvaluationWithItems[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const [ngay, setNgay] = useState(getTodayISODate())
  const [selectedUserId, setSelectedUserId] = useState("")
  const [selectedGroupId, setSelectedGroupId] = useState("")
  const [criteria, setCriteria] = useState<KpiCriteriaTemplate[]>([])
  const [ketQuaByCriteria, setKetQuaByCriteria] = useState<Record<string, KpiDailyResult>>({})
  const [ghiChu, setGhiChu] = useState("")
  const [existingEvalId, setExistingEvalId] = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<KpiDailyEvaluationWithItems | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const bootstrap = async () => {
      const cachedUser = JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
      if (!hasPermission(cachedUser, "kpi.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      try {
        const fid = await getActiveFactoryId()
        if (!fid) { setLoading(false); return }
        const { user: sessionUser } = await hydrateActiveSession()
        if (!sessionUser) { setLoading(false); return }
        setFactoryId(fid)
        setUser(sessionUser)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  const loadCandidatesAndGroups = useCallback(async (fid: string) => {
    const [candidateData, groupRows] = await Promise.all([loadKpiTaskCandidates(fid), loadAllPersonnelGroups(fid)])
    setCandidates(candidateData.people)
    setGroups(groupRows)
  }, [])

  const loadDayHistory = useCallback(async (fid: string, day: string) => {
    setDataLoading(true)
    setDataError(null)
    try {
      setDayHistory(await fetchKpiDailyEvaluationsForDay(fid, day))
    } catch (err) {
      setDataError(getKpiErrorMessage(err, "Không tải được lịch sử chấm điểm."))
    } finally {
      setDataLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void loadCandidatesAndGroups(factoryId)
  }, [factoryId, loadCandidatesAndGroups])

  useEffect(() => {
    if (factoryId) void loadDayHistory(factoryId, ngay)
  }, [factoryId, ngay, loadDayHistory])

  const nameByUserId = useMemo(() => {
    const map: Record<string, string> = Object.fromEntries(candidates.map((c) => [c.userId, c.ten]))
    if (user) map[user.id] = user.full_name || user.username || map[user.id] || "Bạn"
    return map
  }, [candidates, user])
  const resolveName = useCallback((uid: string) => nameByUserId[uid] || `Người dùng ${uid.slice(0, 8)}`, [nameByUserId])
  const groupNameById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups])

  const selectedCandidate = useMemo(() => candidates.find((c) => c.userId === selectedUserId) || null, [candidates, selectedUserId])
  const groupOptionsForUser = useMemo(
    () => (selectedCandidate ? groups.filter((g) => selectedCandidate.groupIds.includes(g.id)) : []),
    [selectedCandidate, groups],
  )
  const previewLoai = selectedCandidate && selectedGroupId && selectedCandidate.primaryGroupId === selectedGroupId ? "chinh" : "choang"

  // Khi đổi người: nhóm đã chọn có thể không còn hợp lệ (người mới không thuộc nhóm đó) — tự gỡ.
  useEffect(() => {
    if (selectedGroupId && selectedCandidate && !selectedCandidate.groupIds.includes(selectedGroupId)) {
      setSelectedGroupId("")
    }
  }, [selectedUserId, selectedCandidate, selectedGroupId])

  // Tải tiêu chí + lượt chấm đã có (nếu có) mỗi khi đủ 3 điều kiện (ngày + người + nhóm).
  useEffect(() => {
    if (!factoryId || !selectedUserId || !selectedGroupId) {
      setCriteria([])
      setKetQuaByCriteria({})
      setGhiChu("")
      setExistingEvalId(null)
      return
    }
    let alive = true
    setFormLoading(true)
    setFormError(null)
    void (async () => {
      try {
        const [criteriaRows, existing] = await Promise.all([
          fetchKpiCriteriaTemplatesByGroup(factoryId, selectedGroupId),
          fetchKpiDailyEvaluationOne(factoryId, selectedUserId, ngay, selectedGroupId),
        ])
        if (!alive) return
        setCriteria(criteriaRows)
        if (existing) {
          setKetQuaByCriteria(Object.fromEntries(existing.items.map((it) => [it.criteria_id, it.ket_qua])))
          setGhiChu(existing.ghi_chu || "")
          setExistingEvalId(existing.id)
        } else {
          setKetQuaByCriteria({})
          setGhiChu("")
          setExistingEvalId(null)
        }
      } catch (err) {
        if (alive) setFormError(getKpiErrorMessage(err, "Không tải được tiêu chí/lượt chấm."))
      } finally {
        if (alive) setFormLoading(false)
      }
    })()
    return () => { alive = false }
  }, [factoryId, selectedUserId, selectedGroupId, ngay])

  const scoredItems = useMemo(
    () => Object.entries(ketQuaByCriteria).map(([criteriaId, ketQua]) => ({ criteriaId, ketQua })),
    [ketQuaByCriteria],
  )
  const livePercent = useMemo(() => computeDailyPercent(scoredItems.map((it) => ({ ket_qua: it.ketQua }))), [scoredItems])

  const isAdmin = user?.role === "admin"
  const canEvaluate = isAdmin || hasPermission(user, "kpi.evaluate")

  const handleSelectResult = (criteriaId: string, ketQua: KpiDailyResult) => {
    setKetQuaByCriteria((prev) => ({ ...prev, [criteriaId]: ketQua }))
  }

  const handleSave = async () => {
    if (!factoryId || !selectedUserId || !selectedGroupId) return
    if (scoredItems.length === 0) {
      setFormError("Vui lòng chấm ít nhất 1 tiêu chí.")
      return
    }
    setSaving(true)
    setFormError(null)
    setSaveMessage(null)
    try {
      await submitKpiDailyEvaluation({
        userId: selectedUserId,
        ngay,
        groupId: selectedGroupId,
        ghiChu,
        items: scoredItems,
      })
      setSaveMessage(`Đã lưu — ${resolveName(selectedUserId)} · ${groupNameById[selectedGroupId] || "—"} · ${ngay}`)
      void loadDayHistory(factoryId, ngay)
    } catch (err) {
      setFormError(getKpiErrorMessage(err, "Không lưu được lượt chấm điểm."))
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMessage(null), 5000)
    }
  }

  const openEditFromHistory = (row: KpiDailyEvaluationWithItems) => {
    setNgay(row.ngay)
    setSelectedUserId(row.user_id)
    setSelectedGroupId(row.group_id)
    setSaveMessage(null)
    setFormError(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget || !factoryId) return
    setDeleting(true)
    try {
      await deleteKpiDailyEvaluation(deleteTarget.id)
      setDeleteTarget(null)
      if (existingEvalId === deleteTarget.id) {
        setKetQuaByCriteria({})
        setGhiChu("")
        setExistingEvalId(null)
      }
      void loadDayHistory(factoryId, ngay)
    } catch (err) {
      setDataError(getKpiErrorMessage(err, "Không xóa được lượt chấm điểm."))
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <div className="p-12 text-center text-slate-400">Đang tải...</div>

  return (
    <KpiShell>
      <div className="space-y-4">
        <div ref={revealRef} className="scroll-reveal flex items-center gap-3">
          <div className="hover-lift shrink-0 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-200 via-violet-100 to-indigo-100 shadow-sm">
            <ClipboardCheck size={20} className="text-indigo-700" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Chấm điểm chuyên môn</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Chấm theo từng nhóm chuyên môn, mỗi ngày — dùng khung tiêu chí quản trị ở Cài đặt →
              KPI &amp; 5S → Khung tiêu chí KPI.
            </p>
          </div>
        </div>

        {canEvaluate ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Ngày *</label>
                <input
                  type="date"
                  value={ngay}
                  onChange={(e) => setNgay(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Người được chấm *</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                >
                  <option value="">-- Chọn người --</option>
                  {candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>{c.ten}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Nhóm chuyên môn *</label>
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  disabled={!selectedUserId}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">-- Chọn nhóm --</option>
                  {groupOptionsForUser.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                {selectedUserId && groupOptionsForUser.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-600">Người này chưa thuộc nhóm chuyên môn nào.</p>
                )}
              </div>
            </div>

            {formError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2 text-sm font-semibold text-red-600">{formError}</div>}
            {saveMessage && <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700">{saveMessage}</div>}

            {selectedUserId && selectedGroupId && (
              formLoading ? (
                <div className="p-6 text-center text-slate-400 text-sm">Đang tải tiêu chí...</div>
              ) : criteria.length === 0 ? (
                <div className="rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-400">
                  Nhóm này chưa có tiêu chí nào đang áp dụng — vào Cài đặt → KPI &amp; 5S → Khung
                  tiêu chí KPI để thêm.
                </div>
              ) : (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-500">
                      {existingEvalId ? "Đang sửa lượt chấm đã có" : "Lượt chấm mới"} — snapshot loại:{" "}
                      <span className={`px-1.5 py-0.5 rounded ${previewLoai === "chinh" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                        {previewLoai === "chinh" ? "Chính (×10)" : "Choàng (×5)"}
                      </span>
                    </span>
                    <span className="text-xs font-bold text-indigo-700">
                      %đạt hiện tại: {scoredItems.length > 0 ? `${livePercent}%` : "—"} ({scoredItems.length}/{criteria.length} tiêu chí đã chấm)
                    </span>
                  </div>

                  <div className="space-y-2">
                    {criteria.map((c) => (
                      <div key={c.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="text-sm font-bold text-slate-800">{c.ten_tieu_chi}</div>
                        {c.mo_ta && <div className="text-xs text-slate-500 mt-0.5">{c.mo_ta}</div>}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {RESULT_OPTIONS.map((opt) => {
                            const active = ketQuaByCriteria[c.id] === opt
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => handleSelectResult(c.id, opt)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                  active
                                    ? `${KPI_DAILY_RESULT_BADGE_CLASS[opt]} border-transparent`
                                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                                }`}
                              >
                                {KPI_DAILY_RESULT_LABEL[opt]}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-600">Ghi chú</label>
                    <textarea
                      value={ghiChu}
                      onChange={(e) => setGhiChu(e.target.value)}
                      rows={2}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                      placeholder="Tuỳ chọn — ghi chú thêm cho lượt chấm này"
                    />
                  </div>

                  <button
                    onClick={() => void handleSave()}
                    disabled={saving || scoredItems.length === 0}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md text-sm disabled:opacity-60"
                  >
                    <Save size={15} /> {saving ? "Đang lưu..." : existingEvalId ? "Cập nhật lượt chấm" : "Lưu lượt chấm"}
                  </button>
                </div>
              )
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
            Bạn không có quyền chấm điểm chuyên môn — chỉ xem được lịch sử bên dưới.
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-extrabold text-slate-700">Lịch sử chấm điểm ngày {ngay}</span>
          </div>
          {dataLoading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
          ) : dataError ? (
            <div className="p-8 text-center text-red-600 text-sm">{dataError}</div>
          ) : dayHistory.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">Chưa có lượt chấm nào trong ngày này.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {dayHistory.map((row) => {
                const percent = computeDailyPercent(row.items)
                return (
                  <div key={row.id} className="row-hover flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800">
                        {resolveName(row.user_id)} <span className="text-slate-400 font-normal">— {groupNameById[row.group_id] || "—"}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        <span className={`px-1.5 py-0.5 rounded ${row.loai === "chinh" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                          {row.loai === "chinh" ? "Chính (×10)" : "Choàng (×5)"}
                        </span>{" "}
                        · {row.items.length} tiêu chí · %đạt {percent}% · người chấm: {resolveName(row.nguoi_cham_id)}
                      </div>
                      {row.ghi_chu && <div className="text-xs text-slate-400 mt-0.5 italic">&quot;{row.ghi_chu}&quot;</div>}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {canEvaluate && (
                        <>
                          <button
                            onClick={() => openEditFromHistory(row)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-bold"
                          >
                            <Pencil size={11} /> Sửa
                          </button>
                          <button
                            onClick={() => setDeleteTarget(row)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold"
                          >
                            <Trash2 size={11} /> Xóa
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {deleteTarget && (
        <ModalShell
          title="Xóa lượt chấm điểm"
          onClose={() => setDeleteTarget(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDeleteTarget(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Không
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {deleting ? "Đang xóa..." : "Xác nhận xóa"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xóa lượt chấm của <strong>{resolveName(deleteTarget.user_id)}</strong> — nhóm{" "}
            <strong>{groupNameById[deleteTarget.group_id] || "—"}</strong>, ngày{" "}
            <strong>{deleteTarget.ngay}</strong>? Toàn bộ kết quả từng tiêu chí của lượt này sẽ bị
            xóa theo. Bạn có chắc chắn?
          </p>
        </ModalShell>
      )}
    </KpiShell>
  )
}
