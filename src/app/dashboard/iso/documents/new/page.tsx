"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function IsoDocumentNewPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/dashboard/iso/documents/new-doc")
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
