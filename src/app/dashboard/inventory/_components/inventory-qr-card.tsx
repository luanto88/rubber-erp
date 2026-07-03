"use client"

import Link from "next/link"
import { useMemo, useRef } from "react"
import { Download, QrCode } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"

type InventoryQrCardProps = {
  title: string
  caption: string
  hrefPath: string | null
  valueText: string
  disabledNote?: string
  compact?: boolean
  /** Đặt giá trị (vd mã ngăn) để hiện nút "Tải QR" — tải ảnh PNG nét cao để in dán hiện trường. */
  downloadFileName?: string
}

const safeFileName = (value: string) => (
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
) || "qr"

export function InventoryQrCard({
  title,
  caption,
  hrefPath,
  valueText,
  disabledNote = "QR sẽ hoạt động sau khi phiếu được tạo.",
  compact = false,
  downloadFileName,
}: InventoryQrCardProps) {
  const absoluteUrl = useMemo(() => {
    if (!hrefPath) return ""
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return origin ? `${origin}${hrefPath}` : hrefPath
  }, [hrefPath])

  const qrRef = useRef<SVGSVGElement>(null)

  const handleDownload = () => {
    const svg = qrRef.current
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg)
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" })
    const svgUrl = URL.createObjectURL(svgBlob)
    const img = new window.Image()
    img.onload = () => {
      const scale = 8 // render nét cao để in dán ngoài hiện trường
      const canvas = document.createElement("canvas")
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      }
      URL.revokeObjectURL(svgUrl)
      canvas.toBlob((blob) => {
        if (!blob) return
        const blobUrl = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = blobUrl
        link.download = `${safeFileName(downloadFileName || valueText || "qr")}.png`
        link.click()
        URL.revokeObjectURL(blobUrl)
      }, "image/png")
    }
    img.src = svgUrl
  }

  if (compact) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-1.5">
          {hrefPath ? (
            <QRCodeSVG ref={qrRef} value={absoluteUrl} size={72} level="M" />
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
            <div className="flex items-center gap-2">
              <Link
                href={hrefPath}
                className="text-[10px] font-bold text-emerald-600 transition hover:text-emerald-700 hover:underline"
              >
                Mở tra cứu →
              </Link>
              {downloadFileName && (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex items-center gap-1 text-[10px] font-bold text-slate-500 transition hover:text-slate-700 hover:underline"
                >
                  <Download size={10} /> Tải QR
                </button>
              )}
            </div>
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
          <QRCodeSVG ref={qrRef} value={absoluteUrl} size={120} level="M" />
        ) : (
          <div className="flex h-[120px] w-[120px] items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">
            Chưa sẵn sàng
          </div>
        )}
      </div>
      <div className="mt-3 break-all text-center text-[11px] font-semibold text-slate-500">{valueText}</div>
      <div className="mt-2 text-center text-xs text-slate-500">{caption}</div>
      {hrefPath ? (
        <div className="mt-3 flex flex-col items-center gap-1.5 text-center">
          <Link
            href={hrefPath}
            className="text-xs font-bold text-emerald-600 transition hover:text-emerald-700 hover:underline"
          >
            Mở trang tra cứu
          </Link>
          {downloadFileName && (
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-500 transition hover:text-slate-700 hover:underline"
            >
              <Download size={12} /> Tải QR để in dán hiện trường
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 text-center text-xs text-slate-400">{disabledNote}</div>
      )}
    </div>
  )
}
