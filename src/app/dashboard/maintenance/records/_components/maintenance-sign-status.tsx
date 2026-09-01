"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, Bell, CheckCircle2, Clock, Loader2, PenTool, RotateCcw, XCircle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { computeMyTurn, hasAnySigned } from "@/app/dashboard/_components/signing-my-turn"

export type MaintenanceSignerStatus = { userId: string; thuTu: number; vaiTro: string; trangThai: string; hoTen: string }
export type MaintenanceSigningStatus = {
  recordId: string
  yeuCauId: string
  trangThai: "dang_luan_chuyen" | "hoan_tat"
  nguoiTao: string
  fileHienTai: string | null
  traVeLyDo: string | null
  signers: MaintenanceSignerStatus[]
  dataChanged: boolean
}

function CancelConfirmModal({
  cancelling,
  onClose,
  onConfirm,
}: {
  cancelling: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <ModalShell
      title="Hủy yêu cầu ký"
      onClose={() => !cancelling && onClose()}
      maxWidth="sm"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={cancelling}
            className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl disabled:opacity-50"
          >
            Để sau
          </button>
          <button
            onClick={onConfirm}
            disabled={cancelling}
            className="flex items-center gap-1.5 px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
          >
            {cancelling && <Loader2 size={14} className="animate-spin" />}
            Hủy yêu cầu
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        Hủy yêu cầu ký biên bản này? Sau khi hủy, có thể bấm &quot;Ký duyệt&quot; để tạo yêu
        cầu mới từ đầu.
      </p>
    </ModalShell>
  )
}

// Badge/hành động "Ký duyệt" cho bundle su_co_nho — KHÁC dispatch/quality (2 người, 1 người
// duyệt): su_co_nho có 4 người ký ngang hàng (BGĐ phụ trách/Nhân viên phụ trách/Tổ trưởng cơ
// điện-cơ khí/Giám đốc nhà máy), nên hiển thị tiến độ "N/4 đã ký" thay vì badge nhị phân.
export function MaintenanceSignStatusBadge({
  status,
  currentUser,
  canCreate,
  onOpenSignPrompt,
  onCancelled,
  showToast,
}: {
  status: MaintenanceSigningStatus | undefined
  currentUser: SessionUser
  canCreate: boolean
  onOpenSignPrompt: () => void
  onCancelled: () => void
  showToast: (msg: string, ok?: boolean) => void
}) {
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const handleCancel = async () => {
    if (!status) return
    setCancelling(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        showToast("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại", false)
        return
      }
      const res = await fetch("/api/signing/cancel-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ yeuCauId: status.yeuCauId }),
      })
      const json = (await res.json()) as { trangThai?: string; error?: string }
      if (!res.ok) {
        showToast(json.error || "Không hủy được yêu cầu ký", false)
        return
      }
      setConfirmCancel(false)
      showToast("Đã hủy yêu cầu ký — có thể tạo lại từ đầu.")
      onCancelled()
    } catch {
      showToast("Không thể kết nối máy chủ, vui lòng thử lại", false)
    } finally {
      setCancelling(false)
    }
  }

  // 1. Chưa có yêu cầu ký nào cho biên bản này.
  if (!status) {
    if (!canCreate) return null
    return (
      <button
        onClick={onOpenSignPrompt}
        className="flex items-center gap-1 px-2.5 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold rounded-lg transition-colors"
      >
        <PenTool size={12} /> Gửi ký duyệt
      </button>
    )
  }

  const signedCount = status.signers.filter((s) => s.trangThai === "da_ky").length
  const totalCount = status.signers.length

  // 2. Đã hoàn tất.
  if (status.trangThai === "hoan_tat") {
    if (status.dataChanged) {
      return (
        <span
          className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-100 text-amber-800 text-xs font-bold rounded-lg"
          title="Biên bản đã được sửa SAU khi ký duyệt xong — file đã ký không còn khớp dữ liệu hiện tại."
        >
          <AlertTriangle size={12} /> Đã ký — dữ liệu đã đổi
        </span>
      )
    }
    return (
      <span className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg">
        <CheckCircle2 size={12} /> Đã ký duyệt ({signedCount}/{totalCount})
      </span>
    )
  }

  // 3. Đang chờ ký — phân theo danh tính người xem.
  const isAdmin = currentUser.role === "admin"
  const isCreator = currentUser.id === status.nguoiTao
  const isParticipant = status.signers.some((s) => s.userId === currentUser.id)
  const canContinueSign = isAdmin || isParticipant
  // Đã có người ký thì không cho hủy nữa (chỉ còn "Trả về") — backend cũng chặn cứng riêng.
  const canCancel = (isAdmin || isCreator) && !hasAnySigned(status.signers)

  // 3a. Vừa bị 1 người ký trước "Trả về" (chưa ai ký lại).
  if (status.traVeLyDo) {
    const canResign = isAdmin || isCreator
    return (
      <>
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            {canResign ? (
              <Link
                href={`/dashboard/ky/${status.yeuCauId}`}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg transition-colors"
              >
                <RotateCcw size={12} /> Trả về — Sửa & ký lại
              </Link>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 text-rose-700 text-xs font-bold rounded-lg">
                <RotateCcw size={12} /> Đã trả về
              </span>
            )}
            {canCancel && (
              <button
                onClick={() => setConfirmCancel(true)}
                className="flex items-center gap-1 px-2 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg transition-colors"
              >
                <XCircle size={12} /> Hủy yêu cầu
              </button>
            )}
          </span>
          <p className="max-w-[260px] truncate text-[10px] text-rose-500" title={status.traVeLyDo}>
            Lý do: {status.traVeLyDo}
          </p>
        </div>
        {confirmCancel && (
          <CancelConfirmModal cancelling={cancelling} onClose={() => setConfirmCancel(false)} onConfirm={handleCancel} />
        )}
      </>
    )
  }

  const myTurn = computeMyTurn(status.signers, currentUser.id)

  return (
    <>
      <span className="flex items-center gap-1.5">
        {canContinueSign ? (
          <Link
            href={`/dashboard/ky/${status.yeuCauId}`}
            className={
              myTurn
                ? "flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
                : "flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-500 text-xs font-bold rounded-lg transition-colors"
            }
          >
            {myTurn ? <Bell size={12} /> : <Clock size={12} />}
            {myTurn ? `Chờ BẠN ký duyệt (${signedCount}/${totalCount})` : `Đang chờ ký duyệt (${signedCount}/${totalCount})`}
          </Link>
        ) : (
          <span className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 text-amber-500 text-xs font-bold rounded-lg">
            <Clock size={12} /> Chờ ký duyệt ({signedCount}/{totalCount})
          </span>
        )}
        {canCancel && (
          <button
            onClick={() => setConfirmCancel(true)}
            className="flex items-center gap-1 px-2 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg transition-colors"
          >
            <XCircle size={12} /> Hủy yêu cầu
          </button>
        )}
      </span>

      {confirmCancel && (
        <CancelConfirmModal cancelling={cancelling} onClose={() => setConfirmCancel(false)} onConfirm={handleCancel} />
      )}
    </>
  )
}
