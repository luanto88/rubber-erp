"use client"

// "Gửi tất cả" (người chấm công toàn nhà máy, 2026-11-25): gửi cùng lúc mọi phiếu ca đang lập / bị trả về của phiếu ngày.
// Ca A/B/C: thành viên chưa giao việc tự ghi VẮNG CÓ PHÉP; Tổ: người chưa giao bỏ qua. Phiếu ca trống (Ca/Tổ không làm việc)
// không gửi, không chặn duyệt phiếu ngày.

import { createPortal } from "react-dom"
import { AlertTriangle, Loader2, SendHorizontal, X } from "lucide-react"
import type { SectionPositions, SheetLineDraft } from "@/lib/attendance/shift"

export type SendAllItem = {
  sectionId: string
  label: string
  status: string
  send: boolean
  note: string
  co: number
  vang: number
  /** Số người chưa giao việc được tự ghi vắng có phép (chỉ Ca A/B/C). */
  auto: number
  lines: SheetLineDraft[]
  holders: string[]
  header: { ghi_chu: string; vi_tri: SectionPositions }
}

export function SendAllDialog({
  T,
  items,
  meta,
  busy,
  missingUnits = [],
  onCancel,
  onConfirm,
}: {
  T: (key: string, vars?: Record<string, string | number>) => string
  items: SendAllItem[]
  meta: string
  busy: boolean
  /** Ca/Tổ của QR chưa điểm danh (chỉ cảnh báo, không chặn — chốt 2026-11-27). */
  missingUnits?: string[]
  onCancel: () => void
  onConfirm: () => void
}) {
  const toSend = items.filter((i) => i.send)
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 sm:items-center" onClick={busy ? undefined : onCancel}>
      <div className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <SendHorizontal size={18} className="text-emerald-600" />
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold text-slate-800">{T("guiTatCa")}</div>
            <div className="truncate text-xs text-slate-500">{meta}</div>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={T("close")}>
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {missingUnits.length > 0 ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{T("chuaDiemDanhDonVi", { ds: missingUnits.join(", ") })}</span>
            </div>
          ) : null}
          {items.length === 0 ? <p className="text-sm text-slate-500">{T("chuaMoPhieu")}</p> : null}
          {items.map((it) => (
            <div key={it.sectionId} className={"rounded-xl border px-3 py-2 " + (it.send ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-slate-50 opacity-75")}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{it.label}</span>
                {it.send ? (
                  <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">{T("seGui")}</span>
                ) : (
                  <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">{T("khongGui")}</span>
                )}
              </div>
              {it.send ? (
                <div className="mt-0.5 text-xs text-slate-600">
                  {T("co")}: <b>{it.co}</b> · {T("vang")}: <b>{it.vang}</b>
                  {it.auto > 0 ? <span className="text-sky-700"> · {T("tuGhiCoPhep", { n: it.auto })}</span> : null}
                </div>
              ) : null}
              {it.note ? <div className={"mt-0.5 text-xs " + (it.send ? "text-slate-500" : "font-semibold text-slate-500")}>{it.note}</div> : null}
            </div>
          ))}
        </div>
        <div className="border-t border-slate-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || toSend.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-base font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <SendHorizontal size={18} />} {T("guiNPhieu", { n: toSend.length })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
