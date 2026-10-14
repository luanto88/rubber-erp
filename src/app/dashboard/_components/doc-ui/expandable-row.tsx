"use client"

import { Fragment, type ReactNode } from "react"
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react"

/**
 * Dòng bảng có chi tiết con (U1, 2026-10-14 — quy tắc người dùng chốt):
 * - Mũi tên XUỐNG ở ô CUỐI dòng (góc phải); mũi tên CHỈ để mở/thu, không bao giờ chuyển trang.
 * - Bấm vào đâu trên dòng cũng mở/thu; nút/link bên trong dòng tự chặn nổi bọt (IconAction,
 *   RowAction, DocCodeLink...). Nút tự viết trong dòng phải `e.stopPropagation()`.
 * - Các dòng liền nhau trong MỘT bảng (`enterprise-table`), không chia khung; chi tiết thụt vào
 *   với viền trái màu module (`mod-600`).
 * - Ô cuối có class `sticky-end` ⇒ ghim phải khi bảng cuộn ngang trên điện thoại. Header của cột
 *   đó cũng phải mang `sticky-end` (dùng <ExpandHeaderCell/>).
 * - `canExpand=false` ⇒ vẫn giữ ô cuối (trống) để cột thẳng hàng.
 * `children` là các <td> của dòng cha (KHÔNG gồm ô mũi tên). `colSpan` = tổng số cột kể cả ô mũi tên.
 */
export function ExpandableRow({
  expanded,
  onToggle,
  canExpand = true,
  colSpan,
  detail,
  label = "Xem chi tiết dòng",
  endCell,
  children,
}: {
  expanded: boolean
  onToggle: () => void
  canExpand?: boolean
  colSpan: number
  detail?: ReactNode
  label?: string
  /** Nội dung đặt TRƯỚC mũi tên trong ô cuối (vd cụm thao tác) — cả ô được ghim trên điện thoại. */
  endCell?: ReactNode
  children: ReactNode
}) {
  const open = canExpand && expanded
  return (
    <Fragment>
      <tr
        className={canExpand ? "cursor-pointer" : undefined}
        aria-expanded={canExpand ? open : undefined}
        onClick={canExpand ? onToggle : undefined}
      >
        {children}
        <td className="sticky-end w-px whitespace-nowrap text-right">
          <div className="flex items-center justify-end gap-0.5">
            {endCell}
            {canExpand ? (
              <button
                type="button"
                aria-label={open ? "Thu gọn" : label}
                title={open ? "Thu gọn" : label}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle()
                }}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  open ? "bg-mod-50 text-mod-800" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                }`}
              >
                <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
            ) : (
              <span className="inline-block h-8 w-8 shrink-0" aria-hidden />
            )}
          </div>
        </td>
      </tr>
      {open && detail != null && (
        <tr className="expand-detail">
          <td colSpan={colSpan}>
            <div className="border-l-[3px] border-mod-600 pl-4">{detail}</div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

/** Ô tiêu đề cho cột cuối (thao tác + mũi tên) — ghim phải cùng ô dữ liệu trên điện thoại. */
export function ExpandHeaderCell({ children }: { children?: ReactNode }) {
  return <th className="sticky-end text-right">{children}</th>
}

/** Nút "Mở tất cả / Thu gọn tất cả" cho bảng có dòng mở rộng. */
export function ExpandAllToggle({
  allExpanded,
  onExpandAll,
  onCollapseAll,
  disabled = false,
}: {
  allExpanded: boolean
  onExpandAll: () => void
  onCollapseAll: () => void
  disabled?: boolean
}) {
  const Icon = allExpanded ? ChevronsDownUp : ChevronsUpDown
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={allExpanded ? onCollapseAll : onExpandAll}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:border-mod-200 hover:text-mod-800 disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon size={14} />
      {allExpanded ? "Thu gọn tất cả" : "Mở tất cả"}
    </button>
  )
}
