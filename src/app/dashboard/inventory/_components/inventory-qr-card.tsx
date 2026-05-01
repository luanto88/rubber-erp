"use client"

import Link from "next/link"
import { useMemo } from "react"
import { QrCode } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"

type InventoryQrCardProps = {
  title: string
  caption: string
  hrefPath: string | null
  valueText: string
  disabledNote?: string
  compact?: boolean
}

export function InventoryQrCard({
  title,
  caption,
  hrefPath,
  valueText,
  disabledNote = "QR sẽ hoạt động sau khi phiếu được tạo.",
  compact = false,
}: InventoryQrCardProps) {
  const absoluteUrl = useMemo(() => {
    if (!hrefPath) return ""
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return origin ? `${origin}${hrefPath}` : hrefPath
  }, [hrefPath])

  if (compact) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-1.5">
          {hrefPath ? (
            <QRCodeSVG value={absoluteUrl} size={72} level="M" />
          ) : (
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400">
              Chưa sẵn sàng
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            <QrCode size={11} />
            {title}
          </div>
          <p className="break-all text-[11px] font-semibold text-slate-600">{valueText || "—"}</p>
          <p className="text-[10px] leading-snug text-slate-400">{caption}</p>
          {hrefPath ? (
            <Link
              href={hrefPath}
              className="text-[10px] font-bold text-emerald-600 transition hover:text-emerald-700 hover:underline"
            >
              Mở tra cứu →
            </Link>
          ) : (
            <p className="text-[10px] text-slate-400">{disabledNote}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-[220px] rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        <QrCode size={14} />
        {title}
      </div>
      <div className="mt-3 flex justify-center rounded-xl border border-slate-200 bg-white p-3">
        {hrefPath ? (
          <QRCodeSVG value={absoluteUrl} size={120} level="M" />
        ) : (
          <div className="flex h-[120px] w-[120px] items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">
            Chưa sẵn sàng
          </div>
        )}
      </div>
      <div className="mt-3 break-all text-center text-[11px] font-semibold text-slate-500">
        {valueText}
      </div>
      <div className="mt-2 text-center text-xs text-slate-500">{caption}</div>
      {hrefPath ? (
        <div className="mt-3 text-center">
          <Link
            href={hrefPath}
            className="text-xs font-bold text-emerald-600 transition hover:text-emerald-700 hover:underline"
          >
            Mở trang tra cứu
          </Link>
        </div>
      ) : (
        <div className="mt-3 text-center text-xs text-slate-400">{disabledNote}</div>
      )}
    </div>
  )
}
