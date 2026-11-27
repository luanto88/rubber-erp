"use client"

// A3 — khung "Sơ đồ dây chuyền" Mủ tạp dưới lưới thẻ người (bố cục theo cung_cap_dl/so_sanh_bo_cuc_diem_danh_mobile.html).
// Điện thoại: chạm ô ⇒ tấm chọn người; chạm tên trong ô ⇒ chọn để chuyển, chạm ô khác ⇒ chuyển. Máy tính: kéo-thả thêm.
// Component chỉ hiển thị + phát sự kiện; quyền / ghi phiếu do màn điểm danh xử lý.

import { useRef, useState } from "react"
import { Loader2, Lock, X } from "lucide-react"
import {
  CA_BANDS,
  STATION_LABEL,
  TN_BAND,
  TRUC_STATIONS,
  type DiagramCell,
  type DiagramModel,
  type DiagramPerson,
  type StationKey,
} from "@/lib/attendance/diagram"
import { bilingual, type AttLang } from "@/lib/attendance/i18n"
import { genderKind } from "./gender-icon"
import { StationIcon } from "./diagram-icons"

export type DiagramDragPayload = { type: "person"; key: string } | { type: "staff"; staffId: string }
export const DIAGRAM_DND_TYPE = "application/x-attendance-diagram"

export function readDiagramDrag(e: React.DragEvent): DiagramDragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DIAGRAM_DND_TYPE) || e.dataTransfer.getData("text/plain")
    const v = JSON.parse(raw) as DiagramDragPayload
    return v && (v.type === "person" || v.type === "staff") ? v : null
  } catch {
    return null
  }
}

export function setDiagramDrag(e: React.DragEvent, payload: DiagramDragPayload) {
  const raw = JSON.stringify(payload)
  e.dataTransfer.setData(DIAGRAM_DND_TYPE, raw)
  e.dataTransfer.setData("text/plain", raw)
  e.dataTransfer.effectAllowed = "move"
}

type Props = {
  lang: AttLang
  T: (key: string, vars?: Record<string, string | number>) => string
  model: DiagramModel
  chipOptions: { code: string; label: string; star: boolean }[]
  chipCa: string
  onChipCa: (code: string) => void
  /** Nhãn khối tiếp nhận (tên Tổ tiếp nhận mủ tạp, song ngữ). */
  tnTitle: string
  caTitle: string
  selected: DiagramPerson | null
  onSelect: (p: DiagramPerson | null) => void
  canEdit: (cell: DiagramCell) => boolean
  onCellTap: (cell: DiagramCell) => void
  onDrop: (cell: DiagramCell, payload: DiagramDragPayload) => void
  /** Gỡ người khỏi ô (dấu X trên tên / kéo tên thả ra khoảng trống của khung). */
  onRemove: (p: DiagramPerson) => void
  vehicleCode: (id: string) => string
  busyText: string | null
}

export function LineDiagram(props: Props) {
  const { lang, T, model, chipOptions, chipCa, onChipCa, tnTitle, caTitle, selected, onSelect, busyText, onRemove } = props
  // Kéo tên ra khoảng trống (không phải ô) ⇒ gỡ khỏi ô. Ô tự chặn lan sự kiện kéo nên dragover ở khung chỉ đến từ khoảng trống;
  // dragover bắn liên tục ⇒ tắt viền sau 150 ms không còn sự kiện.
  const [outOver, setOutOver] = useState(false)
  const outTimer = useRef<number | null>(null)
  const findPerson = (key: string) =>
    [...Object.values(model.cells).flatMap((c) => c.people), ...model.others.flatMap((o) => o.people)].find((x) => x.key === key)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOutOver(true)
        if (outTimer.current) window.clearTimeout(outTimer.current)
        outTimer.current = window.setTimeout(() => setOutOver(false), 150)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOutOver(false)
        const payload = readDiagramDrag(e)
        const p = payload?.type === "person" ? findPerson(payload.key) : undefined
        if (p) onRemove(p)
      }}
      className={`relative space-y-2 rounded-2xl border bg-white p-2.5 shadow-sm ${outOver ? "border-rose-300 ring-2 ring-rose-200" : "border-slate-200"}`}
    >
      {outOver ? (
        <div className="pointer-events-none sticky top-1 z-10 mx-auto w-fit rounded-full bg-rose-600 px-3 py-1 text-[11px] font-bold text-white shadow">{T("sdThaDeGo")}</div>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-1 pb-2">
        <span className="text-[13px] font-bold text-slate-700">{T("sdTitle")}</span>
        <div className="inline-flex shrink-0 rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-[12px] font-semibold">
          {chipOptions.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => onChipCa(c.code)}
              className={`whitespace-nowrap rounded-lg px-3 py-1 ${chipCa === c.code ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600"}`}
            >
              {c.label}
              {c.star ? " ★" : ""}
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[12px] font-semibold text-amber-900">
          <span className="flex-1">{T("sdDangChon", { ten: selected.name })}</span>
          <button type="button" onClick={() => onSelect(null)} className="rounded p-1 text-amber-700" aria-label={T("close")}>
            <X size={14} />
          </button>
        </div>
      ) : null}
      {busyText ? (
        <div className="flex items-center gap-2 px-1 text-[12px] font-semibold text-sky-700">
          <Loader2 size={13} className="animate-spin" /> {busyText}
        </div>
      ) : null}
      {model.noWindowForCa ? (
        <div className="px-1 text-[11px] font-medium text-slate-500">{T("sdChuaKien", { ca: chipOptions.find((c) => c.code === chipCa)?.label || chipCa })}</div>
      ) : null}

      {/* 1. Trực & hỗ trợ */}
      <div className="border-b border-slate-200 pb-2">
        <div className="mb-1 px-1 text-[12px] font-bold text-slate-600">{T("sdTrucHoTro")}</div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {TRUC_STATIONS.map((k) => (
            <StationNode key={k} {...props} cell={model.cells[k]} />
          ))}
        </div>
      </div>

      {/* 2. Tiếp nhận mủ tạp */}
      <div className="border-b border-slate-200 pb-1">
        <div className="mb-1 px-1 text-[12px] font-bold text-slate-600">{tnTitle}</div>
        <Band {...props} keys={TN_BAND} dir="right" />
        <CurvedArrow kind="right-down" />
      </div>

      {/* 3. Ca sản xuất */}
      <div className="space-y-0.5">
        <div className="px-1 text-[12px] font-bold text-slate-600">{caTitle}</div>
        <Band {...props} keys={CA_BANDS[0].keys} dir="right" />
        <CurvedArrow kind="left-down-right" />
        <Band {...props} keys={CA_BANDS[1].keys} dir="right" />
        <CurvedArrow kind="right-down-left" />
        <Band {...props} keys={CA_BANDS[2].keys} dir="left" />
      </div>

      {model.others.length > 0 ? (
        <div className="border-t border-slate-200 pt-2">
          <div className="mb-1 px-1 text-[12px] font-bold text-slate-600">{T("sdViecKhac")}</div>
          <div className="space-y-1.5 px-1">
            {model.others.map((o) => (
              <div key={`${o.unitCode}:${o.job.id}`} className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] font-semibold text-slate-500">{bilingual(lang, o.job.ten, o.job.ten_khmer)}:</span>
                {o.people.map((p) => (
                  <PersonPill key={p.key} p={p} selected={selected?.key === p.key} onSelect={onSelect} onRemove={props.onRemove} removeLabel={T("sdGoKhoiO")} vehicleCode={props.vehicleCode} draggable={props.canEdit({ key: "truc_ca", job: o.job, unitCode: o.unitCode, people: [] })} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Band(props: Props & { keys: StationKey[]; dir: "right" | "left" }) {
  const { keys, dir, model } = props
  return (
    <div className="flex items-start justify-between gap-0.5 rounded-[22px] border border-slate-300 bg-white px-1 py-2">
      {keys.map((k, i) => (
        <div key={k} className="contents">
          <StationNode {...props} cell={model.cells[k]} />
          {i < keys.length - 1 ? <StepArrow dir={dir} /> : null}
        </div>
      ))}
    </div>
  )
}

function StationNode(props: Props & { cell: DiagramCell }) {
  const { cell, lang, selected, onSelect, canEdit, onCellTap, onDrop, vehicleCode } = props
  const [over, setOver] = useState(false)
  const editable = !!cell.job && canEdit(cell)
  const label = cell.job ? bilingual(lang, cell.job.ten, cell.job.ten_khmer) : STATION_LABEL[cell.key].replace(/^.*· /, "")
  const n = cell.people.length
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onCellTap(cell)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onCellTap(cell)
        }
      }}
      onDragOver={(e) => {
        e.stopPropagation()
        if (!editable) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.stopPropagation()
        setOver(false)
        if (!editable) return
        e.preventDefault()
        const payload = readDiagramDrag(e)
        if (payload) onDrop(cell, payload)
      }}
      className={`flex min-w-0 flex-1 cursor-pointer flex-col items-center rounded-2xl border p-1 text-center transition ${
        over
          ? "border-amber-400 bg-amber-50"
          : selected && editable
            ? "border-amber-200 bg-amber-50/40"
            : n > 0
              ? "border-transparent hover:border-slate-200"
              : "border-dashed border-rose-200 bg-rose-50/30"
      } ${cell.job && !editable ? "opacity-60" : ""} ${!cell.job ? "opacity-40" : ""}`}
    >
      <div className="relative flex items-center justify-center">
        <StationIcon station={cell.key} height={30} />
        {n > 1 ? (
          <span className="absolute -right-2 -top-1 rounded-full bg-teal-700 px-1.5 text-[9px] font-bold leading-4 text-white shadow-sm">{n}</span>
        ) : null}
        {cell.job && !editable ? <Lock size={10} className="absolute -left-1.5 -top-0.5 text-slate-400" /> : null}
      </div>
      <div className="mb-1 mt-0.5 w-full break-words text-[10px] font-semibold leading-tight text-slate-700">{label}</div>
      <div className="flex w-full flex-col items-stretch gap-1">
        {n === 0 ? (
          <span className="mx-auto rounded-full border border-dashed border-slate-300 px-2 text-[9.5px] text-slate-400">—</span>
        ) : (
          cell.people.map((p) => (
            <PersonPill key={p.key} p={p} selected={selected?.key === p.key} onSelect={onSelect} onRemove={props.onRemove} removeLabel={props.T("sdGoKhoiO")} vehicleCode={vehicleCode} draggable={editable} />
          ))
        )}
      </div>
    </div>
  )
}

function PersonPill({
  p,
  selected,
  onSelect,
  onRemove,
  removeLabel,
  vehicleCode,
  draggable,
}: {
  p: DiagramPerson
  selected: boolean
  onSelect: (p: DiagramPerson | null) => void
  onRemove: (p: DiagramPerson) => void
  removeLabel: string
  vehicleCode: (id: string) => string
  /** = ô sửa được (cũng quyết định có dấu X gỡ khỏi ô). */
  draggable: boolean
}) {
  const kind = genderKind(p.gioiTinh)
  const cls =
    kind === "nam"
      ? "border-sky-200 bg-sky-50 text-sky-900"
      : kind === "nu"
        ? "border-pink-200 bg-pink-50 text-pink-900"
        : "border-slate-200 bg-slate-50 text-slate-700"
  const dot = kind === "nam" ? "bg-sky-500" : kind === "nu" ? "bg-pink-500" : "bg-slate-400"
  const xe = p.vehicleId ? vehicleCode(p.vehicleId) : ""
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => setDiagramDrag(e, { type: "person", key: p.key })}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(selected ? null : p)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          e.stopPropagation()
          onSelect(selected ? null : p)
        }
      }}
      className={`flex cursor-pointer items-start gap-1 rounded-lg border py-0.5 pl-1 text-left text-[10px] font-medium leading-tight ${draggable ? "pr-0" : "pr-1"} ${cls} ${
        selected ? "outline outline-2 outline-offset-1 outline-amber-500" : ""
      } ${p.temp ? "italic" : ""}`}
    >
      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 break-words">
        {p.name}
        {xe ? <span className="font-semibold text-amber-700"> ({xe})</span> : null}
      </span>
      {draggable ? (
        <button
          type="button"
          title={removeLabel}
          aria-label={removeLabel}
          onClick={(e) => {
            e.stopPropagation()
            onRemove(p)
          }}
          className="-my-0.5 flex shrink-0 items-start rounded-md px-1 py-0.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  )
}

function StepArrow({ dir }: { dir: "right" | "left" }) {
  return (
    <div className="flex shrink-0 items-center justify-center pt-4 text-teal-700/70">
      <svg viewBox="0 0 26 18" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {dir === "right" ? <path d="M3 9h18M15 3l6 6-6 6" /> : <path d="M23 9H5M11 3L5 9l6 6" />}
      </svg>
    </div>
  )
}

function CurvedArrow({ kind }: { kind: "right-down" | "left-down-right" | "right-down-left" }) {
  const pos = kind === "left-down-right" ? "justify-start pl-5" : "justify-end pr-5"
  return (
    <div className={`-my-0.5 flex select-none text-teal-700/75 ${pos}`}>
      <svg viewBox="0 0 84 38" className="h-7 w-14" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {kind === "right-down" ? (
          <>
            <path d="M4 6h52a14 14 0 0 1 14 14v12" />
            <path d="M63 26l7 7 7-7" />
          </>
        ) : kind === "left-down-right" ? (
          <>
            <path d="M8 2v16a14 14 0 0 0 14 14h52" />
            <path d="M68 25l7 7-7 7" />
          </>
        ) : (
          <>
            <path d="M76 2v16a14 14 0 0 1-14 14H10" />
            <path d="M16 25l-7 7 7 7" />
          </>
        )}
      </svg>
    </div>
  )
}
