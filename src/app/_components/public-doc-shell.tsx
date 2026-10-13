import type { ReactNode } from "react"
import { ShieldCheck } from "lucide-react"

/**
 * Khung trang CÔNG KHAI theo Doc-UI cho `/van-ban-verify` và `/iso-doc` (không cần đăng nhập,
 * không có sidebar). Dải brand đầu trang + font Plus Jakarta (`font-doc`), nền `bg-app-bg`.
 * Server component — không import supabase/client logic.
 */
export function PublicDocShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="font-doc min-h-screen bg-app-bg">
      <header
        className="text-white"
        style={{ background: "linear-gradient(135deg, #2f5d52 0%, #1c3a32 100%)" }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-5 sm:px-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
            <ShieldCheck size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Rubber ERP · PTCS Phước Hòa</p>
            <h1 className="text-xl font-extrabold leading-tight sm:text-2xl">{title}</h1>
            <p className="mt-0.5 text-xs text-white/80 sm:text-sm">{subtitle}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-5 sm:px-6">
        {children}
        {footer && <div className="mt-5 text-center text-xs text-slate-500">{footer}</div>}
      </main>
    </div>
  )
}
