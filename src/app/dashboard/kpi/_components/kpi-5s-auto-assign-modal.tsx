"use client"

// Modal "Phân công thông minh" cho vị trí 5S — thay thế thao tác gán tay từng vị trí khi số
// lượng vị trí quá nhiều. Random CÓ TRỌNG SỐ theo tải hiện tại (không phải random thuần túy),
// luôn cho xem trước + sửa tay trước khi ghi thật. Xem thuật toán trong kpi-5s-auto-assign.ts.
//
// Chuyển từ settings/_components/ sang đây (2026-07-29) để dùng chung được ở cả Cài đặt → KPI &
// 5S lẫn /dashboard/kpi/5s (nút đặt cạnh "Quản lý vị trí") — component thuần túy, không phụ
// thuộc gì vào layout Settings.
//
// Cập nhật 2026-07-29 — fix bug "chọn rất nhiều nhân sự không liên quan": pool lọc theo Phòng
// ban của vị trí (deptUserIdsByDept, tra qua /api/kpi/dept-users) + Khu vực nếu có.
//
// Cập nhật 2026-08-19 (theo phản hồi người dùng): "đã từng dọn/chấm" (establishedUserIds) KHÔNG
// còn thu hẹp dropdown sửa tay nữa — dropdown luôn hiện đủ nhân sự đúng Phòng ban/Khu vực (kể cả
// người mới chưa từng làm 5S), chỉ được RANDOM ưu tiên chọn người có kinh nghiệm hơn (trọng số).
// Cũng fix bug "Random 1 vị trí": khi modal chỉ nhận đúng 1 vị trí, mặc định chuyển sang "Phân
// công lại toàn bộ" thay vì "Chỉ vị trí chưa gán đủ" — nếu không, vị trí đã có sẵn cả 2 người sẽ
// luôn có targetCount=0, nút "Tạo đề xuất" bị khóa vĩnh viễn.

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, RefreshCw, Shuffle, Users } from "lucide-react"
import { ModalShell } from "../../_components/modal-shell"
import {
  updateKpi5sLocation,
  fetchAllLocationCleanerMemberships,
  getEffectiveCleanerIds,
  getKpi5sErrorMessage,
  type Kpi5sLocation,
} from "@/lib/kpi-5s"
import { fetchAllZoneMemberships } from "@/lib/kpi-5s-zones"
import { loadKpiTaskCandidates, fetchDepartmentUserIds, type KpiTaskCandidate } from "@/lib/kpi-tasks"
import {
  buildAutoAssignSuggestions,
  computeEstablished5sUserIds,
  type AutoAssignCandidate,
  type AutoAssignSuggestion,
} from "@/lib/kpi-5s-auto-assign"

// Trả về true nếu 2 mảng chứa đúng cùng tập giá trị (không quan tâm thứ tự) — dùng để phát hiện
// dòng nào thực sự thay đổi đội ngũ dọn dẹp trước khi ghi.
function arraysEqualAsSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((v) => setB.has(v))
}

type RowState = AutoAssignSuggestion & { originalCleanerIds: string[]; originalCham: string | null }

export function Kpi5sAutoAssignModal({
  factoryId,
  currentUserId,
  locations,
  onClose,
  onAssigned,
}: {
  factoryId: string
  currentUserId: string
  locations: Kpi5sLocation[]
  onClose: () => void
  onAssigned: (summary: { userId: string; ten: string; donZones: string[]; chamZones: string[] }[]) => void
}) {
  const [candidatesRaw, setCandidatesRaw] = useState<KpiTaskCandidate[]>([])
  const [zoneMembership, setZoneMembership] = useState<Map<string, string[]>>(new Map())
  const [deptUserIdsByDept, setDeptUserIdsByDept] = useState<Map<string, Set<string>>>(new Map())
  const [cleanerMembership, setCleanerMembership] = useState<Map<string, string[]>>(new Map())
  const [establishedUserIds, setEstablishedUserIds] = useState<Set<string>>(new Set())
  const [loadingCandidates, setLoadingCandidates] = useState(true)
  const [loadError, setLoadError] = useState("")

  // Random đúng 1 vị trí (đã có sẵn người) thì mặc định "Phân công lại toàn bộ" — nếu giữ mặc
  // định "Chỉ vị trí chưa gán đủ" sẽ luôn ra targetCount=0 vì vị trí đó đã có đủ người.
  const [onlyUnassigned, setOnlyUnassigned] = useState(locations.length !== 1)
  const [avoidSameGroup, setAvoidSameGroup] = useState(true)
  const [rows, setRows] = useState<RowState[] | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  // Bỏ qua đợt này (Mục 2b) — tách khỏi RowState để giữ nguyên trạng thái tắt xuyên suốt các
  // lần bấm "Random lại" (generate() tạo lại rows mới nhưng locationId không đổi).
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
  const toggleSkip = (locationId: string) =>
    setSkippedIds((prev) => {
      const next = new Set(prev)
      if (next.has(locationId)) next.delete(locationId)
      else next.add(locationId)
      return next
    })

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoadingCandidates(true)
      setLoadError("")
      try {
        const distinctDeptIds = [...new Set(locations.map((l) => l.phong_ban_id).filter((v): v is string => !!v))]
        const [taskData, membership, cleanerMap, deptEntries] = await Promise.all([
          loadKpiTaskCandidates(factoryId),
          fetchAllZoneMemberships(factoryId),
          fetchAllLocationCleanerMemberships(factoryId),
          Promise.all(distinctDeptIds.map(async (id) => [id, await fetchDepartmentUserIds(factoryId, id)] as const)),
        ])
        if (!alive) return
        setCandidatesRaw(taskData.people)
        setZoneMembership(membership)
        setDeptUserIdsByDept(new Map(deptEntries))
        setCleanerMembership(cleanerMap)
        setEstablishedUserIds(computeEstablished5sUserIds(locations, cleanerMap))
      } catch (err) {
        if (alive) setLoadError(getKpi5sErrorMessage(err, "Không tải được danh sách nhân sự."))
      } finally {
        if (alive) setLoadingCandidates(false)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ tải lại khi factoryId đổi, không phải mỗi lần `locations` đổi identity
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
        phong_ban_id: l.phong_ban_id,
        current_cleaner_ids: getEffectiveCleanerIds(l, cleanerMembership),
      })),
      candidates,
      { onlyUnassigned, avoidSameGroup, deptUserIdsByDept, establishedUserIds },
    )
    setRows(
      suggestions.map((s) => {
        const l = locationById[s.locationId]
        return {
          ...s,
          originalCleanerIds: l ? getEffectiveCleanerIds(l, cleanerMembership) : [],
          originalCham: l?.nguoi_cham_id || null,
        }
      }),
    )
    setSaveError("")
  }

  // Bấm/bỏ 1 người trong ô "Người dọn" — tự gỡ khỏi vai trò "Người chấm" nếu đang được set (1
  // người không thể vừa dọn vừa chấm), mirror toggleFormCleaner() ở kpi-5s-locations-tab.tsx.
  const toggleRowCleaner = (locationId: string, userId: string) => {
    setRows((prev) =>
      (prev || []).map((r) => {
        if (r.locationId !== locationId) return r
        const nguoiDonIds = r.nguoiDonIds.includes(userId)
          ? r.nguoiDonIds.filter((id) => id !== userId)
          : [...r.nguoiDonIds, userId]
        return { ...r, nguoiDonIds, nguoiChamId: r.nguoiChamId === userId ? null : r.nguoiChamId }
      }),
    )
  }

  const updateRow = (locationId: string, patch: Partial<Pick<RowState, "nguoiChamId">>) => {
    setRows((prev) => (prev || []).map((r) => (r.locationId === locationId ? { ...r, ...patch } : r)))
  }

  const handleConfirm = async () => {
    if (!rows || rows.length === 0) return
    setSaving(true)
    setSaveError("")
    try {
      const changed = rows.filter(
        (r) =>
          !skippedIds.has(r.locationId) &&
          (!arraysEqualAsSets(r.nguoiDonIds, r.originalCleanerIds) || r.nguoiChamId !== r.originalCham),
      )
      await Promise.all(
        changed.map((r) => updateKpi5sLocation(r.locationId, { nguoi_cham_id: r.nguoiChamId }, r.nguoiDonIds, currentUserId)),
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
        for (const uid of r.nguoiDonIds) {
          if (!r.originalCleanerIds.includes(uid)) ensure(uid).donZones.push(label)
        }
        if (r.nguoiChamId && r.nguoiChamId !== r.originalCham) ensure(r.nguoiChamId).chamZones.push(label)
      }
      onAssigned(Array.from(byUser.values()))
    } catch (err) {
      setSaveError(getKpi5sErrorMessage(err, "Không lưu được phân công."))
    } finally {
      setSaving(false)
    }
  }

  const changedCount = rows
    ? rows.filter(
        (r) =>
          !skippedIds.has(r.locationId) &&
          (!arraysEqualAsSets(r.nguoiDonIds, r.originalCleanerIds) || r.nguoiChamId !== r.originalCham),
      ).length
    : 0

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
            Random <strong>có trọng số theo tải hiện tại</strong>, chỉ trong số nhân sự thuộc đúng
            Phòng ban (và Khu vực nếu có) của vị trí — ưu tiên người ĐANG là người dọn/chấm ở vị
            trí khác nhưng không loại người mới; dropdown bên dưới vẫn cho chọn tay bất kỳ ai
            trong Phòng ban đó.
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
                const eligibleSet = new Set(r.eligibleUserIds)
                const options = eligibleSet.size > 0 ? candidates.filter((c) => eligibleSet.has(c.userId)) : candidates
                const skipped = skippedIds.has(r.locationId)
                return (
                  <div
                    key={r.locationId}
                    className={`p-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-2 items-center${skipped ? " opacity-40" : ""}`}
                  >
                    <div>
                      <label className="flex items-center gap-1.5 mb-1 text-[10px] font-bold text-slate-400">
                        <input
                          type="checkbox"
                          checked={skipped}
                          onChange={() => toggleSkip(r.locationId)}
                          className="accent-slate-400"
                        />
                        Bỏ qua đợt này
                      </label>
                      <div className="text-[11px] font-bold text-violet-700">{l.ma_vi_tri}</div>
                      <div className="text-sm font-semibold text-slate-700">{l.ten_vi_tri}</div>
                      {(r.deptPoolRelaxed || r.noEstablishedCandidate) && (
                        <div className="mt-0.5 flex flex-col gap-0.5">
                          {r.deptPoolRelaxed && (
                            <span className="text-[10px] text-amber-600 flex items-center gap-1">
                              <AlertTriangle size={9} /> Chưa tra được phòng ban — không lọc được
                            </span>
                          )}
                          {r.noEstablishedCandidate && (
                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                              Phòng ban chưa từng gán ai — random ngẫu nhiên, không ưu tiên
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-0.5 flex items-center gap-1">
                        Người dọn ({r.nguoiDonIds.length})
                        {r.zonePoolRelaxed && (
                          <span title="Khu vực không đủ 2 người — đã tự nới lỏng">
                            <AlertTriangle size={10} className="text-amber-500" />
                          </span>
                        )}
                      </label>
                      <div className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-slate-300 p-1.5">
                        {options.length === 0 ? (
                          <div className="px-1 py-1 text-[11px] text-slate-400">Không có ứng viên phù hợp.</div>
                        ) : (
                          options.map((c) => (
                            <label key={c.userId} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-slate-50">
                              <input
                                type="checkbox"
                                checked={r.nguoiDonIds.includes(c.userId)}
                                onChange={() => toggleRowCleaner(r.locationId, c.userId)}
                                disabled={skipped}
                                className="h-3.5 w-3.5 rounded accent-violet-600"
                              />
                              {c.ten}
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-0.5 flex items-center gap-1">
                        Người chấm
                        {r.zonePoolRelaxed && (
                          <span title="Khu vực không đủ 2 người — đã tự nới lỏng">
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
                        disabled={skipped}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-violet-500 disabled:bg-slate-100"
                      >
                        <option value="">— Chưa gán —</option>
                        {options.map((c) => (
                          <option key={c.userId} value={c.userId} disabled={r.nguoiDonIds.includes(c.userId)}>{c.ten}</option>
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
