"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"

type VerifyResponse = {
  signerName: string
  vaiTro: string
  kyLuc: string | null
  valid: boolean
  reason?: string
  error?: string
  // Chỉ có khi valid === true — xem verifyPadesSignature() trong src/lib/signing/verify-pades.ts
  serialNumber?: string
  validFrom?: string
  validTo?: string
  keyAlgorithm?: string
  digestAlgorithm?: string
}

const VAI_TRO_LABEL: Record<string, string> = {
  ky: "Người ký",
  phe_duyet: "Người phê duyệt",
  nhan_ban_sao: "Nhận bản sao",
}

export function SignVerifyClient({ nguoiKyId }: { nguoiKyId: string }) {
  const [data, setData] = useState<VerifyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/signing/verify/${nguoiKyId}`)
        const json = (await res.json()) as VerifyResponse
        if (!res.ok) throw new Error(json.error || "Không xác thực được")
        if (alive) setData(json)
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : "Lỗi không xác định")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [nguoiKyId])

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-8 flex items-center justify-center gap-2 text-slate-500">
        <Loader2 size={18} className="animate-spin" /> Đang xác thực chữ ký...
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-8 text-center text-red-600 font-semibold">
        {loadError || "Không tải được thông tin chữ ký"}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
      <div className={`p-6 flex items-center gap-3 ${data.valid ? "bg-emerald-50" : "bg-red-50"}`}>
        {data.valid ? (
          <CheckCircle2 size={32} className="text-emerald-600 shrink-0" />
        ) : (
          <XCircle size={32} className="text-red-600 shrink-0" />
        )}
        <div>
          <p className={`text-lg font-extrabold ${data.valid ? "text-emerald-700" : "text-red-700"}`}>
            {data.valid ? "Chữ ký hợp lệ" : "Không xác minh được"}
          </p>
          {!data.valid && data.reason && (
            <p className="text-sm text-red-600 mt-0.5">{data.reason}</p>
          )}
        </div>
      </div>
      <div className="p-6 space-y-3 text-sm">
        <div className="flex justify-between border-b border-slate-100 pb-2">
          <span className="text-slate-500">Vai trò</span>
          <span className="font-bold text-slate-800">{VAI_TRO_LABEL[data.vaiTro] || data.vaiTro}</span>
        </div>
        <div className="flex justify-between border-b border-slate-100 pb-2">
          <span className="text-slate-500">Người ký</span>
          <span className="font-bold text-slate-800">{data.signerName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Thời gian ký</span>
          <span className="font-bold text-slate-800">
            {data.kyLuc ? new Date(data.kyLuc).toLocaleString("vi-VN") : "—"}
          </span>
        </div>
      </div>
      {data.valid && (
        <div className="border-t border-slate-100 p-6 space-y-2 text-xs bg-slate-50/60">
          <p className="font-bold text-slate-500 mb-1">Thông tin kỹ thuật chữ ký số</p>
          <div className="flex justify-between">
            <span className="text-slate-400">Thuật toán</span>
            <span className="font-semibold text-slate-600">
              {data.keyAlgorithm} + {data.digestAlgorithm}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Tổ chức phát hành</span>
            <span className="font-semibold text-slate-600 text-right">
              Chứng thư số nội bộ do hệ thống Rubber ERP tự phát hành
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Số hiệu chứng thư</span>
            <span className="font-mono font-semibold text-slate-600">{data.serialNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Hiệu lực từ</span>
            <span className="font-semibold text-slate-600">
              {data.validFrom ? new Date(data.validFrom).toLocaleString("vi-VN") : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Hiệu lực đến</span>
            <span className="font-semibold text-slate-600">
              {data.validTo ? new Date(data.validTo).toLocaleString("vi-VN") : "—"}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
