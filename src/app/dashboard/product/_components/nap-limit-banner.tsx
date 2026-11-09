"use client"
// Banner cảnh báo "lô quá MAX_NAP_PER_LOT nắp" (GĐ3B) — thay window.confirm của trình duyệt.
// Dùng: const { confirmNap, napBanner } = useNapLimitConfirm(); ... if (!(await confirmNap(lines))) return; ... {napBanner}
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle } from "lucide-react"
import { MAX_NAP_PER_LOT } from "@/lib/pallet-nap"

type Pending = { lines: string[]; resolve: (ok: boolean) => void }

export type NapBannerLabels = {
  title: string
  note: string
  confirm: string
  back: string
}

const DEFAULT_LABELS: NapBannerLabels = {
  title: "Lô có quá nhiều nắp",
  note: `Thông thường 4 kiện DPH chỉ có ${MAX_NAP_PER_LOT} nắp (1 nắp giữa kiện dưới và kiện trên). Kiểm tra lại trước khi lưu.`,
  confirm: "Vẫn lưu",
  back: "Quay lại sửa",
}

export function useNapLimitConfirm(labels: Partial<NapBannerLabels> = {}) {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const confirmNap = useCallback(
    (lines: string[]) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false)
        const next = { lines, resolve }
        pendingRef.current = next
        setPending(next)
      }),
    [],
  )

  const close = useCallback((ok: boolean) => {
    pendingRef.current?.resolve(ok)
    pendingRef.current = null
    setPending(null)
  }, [])

  // Đóng component (rời trang) ⇒ coi như không lưu.
  useEffect(() => () => pendingRef.current?.resolve(false), [])

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pending, close])

  const l = { ...DEFAULT_LABELS, ...labels }
  const napBanner =
    pending && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-x-0 top-3 z-[90] flex justify-center px-3">
            <div
              role="alertdialog"
              aria-live="assertive"
              className="w-full max-w-xl rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 shadow-2xl ring-4 ring-amber-200/60"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                  <AlertTriangle size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-extrabold text-amber-900">{l.title}</div>
                  <ul className="mt-1 space-y-0.5 text-sm font-semibold text-amber-900">
                    {pending.lines.map((line) => (
                      <li key={line}>• {line}</li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-amber-800">{l.note}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100"
                >
                  {l.back}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => close(true)}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700"
                >
                  {l.confirm}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return { confirmNap, napBanner }
}
