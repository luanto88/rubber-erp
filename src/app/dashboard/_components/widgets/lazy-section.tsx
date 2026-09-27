"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { WidgetSkeleton } from "./widget-shared"

/**
 * Chỉ mount `children` khi khối sắp cuộn tới (cách mép dưới ~300px). Widget bên trong tự
 * fetch trong useEffect lúc mount, nên mount muộn = tải dữ liệu muộn — khối ở cuối trang
 * không còn tranh băng thông với khối đầu trang. Đã mount rồi thì giữ nguyên, không gỡ lại.
 */
export function LazySection({ children, minHeight = 320 }: { children: ReactNode; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(id)
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          obs.disconnect()
        }
      },
      { rootMargin: "300px 0px" },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return <div ref={ref}>{shown ? children : <WidgetSkeleton height={minHeight} />}</div>
}
