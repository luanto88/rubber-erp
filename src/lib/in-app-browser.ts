// Nhận diện trình duyệt nhúng trong ứng dụng (Telegram, Zalo, Facebook/Messenger, Instagram,
// Android WebView nói chung). Các trình duyệt này KHÔNG dùng chung phiên đăng nhập với Chrome/
// Safari và hay giới hạn bộ nhớ trình duyệt ⇒ người dùng nên mở link bằng trình duyệt ngoài.
// Thuần, không phụ thuộc thư viện — dùng được cả ở màn báo lỗi gốc (global-error).

export function detectInAppBrowser(ua?: string): string | null {
  const s = ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "")
  if (!s) return null
  if (/Telegram/i.test(s)) return "Telegram"
  if (/Zalo/i.test(s)) return "Zalo"
  if (/FBAN|FBAV|FB_IAB|Messenger/i.test(s)) return "Facebook"
  if (/Instagram/i.test(s)) return "Instagram"
  if (/Line\//i.test(s)) return "LINE"
  if (/Android/i.test(s) && /; wv\)/i.test(s)) return "ứng dụng"
  return null
}

export function isAndroid(ua?: string): boolean {
  const s = ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "")
  return /Android/i.test(s)
}

/** Link mở đúng URL hiện tại bằng Chrome trên Android (intent://). */
export function chromeIntentUrl(href: string): string {
  try {
    const u = new URL(href)
    return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`
  } catch {
    return href
  }
}

/** Sao chép link; trả về true nếu thành công. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}
