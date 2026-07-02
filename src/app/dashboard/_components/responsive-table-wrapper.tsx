"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

type ResponsiveTableWrapperProps = {
  children: ReactNode
  className?: string
}

/**
 * Bọc quanh <table> để cuộn ngang an toàn trên mobile thay vì vỡ layout.
 * Giữ nguyên class "Table container" chuẩn (rounded-xl border shadow-sm) ở wrapper ngoài;
 * bảng bên trong tự quyết định min-width/columns như cũ.
 */
export function ResponsiveTableWrapper({ children, className = "" }: ResponsiveTableWrapperProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const update = () => {
      setCanScrollLeft(el.scrollLeft > 4)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
    }

    update()
    el.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(el)

    return () => {
      el.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <div className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div ref={scrollRef} className="overflow-x-auto">
        {children}
      </div>
      {canScrollLeft && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent" />
      )}
      {canScrollRight && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent" />
      )}
    </div>
  )
}
