"use client"

// Đổi ngăn nguồn của 1 kiện — mở từ dòng "Xem chi tiết ngăn nguồn gốc" ở màn tra cứu nhãn
// (/product-label). Mọi điều kiện (được đổi hay không, danh sách ngăn, trần 110%) do SERVER quyết
// định qua loadKienSwapContext/swapKienNgan — component này chỉ hiển thị.

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import {
  loadKienSwapContext,
  swapKienNgan,
  type KienSwapContext,
  type SwappableNganOption,
} from "@/app/dashboard/product/confirm/actions"
import { t, type Lang } from "@/app/dashboard/product/confirm/i18n"
import { getFreshAuthSession } from "@/lib/auth"
import type { KienLetter } from "@/lib/product-label"

type Props = {
  lang: Lang
  factoryId: string
  maLo: string
  kien: KienLetter
  onClose: () => void
  onSwapped: (message: string) => void
}

export function KienSwapNganModal({ lang, factoryId, maLo, kien, onClose, onSwapped }: Props) {
  const tt = (key: string, vars?: Record<string, string | number>) => t(lang, key, vars)
  const [ctx, setCtx] = useState<KienSwapContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const session = await getFreshAuthSession()
        const result = await loadKienSwapContext(session?.access_token ?? null, factoryId, maLo, kien)
        if (alive) setCtx(result)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Không tải được danh sách ngăn.")
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [factoryId, maLo, kien])

  const handlePick = async (o: SwappableNganOption) => {
    if (!o.fits || savingId) return
    setSavingId(o.id)
    setError(null)
    try {
      const session = await getFreshAuthSession()
      const result = await swapKienNgan({
        accessToken: session?.access_token ?? null,
        factoryId,
        maLo,
        kien,
        newNganId: o.id,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      onSwapped(tt("doiNganDone", { ngan: result.nganMa || o.ma_ngan }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định khi đổi ngăn.")
    } finally {
      setSavingId(null)
    }
  }

  const blockedReason =
    ctx && !ctx.canSwap
      ? (() => {
          const key = `doiNganLyDo_${ctx.code}`
          const translated = t(lang, key)
          return translated === key ? ctx.reason : translated
        })()
      : null

  return (
    <ModalShell title={tt("doiNganTitle", { kien, maLo })} onClose={onClose} maxWidth="md">
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> {tt("doiNganDangTai")}
        </div>
      ) : blockedReason ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm font-semibold text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{tt("doiNganKhongDuoc", { lyDo: blockedReason })}</span>
        </div>
      ) : ctx && ctx.canSwap ? (
        <div>
          <p className="text-xs text-slate-500">{tt("doiNganHint")}</p>
          {ctx.options.length === 0 ? (
            <div className="mt-3 text-sm text-slate-500">{tt("doiNganEmpty")}</div>
          ) : (
            <div className="mt-3 space-y-1.5">
              {ctx.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={!o.fits || !!savingId}
                  onClick={() => void handlePick(o)}
                  title={o.fits ? tt("doiNganChon") : tt("doiNganVuot")}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm ${
                    o.fits
                      ? "border-slate-200 hover:border-emerald-400 hover:bg-emerald-50"
                      : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400"
                  }`}
                >
                  <span className="min-w-0 truncate font-bold">
                    {o.ma_ngan} {o.ten_ngan ? `— ${o.ten_ngan}` : ""}
                  </span>
                  <span className={`shrink-0 text-xs font-bold ${o.fits ? "text-emerald-700" : "text-red-500"}`}>
                    {savingId === o.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      `${o.pctAfter}%${o.fits ? "" : ` · ${tt("doiNganVuot")}`}`
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>
      )}
    </ModalShell>
  )
}
