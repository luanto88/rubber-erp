"use client"
import dynamic from "next/dynamic"

// Bắt buộc ssr:false — react-leaflet đọc `window` lúc load module, SSR sẽ crash
// (đã có bug thật 2026-07-07 với trang /storage, xem .claude/rules/storage.md mục 14).
const CustomerPortalOrderClient = dynamic(() => import("./_components/order-client"), { ssr: false })

export default function CustomerPortalOrderPage() {
  return <CustomerPortalOrderClient />
}
