"use client"

// Tấm chọn việc của 1 người (C2 làm lại GĐ2) — trượt từ dưới lên, portal ra document.body (không dính containing block).
// Chọn NHIỀU việc, A / B, xe (khi việc có loại xe), người thay (người trong danh sách hoặc tên gõ tay "(tạm)").
// Có người thay ⇒ người này VẮNG, các việc đã chọn là việc người thay làm. Không có người thay ⇒ CÓ MẶT.
// A4 (2026-11-27) — tổ phân ca (caOptions): 1 hàng [Ca A · B · C · Cả ngày] [Xếp loại A · B]; mỗi ca 1 dòng, việc riêng từng ca.
// Dòng đã gửi (gui_luc) ⇒ khoá việc / xe / bỏ giao (trừ admin), vẫn ghi vắng / người thay / xếp loại nếu được sửa ca đó.

import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Check, Lock, UserMinus, UserX, X } from "lucide-react"
import { GenderIcon } from "./gender-icon"
import { bilingual, type AttLang } from "@/lib/attendance/i18n"
import type { AttendanceJobType } from "@/lib/attendance/types"
import { CA_NGAY, emptyLine, workHoursLabel, workHoursOverlap, type SheetLineDraft, type ShiftStaff } from "@/lib/attendance/shift"
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
  jobPeople,
  workHours = null,
  candidateNote,
  caOptions,
  personLines,
  defaultCa,
  canEditLine,
  canCreateCa,
  ownerName,
  jobName,
  isTo = false,
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
  /** Tên người KHÁC (trong phiếu ca) đang nhận từng việc — hiện số + tên trên thẻ việc. */
  jobPeople?: Map<string, string[]>
  /** A2 — tổ ghi giờ làm: giờ mặc định (theo giờ điểm danh / XLNT 05–05 / cơ khí 05–17); null = đơn vị thường. */
  workHours?: { bd: string; kt: string } | null
  /** Nhãn phụ của ứng viên người thay ("Cùng ca · Phả mủ" / "Ca A"). */
  candidateNote?: (s: ShiftStaff) => string
  /** A4 — tổ phân ca: các ca chọn được (Ca A/B/C + Cả ngày). Không truyền = đơn vị không phân ca. */
  caOptions?: { code: string; label: string }[]
  /** A4 — mọi dòng của người này trong phiếu (mỗi ca 1 dòng). */
  personLines?: SheetLineDraft[]
  /** A4 — ca mặc định khi giao mới (ca của trực ca đang đăng nhập). */
  defaultCa?: string
  /** A4b — người đăng nhập sửa được dòng này không (giữ chỗ theo người giao). Không truyền = sửa được. */
  canEditLine?: (l: SheetLineDraft) => boolean
  /** A4b — tổ phân ca: được giao MỚI cho ca này không (trực ca chỉ ca mình). */
  canCreateCa?: (code: string) => boolean
  /** A4b — tên người giao (lap_boi = id tài khoản). */
  ownerName?: (uid: string) => string
  /** Tên việc (cả việc ngoài danh sách đang chọn) — hiện ở khối "Phân công khác". */
  jobName?: (id: string) => string
  /** Phiếu tổ (giữ chỗ theo người giao). */
  isTo?: boolean
  /** Toàn bộ dòng của người này sau khi sửa ([] = bỏ giao hết). */
  onApply: (lines: SheetLineDraft[]) => void
  onClose: () => void
}) {
  const isKhung = !!workHours
  const phanCa = !!caOptions && caOptions.length > 0
  const hasContent = (d: SheetLineDraft | undefined) => !!d && (d.diem_danh === "vang" || d.cong_viec_ids.length > 0)
  const can = (l: SheetLineDraft) => (canEditLine ? canEditLine(l) : true)
  /** Tổ không phân ca: dòng của MÌNH (sửa được) là dòng đang sửa; dòng người khác giao ⇒ "Phân công khác" (chỉ xem, giữ nguyên). */
  const { origByCa, others } = useMemo(() => {
    const m = new Map<string, SheetLineDraft>()
    const rest: SheetLineDraft[] = []
    if (phanCa) for (const l of personLines || []) m.set(l.ca_phan_cong, l)
    else if (isTo) {
      for (const l of personLines || []) {
        if (!m.has("") && (canEditLine ? canEditLine(l) : true)) m.set("", l)
        else rest.push(l)
      }
    } else if (line) m.set("", line)
    return { origByCa: m, others: rest }
  }, [phanCa, isTo, personLines, line, canEditLine])
  /** Ca chọn sẵn khi mở: các ca người này đang có dòng; chưa có ⇒ ca của trực ca đang đăng nhập. */
  const initialSel = (): string[] => {
    if (!phanCa) return [""]
    const own = (personLines || []).filter((l) => l.ca_phan_cong && hasContent(l)).map((l) => l.ca_phan_cong)
    if (own.length > 0) return Array.from(new Set(own))
    return defaultCa && caOptions!.some((o) => o.code === defaultCa) ? [defaultCa] : []
  }
  /** Gộp dòng cũ CHƯA CÓ CA (trước A4) vào ca `target`: giữ id dòng cũ nếu ca đó chưa có dòng, có rồi thì gộp việc. */
  const absorbLegacy = (all: Record<string, SheetLineDraft>, target: string): Record<string, SheetLineDraft> => {
    const legacy = all[""]
    if (!phanCa || !legacy || !target) return all
    const next = { ...all }
    delete next[""]
    const cur = next[target]
    if (!cur) next[target] = { ...legacy, ca_phan_cong: target }
    else next[target] = { ...cur, cong_viec_ids: Array.from(new Set([...cur.cong_viec_ids, ...legacy.cong_viec_ids])) }
    return next
  }
  const [selCas, setSelCas] = useState<string[]>(initialSel)
  const [drafts, setDrafts] = useState<Record<string, SheetLineDraft>>(() => {
    const base = Object.fromEntries(origByCa) as Record<string, SheetLineDraft>
    const sel = initialSel()
    return sel[0] ? absorbLegacy(base, sel[0]) : base
  })
  /** Ca chính (hiển thị việc / người thay): ca chọn đầu tiên. */
  const curCa = phanCa ? selCas[0] || "" : ""
  const blank = (ca: string) => emptyLine({ staff_id: person.id, ca_phan_cong: ca })
  const draft: SheetLineDraft = drafts[curCa] ?? blank(curCa)
  /** Ca / dòng sửa được: dòng đã có ⇒ theo giữ chỗ; ca mới ⇒ quyền giao ca đó. */
  const editableCa = (c: string) => {
    const o = origByCa.get(c)
    if (o) return can(o)
    return !phanCa || (!!c && (canCreateCa ? canCreateCa(c) : true))
  }
  const isLockedDraft = (d: SheetLineDraft | undefined) => !!d && !editableCa(phanCa ? d.ca_phan_cong : "")
  /** Ca đang chọn mà sửa được (việc, xe, xếp loại, vắng, người thay — giữ chỗ: sửa được là sửa hết). */
  const attCas = phanCa ? selCas.filter(editableCa) : editableCa("") ? [""] : []
  const jobCas = attCas
  const lineLocked = phanCa ? selCas.some((c) => !editableCa(c)) : !editableCa("")
  const caAllowed = !phanCa || attCas.length > 0
  const [err, setErr] = useState<string | null>(null)
  /** Sửa việc / xe / bỏ giao. */
  const jobsReadOnly = readOnly || jobCas.length === 0
  /** Sửa xếp loại / vắng / người thay. */
  const attReadOnly = readOnly || attCas.length === 0
  /** Áp 1 thay đổi cho mọi ca đang chọn trong `cas` (đơn vị không phân ca: 1 dòng). */
  const updateCas = (cas: string[], fn: (d: SheetLineDraft) => SheetLineDraft) =>
    setDrafts((all) => {
      const next = { ...all }
      for (const c of cas) next[c] = fn(next[c] ?? blank(c))
      return next
    })
  const setDraft = (fn: (d: SheetLineDraft) => SheetLineDraft) => updateCas(attCas, fn)
  const caDisabled = (code: string) => {
    if (selCas.includes(code)) return false
    // Cả ngày không đi chung ca khác: chỉ chặn khi ca kia đã GỬI (khoá) — chưa khoá thì bấm sẽ chuyển việc sang.
    const lockedOthers = Object.entries(drafts).filter(([k, d]) => k && k !== code && hasContent(d) && isLockedDraft(d))
    if (code === CA_NGAY) return lockedOthers.length > 0
    return lockedOthers.some(([k]) => k === CA_NGAY)
  }
  /** Chạm chip Ca: chọn / bỏ chọn (chọn nhiều). Cả ngày loại trừ Ca A/B/C (chuyển việc sang ca vừa chọn). */
  const toggleCa = (code: string) => {
    if (readOnly) return
    if (selCas.includes(code)) {
      setSelCas(selCas.filter((c) => c !== code))
      return
    }
    setDrafts((all0) => {
      let all = absorbLegacy(all0, code)
      const src = all[curCa] ?? all[code]
      const copyOf = (ca: string): SheetLineDraft =>
        src && src !== all[ca]
          ? { ...src, id: emptyLine().id, ca_phan_cong: ca, gui_luc: "", lap_boi: "", gui_boi: "", chot_ca: false }
          : all[ca] ?? blank(ca)
      const exclusive = code === CA_NGAY ? (k: string) => k !== CA_NGAY : (k: string) => k === CA_NGAY
      const movable = Object.keys(all).filter((k) => k && exclusive(k) && hasContent(all[k]) && !isLockedDraft(all[k]))
      if (movable.length > 0) {
        // Cả ngày ↔ Ca A/B/C: chuyển việc của ca bị loại sang ca vừa chọn, bỏ dòng cũ (chưa gửi).
        const from = all[movable[0]]
        const next = { ...all }
        for (const k of movable) delete next[k]
        next[code] = all[code] ?? { ...from, ca_phan_cong: code }
        all = next
      } else if (!all[code]) {
        all = { ...all, [code]: copyOf(code) }
      }
      return all
    })
    setSelCas((prev) => {
      const excl = code === CA_NGAY ? prev.filter((c) => c === CA_NGAY) : prev.filter((c) => c !== CA_NGAY)
      return [...excl, code]
    })
    setSearch(drafts[code]?.thay_the_ten || "")
  }
  const [search, setSearch] = useState(draft.thay_the_ten || "")

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])
  const hasReplacement = !!(draft.thay_the_staff_id || draft.thay_the_ten)

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

  /** Việc đang tick ở MỌI ca chọn ⇒ "on"; chỉ một số ca ⇒ "part". */
  const jobState = (id: string): "on" | "part" | "off" => {
    const cas = phanCa ? selCas : [""]
    const n = cas.filter((c) => (drafts[c] ?? blank(c)).cong_viec_ids.includes(id)).length
    return n === 0 ? "off" : n === cas.length ? "on" : "part"
  }

  const toggleJob = (id: string) => {
    if (jobsReadOnly) return
    const adding = jobState(id) !== "on"
    updateCas(jobCas, (d) => {
      const has = d.cong_viec_ids.includes(id)
      if (adding === has) return d
      const ids = adding ? [...d.cong_viec_ids, id] : d.cong_viec_ids.filter((x) => x !== id)
      const w = d.thay_the_staff_id || (d.thay_the_ten ? "" : person.id)
      const needsVehicle = ids.some((x) => jobById.get(x)?.loai_xe)
      const vehicle = needsVehicle ? d.vehicle_id || (w ? vehicleByStaff.get(w) || "" : "") : ""
      // A2: có việc mà chưa có giờ làm ⇒ điền giờ mặc định; bỏ hết việc ⇒ xoá giờ.
      const gio =
        ids.length === 0
          ? { gio_bd: "", gio_kt: "" }
          : workHours && (!d.gio_bd || !d.gio_kt)
            ? { gio_bd: d.gio_bd || workHours.bd, gio_kt: d.gio_kt || workHours.kt }
            : {}
      return { ...d, cong_viec_ids: ids, vehicle_id: vehicle, ...gio }
    })
  }
  const setVehicle = (v: string) => updateCas(jobCas, (d) => ({ ...d, vehicle_id: v }))

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

  /** Chuẩn hoá 1 dòng nháp khi đóng tấm: null = bỏ (không việc, không vắng). Dòng đã gửi không bao giờ bị bỏ (server giữ). */
  const finalize = (d: SheetLineDraft, orig: SheetLineDraft | undefined): SheetLineDraft | null => {
    let x = d
    if (isKhung && workHours && x.cong_viec_ids.length > 0 && (!x.gio_bd || !x.gio_kt)) {
      x = { ...x, gio_bd: x.gio_bd || workHours.bd, gio_kt: x.gio_kt || workHours.kt }
    }
    const rep = !!(x.thay_the_staff_id || x.thay_the_ten)
    if (rep) return { ...x, diem_danh: "vang", vang_loai: x.diem_danh === "vang" ? x.vang_loai : orig?.diem_danh === "vang" ? orig.vang_loai : "" }
    if (x.diem_danh === "vang" && x.cong_viec_ids.length === 0) return x
    if (x.cong_viec_ids.length === 0) return null
    return { ...x, diem_danh: "co", vang_loai: "", ly_do_id: "", ly_do: "" }
  }
  /** Gửi lên trang chính MỌI dòng của người này. `overrides`: ca ⇒ dòng thay thế (null = bỏ). */
  const applyAll = (overrides: Record<string, SheetLineDraft | null> = {}) => {
    const out: SheetLineDraft[] = []
    const keys = new Set([...Object.keys(drafts), ...Object.keys(overrides)])
    for (const k of keys) {
      if (k in overrides) {
        if (overrides[k]) out.push(overrides[k]!)
        continue
      }
      const d = drafts[k]
      if (!d) continue
      const orig = origByCa.get(k)
      // Dòng không sửa được (người khác giao / đã chốt) ⇒ giữ nguyên bản gốc.
      if (orig && !can(orig)) {
        out.push(orig)
        continue
      }
      const f = finalize(d, orig)
      if (f) out.push(phanCa ? { ...f, ca_phan_cong: k } : f)
    }
    onApply([...out, ...others])
  }

  /** Tổ phân ca: còn dòng cũ chưa có ca mà chưa chọn ca nào ⇒ chưa cho xong. */
  const needCa = phanCa && selCas.length === 0 && (hasContent(drafts[""]) || hasContent(drafts[curCa]))
  const done = () => {
    if (needCa) return
    // Tổ ghi giờ: phân công của mình không được trùng giờ với phân công người khác giao cho cùng người.
    if (isKhung && !phanCa && others.length > 0) {
      const mine = drafts[""]
      const hit = mine && mine.cong_viec_ids.length > 0 ? others.find((o) => o.cong_viec_ids.length > 0 && workHoursOverlap(mine, o)) : undefined
      if (hit) {
        setErr(T("trungGioPhanCong", { ten: ownerName?.(hit.lap_boi) || "?", gio: workHoursLabel(hit.gio_bd, hit.gio_kt) }))
        return
      }
    }
    applyAll()
  }

  const absentNoReplacement = () => {
    const o: Record<string, SheetLineDraft | null> = {}
    for (const c of attCas) {
      const d = drafts[c] ?? blank(c)
      const orig = origByCa.get(c)
      o[c] = {
        ...d,
        diem_danh: "vang",
        cong_viec_ids: [],
        gio_bd: "",
        gio_kt: "",
        vehicle_id: "",
        thay_the_staff_id: "",
        thay_the_ten: "",
        ca_phan_cong: c,
        vang_loai: orig?.diem_danh === "vang" ? orig.vang_loai : "",
      }
    }
    applyAll(o)
  }
  const removeCurrent = () => applyAll(Object.fromEntries(jobCas.map((c) => [c, null])))

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
          {phanCa ? (
            // A4 — 1 hàng: Ca (trái, chọn nhiều) ↔ Xếp loại (phải); hẹp thì xuống dòng, không cắt chữ.
            <section className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex min-w-[14rem] flex-[3_1_0%] items-center gap-1">
                  <span className="shrink-0 text-xs font-bold text-slate-500">{T("caLam")}:</span>
                  {caOptions!.map((o) => {
                    const d = drafts[o.code]
                    const on = selCas.includes(o.code)
                    const used = hasContent(d)
                    const locked = !!d?.gui_luc
                    return (
                      <button
                        key={o.code}
                        type="button"
                        disabled={readOnly || caDisabled(o.code)}
                        aria-pressed={on}
                        onClick={() => toggleCa(o.code)}
                        className={`flex h-9 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-1.5 text-xs font-bold disabled:opacity-35 ${on ? "border-sky-600 bg-sky-600 text-white" : used ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-300 bg-white text-slate-600"}`}
                      >
                        {on ? <Check size={11} strokeWidth={3} /> : null}
                        {locked ? <Lock size={10} strokeWidth={2.75} /> : null}
                        {o.label}
                        {used && !on ? <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> : null}
                      </button>
                    )
                  })}
                </div>
                {selCas.length > 0 && !hasReplacement ? (
                  <div className="flex min-w-[9rem] flex-[1_1_0%] items-center gap-1">
                    <span className="shrink-0 text-xs font-bold text-slate-500">{T("xepLoai")}:</span>
                    {(["A", "B"] as const).map((x) => (
                      <button
                        key={x}
                        type="button"
                        disabled={attReadOnly}
                        onClick={() => setDraft((dd) => ({ ...dd, xep_loai: x }))}
                        className={`h-9 min-w-0 flex-1 rounded-lg border text-sm font-black ${draft.xep_loai === x ? (x === "A" ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-amber-500 bg-amber-50 text-amber-700") : "border-slate-200 text-slate-500"}`}
                      >
                        {x}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {selCas.length === 0 ? <div className="text-xs font-semibold text-orange-600">{T("chonCaTruoc")}</div> : null}
              {selCas.length > 0 && !caAllowed ? <div className="text-xs font-semibold text-slate-500">{T("caKhacChiXem")}</div> : null}
            </section>
          ) : null}
          {others.length > 0 ? (
            // A4b — phân công người khác giao cho người này (giữ chỗ): chỉ xem.
            <section className="space-y-1.5">
              <div className="text-xs font-bold text-slate-500">{T("phanCongKhac")}</div>
              {others.map((o) => {
                const rep2 = o.thay_the_staff_id ? staffById.get(o.thay_the_staff_id)?.ten || "?" : o.thay_the_ten
                return (
                  <div key={o.id} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    <Lock size={12} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="font-bold text-slate-600">{T("nguoiGiao", { ten: ownerName?.(o.lap_boi) || "?" })}</div>
                      <div className="break-words">
                        {o.diem_danh === "vang" ? `${T("vang")}${rep2 ? ` → ${rep2}` : ""}` : o.cong_viec_ids.map((j) => jobName?.(j) || "?").join(", ")}
                        {o.gio_bd && o.gio_kt ? ` · ${workHoursLabel(o.gio_bd, o.gio_kt)}` : ""}
                        {o.diem_danh === "co" ? ` · ${o.xep_loai}` : ""}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-1.5 text-[10px] font-bold ${o.gui_luc ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>
                      {o.gui_luc ? T("daGuiNgan") : T("chuaGuiNgan")}
                    </span>
                  </div>
                )
              })}
              {!phanCa && editableCa("") ? <div className="text-[11px] text-slate-500">{T("themPhanCongRieng")}</div> : null}
            </section>
          ) : null}
          {lineLocked ? (
            <div className="flex items-start gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              <Lock size={13} className="mt-0.5 shrink-0" /> {T("phanCongKhongSua")}
            </div>
          ) : null}
          <section className={phanCa && selCas.length === 0 ? "pointer-events-none opacity-40" : undefined}>
                <div className="mb-1.5 text-xs font-bold text-slate-500">{hasReplacement ? T("viecNguoiThay") : T("chonViec")}</div>
                <div className="space-y-2.5">
                  {grouped.map((g) => (
                    <div key={g.to}>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{T(TO_KEY[g.to])}</div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {g.jobs.map((j) => {
                          const st = jobState(j.id)
                          const on = st === "on"
                          const others = jobPeople?.get(j.id) || []
                          const names = on ? [person.ten, ...others] : others
                          const n = names.length
                          const shortNames = n > 2 ? `${names.slice(0, 2).join(", ")} +${n - 2}` : names.join(", ")
                          return (
                            <button
                              key={j.id}
                              type="button"
                              disabled={jobsReadOnly}
                              onClick={() => toggleJob(j.id)}
                              title={[bilingual(lang, j.ten, j.ten_khmer), ...names].join("\n")}
                              className={`relative flex min-h-[44px] w-full flex-col items-center justify-center rounded-xl border px-3 py-1.5 text-center text-sm font-semibold leading-tight ${on ? "border-emerald-600 bg-emerald-600 text-white" : st === "part" ? "border-emerald-500 border-dashed bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"} ${jobsReadOnly && !on ? "opacity-50" : ""}`}
                            >
                              {n > 0 ? (
                                <span className={`absolute left-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-black ${on ? "bg-white text-emerald-700" : "bg-emerald-100 text-emerald-700"}`} title={T("soNguoiViec", { n })}>
                                  {n}
                                </span>
                              ) : null}
                              {on ? (
                                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-emerald-600">
                                  <Check size={11} strokeWidth={3} />
                                </span>
                              ) : null}
                              <span className="line-clamp-2 px-2">{bilingual(lang, j.ten, j.ten_khmer)}</span>
                              {n > 0 ? (
                                <span className={`mt-0.5 block w-full truncate px-2 text-[10px] font-medium ${on ? "text-emerald-50" : "text-slate-500"}`}>{shortNames}</span>
                              ) : null}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
          </section>

          {isKhung && draft.cong_viec_ids.length > 0 ? (
            // A2 — giờ làm của người (tự điền theo giờ điểm danh / XLNT 05–05 / cơ khí 05–17), sửa được.
            <section>
              <div className="mb-1.5 text-xs font-bold text-slate-500">{T("gioLam")}</div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={draft.gio_bd}
                  disabled={jobsReadOnly}
                  onChange={(e) => setDraft((d) => ({ ...d, gio_bd: e.target.value }))}
                  aria-label={T("tuGio")}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base"
                />
                <span className="text-slate-400">–</span>
                <input
                  type="time"
                  value={draft.gio_kt}
                  disabled={jobsReadOnly}
                  onChange={(e) => setDraft((d) => ({ ...d, gio_kt: e.target.value }))}
                  aria-label={T("denGio")}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base"
                />
              </div>
            </section>
          ) : null}

          {draft.cong_viec_ids.some((x) => jobById.get(x)?.loai_xe) ? (
            <section>
              <div className="mb-1.5 text-xs font-bold text-slate-500">{T("xe")}</div>
              <select
                value={draft.vehicle_id}
                disabled={jobsReadOnly}
                onChange={(e) => setVehicle(e.target.value)}
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

          {!hasReplacement && !phanCa ? (
            <section>
              <div className="mb-1.5 text-xs font-bold text-slate-500">{T("xepLoai")}</div>
              <div className="grid grid-cols-2 gap-2">
                {(["A", "B"] as const).map((x) => (
                  <button
                    key={x}
                    type="button"
                    disabled={attReadOnly}
                    onClick={() => setDraft((d) => ({ ...d, xep_loai: x }))}
                    className={`w-full rounded-xl border py-2.5 text-base font-black ${draft.xep_loai === x ? (x === "A" ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-amber-500 bg-amber-50 text-amber-700") : "border-slate-200 text-slate-500"}`}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className={phanCa && selCas.length === 0 ? "pointer-events-none opacity-40" : undefined}>
            <div className="mb-1.5 text-xs font-bold text-slate-500">{T("nguoiThay")}</div>
            {hasReplacement ? (
              <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                <span className="flex-1 truncate text-sm font-bold text-rose-700">
                  → {replacementName}
                  {draft.thay_the_ten ? <span className="ml-1 font-semibold text-rose-500">({T("tam")})</span> : null}
                </span>
                {!attReadOnly ? (
                  <button type="button" onClick={clearReplacement} className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-slate-600">
                    {T("boNguoiThay")}
                  </button>
                ) : null}
              </div>
            ) : !attReadOnly ? (
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
                        {candidateNote ? (
                          <span className="max-w-[45%] truncate text-xs text-slate-400">{candidateNote(s)}</span>
                        ) : s.ca_mac_dinh ? (
                          <span className="text-xs text-slate-400">{s.ca_mac_dinh}</span>
                        ) : null}
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

        {err ? <div className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">{err}</div> : null}
        {!readOnly ? (
          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={absentNoReplacement} disabled={attReadOnly} className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-sm font-bold text-rose-700 disabled:opacity-40">
              <UserX size={16} /> {T("vangKhongThay")}
            </button>
            <button type="button" onClick={removeCurrent} disabled={jobsReadOnly} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 disabled:opacity-40">
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
