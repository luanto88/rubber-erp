"use client"

import { useEffect, useState } from "react"
import { hydrateActiveSession, hasPermission } from "@/lib/auth"

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    const check = async () => {
      const { user } = await hydrateActiveSession().catch(() => ({ user: null }))
      if (!hasPermission(user, "inventory.view")) {
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
