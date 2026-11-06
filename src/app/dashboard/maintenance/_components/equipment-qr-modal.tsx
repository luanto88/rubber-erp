"use client"

import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { OrderQrDownload } from "@/app/dashboard/export/_components/order-qr-download"
import { authFetch } from "@/lib/auth-fetch"
import { buildEquipmentQrUrl } from "@/lib/equipment-qr"

export type EquipmentQrTarget = { id: string; ma_tb: string; ten_tb: string }

// QR dán trên thiết bị (docs/qr-equipment-plan.md, GĐ1). Lấy/tạo token qua API service role,
// hiển thị QR + tải PNG (mã thiết bị in dưới QR để người đọc được khi QR mờ).
export function EquipmentQrModal({ asset, onClose }: { asset: EquipmentQrTarget; onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const res = await authFetch("/api/equipment/qr-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId: asset.id }),
        })
        const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
        if (!alive) return
        if (!res.ok || !json.token) setError(json.error || "Không lấy được QR thiết bị")
        else setToken(json.token)
      } catch {
        if (alive) setError("Mất kết nối. Vui lòng thử lại.")
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [asset.id])

  const url = token ? buildEquipmentQrUrl(token) : ""

  return (
    <ModalShell title={`QR thiết bị ${asset.ma_tb}`} onClose={onClose} maxWidth="sm">
      <p className="text-sm font-semibold text-slate-700">{asset.ten_tb}</p>
      {error ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>
      ) : !token ? (
        <div className="mt-3 h-40 animate-pulse rounded-xl bg-slate-100" />
      ) : (
        <div className="mt-3 space-y-3">
          <OrderQrDownload value={url} code={asset.ma_tb} size={180} />
          <p className="break-all rounded-lg bg-slate-50 px-3 py-2 font-code text-xs text-slate-600">{url}</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-600 hover:underline"
          >
            <ExternalLink size={14} /> Mở trang tra cứu
          </a>
          <p className="text-xs text-slate-500">
            Người chưa đăng nhập chỉ thấy tên, mã, loại, bộ phận và ngày bảo trì gần nhất.
          </p>
        </div>
      )}
    </ModalShell>
  )
}
