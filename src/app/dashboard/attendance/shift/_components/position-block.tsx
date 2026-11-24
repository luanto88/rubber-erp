"use client"

// Khối "Vị trí phụ trách" trên lưới điểm danh (GĐ3 mục 1b): Ca trưởng / Tổ phó ca, Tổ trưởng / Tổ phó tiếp nhận,
// Tổ trưởng / Tổ phó cơ điện – nâng hàng. Mặc định theo hồ sơ nhân sự; chạm ⇒ chọn người khác (tìm nhanh).
// Người giữ vị trí tính có mặt A; người mặc định bị thay ⇒ tự thành vắng (xử lý ở trang).

import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Check, Search, UserCog, X } from "lucide-react"
import { POSITION_KEYS, positionLabelKey, type PositionKey, type SectionPositions, type ShiftStaff } from "@/lib/attendance/shift"
import { matchesSearchQuery } from "@/lib/text-normalize"

export function PositionBlock({
  T,
  unitLoai,
  positions,
  staffById,
  candidates,
  readOnly,
  onChange,
}: {
  T: (key: string, vars?: Record<string, string | number>) => string
  /** "ca" ⇒ Ca trưởng / Ca phó; "to" ⇒ Tổ trưởng / Tổ phó. */
  unitLoai: "ca" | "to" | null
  positions: SectionPositions
  staffById: Map<string, ShiftStaff>
  /** Người chọn được (đang làm việc, đã xác nhận). */
  candidates: ShiftStaff[]
  readOnly: boolean
  onChange: (key: PositionKey, staffId: string | null) => void
}) {
  const [open, setOpen] = useState(true)
  const [picking, setPicking] = useState<PositionKey | null>(null)
  const name = (id: string | null | undefined) => (id ? staffById.get(id)?.ten || "?" : "")

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-slate-700">
        <UserCog size={16} className="text-emerald-600" />
        <span className="flex-1">{T("vtTieuDe")}</span>
        <span className="text-xs font-semibold text-slate-400">{open ? T("thuGon") : T("moRong")}</span>
      </button>
      {open ? (
        <div className="grid grid-cols-2 gap-1.5 border-t border-slate-100 p-2">
          {POSITION_KEYS.map((key) => {
            const slot = positions[key]
            const holder = slot?.staff_id || null
            const goc = slot?.goc_staff_id || null
            const replaced = !!holder && !!goc && holder !== goc
            return (
              <button
                key={key}
                type="button"
                disabled={readOnly}
                onClick={() => setPicking(key)}
                className={`rounded-lg border px-2 py-1.5 text-left disabled:cursor-default ${replaced ? "border-violet-300 bg-violet-50" : holder ? "border-emerald-200 bg-emerald-50/50" : "border-dashed border-slate-300 bg-slate-50"}`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">{T(positionLabelKey(key, unitLoai))}</span>
                <span className={`block truncate text-[13px] font-bold ${holder ? "text-slate-800" : "text-slate-400"}`}>{holder ? name(holder) : T("vtTrong")}</span>
                {replaced ? <span className="block truncate text-[10px] font-semibold text-violet-700">{T("vtThayCho", { ten: name(goc) })}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
      {picking ? (
        <PositionPicker
          T={T}
          title={T(positionLabelKey(picking, unitLoai))}
          current={positions[picking]?.staff_id || null}
          goc={positions[picking]?.goc_staff_id || null}
          staffById={staffById}
          candidates={candidates}
          onPick={(id) => {
            onChange(picking, id)
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </div>
  )
}

function PositionPicker({
  T,
  title,
  current,
  goc,
  staffById,
  candidates,
  onPick,
  onClose,
}: {
  T: (key: string, vars?: Record<string, string | number>) => string
  title: string
  current: string | null
  goc: string | null
  staffById: Map<string, ShiftStaff>
  candidates: ShiftStaff[]
  onPick: (id: string | null) => void
  onClose: () => void
}) {
  const [q, setQ] = useState("")
  const list = useMemo(() => candidates.filter((s) => matchesSearchQuery(q, [s.ten])).slice(0, 80), [candidates, q])
  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <UserCog size={18} className="text-emerald-600" />
          <h2 className="flex-1 text-base font-extrabold text-slate-800">{title}</h2>
          <button type="button" onClick={onClose} aria-label={T("close")} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2 border-b border-slate-100 px-4 py-3">
          {goc && goc !== current ? (
            <button type="button" onClick={() => onPick(goc)} className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-left text-sm font-bold text-emerald-700">
              {T("vtVeMacDinh", { ten: staffById.get(goc)?.ten || "?" })}
            </button>
          ) : null}
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-2.5">
            <Search size={15} className="text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T("vtTimNguoi")} className="h-9 flex-1 bg-transparent text-sm outline-none" autoFocus />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${s.id === current ? "bg-emerald-50 font-bold text-emerald-700" : "text-slate-700 hover:bg-slate-50"}`}
            >
              <span className="flex-1 truncate">{s.ten}</span>
              {s.ca_mac_dinh ? <span className="text-[11px] text-slate-400">{T("ca")} {s.ca_mac_dinh}</span> : null}
              {s.id === current ? <Check size={15} /> : null}
            </button>
          ))}
          {list.length === 0 ? <div className="py-6 text-center text-sm text-slate-400">{T("vtKhongThay")}</div> : null}
        </div>
        <div className="border-t border-slate-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => onPick(null)} className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600">
            {T("vtDeTrong")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
