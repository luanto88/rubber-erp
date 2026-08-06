"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { AlertTriangle, Loader2 } from "lucide-react"
import { authBlockReason, hasPermission, hydrateActiveSession, signOutEverywhere } from "@/lib/auth"
import {
  broadcastCustomerPortalLangChange,
  getStoredCustomerPortalLang,
  onCustomerPortalLangChange,
  tCustomerPortal,
  type CustomerPortalLang,
} from "@/lib/customer-portal-i18n"
import { CustomerPortalLangToggle } from "@/app/dashboard/customer-portal/_components/lang-toggle"

type LookupStatus = "checking" | "redirecting" | "missing_code" | "not_found" | "no_access"

// Đích trung gian của QR nhúng trong file DDS (xem dds-generator.ts:buildOrderLookupUrl).
// Tự xác định vai trò người quét rồi chuyển hướng đúng chỗ:
//   - Nhân viên nội bộ (quyền export.view) -> /dashboard/eudr?order=... (trang cũ, không đổi)
//   - Khách hàng (role="customer") -> /dashboard/customer-portal/{id} (song ngữ Anh/Việt sẵn có)
//   - Còn lại -> thông báo không có quyền
function EudrLookupContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orderCode = searchParams.get("order")?.trim() || ""

  const [status, setStatus] = useState<LookupStatus>("checking")
  const [lang, setLang] = useState<CustomerPortalLang>("en")
  const t = (key: Parameters<typeof tCustomerPortal>[1]) => tCustomerPortal(lang, key)

  useEffect(() => {
    setLang(getStoredCustomerPortalLang())
    return onCustomerPortalLangChange(setLang)
  }, [])

  useEffect(() => {
    let alive = true

    const run = async () => {
      if (!orderCode) {
        if (alive) setStatus("missing_code")
        return
      }

      const { session, user } = await hydrateActiveSession().catch(() => ({ session: null, user: null }))
      const blocked = authBlockReason(user)
      if (!session?.user || blocked) {
        await signOutEverywhere()
        window.location.replace(`/login${blocked ? `?reason=${blocked}` : ""}`)
        return
      }

      if (hasPermission(user, "export.view")) {
        router.replace(`/dashboard/eudr?order=${encodeURIComponent(orderCode)}`)
        return
      }

      if (user?.role === "customer") {
        try {
          const res = await fetch(`/api/eudr/resolve-order?code=${encodeURIComponent(orderCode)}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          const json = (await res.json().catch(() => null)) as { id?: string } | null
          if (!res.ok || !json?.id) {
            if (alive) setStatus("not_found")
            return
          }
          if (alive) setStatus("redirecting")
          router.replace(`/dashboard/customer-portal/${json.id}`)
        } catch {
          if (alive) setStatus("not_found")
        }
        return
      }

      if (alive) setStatus("no_access")
    }

    void run()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderCode])

  if (status === "checking" || status === "redirecting") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-16 text-slate-400">
        <Loader2 size={28} className="animate-spin" />
        <p className="text-sm">{t("redirecting")}</p>
      </div>
    )
  }

  const message =
    status === "missing_code"
      ? t("lookupMissingCode")
      : status === "no_access"
        ? t("lookupNoAccess")
        : t("lookupOrderNotFound")

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex justify-end">
        <CustomerPortalLangToggle lang={lang} onChange={broadcastCustomerPortalLangChange} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <AlertTriangle size={36} className="mx-auto mb-3 text-amber-500" />
        <p className="text-sm font-semibold text-slate-600">{message}</p>
        <Link
          href="/dashboard/customer-portal"
          className="mt-5 inline-block rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-emerald-700"
        >
          {t("lookupBackToOrders")}
        </Link>
      </div>
    </div>
  )
}

export default function EudrLookupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-16 text-slate-400">
          <Loader2 size={28} className="animate-spin" />
        </div>
      }
    >
      <EudrLookupContent />
    </Suspense>
  )
}
