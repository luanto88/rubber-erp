import type { Geometry, Polygon, MultiPolygon, Feature } from "geojson"

/**
 * Tính diện tích trắc địa (geodesic area) theo hecta cho một vòng tọa độ [lon, lat] khép kín
 */
export function calculateRingAreaHa(ring: number[][]): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0
  const R = 6378137 // Bán kính chuẩn WGS84
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i]
    const p2 = ring[(i + 1) % ring.length]
    if (!p1 || !p2 || p1.length < 2 || p2.length < 2) continue
    const x1 = (p1[0] * Math.PI) / 180
    const y1 = (p1[1] * Math.PI) / 180
    const x2 = (p2[0] * Math.PI) / 180
    const y2 = (p2[1] * Math.PI) / 180
    area += (x2 - x1) * (2 + Math.sin(y1) + Math.sin(y2))
  }
  area = Math.abs((area * R * R) / 2.0)
  return area / 10000 // Chuyển từ m² sang hecta
}

/**
 * Tính tổng diện tích hình học (hecta) của đối tượng Geometry (Polygon hoặc MultiPolygon)
 */
export function calculateGeometryAreaHa(geometry: Geometry | null | undefined): number {
  if (!geometry) return 0
  if (geometry.type === "Polygon") {
    const coords = (geometry as Polygon).coordinates
    if (!coords || !coords.length) return 0
    let total = calculateRingAreaHa(coords[0])
    for (let i = 1; i < coords.length; i++) {
      total -= calculateRingAreaHa(coords[i])
    }
    return Math.max(0, total)
  }
  if (geometry.type === "MultiPolygon") {
    const coords = (geometry as MultiPolygon).coordinates
    let total = 0
    for (const poly of coords) {
      if (!poly || !poly.length) continue
      let polyArea = calculateRingAreaHa(poly[0])
      for (let i = 1; i < poly.length; i++) {
        polyArea -= calculateRingAreaHa(poly[i])
      }
      total += Math.max(0, polyArea)
    }
    return total
  }
  return 0
}

/**
 * Tự động loại bỏ các đỉnh lùi (fold-back / spike) gập ngược 180° dọc theo cùng một đường ranh giới
 */
export function removeFoldBackSpikes(ring: number[][]): number[][] {
  if (ring.length <= 3) return ring
  let changed = true
  let current = [...ring]
  while (changed && current.length > 3) {
    changed = false
    const next: number[][] = []
    const n = current.length
    for (let i = 0; i < n; i++) {
      if (i > 0 && i < n - 1) {
        const A = current[i - 1]
        const B = current[i]
        const C = current[i + 1]
        const dx1 = B[0] - A[0]
        const dy1 = B[1] - A[1]
        const dx2 = C[0] - B[0]
        const dy2 = C[1] - B[1]
        const dot = dx1 * dx2 + dy1 * dy2
        const len1 = Math.hypot(dx1, dy1)
        const len2 = Math.hypot(dx2, dy2)
        if (len1 > 1e-7 && len2 > 1e-7 && dot / (len1 * len2) < -0.99) {
          // Đỉnh B là đỉnh gập ngược 180° gây tự cắt (spike/retrace) -> loại bỏ
          changed = true
          continue
        }
      }
      next.push(current[i])
    }
    current = next
  }
  return current
}

/**
 * Làm sạch một vòng tọa độ:
 * 1. Làm tròn 6 chữ số thập phân chuẩn WGS84 (~0.11m thực địa)
 * 2. Loại bỏ đỉnh liên tiếp bị trùng
 * 3. Tự động loại bỏ các đỉnh lùi gập ngược 180° (fold-back spikes)
 * 4. Đảm bảo vòng khép kín (đỉnh cuối trùng đỉnh đầu)
 */
export function sanitizeRing(ring: number[][]): number[][] {
  if (!Array.isArray(ring) || ring.length === 0) return []
  const cleaned: number[][] = []

  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i]
    if (!pt || pt.length < 2) continue
    const lon = Number(Number(pt[0]).toFixed(6))
    const lat = Number(Number(pt[1]).toFixed(6))
    if (cleaned.length > 0) {
      const prev = cleaned[cleaned.length - 1]
      // Bỏ qua đỉnh trùng lặp liên tiếp
      if (Math.abs(prev[0] - lon) < 1e-9 && Math.abs(prev[1] - lat) < 1e-9) {
        continue
      }
    }
    cleaned.push([lon, lat])
  }

  if (cleaned.length < 3) return cleaned

  // Loại bỏ đỉnh lùi gập ngược 180° (fold-back / spike)
  const withNoSpikes = removeFoldBackSpikes(cleaned)
  if (withNoSpikes.length < 3) return withNoSpikes

  // Đảm bảo khép kín vòng
  const first = withNoSpikes[0]
  const last = withNoSpikes[withNoSpikes.length - 1]
  if (Math.abs(first[0] - last[0]) > 1e-9 || Math.abs(first[1] - last[1]) > 1e-9) {
    withNoSpikes.push([first[0], first[1]])
  }

  return withNoSpikes
}

/**
 * Làm sạch hình học theo quy chuẩn EUDR:
 * - Loại bỏ toàn bộ vòng trong (holes) — chỉ giữ ranh giới ngoài (exterior ring)
 * - Khép kín vòng
 * - Làm tròn 6 chữ số thập phân
 */
export function sanitizeEudrGeometry<T extends Geometry>(geometry: T): T {
  if (!geometry) return geometry

  if (geometry.type === "Polygon") {
    const poly = geometry as unknown as Polygon
    const exterior = poly.coordinates && poly.coordinates[0] ? sanitizeRing(poly.coordinates[0]) : []
    return {
      ...poly,
      coordinates: [exterior],
    } as unknown as T
  }

  if (geometry.type === "MultiPolygon") {
    const multi = geometry as unknown as MultiPolygon
    const cleanedPolys = (multi.coordinates || []).map((polyCoords) => {
      const exterior = polyCoords && polyCoords[0] ? sanitizeRing(polyCoords[0]) : []
      return [exterior]
    })
    return {
      ...multi,
      coordinates: cleanedPolys,
    } as unknown as T
  }

  return geometry
}

/**
 * Sắp xếp danh sách Feature cố định theo Ma_lo_2026 tăng dần
 * Đảm bảo tính tái lập và thứ tự gán plotId đồng nhất cho công cụ Whisp / TRACES
 */
export function sortFeaturesByPlotCode<T extends Feature>(features: T[]): T[] {
  return [...features].sort((a, b) => {
    const codeA = String(a.properties?.Ma_lo_2026 || a.properties?.Ma_lo || a.properties?.Ten || "")
    const codeB = String(b.properties?.Ma_lo_2026 || b.properties?.Ma_lo || b.properties?.Ten || "")
    return codeA.localeCompare(codeB, "vi", { numeric: true })
  })
}
