"use client"

import { useEffect, useRef, useState } from "react"

const DURATION_MS = 900

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Hiệu ứng "nhảy số" từ 0 tới giá trị cuối khi phần tử vào khung nhìn lần đầu.
 * Người dùng bật "giảm chuyển động" (prefers-reduced-motion) thì hiện thẳng số cuối.
 * Giá trị đổi sau đó thì chạy tiếp từ số đang hiện tới số mới.
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number
  format: (n: number) => string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(0)
  const [visible, setVisible] = useState(false)
  const shownRef = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(id)
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    const target = Number.isFinite(value) ? value : 0
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const from = shownRef.current
    // Giảm chuyển động / không đổi giá trị → hiện thẳng số cuối ở frame kế tiếp.
    const duration = reduce || from === target ? 0 : DURATION_MS
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration)
      const v = from + (target - from) * easeOutCubic(t)
      shownRef.current = v
      setDisplay(v)
      if (t < 1) raf = requestAnimationFrame(tick)
      else shownRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [visible, value])

  return (
    <span ref={ref} className={`tabular-nums ${className ?? ""}`}>
      {format(display)}
    </span>
  )
}

/** Thanh tiến độ tự "mọc" từ 0 tới `percent` sau khi mount. */
export function GrowBar({ percent, className }: { percent: number; className?: string }) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(Math.max(0, Math.min(100, percent))))
    return () => cancelAnimationFrame(id)
  }, [percent])
  return <div className={`h-full rounded-full transition-[width] duration-1000 ease-out ${className ?? ""}`} style={{ width: `${w}%` }} />
}
