"use client"

import { useEffect } from "react"

// Service worker chỉ chạy ở bản production. Ở dev gỡ SW cũ (nếu có) để không cache chunk HMR.
// Gắn mã bản build vào URL ⇒ mỗi lần deploy trình duyệt cài SW mới, cache theo đúng bản.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {})
      return
    }
    const version = encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID || "dev")
    navigator.serviceWorker.register(`/service-worker.js?v=${version}`).catch(() => {})
  }, [])
  return null
}
