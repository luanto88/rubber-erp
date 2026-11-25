"use client"

// Tab "Sổ phép" (GĐ C4, 2026-11-25): sổ phép thưởng + chuỗi 3 tháng của nhân viên quốc tịch Việt Nam.
// Quy tắc: migration 20261215 + src/lib/attendance/leave.ts. Xem theo quyền Lịch công; chỉ admin cộng / trừ tay.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Award, CalendarCheck, CircleAlert, RefreshCw, SlidersHorizontal, Users } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { getErrorMessage } from "@/lib/error-message"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { matchesSearchQuery } from "@/lib/text-normalize"
import {
  LEAVE_LEDGER_LABEL,
  LEAVE_MIGRATION_HINT,
  LEAVE_MONTH_FLAG_LABEL,
  balanceOf,
  chainProgress,
  formatChainKey,
  leaveMissing,
  type LeaveLedgerRow,
  type LeaveMonthFlag,
} from "@/lib/attendance/leave"
import { FilterBar } from "../../_components/filter-bar"
import { ModalShell } from "../../_components/modal-shell"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { StatCard, StatGrid } from "../../_components/doc-ui/stat-card"
import { ListState } from "../../_components/doc-ui/list-state"
import { StatusBadge } from "../../_components/doc-ui/status-badge"
import { ExpandAllToggle, ExpandHeaderCell, ExpandableRow } from "../../_components/doc-ui/expandable-row"

type StaffRow = {
  id: string
  ten: string
  profile_id: string | null
  loai_nhan_su: string | null
  quoc_tich?: string | null
  department_id: string | null
  phong_ban: string | null
  active: boolean
}
type Dept = { id: string; name: string }
type FlagRow = { staff_id: string; thang: number; tinh_trang: LeaveMonthFlag }
type UsedRow = { id: string; staff_id: string; ngay: string; ly_do: string | null }

const fieldCls = "h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-mod-600"

const FLAG_CLS: Record<LeaveMonthFlag, string> = {
  du: "bg-emerald-500 text-white",
  thieu: "bg-rose-100 text-rose-600",
  khong_tron: "bg-amber-100 text-amber-700",
  chua_het: "bg-slate-100 text-slate-300",
}

const LEDGER_TONE = { tich_luy: "valid", thu_hoi: "danger", dieu_chinh: "info" } as const

function fmtDay(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

function fmtDateTime(ts: string) {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts))
  } catch {
    return ts
  }
}

/** Ngày đầu tháng trước (theo ngày hôm nay của nhà máy) — đồng bộ Có mặt tự động khoảng ≤ 62 ngày. */
function prevMonthStart(today: string) {
  const [y, m] = today.split("-").map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return `${py}-${String(pm).padStart(2, "0")}-01`
}

export function BonusLeaveBook({ factoryId, user }: { factoryId: string; user: SessionUser | null }) {
  const today = getFactoryTodayISO()
  const [nam, setNam] = useState(Number(today.slice(0, 4)))
  const [deptFilter, setDeptFilter] = useState("")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [recomputing, setRecomputing] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  const [staff, setStaff] = useState<StaffRow[]>([])
  const [depts, setDepts] = useState<Dept[]>([])
  const [flags, setFlags] = useState<FlagRow[]>([])
  const [ledger, setLedger] = useState<LeaveLedgerRow[]>([])
  const [used, setUsed] = useState<UsedRow[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [adjustFor, setAdjustFor] = useState<StaffRow | null>(null)
  const [adjustDays, setAdjustDays] = useState("1")
  const [adjustReason, setAdjustReason] = useState("")
  const [adjustBusy, setAdjustBusy] = useState(false)
  const [adjustError, setAdjustError] = useState<string | null>(null)

  const isAdmin = user?.role === "admin"
  const canViewAll = isAdmin || hasPermission(user, "attendance.mark_all") || hasPermission(user, "attendance.approve")

  const load = useCallback(
    async (alive: () => boolean) => {
      setLoading(true)
      setError(null)
      try {
        const { error: rcErr } = await supabase.rpc("attendance_leave_recompute", { p_factory_id: factoryId, p_nam: nam })
        if (rcErr) throw rcErr
        const [staffRes, deptRes, flagRes, ledgerRes] = await Promise.all([
          supabase.from("maintenance_staff").select("*").eq("factory_id", factoryId).order("ten"),
          supabase.from("departments").select("id, name").eq("is_active", true).order("sort_order"),
          supabase.rpc("attendance_leave_month_flags", { p_factory_id: factoryId, p_nam: nam }),
          supabase.from("attendance_leave_ledger").select("*").eq("factory_id", factoryId).eq("nam", nam).order("created_at"),
        ])
        if (staffRes.error) throw staffRes.error
        if (flagRes.error) throw flagRes.error
        if (ledgerRes.error) throw ledgerRes.error
        const usedRows = await fetchAllPaginated<UsedRow>((a, b) =>
          supabase
            .from("attendance_records")
            .select("id, staff_id, ngay, ly_do")
            .eq("factory_id", factoryId)
            .eq("dung_phep_thuong", true)
            .gte("ngay", `${nam}-01-01`)
            .lte("ngay", `${nam}-12-31`)
            .order("ngay")
            .order("id")
            .range(a, b),
        )
        if (!alive()) return
        setStaff((staffRes.data || []) as StaffRow[])
        setDepts((deptRes.data || []) as Dept[])
        setFlags((flagRes.data || []) as FlagRow[])
        setLedger((ledgerRes.data || []) as LeaveLedgerRow[])
        setUsed(usedRows)
      } catch (e) {
        if (!alive()) return
        const msg = getErrorMessage(e, "Không tải được sổ phép thưởng.")
        setError(leaveMissing(msg) ? LEAVE_MIGRATION_HINT : msg)
      } finally {
        if (alive()) setLoading(false)
      }
    },
    [factoryId, nam],
  )

  useEffect(() => {
    let alive = true
    void load(() => alive)
    return () => {
      alive = false
    }
  }, [load, reloadKey])

  /** Đồng bộ Có mặt tự động (đầu tháng trước → hôm nay) rồi xét lại chuỗi. */
  const recomputeNow = async () => {
    setRecomputing(true)
    setInfo(null)
    try {
      const from = prevMonthStart(today)
      const { error: syncErr } = await supabase.rpc("attendance_sync_auto", { p_factory_id: factoryId, p_from: from, p_to: today })
      if (syncErr) throw syncErr
      const { data, error: rcErr } = await supabase.rpc("attendance_leave_recompute", { p_factory_id: factoryId, p_nam: nam })
      if (rcErr) throw rcErr
      const n = Number(data) || 0
      setInfo(n ? `Đã xét lại chuỗi: ${n} thay đổi trong sổ.` : "Đã xét lại chuỗi — không có thay đổi.")
      setReloadKey((k) => k + 1)
    } catch (e) {
      const msg = getErrorMessage(e, "Không xét lại được chuỗi.")
      setInfo(leaveMissing(msg) ? LEAVE_MIGRATION_HINT : msg)
    } finally {
      setRecomputing(false)
    }
  }

  const deptName = useMemo(() => new Map(depts.map((d) => [d.id, d.name])), [depts])
  const flagsByStaff = useMemo(() => {
    const map = new Map<string, Map<number, LeaveMonthFlag>>()
    for (const f of flags) {
      if (!map.has(f.staff_id)) map.set(f.staff_id, new Map())
      map.get(f.staff_id)!.set(f.thang, f.tinh_trang)
    }
    return map
  }, [flags])
  const ledgerByStaff = useMemo(() => {
    const map = new Map<string, LeaveLedgerRow[]>()
    for (const l of ledger) map.set(l.staff_id, [...(map.get(l.staff_id) || []), l])
    return map
  }, [ledger])
  const usedByStaff = useMemo(() => {
    const map = new Map<string, UsedRow[]>()
    for (const u of used) map.set(u.staff_id, [...(map.get(u.staff_id) || []), u])
    return map
  }, [used])
  const nameByProfile = useMemo(() => new Map(staff.filter((s) => s.profile_id).map((s) => [s.profile_id as string, s.ten])), [staff])

  // Người trong sổ = người có cờ tháng (đủ điều kiện + xem được, RPC đã lọc) ∪ người đã có dòng sổ năm này.
  const rows = useMemo(() => {
    const ids = new Set<string>([...flagsByStaff.keys(), ...ledgerByStaff.keys()])
    return staff
      .filter((s) => ids.has(s.id))
      .filter((s) => !deptFilter || s.department_id === deptFilter)
      .filter((s) => !search.trim() || matchesSearchQuery(search, [s.ten, s.phong_ban]))
      .map((s) => {
        const f = flagsByStaff.get(s.id) || new Map<number, LeaveMonthFlag>()
        return {
          staff: s,
          flags: f,
          chain: chainProgress(f),
          bal: balanceOf(ledgerByStaff.get(s.id) || [], (usedByStaff.get(s.id) || []).length),
          eligibleNow: flagsByStaff.has(s.id),
        }
      })
      .sort((a, b) => {
        const da = (a.staff.department_id && deptName.get(a.staff.department_id)) || a.staff.phong_ban || "~"
        const db = (b.staff.department_id && deptName.get(b.staff.department_id)) || b.staff.phong_ban || "~"
        return da !== db ? da.localeCompare(db, "vi") : a.staff.ten.localeCompare(b.staff.ten, "vi")
      })
  }, [staff, flagsByStaff, ledgerByStaff, usedByStaff, deptFilter, search, deptName])

  const totals = useMemo(() => {
    let dat = 0
    let daDung = 0
    let am = 0
    for (const r of rows) {
      dat += r.bal.tichLuy + r.bal.thuHoi
      daDung += r.bal.daDung
      if (r.bal.soDu < 0) am++
    }
    return { dat, daDung, am }
  }, [rows])

  const missingNationality = useMemo(
    () => (canViewAll ? staff.filter((s) => s.active && (s.loai_nhan_su || "nhan_vien") === "nhan_vien" && !s.quoc_tich).length : 0),
    [staff, canViewAll],
  )

  const yearOptions = useMemo(() => {
    const cur = Number(today.slice(0, 4))
    return [cur + 1, cur, cur - 1, cur - 2]
  }, [today])

  const activeCount = [deptFilter, search.trim(), nam !== Number(today.slice(0, 4)) ? "1" : ""].filter(Boolean).length
  const allExpanded = rows.length > 0 && rows.every((r) => expanded.has(r.staff.id))

  const openAdjust = (s: StaffRow) => {
    setAdjustFor(s)
    setAdjustDays("1")
    setAdjustReason("")
    setAdjustError(null)
  }

  const submitAdjust = async () => {
    if (!adjustFor) return
    const n = Number(adjustDays)
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 60) {
      setAdjustError("Số ngày phải là số nguyên khác 0 (âm = trừ), tối đa 60.")
      return
    }
    if (!adjustReason.trim()) {
      setAdjustError("Bắt buộc nhập lý do.")
      return
    }
    setAdjustBusy(true)
    setAdjustError(null)
    try {
      const { error: err } = await supabase.rpc("attendance_leave_adjust", {
        p_factory_id: factoryId,
        p_staff_id: adjustFor.id,
        p_nam: nam,
        p_so_ngay: n,
        p_ly_do: adjustReason.trim(),
      })
      if (err) throw err
      setAdjustFor(null)
      setInfo(`Đã ${n > 0 ? "cộng" : "trừ"} ${Math.abs(n)} ngày phép cho ${adjustFor.ten}.`)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setAdjustError(getErrorMessage(e, "Không điều chỉnh được sổ phép."))
    } finally {
      setAdjustBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <FilterBar layout="grid" activeCount={activeCount}>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-bold text-slate-600">Tìm tên</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="VD: Ry Ta" className={fieldCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Năm</span>
          <select value={nam} onChange={(e) => setNam(Number(e.target.value))} className={fieldCls}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Phòng ban</span>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className={fieldCls}>
            <option value="">Tất cả</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => void recomputeNow()}
            disabled={recomputing || loading}
            title="Gom lại thao tác app tháng trước – nay rồi xét lại chuỗi 3 tháng"
            className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={recomputing ? "animate-spin" : ""} /> Xét lại chuỗi
          </button>
        </div>
      </FilterBar>

      <StatGrid cols={4}>
        <StatCard icon={Users} label="Nhân viên trong sổ" value={rows.length} sub={`Năm ${nam} · quốc tịch Việt Nam`} loading={loading} />
        <StatCard icon={Award} label="Phép đã đạt" value={totals.dat} sub="sau thu hồi" loading={loading} valueTone="good" />
        <StatCard icon={CalendarCheck} label="Đã dùng" value={totals.daDung} sub="ngày nghỉ có phép được bù" loading={loading} />
        <StatCard
          icon={CircleAlert}
          label="Số dư âm"
          value={totals.am}
          sub="đã dùng phép rồi bị thu hồi"
          loading={loading}
          valueTone={totals.am > 0 ? "danger" : "default"}
        />
      </StatGrid>

      <div className="space-y-1 text-xs text-slate-500">
        <p>
          Tháng đủ = có mặt <b>mọi ngày lịch</b> (nghỉ tua, nghỉ phép, ô trống, vào làm / nghỉ việc giữa tháng đều làm đứt chuỗi). Đủ 3 tháng
          liên tiếp trong năm ⇒ +1 ngày phép, chỉ dùng trong năm {nam} (hết hạn 31/12/{nam}). Sửa ngày công làm tháng hết đủ ⇒ tự thu hồi.
        </p>
        {missingNationality > 0 ? (
          <p className="text-amber-700">
            {missingNationality} nhân viên chưa khai quốc tịch nên chưa được xét — khai ở Cài đặt → Nhân sự (lọc &quot;Chưa khai quốc tịch&quot;).
          </p>
        ) : null}
        {info ? <p className="font-semibold text-slate-600">{info}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {(Object.keys(LEAVE_MONTH_FLAG_LABEL) as LeaveMonthFlag[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={`inline-block h-3.5 w-3.5 rounded ${FLAG_CLS[k]}`} />
            {LEAVE_MONTH_FLAG_LABEL[k]}
          </span>
        ))}
        <div className="ml-auto">
          <ExpandAllToggle
            allExpanded={allExpanded}
            onExpandAll={() => setExpanded(new Set(rows.map((r) => r.staff.id)))}
            onCollapseAll={() => setExpanded(new Set())}
            disabled={rows.length === 0}
          />
        </div>
      </div>

      {loading ? (
        <ListState kind="loading" />
      ) : error ? (
        <ListState kind="error" message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : rows.length === 0 ? (
        <ListState kind="empty" message="Chưa có nhân viên quốc tịch Việt Nam phù hợp bộ lọc." />
      ) : (
        <ResponsiveTableWrapper>
          <table className="enterprise-table dense min-w-[1100px]">
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Tháng 1 → 12</th>
                <th>Chuỗi hiện tại</th>
                <th className="text-right">Đạt</th>
                <th className="text-right">Thu hồi</th>
                <th className="text-right">Điều chỉnh</th>
                <th className="text-right">Đã dùng</th>
                <th className="text-right">Số dư</th>
                <ExpandHeaderCell>Thao tác</ExpandHeaderCell>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = r.staff
                const hist = ledgerByStaff.get(s.id) || []
                const usedDays = usedByStaff.get(s.id) || []
                const isOpen = expanded.has(s.id)
                return (
                  <ExpandableRow
                    key={s.id}
                    expanded={isOpen}
                    onToggle={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev)
                        if (next.has(s.id)) next.delete(s.id)
                        else next.add(s.id)
                        return next
                      })
                    }
                    canExpand={hist.length > 0 || usedDays.length > 0}
                    colSpan={9}
                    endCell={
                      isAdmin && r.eligibleNow ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openAdjust(s)
                          }}
                          title="Cộng / trừ phép tay (lý do bắt buộc)"
                          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
                        >
                          <SlidersHorizontal size={14} /> Điều chỉnh
                        </button>
                      ) : null
                    }
                    detail={
                      <div className="space-y-3">
                        {hist.length > 0 ? (
                          <table className="enterprise-table dense min-w-[760px]">
                            <thead>
                              <tr>
                                <th>Lúc</th>
                                <th>Loại</th>
                                <th className="text-right">Số ngày</th>
                                <th>Chuỗi</th>
                                <th>Hiệu lực từ</th>
                                <th>Lý do</th>
                                <th>Người ghi</th>
                              </tr>
                            </thead>
                            <tbody>
                              {hist.map((l) => (
                                <tr key={l.id}>
                                  <td className="whitespace-nowrap text-slate-500">{fmtDateTime(l.created_at)}</td>
                                  <td>
                                    <StatusBadge tone={LEDGER_TONE[l.loai]} label={LEAVE_LEDGER_LABEL[l.loai]} />
                                  </td>
                                  <td className={`text-right font-bold ${l.so_ngay < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                                    {l.so_ngay > 0 ? `+${l.so_ngay}` : l.so_ngay}
                                  </td>
                                  <td>{formatChainKey(l.chuoi_key) || "—"}</td>
                                  <td className="whitespace-nowrap">{fmtDay(l.hieu_luc_tu)}</td>
                                  <td className="max-w-[300px] text-slate-600">{l.ly_do || "—"}</td>
                                  <td className="text-slate-600">{(l.created_by && nameByProfile.get(l.created_by)) || "Hệ thống"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : null}
                        {usedDays.length > 0 ? (
                          <div className="text-sm text-slate-600">
                            <b>Ngày đã dùng phép:</b>{" "}
                            {usedDays.map((u) => fmtDay(u.ngay) + (u.ly_do ? ` (${u.ly_do})` : "")).join(" · ")}
                          </div>
                        ) : null}
                      </div>
                    }
                  >
                    <td>
                      <div className="font-semibold text-slate-700">{s.ten}</div>
                      <div className="text-[11px] text-slate-400">
                        {(s.department_id && deptName.get(s.department_id)) || s.phong_ban || "Chưa có phòng ban"}
                        {!r.eligibleNow ? " · không còn đủ điều kiện" : ""}
                      </div>
                    </td>
                    <td>
                      <div className="flex gap-0.5">
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                          const f = r.flags.get(m) || "chua_het"
                          return (
                            <span
                              key={m}
                              title={`Tháng ${m}/${nam}: ${LEAVE_MONTH_FLAG_LABEL[f]}`}
                              className={`inline-flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold ${FLAG_CLS[f]}`}
                            >
                              {m}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {r.eligibleNow ? (
                        <>
                          <b>{r.chain.count}/3</b>
                          {r.chain.months.length ? <span className="text-slate-500"> (T{r.chain.months.join(", T")})</span> : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-right font-bold text-emerald-700">{r.bal.tichLuy || ""}</td>
                    <td className="text-right text-rose-600">{r.bal.thuHoi || ""}</td>
                    <td className="text-right text-sky-700">{r.bal.dieuChinh ? (r.bal.dieuChinh > 0 ? `+${r.bal.dieuChinh}` : r.bal.dieuChinh) : ""}</td>
                    <td className="text-right">{r.bal.daDung || ""}</td>
                    <td className={`text-right text-base font-extrabold ${r.bal.soDu < 0 ? "text-rose-600" : r.bal.soDu > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                      {r.bal.soDu}
                      {r.bal.soDu < 0 ? <div className="text-[10px] font-semibold">âm — đã dùng phép bị thu hồi</div> : null}
                    </td>
                  </ExpandableRow>
                )
              })}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      {adjustFor ? (
        <ModalShell
          title={`Điều chỉnh sổ phép — ${adjustFor.ten}`}
          onClose={() => !adjustBusy && setAdjustFor(null)}
          maxWidth="md"
          footer={
            <>
              <button type="button" disabled={adjustBusy} onClick={() => setAdjustFor(null)} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
                Huỷ
              </button>
              <button
                type="button"
                disabled={adjustBusy}
                onClick={() => void submitAdjust()}
                className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {adjustBusy ? "Đang lưu..." : "Lưu điều chỉnh"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {adjustError ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{adjustError}</div> : null}
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Số ngày (âm = trừ) — năm {nam}</span>
              <input
                inputMode="numeric"
                value={adjustDays}
                onChange={(e) => setAdjustDays(e.target.value.replace(/[^\d-]/g, ""))}
                className={fieldCls}
                placeholder="VD: 1 hoặc -1"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Lý do *</span>
              <textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                rows={3}
                placeholder="VD: Thưởng phép đặc biệt theo quyết định của giám đốc"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mod-600"
              />
            </label>
            <p className="text-xs text-slate-500">Điều chỉnh có hiệu lực cả năm {nam}, ghi vào sổ (không sửa / xoá được).</p>
          </div>
        </ModalShell>
      ) : null}
    </div>
  )
}
