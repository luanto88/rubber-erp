"use client"

import { type CSSProperties, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react"

/**
 * Doc-UI GĐ5 — VỎ dùng chung cho 4 màn đặt vị trí / ký số:
 *   - SignPlacementModal của Văn bản (`documents/[id]`)
 *   - SignPlacementModal của Hồ sơ thực hiện ISO (`iso/forms/[id]`)
 *   - modal đặt vị trí của Tài liệu ISO (`iso/documents/[id]`)
 *   - màn ký hàng loạt ISO (`iso-batch-sign-modal.tsx`)
 *
 * CHỈ là phần trình bày: topbar (tiêu đề + nút Đóng), dải ghi chú, rail thumbnail trang, vùng
 * canvas cuộn, footer. Mọi logic toạ độ / kẹp khung / quy đổi pt↔px / gọi API ký vẫn nằm ở
 * màn gọi — vỏ không biết gì về chữ ký.
 *
 * Màu vỏ chỉ dùng brand-* / slate. Màu VAI TRÒ ký (bước 1 amber, phê duyệt emerald...) vẫn do
 * màn gọi truyền vào qua `badges` / `accentColor` của thumbnail — lấy từ `template-colors.ts`.
 */
export function SignWorkspaceShell({
  eyebrow,
  title,
  subtitle,
  badges,
  toolbar,
  onClose,
  closeDisabled = false,
  closeLabel = "Đóng",
  notice,
  rail,
  children,
  footer,
  zIndexClassName = "z-50",
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Chip cạnh tiêu đề (vai trò, cấp tài liệu...) */
  badges?: ReactNode
  /** Nút phụ ở bên phải topbar, đứng trước nút Đóng (điều hướng trang, nhân bản...) */
  toolbar?: ReactNode
  onClose?: () => void
  closeDisabled?: boolean
  closeLabel?: string
  /** Dải hướng dẫn / chú giải ngay dưới topbar */
  notice?: ReactNode
  /** Rail thumbnail — dùng `SignRail` + `SignRailThumb` */
  rail?: ReactNode
  /** Vùng canvas — đặt trong `SignCanvasArea` */
  children: ReactNode
  footer?: ReactNode
  zIndexClassName?: string
}) {
  return (
    <div
      className={`fixed inset-0 ${zIndexClassName} flex flex-col bg-slate-950/70 font-doc`}
      role="dialog"
      aria-modal="true"
    >
      <header className="shrink-0 bg-gradient-to-br from-brand-700 to-brand-800 px-3 py-2.5 text-white shadow-md sm:px-5 sm:py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{eyebrow}</p>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate text-base font-extrabold">{title}</h3>
              {badges}
            </div>
            {subtitle && <p className="mt-0.5 truncate text-xs text-white/70">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            {toolbar}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                disabled={closeDisabled}
                aria-label={closeLabel}
                title={closeLabel}
                className="rounded-lg p-1.5 text-white transition-colors hover:bg-white/15 disabled:opacity-40"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      </header>

      {notice && (
        <div className="shrink-0 border-b border-brand-100 bg-brand-50 px-4 py-2 text-xs text-brand-800 sm:px-5">
          {notice}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {rail}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>

      {footer && (
        <footer className="shrink-0 border-t border-slate-200 bg-white px-3 py-2.5 sm:px-5 sm:py-3">
          {footer}
        </footer>
      )}
    </div>
  )
}

/** Nút phụ trên topbar nền tối (Nhân bản, Khung bước khác...) */
export function SignToolbarButton({
  children,
  onClick,
  active,
  title,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all disabled:opacity-40 ${
        active === false
          ? "border-white/20 bg-white/5 text-white/60 hover:bg-white/10"
          : "border-white/30 bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  )
}

/** Điều hướng trang ‹ x / n › trên topbar nền tối */
export function SignPageNav({
  page,
  total,
  onChange,
}: {
  page: number
  total: number
  onChange: (page: number) => void
}) {
  if (total <= 1) return null
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Trang trước"
        className="rounded-lg border border-white/25 bg-white/10 p-1.5 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-25"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="whitespace-nowrap px-0.5 text-xs font-bold text-white/90">
        {page} / {total}
      </span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= total}
        aria-label="Trang sau"
        className="rounded-lg border border-white/25 bg-white/10 p-1.5 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-25"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

/** Khung rail: ngang trên mobile, dọc từ `lg` (mẫu màn ký Văn bản). */
export function SignRail({ heading, children, className = "" }: { heading?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex h-[92px] w-full shrink-0 gap-2 overflow-x-auto overscroll-x-contain border-b border-slate-200 bg-white px-2 py-2 lg:h-auto lg:w-28 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r ${className}`}
    >
      {heading && (
        <div className="hidden text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 lg:block">
          {heading}
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * Thumbnail 1 trang. `accentColor` = màu vai trò của người đang ký (từ template-colors) — viền
 * sáng khi trang có khung của họ. `children` = lớp phủ (khung thu nhỏ, badge).
 */
export function SignRailThumb({
  page,
  src,
  loading,
  selected,
  accentColor,
  done,
  onClick,
  title,
  children,
  aspectStyle,
}: {
  page: number
  src?: string
  loading?: boolean
  selected?: boolean
  accentColor?: string | null
  done?: boolean
  onClick: () => void
  title?: string
  children?: ReactNode
  aspectStyle?: CSSProperties
}) {
  const style: CSSProperties = { ...aspectStyle }
  if (!selected && accentColor) {
    style.borderColor = accentColor
    style.boxShadow = `0 0 0 2px ${accentColor}66`
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? `Trang ${page}`}
      style={style}
      className={`relative mx-auto h-[72px] w-[52px] shrink-0 overflow-hidden rounded-md border-2 bg-white transition-all lg:h-28 lg:w-20 ${
        selected
          ? "border-brand-600 shadow-md ring-2 ring-brand-500"
          : accentColor
            ? "shadow-xs"
            : done
              ? "border-brand-200"
              : "border-dashed border-slate-300 hover:border-slate-400"
      }`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`Trang ${page}`} className="h-full w-full object-contain" />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center bg-slate-100 text-[10px] font-bold text-slate-400 ${loading ? "animate-pulse" : ""}`}
        >
          {page}
        </div>
      )}
      {children}
      <span className="absolute bottom-0 right-0 rounded-tl bg-white/85 px-1 text-[9px] font-bold text-slate-500">{page}</span>
    </button>
  )
}

/**
 * Vùng canvas cuộn. KHÔNG căn giữa bằng flex: canvas rộng hơn màn hình (mobile) thì phần tràn
 * ở mép trái sẽ nằm ngoài vùng cuộn. Màn gọi tự đặt khung trang `relative w-max mx-auto`.
 */
export function SignCanvasArea({ children, toolbar }: { children: ReactNode; toolbar?: ReactNode }) {
  return (
    <>
      {toolbar && <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">{toolbar}</div>}
      <div className="min-h-0 flex-1 overflow-auto bg-app-bg p-2 sm:p-4">{children}</div>
    </>
  )
}

/** Cặp nút cuối footer: Hủy + nút chính gradient brand. */
export function SignFooterActions({
  onCancel,
  cancelLabel = "Hủy",
  onConfirm,
  confirmLabel,
  confirmIcon,
  busy = false,
  confirmDisabled = false,
}: {
  onCancel?: () => void
  cancelLabel?: string
  onConfirm: () => void
  confirmLabel: ReactNode
  confirmIcon?: ReactNode
  busy?: boolean
  confirmDisabled?: boolean
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 transition-all hover:bg-slate-100 disabled:opacity-50"
        >
          {cancelLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy || confirmDisabled}
        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:from-brand-700 hover:to-brand-900 disabled:opacity-50"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : confirmIcon}
        {confirmLabel}
      </button>
    </div>
  )
}
