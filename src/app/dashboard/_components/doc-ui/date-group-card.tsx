"use client"

import { useState, type ReactNode } from "react"
import { ExpandableRow, ExpandHeaderCell } from "./expandable-row"

/**
 * Nhóm theo NGÀY dùng chung (Kiểm nghiệm U3, Thành phẩm/Sản lượng U7) — theo QUY TẮC DÒNG MỞ RỘNG
 * (rule 05, 2026-10-14), KHÔNG còn dạng khung riêng cho mỗi ngày:
 * - Mọi ngày là các dòng liền nhau trong MỘT `<table className="enterprise-table dense">`.
 * - Dòng cha: [ngày + phụ đề] · [chip tóm tắt] · [ô ký] · [cụm thao tác + mũi tên ở ô cuối].
 * - Bấm vào dòng mở/thu; nút/link trong `sign`/`actions` tự chặn nổi bọt (bọc sẵn ở đây).
 * - `children` = bảng con của ngày đó, hiện ngay dưới dòng, thụt vào với viền trái `mod-600`.
 * Điều khiển được (`open` + `onToggle`, dùng kèm `ExpandAllToggle`) hoặc tự quản (`defaultOpen`).
 *
 * Cách dùng:
 *   <table className="enterprise-table dense">
 *     <DateGroupHead />
 *     <tbody>{days.map((d) => <DateGroupRow key={d} title={...} ...>{bảng con}</DateGroupRow>)}</tbody>
 *   </table>
 */
export const DATE_GROUP_COLS = 4

export function DateGroupHead({
  dateLabel = "Ngày",
  summaryLabel = "Tóm tắt",
  signLabel = "Ký duyệt",
  endLabel = "Thao tác",
  hideSign = false,
}: {
  dateLabel?: ReactNode
  summaryLabel?: ReactNode
  signLabel?: ReactNode
  endLabel?: ReactNode
  /** Module không có ký số theo ngày ⇒ ẩn cột ký (nhớ truyền `hideSign` cho từng DateGroupRow). */
  hideSign?: boolean
}) {
  return (
    <thead>
      <tr>
        <th>{dateLabel}</th>
        <th>{summaryLabel}</th>
        {!hideSign && <th>{signLabel}</th>}
        <ExpandHeaderCell>{endLabel}</ExpandHeaderCell>
      </tr>
    </thead>
  )
}

export function DateGroupRow({
  title,
  subtitle,
  summary,
  sign,
  actions,
  open,
  defaultOpen = false,
  onToggle,
  hideSign = false,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  summary?: ReactNode
  sign?: ReactNode
  actions?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onToggle?: (next: boolean) => void
  hideSign?: boolean
  children?: ReactNode
}) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen)
  const isOpen = open ?? innerOpen
  const toggle = () => {
    const next = !isOpen
    if (open === undefined) setInnerOpen(next)
    onToggle?.(next)
  }
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  return (
    <ExpandableRow
      expanded={isOpen}
      onToggle={toggle}
      canExpand={children != null}
      colSpan={hideSign ? DATE_GROUP_COLS - 1 : DATE_GROUP_COLS}
      label="Xem chi tiết ngày"
      detail={children != null ? <div className="overflow-x-auto">{children}</div> : undefined}
      endCell={
        actions ? (
          <span onClick={stop} onKeyDown={stop} className="flex items-center gap-0.5">
            {actions}
          </span>
        ) : undefined
      }
    >
      <td className="whitespace-nowrap">
        <div className="font-extrabold text-slate-900">{title}</div>
        {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
      </td>
      <td>{summary && <div className="flex min-w-0 flex-wrap items-center gap-1.5">{summary}</div>}</td>
      {!hideSign && (
        <td onClick={sign ? stop : undefined} onKeyDown={sign ? stop : undefined}>
          {sign && <div className="flex flex-wrap items-center gap-1.5">{sign}</div>}
        </td>
      )}
    </ExpandableRow>
  )
}
