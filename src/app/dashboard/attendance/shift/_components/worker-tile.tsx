"use client"

// 1 ô người trên lưới điểm danh (C2 làm lại GĐ2). 4 trạng thái: chưa giao (viền đứt), có mặt (viền xanh + chip việc,
// "B" góc phải khi xếp B), vắng có người thay (icon mờ + gạch chéo đỏ + "→ người thay"), vắng (chip đỏ).

import { GenderIcon } from "./gender-icon"
import type { TileState } from "@/lib/attendance/shift"

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
  disabled,
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
  disabled?: boolean
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
      className={`relative flex min-h-[104px] flex-col items-center gap-1 rounded-xl px-1.5 pb-1.5 pt-2 text-center transition active:scale-[0.97] disabled:cursor-default ${border}`}
    >
      {state === "co_mat" && xepB ? (
        <span className="absolute right-1 top-1 rounded bg-amber-500 px-1 text-[10px] font-black leading-4 text-white">B</span>
      ) : null}
      <span className="relative">
        <GenderIcon gioiTinh={gioiTinh} muted={absent} />
        {state === "vang_co_thay" ? (
          <svg className="pointer-events-none absolute inset-0" viewBox="0 0 34 34" aria-hidden>
            <line x1="4" y1="4" x2="30" y2="30" stroke="#e11d48" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : null}
      </span>
      <span className={`line-clamp-2 w-full break-words text-[12px] font-bold leading-tight ${absent ? "text-slate-400" : "text-slate-800"}`}>{ten}</span>
      {state === "co_mat" ? (
        <span className="max-w-full truncate rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold leading-4 text-white">
          {jobLabel}
          {extraJobs > 0 ? ` +${extraJobs}` : ""}
        </span>
      ) : state === "vang_co_thay" ? (
        <span className="max-w-full truncate text-[10px] font-semibold leading-4 text-rose-600">→ {replacementName}</span>
      ) : state === "vang" ? (
        <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold leading-4 text-white">{vangLabel}</span>
      ) : (
        <span className="text-[10px] font-semibold leading-4 text-slate-400">{chuaGiaoLabel}</span>
      )}
    </button>
  )
}
