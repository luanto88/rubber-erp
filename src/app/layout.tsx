import type { Metadata, Viewport } from "next"
import "./globals.css"
// Import ở root layout (không tied vào next/dynamic ssr:false của từng module bản đồ)
// để đảm bảo CSS Leaflet luôn có trong bundle chính — tránh nguy cơ blank map do
// leaflet.css không được include đúng khi chỉ import bên trong component dynamic import.
import "leaflet/dist/leaflet.css"
export const metadata: Metadata = {
  title: "Công ty TNHH PTCS Phước Hòa Kampong - NMCB",
  description: "Nhà máy chế biến cao su Phước Hòa Kampong Thom - Sản xuất CSR10, CSR20, CSR3L theo tiêu chuẩn PEFC CS. Thành lập 2019 tại Campuchia.",
  icons: {
    icon: "/logo-nha-may-5.jpg",
    shortcut: "/logo-nha-may-5.jpg",
    apple: "/logo-nha-may-5.jpg",
  },
}
// Thiếu viewport meta khiến trình duyệt mobile (đặc biệt webview Zalo/Facebook) render
// ở layout viewport ảo ~980px rồi tự zoom-out để vừa màn hình — kích hoạt sai các
// breakpoint sm:/md: của Tailwind và làm mọi field/nút bị ép nhỏ dù code responsive đã đúng.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
}
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Outfit:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-slate-50 min-h-screen" style={{ fontFamily: "'Inter', 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif" }}>{children}</body>
    </html>
  )
}