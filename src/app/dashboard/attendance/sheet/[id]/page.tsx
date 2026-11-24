"use client"

// Chi tiết phiếu điểm danh ngày (rule 31, C2 làm lại GĐ2): mỗi phiếu CA 1 khối, dòng = người (nhiều việc, người thay).
// Văn phòng (attendance.approve / mark_all / admin) duyệt hoặc trả về TỪNG CA đã gửi. Đã duyệt ⇒ khoá (ngày công nguồn
// trực ca không sửa được, chỉ admin). Bản PDF F01/F02 để GĐ3.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle2, ClipboardCheck, Download, FileText, RotateCcw, Trash2, Undo2 } from "lucide-react"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { downloadPdfBytes, resolveF01Pdf, type F01Result } from "@/lib/attendance/f01-client"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { getErrorMessage } from "@/lib/error-message"
import {
  LINE_SELECT,
  POSITION_KEYS,
  SECTION_SELECT,
  UNIT_SELECT,
  hasStoredPositions,
  jobIdsOf,
  positionLabelKey,
  sectionLabel,
  type AttendanceSection,
  type AttendanceUnit,
  type DbLine,
} from "@/lib/attendance/shift"
import { at } from "@/lib/attendance/i18n"
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
  const [units, setUnits] = useState<Map<string, AttendanceUnit>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [returnTarget, setReturnTarget] = useState<AttendanceSection | null>(null)
  const [approveTargets, setApproveTargets] = useState<AttendanceSection[] | null>(null)
  const [reopenTarget, setReopenTarget] = useState<AttendanceSection | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [viewTab, setViewTab] = useState<"content" | "pdf">("content")
  const [f01Result, setF01Result] = useState<F01Result | null>(null)

  const isAdmin = user?.role === "admin"
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
      const [secRes, lnRes, staffRes, jobRes, vehRes, unitRes] = await Promise.all([
        supabase.from("attendance_sheet_sections").select(SECTION_SELECT).eq("sheet_id", sheetId),
        supabase.from("attendance_sheet_lines").select(LINE_SELECT).eq("sheet_id", sheetId).order("stt"),
        supabase.from("maintenance_staff").select("id, ten").eq("factory_id", factoryId),
        supabase.from("attendance_job_types").select("id, ten").eq("factory_id", factoryId),
        supabase.from("dispatch_vehicles").select("id, code, name").eq("factory_id", factoryId),
        supabase.from("attendance_units").select(UNIT_SELECT).eq("factory_id", factoryId),
      ])
      for (const r of [secRes, lnRes, staffRes, jobRes, vehRes, unitRes]) if (r.error) throw r.error
      setSheet(sh as Sheet)
      const unitMap = new Map(((unitRes.data || []) as AttendanceUnit[]).map((u) => [u.code, u]))
      setUnits(unitMap)
      const order = (s: AttendanceSection) => unitMap.get(s.ca || "")?.sort_order ?? 9999
      setSections(((secRes.data || []) as AttendanceSection[]).sort((a, b) => order(a) - order(b) || (a.ca || "").localeCompare(b.ca || "")))
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
  // Dựng lại phiếu khi trạng thái / thời điểm duyệt / số dòng đổi (duyệt, mở lại, trực ca sửa).
  const f01SourceKey = `${sheetId}|${sections.map((s) => `${s.id}:${s.trang_thai}:${s.duyet_luc || ""}:${s.ket_thuc_luc || ""}`).join(",")}|${lines.length}`
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
          ? `Đã duyệt ${r.sections ?? 0} phiếu ca, ghi ${r.records ?? 0} ngày công.${r.skipped_manual ? ` ${r.skipped_manual} ngày giữ nguyên vì đã chấm tay trước đó.` : ""}`
          : `Đã trả về ${r.sections ?? 0} phiếu ca cho trực ca.`,
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

  const reopen = async (target: AttendanceSection, lyDo: string) => {
    setBusy(true)
    setError(null)
    try {
      const { data, error: e } = await supabase.rpc("attendance_reopen_section", { p_section_id: target.id, p_ly_do: lyDo })
      if (e) throw e
      const r = (data || {}) as { records_updated?: number; records_deleted?: number }
      setNotice(
        `Đã mở lại ${sectionLabel(target.loai, target.ca, sheet?.day_chuyen || "", units)} — phiếu về "Trả về" cho trực ca sửa. ` +
          `Ngày công: cập nhật ${r.records_updated ?? 0}, xoá ${r.records_deleted ?? 0} (ngày chấm tay giữ nguyên).`,
      )
      setReopenTarget(null)
      void load()
    } catch (err) {
      setError(getErrorMessage(err, "Không mở lại được phiếu ca."))
      setReopenTarget(null)
    } finally {
      setBusy(false)
    }
  }

  const deleteSheet = async (lyDo: string) => {
    if (!sheetId) return
    setBusy(true)
    setError(null)
    try {
      const { error: e } = await supabase.rpc("attendance_delete_sheet", { p_sheet_id: sheetId, p_ly_do: lyDo })
      if (e) throw e
      window.location.replace("/dashboard/attendance?tab=sheets")
    } catch (err) {
      setError(getErrorMessage(err, "Không xoá được phiếu."))
      setDeleteOpen(false)
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
          <>
            {canReview && pendingSections.length > 0 ? (
              <HeaderButton tone="brand" icon={<CheckCircle2 size={15} />} label={`Duyệt mọi ca đã gửi (${pendingSections.length})`} onClick={() => setApproveTargets(pendingSections)} disabled={busy} />
            ) : null}
            {isAdmin ? (
              <HeaderButton tone="danger" icon={<Trash2 size={15} />} label="Xoá phiếu" onClick={() => setDeleteOpen(true)} disabled={busy} />
            ) : null}
          </>
        }
      />
      {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{notice}</div> : null}

      <SegmentedTabs
        ariaLabel="Chọn nội dung phiếu"
        value={viewTab}
        onChange={setViewTab}
        items={[
          { key: "content", label: "Nội dung điểm danh", icon: ClipboardCheck, count: total },
          { key: "pdf", label: "Phiếu TKSX", icon: FileText },
        ]}
      />
      {viewTab === "pdf" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {f01Result ? (
              <StatusBadge
                tone={f01Result.kind === "hard" ? "valid" : f01Result.kind === "preview" ? "draft" : "warn"}
                label={f01Result.kind === "hard" ? "Bản cứng đã lưu (có dấu duyệt)" : f01Result.kind === "preview" ? "Bản xem trước — chưa duyệt đủ các ca" : "Đã duyệt đủ — chưa lưu bản cứng"}
              />
            ) : null}
            {f01Result?.snapshot ? (
              <span className="text-xs text-slate-500">Lưu lúc {fmtTime(f01Result.snapshot.createdAt)}</span>
            ) : null}
            <span className="ml-auto" />
            <HeaderButton
              icon={<Download size={14} />}
              label="Tải PDF"
              disabled={!f01Result}
              onClick={() => f01Result && downloadPdfBytes(f01Result.bytes, f01Result.fileName)}
            />
          </div>
          {f01Result?.warning ? <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{f01Result.warning}</div> : null}
          {factoryId ? (
            <DocViewer
              key={`f01-${sheet.id}`}
              active
              loadBytes={async () => {
                const r = await resolveF01Pdf(factoryId, sheet.id)
                setF01Result(r)
                return r.bytes
              }}
              sourceKey={f01SourceKey}
              kind="pdf"
              fileExt="pdf"
              label={`${sheet.ma_phieu} · Phiếu triển khai sản xuất`}
            />
          ) : null}
        </div>
      ) : null}

      {viewTab === "content" && sections.length === 0 ? <ListState kind="empty" message="Phiếu chưa có phiếu ca nào." /> : null}
      {viewTab === "content" && sections.map((sec) => {
        const ls = linesBySection.get(sec.id) || []
        return (
          <section key={sec.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
                  <ClipboardCheck size={17} className="text-mod-600" />
                  {sectionLabel(sec.loai, sec.ca, sheet.day_chuyen, units)}
                  <StatusBadge domain="attendance_sheet" status={sec.trang_thai} size="xs" />
                </h2>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Trực ca: <b className="text-slate-700">{name(sec.truc_ca_staff_id)}</b></span>
                  {hasStoredPositions(sec.vi_tri) ? (
                    POSITION_KEYS.filter((k) => sec.vi_tri?.[k]?.staff_id).map((k) => {
                      const slot = sec.vi_tri?.[k]
                      const replaced = slot?.goc_staff_id && slot.goc_staff_id !== slot.staff_id
                      return (
                        <span key={k}>
                          {at("vi", positionLabelKey(k, units.get(sec.ca || "")?.loai))}: <b className="text-slate-700">{name(slot?.staff_id || null)}</b>
                          {replaced ? <span className="text-violet-700"> (thay {name(slot?.goc_staff_id || null)})</span> : null}
                        </span>
                      )
                    })
                  ) : sec.loai === "ca_san_xuat" ? (
                    <span>Ca trưởng: <b className="text-slate-700">{sec.ca_truong_ten || "—"}</b></span>
                  ) : null}
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
                  <HeaderButton tone="brand" icon={<CheckCircle2 size={14} />} label="Duyệt ca" onClick={() => setApproveTargets([sec])} disabled={busy} />
                </div>
              ) : null}
              {isAdmin && sec.trang_thai === "da_duyet" ? (
                <div className="flex shrink-0 gap-2">
                  <HeaderButton tone="danger" icon={<RotateCcw size={14} />} label="Mở lại để sửa" onClick={() => setReopenTarget(sec)} disabled={busy} />
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
                    <th>Người thay</th>
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
                        <td>
                          {jobIdsOf(l).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {jobIdsOf(l).map((j) => (
                                <span key={j} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                  {jobNames.get(j) || "—"}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td>{l.vehicle_id ? vehicles.get(l.vehicle_id) || "—" : ""}</td>
                        <td>
                          {l.diem_danh === "co" ? (
                            <StatusBadge tone={l.xep_loai === "B" ? "warn" : "valid"} label={`Có mặt · ${l.xep_loai || "A"}`} size="xs" />
                          ) : (
                            <div>
                              <StatusBadge
                                tone={l.vang_loai === "khong_phep" ? "danger" : l.vang_loai ? "warn" : "draft"}
                                label={l.vang_loai === "khong_phep" ? "Vắng không phép" : l.vang_loai ? "Vắng có phép" : "Vắng (chưa chọn phép)"}
                                size="xs"
                              />
                              {l.ly_do ? <div className="text-xs text-slate-500">{l.ly_do}</div> : null}
                            </div>
                          )}
                        </td>
                        <td className="text-xs">
                          {l.thay_the_staff_id ? <span className="font-semibold text-violet-700">{name(l.thay_the_staff_id)}</span> : null}
                          {!l.thay_the_staff_id && l.thay_the_ten ? (
                            <span className="font-semibold text-violet-700">
                              {l.thay_the_ten} <span className="font-normal text-slate-400">(tạm)</span>
                            </span>
                          ) : null}
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
          title="Trả về phiếu ca"
          subtitle={`${sheet.ma_phieu} · ${sectionLabel(returnTarget.loai, returnTarget.ca, sheet.day_chuyen, units)}`}
          points={["Trực ca lập phiếu ca này sẽ được báo trên chuông và sửa rồi gửi lại.", "Chưa ghi ngày công nào cho phiếu ca này."]}
          confirmLabel="Trả về"
          busy={busy}
          onConfirm={(r) => void review([returnTarget], "tra_ve", r)}
          onCancel={() => setReturnTarget(null)}
        />
      ) : null}
      {deleteOpen ? (
        <ReasonConfirmDialog
          title="Xoá phiếu điểm danh"
          subtitle={`${sheet.ma_phieu} · ${sheet.day_chuyen} · ${sheet.ngay.split("-").reverse().join("/")}`}
          points={[
            `Xoá toàn bộ ${sections.length} phiếu ca và ${lines.length} dòng điểm danh của phiếu này — không khôi phục được.`,
            "Ngày công lấy từ phiếu này được tính lại theo phiếu ca đã duyệt khác cùng ngày; không còn ⇒ xoá ngày công đó (có ghi nhật ký).",
            "Ngày đã chấm tay giữ nguyên. Bản cứng F01/F02 đã lưu (nếu có) vẫn giữ làm lịch sử.",
          ]}
          confirmLabel="Xoá phiếu"
          busy={busy}
          onConfirm={(r) => void deleteSheet(r)}
          onCancel={() => setDeleteOpen(false)}
        />
      ) : null}
      {reopenTarget ? (
        <ReasonConfirmDialog
          title="Mở lại phiếu ca đã duyệt"
          subtitle={`${sheet.ma_phieu} · ${sectionLabel(reopenTarget.loai, reopenTarget.ca, sheet.day_chuyen, units)}`}
          points={[
            'Phiếu ca về trạng thái "Trả về" — trực ca được báo trên chuông, sửa rồi gửi lại để duyệt lần nữa.',
            "Ngày công lấy từ phiếu ca này được tính lại theo các phiếu ca khác đã duyệt cùng ngày; không còn phiếu nào ⇒ xoá ngày công đó.",
            "Ngày đã chấm tay giữ nguyên.",
            "Bản cứng F01/F02 đã lưu (nếu có) hết hiệu lực nhưng vẫn giữ làm lịch sử; lần duyệt sau sẽ sinh bản mới.",
          ]}
          confirmLabel="Mở lại"
          busy={busy}
          onConfirm={(r) => void reopen(reopenTarget, r)}
          onCancel={() => setReopenTarget(null)}
        />
      ) : null}
      {approveTargets ? (
        <ReasonConfirmDialog
          title={approveTargets.length > 1 ? `Duyệt ${approveTargets.length} phiếu ca đã gửi` : "Duyệt phiếu ca"}
          subtitle={approveTargets.map((t) => sectionLabel(t.loai, t.ca, sheet.day_chuyen, units)).join(" · ")}
          points={[
            "Ghi ngày công nguồn trực ca cho mọi người trong phiếu ca (có mặt + xếp loại A/B, vắng có / không phép).",
            "Người thay có trong Nhân sự được tính có mặt (A); người thay gõ tay (tạm) không ghi ngày công.",
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
