"use client"

import { useRef } from "react"
import { QRCodeCanvas } from "qrcode.react"
import { Download } from "lucide-react"
import { safeDownloadFileName } from "@/lib/storage-download"

/**
 * QR EUDR của đơn xuất trong dòng xổ — hiển thị + tải ảnh PNG
 * (QR nền trắng có lề + mã đơn bên dưới để dán/in).
 */
export function OrderQrDownload({ value, code, size = 100 }: { value: string; code: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const download = () => {
    const qr = canvasRef.current
    if (!qr) return
    const pad = 32
    const label = (code || "").trim()
    const labelH = label ? 48 : 0
    const out = document.createElement("canvas")
    out.width = qr.width + pad * 2
    out.height = qr.height + pad * 2 + labelH
    const ctx = out.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(qr, pad, pad)
    if (label) {
      ctx.fillStyle = "#0f172a"
      ctx.font = "bold 26px 'JetBrains Mono', ui-monospace, monospace"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(label, out.width / 2, qr.height + pad + labelH / 2, out.width - pad * 2)
    }
    const a = document.createElement("a")
    a.href = out.toDataURL("image/png")
    a.download = safeDownloadFileName(`QR ${label || "don-xuat"}`, "png")
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="rounded-xl border border-slate-200 bg-white p-2">
        {/* Canvas gốc 512px cho ảnh tải về; hiển thị thu nhỏ theo size */}
        <QRCodeCanvas
          ref={canvasRef}
          value={value}
          size={512}
          level="M"
          style={{ width: size, height: size }}
        />
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          download()
        }}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:border-brand-300 hover:bg-brand-50"
        title="Tải ảnh QR dạng PNG"
      >
        <Download size={12} /> Tải PNG
      </button>
    </div>
  )
}
