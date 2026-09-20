"use client"

import { useEffect, useState } from "react"
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  User,
  Copy,
  Check,
  ExternalLink,
  FileText,
  X,
  Lock,
  Hash,
  Loader2,
} from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { openSecureFile } from "@/app/dashboard/_components/secure-file-open"
import { getFreshAuthSession } from "@/lib/auth"
import type { ThuTuKyStep } from "@/app/dashboard/iso/_components/iso-types"

/** Route `/file-hash` trả `{ hash }`, khác hình dạng `{ url }` của `fetchSecureUrl` dùng chung —
 * viết riêng 1 hàm fetch nhỏ thay vì ép vào `fetchSecureUrl`. */
async function fetchFileHash(instanceId: string): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
  const session = await getFreshAuthSession()
  const token = session?.access_token
  if (!token) return { ok: false, error: "Phiên đăng nhập đã hết hạn, vui lòng tải lại trang." }
  try {
    const res = await fetch(`/api/iso/forms/${instanceId}/file-hash`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await res.json()) as { hash?: string; error?: string }
    if (!res.ok || !json.hash) return { ok: false, error: json.error || "Không tính được mã băm" }
    return { ok: true, hash: json.hash }
  } catch {
    return { ok: false, error: "Lỗi kết nối khi tính mã băm" }
  }
}

export type SignerInfoEntry = {
  buoc?: number
  ten?: string | null
  chuc_vu?: string | null
  user_id?: string | null
  ky_at?: string | null
  ky_nhay?: boolean
}

export type IsoFormVerifyModalProps = {
  instance: {
    id: string
    tieu_de?: string | null
    trang_thai: string
    cap_tl?: string | null
    so_buoc_tong?: number | null
    buoc_hien_tai?: number | null
    thu_tu_ky_json?: ThuTuKyStep[] | null
    nguoi_ky?: Record<string, SignerInfoEntry> | null
    final_pdf_url?: string | null
    soan_thao_signed_url?: string | null
    draft_file_url?: string | null
    created_at?: string
    updated_at?: string
    soan_thao?: string | null
    xem_xet?: string | null
    phe_duyet?: string | null
    ky_soan_thao_at?: string | null
    ky_xem_xet_at?: string | null
    ky_phe_duyet_at?: string | null
  }
  onClose: () => void
}

function fmtDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "—"
  try {
    const d = new Date(isoString)
    if (Number.isNaN(d.getTime())) return isoString
    return d.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  } catch {
    return isoString
  }
}

export function IsoFormVerifyModal({ instance, onClose }: IsoFormVerifyModalProps) {
  const hasPdf = !!(instance.final_pdf_url || instance.soan_thao_signed_url || instance.draft_file_url)

  const [copied, setCopied] = useState(false)
  const [fileHash, setFileHash] = useState<string | null>(null)
  // Khởi tạo "đang tính" ngay từ giá trị ban đầu (thay vì gọi setState(true) đồng bộ trong
  // effect) — tránh lỗi react-hooks/set-state-in-effect. Effect chỉ còn tắt cờ này khi xong.
  const [calculatingHash, setCalculatingHash] = useState(hasPdf)

  // Vá bảo mật 2026-09-20: mã băm SHA-256 nay được tính TRỰC TIẾP ở server (route
  // `/api/iso/forms/[id]/file-hash`, tải object bằng service role) thay vì trình duyệt tự
  // `fetch()` nguyên file PDF từ URL public — bucket `iso-documents` sẽ chuyển private, và cách
  // này còn đỡ tốn băng thông người dùng hơn hẳn.
  useEffect(() => {
    if (!hasPdf) {
      setCalculatingHash(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const result = await fetchFileHash(instance.id)
        if (!alive) return
        if (result.ok) {
          setFileHash(result.hash)
        } else {
          console.warn("[IsoFormVerifyModal] Calculate hash error:", result.error)
        }
      } finally {
        if (alive) setCalculatingHash(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [hasPdf, instance.id])

  const handleCopyHash = () => {
    if (!fileHash) return
    void navigator.clipboard.writeText(fileHash)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Danh sách các bước ký
  const stepsList: Array<{
    stepLabel: string
    signerName: string
    role: string
    signedAt: string | null
    isDone: boolean
  }> = []

  const isNStep = (instance.so_buoc_tong ?? 0) > 0 && Array.isArray(instance.thu_tu_ky_json)

  if (isNStep && instance.thu_tu_ky_json) {
    instance.thu_tu_ky_json.forEach((step, idx) => {
      const stepKey = `buoc_${idx}`
      const signer = instance.nguoi_ky?.[stepKey]
      const name = signer?.ten || step.ten || "—"
      const role = signer?.chuc_vu || step.chuc_vu || (idx === 0 ? "Người lập" : idx === (instance.so_buoc_tong ?? 1) - 1 ? "Phê duyệt" : "Xem xét")
      const signedAt = signer?.ky_at || null
      stepsList.push({
        stepLabel: `Bước ${idx + 1}: ${step.ten || (idx === 0 ? "Người lập" : "Ký duyệt")}`,
        signerName: name,
        role,
        signedAt,
        isDone: !!signedAt,
      })
    })
  } else {
    // Luồng cũ 2 hoặc 3 bước
    if (instance.soan_thao) {
      stepsList.push({
        stepLabel: "Bước 1: Soạn thảo / Lập hồ sơ",
        signerName: instance.soan_thao,
        role: "Người soạn thảo",
        signedAt: instance.ky_soan_thao_at || null,
        isDone: !!instance.ky_soan_thao_at,
      })
    }
    if (instance.cap_tl === "Cấp 1" && instance.xem_xet) {
      stepsList.push({
        stepLabel: "Bước 2: Xem xét",
        signerName: instance.xem_xet,
        role: "Người xem xét",
        signedAt: instance.ky_xem_xet_at || null,
        isDone: !!instance.ky_xem_xet_at,
      })
    }
    if (instance.phe_duyet) {
      stepsList.push({
        stepLabel: instance.cap_tl === "Cấp 1" ? "Bước 3: Phê duyệt" : "Bước 2: Phê duyệt",
        signerName: instance.phe_duyet,
        role: "Người phê duyệt",
        signedAt: instance.ky_phe_duyet_at || null,
        isDone: !!instance.ky_phe_duyet_at,
      })
    }
  }

  const allCompleted = stepsList.length > 0 && stepsList.every((s) => s.isDone)

  return (
    <ModalShell
      title={
        <span className="flex items-center gap-3">
          <span className="p-2 bg-emerald-100 text-emerald-700 rounded-xl shadow-xs">
            <ShieldCheck size={20} />
          </span>
          <span>
            <span className="font-extrabold text-slate-800 block text-base">Xác minh Chữ ký số &amp; Tính toàn vẹn</span>
            <span className="text-xs text-slate-500 font-normal">Hồ sơ ISO: {instance.tieu_de || "Hồ sơ thực hiện"}</span>
          </span>
        </span>
      }
      onClose={onClose}
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          {hasPdf && (
            <button
              type="button"
              onClick={() => void openSecureFile(`/api/iso/forms/${instance.id}/file-url`)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
            >
              <ExternalLink size={13} /> Mở bản PDF ký duyệt
            </button>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-xl transition-all shadow-xs ml-auto"
          >
            Đóng
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Banner trạng thái xác thực */}
        <div className={`p-4 rounded-2xl border flex items-start gap-3 ${
          allCompleted
            ? "bg-emerald-50/80 border-emerald-200 text-emerald-900"
            : "bg-amber-50/80 border-amber-200 text-amber-900"
        }`}>
          <div className={`p-1.5 rounded-xl shrink-0 mt-0.5 ${
            allCompleted ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
          }`}>
            <CheckCircle2 size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm">
              {allCompleted
                ? "Hồ sơ đã được ký duyệt đầy đủ & niêm phong toàn vẹn"
                : "Hồ sơ đang trong quá trình luân chuyển ký duyệt"}
            </div>
            <p className="text-xs mt-0.5 opacity-90">
              {allCompleted
                ? "Tất cả các chữ ký điện tử đã được xác thực PIN nội bộ và đóng dấu vào tệp PDF theo quy chuẩn ISO."
                : "Chưa hoàn tất toàn bộ các bước ký phê duyệt."}
            </p>
          </div>
        </div>

        {/* Danh sách các lượt ký */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <User size={13} className="text-violet-600" /> Tiến trình ký duyệt theo bước
            </h4>
            <span className="text-[11px] font-semibold text-slate-500">
              {stepsList.filter((s) => s.isDone).length}/{stepsList.length} bước hoàn tất
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {stepsList.map((step, idx) => (
              <div key={`step_${idx}`} className="py-2.5 first:pt-1 last:pb-1 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800">{step.stepLabel}</span>
                    {step.isDone ? (
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold">
                        <CheckCircle2 size={10} /> Đã ký
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[10px] font-medium">
                        <Clock size={10} /> Chờ ký
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    <span className="font-semibold text-slate-900">{step.signerName}</span>
                    {step.role && <span className="text-slate-500"> ({step.role})</span>}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  {step.isDone && step.signedAt ? (
                    <div className="text-[11px] font-mono text-emerald-700 font-semibold flex items-center gap-1">
                      <Clock size={11} className="text-emerald-500" />
                      {fmtDateTime(step.signedAt)}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400 italic">—</span>
                  )}
                  {step.isDone && (
                    <span className="text-[10px] text-slate-400 block mt-0.5">Xác thực PIN ✓</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mã băm SHA-256 bảo vệ tính toàn vẹn (Integrity Check) */}
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Hash size={13} className="text-sky-600" /> Mã băm toàn vẹn (SHA-256)
            </h4>
            {fileHash && (
              <button
                type="button"
                onClick={handleCopyHash}
                className="flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 font-bold"
              >
                {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                {copied ? "Đã sao chép" : "Sao chép mã hash"}
              </button>
            )}
          </div>

          <p className="text-[11px] text-slate-500">
            Mã băm mật mã học được tính toán trực tiếp từ dữ liệu tệp PDF hoàn tất để bảo đảm tệp không bị chỉnh sửa sau khi ký.
          </p>

          <div className="bg-white border border-slate-200 rounded-lg p-2.5 font-mono text-[11px] text-slate-700 break-all select-all flex items-center">
            {calculatingHash ? (
              <span className="flex items-center gap-1.5 text-slate-400 italic">
                <Loader2 size={12} className="animate-spin" /> Đang tính toán mã băm SHA-256 từ tệp PDF...
              </span>
            ) : fileHash ? (
              fileHash
            ) : (
              <span className="text-slate-400 italic">Chưa có tệp PDF ký hoàn tất để tính mã băm.</span>
            )}
          </div>
        </div>

        {/* Thông tin hồ sơ */}
        <div className="text-[11px] text-slate-400 flex items-center justify-between px-1">
          <span>Mã định danh: <span className="font-mono">{instance.id}</span></span>
          <span>Cấp quy trình: <span className="font-semibold text-slate-600">{instance.cap_tl || "Cấp 1"}</span></span>
        </div>
      </div>
    </ModalShell>
  )
}
