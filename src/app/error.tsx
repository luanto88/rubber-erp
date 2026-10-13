"use client"

import { AppErrorView } from "./_components/app-error-view"

// Error boundary cho mọi route (kể cả /dashboard/*, /login): thay màn trắng bằng màn báo lỗi.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AppErrorView error={error} reset={reset} />
}
