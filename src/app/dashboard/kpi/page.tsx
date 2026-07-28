"use client"

// Fix 6 (2026-08-06): "/dashboard/kpi" không còn là trang Tổng quan độc lập — mặc định luôn vào
// thẳng "Công việc → Việc của tôi" thay vì 1 trang trung gian ít việc phải làm. Banner "Nhóm
// chính" (đã có sẵn ở bản Tổng quan cũ) được chuyển sang đầu trang /dashboard/kpi/tasks. Trang
// này chỉ còn là redirect stub — giữ lại (thay vì xóa hẳn route) để bất kỳ liên kết/sidebar nào
// còn trỏ "/dashboard/kpi" vẫn tự động điều hướng đúng chỗ, không 404.

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function KpiOverviewRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/dashboard/kpi/tasks?tab=mine")
  }, [router])

  return <div className="p-12 text-center text-slate-400">Đang chuyển đến Công việc của bạn...</div>
}
