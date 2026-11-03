"use client"

import type { ReactNode } from "react"
import { DetailPageHeader } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"

type ActionInfo = { at: string; byName: string | null } | null

function formatActionAt(at: string) {
  const date = new Date(at)
  return `${date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} ngày ${date.toLocaleDateString("vi-VN")}`
}

/**
 * Header dùng chung của form phiếu Nhập / Xuất / Chuyển kho — dựng trên `DetailPageHeader` (chuẩn rule 29):
 * quay lại + tiêu đề + mã phiếu + badge trạng thái + mốc ghi sổ / phê duyệt; `actions` là các `HeaderButton`.
 */
export function InventoryFormHeader({
  onBack,
  eyebrow,
  title,
  code,
  documentStatus,
  hasDocument,
  postedInfo,
  approvedInfo,
  approvalApplies = true,
  actions,
}: {
  onBack: () => void
  eyebrow: string
  title: string
  code?: string | null
  documentStatus: "draft" | "posted" | "cancelled" | null
  hasDocument: boolean
  postedInfo: ActionInfo
  approvedInfo: ActionInfo
  /** Phiếu Chuyển kho không có bước phê duyệt ⇒ false. */
  approvalApplies?: boolean
  actions?: ReactNode
}) {
  const statusKey =
    documentStatus === "posted"
      ? approvalApplies && !approvedInfo
        ? "cho_duyet"
        : "posted"
      : documentStatus || "draft"

  return (
    <DetailPageHeader
      onBack={onBack}
      eyebrow={eyebrow}
      title={title}
      code={code}
      tags={
        <>
          <StatusBadge domain="inventory" status={statusKey} label={!documentStatus && !hasDocument ? "Chưa lưu" : undefined} />
          {approvedInfo ? <StatusBadge tone="info" label="Đã phê duyệt" /> : null}
        </>
      }
      subtitle={
        postedInfo || approvedInfo ? (
          <span className="flex flex-col gap-0.5">
            {postedInfo ? (
              <span>
                Ghi sổ lúc {formatActionAt(postedInfo.at)}
                {postedInfo.byName ? ` bởi ${postedInfo.byName}` : ""}
              </span>
            ) : null}
            {approvedInfo ? (
              <span>
                Phê duyệt lúc {formatActionAt(approvedInfo.at)}
                {approvedInfo.byName ? ` bởi ${approvedInfo.byName}` : ""}
              </span>
            ) : null}
          </span>
        ) : null
      }
      actions={actions}
    />
  )
}
