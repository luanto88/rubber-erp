"use client"

// Tấm chọn việc của 1 người (C2 làm lại GĐ2) — trượt từ dưới lên, portal ra document.body (không dính containing block).
// Chọn NHIỀU việc, A / B, xe (khi việc có loại xe), người thay (người trong danh sách hoặc tên gõ tay "(tạm)").
// Có người thay ⇒ người này VẮNG, các việc đã chọn là việc người thay làm. Không có người thay ⇒ CÓ MẶT.

import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Check, UserMinus, UserX, X } from "lucide-react"
import { GenderIcon } from "./gender-icon"
import { bilingual, type AttLang } from "@/lib/attendance/i18n"
import type { AttendanceJobType } from "@/lib/attendance/types"
import { emptyLine, type SheetLineDraft, type ShiftStaff } from "@/lib/attendance/shift"
import { normalizeSearchText } from "@/lib/text-normalize"

export type SheetVehicle = { id: string; code: string | null; name: string | null; vehicle_type: string | null; is_active: boolean | null }

const TO_ORDER = ["tiep_nhan", "co_dien", "ca_san_xuat", "nang_hang"] as const
const TO_KEY: Record<string, string> = { tiep_nhan: "toTiepNhan", co_dien: "toCoDien", ca_san_xuat: "toCaSx", nang_hang: "secNangHang" }

export function JobSheet({
  lang,
  T,
  person,
  line,
  jobs,
  vehicles,
  vehicleByStaff,
  candidates,
  staffById,
  readOnly,
  onApply,
  onClose,
}: {
  lang: AttLang
  T: (key: string, vars?: Record<string, string | number>) => string
  person: ShiftStaff
  line: SheetLineDraft | undefined
  /** Việc của dây chuyền đang điểm danh (đang dùng + việc đã có trên dòng). */
  jobs: AttendanceJobType[]
  vehicles: SheetVehicle[]
  vehicleByStaff: Map<string, string>
  /** Người có thể làm người thay (đã loại chính người này + người đã có trong phiếu). */
  candidates: ShiftStaff[]
  staffById: Map<string, ShiftStaff>
  readOnly: boolean
  /** null = bỏ giao (xoá dòng). */
  onApply: (next: SheetLineDraft | null) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<SheetLineDraft>(() => line ?? emptyLine({ staff_id: person.id }))
  const [search, setSearch] = useState(draft.thay_the_ten || "")

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])
  const hasReplacement = !!(draft.thay_the_staff_id || draft.thay_the_ten)
  const workerId = draft.thay_the_staff_id || (hasReplacement ? "" : person.id)

  const grouped = useMemo(() => {
    const out: { to: string; jobs: AttendanceJobType[] }[] = []
    for (const to of TO_ORDER) {
      const list = jobs.filter((j) => j.to_nhom === to).sort((a, b) => a.sort_order - b.sort_order || a.ten.localeCompare(b.ten, "vi"))
      if (list.length > 0) out.push({ to, jobs: list })
    }
    return out
  }, [jobs])

  const vehicleTypes = useMemo(() => {
    const set = new Set<string>()
    for (const id of draft.cong_viec_ids) {
      const t = jobById.get(id)?.loai_xe
      if (t) set.add(t.trim().toLowerCase())
    }
    return set
  }, [draft.cong_viec_ids, jobById])
  const vehicleOptions = useMemo(() => {
    const active = vehicles.filter((v) => v.is_active !== false || v.id === draft.vehicle_id)
    const match = active.filter((v) => v.vehicle_type && vehicleTypes.has(v.vehicle_type.trim().toLowerCase()))
    return match.length > 0 ? match : active
  }, [vehicles, vehicleTypes, draft.vehicle_id])

  const toggleJob = (id: string) => {
    if (readOnly) return
    setDraft((d) => {
      const on = d.cong_viec_ids.includes(id)
      const ids = on ? d.cong_viec_ids.filter((x) => x !== id) : [...d.cong_viec_ids, id]
      const needsVehicle = ids.some((x) => jobById.get(x)?.loai_xe)
      const vehicle = needsVehicle ? d.vehicle_id || (workerId ? vehicleByStaff.get(workerId) || "" : "") : ""
      return { ...d, cong_viec_ids: ids, vehicle_id: vehicle }
    })
  }

  const pickReplacement = (s: ShiftStaff) => {
    setDraft((d) => {
      const needsVehicle = d.cong_viec_ids.some((x) => jobById.get(x)?.loai_xe)
      return { ...d, thay_the_staff_id: s.id, thay_the_ten: "", vehicle_id: needsVehicle ? vehicleByStaff.get(s.id) || "" : "" }
    })
    setSearch("")
  }
  const useTypedName = () => {
    const ten = search.trim()
    if (ten.length < 2) return
    setDraft((d) => ({ ...d, thay_the_staff_id: "", thay_the_ten: ten }))
  }
  const clearReplacement = () => {
    setDraft((d) => {
      const needsVehicle = d.cong_viec_ids.some((x) => jobById.get(x)?.loai_xe)
      return { ...d, thay_the_staff_id: "", thay_the_ten: "", vehicle_id: needsVehicle ? vehicleByStaff.get(person.id) || "" : "" }
    })
    setSearch("")
  }

  const matches = useMemo(() => {
    const q = normalizeSearchText(search)
    if (!q) return []
    return candidates.filter((s) => normalizeSearchText(s.ten).includes(q)).slice(0, 8)
  }, [search, candidates])
  const exactMatch = matches.some((s) => normalizeSearchText(s.ten) === normalizeSearchText(search))

  const done = () => {
    if (hasReplacement) {
      onApply({ ...draft, diem_danh: "vang", vang_loai: line?.diem_danh === "vang" ? line.vang_loai : "" })
      return
    }
    if (draft.cong_viec_ids.length === 0) {
      onApply(null)
      return
    }
    onApply({ ...draft, diem_danh: "co", vang_loai: "", ly_do_id: "", ly_do: "" })
  }

  const absentNoReplacement = () => {
    onApply({
      ...draft,
      diem_danh: "vang",
      cong_viec_ids: [],
      vehicle_id: "",
      thay_the_staff_id: "",
      thay_the_ten: "",
      vang_loai: line?.diem_danh === "vang" ? line.vang_loai : "",
    })
  }

  const replacementName = draft.thay_the_staff_id ? staffById.get(draft.thay_the_staff_id)?.ten || "?" : draft.thay_the_ten

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45" onClick={onClose}>
      <div
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <GenderIcon gioiTinh={person.gioi_tinh} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold text-slate-800">{person.ten}</div>
            {hasReplacement ? <div className="text-xs font-semibold text-rose-600">{T("vang")} · → {replacementName}</div> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={T("close")}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <section>
            <div className="mb-1.5 text-xs font-bold text-slate-500">{hasReplacement ? T("viecNguoiThay") : T("chonViec")}</div>
            <div className="space-y-2.5">
              {grouped.map((g) => (
                <div key={g.to}>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{T(TO_KEY[g.to])}</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {g.jobs.map((j) => {
                      const on = draft.cong_viec_ids.includes(j.id)
                      return (
                        <button
                          key={j.id}
                          type="button"
                          disabled={readOnly}
                          onClick={() => toggleJob(j.id)}
                          title={bilingual(lang, j.ten, j.ten_khmer)}
                          className={`relative flex min-h-[44px] w-full items-center justify-center rounded-xl border px-3 py-1.5 text-center text-sm font-semibold leading-tight ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                        >
                          {on ? (
                            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-emerald-600">
                              <Check size={11} strokeWidth={3} />
                            </span>
                          ) : null}
                          <span className="line-clamp-2 px-2">{bilingual(lang, j.ten, j.ten_khmer)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {draft.cong_viec_ids.some((x) => jobById.get(x)?.loai_xe) ? (
            <section>
              <div className="mb-1.5 text-xs font-bold text-slate-500">{T("xe")}</div>
              <select
                value={draft.vehicle_id}
                disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, vehicle_id: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
              >
                <option value="">{T("khongXe")}</option>
                {vehicleOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {[v.code, v.name].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </section>
          ) : null}

          {!hasReplacement ? (
            <section>
              <div className="mb-1.5 text-xs font-bold text-slate-500">{T("xepLoai")}</div>
              <div className="grid grid-cols-2 gap-2">
                {(["A", "B"] as const).map((x) => (
                  <button
                    key={x}
                    type="button"
                    disabled={readOnly}
                    onClick={() => setDraft((d) => ({ ...d, xep_loai: x }))}
                    className={`w-full rounded-xl border py-2.5 text-base font-black ${draft.xep_loai === x ? (x === "A" ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-amber-500 bg-amber-50 text-amber-700") : "border-slate-200 text-slate-500"}`}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-1.5 text-xs font-bold text-slate-500">{T("nguoiThay")}</div>
            {hasReplacement ? (
              <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                <span className="flex-1 truncate text-sm font-bold text-rose-700">
                  → {replacementName}
                  {draft.thay_the_ten ? <span className="ml-1 font-semibold text-rose-500">({T("tam")})</span> : null}
                </span>
                {!readOnly ? (
                  <button type="button" onClick={clearReplacement} className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-slate-600">
                    {T("boNguoiThay")}
                  </button>
                ) : null}
              </div>
            ) : !readOnly ? (
              <div className="space-y-1.5">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={T("timNguoiThay")}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                />
                {matches.length > 0 ? (
                  <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                    {matches.map((s) => (
                      <button key={s.id} type="button" onClick={() => pickReplacement(s)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <GenderIcon gioiTinh={s.gioi_tinh} size={22} />
                        <span className="flex-1 truncate font-semibold text-slate-700">{s.ten}</span>
                        {s.ca_mac_dinh ? <span className="text-xs text-slate-400">Ca {s.ca_mac_dinh}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                {search.trim().length >= 2 && !exactMatch ? (
                  <button type="button" onClick={useTypedName} className="w-full rounded-xl border border-dashed border-slate-300 px-3 py-2 text-left text-sm font-semibold text-slate-600">
                    {T("dungTenTam", { ten: search.trim() })}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-slate-400">—</div>
            )}
            {hasReplacement ? <p className="mt-1 text-xs text-slate-500">{T("goiYNguoiThay")}</p> : null}
          </section>
        </div>

        {!readOnly ? (
          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={absentNoReplacement} className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-sm font-bold text-rose-700">
              <UserX size={16} /> {T("vangKhongThay")}
            </button>
            <button type="button" onClick={() => onApply(null)} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600">
              <UserMinus size={16} /> {T("boGiao")}
            </button>
            <button type="button" onClick={done} className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3 text-base font-bold text-white">
              <Check size={18} /> {T("xong")}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
