"use client"

import { useEffect, useState } from "react"
import { hydrateActiveSession, hasPermission } from "@/lib/auth"

// GĐ3 phân quyền ISO: guard `iso.view` một lần cho MỌI trang con /dashboard/iso/* (mirror
// inventory/layout.tsx) — các trang con không cần tự kiểm lại quyền vào module.
export default function IsoLayout({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    const check = async () => {
      const { user } = await hydrateActiveSession().catch(() => ({ user: null }))
      if (!hasPermission(user, "iso.view")) {
        window.location.replace("/dashboard")
        return
      }
      setAllowed(true)
    }
    void check()
  }, [])

  if (allowed === null) return null
  return <>{children}</>
}
