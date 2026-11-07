"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { OrderQrDownload } from "@/app/dashboard/export/_components/order-qr-download"
import { authFetch } from "@/lib/auth-fetch"
import { buildEquipmentQrUrl } from "@/lib/equipment-qr"

/** `kind` mặc định "asset" (máy móc); "vehicle" = xe Đội xe (GĐ4a, `ma_tb` = mã xe). */
export type EquipmentQrTarget = { id: string; ma_tb: string; ten_tb: string; kind?: "asset" | "vehicle" }

// QR dán trên thiết bị (docs/qr-equipment-plan.md, GĐ1). Lấy/tạo token qua API service role,
// hiển thị QR + tải PNG (mã thiết bị in dưới QR để người đọc được khi QR mờ).
// GĐ3: "Tạo lại QR" (admin / settings.maintenance_config) — thu hồi tem cũ, tạo token mới.
export function EquipmentQrModal({
  asset,
  onClose,
  canRegenerate = false,
}: {
  asset: EquipmentQrTarget
  onClose: () => void
  canRegenerate?: boolean
}) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)
  const [regenerated, setRegenerated] = useState(false)
  const isVehicle = asset.kind === "vehicle"
  const refBody = JSON.stringify(isVehicle ? { vehicleId: asset.id } : { assetId: asset.id })
  const noun = isVehicle ? "xe" : "thiết bị"

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const res = await authFetch("/api/equipment/qr-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: refBody,
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
  }, [refBody])

  // Xác nhận bằng ô tick (trước gõ lại mã — vô nghĩa vì mã hiện ngay trên hộp thoại).
  const handleRegenerate = async () => {
    if (!confirmed || regenerating) return
    setRegenerating(true)
    setRegenError(null)
    try {
      const res = await authFetch("/api/equipment/qr-token/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: refBody,
      })
      const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
      if (!res.ok || !json.token) {
        setRegenError(json.error || "Không tạo lại được QR")
        return
      }
      setToken(json.token)
      setRegenerated(true)
      setConfirmOpen(false)
      setConfirmed(false)
    } catch {
      setRegenError("Mất kết nối. Tem cũ có thể vẫn còn hiệu lực — mở lại để kiểm tra.")
    } finally {
      setRegenerating(false)
    }
  }

  const url = token ? buildEquipmentQrUrl(token) : ""

  return (
    <>
      <ModalShell title={`QR ${noun} ${asset.ma_tb}`} onClose={onClose} maxWidth="sm">
        <p className="text-sm font-semibold text-slate-700">{asset.ten_tb}</p>
        {error ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>
        ) : !token ? (
          <div className="mt-3 h-40 animate-pulse rounded-xl bg-slate-100" />
        ) : (
          <div className="mt-3 space-y-3">
            {regenerated && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                Đã tạo QR mới. Tem cũ đã ngừng hoạt động — hãy tải/in tem mới và dán thay.
              </p>
            )}
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
              Người chưa đăng nhập chỉ thấy tên, mã, loại, bộ phận và ngày bảo trì gần nhất
              {isVehicle ? " (không thấy biển số, tài xế)." : "."}
            </p>
            {canRegenerate && (
              <div className="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => { setConfirmOpen(true); setConfirmed(false); setRegenError(null) }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
                >
                  <RefreshCw size={13} /> Tạo lại QR
                </button>
                <p className="mt-1 text-[11px] text-slate-400">Dùng khi tem bị lộ/mất — tem cũ sẽ ngừng hoạt động.</p>
              </div>
            )}
          </div>
        )}
      </ModalShell>

      {confirmOpen && (
        <ModalShell
          title={`Tạo lại QR ${noun}?`}
          onClose={() => { if (!regenerating) setConfirmOpen(false) }}
          maxWidth="sm"
          zIndexClassName="z-[60]"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={regenerating}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Thôi
              </button>
              <button
                type="button"
                onClick={() => void handleRegenerate()}
                disabled={!confirmed || regenerating}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {regenerating ? "Đang tạo..." : "Tạo lại QR"}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-sm text-slate-700">
            <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>
                Tem QR cũ của <b>{asset.ma_tb}</b> sẽ <b>ngừng hoạt động ngay</b> — ai quét tem cũ sẽ thấy trang
                không tìm thấy. Bạn phải in và dán tem mới. Không hoàn tác được.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-red-600"
              />
              <span className="text-sm font-semibold text-slate-700">
                Tôi hiểu tem cũ của {asset.ma_tb} sẽ ngừng hoạt động và cần dán tem mới.
              </span>
            </label>
            {regenError && <p className="text-sm font-semibold text-red-600">{regenError}</p>}
          </div>
        </ModalShell>
      )}
    </>
  )
}
