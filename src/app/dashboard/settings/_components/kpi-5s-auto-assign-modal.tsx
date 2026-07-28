"use client"

// Modal "Phân công thông minh" cho vị trí 5S — thay thế thao tác gán tay từng vị trí khi số
// lượng vị trí quá nhiều. Random CÓ TRỌNG SỐ theo tải hiện tại (không phải random thuần túy),
// luôn cho xem trước + sửa tay trước khi ghi thật. Xem thuật toán trong kpi-5s-auto-assign.ts.

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, RefreshCw, Shuffle, Users } from "lucide-react"
import { ModalShell } from "../../_components/modal-shell"
import { patchKpi5sLocation, getKpi5sErrorMessage, type Kpi5sLocation } from "@/lib/kpi-5s"
import { fetchAllZoneMemberships } from "@/lib/kpi-5s-zones"
import { loadKpiTaskCandidates, type KpiTaskCandidate } from "@/lib/kpi-tasks"
import { buildAutoAssignSuggestions, type AutoAssignCandidate, type AutoAssignSuggestion } from "@/lib/kpi-5s-auto-assign"

type RowState = AutoAssignSuggestion & { originalDon: string | null; originalCham: string | null }

export function Kpi5sAutoAssignModal({
  factoryId,
  locations,
  onClose,
  onAssigned,
}: {
  factoryId: string
  locations: Kpi5sLocation[]
  onClose: () => void
  onAssigned: (summary: { userId: string; ten: string; donZones: string[]; chamZones: string[] }[]) => void
}) {
  const [candidatesRaw, setCandidatesRaw] = useState<KpiTaskCandidate[]>([])
  const [zoneMembership, setZoneMembership] = useState<Map<string, string[]>>(new Map())
  const [loadingCandidates, setLoadingCandidates] = useState(true)
  const [loadError, setLoadError] = useState("")

  const [onlyUnassigned, setOnlyUnassigned] = useState(true)
  const [avoidSameGroup, setAvoidSameGroup] = useState(true)
  const [rows, setRows] = useState<RowState[] | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoadingCandidates(true)
      setLoadError("")
      try {
        const [taskData, membership] = await Promise.all([
          loadKpiTaskCandidates(factoryId),
          fetchAllZoneMemberships(factoryId),
        ])
        if (alive) {
          setCandidatesRaw(taskData.people)
          setZoneMembership(membership)
        }
      } catch (err) {
        if (alive) setLoadError(getKpi5sErrorMessage(err, "Không tải được danh sách nhân sự."))
      } finally {
        if (alive) setLoadingCandidates(false)
      }
    })()
    return () => { alive = false }
  }, [factoryId])

  // Gộp thành viên khu vực (kpi_5s_zone_members) vào từng candidate — dùng cho ràng buộc
  // "chỉ random trong nội bộ khu vực" của thuật toán. Độc lập với primaryGroupId/groupIds
  // (personnel_groups — nhóm CHUYÊN MÔN, dùng cho ràng buộc mềm khác, không được gộp lại).
  const candidates: AutoAssignCandidate[] = useMemo(() => {
    const zoneIdsByUser = new Map<string, string[]>()
    for (const [zoneId, userIds] of zoneMembership) {
      for (const uid of userIds) zoneIdsByUser.set(uid, [...(zoneIdsByUser.get(uid) || []), zoneId])
    }
    return candidatesRaw.map((c) => ({
      userId: c.userId,
      ten: c.ten,
      primaryGroupId: c.primaryGroupId,
      zoneIds: zoneIdsByUser.get(c.userId) || [],
    }))
  }, [candidatesRaw, zoneMembership])

  const nameByUserId = useMemo(() => Object.fromEntries(candidates.map((c) => [c.userId, c.ten])), [candidates])
  const locationById = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l])), [locations])

  const targetCount = useMemo(
    () => (onlyUnassigned ? locations.filter((l) => !l.nguoi_don_id || !l.nguoi_cham_id).length : locations.length),
    [locations, onlyUnassigned],
  )

  const generate = () => {
    const suggestions = buildAutoAssignSuggestions(
      locations.map((l) => ({
        id: l.id,
        ma_vi_tri: l.ma_vi_tri,
        ten_vi_tri: l.ten_vi_tri,
        nguoi_don_id: l.nguoi_don_id,
        nguoi_cham_id: l.nguoi_cham_id,
        zone_id: l.zone_id,
      })),
      candidates,
      { onlyUnassigned, avoidSameGroup },
    )
    setRows(
      suggestions.map((s) => {
        const l = locationById[s.locationId]
        return { ...s, originalDon: l?.nguoi_don_id || null, originalCham: l?.nguoi_cham_id || null }
      }),
    )
    setSaveError("")
  }

  const updateRow = (locationId: string, patch: Partial<Pick<RowState, "nguoiDonId" | "nguoiChamId">>) => {
    setRows((prev) => (prev || []).map((r) => (r.locationId === locationId ? { ...r, ...patch } : r)))
  }

  const handleConfirm = async () => {
    if (!rows || rows.length === 0) return
    setSaving(true)
    setSaveError("")
    try {
      const changed = rows.filter((r) => r.nguoiDonId !== r.originalDon || r.nguoiChamId !== r.originalCham)
      await Promise.all(
        changed.map((r) => patchKpi5sLocation(r.locationId, { nguoi_don_id: r.nguoiDonId, nguoi_cham_id: r.nguoiChamId })),
      )

      // Tổng hợp theo người để hiện thông báo/thông tin cho bước sau (Telegram) — mỗi người có
      // thể được giao nhiều vị trí trong cùng 1 đợt, gộp thành 1 dòng.
      const byUser = new Map<string, { userId: string; ten: string; donZones: string[]; chamZones: string[] }>()
      const ensure = (uid: string) => {
        if (!byUser.has(uid)) byUser.set(uid, { userId: uid, ten: nameByUserId[uid] || uid, donZones: [], chamZones: [] })
        return byUser.get(uid)!
      }
      for (const r of changed) {
        const l = locationById[r.locationId]
        const label = l ? `${l.ma_vi_tri} — ${l.ten_vi_tri}` : r.locationId
        if (r.nguoiDonId && r.nguoiDonId !== r.originalDon) ensure(r.nguoiDonId).donZones.push(label)
        if (r.nguoiChamId && r.nguoiChamId !== r.originalCham) ensure(r.nguoiChamId).chamZones.push(label)
      }
      onAssigned(Array.from(byUser.values()))
    } catch (err) {
      setSaveError(getKpi5sErrorMessage(err, "Không lưu được phân công."))
    } finally {
      setSaving(false)
    }
  }

  const changedCount = rows ? rows.filter((r) => r.nguoiDonId !== r.originalDon || r.nguoiChamId !== r.originalCham).length : 0

  return (
    <ModalShell
      title="Phân công thông minh — Vị trí 5S"
      onClose={onClose}
      maxWidth="3xl"
      footer={
        rows && (
          <>
            <button onClick={onClose} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
              Hủy
            </button>
            <button
              onClick={() => void handleConfirm()}
              disabled={saving || changedCount === 0}
              className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
            >
              {saving ? "Đang giao..." : `Xác nhận & Giao (${changedCount} thay đổi)`}
            </button>
          </>
        )
      }
    >
      {loadingCandidates ? (
        <div className="p-8 text-center text-slate-400 text-sm">Đang tải danh sách nhân sự...</div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{loadError}</div>
      ) : candidates.length < 2 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Cần ít nhất 2 nhân sự đã liên kết tài khoản (Cài đặt → Hệ thống → Nhân sự) để dùng công cụ này.
        </div>
      ) : !rows ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Users size={15} className="text-violet-600" />
            Random <strong>có trọng số theo tải hiện tại</strong> — người đang phụ trách ít vị trí hơn có xác suất được chọn cao hơn, không phải random đều 100%.
          </div>
          <div className="space-y-2.5">
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" checked={onlyUnassigned} onChange={() => setOnlyUnassigned(true)} className="mt-1 accent-violet-600" />
              <span>
                Chỉ vị trí <strong>chưa gán đủ</strong> người dọn/chấm (giữ nguyên phần đã gán)
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" checked={!onlyUnassigned} onChange={() => setOnlyUnassigned(false)} className="mt-1 accent-violet-600" />
              <span>
                Phân công lại <strong>toàn bộ</strong> vị trí đang áp dụng ({locations.length} vị trí)
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm pt-1 border-t border-slate-100">
              <input type="checkbox" checked={avoidSameGroup} onChange={(e) => setAvoidSameGroup(e.target.checked)} className="accent-violet-600" />
              Tránh người chấm cùng nhóm chính với người dọn (giảm rủi ro thông đồng)
            </label>
          </div>
          <button
            onClick={generate}
            disabled={targetCount === 0}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md text-sm disabled:opacity-50"
          >
            <Shuffle size={15} /> Tạo đề xuất ({targetCount} vị trí)
          </button>
          {targetCount === 0 && <p className="text-xs text-slate-400">Không có vị trí nào cần phân công theo lựa chọn hiện tại.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {saveError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{saveError}</div>}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">Xem lại và sửa tay nếu cần trước khi xác nhận — chỉ những dòng có thay đổi mới được ghi.</p>
            <button onClick={generate} className="flex items-center gap-1.5 text-xs font-bold text-violet-600 hover:text-violet-700">
              <RefreshCw size={12} /> Random lại
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="max-h-[50vh] overflow-y-auto divide-y divide-slate-100">
              {rows.map((r) => {
                const l = locationById[r.locationId]
                if (!l) return null
                return (
                  <div key={r.locationId} className="p-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-2 items-center">
                    <div>
                      <div className="text-[11px] font-bold text-violet-700">{l.ma_vi_tri}</div>
                      <div className="text-sm font-semibold text-slate-700">{l.ten_vi_tri}</div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-0.5 flex items-center gap-1">
                        Người dọn
                        {r.zonePoolRelaxed && (
                          <span title="Khu vực không đủ 2 người — đã tự nới lỏng về pool toàn nhà máy">
                            <AlertTriangle size={10} className="text-amber-500" />
                          </span>
                        )}
                      </label>
                      <select
                        value={r.nguoiDonId || ""}
                        onChange={(e) => updateRow(r.locationId, { nguoiDonId: e.target.value || null })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-violet-500"
                      >
                        <option value="">— Chưa gán —</option>
                        {candidates.map((c) => (
                          <option key={c.userId} value={c.userId} disabled={c.userId === r.nguoiChamId}>{c.ten}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-0.5 flex items-center gap-1">
                        Người chấm
                        {r.zonePoolRelaxed && (
                          <span title="Khu vực không đủ 2 người — đã tự nới lỏng về pool toàn nhà máy">
                            <AlertTriangle size={10} className="text-amber-500" />
                          </span>
                        )}
                        {r.groupConstraintRelaxed && (
                          <span title="Không còn ứng viên khác nhóm chính — đã tự nới lỏng ràng buộc">
                            <AlertTriangle size={10} className="text-amber-500" />
                          </span>
                        )}
                      </label>
                      <select
                        value={r.nguoiChamId || ""}
                        onChange={(e) => updateRow(r.locationId, { nguoiChamId: e.target.value || null })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-violet-500"
                      >
                        <option value="">— Chưa gán —</option>
                        {candidates.map((c) => (
                          <option key={c.userId} value={c.userId} disabled={c.userId === r.nguoiDonId}>{c.ten}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  )
}
