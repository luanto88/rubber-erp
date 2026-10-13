"use client"

import { useEffect, useState } from "react"

/**
 * `true` khi màn hình từ `lg` (1024px) trở lên — khớp breakpoint của `DetailSplitLayout`.
 * Mặc định `false` khi chưa chạy ở trình duyệt. Dùng để biết cột tài liệu có đang hiện hay
 * không (dưới `lg` chỉ hiện khi tab "Tài liệu" đang chọn).
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    const update = () => setIsDesktop(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return isDesktop
}
