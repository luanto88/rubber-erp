"use client"
// Quy cách chủng loại / loại bành cho màn quét QR. Có mạng ⇒ đọc bảng; mất mạng ⇒ lấy từ gói tải sẵn
// (offlineGrade); không có gì ⇒ quy tắc cũ.
import { useEffect, useState } from "react"
import { defaultGradeConfig, ensureGradeConfig, type GradeConfig } from "@/lib/product-grade"
import { loadGradeConfig } from "@/lib/product-grade-client"

export function useGradeConfig(factoryId: string | null | undefined, offlineGrade?: GradeConfig | null): GradeConfig {
  const [loaded, setLoaded] = useState<GradeConfig | null>(null)
  useEffect(() => {
    if (!factoryId) return
    if (typeof navigator !== "undefined" && navigator.onLine === false) return
    let alive = true
    void loadGradeConfig(factoryId).then((cfg) => {
      if (alive) setLoaded(cfg)
    })
    return () => {
      alive = false
    }
  }, [factoryId])
  if (loaded && (loaded.fromDb || !offlineGrade)) return loaded
  if (offlineGrade) return ensureGradeConfig(offlineGrade)
  return loaded || defaultGradeConfig()
}
