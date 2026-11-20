"use client"

// Lịch công tháng (GĐ C1, 2026-11-20): lưới nhân sự × ngày, chấm tay nhiều ô (lý do bắt buộc) qua RPC
// attendance_set_days / attendance_clear_days, nhật ký điều chỉnh bất biến. Quyền: rule 31.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, History, UserCheck, Users, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { getErrorMessage } from "@/lib/error-message"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { matchesSearchQuery } from "@/lib/text-normalize"
import { ATTENDANCE_CA, ATTENDANCE_DAY_CHUYEN } from "@/lib/attendance/types"
import {
  ATTENDANCE_SOURCE_LABEL,
  ATTENDANCE_STATUS_LABEL,
  DEFAULT_TUA_DAYS,
  isInWorkRange,
  isPartialMonth,
  monthDays,
  monthRange,
  shiftMonth,
  standardDays,
  summarizeStaffMonth,
  weekdayOf,
  worksInMonth,
  type AttendanceLog,
  type AttendanceRecord,
  type AttendanceStatus,
} from "@/lib/attendance/calendar"
import { FilterBar } from "../../_components/filter-bar"
import { ModalShell } from "../../_components/modal-shell"
import { StatCard, StatGrid } from "../../_components/doc-ui/stat-card"
import { ListState } from "../../_components/doc-ui/list-state"
import { StatusBadge } from "../../_components/doc-ui/status-badge"

type StaffRow = {
  id: string
  ten: string
  profile_id: string | null
  loai_nhan_su: string | null
  ma_nhan_su: string | null
  ca_mac_dinh: string | null
  day_chuyen_mac_dinh: string | null
  department_id: string | null
  phong_ban: string | null
  active: boolean
  ngay_vao_lam: string | null
  ngay_nghi_viec: string | null
  thu_tu_diem_danh: number | null
}

type Dept = { id: string; code: string; name: string }

const fieldCls = "h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-mod-600"

/** Cột ngày xen kẽ (ngày cách ngày): nền + đường kẻ dọc đậm/nhạt lệch nhẹ để dễ dò theo cột. */
const dayColCls = (index: number, withBg = true) =>
  index % 2 === 0 ? `${withBg ? "bg-slate-50/80 " : ""}border-x border-slate-200` : "border-x border-slate-100"
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]
const STATUS_ORDER: AttendanceStatus[] = ["co_mat", "nghi_tua", "nghi_co_phep", "nghi_khong_phep"]

const cellKey = (staffId: string, day: string) => `${staffId}|${day}`

function cellClass(r: AttendanceRecord | undefined): string {
  if (!r) return "bg-white text-slate-300"
  if (r.trang_thai === "co_mat") return r.nguon === "bo_sung_tay" ? "bg-violet-100 text-violet-800" : "bg-emerald-100 text-emerald-800"
  if (r.trang_thai === "nghi_tua") return "bg-sky-100 text-sky-800"
  if (r.trang_thai === "nghi_co_phep") return "bg-amber-100 text-amber-800"
  return "bg-rose-100 text-rose-700"
}

function cellText(r: AttendanceRecord | undefined): string {
  if (!r) return "·"
  if (r.trang_thai === "co_mat") return r.xep_loai === "B" ? "B" : "+"
  if (r.trang_thai === "nghi_tua") return "T"
  if (r.trang_thai === "nghi_co_phep") return "P"
  return "K"
}

function fmtDay(iso: string) {
  const [y, m, d] = iso.split("-")
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

function tableMissing(message: string) {
  return /attendance_(records|logs)|attendance_set_days|attendance_clear_days/.test(message) &&
    /does not exist|schema cache|Could not find/i.test(message)
    ? "Chưa có bảng ngày công — chạy migration 20261202_attendance_c1_records.sql."
    : message
}

export function AttendanceCalendar({ factoryId, user }: { factoryId: string; user: SessionUser | null }) {
  const today = getFactoryTodayISO()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [deptFilter, setDeptFilter] = useState("")
  const [loaiFilter, setLoaiFilter] = useState("")
  const [caFilter, setCaFilter] = useState("")
  const [dcFilter, setDcFilter] = useState("")
  const [search, setSearch] = useState("")

  const [staff, setStaff] = useState<StaffRow[]>([])
  const [depts, setDepts] = useState<Dept[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [markOpen, setMarkOpen] = useState(false)
  const [markStatus, setMarkStatus] = useState<AttendanceStatus>("co_mat")
  const [markXep, setMarkXep] = useState<"A" | "B">("A")
  const [markReason, setMarkReason] = useState("")
  // Chấm "Có mặt" xếp loại A không bắt buộc lý do (khớp RPC attendance_set_days, migration 20261203).
  const reasonOptional = markStatus === "co_mat" && markXep === "A"
  const [markError, setMarkError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [logStaffId, setLogStaffId] = useState<string | null>(null)
  const [logs, setLogs] = useState<AttendanceLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)

  // ── Quyền ──
  const isAdmin = user?.role === "admin"
  const canViewAll = isAdmin || hasPermission(user, "attendance.mark_all") || hasPermission(user, "attendance.approve")
  const canMarkAll = isAdmin || hasPermission(user, "attendance.mark_all")
  const canMarkDept = hasPermission(user, "attendance.mark")
  const myDeptId = useMemo(() => {
    const mine = staff.find((s) => s.profile_id && s.profile_id === user?.id)
    if (mine?.department_id) return mine.department_id
    return depts.find((d) => d.name === user?.department)?.id || null
  }, [staff, depts, user])
  const canMarkStaff = useCallback(
    (s: StaffRow) => canMarkAll || (canMarkDept && !!s.department_id && s.department_id === myDeptId),
    [canMarkAll, canMarkDept, myDeptId],
  )
  const canViewStaff = useCallback(
    (s: StaffRow) => canViewAll || (!!s.profile_id && s.profile_id === user?.id) || canMarkStaff(s),
    [canViewAll, canMarkStaff, user],
  )
  const canMarkAny = canMarkAll || canMarkDept

  // ── Tải dữ liệu ──
  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const { from, to } = monthRange(month)
        const [staffRes, deptRes] = await Promise.all([
          supabase
            .from("maintenance_staff")
            .select(
              "id, ten, profile_id, loai_nhan_su, ma_nhan_su, ca_mac_dinh, day_chuyen_mac_dinh, department_id, phong_ban, active, ngay_vao_lam, ngay_nghi_viec, thu_tu_diem_danh",
            )
            .eq("factory_id", factoryId)
            .order("ten"),
          supabase.from("departments").select("id, code, name").eq("is_active", true).order("sort_order"),
        ])
        if (staffRes.error) throw staffRes.error
        const recs = await fetchAllPaginated<AttendanceRecord>((a, b) =>
          supabase
            .from("attendance_records")
            .select("id, staff_id, ngay, trang_thai, nguon, xep_loai, ly_do, dung_phep_thuong, updated_by, updated_at")
            .eq("factory_id", factoryId)
            .gte("ngay", from)
            .lte("ngay", to)
            .order("ngay")
            .order("id")
            .range(a, b),
        )
        if (!alive) return
        setStaff((staffRes.data || []) as StaffRow[])
        setDepts((deptRes.data || []) as Dept[])
        setRecords(recs)
      } catch (e) {
        if (alive) setError(tableMissing(getErrorMessage(e, "Không tải được dữ liệu chấm công.")))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [factoryId, month, reloadKey])

  useEffect(() => {
    setSelected(new Set())
    setAnchor(null)
  }, [month])

  const recordsByStaff = useMemo(() => {
    const map = new Map<string, Map<string, AttendanceRecord>>()
    for (const r of records) {
      if (!map.has(r.staff_id)) map.set(r.staff_id, new Map())
      map.get(r.staff_id)!.set(r.ngay, r)
    }
    return map
  }, [records])

  const days = useMemo(() => monthDays(month), [month])
  const stdDays = standardDays(month, DEFAULT_TUA_DAYS)
  const deptName = useMemo(() => new Map(depts.map((d) => [d.id, d.name])), [depts])
  const nameByProfile = useMemo(() => new Map(staff.filter((s) => s.profile_id).map((s) => [s.profile_id as string, s.ten])), [staff])

  const visibleStaff = useMemo(() => {
    const rows = staff.filter((s) => {
      if (!canViewStaff(s)) return false
      if (!worksInMonth(s, month)) return false
      if (!s.active && !recordsByStaff.has(s.id)) return false
      if (deptFilter && s.department_id !== deptFilter) return false
      if (loaiFilter && (s.loai_nhan_su || "nhan_vien") !== loaiFilter) return false
      if (caFilter && s.ca_mac_dinh !== caFilter) return false
      if (dcFilter && s.day_chuyen_mac_dinh && s.day_chuyen_mac_dinh !== dcFilter) return false
      if (search.trim() && !matchesSearchQuery(search, [s.ten, s.ma_nhan_su, s.phong_ban])) return false
      return true
    })
    return rows.sort((a, b) => {
      const da = (a.department_id && deptName.get(a.department_id)) || a.phong_ban || "~"
      const db = (b.department_id && deptName.get(b.department_id)) || b.phong_ban || "~"
      if (da !== db) return da.localeCompare(db, "vi")
      const la = a.loai_nhan_su === "cong_nhan" ? 1 : 0
      const lb = b.loai_nhan_su === "cong_nhan" ? 1 : 0
      if (la !== lb) return la - lb
      const ca = a.ca_mac_dinh || "Z"
      const cb = b.ca_mac_dinh || "Z"
      if (ca !== cb) return ca.localeCompare(cb)
      const ta = a.thu_tu_diem_danh ?? 9999
      const tb = b.thu_tu_diem_danh ?? 9999
      if (ta !== tb) return ta - tb
      return a.ten.localeCompare(b.ten, "vi")
    })
  }, [staff, canViewStaff, month, recordsByStaff, deptFilter, loaiFilter, caFilter, dcFilter, search, deptName])

  const summaries = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summarizeStaffMonth>>()
    for (const s of visibleStaff) map.set(s.id, summarizeStaffMonth(s, month, recordsByStaff.get(s.id) || new Map(), today))
    return map
  }, [visibleStaff, month, recordsByStaff, today])

  const totals = useMemo(() => {
    let coMat = 0
    let khongPhep = 0
    let chua = 0
    for (const v of summaries.values()) {
      coMat += v.coMat
      khongPhep += v.khongPhep
      chua += v.chuaGhiNhan
    }
    return { coMat, khongPhep, chua }
  }, [summaries])

  const activeFilterCount = [deptFilter, loaiFilter, caFilter, dcFilter, search.trim()].filter(Boolean).length

  // ── Chọn ô ──
  const markable = useCallback((s: StaffRow, day: string) => canMarkStaff(s) && isInWorkRange(s, day), [canMarkStaff])

  const onCellClick = (s: StaffRow, day: string, shift: boolean) => {
    if (!markable(s, day)) return
    const key = cellKey(s.id, day)
    setSelected((prev) => {
      const next = new Set(prev)
      if (shift && anchor && anchor.startsWith(`${s.id}|`)) {
        const a = anchor.split("|")[1]
        const [lo, hi] = a < day ? [a, day] : [day, a]
        for (const d of days) if (d >= lo && d <= hi && isInWorkRange(s, d)) next.add(cellKey(s.id, d))
      } else if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setAnchor(key)
  }

  const selectDayColumn = (day: string) => {
    if (!canMarkAny) return
    const keys = visibleStaff.filter((s) => markable(s, day)).map((s) => cellKey(s.id, day))
    if (keys.length === 0) return
    setSelected((prev) => {
      const next = new Set(prev)
      const allIn = keys.every((k) => next.has(k))
      for (const k of keys) {
        if (allIn) next.delete(k)
        else next.add(k)
      }
      return next
    })
  }

  const selectedCells = useMemo(
    () => [...selected].map((k) => {
      const [staffId, day] = k.split("|")
      return { staffId, day }
    }),
    [selected],
  )
  const selectedHasRecord = selectedCells.some((c) => recordsByStaff.get(c.staffId)?.has(c.day))
  const selectedHasFuture = selectedCells.some((c) => c.day > today)
  // Công nhân không có chế độ nghỉ tua (lương theo công thực tế) — DB chặn bằng trigger 20261204.
  const selectedHasWorker = useMemo(() => {
    const workerIds = new Set(staff.filter((s) => s.loai_nhan_su === "cong_nhan").map((s) => s.id))
    return selectedCells.some((c) => workerIds.has(c.staffId))
  }, [staff, selectedCells])

  const openMark = () => {
    setMarkError(null)
    setMarkReason("")
    setMarkXep("A")
    setMarkStatus(selectedHasFuture ? (selectedHasWorker ? "nghi_co_phep" : "nghi_tua") : "co_mat")
    setMarkOpen(true)
  }

  // Gom ô thành nhóm (cùng tập ngày) để gọi RPC ít lần.
  const groupedCells = () => {
    const byStaff = new Map<string, string[]>()
    for (const c of selectedCells) byStaff.set(c.staffId, [...(byStaff.get(c.staffId) || []), c.day])
    const groups = new Map<string, { staffIds: string[]; days: string[] }>()
    for (const [staffId, ds] of byStaff) {
      const sorted = ds.sort()
      const key = sorted.join(",")
      if (!groups.has(key)) groups.set(key, { staffIds: [], days: sorted })
      groups.get(key)!.staffIds.push(staffId)
    }
    return [...groups.values()]
  }

  const submitMark = async (mode: "set" | "clear") => {
    const reason = markReason.trim()
    if (!reason && !(mode === "set" && reasonOptional)) {
      setMarkError(mode === "clear" ? "Xoá chấm bắt buộc nhập lý do." : "Bắt buộc nhập lý do.")
      return
    }
    if (mode === "set" && markStatus === "co_mat" && selectedHasFuture) {
      setMarkError('Không chấm "Có mặt" cho ngày chưa tới — bỏ chọn các ngày sau hôm nay.')
      return
    }
    setSaving(true)
    setMarkError(null)
    try {
      let changed = 0
      for (const g of groupedCells()) {
        const { data, error: err } =
          mode === "set"
            ? await supabase.rpc("attendance_set_days", {
                p_factory_id: factoryId,
                p_staff_ids: g.staffIds,
                p_ngays: g.days,
                p_trang_thai: markStatus,
                p_xep_loai: markStatus === "co_mat" ? markXep : null,
                p_ly_do: reason || null,
              })
            : await supabase.rpc("attendance_clear_days", {
                p_factory_id: factoryId,
                p_staff_ids: g.staffIds,
                p_ngays: g.days,
                p_ly_do: reason,
              })
        if (err) throw err
        changed += Number(data) || 0
      }
      setMarkOpen(false)
      setSelected(new Set())
      setToast(mode === "set" ? `Đã chấm ${changed} ô.` : `Đã xoá ${changed} ô.`)
      setReloadKey((k) => k + 1)
      if (logStaffId) void loadLogs(logStaffId)
    } catch (e) {
      setMarkError(tableMissing(getErrorMessage(e, "Không lưu được chấm công.")))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(t)
  }, [toast])

  // ── Nhật ký ──
  const loadLogs = useCallback(
    async (staffId: string) => {
      setLogsLoading(true)
      setLogsError(null)
      try {
        const { from, to } = monthRange(month)
        const { data, error: err } = await supabase
          .from("attendance_logs")
          .select("id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau, xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id, created_at")
          .eq("factory_id", factoryId)
          .eq("staff_id", staffId)
          .gte("ngay", from)
          .lte("ngay", to)
          .order("created_at", { ascending: false })
          .limit(300)
        if (err) throw err
        setLogs((data || []) as AttendanceLog[])
      } catch (e) {
        setLogsError(tableMissing(getErrorMessage(e, "Không tải được nhật ký.")))
      } finally {
        setLogsLoading(false)
      }
    },
    [factoryId, month],
  )

  useEffect(() => {
    if (logStaffId) void loadLogs(logStaffId)
    else setLogs([])
  }, [logStaffId, loadLogs])

  const logStaff = staff.find((s) => s.id === logStaffId) || null
  const statusText = (st: string | null, xep: string | null) =>
    st ? `${ATTENDANCE_STATUS_LABEL[st as AttendanceStatus] || st}${st === "co_mat" && xep ? ` (${xep})` : ""}` : "Chưa ghi nhận"

  const monthLabel = `Tháng ${month.slice(5, 7)}/${month.slice(0, 4)}`

  return (
    <div className="space-y-4">
      <FilterBar layout="grid" activeCount={activeFilterCount}>
        {/* Lưới riêng: ô Tháng rộng hơn các ô khác 20% (1.2fr), 7 ô vừa 1 hàng trên màn rộng. */}
        <div className="col-span-full grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr] xl:grid-cols-[1.2fr_repeat(6,minmax(0,1fr))]">
        <div className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Tháng</span>
          <div className="flex h-10 items-center gap-1">
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="h-10 rounded-xl border border-slate-300 px-2 text-slate-600 hover:bg-slate-50" aria-label="Tháng trước">
              <ChevronLeft size={16} />
            </button>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={fieldCls} />
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} className="h-10 rounded-xl border border-slate-300 px-2 text-slate-600 hover:bg-slate-50" aria-label="Tháng sau">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Phòng ban</span>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className={fieldCls}>
            <option value="">Tất cả</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Loại nhân sự</span>
          <select value={loaiFilter} onChange={(e) => setLoaiFilter(e.target.value)} className={fieldCls}>
            <option value="">Tất cả</option>
            <option value="nhan_vien">Nhân viên</option>
            <option value="cong_nhan">Công nhân</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Ca</span>
          <select value={caFilter} onChange={(e) => setCaFilter(e.target.value)} className={fieldCls}>
            <option value="">Tất cả</option>
            {ATTENDANCE_CA.map((c) => (
              <option key={c} value={c}>Ca {c}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Dây chuyền</span>
          <select value={dcFilter} onChange={(e) => setDcFilter(e.target.value)} className={fieldCls}>
            <option value="">Tất cả</option>
            {ATTENDANCE_DAY_CHUYEN.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Tìm tên / mã</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="VD: Sok" className={fieldCls} />
        </label>
        <button
          type="button"
          onClick={() => {
            setDeptFilter("")
            setLoaiFilter("")
            setCaFilter("")
            setDcFilter("")
            setSearch("")
          }}
          disabled={activeFilterCount === 0}
          className="h-10 w-full self-end rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"
        >
          Xóa lọc
        </button>
        </div>
      </FilterBar>

      <StatGrid cols={4}>
        <StatCard icon={Users} label="Nhân sự" value={visibleStaff.length} sub={monthLabel} loading={loading} />
        <StatCard icon={UserCheck} label="Ngày có mặt" value={totals.coMat} sub={`Công chuẩn nhân viên ${stdDays} ngày/người (công nhân: theo công thực tế)`} loading={loading} valueTone="good" />
        <StatCard icon={CircleAlert} label="Nghỉ không phép" value={totals.khongPhep} loading={loading} valueTone={totals.khongPhep > 0 ? "danger" : "default"} />
        <StatCard icon={CalendarDays} label="Ô chưa ghi nhận" value={totals.chua} sub="đến hôm nay" loading={loading} valueTone={totals.chua > 0 ? "warn" : "default"} />
      </StatGrid>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
        <span className="font-bold text-slate-600">Chú thích:</span>
        <Legend cls="bg-emerald-100 text-emerald-800" text="+" label="Có mặt (tự động / điểm danh)" />
        <Legend cls="bg-violet-100 text-violet-800" text="+" label="Có mặt (chấm tay)" />
        <Legend cls="bg-emerald-100 text-emerald-800" text="B" label="Có mặt, xếp loại B" />
        <Legend cls="bg-sky-100 text-sky-800" text="T" label="Nghỉ tua" />
        <Legend cls="bg-amber-100 text-amber-800" text="P" label="Nghỉ có phép" />
        <Legend cls="bg-rose-100 text-rose-700" text="K" label="Nghỉ không phép" />
        <Legend cls="bg-white text-slate-300 border border-slate-200" text="·" label="Chưa ghi nhận" />
      </div>

      {canMarkAny ? (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <span className="text-sm text-slate-600">
            {selected.size > 0 ? (
              <>Đã chọn <b>{selected.size}</b> ô</>
            ) : (
              <>Bấm ô để chọn · Shift + bấm chọn dải cùng hàng · bấm tiêu đề ngày chọn cả cột</>
            )}
          </span>
          {selected.size > 0 ? (
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setSelected(new Set())} className="rounded-xl px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
                Bỏ chọn
              </button>
              <button type="button" onClick={openMark} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">
                Chấm công ({selected.size})
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <ListState kind="loading" />
      ) : error ? (
        <ListState kind="error" message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : visibleStaff.length === 0 ? (
        <ListState kind="empty" message="Không có nhân sự phù hợp bộ lọc." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-max border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-10 min-w-[190px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-bold text-slate-600">
                  Nhân sự
                </th>
                {days.map((d, di) => {
                  const wd = weekdayOf(d)
                  return (
                    <th
                      key={d}
                      onClick={() => selectDayColumn(d)}
                      title={canMarkAny ? `Chọn cả cột ngày ${fmtDay(d)}` : fmtDay(d)}
                      className={`w-8 min-w-[2rem] border-b border-slate-200 px-0.5 py-1 text-center font-bold ${dayColCls(di, d !== today)} ${
                        d === today ? "bg-mod-50 text-mod-800" : wd === 0 ? "text-rose-500" : "text-slate-500"
                      } ${canMarkAny ? "cursor-pointer hover:bg-slate-100" : ""}`}
                    >
                      <div>{Number(d.slice(8))}</div>
                      <div className="text-[10px] font-semibold opacity-70">{WEEKDAY[wd]}</div>
                    </th>
                  )
                })}
                {["Có mặt", "T", "P", "K", "Chưa", "Chuẩn"].map((h) => (
                  <th key={h} className="border-b border-l border-slate-200 px-2 py-1 text-right font-bold text-slate-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleStaff.map((s, idx) => {
                const recs = recordsByStaff.get(s.id) || new Map<string, AttendanceRecord>()
                const sum = summaries.get(s.id)!
                const partial = isPartialMonth(s, month)
                const prev = visibleStaff[idx - 1]
                const deptLabel = (s.department_id && deptName.get(s.department_id)) || s.phong_ban || "Chưa có phòng ban"
                const prevDept = prev ? (prev.department_id && deptName.get(prev.department_id)) || prev.phong_ban || "Chưa có phòng ban" : null
                return (
                  <Fragment key={s.id}>
                    {deptLabel !== prevDept ? (
                      <tr>
                        <td colSpan={days.length + 7} className="sticky left-0 bg-slate-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                          {deptLabel}
                        </td>
                      </tr>
                    ) : null}
                    <tr className="hover:bg-slate-50/60">
                      <td className="sticky left-0 z-10 border-r border-b border-slate-100 bg-white px-3 py-1">
                        <button
                          type="button"
                          onClick={() => setLogStaffId((cur) => (cur === s.id ? null : s.id))}
                          className={`text-left text-sm font-semibold hover:underline ${logStaffId === s.id ? "text-mod-700" : "text-slate-700"}`}
                          title="Xem nhật ký điều chỉnh"
                        >
                          {s.ten}
                        </button>
                        <div className="flex flex-wrap gap-1 text-[10px] text-slate-400">
                          {s.loai_nhan_su === "cong_nhan" ? <span>Công nhân</span> : <span>Nhân viên</span>}
                          {s.ca_mac_dinh ? <span>· Ca {s.ca_mac_dinh}</span> : null}
                          {partial ? <span className="font-bold text-amber-600">· Tháng làm không trọn</span> : null}
                        </div>
                      </td>
                      {days.map((d, di) => {
                        const r = recs.get(d)
                        const inRange = isInWorkRange(s, d)
                        const key = cellKey(s.id, d)
                        const isSel = selected.has(key)
                        const canClick = markable(s, d)
                        const title = !inRange
                          ? `${fmtDay(d)}: ngoài thời gian làm việc`
                          : r
                            ? `${fmtDay(d)}: ${ATTENDANCE_STATUS_LABEL[r.trang_thai]}${r.xep_loai ? ` — xếp loại ${r.xep_loai}` : ""}\nNguồn: ${ATTENDANCE_SOURCE_LABEL[r.nguon]}${r.ly_do ? `\nLý do: ${r.ly_do}` : ""}\nCập nhật: ${fmtDateTime(r.updated_at)}`
                            : `${fmtDay(d)}: chưa ghi nhận`
                        return (
                          <td key={d} className={`border-b border-slate-100 p-0.5 text-center ${dayColCls(di)}`}>
                            {inRange ? (
                              <button
                                type="button"
                                title={title}
                                disabled={!canClick}
                                onClick={(e) => onCellClick(s, d, e.shiftKey)}
                                className={`h-7 w-7 rounded-md text-xs font-extrabold ${cellClass(r)} ${d > today && !r ? "opacity-40" : ""} ${
                                  isSel ? "ring-2 ring-mod-600 ring-offset-1" : ""
                                } ${canClick ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
                              >
                                {cellText(r)}
                              </button>
                            ) : (
                              <span title={title} className="block h-7 w-7 rounded-md bg-slate-100 text-[10px] leading-7 text-slate-300">—</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="border-b border-l border-slate-100 px-2 text-right font-bold text-emerald-700">{sum.coMat}</td>
                      <td className="border-b border-slate-100 px-2 text-right text-sky-700">{sum.tua || ""}</td>
                      <td className="border-b border-slate-100 px-2 text-right text-amber-700">{sum.coPhep || ""}</td>
                      <td className="border-b border-slate-100 px-2 text-right font-bold text-rose-600">{sum.khongPhep || ""}</td>
                      <td className="border-b border-slate-100 px-2 text-right text-slate-400">{sum.chuaGhiNhan || ""}</td>
                      <td
                        className="border-b border-slate-100 px-2 text-right text-slate-500"
                        title={s.loai_nhan_su === "cong_nhan" ? "Công nhân hưởng lương theo công thực tế — không có công chuẩn" : undefined}
                      >
                        {partial || s.loai_nhan_su === "cong_nhan" ? "—" : stdDays}
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {logStaff ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <History size={16} className="text-mod-600" />
            <span className="font-bold text-slate-700">Nhật ký điều chỉnh — {logStaff.ten}</span>
            <span className="text-xs text-slate-400">{monthLabel}</span>
            <button type="button" onClick={() => setLogStaffId(null)} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Đóng nhật ký">
              <X size={15} />
            </button>
          </div>
          {logsLoading ? (
            <ListState kind="loading" />
          ) : logsError ? (
            <ListState kind="error" message={logsError} onRetry={() => void loadLogs(logStaff.id)} />
          ) : logs.length === 0 ? (
            <ListState kind="empty" message="Chưa có điều chỉnh nào trong tháng." />
          ) : (
            <div className="overflow-x-auto">
              <table className="enterprise-table dense min-w-[760px]">
                <thead>
                  <tr>
                    <th>Lúc</th>
                    <th>Ngày công</th>
                    <th>Trước</th>
                    <th>Sau</th>
                    <th>Lý do</th>
                    <th>Người thực hiện</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap text-slate-500">{fmtDateTime(l.created_at)}</td>
                      <td className="whitespace-nowrap">{fmtDay(l.ngay)}</td>
                      <td>{l.trang_thai_truoc ? <StatusBadge domain="attendance" status={l.trang_thai_truoc} label={statusText(l.trang_thai_truoc, l.xep_loai_truoc)} /> : <span className="text-slate-400">Chưa ghi nhận</span>}</td>
                      <td>
                        {l.hanh_dong === "xoa" ? (
                          <span className="text-rose-600">Đã xoá</span>
                        ) : (
                          <StatusBadge domain="attendance" status={l.trang_thai_sau} label={statusText(l.trang_thai_sau, l.xep_loai_sau)} />
                        )}
                      </td>
                      <td className="max-w-[280px] text-slate-600">{l.ly_do}</td>
                      <td className="text-slate-600">{nameByProfile.get(l.nguoi_thuc_hien_id) || "Người dùng khác"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {markOpen ? (
        <ModalShell
          title={`Chấm công ${selected.size} ô`}
          onClose={() => !saving && setMarkOpen(false)}
          maxWidth="md"
          footer={
            <>
              {selectedHasRecord ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void submitMark("clear")}
                  className="mr-auto rounded-xl px-4 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  Xoá chấm (về chưa ghi nhận)
                </button>
              ) : null}
              <button type="button" disabled={saving} onClick={() => setMarkOpen(false)} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
                Huỷ
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitMark("set")}
                className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu chấm công"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {markError ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{markError}</div> : null}
            <div className="text-sm text-slate-600">
              {new Set(selectedCells.map((c) => c.staffId)).size} người · {new Set(selectedCells.map((c) => c.day)).size} ngày
              {selectedHasFuture ? <span className="text-amber-600"> · có ngày chưa tới (chỉ đặt trước được Nghỉ tua / phép)</span> : null}
            </div>
            {selectedHasWorker ? (
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Có công nhân trong ô đã chọn — công nhân không có chế độ nghỉ tua (lương theo công thực tế), chỉ chấm Có mặt / Nghỉ có
                phép / Nghỉ không phép.
              </div>
            ) : null}
            <div>
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Trạng thái</span>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_ORDER.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setMarkStatus(st)}
                    disabled={(st === "co_mat" && selectedHasFuture) || (st === "nghi_tua" && selectedHasWorker)}
                    title={st === "nghi_tua" && selectedHasWorker ? "Công nhân không có chế độ nghỉ tua" : undefined}
                    className={`rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-40 ${
                      markStatus === st ? "border-mod-600 bg-mod-50 text-mod-800 ring-1 ring-mod-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {ATTENDANCE_STATUS_LABEL[st]}
                  </button>
                ))}
              </div>
            </div>
            {markStatus === "co_mat" ? (
              <div>
                <span className="mb-1.5 block text-xs font-bold text-slate-600">Xếp loại</span>
                <div className="flex gap-2">
                  {(["A", "B"] as const).map((x) => (
                    <button
                      key={x}
                      type="button"
                      onClick={() => setMarkXep(x)}
                      className={`w-20 rounded-xl border px-3 py-2 text-sm font-bold ${
                        markXep === x ? "border-mod-600 bg-mod-50 text-mod-800 ring-1 ring-mod-600" : "border-slate-200 text-slate-600"
                      }`}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">
                {reasonOptional ? "Lý do (không bắt buộc khi chấm Có mặt – A; bắt buộc khi Xoá chấm)" : "Lý do *"}
              </span>
              <textarea
                value={markReason}
                onChange={(e) => setMarkReason(e.target.value)}
                rows={3}
                placeholder="VD: Bổ sung ngày công theo bảng chấm giấy của tổ"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mod-600"
              />
            </label>
            <p className="text-xs text-slate-500">Mọi lần chấm / xoá đều ghi vào nhật ký (không sửa, không xoá được).</p>
          </div>
        </ModalShell>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg">{toast}</div>
      ) : null}
    </div>
  )
}

function Legend({ cls, text, label }: { cls: string; text: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-extrabold ${cls}`}>{text}</span>
      {label}
    </span>
  )
}
