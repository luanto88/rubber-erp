import type { Metadata } from "next"
import "./globals.css"
export const metadata: Metadata = {
  title: "Rubber Factory ERP | PTCS Phước Hòa",
  description: "Hệ thống quản lý sản xuất cao su",
}
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="vi"><body className="bg-slate-100 min-h-screen">{children}</body></html>)
}