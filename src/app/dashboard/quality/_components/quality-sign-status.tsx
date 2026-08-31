"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Clock, Loader2, PenTool, RotateCcw, XCircle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"

export type QualitySigningStatus = {
  date: string
  yeuCauId: string
  trangThai: "dang_luan_chuyen" | "hoan_tat"
  nguoiTao: string
  pheDuyetUserId: string | null
  fileHienTai: string | null
  traVeLyDo: string | null
  dataChanged: boolean
}

function CancelConfirmModal({
  date,
  cancelling,
  onClose,
  onConfirm,
}: {
  date: string
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
        Hủy yêu cầu ký ngày <b>{date}</b> đang chờ Trưởng phòng QLCL phê duyệt? Sau khi hủy, có thể
        bấm &quot;Gửi ký duyệt&quot; để tạo yêu cầu mới từ đầu.
      </p>
    </ModalShell>
  )
}

// Badge/hành động "Ký duyệt" theo trạng thái yeu_cau_ky của đúng ngày đó — thay cho nút "Ký
// duyệt" trơn cũ (không biết ngày nào đã ký). Các nhánh hiển thị theo đúng yêu cầu đã chốt với
// người dùng, xem plan "Chặn trùng Ký duyệt + hiện trạng thái ký trên danh sách Kiểm nghiệm"
// và mục "Trả về" (2026-09-05).
export function QualitySignStatusBadge({
  status,
  currentUser,
  canCreate,
  onOpenSignPrompt,
  onCancelled,
  showToast,
}: {
  status: QualitySigningStatus | undefined
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

  // 1. Chưa có yêu cầu ký nào cho ngày này — hiện đúng người (nút thật, không ẩn), người khác có
  // quyền xem vẫn thấy badge mờ để biết trạng thái, thay vì hoàn toàn không hiện gì.
  if (!status) {
    if (!canCreate) {
      return (
        <span className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-400 text-xs font-bold rounded-lg">
          <PenTool size={11} /> Chưa gửi ký duyệt
        </span>
      )
    }
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onOpenSignPrompt() }}
        className="flex items-center gap-1 px-2.5 py-1 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold rounded-lg transition-colors"
      >
        <PenTool size={11} /> Gửi ký duyệt
      </button>
    )
  }

  // 2. Đã hoàn tất — ai có quyền xem trang cũng mở được file đã ký (nút "Xem file" dạng
  // icon Eye đã có sẵn ngay cạnh trong hàng action của ngày, không lặp lại link ở đây).
  if (status.trangThai === "hoan_tat") {
    if (status.dataChanged) {
      return (
        <span
          className="flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-lg"
          title="Có phiếu kiểm nghiệm đã được thêm/sửa cho ngày này SAU khi đã ký duyệt — file đã ký không còn khớp dữ liệu hiện tại."
        >
          <AlertTriangle size={11} /> Đã ký — dữ liệu đã đổi
        </span>
      )
    }
    return (
      <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg">
        <CheckCircle2 size={11} /> Đã ký duyệt
      </span>
    )
  }

  // 3. Đang chờ ký duyệt — phân theo danh tính người xem.
  const isAdmin = currentUser.role === "admin"
  const isApprover = currentUser.id === status.pheDuyetUserId
  const isCreator = currentUser.id === status.nguoiTao
  const canContinueSign = isAdmin || isApprover
  const canCancel = isAdmin || isCreator

  // 3a. Vừa bị Trưởng phòng QLCL "Trả về" (chưa ai ký lại) — người tạo/admin cần sửa & ký
  // lại trên đúng yêu cầu này (khung của họ đã được reset về chưa ký trong SignScreen).
  if (status.traVeLyDo) {
    const canResign = isAdmin || isCreator
    return (
      <>
        <div onClick={(e) => e.stopPropagation()}>
          <span className="flex items-center gap-1.5">
            {canResign ? (
              <Link
                href={`/dashboard/ky/${status.yeuCauId}`}
                className="flex items-center gap-1 px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg transition-colors"
              >
                <RotateCcw size={11} /> Trả về — Sửa & ký lại
              </Link>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-400 text-xs font-bold rounded-lg">
                <RotateCcw size={11} /> Đã trả về
              </span>
            )}
            {canCancel && (
              <button
                onClick={() => setConfirmCancel(true)}
                className="flex items-center gap-1 px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg transition-colors"
              >
                <XCircle size={11} /> Hủy yêu cầu
              </button>
            )}
          </span>
          {/* Lý do hiện rõ thành chữ (không chỉ nằm trong title/tooltip — bug đã báo
              2026-09-08: người Lập biểu không biết cần sửa gì vì phải hover mới thấy). */}
          <p className="mt-1 max-w-[220px] truncate text-[10px] text-rose-500" title={status.traVeLyDo}>
            Lý do: {status.traVeLyDo}
          </p>
        </div>
        {confirmCancel && (
          <CancelConfirmModal
            date={status.date}
            cancelling={cancelling}
            onClose={() => setConfirmCancel(false)}
            onConfirm={handleCancel}
          />
        )}
      </>
    )
  }

  return (
    <>
      <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {canContinueSign ? (
          <Link
            href={`/dashboard/ky/${status.yeuCauId}`}
            className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold rounded-lg transition-colors"
          >
            <Clock size={11} /> Chờ ký duyệt
          </Link>
        ) : (
          <span className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-400 text-xs font-bold rounded-lg">
            <Clock size={11} /> Chờ ký duyệt
          </span>
        )}
        {canCancel && (
          <button
            onClick={() => setConfirmCancel(true)}
            className="flex items-center gap-1 px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg transition-colors"
          >
            <XCircle size={11} /> Hủy yêu cầu
          </button>
        )}
      </span>

      {confirmCancel && (
        <CancelConfirmModal
          date={status.date}
          cancelling={cancelling}
          onClose={() => setConfirmCancel(false)}
          onConfirm={handleCancel}
        />
      )}
    </>
  )
}
