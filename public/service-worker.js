const CACHE_NAME = "qlsxkpt-shell-v1"
const STATIC_ASSETS = ["/manifest.json", "/icon-192.png", "/icon-512.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

// Chỉ phục vụ từ cache cho đúng vài asset tĩnh ở trên — mọi request khác (trang, API, Supabase)
// luôn đi thẳng network, không cache, để không bao giờ hiển thị dữ liệu nghiệp vụ cũ và không
// bao giờ có rủi ro trang cũ tham chiếu tới JS chunk đã bị dọn sau khi deploy bản mới.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return
  const url = new URL(event.request.url)
  if (!STATIC_ASSETS.includes(url.pathname)) return
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)))
})
