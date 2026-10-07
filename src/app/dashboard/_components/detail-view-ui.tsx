"use client"

import React from "react"
import { QRCodeSVG } from "qrcode.react"
import { FileText, Download, Eye, RotateCcw, Link as LinkIcon, CheckCircle2 } from "lucide-react"

export type ColorTone =
  | "rose"
  | "orange"
  | "amber"
  | "emerald"
  | "teal"
  | "blue"
  | "indigo"
  | "violet"
  | "pink"
  | "slate"

const TONE_MAP: Record<ColorTone, { bg: string; text: string; border?: string }> = {
  rose: { bg: "bg-rose-50", text: "text-rose-600", border: "border-rose-200" },
  orange: { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200" },
  amber: { bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-200" },
  teal: { bg: "bg-teal-50", text: "text-teal-600", border: "border-teal-200" },
  blue: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" },
  indigo: { bg: "bg-indigo-50", text: "text-indigo-600", border: "border-indigo-200" },
  violet: { bg: "bg-violet-50", text: "text-violet-600", border: "border-violet-200" },
  pink: { bg: "bg-pink-50", text: "text-pink-600", border: "border-pink-200" },
  slate: { bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-200" },
}

/**
 * Thẻ Card Container chuẩn mực cho View Detail
 * Nền trắng bo góc rounded-2xl, viền slate-200, header có icon pastel + tiêu đề + mô tả phụ
 */
export function DetailCard({
  icon,
  iconTone = "blue",
  title,
  subtitle,
  badge,
  children,
  className = "",
}: {
  icon: React.ReactNode
  iconTone?: ColorTone
  title: string
  subtitle?: string
  badge?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const tone = TONE_MAP[iconTone]
  return (
    <div className={`bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-6 transition-all ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4 sm:mb-5">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <span className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl ${tone.bg} ${tone.text} grid place-items-center shrink-0`}>
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-extrabold text-slate-800 leading-tight truncate">{title}</h3>
            {subtitle && (
              <p className="text-[11px] sm:text-xs text-slate-400 font-medium leading-normal mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {badge && <div className="shrink-0 ml-2">{badge}</div>}
      </div>

      {/* Body */}
      {children}
    </div>
  )
}

/**
 * Ô trường thông tin chuẩn (Icon pastel + Label + Value)
 * Tự động căn đối 2 cột 50-50 trên mobile, hỗ trợ colSpan={2} cho trường dài
 */
export function DetailFieldItem({
  icon,
  iconTone = "slate",
  label,
  value,
  colSpan = 1,
  extra,
  mono = false,
  highlight,
}: {
  icon: React.ReactNode
  iconTone?: ColorTone
  label: string
  value: React.ReactNode
  colSpan?: 1 | 2
  extra?: React.ReactNode
  mono?: boolean
  highlight?: "rose" | "emerald" | "blue" | "amber" | "violet"
}) {
  const tone = TONE_MAP[iconTone]
  const highlightCls = highlight
    ? {
        rose: "text-rose-700 font-bold",
        emerald: "text-emerald-700 font-bold",
        blue: "text-blue-700 font-bold",
        amber: "text-amber-700 font-bold",
        violet: "text-violet-700 font-bold",
      }[highlight]
    : "text-slate-800 font-bold"

  return (
    <div className={`flex items-center justify-between gap-2 min-w-0 ${colSpan === 2 ? "col-span-2" : "col-span-1"}`}>
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
        <span className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full sm:rounded-xl ${tone.bg} ${tone.text} grid place-items-center shrink-0`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-tight truncate">{label}</p>
          <div className={`text-xs sm:text-sm mt-0.5 truncate ${mono ? "font-mono" : ""} ${highlightCls}`}>
            {value ?? "—"}
          </div>
        </div>
      </div>
      {extra && <div className="shrink-0 ml-1">{extra}</div>}
    </div>
  )
}

/**
 * Thẻ hiển thị Tệp đính kèm được đưa lên ĐẦU VIEW
 */
export function DetailFileCard({
  fileName,
  fileType = "pdf",
  fileSize,
  statusLabel,
  statusTone = "emerald",
  onView,
  onDownload,
  onReplace,
  canReplace = false,
  replacing = false,
  extra,
}: {
  fileName: string
  fileType?: string
  fileSize?: string
  statusLabel?: string
  statusTone?: "emerald" | "amber" | "blue"
  onView?: () => void
  onDownload?: () => void
  onReplace?: () => void
  canReplace?: boolean
  replacing?: boolean
  extra?: React.ReactNode
}) {
  const isPdf = fileType.toLowerCase().includes("pdf")
  const isSheet = fileType.toLowerCase().includes("xls")
  const badgeTone = {
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    blue: "bg-blue-100 text-blue-800",
  }[statusTone]

  return (
    <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-slate-50 via-white to-blue-50/30 border border-slate-200/90 shadow-2xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <span
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl grid place-items-center shrink-0 ${
              isPdf
                ? "bg-rose-50 text-rose-600"
                : isSheet
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-blue-50 text-blue-600"
            }`}
          >
            <FileText size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-xs sm:text-sm font-extrabold text-slate-800 truncate max-w-full" title={fileName}>
                {fileName}
              </p>
              {fileType && (
                <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                  {fileType}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium mt-0.5">
              {fileSize && <span>{fileSize}</span>}
              {statusLabel && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeTone}`}>
                  {statusLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Nút hành động */}
        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
          {onView && (
            <button
              type="button"
              onClick={onView}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-all"
            >
              <Eye size={13} /> Xem
            </button>
          )}
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-all"
            >
              <Download size={13} /> Tải về
            </button>
          )}
          {canReplace && onReplace && (
            <button
              type="button"
              onClick={onReplace}
              disabled={replacing}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all disabled:opacity-50"
            >
              <RotateCcw size={13} /> {replacing ? "Đang tải..." : "Thay file"}
            </button>
          )}
        </div>
      </div>
      {extra && <div className="mt-3 pt-2.5 border-t border-slate-100">{extra}</div>}
    </div>
  )
}

/**
 * Ô tra cứu trực tuyến & Mã QR
 */
export function DetailQrBox({
  label = "Liên kết tra cứu trực tuyến",
  qrUrl,
}: {
  label?: string
  qrUrl: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-3 bg-slate-50/70 border border-slate-100 rounded-xl">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 grid place-items-center shrink-0">
          <LinkIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-bold text-slate-700 block">{label}</span>
          <span className="text-[11px] font-mono text-slate-400 truncate block mt-0.5">{qrUrl}</span>
        </div>
      </div>
      <div className="shrink-0 p-1 bg-white rounded-lg border border-slate-200 shadow-2xs">
        <QRCodeSVG value={qrUrl} size={44} level="M" />
      </div>
    </div>
  )
}
