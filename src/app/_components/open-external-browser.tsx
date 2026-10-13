"use client"

import { useState, useSyncExternalStore } from "react"
import { chromeIntentUrl, copyText, detectInAppBrowser, isAndroid } from "@/lib/in-app-browser"

const noopSubscribe = () => () => {}

/**
 * Banner gợi ý mở link bằng trình duyệt ngoài khi đang ở trong Telegram/Zalo/Facebook...
 * `force` = luôn hiện (dùng ở màn báo lỗi), mặc định chỉ hiện khi phát hiện trình duyệt nhúng.
 * Chỉ dùng style inline + class Tailwind cơ bản để chạy được cả trong global-error.
 */
export function OpenExternalBrowser({ force = false }: { force?: boolean }) {
  // useSyncExternalStore: server trả rỗng, client đọc userAgent/URL — không lệch hydration,
  // không setState trong effect.
  const app = useSyncExternalStore(noopSubscribe, () => detectInAppBrowser(), () => null)
  const android = useSyncExternalStore(noopSubscribe, () => isAndroid(), () => false)
  const href = useSyncExternalStore(noopSubscribe, () => window.location.href, () => "")
  const [copied, setCopied] = useState(false)

  if (!force && !app) return null

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
      <p className="font-semibold">
        {app
          ? `Bạn đang mở trong trình duyệt của ${app}.`
          : "Nếu đang mở link từ Telegram/Zalo, hãy thử bằng trình duyệt ngoài."}
      </p>
      <p className="mt-0.5">
        Trình duyệt này không giữ được đăng nhập của Chrome/Safari. Nên mở bằng trình duyệt ngoài.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {android && href && (
          <a
            href={chromeIntentUrl(href)}
            className="rounded-lg bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-700"
          >
            Mở bằng Chrome
          </a>
        )}
        <button
          type="button"
          onClick={async () => {
            const ok = await copyText(href || window.location.href)
            setCopied(ok)
          }}
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-bold text-amber-800 hover:bg-amber-100"
        >
          {copied ? "Đã sao chép link" : "Sao chép link"}
        </button>
      </div>
    </div>
  )
}
