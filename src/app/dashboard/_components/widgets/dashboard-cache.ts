// Cache Promise dùng chung giữa các widget Dashboard — 2 widget cần cùng 1 dữ liệu (vd tổng
// tồn kho nguyên liệu, báo cáo chất lượng tháng) sẽ dùng chung 1 request đang bay thay vì
// gọi DB 2 lần. Chỉ sống trong phạm vi tab hiện tại, hết hạn sau ttlMs.

type Entry = { promise: Promise<unknown>; expires: number }

const cache = new Map<string, Entry>()

export function cachedQuery<T>(key: string, fn: () => Promise<T>, ttlMs = 60_000): Promise<T> {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.expires > now) return hit.promise as Promise<T>
  const promise = fn().catch((err) => {
    // Lỗi thì không giữ trong cache — lần sau gọi lại được.
    cache.delete(key)
    throw err
  })
  cache.set(key, { promise, expires: now + ttlMs })
  return promise
}
