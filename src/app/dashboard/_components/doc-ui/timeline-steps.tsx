"use client"

import { Bell, Check, Clock, X } from "lucide-react"
import type { ReactNode } from "react"

export type TimelineStepState = "done" | "current" | "waiting" | "rejected"

export type TimelineStepItem = {
  key: string
  /** Nhãn vai trò nhỏ in hoa phía trên (vd "Bước 1", "Phê duyệt"). */
  role?: string
  title: ReactNode
  actor?: ReactNode
  time?: string | null
  note?: ReactNode
  state: TimelineStepState
  /** Đúng lượt người đang xem → nổi bật "Đến lượt bạn". */
  isMine?: boolean
  stepNo?: number
  /**
   * Màu vai trò của bước — CÙNG màu khung ký của bước đó trên PDF/màn cài đặt vị trí
   * (template-colors.ts). Hiện dưới dạng viền trái 3px. Không truyền → không có viền màu.
   */
  accentColor?: string
}

/**
 * Tiến trình luồng ký (Doc-UI) — bong bóng 32px: đã ký (brand ✓), đang chờ (amber, vòng nhấp
 * nháy), chưa tới (slate số thứ tự), bị trả về (đỏ ✕). Thay 2 bản `TimelineStep` cũ.
 */
export function TimelineSteps({
  steps,
  formatTime,
  compact = false,
}: {
  steps: TimelineStepItem[]
  formatTime?: (iso: string) => string
  compact?: boolean
}) {
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        const bubble =
          s.state === "done"
            ? "bg-brand-600 text-white"
            : s.state === "rejected"
              ? "bg-red-500 text-white"
              : s.state === "current"
                ? `bg-amber-500 text-white ${s.isMine ? "doc-pulse-ring" : "ring-4 ring-amber-100"}`
                : "border-2 border-slate-200 bg-slate-50 text-slate-400"
        const line = s.state === "done" ? "bg-brand-400" : "bg-slate-200"
        return (
          <li key={s.key} className={`relative flex gap-3 ${last ? "" : compact ? "pb-3" : "pb-5"}`}>
            {!last && <span className={`absolute left-4 top-9 bottom-0 w-0.5 -translate-x-1/2 rounded ${line}`} />}
            <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ${bubble}`}>
              {s.state === "done" ? (
                <Check size={16} strokeWidth={3} />
              ) : s.state === "rejected" ? (
                <X size={15} strokeWidth={3} />
              ) : s.state === "current" && s.isMine ? (
                <Bell size={14} />
              ) : s.stepNo ? (
                <span className="text-[11px] font-extrabold">{s.stepNo}</span>
              ) : (
                <Clock size={14} />
              )}
            </span>
            <div
              className={`min-w-0 flex-1 rounded-xl px-3 py-2 ${
                s.state === "current" && s.isMine ? "border border-amber-200 bg-amber-50" : ""
              }`}
              style={s.accentColor ? { borderLeft: `3px solid ${s.state === "waiting" ? `${s.accentColor}55` : s.accentColor}` } : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {s.role && (
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{s.role}</p>
                  )}
                  <p className={`text-[13px] font-bold ${s.state === "waiting" ? "text-slate-500" : "text-slate-800"}`}>
                    {s.title}
                  </p>
                </div>
                {s.state === "current" && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      s.isMine ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {s.isMine ? "Đến lượt bạn" : "Đang chờ"}
                  </span>
                )}
                {s.state === "rejected" && (
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                    Trả về
                  </span>
                )}
              </div>
              {s.actor && (
                <p className={`mt-0.5 text-[12.5px] ${s.state === "current" && s.isMine ? "font-semibold text-amber-800" : "text-slate-500"}`}>
                  {s.actor}
                </p>
              )}
              {s.time && (
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                  <Clock size={11} /> {formatTime ? formatTime(s.time) : s.time}
                </p>
              )}
              {s.note && <div className="mt-1 text-[12px] text-slate-600">{s.note}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Thanh tiến độ "N/M bước" đặt dưới timeline. */
export function TimelineProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <span>Tiến độ ký</span>
        <span className="text-brand-700">
          {done}/{total} bước
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
