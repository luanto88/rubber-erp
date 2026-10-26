"use client"

import dynamic from "next/dynamic"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { QrCode } from "lucide-react"

// Máy quét QR toàn màn hình dùng chung cho ô tìm của các danh sách (rule 29 mục D2).
// html5-qrcode đụng navigator.mediaDevices ⇒ chỉ nạp ở client; render qua portal ra document.body
// để `fixed` không bị ancestor có transform/filter giữ lại.
const QrScanner = dynamic(
  () => import("@/app/dashboard/product/confirm/qr-scanner").then((m) => m.QrScanner),
  { ssr: false },
)

export function QrScanPortal({
  open,
  onClose,
  onDecoded,
  hintText,
  scanKey,
  header,
}: {
  open: boolean
  onClose: () => void
  onDecoded: (text: string) => void
  hintText: string
  /** Đổi giá trị để khởi động lại máy quét (quét liên tục nhiều mã). */
  scanKey?: number
  /** Nội dung đặt trên máy quét (vd thanh "Đã quét N mã · Xong"). */
  header?: ReactNode
}) {
  if (!open || typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-black">
      {header}
      <QrScanner
        key={scanKey}
        onDecoded={onDecoded}
        onCancel={onClose}
        hintText={hintText}
        cancelText="Hủy quét"
        cameraErrorText="Không mở được camera. Hãy cấp quyền camera hoặc tải ảnh chứa QR."
        uploadButtonText="Tải ảnh chứa QR"
        uploadScanningText="Đang xử lý ảnh..."
        uploadNotFoundText="Không tìm thấy mã QR trong ảnh."
        orDividerText="hoặc"
        scanError={null}
      />
    </div>,
    document.body,
  )
}

/** Nút "Quét QR" đặt bên trong ô tìm. */
export function QrScanButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-mod-50 px-2 text-xs font-bold text-mod-800 transition-colors hover:bg-mod-200"
    >
      <QrCode size={15} />
      <span className="hidden sm:inline">Quét QR</span>
    </button>
  )
}
