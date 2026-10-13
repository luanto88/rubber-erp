"use client"

import "./globals.css"
import { AppErrorView } from "./_components/app-error-view"

// Lỗi ở root layout — bắt buộc tự render <html>/<body>. Trước đây app không có error boundary nào
// nên mọi lỗi lúc khởi động đều ra màn trắng (bug mở link từ Telegram, 2026-10-13).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="vi">
      <body>
        <AppErrorView error={error} reset={reset} />
      </body>
    </html>
  )
}
