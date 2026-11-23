"use client"

// Chi tiết phiếu điểm danh ngày (GĐ C2, rule 31): các phần (tổ / ca) + dòng điểm danh. Văn phòng
// (attendance.approve / mark_all / admin) duyệt hoặc trả về TỪNG PHẦN đã gửi. Đã duyệt ⇒ khoá (ngày công nguồn trực ca
// không sửa được, chỉ admin). Bản PDF F01/F02 để GĐ C7.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle2, ClipboardCheck, Undo2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { getErrorMessage } from "@/lib/error-message"
import { LINE_SELECT, SECTION_SELECT, sectionLabel, type AttendanceSection, type DbLine } from "@/lib/attendance/shift"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { DetailPageHeader, HeaderButton } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ReasonConfirmDialog } from "@/app/dashboard/_components/reason-confirm-dialog"

type Sheet = { id: string; ngay: string; day_chuyen: string; ma_phieu: string; trang_thai: string }
type Named = { id: string; ten: string }
type Vehicle = { id: string; code: string | null; name: string | null }

const fmtTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(iso)) : "—"

function readCachedUser(): SessionUser | null {
  try {
    return JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
  } catch {
    return null
  }
}

export default function AttendanceSheetDetailPage() {
  const params = useParams<{ id: string }>()
  const sheetId = params?.id
  const [user, setUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [sections, setSections] = useState<AttendanceSection[]>([])
  const [lines, setLines] = useState<DbLine[]>([])
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map())
  const [jobNames, setJobNames] = useState<Map<string, string>>(new Map())
  const [vehicles, setVehicles] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [returnTarget, setReturnTarget] = useState<AttendanceSection | null>(null)
  const [approveTargets, setApproveTargets] = useState<AttendanceSection[] | null>(null)

  const canReview = !!user && (user.role === "admin" || hasPermission(user, "attendance.approve") || hasPermission(user, "attendance.mark_all"))

  useEffect(() => {
    const u = readCachedUser()
    if (!hasPermission(u, "attendance.view")) {
      window.location.replace("/dashboard")
      return
    }
    setUser(u)
    void getActiveFactoryId().then(setFactoryId)
  }, [])

  const load = useCallback(async () => {
    if (!factoryId || !sheetId) return
    setLoading(true)
    setError(null)
    try {
      const { data: sh, error: e1 } = await supabase
        .from("attendance_daily_sheets")
        .select("id, ngay, day_chuyen, ma_phieu, trang_thai")
        .eq("id", sheetId)
        .eq("factory_id", factoryId)
        .maybeSingle()
      if (e1) throw e1
      if (!sh) {
        setSheet(null)
        return
      }
      const [secRes, lnRes, staffRes, jobRes, vehRes] = await Promise.all([
        supabase.from("attendance_sheet_sections").select(SECTION_SELECT).eq("sheet_id", sheetId),
        supabase.from("attendance_sheet_lines").select(LINE_SELECT).eq("sheet_id", sheetId).order("stt"),
        supabase.from("maintenance_staff").select("id, ten").eq("factory_id", factoryId),
        supabase.from("attendance_job_types").select("id, ten").eq("factory_id", factoryId),
        supabase.from("dispatch_vehicles").select("id, code, name").eq("factory_id", factoryId),
      ])
      for (const r of [secRes, lnRes, staffRes, jobRes, vehRes]) if (r.error) throw r.error
      setSheet(sh as Sheet)
      const order = (s: AttendanceSection) => ["tiep_nhan", "co_dien", "nang_hang", "ca_san_xuat"].indexOf(s.loai) * 10 + (s.ca ? s.ca.charCodeAt(0) : 0)
      setSections(((secRes.data || []) as AttendanceSection[]).sort((a, b) => order(a) - order(b)))
      setLines((lnRes.data || []) as DbLine[])
      setStaffNames(new Map(((staffRes.data || []) as Named[]).map((r) => [r.id, r.ten])))
      setJobNames(new Map(((jobRes.data || []) as Named[]).map((r) => [r.id, r.ten])))
      setVehicles(new Map(((vehRes.data || []) as Vehicle[]).map((v) => [v.id, `${v.code || ""}${v.name ? ` · ${v.name}` : ""}`])))
    } catch (err) {
      setError(getErrorMessage(err, "Không tải được phiếu."))
    } finally {
      setLoading(false)
    }
  }, [factoryId, sheetId])

  useEffect(() => {
    void load()
  }, [load])

  const linesBySection = useMemo(() => {
    const m = new Map<string, DbLine[]>()
    for (const l of lines) m.set(l.section_id, [...(m.get(l.section_id) || []), l])
    return m
  }, [lines])
  const pendingSections = sections.filter((s) => s.trang_thai === "da_gui")
  const name = (id: string | null) => (id ? staffNames.get(id) || "—" : "—")

  const review = async (targets: AttendanceSection[], action: "duyet" | "tra_ve", lyDo: string) => {
    setBusy(true)
    setError(null)
    try {
      const { data, error: e } = await supabase.rpc("attendance_review_sections", {
        p_section_ids: targets.map((t) => t.id),
        p_hanh_dong: action,
        p_ly_do: lyDo || null,
      })
      if (e) throw e
      const r = (data || {}) as { sections?: number; records?: number; skipped_manual?: number }
      setNotice(
        action === "duyet"
          ? `Đã duyệt ${r.sections ?? 0} phần, ghi ${r.records ?? 0} ngày công.${r.skipped_manual ? ` ${r.skipped_manual} ngày giữ nguyên vì đã chấm tay trước đó.` : ""}`
          : `Đã trả về ${r.sections ?? 0} phần cho trực ca.`,
      )
      setReturnTarget(null)
      setApproveTargets(null)
      void load()
    } catch (err) {
      setError(getErrorMessage(err, "Không thực hiện được."))
      setReturnTarget(null)
      setApproveTargets(null)
    } finally {
      setBusy(false)
    }
  }

  if (loading && !sheet) return <div className={moduleThemeClass("mint")}><ListState kind="loading" /></div>
  if (error && !sheet) return <div className={moduleThemeClass("mint")}><ListState kind="error" message={error} onRetry={() => void load()} /></div>
  if (!sheet) return <div className={moduleThemeClass("mint")}><ListState kind="empty" message="Không tìm thấy phiếu điểm danh." /></div>

  const total = lines.length
  const co = lines.filter((l) => l.diem_danh === "co").length

  return (
    <div className={`${moduleThemeClass("mint")} space-y-4`}>
      <DetailPageHeader
        backHref="/dashboard/attendance?tab=sheets"
        eyebrow="Phiếu điểm danh ca"
        title={`${sheet.day_chuyen} · ${sheet.ngay.split("-").reverse().join("/")}`}
        code={sheet.ma_phieu}
        tags={
          <>
            <StatusBadge domain="attendance_sheet" status={sheet.trang_thai} />
            <StatusBadge tone="info" label={`${co}/${total} có mặt`} />
          </>
        }
        actions={
          canReview && pendingSections.length > 0 ? (
            <HeaderButton tone="brand" icon={<CheckCircle2 size={15} />} label={`Duyệt mọi phần đã gửi (${pendingSections.length})`} onClick={() => setApproveTargets(pendingSections)} disabled={busy} />
          ) : undefined
        }
      />
      {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{notice}</div> : null}

      {sections.length === 0 ? <ListState kind="empty" message="Phiếu chưa có phần nào." /> : null}
      {sections.map((sec) => {
        const ls = linesBySection.get(sec.id) || []
        const replacedBy = new Map(ls.filter((l) => l.thay_cho_staff_id).map((l) => [l.thay_cho_staff_id as string, l.staff_id]))
        return (
          <section key={sec.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
                  <ClipboardCheck size={17} className="text-mod-600" />
                  {sectionLabel(sec.loai, sec.ca, sheet.day_chuyen)}
                  <StatusBadge domain="attendance_sheet" status={sec.trang_thai} size="xs" />
                </h2>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Trực ca: <b className="text-slate-700">{name(sec.truc_ca_staff_id)}</b></span>
                  {sec.loai === "ca_san_xuat" ? <span>Ca trưởng: <b className="text-slate-700">{sec.ca_truong_ten || "—"}</b></span> : <span>Tổ trưởng: <b className="text-slate-700">{name(sec.to_truong_staff_id)}</b></span>}
                  <span>Tổ phó: <b className="text-slate-700">{name(sec.to_pho_staff_id)}</b></span>
                  <span>Bắt đầu: {fmtTime(sec.bat_dau_luc)}</span>
                  {sec.gui_luc ? <span>Gửi: {fmtTime(sec.gui_luc)}</span> : null}
                  {sec.duyet_luc ? <span>Duyệt: {fmtTime(sec.duyet_luc)}</span> : null}
                  {sec.ngoai_phan_cong ? <span className="font-semibold text-amber-700">Trực ngoài ca được phân công</span> : null}
                </div>
                {sec.trang_thai === "tra_ve" && sec.tra_ve_ly_do ? <div className="mt-1 text-xs font-semibold text-rose-700">Trả về: {sec.tra_ve_ly_do}</div> : null}
                {sec.ghi_chu ? <div className="mt-1 text-xs text-slate-600">Ghi chú: {sec.ghi_chu}</div> : null}
              </div>
              {canReview && sec.trang_thai === "da_gui" ? (
                <div className="flex shrink-0 gap-2">
                  <HeaderButton tone="danger" icon={<Undo2 size={14} />} label="Trả về" onClick={() => setReturnTarget(sec)} disabled={busy} />
                  <HeaderButton tone="brand" icon={<CheckCircle2 size={14} />} label="Duyệt phần" onClick={() => setApproveTargets([sec])} disabled={busy} />
                </div>
              ) : null}
            </div>
            <ResponsiveTableWrapper className="mt-3 rounded-none border-0 shadow-none">
              <table className="enterprise-table dense min-w-[820px]">
                <thead>
                  <tr>
                    <th className="text-right">STT</th>
                    <th>Người</th>
                    <th>Công việc</th>
                    <th>Xe</th>
                    <th>Điểm danh</th>
                    <th>Người thay / thay cho</th>
                    <th>Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {ls.length === 0 ? (
                    <ListState kind="empty" message="Chưa có dòng nào." asRow colSpan={7} />
                  ) : (
                    ls.map((l, i) => (
                      <tr key={l.id}>
                        <td className="text-right">{i + 1}</td>
                        <td className="font-semibold">
                          {name(l.staff_id)}
                          {l.la_them_ngoai ? <span className="ml-1 text-[11px] font-normal text-slate-400">(thêm)</span> : null}
                        </td>
                        <td>{l.cong_viec_id ? jobNames.get(l.cong_viec_id) || "—" : <span className="text-slate-400">Chưa phân công</span>}</td>
                        <td>{l.vehicle_id ? vehicles.get(l.vehicle_id) || "—" : ""}</td>
                        <td>
                          {l.diem_danh === "co" ? (
                            <StatusBadge tone={l.xep_loai === "B" ? "warn" : "valid"} label={`Có mặt · ${l.xep_loai || "A"}`} size="xs" />
                          ) : (
                            <div>
                              <StatusBadge tone={l.vang_loai === "khong_phep" ? "danger" : "warn"} label={l.vang_loai === "khong_phep" ? "Vắng không phép" : "Vắng có phép"} size="xs" />
                              {l.ly_do ? <div className="text-xs text-slate-500">{l.ly_do}</div> : null}
                            </div>
                          )}
                        </td>
                        <td className="text-xs">
                          {l.thay_cho_staff_id ? <span className="text-violet-700">Thay cho {name(l.thay_cho_staff_id)}</span> : null}
                          {replacedBy.get(l.staff_id) ? <span className="text-slate-600">Người thay: {name(replacedBy.get(l.staff_id) || null)}</span> : null}
                        </td>
                        <td className="text-xs">{l.ghi_chu || ""}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ResponsiveTableWrapper>
          </section>
        )
      })}

      {returnTarget ? (
        <ReasonConfirmDialog
          title="Trả về phần điểm danh"
          subtitle={`${sheet.ma_phieu} · ${sectionLabel(returnTarget.loai, returnTarget.ca, sheet.day_chuyen)}`}
          points={["Trực ca lập phần này sẽ được báo trên chuông và sửa rồi gửi lại.", "Chưa ghi ngày công nào cho phần này."]}
          confirmLabel="Trả về"
          busy={busy}
          onConfirm={(r) => void review([returnTarget], "tra_ve", r)}
          onCancel={() => setReturnTarget(null)}
        />
      ) : null}
      {approveTargets ? (
        <ReasonConfirmDialog
          title={approveTargets.length > 1 ? `Duyệt ${approveTargets.length} phần đã gửi` : "Duyệt phần điểm danh"}
          subtitle={approveTargets.map((t) => sectionLabel(t.loai, t.ca, sheet.day_chuyen)).join(" · ")}
          points={[
            "Ghi ngày công nguồn trực ca cho mọi người trong phần (có mặt + xếp loại A/B, vắng có / không phép).",
            "Ngày đã chấm tay trước đó được giữ nguyên.",
            "Sau khi duyệt KHÔNG sửa được nữa (ở cả phiếu lẫn Lịch công) — chỉ admin sửa, có lý do.",
          ]}
          reasonLabel="Ghi chú (không bắt buộc)"
          requireReason={false}
          confirmLabel="Duyệt"
          busy={busy}
          onConfirm={(r) => void review(approveTargets, "duyet", r)}
          onCancel={() => setApproveTargets(null)}
        />
      ) : null}
    </div>
  )
}
