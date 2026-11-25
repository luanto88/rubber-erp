"use client"

// Tab "Phiếu điểm danh" của /dashboard/attendance (rule 31, C2 làm lại): phiếu ngày theo dây chuyền, dòng xổ = các
// phiếu CA (Ca A/B/C) với trạng thái + số có mặt / vắng / người thay. Con mắt ⇒ chi tiết phiếu (duyệt / trả về từng ca).

import { useCallback, useEffect, useMemo, useState } from "react"
import { ClipboardList, Clock3, CheckCircle2, Undo2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getErrorMessage } from "@/lib/error-message"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { ATTENDANCE_DAY_CHUYEN } from "@/lib/attendance/types"
import { SECTION_SELECT, UNIT_SELECT, sectionLabel, type AttendanceSection, type AttendanceUnit } from "@/lib/attendance/shift"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action"
import { ExpandableRow, ExpandAllToggle, ExpandHeaderCell } from "@/app/dashboard/_components/doc-ui/expandable-row"
import { IconActionGroup } from "@/app/dashboard/_components/doc-ui/icon-action"
import { ReasonConfirmDialog } from "@/app/dashboard/_components/reason-confirm-dialog"
import { hasPermission, readCachedSessionUser, type SessionUser } from "@/lib/auth"
import { downloadF01, resolveF01Pdf } from "@/lib/attendance/f01-client"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"

type SheetRow = { id: string; ngay: string; day_chuyen: string; ma_phieu: string; trang_thai: string }
type LineCount = { section_id: string; diem_danh: string; thay_the_staff_id: string | null; thay_the_ten: string | null }

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const fmtDate = (iso: string) => iso.split("-").reverse().join("/")
const fmtTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(iso)) : "—"

export function SheetReviewList({ factoryId }: { factoryId: string }) {
  const today = getFactoryTodayISO()
  const [from, setFrom] = useState(addDays(today, -13))
  const [to, setTo] = useState(today)
  const [dayChuyen, setDayChuyen] = useState("")
  const [status, setStatus] = useState("")
  const [sheets, setSheets] = useState<SheetRow[]>([])
  const [sections, setSections] = useState<AttendanceSection[]>([])
  const [counts, setCounts] = useState<LineCount[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [units, setUnits] = useState<Map<string, AttendanceUnit>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [user, setUser] = useState<SessionUser | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<
    | { kind: "sheet"; id: string; label: string }
    | { kind: "section"; id: string; label: string; approved: boolean }
    | null
  >(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    try {
      setUser(readCachedSessionUser())
    } catch {
      setUser(null)
    }
  }, [])
  const isAdmin = user?.role === "admin"
  const canEditAny = !!user && (isAdmin || hasPermission(user, "attendance.mark") || hasPermission(user, "attendance.mark_all"))

  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    setError(null)
    try {
      const sh = await fetchAllPaginated<SheetRow>((a, b) =>
        supabase
          .from("attendance_daily_sheets")
          .select("id, ngay, day_chuyen, ma_phieu, trang_thai")
          .eq("factory_id", factoryId)
          .gte("ngay", from)
          .lte("ngay", to)
          .order("ngay", { ascending: false })
          .order("id")
          .range(a, b),
      )
      const ids = sh.map((s) => s.id)
      const secs: AttendanceSection[] = []
      const lc: LineCount[] = []
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        const { data, error: e } = await supabase.from("attendance_sheet_sections").select(SECTION_SELECT).in("sheet_id", chunk)
        if (e) throw e
        secs.push(...((data || []) as AttendanceSection[]))
        const rows = await fetchAllPaginated<LineCount>((a, b) =>
          supabase.from("attendance_sheet_lines").select("section_id, diem_danh, thay_the_staff_id, thay_the_ten").in("sheet_id", chunk).order("id").range(a, b),
        )
        lc.push(...rows)
      }
      const staffIds = Array.from(new Set(secs.map((s) => s.truc_ca_staff_id).filter(Boolean))) as string[]
      const nm = new Map<string, string>()
      if (staffIds.length > 0) {
        const { data, error: e } = await supabase.from("maintenance_staff").select("id, ten").in("id", staffIds)
        if (e) throw e
        for (const r of data || []) nm.set(r.id as string, r.ten as string)
      }
      const { data: unitRows, error: ue } = await supabase.from("attendance_units").select(UNIT_SELECT).eq("factory_id", factoryId)
      if (ue) throw ue
      const unitMap = new Map(((unitRows || []) as AttendanceUnit[]).map((u) => [u.code, u]))
      setUnits(unitMap)
      secs.sort((a, b) => (unitMap.get(a.ca || "")?.sort_order ?? 9999) - (unitMap.get(b.ca || "")?.sort_order ?? 9999))
      // Phiếu ca trống (đang lập, chưa có dòng — Ca/Tổ không làm việc / chỉ mở xem) không hiện, không tính (migration 20261212).
      const withLines = new Set(lc.map((l) => l.section_id))
      setSheets(sh)
      setSections(secs.filter((s) => !(s.trang_thai === "dang_lam" && !withLines.has(s.id))))
      setCounts(lc)
      setNames(nm)
    } catch (err) {
      const m = getErrorMessage(err, "Không tải được phiếu điểm danh.")
      setError(/attendance_daily_sheets|attendance_sheet/.test(m) ? "Chưa có bảng phiếu điểm danh — chạy migration 20261205_attendance_c2_shift_sheets.sql." : m)
    } finally {
      setLoading(false)
    }
  }, [factoryId, from, to])

  useEffect(() => {
    void load()
  }, [load])

  const secBySheet = useMemo(() => {
    const m = new Map<string, AttendanceSection[]>()
    for (const s of sections) m.set(s.sheet_id, [...(m.get(s.sheet_id) || []), s])
    const order = (s: AttendanceSection) => ["tiep_nhan", "co_dien", "nang_hang", "ca_san_xuat"].indexOf(s.loai) * 10 + (s.ca ? s.ca.charCodeAt(0) : 0)
    for (const arr of m.values()) arr.sort((a, b) => order(a) - order(b))
    return m
  }, [sections])
  const countBySection = useMemo(() => {
    const m = new Map<string, { co: number; vang: number; thay: number }>()
    for (const l of counts) {
      const c = m.get(l.section_id) || { co: 0, vang: 0, thay: 0 }
      if (l.diem_danh === "co") c.co += 1
      else c.vang += 1
      if (l.thay_the_staff_id || l.thay_the_ten) c.thay += 1
      m.set(l.section_id, c)
    }
    return m
  }, [counts])

  const filtered = sheets.filter((s) => (!dayChuyen || s.day_chuyen === dayChuyen) && (!status || s.trang_thai === status || (secBySheet.get(s.id) || []).some((x) => x.trang_thai === status)))
  const pending = sections.filter((s) => s.trang_thai === "da_gui").length
  const returned = sections.filter((s) => s.trang_thai === "tra_ve").length
  const approved = sections.filter((s) => s.trang_thai === "da_duyet").length

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const activeCount = (dayChuyen ? 1 : 0) + (status ? 1 : 0)

  const downloadSheet = async (s: SheetRow) => {
    setActionError(null)
    setDownloadingId(s.id)
    try {
      const r = await resolveF01Pdf(factoryId, s.id)
      await downloadF01(r, factoryId)
    } catch (err) {
      setActionError(getErrorMessage(err, "Không tải được phiếu TKSX."))
    } finally {
      setDownloadingId(null)
    }
  }
  const canEditSection = (x: AttendanceSection) =>
    (x.trang_thai === "dang_lam" || x.trang_thai === "tra_ve") && (canEditAny || (!!user && x.truc_ca_user_id === user.id))
  const canDiscardSection = (x: AttendanceSection) =>
    x.trang_thai === "da_duyet" ? isAdmin : canEditAny || (!!user && x.truc_ca_user_id === user.id)

  const runConfirm = async (lyDo: string) => {
    if (!confirm) return
    setBusy(true)
    setActionError(null)
    try {
      const { error: e } =
        confirm.kind === "sheet"
          ? await supabase.rpc("attendance_delete_sheet", { p_sheet_id: confirm.id, p_ly_do: lyDo })
          : await supabase.rpc("attendance_discard_section", { p_section_id: confirm.id, p_ly_do: lyDo })
      if (e) throw e
      setConfirm(null)
      void load()
    } catch (err) {
      setActionError(getErrorMessage(err, "Không thực hiện được."))
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <StatGrid cols={4}>
        <StatCard icon={ClipboardList} label="Phiếu trong kỳ" value={sheets.length} loading={loading} />
        <StatCard icon={Clock3} label="Phần chờ duyệt" value={pending} valueTone={pending > 0 ? "warn" : "default"} loading={loading} onClick={() => setStatus("da_gui")} active={status === "da_gui"} />
        <StatCard icon={Undo2} label="Phần bị trả về" value={returned} valueTone={returned > 0 ? "danger" : "default"} loading={loading} onClick={() => setStatus("tra_ve")} active={status === "tra_ve"} />
        <StatCard icon={CheckCircle2} label="Phần đã duyệt" value={approved} valueTone="good" loading={loading} />
      </StatGrid>

      <FilterBar layout="grid" activeCount={activeCount}>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">Từ ngày</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">Đến ngày</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">Dây chuyền</span>
          <select value={dayChuyen} onChange={(e) => setDayChuyen(e.target.value)} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm">
            <option value="">Tất cả</option>
            {ATTENDANCE_DAY_CHUYEN.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">Trạng thái phiếu ca</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm">
            <option value="">Tất cả</option>
            <option value="dang_lam">Đang điểm danh</option>
            <option value="da_gui">Chờ duyệt</option>
            <option value="tra_ve">Bị trả về</option>
            <option value="da_duyet">Đã duyệt</option>
          </select>
        </label>
      </FilterBar>

      {actionError ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{actionError}</div> : null}

      <div className="flex justify-end">
        <ExpandAllToggle
          allExpanded={filtered.length > 0 && filtered.every((s) => expanded.has(s.id))}
          onExpandAll={() => setExpanded(new Set(filtered.map((s) => s.id)))}
          onCollapseAll={() => setExpanded(new Set())}
          disabled={filtered.length === 0}
        />
      </div>

      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[840px]">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Mã phiếu</th>
              <th>Dây chuyền</th>
              <th>Trạng thái</th>
              <th className="text-right">Phiếu ca</th>
              <th className="text-right">Có mặt</th>
              <th className="text-right">Vắng</th>
              <th className="text-right">Người thay</th>
              <ExpandHeaderCell>Thao tác</ExpandHeaderCell>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <ListState kind="loading" asRow colSpan={9} />
            ) : error ? (
              <ListState kind="error" message={error} onRetry={() => void load()} asRow colSpan={9} />
            ) : filtered.length === 0 ? (
              <ListState kind="empty" message="Chưa có phiếu điểm danh trong khoảng ngày này." asRow colSpan={9} />
            ) : (
              filtered.map((s) => {
                const secs = secBySheet.get(s.id) || []
                const tot = secs.reduce(
                  (acc, x) => {
                    const c = countBySection.get(x.id) || { co: 0, vang: 0, thay: 0 }
                    return { co: acc.co + c.co, vang: acc.vang + c.vang, thay: acc.thay + c.thay }
                  },
                  { co: 0, vang: 0, thay: 0 },
                )
                const waiting = secs.filter((x) => x.trang_thai === "da_gui").length
                return (
                  <ExpandableRow
                    key={s.id}
                    expanded={expanded.has(s.id)}
                    onToggle={() => toggle(s.id)}
                    canExpand={secs.length > 0}
                    colSpan={9}
                    endCell={
                      <IconActionGroup>
                        <RowAction kind="view" label="Xem phiếu" href={`/dashboard/attendance/sheet/${s.id}`} />
                        <RowAction
                          kind="download"
                          label="Tải phiếu TKSX (PDF)"
                          loading={downloadingId === s.id}
                          disabled={secs.length === 0}
                          onClick={() => void downloadSheet(s)}
                        />
                        {secs.some(canEditSection) ? (
                          <RowAction kind="edit" label="Sửa điểm danh" href={`/dashboard/attendance/shift?section=${secs.find(canEditSection)?.id}`} />
                        ) : null}
                        {isAdmin ? (
                          <RowAction kind="delete" label="Xoá phiếu ngày" onClick={() => setConfirm({ kind: "sheet", id: s.id, label: s.ma_phieu })} />
                        ) : null}
                      </IconActionGroup>
                    }
                    detail={
                      <table className="enterprise-table dense">
                        <thead>
                          <tr>
                            <th>Phiếu ca</th>
                            <th>Trực ca</th>
                            <th>Trạng thái</th>
                            <th className="text-right">Có mặt</th>
                            <th className="text-right">Vắng</th>
                            <th className="text-right">Người thay</th>
                            <th>Gửi lúc</th>
                            <th className="text-right">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {secs.map((x) => {
                            const c = countBySection.get(x.id) || { co: 0, vang: 0, thay: 0 }
                            return (
                              <tr key={x.id}>
                                <td className="font-semibold">{sectionLabel(x.loai, x.ca, s.day_chuyen, units)}</td>
                                <td>{x.truc_ca_staff_id ? names.get(x.truc_ca_staff_id) || "—" : "—"}</td>
                                <td>
                                  <StatusBadge domain="attendance_sheet" status={x.trang_thai} size="xs" />
                                </td>
                                <td className="text-right">{c.co}</td>
                                <td className="text-right">{c.vang}</td>
                                <td className="text-right">{c.thay}</td>
                                <td>{fmtTime(x.gui_luc)}</td>
                                <td>
                                  <IconActionGroup>
                                    {canEditSection(x) ? <RowAction kind="edit" label="Sửa phiếu ca" href={`/dashboard/attendance/shift?section=${x.id}`} /> : null}
                                    {canDiscardSection(x) ? (
                                      <RowAction
                                        kind="delete"
                                        label="Bỏ phiếu ca (Ca/Tổ không làm việc)"
                                        onClick={() =>
                                          setConfirm({
                                            kind: "section",
                                            id: x.id,
                                            label: `${sectionLabel(x.loai, x.ca, s.day_chuyen, units)} · ${s.ma_phieu}`,
                                            approved: x.trang_thai === "da_duyet",
                                          })
                                        }
                                      />
                                    ) : null}
                                  </IconActionGroup>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    }
                  >
                    <td className="whitespace-nowrap font-semibold">{fmtDate(s.ngay)}</td>
                    <td className="font-code">{s.ma_phieu}</td>
                    <td>{s.day_chuyen}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge domain="attendance_sheet" status={s.trang_thai} size="xs" />
                        {waiting > 0 && s.trang_thai !== "da_gui" ? <StatusBadge tone="pending" label={`${waiting} ca chờ duyệt`} size="xs" /> : null}
                      </div>
                    </td>
                    <td className="text-right">{secs.length}</td>
                    <td className="text-right">{tot.co}</td>
                    <td className="text-right">{tot.vang}</td>
                    <td className="text-right">{tot.thay}</td>
                  </ExpandableRow>
                )
              })
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      {confirm ? (
        <ReasonConfirmDialog
          title={confirm.kind === "sheet" ? "Xoá phiếu điểm danh ngày" : "Bỏ phiếu ca"}
          subtitle={confirm.label}
          points={
            confirm.kind === "sheet"
              ? ["Xoá mọi phiếu ca và dòng điểm danh của ngày này.", "Ngày công lấy từ phiếu này được tính lại (chấm tay giữ nguyên)."]
              : [
                  "Dùng khi Ca/Tổ này không làm việc trong ngày — mọi dòng của phiếu ca bị xoá.",
                  confirm.approved ? "Phiếu ca ĐÃ DUYỆT: ngày công lấy từ phiếu này được tính lại." : "Phiếu ca chưa duyệt nên chưa ghi ngày công nào.",
                ]
          }
          requireReason={confirm.kind === "sheet" || confirm.approved}
          confirmLabel={confirm.kind === "sheet" ? "Xoá phiếu" : "Bỏ phiếu ca"}
          busy={busy}
          onConfirm={(r) => void runConfirm(r)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  )
}
