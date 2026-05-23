"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function IsoDocumentNewPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/dashboard/iso/documents/new-doc")
  }, [router])

  return null
}
