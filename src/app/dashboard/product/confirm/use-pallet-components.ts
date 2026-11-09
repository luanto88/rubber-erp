"use client"
// Thành phần pallet (nắp) cho màn quét QR. Có mạng ⇒ đọc bảng; mất mạng ⇒ lấy từ gói tải sẵn; không có ⇒ mặc định.
import { useEffect, useState } from "react"
import {
  DEFAULT_PALLET_COMPONENTS,
  ensurePalletComponents,
  type PalletComponentsConfig,
} from "@/lib/pallet-components"
import { loadPalletComponents } from "@/lib/pallet-components-client"

export function usePalletComponents(
  factoryId: string | null | undefined,
  offlineCfg?: PalletComponentsConfig | null,
): PalletComponentsConfig {
  const [loaded, setLoaded] = useState<PalletComponentsConfig | null>(null)
  useEffect(() => {
    if (!factoryId) return
    if (typeof navigator !== "undefined" && navigator.onLine === false) return
    let alive = true
    void loadPalletComponents(factoryId).then((cfg) => {
      if (alive && cfg.fromDb) setLoaded(cfg)
    })
    return () => {
      alive = false
    }
  }, [factoryId])
  if (loaded) return loaded
  if (offlineCfg) return ensurePalletComponents(offlineCfg)
  return DEFAULT_PALLET_COMPONENTS
}
