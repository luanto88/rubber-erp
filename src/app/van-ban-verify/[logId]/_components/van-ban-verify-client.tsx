"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"

// Mirror src/app/sign-verify/[nguoiKyId]/_components/sign-verify-client.tsx (hệ ký dùng chung).
// Bản riêng cho Văn bản nội bộ vì module này dùng hệ ký RIÊNG, định danh chữ ký theo dòng
// `doc_approval_log` chứ không phải bản ghi `nguoi_ky`, và hiển thị thêm mã/tên văn bản.

type VerifyResponse = {
  signerName: string
  buoc: string
  kyLuc: string | null
  maVanBan: string | null
  tenVanBan: string | null
  trangThaiVanBan: string | null
  contentHash: string | null
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

const TRANG_THAI_LABEL: Record<string, string> = {
  draft: "Nháp",
  cho_ky_phong_ban: "Chờ ký",
  cho_phe_duyet: "Chờ phê duyệt",
  da_phe_duyet: "Đã phê duyệt",
  tra_ve: "Trả về",
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`font-bold text-slate-800 text-right ${mono ? "font-mono text-xs break-all" : ""}`}>
        {value}
      </span>
    </div>
  )
}

export function VanBanVerifyClient({ logId }: { logId: string }) {
  const [data, setData] = useState<VerifyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/documents/verify/${logId}`)
        const json = (await res.json()) as VerifyResponse
        if (!res.ok) throw new Error(json.error || "Không xác thực được")
        if (alive) setData(json)
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : "Lỗi không xác định")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [logId])

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
          {!data.valid && data.reason && <p className="text-sm text-red-600 mt-0.5">{data.reason}</p>}
        </div>
      </div>

      <div className="p-6 space-y-3 text-sm">
        {data.maVanBan && <Row label="Số/Mã văn bản" value={data.maVanBan} />}
        {data.tenVanBan && <Row label="Trích yếu" value={data.tenVanBan} />}
        <Row label="Bước ký" value={data.buoc} />
        <Row label="Người ký" value={data.signerName} />
        <Row
          label="Thời gian ký"
          value={data.kyLuc ? new Date(data.kyLuc).toLocaleString("vi-VN") : "—"}
        />
        {data.trangThaiVanBan && (
          <Row
            label="Trạng thái văn bản"
            value={TRANG_THAI_LABEL[data.trangThaiVanBan] || data.trangThaiVanBan}
          />
        )}
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
          {data.contentHash && (
            <div className="pt-2 border-t border-slate-200/70">
              <p className="text-slate-400 mb-0.5">Mã băm toàn vẹn nội dung (SHA-256)</p>
              <p className="font-mono text-[10px] text-slate-600 break-all">{data.contentHash}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
