// So khớp tên gần giống (chống tạo trùng vật tư, vd "rotyl" ~ "rotin").
// Thuần TS, không phụ thuộc thư viện/extension DB — dùng được cả client lẫn server.

const COMBINING_RE = new RegExp("[\\u0300-\\u036f]", "g")

/** Chuẩn hoá: bỏ dấu, đ→d, chữ thường, chỉ giữ chữ/số và 1 khoảng trắng giữa các từ. */
export function normalizeName(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(COMBINING_RE, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[b.length]
}

function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatch = new Array<boolean>(a.length).fill(false)
  const bMatch = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(i + range + 1, b.length)
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue
      aMatch[i] = true
      bMatch[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0
  let t = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue
    while (!bMatch[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const m = matches
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3
  let prefix = 0
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

/** Điểm giống nhau 0..1 giữa 2 tên (đã gồm chuẩn hoá). */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const compactX = x.replace(/ /g, "")
  const compactY = y.replace(/ /g, "")
  if (compactX === compactY) return 0.99
  const lev = 1 - levenshtein(compactX, compactY) / Math.max(compactX.length, compactY.length)
  const jw = jaroWinkler(compactX, compactY)
  // Một tên nằm trọn trong tên kia ("dau nhot" ⊂ "dau nhot 40") — gần như chắc trùng
  const contains =
    Math.min(compactX.length, compactY.length) >= 4 && (compactX.includes(compactY) || compactY.includes(compactX))
      ? 0.9
      : 0
  // So từng từ: tỉ lệ từ của tên ngắn có từ gần giống bên tên dài
  const tx = x.split(" ")
  const ty = y.split(" ")
  const [short, long] = tx.length <= ty.length ? [tx, ty] : [ty, tx]
  const tokenHits = short.filter((w) => long.some((v) => w === v || (w.length >= 4 && jaroWinkler(w, v) >= 0.9))).length
  const token = short.length ? (tokenHits / long.length) * 0.95 : 0
  return Math.max(lev, jw, contains, token)
}

export const SIMILAR_NAME_THRESHOLD = 0.8

export type SimilarCandidate<T> = { item: T; score: number }

/** Các mục có tên gần giống `name` (điểm ≥ ngưỡng), sắp giảm dần, tối đa `limit`. */
export function findSimilarNames<T>(
  name: string,
  items: T[],
  getName: (item: T) => string,
  options: { threshold?: number; limit?: number } = {},
): SimilarCandidate<T>[] {
  const threshold = options.threshold ?? SIMILAR_NAME_THRESHOLD
  const limit = options.limit ?? 5
  if (normalizeName(name).length < 3) return []
  return items
    .map((item) => ({ item, score: nameSimilarity(name, getName(item)) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
