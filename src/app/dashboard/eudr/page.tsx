"use client"
import dynamic from "next/dynamic"

const EudrClient = dynamic(() => import("./EudrClient"), { ssr: false })

export default function EudrPage() {
  return <EudrClient />
}
