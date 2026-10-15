"use client"

import { AlertTriangle, Loader2 } from "lucide-react"
import type { SessionUser } from "@/lib/auth"
import { buildStorageDownloadUrl } from "@/lib/storage-download"
import type { MaintenanceSignBundle } from "@/lib/maintenance-pdf"
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action"
import { IconActionGroup } from "@/app/dashboard/_components/doc-ui/icon-action"
import { SignStatusBadge } from "@/app/dashboard/_components/sign-status-badge"
import { openSecureFile } from "@/app/dashboard/_components/secure-file-open"
import type { MaintenanceSigningStatus } from "../records/_components/maintenance-sign-types"

// U1 (2026-10-14): cột "Ký duyệt" + "Thao tác" dùng chung cho Tổng quan và Danh sách biên bản.
// Chỉ đổi trình bày — điều kiện hiện nút, quyền, luồng huỷ/trả về giữ y như trước.

type SignState = {
  bundle: MaintenanceSignBundle | null
  status: MaintenanceSigningStatus | undefined
  loaded: boolean
  error: boolean
}

/** Ô "Ký duyệt": đang tải / lỗi (Thử lại) / SignStatusBadge (participant, có tiến độ n/N). */
export function MaintenanceSignCell({
  sign,
  user,
  canCreate,
  onRetry,
  onOpenSignPrompt,
  onCancelled,
  showToast,
}: {
  sign: SignState
  user: SessionUser | null
  canCreate: boolean
  onRetry: () => void
  onOpenSignPrompt: () => void
  onCancelled: () => void
  showToast: (msg: string, ok?: boolean) => void
}) {
  if (!sign.bundle) return <span className="text-xs text-slate-300">—</span>
  if (!sign.loaded) return <Loader2 size={14} className="animate-spin text-slate-300" />
  if (!sign.status && sign.error) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRetry()
        }}
        title="Không tải được trạng thái ký — bấm để thử lại"
        className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-50"
      >
        <AlertTriangle size={14} /> Thử lại
      </button>
    )
  }
  if (!user) return null
  return (
    <SignStatusBadge
      status={sign.status}
      currentUser={user}
      canCreate={canCreate}
      onOpenSignPrompt={onOpenSignPrompt}
      onCancelled={onCancelled}
      showToast={showToast}
      continueRule="participant"
      showProgress
      hideWhenCannotCreate
      cancelMessage="Hủy yêu cầu ký biên bản này? Sau khi hủy, có thể bấm “Gửi ký duyệt” để tạo yêu cầu mới từ đầu."
      dataChangedTitle="Biên bản đã được sửa SAU khi ký duyệt xong — file đã ký không còn khớp dữ liệu hiện tại."
    />
  )
}

/**
 * Cụm "Thao tác" theo từ điển: Xem chi tiết → File đã ký → Tải → In bản chưa ký.
 * File chỉ hiện khi trạng thái ký đã tải xong và KHÔNG lỗi (lỗi ⇒ không đoán là "chưa ký",
 * không render bản in chưa ký — bug 2026-09-26).
 */
export function MaintenanceRowActions({
  recordId,
  maBb,
  sign,
  canPrint,
  onError,
}: {
  recordId: string
  maBb: string | null
  sign: SignState
  canPrint: boolean
  /** Báo lỗi khi không mở được file (mặc định `alert`). */
  onError?: (msg: string) => void
}) {
  const showFiles = !!sign.bundle && sign.loaded && !(sign.error && !sign.status)
  const file = sign.status?.fileHienTai ?? null
  const done = sign.status?.trangThai === "hoan_tat"
  return (
    <IconActionGroup>
      <RowAction kind="view" label="Xem chi tiết biên bản" href={`/dashboard/maintenance/records/${recordId}`} />
      {showFiles && file ? (
        <>
          {/* Mở qua route app (token ngắn hạn) để trình xem PDF lưu ra "Biên bản {mã}.pdf" thay vì
              tên object "v4.pdf" (2026-10-14). */}
          <RowAction
            kind="signed"
            label={done ? "Xem file đã ký duyệt" : "Xem file đã ký (đang chờ ký tiếp)"}
            onClick={() => {
              const yeuCauId = sign.status?.yeuCauId
              if (!yeuCauId) return
              const name = encodeURIComponent(`Biên bản ${maBb || recordId}`)
              void openSecureFile(`/api/signing/requests/${yeuCauId}/file-url?view=1&name=${name}`).then((r) => {
                if (!r.ok) (onError ?? ((m: string) => window.alert(m)))(r.error)
              })
            }}
          />
          {/* ?download= của Supabase Storage — thuộc tính `download` không có tác dụng khác origin. */}
          <RowAction
            kind="download"
            label={done ? "Tải file đã ký duyệt về máy" : "Tải file đã ký (đang chờ ký tiếp)"}
            href={buildStorageDownloadUrl(file, `Biên bản ${maBb || recordId}`)}
          />
        </>
      ) : showFiles && canPrint && sign.bundle ? (
        <RowAction
          kind="draft"
          label="In biên bản (chưa ký)"
          href={`/dashboard/maintenance/print?type=${sign.bundle}&record_id=${recordId}`}
          target="_blank"
        />
      ) : null}
    </IconActionGroup>
  )
}

export type MaintenanceLineSummary = {
  ma_tb: string | null
  ten_tb: string | null
  noi_dung: string | null
  cac_khac_phuc: string | null
  chi_phi_dk: number | null
  loai_tien: string | null
  ten_tai_xe: string | null
  sort_order: number | null
}

/** Bảng con thiết bị/xe của 1 biên bản — dùng trong dòng xổ ở Tổng quan và Danh sách biên bản. */
export function MaintenanceLinesDetail({ lines, isXe }: { lines: MaintenanceLineSummary[]; isXe: boolean }) {
  const sorted = [...lines].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  return (
    <table className="enterprise-table dense min-w-[540px]">
      <thead>
        <tr>
          <th>{isXe ? "Mã xe" : "Mã TB"}</th>
          <th>{isXe ? "Xe" : "Thiết bị"}</th>
          {isXe && <th>Tài xế</th>}
          <th>Nội dung</th>
          <th className="text-right">Chi phí dự kiến</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((l, i) => (
          <tr key={`${l.ma_tb}-${i}`}>
            <td className="whitespace-nowrap font-code text-xs">{l.ma_tb || "—"}</td>
            <td className="whitespace-nowrap">{l.ten_tb || "—"}</td>
            {isXe && <td className="whitespace-nowrap">{l.ten_tai_xe || "—"}</td>}
            <td className="max-w-md">{l.cac_khac_phuc || l.noi_dung || "—"}</td>
            <td className="whitespace-nowrap text-right tabular-nums">
              {l.chi_phi_dk ? `${Number(l.chi_phi_dk).toLocaleString()} ${l.loai_tien || ""}` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
