import type { Metadata } from "next"
import "./globals.css"
export const metadata: Metadata = {
  title: "Công ty TNHH PTCS Phước Hòa Kampong - NMCB",
  description: "Nhà máy chế biến cao su Phước Hòa Kampong Thom - Sản xuất CSR10, CSR20, CSR3L theo tiêu chuẩn PEFC CS. Thành lập 2019 tại Campuchia.",
  icons: {
    icon: "/logo-nha-may-5.jpg",
    shortcut: "/logo-nha-may-5.jpg",
    apple: "/logo-nha-may-5.jpg",
  },
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