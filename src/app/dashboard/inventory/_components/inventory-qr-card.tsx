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
}

export function InventoryQrCard({
  title,
  caption,
  hrefPath,
  valueText,
  disabledNote = "QR sẽ hoạt động sau khi phiếu được tạo.",
}: InventoryQrCardProps) {
  const absoluteUrl = useMemo(() => {
    if (!hrefPath) {
      return ""
    }

    const origin = typeof window !== "undefined" ? window.location.origin : ""

    return origin ? `${origin}${hrefPath}` : hrefPath
  }, [hrefPath])

  return (
    <div className="w-full max-w-[220px] rounded-xl border border-slate-200 bg-slate-50 p-4">
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
      <div className="mt-3 text-center text-[11px] font-semibold text-slate-500 break-all">{valueText}</div>
      <div className="mt-2 text-center text-xs text-slate-500">{caption}</div>
      {hrefPath ? (
        <div className="mt-3 text-center">
          <Link href={hrefPath} className="text-xs font-bold text-emerald-600 transition hover:text-emerald-700 hover:underline">
            Mở trang tra cứu
          </Link>
        </div>
      ) : (
        <div className="mt-3 text-center text-xs text-slate-400">{disabledNote}</div>
      )}
    </div>
  )
}
