/* Service worker — GĐ-B quét QR offline (.claude/plans/quet-qr-offline.md mục 4).
 *
 * Phạm vi CỐ Ý hẹp:
 * - Trang `/dashboard/product/confirm` (mọi query): network-first, lưu bản mới nhất để mở được khi mất mạng.
 * - Chunk `/_next/static/*` (tên có hash, bất biến): cache-first, CHỈ khi do trang quét QR tải.
 * - manifest + icon như trước.
 * - `/login`: KHÔNG cache, chỉ trả trang tĩnh "mất mạng" khi điều hướng lỗi mạng (đăng xuất lúc offline).
 * - Trang tem thiết bị `/tb/<token>` (GĐ3c, docs/qr-equipment-plan.md): network-first, lưu HTML CÔNG KHAI (bản SSR
 *   không chứa dữ liệu riêng) vào cache riêng `tb-pages` (tối đa 30 trang, không xoá theo bản build); chunk của trang
 *   tem vào cache `tb-<v>`. Mất mạng ⇒ trả bản đã lưu + chèn thanh "Không có kết nối". KHÔNG đụng nhánh màn quét.
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
const TB_CACHE = `${PREFIX}tb-${VERSION}`
const TB_PAGES_CACHE = `${PREFIX}tb-pages`
const TB_MAX_PAGES = 30
const TB_PATH_RE = /^\/tb\/[A-Za-z0-9_-]{22}$/
const NAV_TIMEOUT_MS = 5000

const isConfirmPath = (pathname) => pathname === CONFIRM_PATH || pathname.startsWith(`${CONFIRM_PATH}/`)
const isTbPath = (pathname) => TB_PATH_RE.test(pathname)

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
          .filter((n) => n !== META_CACHE && n !== TB_PAGES_CACHE)
          .filter(
            (n) =>
              !keep.some((v) => n === `${PREFIX}shell-${v}` || n === `${PREFIX}confirm-${v}` || n === `${PREFIX}tb-${v}`),
          )
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
  const versions = await readVersions()
  const ordered = [VERSION, ...versions.filter((v) => v !== VERSION).reverse()]
  const names = [...(await confirmCacheNames()), ...ordered.map((v) => `${PREFIX}tb-${v}`)]
  for (const name of names) {
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

const LOGIN_OFFLINE_HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mất mạng</title></head><body style="font-family:system-ui,sans-serif;background:#f1f5f9;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;text-align:center"><div style="max-width:360px;background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><h1 style="font-size:18px;color:#b91c1c;margin:0 0 8px">Đang mất mạng</h1><p style="font-size:14px;color:#475569;margin:0 0 16px">Cần có mạng để đăng nhập. Khi có mạng lại, bấm "Thử lại".</p><button onclick="location.reload()" style="background:#059669;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:700">Thử lại</button></div></body></html>`

/** /login: luôn đi mạng, KHÔNG cache. Chỉ khi mất mạng (vd đăng xuất ở màn quét lúc offline) mới trả trang
 *  tĩnh báo mất mạng, thay vì trang lỗi mặc định của trình duyệt. */
async function handleLoginNavigation(event) {
  try {
    return await fetch(event.request)
  } catch {
    return new Response(LOGIN_OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
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
  if (!data) return
  if (data.type === "cache-confirm") {
    event.waitUntil(cacheConfirmPage(self.location.origin, data.statics).catch(() => {}))
  } else if (data.type === "cache-tb" && typeof data.path === "string") {
    event.waitUntil(cacheTbPage(self.location.origin, data.path, data.statics).catch(() => {}))
  }
})

async function handleStatic(event) {
  const cached = await matchConfirmCaches(event.request)
  if (cached) return cached
  const res = await fetch(event.request)
  if (res.ok && event.clientId) {
    const client = await self.clients.get(event.clientId)
    const pathname = client ? new URL(client.url).pathname : ""
    const target = isConfirmPath(pathname) ? CONFIRM_CACHE : isTbPath(pathname) ? TB_CACHE : null
    if (target) {
      const copy = res.clone()
      event.waitUntil(caches.open(target).then((c) => c.put(event.request, copy)).catch(() => {}))
    }
  }
  return res
}

// ─── GĐ3c: trang tem thiết bị /tb/<token> ────────────────────────────────────────────────

const TB_OFFLINE_HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mất kết nối</title></head><body style="font-family:system-ui,sans-serif;background:#f1f5f9;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;text-align:center"><div style="max-width:360px;background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><h1 style="font-size:18px;color:#b91c1c;margin:0 0 8px">Không có kết nối</h1><p style="font-size:14px;color:#475569;margin:0 0 16px">Tem thiết bị này chưa được mở lần nào trên máy này khi có mạng nên chưa có thông tin lưu sẵn. Hãy thử lại khi có mạng.</p><button onclick="location.reload()" style="background:#2f5d52;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:700">Thử lại</button></div></body></html>`

/** Lưu HTML trang tem (khoá = origin + pathname, bỏ query) kèm mốc lưu; giữ tối đa TB_MAX_PAGES trang. */
async function storeTbPage(origin, pathname, html, type) {
  const cache = await caches.open(TB_PAGES_CACHE)
  const key = new Request(origin + pathname)
  await cache.delete(key)
  await cache.put(
    key,
    new Response(html, { headers: { "Content-Type": type, "X-Tb-Saved-At": new Date().toISOString() } }),
  )
  const keys = await cache.keys()
  const excess = keys.length - TB_MAX_PAGES
  for (let i = 0; i < excess; i++) await cache.delete(keys[i])
}

async function forgetTbPage(origin, pathname) {
  const cache = await caches.open(TB_PAGES_CACHE)
  await cache.delete(new Request(origin + pathname))
}

function formatSavedAt(iso) {
  const d = new Date(iso || "")
  if (Number.isNaN(d.getTime())) return ""
  const p = (n) => String(n).padStart(2, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** Bản đã lưu + chèn thanh vàng cuối <body> (React 19 bỏ qua thẻ lạ chèn vào body khi hydrate). */
async function cachedTbResponse(origin, pathname) {
  const cache = await caches.open(TB_PAGES_CACHE)
  const hit = await cache.match(new Request(origin + pathname))
  if (!hit) return null
  const html = await hit.text()
  const savedAt = formatSavedAt(hit.headers.get("X-Tb-Saved-At"))
  const banner =
    `<div id="sw-offline-banner" role="status" style="position:fixed;left:0;right:0;top:0;z-index:2147483000;` +
    `background:#fef3c7;color:#92400e;border-bottom:1px solid #fcd34d;padding:8px 12px;font:600 13px system-ui,sans-serif;` +
    `text-align:center">Không có kết nối — đang hiển thị thông tin công khai đã lưu${savedAt ? ` lúc ${savedAt}` : ""}</div>`
  const out = html.includes("</body>") ? html.replace("</body>", `${banner}</body>`) : html + banner
  return new Response(out, { headers: { "Content-Type": hit.headers.get("Content-Type") || "text/html; charset=utf-8" } })
}

async function handleTbNavigation(event) {
  const url = new URL(event.request.url)
  const network = (async () => {
    const res = await fetch(event.request)
    const type = res.headers.get("content-type") || ""
    if (res.status === 404) {
      // Tem đã "Tạo lại QR" / thiết bị bị xoá ⇒ bỏ bản lưu cũ.
      event.waitUntil(forgetTbPage(url.origin, url.pathname).catch(() => {}))
    } else if (res.ok && !res.redirected && type.includes("text/html")) {
      const html = await res.clone().text()
      event.waitUntil(
        storeTbPage(url.origin, url.pathname, html, type)
          .then(() => caches.open(TB_CACHE))
          .then((c) => precacheStaticFrom(html, url.origin, c))
          .catch(() => {}),
      )
    }
    return res
  })()

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS))
  try {
    const winner = await Promise.race([network, timeout])
    if (winner) return winner
    event.waitUntil(network.catch(() => {}))
    const cached = await cachedTbResponse(url.origin, url.pathname)
    return cached || (await network)
  } catch {
    const cached = await cachedTbResponse(url.origin, url.pathname)
    return cached || new Response(TB_OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}

/** Trang tem tự yêu cầu lưu (lần mở đầu SW chưa kiểm soát trang / vào bằng link trong app = RSC). */
async function cacheTbPage(origin, pathname, extra) {
  if (!isTbPath(pathname)) return
  const res = await fetch(origin + pathname, { credentials: "same-origin" })
  const type = res.headers.get("content-type") || ""
  if (res.status === 404) {
    await forgetTbPage(origin, pathname)
    return
  }
  const cache = await caches.open(TB_CACHE)
  if (res.ok && !res.redirected && type.includes("text/html")) {
    const html = await res.text()
    await storeTbPage(origin, pathname, html, type)
    await precacheStaticFrom(html, origin, cache)
  }
  const paths = (Array.isArray(extra) ? extra : [])
    .filter((p) => typeof p === "string" && p.startsWith("/_next/static/"))
    .join(" ")
  if (paths) await precacheStaticFrom(paths, origin, cache)
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
    else if (isTbPath(url.pathname)) event.respondWith(handleTbNavigation(event))
    else if (url.pathname === "/login") event.respondWith(handleLoginNavigation(event))
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
