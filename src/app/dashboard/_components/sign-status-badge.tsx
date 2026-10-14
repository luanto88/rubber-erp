"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, Loader2, PenTool, RotateCcw, XCircle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { computeMyTurn, hasAnySigned, type MyTurnSigner } from "@/app/dashboard/_components/signing-my-turn"

/**
 * Ô "Ký duyệt" DÙNG CHUNG (U0, 2026-10-14) — gộp QualitySignStatusBadge / DispatchSignStatusBadge /
 * MaintenanceSignStatusBadge. Logic GIỮ NGUYÊN (computeMyTurn, hasAnySigned, POST
 * /api/signing/cancel-request), chỉ thống nhất hình thức: chip bằng StatusBadge, "Ký ngay" là nút
 * brand (hành động ⇒ luôn brand, phương án C). Mỗi module tự chuyển sang ở giai đoạn của mình
 * (U1 Bảo trì, U2 Điều xe, U3 Kiểm nghiệm) — 3 badge cũ chưa bị xoá.
 *
 * Khác nhau giữa các module được truyền bằng props:
 * - `continueRule`: "approver" (Kiểm nghiệm/Điều xe: admin hoặc đúng `pheDuyetUserId` mới vào
 *   màn ký) | "participant" (Bảo trì: admin hoặc bất kỳ ai trong `signers`).
 * - `showProgress`: hiện "(n/N)" trên chip.
 * - `hideWhenCannotCreate`: chưa có yêu cầu + không có quyền ⇒ ẩn hẳn (Bảo trì) thay vì chip xám.
 */

export type SignStatusSigner = MyTurnSigner & { hoTen?: string; vaiTro?: string }

export type SignStatusData = {
  yeuCauId: string
  trangThai: "dang_luan_chuyen" | "hoan_tat"
  nguoiTao: string
  fileHienTai: string | null
  traVeLyDo: string | null
  dataChanged: boolean
  signers: SignStatusSigner[]
  pheDuyetUserId?: string | null
}

export function SignStatusBadge({
  status,
  currentUser,
  canCreate,
  onOpenSignPrompt,
  onCancelled,
  showToast,
  continueRule,
  showProgress = false,
  hideWhenCannotCreate = false,
  blockedReason,
  cancelMessage = "Hủy yêu cầu ký này? Sau khi hủy, có thể bấm “Gửi ký duyệt” để tạo yêu cầu mới từ đầu.",
  dataChangedTitle = "Dữ liệu đã được sửa SAU khi ký duyệt xong — file đã ký không còn khớp dữ liệu hiện tại.",
  chipOnly = false,
}: {
  status: SignStatusData | undefined
  currentUser: SessionUser
  canCreate: boolean
  onOpenSignPrompt: () => void
  onCancelled: () => void
  showToast: (msg: string, ok?: boolean) => void
  continueRule: "approver" | "participant"
  showProgress?: boolean
  hideWhenCannotCreate?: boolean
  /** Có giá trị ⇒ khoá nút "Gửi ký duyệt" (vd Bảo trì: kho tạm KT chưa đủ vật tư). */
  blockedReason?: string | null
  cancelMessage?: string
  dataChangedTitle?: string
  /**
   * Chỉ hiện chip trạng thái (+ lý do trả về, nút "Hủy yêu cầu") — KHÔNG hiện các nút hành động
   * "Gửi ký duyệt" / "Ký ngay" / "Sửa & ký lại". Dùng ở trang chi tiết, nơi các hành động đó đã là
   * nút chính của `SignActionBox` (tránh 1 hành động xuất hiện 2 lần).
   */
  chipOnly?: boolean
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

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  // 1. Chưa có yêu cầu ký.
  if (!status) {
    if (chipOnly) return <StatusBadge tone="draft" label="Chưa gửi ký duyệt" size="xs" />
    if (!canCreate) {
      return hideWhenCannotCreate ? null : <StatusBadge tone="draft" label="Chưa gửi ký duyệt" size="xs" />
    }
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenSignPrompt()
        }}
        disabled={!!blockedReason}
        title={blockedReason || undefined}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-bold text-brand-800 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <PenTool size={12} /> Gửi ký duyệt
      </button>
    )
  }

  const signedCount = status.signers.filter((s) => s.trangThai === "da_ky").length
  const totalCount = status.signers.length
  const progress = showProgress && totalCount > 0 ? ` (${signedCount}/${totalCount})` : ""

  // 2. Đã hoàn tất.
  if (status.trangThai === "hoan_tat") {
    if (status.dataChanged) {
      return (
        <span
          title={dataChangedTitle}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#fde68a] bg-[#fffbeb] px-2.5 py-0.5 text-xs font-semibold leading-5 text-[#92400e]"
        >
          <AlertTriangle size={12} /> Đã ký — dữ liệu đã đổi
        </span>
      )
    }
    return <StatusBadge tone="valid" label={`Đã ký duyệt${progress}`} />
  }

  // 3. Đang luân chuyển — phân theo người xem.
  const isAdmin = currentUser.role === "admin"
  const isCreator = currentUser.id === status.nguoiTao
  const canContinueSign =
    isAdmin ||
    (continueRule === "approver"
      ? !!status.pheDuyetUserId && currentUser.id === status.pheDuyetUserId
      : status.signers.some((s) => s.userId === currentUser.id))
  // Đã có người ký thì không cho hủy (chỉ còn "Trả về") — backend cũng chặn riêng.
  const canCancel = (isAdmin || isCreator) && !hasAnySigned(status.signers)

  const cancelButton = canCancel ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setConfirmCancel(true)
      }}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-0.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50"
    >
      <XCircle size={12} /> Hủy yêu cầu
    </button>
  ) : null

  const modal = confirmCancel ? (
    <ModalShell
      title="Hủy yêu cầu ký"
      onClose={() => !cancelling && setConfirmCancel(false)}
      maxWidth="sm"
      footer={
        <>
          <button
            onClick={() => setConfirmCancel(false)}
            disabled={cancelling}
            className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Để sau
          </button>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-5 py-2 font-bold text-white shadow-md hover:bg-red-700 disabled:opacity-60"
          >
            {cancelling && <Loader2 size={14} className="animate-spin" />}
            Hủy yêu cầu
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{cancelMessage}</p>
    </ModalShell>
  ) : null

  // 3a. Vừa bị trả về (chưa ai ký lại).
  if (status.traVeLyDo) {
    const canResign = isAdmin || isCreator
    return (
      <>
        <div className="flex flex-col gap-1" onClick={stop}>
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone="returned" label="Trả về" />
            {canResign && !chipOnly && (
              <Link
                href={`/dashboard/ky/${status.yeuCauId}`}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-bold text-rose-700 hover:underline"
              >
                <RotateCcw size={12} /> Sửa &amp; ký lại
              </Link>
            )}
            {cancelButton}
          </span>
          <p className="max-w-[260px] truncate text-[11px] text-rose-700" title={status.traVeLyDo}>
            Lý do: {status.traVeLyDo}
          </p>
        </div>
        {modal}
      </>
    )
  }

  const myTurn = computeMyTurn(status.signers, currentUser.id)

  return (
    <>
      <span className="flex flex-wrap items-center gap-1.5" onClick={stop}>
        {myTurn && !chipOnly ? (
          <>
            <StatusBadge tone="pending" label={`Chờ ký${progress}`} />
            <Link
              href={`/dashboard/ky/${status.yeuCauId}`}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-gradient-to-br from-brand-500 to-brand-800 px-3 py-1 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90"
            >
              <PenTool size={12} /> Ký ngay
            </Link>
          </>
        ) : canContinueSign ? (
          <Link href={`/dashboard/ky/${status.yeuCauId}`} className="hover:opacity-80" title="Mở màn ký để xem tiến trình">
            <StatusBadge tone="pending" label={`Chờ ký duyệt${progress}`} />
          </Link>
        ) : (
          <StatusBadge tone="pending" label={`Chờ ký duyệt${progress}`} />
        )}
        {cancelButton}
      </span>
      {modal}
    </>
  )
}
