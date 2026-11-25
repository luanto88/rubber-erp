"use client"

// Bước "Gửi chấm công" (C2 làm lại GĐ2), toàn màn: (a) người vắng — Có phép / Không phép (mặc định Có phép; Không phép
// bắt buộc lý do), (b) công nhân của ca chưa giao việc — Vắng (cùng xử lý phép) hoặc Bỏ qua (không lên phiếu).
// Đầu màn luôn có TÓM TẮT phiếu (dây chuyền · ca · ngày · mã; số có mặt / vắng / người thay; bảng theo việc).
// Xác nhận ⇒ trả về các dòng cần ghi đè / thêm; trang gọi lưu rồi attendance_submit_section.

import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, CheckCircle2, Loader2, Plus, Send } from "lucide-react"
import { GenderIcon } from "./gender-icon"
import { bilingual, type AttLang } from "@/lib/attendance/i18n"
import type { AttendanceAbsenceReason, AttendanceJobType } from "@/lib/attendance/types"
import { emptyLine, type SheetLineDraft, type ShiftStaff, type VangLoai } from "@/lib/attendance/shift"

type Choice = { vang_loai: VangLoai; ly_do_id: string; ly_do: string }

export type SubmitMeta = { dayChuyen: string; ca: string; ngay: string; maPhieu: string }

function fmtNgay(iso: string) {
  const [y, m, d] = iso.split("-")
  return d && m && y ? `${d}/${m}/${y}` : iso
}

export function SubmitReview({
  lang,
  T,
  absentLines,
  allLines,
  jobById,
  meta,
  unassigned,
  skipUnassignedDefault = false,
  staffById,
  reasons,
  busy,
  onAddReason,
  onBack,
  onConfirm,
}: {
  lang: AttLang
  T: (key: string, vars?: Record<string, string | number>) => string
  absentLines: SheetLineDraft[]
  /** Mọi dòng của phiếu ca (để dựng tóm tắt theo việc). */
  allLines: SheetLineDraft[]
  jobById: Map<string, AttendanceJobType>
  meta: SubmitMeta
  unassigned: ShiftStaff[]
  /** Tổ (không phải Ca A/B/C): người chưa giao việc mặc định Bỏ qua (2026-11-25). Ca: mặc định Vắng có phép. */
  skipUnassignedDefault?: boolean
  staffById: Map<string, ShiftStaff>
  reasons: AttendanceAbsenceReason[]
  busy: boolean
  onAddReason: (ten: string) => Promise<AttendanceAbsenceReason | null>
  onBack: () => void
  onConfirm: (lines: SheetLineDraft[]) => void
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>(() => {
    const init: Record<string, Choice> = {}
    for (const l of absentLines) init[l.staff_id] = { vang_loai: l.vang_loai || "co_phep", ly_do_id: l.ly_do_id, ly_do: l.ly_do }
    for (const s of unassigned) init[s.id] = { vang_loai: "co_phep", ly_do_id: "", ly_do: "" }
    return init
  })
  const [skip, setSkip] = useState<Set<string>>(() => (skipUnassignedDefault ? new Set(unassigned.map((s) => s.id)) : new Set()))
  const [newReason, setNewReason] = useState<{ staffId: string; value: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const people = useMemo(
    () => [
      ...absentLines.map((l) => ({ id: l.staff_id, line: l as SheetLineDraft | null })),
      ...unassigned.map((s) => ({ id: s.id, line: null as SheetLineDraft | null })),
    ],
    [absentLines, unassigned],
  )

  const summary = useMemo(() => {
    const present = allLines.filter((l) => l.diem_danh === "co" && l.cong_viec_ids.length > 0)
    const replaced = absentLines.filter((l) => l.thay_the_staff_id || l.thay_the_ten)
    const vangCount = absentLines.length + unassigned.filter((s) => !skip.has(s.id)).length
    const byJob = new Map<string, { name: string; b: boolean; note: string }[]>()
    const push = (jobId: string, entry: { name: string; b: boolean; note: string }) => {
      const list = byJob.get(jobId) || []
      list.push(entry)
      byJob.set(jobId, list)
    }
    for (const l of present) {
      const ten = staffById.get(l.staff_id)?.ten || "?"
      for (const j of l.cong_viec_ids) push(j, { name: ten, b: l.xep_loai === "B", note: "" })
    }
    for (const l of replaced) {
      const rep = l.thay_the_staff_id ? staffById.get(l.thay_the_staff_id)?.ten || "?" : `${l.thay_the_ten} (${T("tam")})`
      const ten = staffById.get(l.staff_id)?.ten || "?"
      for (const j of l.cong_viec_ids) push(j, { name: rep, b: false, note: T("thayCho", { ten }) })
    }
    const rows = Array.from(byJob.entries())
      .map(([jobId, people]) => ({ job: jobById.get(jobId), jobId, people }))
      .sort((a, b) => (a.job?.sort_order ?? 9999) - (b.job?.sort_order ?? 9999) || (a.job?.ten || "").localeCompare(b.job?.ten || "", "vi"))
    return { coCount: present.length, vangCount, thayCount: replaced.length, rows }
  }, [allLines, absentLines, unassigned, skip, staffById, jobById, T])

  const patch = (id: string, p: Partial<Choice>) => setChoices((c) => ({ ...c, [id]: { ...c[id], ...p } }))

  const confirm = () => {
    setErr(null)
    const out: SheetLineDraft[] = []
    for (const p of people) {
      if (!p.line && skip.has(p.id)) continue
      const c = choices[p.id]
      if (c.vang_loai === "khong_phep" && !c.ly_do_id && !c.ly_do.trim()) {
        setErr(T("thieuLyDo", { ten: staffById.get(p.id)?.ten || "?" }))
        return
      }
      const base = p.line ?? emptyLine({ staff_id: p.id, diem_danh: "vang" })
      out.push({
        ...base,
        diem_danh: "vang",
        vang_loai: c.vang_loai,
        ly_do_id: c.vang_loai === "khong_phep" ? c.ly_do_id : "",
        ly_do: c.vang_loai === "khong_phep" ? c.ly_do : "",
      })
    }
    onConfirm(out)
  }

  const addReason = async () => {
    if (!newReason) return
    const r = await onAddReason(newReason.value.trim())
    if (r) {
      patch(newReason.staffId, { ly_do_id: r.id, ly_do: r.ten })
      setNewReason(null)
    }
  }

  const row = (id: string, line: SheetLineDraft | null) => {
    const s = staffById.get(id)
    const c = choices[id]
    const skipped = !line && skip.has(id)
    const replacement = line?.thay_the_staff_id ? staffById.get(line.thay_the_staff_id)?.ten : line?.thay_the_ten
    return (
      <div key={id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <GenderIcon gioiTinh={s?.gioi_tinh} size={28} muted={skipped} />
          <div className="min-w-0 flex-1">
            <div className={`truncate text-sm font-bold ${skipped ? "text-slate-400 line-through" : "text-slate-800"}`}>{s?.ten || "?"}</div>
            {replacement ? <div className="truncate text-xs font-semibold text-rose-600">→ {replacement}</div> : null}
          </div>
          {!line ? (
            <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs font-bold">
              <button type="button" onClick={() => setSkip((p) => { const n = new Set(p); n.delete(id); return n })} className={`px-2.5 py-1.5 ${!skipped ? "bg-rose-600 text-white" : "text-slate-500"}`}>
                {T("danhVang")}
              </button>
              <button type="button" onClick={() => setSkip((p) => new Set(p).add(id))} className={`px-2.5 py-1.5 ${skipped ? "bg-slate-600 text-white" : "text-slate-500"}`}>
                {T("boQua")}
              </button>
            </div>
          ) : null}
        </div>
        {!skipped ? (
          <>
            <div className="flex gap-2">
              {(["co_phep", "khong_phep"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patch(id, { vang_loai: v })}
                  className={`flex-1 rounded-lg border py-2 text-sm font-bold ${c.vang_loai === v ? (v === "co_phep" ? "border-sky-600 bg-sky-50 text-sky-700" : "border-rose-600 bg-rose-50 text-rose-700") : "border-slate-200 text-slate-500"}`}
                >
                  {T(v === "co_phep" ? "coPhep" : "khongPhep")}
                </button>
              ))}
            </div>
            {c.vang_loai === "khong_phep" ? (
              newReason?.staffId === id ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newReason.value}
                    onChange={(e) => setNewReason({ staffId: id, value: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                    placeholder={T("lyDo")}
                  />
                  <button type="button" onClick={() => void addReason()} className="rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white">
                    <Plus size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={c.ly_do_id}
                    onChange={(e) => {
                      const r = reasons.find((x) => x.id === e.target.value)
                      patch(id, { ly_do_id: e.target.value, ly_do: r?.ten || "" })
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
                  >
                    <option value="">— {T("lyDo")} —</option>
                    {reasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {bilingual(lang, r.ten, r.ten_khmer)}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setNewReason({ staffId: id, value: "" })} className="whitespace-nowrap rounded-lg border border-slate-300 px-2 text-xs font-bold text-slate-600">
                    {T("themLyDo")}
                  </button>
                </div>
              )
            ) : null}
          </>
        ) : null}
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-50">
      <div className="flex items-center gap-2 bg-gradient-to-r from-[#1c3a32] to-[#2f5d52] px-3 py-3 text-white">
        <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-lg bg-white/15 px-2 py-1.5 text-xs font-bold">
          <ArrowLeft size={14} /> {T("quayLaiGiao")}
        </button>
        <div className="flex-1 truncate text-base font-bold">{T("ktTruocGui")}</div>
      </div>
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="text-sm font-bold text-slate-700">{T("tomTatPhieu")}</h3>
            <span className="text-xs font-semibold text-slate-500">
              {meta.dayChuyen} · {T("ca")} {meta.ca} · {fmtNgay(meta.ngay)}
              {meta.maPhieu ? ` · ${meta.maPhieu}` : ""}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-emerald-50 py-2">
              <div className="text-lg font-black text-emerald-700">{summary.coCount}</div>
              <div className="text-[11px] font-bold text-emerald-700">{T("coMat")}</div>
            </div>
            <div className="rounded-lg bg-rose-50 py-2">
              <div className="text-lg font-black text-rose-700">{summary.vangCount}</div>
              <div className="text-[11px] font-bold text-rose-700">{T("vang")}</div>
            </div>
            <div className="rounded-lg bg-violet-50 py-2">
              <div className="text-lg font-black text-violet-700">{summary.thayCount}</div>
              <div className="text-[11px] font-bold text-violet-700">{T("nguoiThay")}</div>
            </div>
          </div>
          {summary.rows.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {summary.rows.map((r) => (
                    <tr key={r.jobId} className="align-top">
                      <td className="w-2/5 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-600">
                        {r.job ? bilingual(lang, r.job.ten, r.job.ten_khmer) : "?"}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {r.people.map((p, i) => (
                          <div key={i} className="leading-snug text-slate-700">
                            <span className="font-semibold">{p.name}</span>
                            {p.b ? <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] font-black text-amber-700">B</span> : null}
                            {p.note ? <span className="ml-1 text-xs text-violet-600">{p.note}</span> : null}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {absentLines.length === 0 && unassigned.length === 0 ? (
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs font-bold text-emerald-700">
              <CheckCircle2 size={14} /> {T("khongVangChuaGiao")}
            </div>
          ) : null}
          <p className="text-xs text-slate-500">{T("xacNhanGui")}</p>
        </section>
        {absentLines.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-600">{T("dsVang", { n: absentLines.length })}</h3>
            {absentLines.map((l) => row(l.staff_id, l))}
          </section>
        ) : null}
        {unassigned.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-600">{T("dsChuaGiao", { n: unassigned.length })}</h3>
            <p className="text-xs text-slate-500">{T("chuaGiaoHint")}</p>
            {unassigned.map((s) => row(s.id, null))}
          </section>
        ) : null}
        {err ? <div className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{err}</div> : null}
      </div>
      <div className="border-t border-slate-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="mx-auto flex w-full max-w-2xl items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-base font-bold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {T("xacNhanGuiBtn")}
        </button>
      </div>
    </div>,
    document.body,
  )
}
