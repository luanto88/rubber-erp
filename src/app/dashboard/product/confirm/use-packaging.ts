"use client"
// Quy cách đóng gói (bọc / pallet SX / thảm) cho màn quét QR. Có mạng ⇒ đọc bảng; mất mạng ⇒ lấy từ gói
// tải sẵn (offlinePackaging); không có gì ⇒ danh sách mặc định.
import { useEffect, useState } from "react"
import { DEFAULT_PACKAGING, ensurePackagingConfig, type PackagingConfig } from "@/lib/product-packaging"
import { loadPackagingConfig } from "@/lib/product-packaging-client"

export function usePackaging(factoryId: string | null | undefined, offlinePackaging?: PackagingConfig | null): PackagingConfig {
  const [loaded, setLoaded] = useState<PackagingConfig | null>(null)
  useEffect(() => {
    if (!factoryId) return
    if (typeof navigator !== "undefined" && navigator.onLine === false) return
    let alive = true
    void loadPackagingConfig(factoryId).then((cfg) => {
      if (alive && cfg.fromDb) setLoaded(cfg)
    })
    return () => {
      alive = false
    }
  }, [factoryId])
  if (loaded) return loaded
  if (offlinePackaging) return ensurePackagingConfig(offlinePackaging)
  return DEFAULT_PACKAGING
}
