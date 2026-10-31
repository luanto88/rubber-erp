/* Service worker — GĐ-B quét QR offline (.claude/plans/quet-qr-offline.md mục 4).
 *
 * Phạm vi CỐ Ý hẹp:
 * - Trang `/dashboard/product/confirm` (mọi query): network-first, lưu bản mới nhất để mở được khi mất mạng.
 * - Chunk `/_next/static/*` (tên có hash, bất biến): cache-first, CHỈ khi do trang quét QR tải.
 * - manifest + icon như trước.
 * KHÔNG cache: API, server action (POST), Supabase (khác origin), RSC, mọi trang khác.
 *
 * Mã bản build lấy từ `?v=` của URL script (sw-register.tsx). Mỗi lần deploy = SW mới; giữ cache của bản
 * hiện tại + bản ngay trước (để tab cũ đang mở vẫn có chunk khi mất mạng), xoá các bản cũ hơn.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev"
const PREFIX = "qlsxkpt-"
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`
const CONFIRM_CACHE = `${PREFIX}confirm-${VERSION}`
const META_CACHE = `${PREFIX}meta`
const META_KEY = "/__sw-versions"
const KEEP_VERSIONS = 2
const STATIC_ASSETS = ["/manifest.json", "/icon-192.png", "/icon-512.png"]
const CONFIRM_PATH = "/dashboard/product/confirm"
const NAV_TIMEOUT_MS = 5000

const isConfirmPath = (pathname) => pathname === CONFIRM_PATH || pathname.startsWith(`${CONFIRM_PATH}/`)

async function readVersions() {
  const meta = await caches.open(META_CACHE)
  const res = await meta.match(META_KEY)
  if (!res) return []
  try {
    const list = await res.json()
    return Array.isArray(list) ? list.filter((v) => typeof v === "string") : []
  } catch {
    return []
  }
}

async function writeVersions(list) {
  const meta = await caches.open(META_CACHE)
  await meta.put(META_KEY, new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } }))
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(STATIC_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const versions = (await readVersions()).filter((v) => v !== VERSION)
      versions.push(VERSION)
      const keep = versions.slice(-KEEP_VERSIONS)
      await writeVersions(keep)
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((n) => n !== META_CACHE)
          .filter((n) => !keep.some((v) => n === `${PREFIX}shell-${v}` || n === `${PREFIX}confirm-${v}`))
          .map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

/** Các cache trang quét theo thứ tự ưu tiên: bản hiện tại rồi bản ngay trước. */
async function confirmCacheNames() {
  const versions = await readVersions()
  const ordered = [VERSION, ...versions.filter((v) => v !== VERSION).reverse()]
  return ordered.map((v) => `${PREFIX}confirm-${v}`)
}

async function matchConfirmCaches(request) {
  for (const name of await confirmCacheNames()) {
    if (!(await caches.has(name))) continue
    // ignoreSearch: Vercel có thể gắn `?dpl=` vào URL chunk, bản lưu từ HTML không có query.
    const hit = await (await caches.open(name)).match(request, { ignoreSearch: true })
    if (hit) return hit
  }
  return null
}

const STATIC_URL_RE = /\/_next\/static\/[A-Za-z0-9_\-./~%@]+/g

/** Lần tải đầu chunk được tải TRƯỚC khi SW kiểm soát trang ⇒ quét HTML/CSS lấy đủ chunk để lưu. */
async function precacheStaticFrom(text, origin, cache) {
  const urls = [...new Set(text.match(STATIC_URL_RE) || [])].map((p) => p.replace(/[.\\]+$/, ""))
  await Promise.allSettled(
    urls.map(async (path) => {
      const req = new Request(origin + path)
      if (await cache.match(req)) return
      const res = await fetch(req)
      if (!res.ok) return
      if (path.endsWith(".css")) {
        const css = await res.clone().text()
        await precacheStaticFrom(css, origin, cache)
      }
      await cache.put(req, res)
    }),
  )
}

const OFFLINE_HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mất mạng</title></head><body style="font-family:system-ui,sans-serif;background:#f1f5f9;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;text-align:center"><div style="max-width:360px;background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><h1 style="font-size:18px;color:#b91c1c;margin:0 0 8px">Mất kết nối mạng</h1><p style="font-size:14px;color:#475569;margin:0 0 16px">Màn quét QR chưa được tải sẵn trên máy này. Hãy mở màn quét 1 lần khi có mạng để dùng được lúc mất mạng.</p><button onclick="location.reload()" style="background:#059669;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:700">Thử lại</button></div></body></html>`

async function handleConfirmNavigation(event) {
  const url = new URL(event.request.url)
  const cacheKey = new Request(url.origin + CONFIRM_PATH)

  const network = (async () => {
    const res = await fetch(event.request)
    const type = res.headers.get("content-type") || ""
    if (res.ok && !res.redirected && type.includes("text/html")) {
      const cache = await caches.open(CONFIRM_CACHE)
      const html = await res.clone().text()
      await cache.put(cacheKey, new Response(html, { headers: { "Content-Type": type } }))
      event.waitUntil(precacheStaticFrom(html, url.origin, cache).catch(() => {}))
    }
    return res
  })()

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS))
  try {
    const winner = await Promise.race([network, timeout])
    if (winner) return winner
    // Mạng chậm: có bản cache thì dùng tạm, vẫn để lượt tải mạng chạy nốt để cập nhật cache.
    event.waitUntil(network.catch(() => {}))
    const cached = await matchConfirmCaches(cacheKey)
    return cached || (await network)
  } catch {
    const cached = await matchConfirmCaches(cacheKey)
    return cached || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}

/** Tải HTML trang quét + chunk của nó vào cache. Dùng khi trang tự yêu cầu (postMessage) vì 2 trường hợp
 *  điều hướng KHÔNG đi qua handler navigation ở trên:
 *  - lần mở đầu: SW chưa kiểm soát trang (mới cài) ⇒ HTML + chunk tải thẳng mạng;
 *  - vào màn quét bằng link trong app: Next.js tải RSC (bị bỏ qua), không phải HTML.
 *  `extra` = các file /_next/static/ trang đã tải (gồm chunk nạp lười như máy quét QR). */
async function cacheConfirmPage(origin, extra) {
  const cache = await caches.open(CONFIRM_CACHE)
  const res = await fetch(origin + CONFIRM_PATH, { credentials: "same-origin" })
  const type = res.headers.get("content-type") || ""
  if (res.ok && !res.redirected && type.includes("text/html")) {
    const html = await res.text()
    await cache.put(new Request(origin + CONFIRM_PATH), new Response(html, { headers: { "Content-Type": type } }))
    await precacheStaticFrom(html, origin, cache)
  }
  const paths = (Array.isArray(extra) ? extra : [])
    .filter((p) => typeof p === "string" && p.startsWith("/_next/static/"))
    .join(" ")
  if (paths) await precacheStaticFrom(paths, origin, cache)
}

self.addEventListener("message", (event) => {
  const data = event.data
  if (!data || data.type !== "cache-confirm") return
  event.waitUntil(cacheConfirmPage(self.location.origin, data.statics).catch(() => {}))
})

async function handleStatic(event) {
  const cached = await matchConfirmCaches(event.request)
  if (cached) return cached
  const res = await fetch(event.request)
  if (res.ok && event.clientId) {
    const client = await self.clients.get(event.clientId)
    if (client && isConfirmPath(new URL(client.url).pathname)) {
      const copy = res.clone()
      event.waitUntil(caches.open(CONFIRM_CACHE).then((c) => c.put(event.request, copy)).catch(() => {}))
    }
  }
  return res
}

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return
  if (url.searchParams.has("_rsc") || req.headers.get("RSC")) return

  if (req.mode === "navigate") {
    if (isConfirmPath(url.pathname)) event.respondWith(handleConfirmNavigation(event))
    return
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStatic(event))
    return
  }
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((cached) => cached || fetch(req)))
  }
})
