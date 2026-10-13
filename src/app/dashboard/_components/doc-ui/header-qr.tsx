"use client"

import { useRef, useState } from "react"
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react"
import { Download } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { safeDownloadFileName } from "@/lib/storage-download"

/**
 * Ô QR nhỏ ở header trang chi tiết (Doc-UI). Bấm → phóng to + tải ảnh PNG/JPG.
 * Ảnh tải về = QR (nền trắng, có lề) + mã tài liệu bên dưới để dễ nhận diện khi in/dán.
 */
export function HeaderQr({ value, code, title }: { value: string; code?: string | null; title?: string | null }) {
  const [open, setOpen] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const download = (format: "png" | "jpg") => {
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
    const mime = format === "png" ? "image/png" : "image/jpeg"
    const a = document.createElement("a")
    a.href = out.toDataURL(mime, 0.95)
    a.download = safeDownloadFileName(`QR ${label || title || "tai-lieu"}`, format)
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 text-[13px] font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50 sm:w-9 sm:p-1"
        title="Mã QR tra cứu — bấm để phóng to / tải ảnh"
        aria-label="Phóng to mã QR"
      >
        <QRCodeSVG value={value} size={26} />
        <span className="sm:hidden">Mã QR</span>
      </button>
      {open && (
        <ModalShell
          title="Mã QR tra cứu"
          onClose={() => setOpen(false)}
          maxWidth="sm"
          footer={
            <>
              <button
                type="button"
                onClick={() => download("png")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
              >
                <Download size={15} /> Tải PNG
              </button>
              <button
                type="button"
                onClick={() => download("jpg")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <Download size={15} /> Tải JPG
              </button>
            </>
          }
        >
          <div className="flex flex-col items-center gap-3 py-2">
            {/* QRCodeCanvas tự gắn inline style width/height = size (512px), thắng mọi class CSS.
                Phải ghi đè bằng style để ô hiển thị co theo khung vuông; canvas gốc vẫn 512px nên ảnh tải về nét. */}
            <div className="aspect-square w-full max-w-[280px] overflow-hidden rounded-lg border border-slate-200 bg-white">
              <QRCodeCanvas
                ref={canvasRef}
                value={value}
                size={512}
                marginSize={2}
                level="M"
                style={{ width: "100%", height: "100%", display: "block" }}
              />
            </div>
            {code && <p className="font-code text-sm font-bold text-slate-800">{code}</p>}
            {title && <p className="text-center text-xs text-slate-500 [overflow-wrap:anywhere]">{title}</p>}
          </div>
        </ModalShell>
      )}
    </>
  )
}
