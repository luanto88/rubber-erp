"use client"

// Tab "Việc định kỳ" — CRUD kpi_task_templates (chỉ kpi.manage_config/admin) + đăng ký/quản lý
// "Người thay thế tạm thời" (kpi_user_substitutions, mọi user tự đăng ký cho chính mình).
// Xem đầy đủ .claude/rules/27-kpi-module.md mục "Việc định kỳ theo nhóm" + "Người thay thế
// tạm thời".

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CalendarClock, Pencil, Plus, Power, RefreshCw, Repeat, Trash2, UserCog } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { KpiShell } from "@/app/dashboard/kpi/_components/kpi-shell"
import {
  fetchDepartmentOptions,
  resolveMyLeaderDepartmentId,
  type DepartmentOption,
} from "@/lib/kpi-department-leaders"
import {
  formatKpiDateTime,
  getKpiErrorMessage,
  KPI_MODULE_LABEL,
  KPI_REPORT_REQ_LABEL,
  loadKpiTaskCandidates,
  type KpiTaskCandidate,
} from "@/lib/kpi-tasks"
import {
  deleteKpiTaskTemplate,
  deleteKpiUserSubstitution,
  ensureTodayKpiTaskInstances,
  fetchKpiTaskTemplates,
  fetchKpiUserSubstitutions,
  fetchPendingSubstitutionsForApprover,
  KPI_SUBSTITUTION_STATUS_BADGE_CLASS,
  KPI_SUBSTITUTION_STATUS_LABEL,
  KPI_WEEKDAY_LABEL,
  KPI_WEEKDAY_OPTIONS,
  loadAllPersonnelGroups,
  setKpiTaskTemplateActive,
  type KpiGroupOption,
  type KpiTaskTemplate,
  type KpiUserSubstitution,
} from "@/lib/kpi-templates"
import { TemplateFormModal } from "./_components/template-form-modal"
import { SubstitutionFormModal } from "./_components/substitution-form-modal"
import { PendingSubstitutionsBanner } from "@/app/dashboard/kpi/_components/pending-substitutions-banner"

export default function KpiTemplatesPage() {
  const revealRef = useScrollReveal()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [subTab, setSubTab] = useState<"templates" | "substitutions">("templates")
  const [templates, setTemplates] = useState<KpiTaskTemplate[]>([])
  const [substitutions, setSubstitutions] = useState<KpiUserSubstitution[]>([])
  const [groups, setGroups] = useState<KpiGroupOption[]>([])
  const [candidates, setCandidates] = useState<KpiTaskCandidate[]>([])
  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [pendingSubs, setPendingSubs] = useState<KpiUserSubstitution[]>([])
  const [myLeaderDepartmentId, setMyLeaderDepartmentId] = useState<string | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const [editingTemplate, setEditingTemplate] = useState<KpiTaskTemplate | null>(null)
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [showSubForm, setShowSubForm] = useState(false)
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<KpiTaskTemplate | null>(null)
  const [deleteSubTarget, setDeleteSubTarget] = useState<KpiUserSubstitution | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [syncingToday, setSyncingToday] = useState(false)
  const [syncTodayMessage, setSyncTodayMessage] = useState<string | null>(null)

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

  const loadData = useCallback(async (fid: string, uid: string) => {
    setDataLoading(true)
    setDataError(null)
    try {
      const [templateRows, subRows, groupRows, candidateData, deptRows, leaderDeptId] = await Promise.all([
        fetchKpiTaskTemplates(fid),
        fetchKpiUserSubstitutions(fid),
        loadAllPersonnelGroups(fid),
        loadKpiTaskCandidates(fid),
        fetchDepartmentOptions(),
        resolveMyLeaderDepartmentId(uid, fid),
      ])
      setTemplates(templateRows)
      setSubstitutions(subRows)
      setGroups(groupRows)
      setCandidates(candidateData.people)
      setDepartments(deptRows)
      setMyLeaderDepartmentId(leaderDeptId)
    } catch (err) {
      setDataError(getKpiErrorMessage(err, "Không tải được dữ liệu."))
    } finally {
      setDataLoading(false)
    }
  }, [])

  // Đăng ký "cho_duyet" mà CHÍNH người xem cần xử lý — tách riêng vì phụ thuộc user.id (không có
  // ở loadData chung, và RLS đã tự giới hạn tập nhìn thấy theo đúng người này).
  const loadPendingSubs = useCallback(async (fid: string, uid: string) => {
    try {
      setPendingSubs(await fetchPendingSubstitutionsForApprover(uid, fid))
    } catch {
      // im lặng — banner chỉ là tiện ích, không chặn phần còn lại của trang
    }
  }, [])

  useEffect(() => {
    if (factoryId && user) void loadData(factoryId, user.id)
  }, [factoryId, user, loadData])

  useEffect(() => {
    if (factoryId && user) void loadPendingSubs(factoryId, user.id)
  }, [factoryId, user, loadPendingSubs])

  // Mặc định sub-tab: người không quản lý được "Việc định kỳ" (không phải admin/kpi.manage_config/
  // lãnh đạo phòng ban) chỉ cần vào đây để tự đăng ký "Người thay thế tạm thời" — mở thẳng đúng
  // sub-tab đó thay vì "Việc định kỳ" (đọc được nhưng không thao tác gì được). Chỉ áp dụng MỘT
  // LẦN ngay sau khi biết đủ quyền, không ép lại nếu người dùng đã tự chuyển tab.
  const defaultSubTabAppliedRef = useRef(false)
  useEffect(() => {
    if (defaultSubTabAppliedRef.current) return
    if (!factoryId || !user || dataLoading) return
    defaultSubTabAppliedRef.current = true
    const manage = user.role === "admin" || hasPermission(user, "kpi.manage_config") || myLeaderDepartmentId != null
    if (!manage) setSubTab("substitutions")
  }, [factoryId, user, dataLoading, myLeaderDepartmentId])

  const nameByUserId = useMemo(() => {
    const map: Record<string, string> = Object.fromEntries(candidates.map((c) => [c.userId, c.ten]))
    if (user) map[user.id] = user.full_name || user.username || map[user.id] || "Bạn"
    return map
  }, [candidates, user])
  const resolveName = useCallback((uid: string) => nameByUserId[uid] || `Người dùng ${uid.slice(0, 8)}`, [nameByUserId])
  const groupNameById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups])
  const templateTitleById = useMemo(() => Object.fromEntries(templates.map((t) => [t.id, t.tieu_de])), [templates])

  if (loading) return <div className="p-12 text-center text-slate-400">Đang tải...</div>

  const isAdmin = user?.role === "admin"
  const isDeptLeader = myLeaderDepartmentId != null
  // Khớp đúng RLS kpi_task_templates_insert/update/delete (migration
  // 20260807_kpi_department_scoping.sql) — admin HOẶC kpi.manage_config HOẶC lãnh đạo phòng ban
  // (bất kỳ phòng ban nào, vì template tự khai báo phong_ban_id riêng khi tạo).
  const canManageTemplates = isAdmin || hasPermission(user, "kpi.manage_config") || isDeptLeader
  const canChooseOriginal = isAdmin || hasPermission(user, "kpi.assign")

  const handleToggleActive = async (t: KpiTaskTemplate) => {
    setBusyId(t.id)
    setActionError(null)
    try {
      await setKpiTaskTemplateActive(t.id, !t.is_active)
      if (factoryId && user) await loadData(factoryId, user.id)
    } catch (err) {
      setActionError(getKpiErrorMessage(err, "Không cập nhật được trạng thái."))
    } finally {
      setBusyId(null)
    }
  }

  const handleDeleteTemplate = async () => {
    if (!deleteTemplateTarget) return
    setBusyId(deleteTemplateTarget.id)
    setActionError(null)
    try {
      await deleteKpiTaskTemplate(deleteTemplateTarget.id)
      setDeleteTemplateTarget(null)
      if (factoryId && user) await loadData(factoryId, user.id)
    } catch (err) {
      setActionError(getKpiErrorMessage(err, "Không xóa được việc định kỳ."))
    } finally {
      setBusyId(null)
    }
  }

  const handleDeleteSub = async () => {
    if (!deleteSubTarget) return
    setBusyId(deleteSubTarget.id)
    setActionError(null)
    try {
      await deleteKpiUserSubstitution(deleteSubTarget.id)
      setDeleteSubTarget(null)
      if (factoryId && user) await loadData(factoryId, user.id)
    } catch (err) {
      setActionError(getKpiErrorMessage(err, "Không hủy được đăng ký."))
    } finally {
      setBusyId(null)
    }
  }

  const canManageSub = (s: KpiUserSubstitution) => isAdmin || s.original_user_id === user?.id || s.created_by === user?.id

  const handleSyncToday = async () => {
    if (!factoryId || !user) return
    setSyncingToday(true)
    setSyncTodayMessage(null)
    setActionError(null)
    try {
      const created = await ensureTodayKpiTaskInstances(factoryId)
      setSyncTodayMessage(
        created > 0 ? `Đã sinh ${created} việc định kỳ mới cho hôm nay.` : "Không có việc mới nào cần sinh — mọi việc định kỳ hôm nay đã được tạo.",
      )
      await loadData(factoryId, user.id)
    } catch (err) {
      setActionError(getKpiErrorMessage(err, "Không sinh được việc hôm nay."))
    } finally {
      setSyncingToday(false)
      setTimeout(() => setSyncTodayMessage(null), 5000)
    }
  }

  // Sau khi thêm/sửa template hoặc đăng ký người thay thế, chủ động sinh lại việc hôm nay ngay
  // trong phiên hiện tại (authenticated) — không chờ 1 tab MỚI mở app mới kích hoạt. Đây là
  // hành động phụ trợ, lỗi không chặn việc đóng modal / tải lại danh sách.
  const syncTodaySilently = async (fid: string) => {
    try {
      await ensureTodayKpiTaskInstances(fid)
    } catch {
      // im lặng — nút "Sinh việc hôm nay ngay" vẫn còn đó cho người dùng chủ động thử lại
    }
  }

  return (
    <KpiShell>
      <div className="space-y-4">
        <div ref={revealRef} className="scroll-reveal flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="hover-lift shrink-0 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-200 via-emerald-100 to-teal-100 shadow-sm">
              <Repeat size={20} className="text-teal-700" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800">Việc định kỳ</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Công việc lặp lại mỗi ngày theo nhóm, tự sinh khi có ai mở app — và đăng ký người
                thay thế tạm thời khi về tua/nghỉ phép.
              </p>
            </div>
          </div>
          {canManageTemplates && (
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <button
                onClick={() => void handleSyncToday()}
                disabled={syncingToday || !factoryId}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white shadow-md hover:bg-teal-700 disabled:opacity-60 sm:w-auto"
              >
                <RefreshCw size={15} className={syncingToday ? "animate-spin" : undefined} />
                {syncingToday ? "Đang sinh việc..." : "Sinh việc hôm nay ngay"}
              </button>
              {syncTodayMessage && <span className="text-xs font-semibold text-teal-700 text-right max-w-xs">{syncTodayMessage}</span>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1 bg-white rounded-xl border border-slate-200 p-1 w-fit">
          <button
            onClick={() => setSubTab("templates")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold ${subTab === "templates" ? "bg-violet-600 text-white" : "text-slate-600"}`}
          >
            <CalendarClock size={14} /> Việc định kỳ
          </button>
          <button
            onClick={() => setSubTab("substitutions")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold ${subTab === "substitutions" ? "bg-violet-600 text-white" : "text-slate-600"}`}
          >
            <UserCog size={14} /> Người thay thế tạm thời
          </button>
        </div>

        {actionError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2 text-sm font-semibold text-red-600">{actionError}</div>}

        {pendingSubs.length > 0 && (
          <PendingSubstitutionsBanner
            items={pendingSubs}
            resolveName={resolveName}
            onChanged={() => { if (factoryId && user) { void loadData(factoryId, user.id); void loadPendingSubs(factoryId, user.id) } }}
          />
        )}

        {dataLoading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : dataError ? (
          <div className="bg-white rounded-2xl border border-red-200 p-8 text-center text-red-600">{dataError}</div>
        ) : subTab === "templates" ? (
          <div className="space-y-3">
            {canManageTemplates && (
              <button
                onClick={() => { setEditingTemplate(null); setShowTemplateForm(true) }}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md text-sm"
              >
                <Plus size={15} /> Thêm việc định kỳ
              </button>
            )}
            {templates.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
                Chưa có việc định kỳ nào.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {templates.map((t) => (
                  <div key={t.id} className={`hover-lift bg-white rounded-2xl border shadow-sm p-4 ${t.is_active ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-violet-50 text-violet-700">
                          {groupNameById[t.group_id] || "—"}
                        </span>
                        {t.module_code ? (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-sky-50 text-sky-700">
                            {KPI_MODULE_LABEL[t.module_code] || t.module_code}
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-400">
                            Chưa gắn module
                          </span>
                        )}
                      </div>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${t.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                        {t.is_active ? "Đang áp dụng" : "Tạm ngưng"}
                      </span>
                    </div>
                    <div className="text-sm font-extrabold text-slate-800">{t.tieu_de}</div>
                    {t.mo_ta && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t.mo_ta}</p>}
                    <div className="text-xs text-slate-500 mt-2">
                      Giao cho: <strong className="text-slate-700">{resolveName(t.assigned_user_id)}</strong>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">Hạn mỗi ngày: {t.gio_han.slice(0, 5)}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {KPI_WEEKDAY_OPTIONS.map((d) => (
                        <span
                          key={d}
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.apply_weekdays.includes(d) ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-300"}`}
                        >
                          {KPI_WEEKDAY_LABEL[d]}
                        </span>
                      ))}
                    </div>
                    {t.yeu_cau_bao_cao.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {t.yeu_cau_bao_cao.map((r) => (
                          <span key={r} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">
                            {KPI_REPORT_REQ_LABEL[r]}
                          </span>
                        ))}
                      </div>
                    )}
                    {canManageTemplates && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
                        <button
                          onClick={() => { setEditingTemplate(t); setShowTemplateForm(true) }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-bold"
                        >
                          <Pencil size={11} /> Sửa
                        </button>
                        <button
                          onClick={() => void handleToggleActive(t)}
                          disabled={busyId === t.id}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold disabled:opacity-60"
                        >
                          <Power size={11} /> {t.is_active ? "Tạm ngưng" : "Kích hoạt lại"}
                        </button>
                        <button
                          onClick={() => setDeleteTemplateTarget(t)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold"
                        >
                          <Trash2 size={11} /> Xóa
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={() => setShowSubForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md text-sm"
            >
              <Plus size={15} /> Đăng ký người thay thế
            </button>
            {substitutions.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
                Chưa có đăng ký nào.
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
                {substitutions.map((s) => (
                  <div key={s.id} className="row-hover p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <strong className="text-slate-700">{resolveName(s.original_user_id)}</strong>
                        <span className="text-slate-400"> → thay thế bởi </span>
                        <strong className="text-slate-700">{resolveName(s.substitute_user_id)}</strong>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${KPI_SUBSTITUTION_STATUS_BADGE_CLASS[s.trang_thai]}`}>
                          {KPI_SUBSTITUTION_STATUS_LABEL[s.trang_thai]}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {s.tu_ngay} — {s.den_ngay} ·{" "}
                        {s.template_id ? `Chỉ: ${templateTitleById[s.template_id] || "—"}` : "Tất cả việc định kỳ"}
                      </div>
                      {s.ly_do && <div className="text-xs text-slate-400 mt-0.5 italic">&quot;{s.ly_do}&quot;</div>}
                      {s.trang_thai === "tu_choi" && s.ly_do_tu_choi && (
                        <div className="text-xs text-rose-600 mt-0.5">Lý do từ chối: {s.ly_do_tu_choi}</div>
                      )}
                      <div className="text-[11px] text-slate-300 mt-0.5">Đăng ký lúc {formatKpiDateTime(s.created_at)}</div>
                    </div>
                    {canManageSub(s) && (
                      <button
                        onClick={() => setDeleteSubTarget(s)}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold"
                      >
                        <Trash2 size={11} /> Hủy đăng ký
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showTemplateForm && factoryId && user && (
        <TemplateFormModal
          factoryId={factoryId}
          createdBy={user.id}
          groups={groups}
          candidates={candidates}
          departments={departments}
          editing={editingTemplate}
          onClose={() => setShowTemplateForm(false)}
          onSaved={() => {
            setShowTemplateForm(false)
            if (factoryId && user) void syncTodaySilently(factoryId).then(() => loadData(factoryId, user.id))
          }}
        />
      )}

      {showSubForm && factoryId && user && (
        <SubstitutionFormModal
          factoryId={factoryId}
          createdBy={user.id}
          candidates={candidates}
          templates={templates}
          canChooseOriginal={canChooseOriginal}
          defaultOriginalUserId={user.id}
          onClose={() => setShowSubForm(false)}
          onSaved={() => {
            setShowSubForm(false)
            if (factoryId && user) void syncTodaySilently(factoryId).then(() => loadData(factoryId, user.id))
          }}
        />
      )}

      {deleteTemplateTarget && (
        <ModalShell
          title="Xóa việc định kỳ"
          onClose={() => setDeleteTemplateTarget(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDeleteTemplateTarget(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Không
              </button>
              <button
                onClick={() => void handleDeleteTemplate()}
                disabled={busyId === deleteTemplateTarget.id}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {busyId === deleteTemplateTarget.id ? "Đang xóa..." : "Xác nhận xóa"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xóa <strong>&quot;{deleteTemplateTarget.tieu_de}&quot;</strong> — các công việc đã sinh
            ra trước đó vẫn giữ nguyên (không bị xóa), chỉ ngừng sinh thêm từ ngày mai. Bạn có
            chắc chắn?
          </p>
        </ModalShell>
      )}

      {deleteSubTarget && (
        <ModalShell
          title="Hủy đăng ký người thay thế"
          onClose={() => setDeleteSubTarget(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDeleteSubTarget(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Không
              </button>
              <button
                onClick={() => void handleDeleteSub()}
                disabled={busyId === deleteSubTarget.id}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
              >
                {busyId === deleteSubTarget.id ? "Đang hủy..." : "Xác nhận hủy"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Hủy đăng ký thay thế cho <strong>{resolveName(deleteSubTarget.original_user_id)}</strong>{" "}
            — từ giờ việc định kỳ sẽ lại sinh đúng cho người gốc. Bạn có chắc chắn?
          </p>
        </ModalShell>
      )}
    </KpiShell>
  )
}
