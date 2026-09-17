import type { FeatureCollection, Polygon, MultiPolygon } from "geojson"
import { calculateGeometryAreaHa } from "./eudr-geometry-cleaner"

export type EudrValidationResult = {
  isValid: boolean
  errors: string[]
  warnings: string[]
  details: Array<{
    plotCode: string
    declaredArea: number
    geomArea: number
    diffArea: number
    diffPct: number
    hasHoles: boolean
    hasKinks: boolean
    isClosed: boolean
    coordsValid: boolean
    issues: string[]
  }>
}

function ccw(A: number[], B: number[], C: number[]) {
  return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0])
}

function segmentsIntersect(A: number[], B: number[], C: number[], D: number[]): boolean {
  // If adjacent or sharing an exact vertex, they don't intersect in a crossing way
  if (
    (Math.abs(A[0] - C[0]) < 1e-9 && Math.abs(A[1] - C[1]) < 1e-9) ||
    (Math.abs(A[0] - D[0]) < 1e-9 && Math.abs(A[1] - D[1]) < 1e-9) ||
    (Math.abs(B[0] - C[0]) < 1e-9 && Math.abs(B[1] - C[1]) < 1e-9) ||
    (Math.abs(B[0] - D[0]) < 1e-9 && Math.abs(B[1] - D[1]) < 1e-9)
  ) {
    return false
  }
  return ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D)
}

/**
 * Kiểm tra vòng có bị tự cắt (self-intersection)
 */
export function checkRingSelfIntersection(ring: number[][]): { hasIntersection: boolean; atPoint?: [number, number] } {
  if (!Array.isArray(ring) || ring.length < 4) return { hasIntersection: false }
  const n = ring.length - 1

  // 1. Kiểm tra đỉnh lùi trực tiếp (fold-back spike)
  for (let i = 0; i < ring.length - 2; i++) {
    const A = ring[i]
    const B = ring[i + 1]
    const C = ring[i + 2]
    if (!A || !B || !C) continue
    const dx1 = B[0] - A[0]
    const dy1 = B[1] - A[1]
    const dx2 = C[0] - B[0]
    const dy2 = C[1] - B[1]
    const len1 = Math.hypot(dx1, dy1)
    const len2 = Math.hypot(dx2, dy2)
    if (len1 > 1e-7 && len2 > 1e-7) {
      const dot = dx1 * dx2 + dy1 * dy2
      if (dot / (len1 * len2) < -0.9999) {
        return { hasIntersection: true, atPoint: [B[0], B[1]] }
      }
    }
  }

  // 2. Kiểm tra giao cắt giữa các đoạn không kề nhau
  for (let i = 0; i < n; i++) {
    const A = ring[i]
    const B = ring[i + 1]
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      const C = ring[j]
      const D = ring[j + 1]
      if (segmentsIntersect(A, B, C, D)) {
        return { hasIntersection: true, atPoint: [A[0], A[1]] }
      }
    }
  }

  return { hasIntersection: false }
}

/**
 * Cổng kiểm tra tính hợp lệ trước khi xuất file GeoJSON theo chuẩn EUDR / TRACES
 */
export function validateEudrCollection(collection: FeatureCollection | null | undefined): EudrValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const details: EudrValidationResult["details"] = []

  if (!collection || !Array.isArray(collection.features) || collection.features.length === 0) {
    return {
      isValid: false,
      errors: ["File GeoJSON không có dữ liệu hoặc danh sách features rỗng."],
      warnings: [],
      details: [],
    }
  }

  const seenPlotCodes = new Set<string>()

  collection.features.forEach((feature, idx) => {
    const p = (feature.properties || {}) as Record<string, unknown>
    const plotCode = String(p.Ma_lo_2026 || p.Ma_lo || p.Ten || `feature_${idx + 1}`).trim()
    const declaredArea = Number(p.Dtich2026_ha ?? p.Area ?? 0) || 0
    const geomArea = calculateGeometryAreaHa(feature.geometry)
    const diffArea = geomArea - declaredArea
    const diffPct = declaredArea > 0 ? (Math.abs(diffArea) / declaredArea) * 100 : (geomArea > 0 ? 100 : 0)

    const issues: string[] = []
    let hasHoles = false
    let hasKinks = false
    let isClosed = true
    let coordsValid = true

    // 1. Kiểm tra mã lô rỗng / trùng lặp
    if (!plotCode || plotCode.startsWith("feature_")) {
      errors.push(`Feature #${idx + 1}: Mã lô bị rỗng.`)
      issues.push("Mã lô rỗng")
    } else if (seenPlotCodes.has(plotCode)) {
      errors.push(`Lô [${plotCode}]: Bị trùng lặp nhiều feature trong cùng một file.`)
      issues.push("Trùng lặp mã lô")
    } else {
      seenPlotCodes.add(plotCode)
    }

    // 2. Kiểm tra thuộc tính bắt buộc của EUDR / TRACES
    if (!p.ProducerName) {
      warnings.push(`Lô [${plotCode}]: Thiếu thuộc tính 'ProducerName'.`)
    }
    if (!p.ProducerCountry && !p.producerCountry) {
      errors.push(`Lô [${plotCode}]: Thiếu thuộc tính bắt buộc 'ProducerCountry' / 'producerCountry'.`)
      issues.push("Thiếu ProducerCountry")
    }

    // 3. Kiểm tra hình học
    const geom = feature.geometry
    if (!geom) {
      errors.push(`Lô [${plotCode}]: Không có hình học (geometry = null).`)
      issues.push("Không có geometry")
    } else if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") {
      errors.push(`Lô [${plotCode}]: Định dạng hình học không hợp lệ (${geom.type}). Chỉ cho phép Polygon hoặc MultiPolygon.`)
      issues.push(`Sai định dạng hình học: ${geom.type}`)
    } else {
      const polygons: number[][][][] =
        geom.type === "Polygon"
          ? [(geom as Polygon).coordinates as number[][][]]
          : ((geom as MultiPolygon).coordinates as number[][][][])

      for (const rings of polygons) {
        // Kiểm tra vòng trong (lỗ)
        if (rings.length > 1) {
          hasHoles = true
          errors.push(`Lô [${plotCode}]: Chứa ${rings.length - 1} vòng trong (lỗ). Quy định EUDR không cho phép đa giác có lỗ.`)
          issues.push("Có vòng trong (lỗ)")
        }

        const exterior = rings[0]
        if (!exterior || exterior.length < 4) {
          errors.push(`Lô [${plotCode}]: Ranh giới ngoài không đủ điểm (tối thiểu 4 điểm).`)
          issues.push("Không đủ điểm ranh giới")
          continue
        }

        // Kiểm tra khép kín vòng
        const first = exterior[0]
        const last = exterior[exterior.length - 1]
        if (Math.abs(first[0] - last[0]) > 1e-7 || Math.abs(first[1] - last[1]) > 1e-7) {
          isClosed = false
          errors.push(`Lô [${plotCode}]: Ranh giới chưa khép kín (điểm đầu khác điểm cuối).`)
          issues.push("Ranh giới chưa khép kín")
        }

        // Kiểm tra tọa độ WGS84 nằm trong dải Campuchia/Đông Dương
        for (const pt of exterior) {
          const lon = pt[0]
          const lat = pt[1]
          if (lon < 102 || lon > 110 || lat < 8 || lat > 24) {
            coordsValid = false
            errors.push(`Lô [${plotCode}]: Tọa độ ngoài phạm vi cho phép [lon=${lon}, lat=${lat}].`)
            issues.push(`Tọa độ ngoài phạm vi: ${lon}, ${lat}`)
            break
          }
        }

        // Kiểm tra tự cắt (self-intersection)
        const kinkCheck = checkRingSelfIntersection(exterior)
        if (kinkCheck.hasIntersection) {
          hasKinks = true
          const coordStr = kinkCheck.atPoint ? ` (tại tọa độ ${kinkCheck.atPoint[0]}, ${kinkCheck.atPoint[1]})` : ""
          errors.push(`Lô [${plotCode}]: Ranh giới tự cắt qua chính nó (Self-intersection)${coordStr}.`)
          issues.push(`Tự cắt${coordStr}`)
        }
      }
    }

    // 4. Kiểm tra diện tích
    if (geomArea <= 0.001) {
      errors.push(`Lô [${plotCode}]: Diện tích hình học bằng 0 hoặc quá nhỏ (< 0.001 ha).`)
      issues.push("Diện tích bằng 0")
    } else if (diffPct > 10 && declaredArea > 0) {
      warnings.push(
        `Lô [${plotCode}]: Diện tích hình học (${geomArea.toFixed(2)} ha) lệch ${diffPct.toFixed(1)}% so với diện tích khai báo (${declaredArea.toFixed(2)} ha, chênh ${diffArea > 0 ? "+" : ""}${diffArea.toFixed(2)} ha).`,
      )
      issues.push(`Lệch diện tích ${diffPct.toFixed(1)}%`)
    }

    details.push({
      plotCode,
      declaredArea,
      geomArea,
      diffArea,
      diffPct,
      hasHoles,
      hasKinks,
      isClosed,
      coordsValid,
      issues,
    })
  })

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    details,
  }
}
