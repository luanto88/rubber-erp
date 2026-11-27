"use client"

// 1 ô người trên lưới điểm danh (C2 làm lại GĐ2). 4 trạng thái: chưa giao (viền đứt), có mặt (viền xanh + chip việc,
// "B" góc phải khi xếp B), vắng có người thay (icon mờ + gạch chéo đỏ + "→ người thay"), vắng (chip đỏ).

import { Briefcase, Lock } from "lucide-react"
import { GenderIcon } from "./gender-icon"
import type { TileState } from "@/lib/attendance/shift"
import type { StationKey } from "@/lib/attendance/diagram"
import { StationIcon } from "./diagram-icons"

export function WorkerTile({
  ten,
  gioiTinh,
  state,
  jobLabel,
  extraJobs,
  xepB,
  replacementName,
  vangLabel,
  chuaGiaoLabel,
  roleLabel,
  caLabel,
  missingCa,
  locked,
  disabled,
  stationKey,
  onDragStart,
  onClick,
}: {
  ten: string
  gioiTinh: string | null
  state: TileState
  jobLabel: string
  extraJobs: number
  xepB: boolean
  replacementName: string
  vangLabel: string
  chuaGiaoLabel: string
  /** Vị trí phụ trách đang giữ (Ca trưởng, Tổ phó…) — "" nếu không. */
  roleLabel?: string
  /** Giờ làm (tổ ghi giờ) hoặc ca (A4 tổ phân ca: "Ca A + Ca B" / "Cả ngày"); "" = không hiện. */
  caLabel?: string
  /** A2 — tổ có việc mà chưa chọn ca ⇒ chấm cam (sẽ bị chặn khi gửi). */
  missingCa?: boolean
  /** A4 — có phân công đã gửi (khoá việc / ca) ⇒ ổ khoá nhỏ góc trái. */
  locked?: boolean
  disabled?: boolean
  /** A3 — ô sơ đồ của việc đầu tiên ⇒ huy hiệu là icon ô; null ⇒ huy hiệu cặp hồ sơ như cũ. */
  stationKey?: StationKey | null
  /** A3 — máy tính: kéo thẻ người thả vào ô sơ đồ. */
  onDragStart?: (e: React.DragEvent) => void
  onClick: () => void
}) {
  const border =
    state === "co_mat"
      ? "border-2 border-emerald-500 bg-emerald-50/60"
      : state === "chua_giao"
        ? "border-2 border-dashed border-slate-300 bg-white"
        : "border-2 border-rose-300 bg-rose-50/60"
  const absent = state === "vang" || state === "vang_co_thay"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      draggable={!!onDragStart && !disabled}
      onDragStart={onDragStart}
      className={`relative flex min-h-[104px] flex-col items-center gap-1 rounded-xl px-1.5 pb-1.5 pt-2 text-center transition active:scale-[0.97] disabled:cursor-default ${border}`}
    >
      {state === "co_mat" && xepB ? (
        <span className="absolute right-1 top-1 rounded bg-amber-500 px-1 text-[10px] font-black leading-4 text-white">B</span>
      ) : null}
      <span className="relative">
        <GenderIcon gioiTinh={gioiTinh} muted={absent} />
        {state === "co_mat" && jobLabel ? (
          // Huy hiệu việc: icon ô sơ đồ của việc đầu tiên (A3); việc không có ô ⇒ dấu "đã giao việc".
          stationKey ? (
            <span className="absolute -bottom-1 -right-3 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border-2 border-white bg-amber-50 px-0.5 shadow-sm">
              <StationIcon station={stationKey} height={16} />
            </span>
          ) : (
            <span className="absolute -bottom-0.5 -right-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-amber-500 text-white shadow-sm">
              <Briefcase size={10} strokeWidth={2.5} />
            </span>
          )
        ) : null}
        {state === "vang_co_thay" ? (
          <svg className="pointer-events-none absolute inset-0" viewBox="0 0 34 34" aria-hidden>
            <line x1="4" y1="4" x2="30" y2="30" stroke="#e11d48" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : null}
      </span>
      <span className={`line-clamp-2 w-full break-words text-[12px] font-bold leading-tight ${absent ? "text-slate-400" : "text-slate-800"}`}>{ten}</span>
      {roleLabel ? (
        <span className="line-clamp-2 max-w-full break-words rounded-lg bg-violet-600 px-1.5 text-[10px] font-semibold leading-4 text-white">{roleLabel}</span>
      ) : null}
      {state === "co_mat" ? (
        jobLabel ? (
          <span className="line-clamp-2 max-w-full break-words rounded-lg bg-emerald-600 px-1.5 py-px text-[10px] font-semibold leading-[13px] text-white">
            {jobLabel}
            {extraJobs > 0 ? ` +${extraJobs}` : ""}
          </span>
        ) : null
      ) : state === "vang_co_thay" ? (
        <span className="line-clamp-2 max-w-full break-words text-[10px] font-semibold leading-[13px] text-rose-600">→ {replacementName}</span>
      ) : state === "vang" ? (
        <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold leading-4 text-white">{vangLabel}</span>
      ) : (
        <span className="text-[10px] font-semibold leading-4 text-slate-400">{chuaGiaoLabel}</span>
      )}
      {caLabel ? (
        <span className="line-clamp-2 max-w-full break-words rounded-md bg-sky-50 px-1 text-[10px] font-bold leading-[13px] text-sky-700">{caLabel}</span>
      ) : null}
      {locked ? (
        <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-600 text-white ring-2 ring-white" aria-hidden>
          <Lock size={9} strokeWidth={2.75} />
        </span>
      ) : missingCa ? (
        <span className="absolute left-1 top-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-white" aria-hidden />
      ) : null}
    </button>
  )
}
