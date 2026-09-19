import type { FeatureCollection, Polygon, MultiPolygon } from "geojson"
import { calculateGeometryAreaHa, MIN_PIECE_AREA_HA } from "./eudr-geometry-cleaner"
import { analyzeRingTopology, describeRingDefect } from "./eudr-ring-topology"

/**
 * Cổng kiểm tra file GeoJSON trước khi giao khách, theo chính sách 3 mức đã chốt.
 *
 * Nguyên tắc nền: **không bao giờ chặn xuất file chỉ vì lỗi hình học.**
 * Hình học sai thì tự làm sạch và ghi nhật ký; chỉ chặn khi file mất ý nghĩa khai báo.
 *
 *   Mức 1 (fixed)    — tự sửa + ghi nhật ký: tự cắt, có lỗ, vòng hở, làm tròn toạ độ.
 *   Mức 2 (warning)  — loại khỏi file + ghi rõ: mảnh vụn dưới 0,01 ha khi lô còn mảnh khác.
 *   Mức 3 (blocking) — chặn xuất: mã lô rỗng/trùng, toạ độ ngoài Campuchia,
 *                      lô thuộc đơn mà mất sạch hình học, hoặc không còn lô nào.
 *
 * ⚠️ Về Mức 3 và lô mất sạch hình học: ở cổng xuất, MỌI lô đều thuộc đơn hàng (danh sách lô
 * suy ra từ chính chuỗi truy xuất của đơn). Nên một lô không còn hình học nghĩa là sản phẩm
 * từ lô đó không có dữ liệu định vị — phải CHẶN và bắt người dùng sửa, tuyệt đối không loại
 * âm thầm. Việc loại âm thầm chính là lỗ hổng truy xuất mà cổng này sinh ra để bịt.
 */

export type EudrIssueSeverity = "blocking" | "warning" | "fixed"

export type EudrIssue = {
  severity: EudrIssueSeverity
  code: string
  plotCode: string
  message: string
  at?: [number, number]
}

export type EudrValidationResult = {
  /** Chỉ `false` khi có lỗi Mức 3. Lỗi hình học đã tự sửa không làm file mất hiệu lực. */
  isValid: boolean
  issues: EudrIssue[]
  blocking: EudrIssue[]
  warnings: EudrIssue[]
  fixed: EudrIssue[]
  /** Giữ để tương thích với các nơi gọi cũ đang đọc `errors`. */
  errors: string[]
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

/**
 * Kiểm tra một vòng có tự cắt / tự chạm hay không.
 *
 * Nay chỉ là lớp mỏng gọi kernel `analyzeRingTopology()`. Bản cũ tự cài thuật toán và có
 * hai điểm mù đã được chứng minh bằng code thật:
 *  - `segmentsIntersect()` trả `false` ngay khi hai đoạn chia sẻ đỉnh chính xác → MÙ HOÀN TOÀN
 *    với pinch point, đúng loại lỗi "Ring Self-intersection" mà khách hàng báo về.
 *  - Vòng lặp dò spike chạy `i < length - 2` nên bỏ sót đỉnh gập ngay tại chỗ nối đầu–cuối.
 */
export function checkRingSelfIntersection(ring: number[][]): {
  hasIntersection: boolean
  atPoint?: [number, number]
} {
  const result = analyzeRingTopology(ring)
  if (result.isSimple) return { hasIntersection: false }
  const first = result.defects.find((d) => d.kind !== "Degenerate")
  if (!first) return { hasIntersection: false }
  return { hasIntersection: true, atPoint: first.at }
}

/** Phạm vi toạ độ hợp lệ cho vùng trồng tại Campuchia / Đông Dương. */
const LON_MIN = 102
const LON_MAX = 110
const LAT_MIN = 8
const LAT_MAX = 24

export function validateEudrCollection(
  collection: FeatureCollection | null | undefined,
): EudrValidationResult {
  const issues: EudrIssue[] = []
  const details: EudrValidationResult["details"] = []

  const push = (
    severity: EudrIssueSeverity,
    code: string,
    plotCode: string,
    message: string,
    at?: [number, number],
  ) => {
    issues.push({ severity, code, plotCode, message, at })
  }

  const build = (): EudrValidationResult => {
    const blocking = issues.filter((i) => i.severity === "blocking")
    const warnings = issues.filter((i) => i.severity === "warning")
    const fixed = issues.filter((i) => i.severity === "fixed")
    return {
      isValid: blocking.length === 0,
      issues,
      blocking,
      warnings,
      fixed,
      errors: blocking.map((i) => i.message),
      details,
    }
  }

  if (!collection || !Array.isArray(collection.features) || collection.features.length === 0) {
    push("blocking", "EMPTY_COLLECTION", "-", "File GeoJSON không có lô nào sau khi làm sạch.")
    return build()
  }

  // Một lô có thể xuất thành nhiều feature (lô bị đường/suối cắt thành nhiều mảnh).
  // Vì vậy KHÔNG coi mã lô lặp lại là trùng lặp; chỉ gom lại để đối chiếu diện tích.
  const byPlot = new Map<string, { declared: number; geom: number; areaSum: number; count: number }>()

  collection.features.forEach((feature, idx) => {
    const p = (feature.properties || {}) as Record<string, unknown>
    const plotCode = String(p.Ma_lo_2026 || p.Ma_lo || p.Ten || "").trim()
    const declaredArea = Number(p.Dtich2026_ha ?? 0) || 0
    const geomArea = calculateGeometryAreaHa(feature.geometry)
    const featureArea = Number(p.Area ?? 0) || 0
    // Diện tích khai báo Ở CẤP LÔ (không phải cấp mảnh) — dùng cho đối chiếu byPlot bên dưới.
    // `Dtich_lo_ha` chỉ tồn tại trên lô nhiều mảnh (giống nhau trên mọi mảnh cùng mã lô, xem
    // eudr-feature-collection.ts); lô 1 mảnh không có field này nên fallback về `declaredArea`
    // (Dtich2026_ha), vốn với lô 1 mảnh chính là diện tích cả lô — hành vi không đổi.
    const lotDeclaredArea = Number(p.Dtich_lo_ha ?? p.Dtich2026_ha ?? 0) || 0

    const localIssues: string[] = []
    let hasHoles = false
    let hasKinks = false
    let isClosed = true
    let coordsValid = true

    // ── Mức 3: mã lô rỗng ──────────────────────────────────────────────────────────
    if (!plotCode) {
      push("blocking", "EMPTY_PLOT_CODE", `feature #${idx + 1}`, `Feature #${idx + 1}: mã lô bị rỗng.`)
      localIssues.push("Mã lô rỗng")
    }

    // ── Mức 3: thiếu thuộc tính bắt buộc của TRACES ────────────────────────────────
    if (!p.ProducerCountry && !p.producerCountry) {
      push(
        "blocking",
        "MISSING_PRODUCER_COUNTRY",
        plotCode,
        `Lô [${plotCode}]: thiếu thuộc tính bắt buộc 'ProducerCountry' / 'producerCountry'.`,
      )
      localIssues.push("Thiếu ProducerCountry")
    }
    if (!p.ProducerName) {
      push("warning", "MISSING_PRODUCER_NAME", plotCode, `Lô [${plotCode}]: thiếu thuộc tính 'ProducerName'.`)
    }

    // ── Hình học ───────────────────────────────────────────────────────────────────
    const geom = feature.geometry
    if (!geom) {
      push("blocking", "NO_GEOMETRY", plotCode, `Lô [${plotCode}]: không có hình học.`)
      localIssues.push("Không có geometry")
    } else if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") {
      push(
        "blocking",
        "BAD_GEOMETRY_TYPE",
        plotCode,
        `Lô [${plotCode}]: định dạng hình học không hợp lệ (${geom.type}). Chỉ cho phép Polygon hoặc MultiPolygon.`,
      )
      localIssues.push(`Sai định dạng hình học: ${geom.type}`)
    } else {
      const polygons: number[][][][] =
        geom.type === "Polygon"
          ? [(geom as Polygon).coordinates as number[][][]]
          : ((geom as MultiPolygon).coordinates as number[][][][])

      for (const rings of polygons) {
        // Mức 1: còn vòng trong nghĩa là cleaner chưa chạy — vẫn xuất được, chỉ cảnh báo
        if (rings.length > 1) {
          hasHoles = true
          push(
            "warning",
            "HAS_HOLES",
            plotCode,
            `Lô [${plotCode}]: còn ${rings.length - 1} vòng trong (lỗ) chưa được làm sạch.`,
          )
          localIssues.push("Có vòng trong (lỗ)")
        }

        const exterior = rings[0]
        if (!exterior || exterior.length < 4) {
          push("blocking", "RING_TOO_SHORT", plotCode, `Lô [${plotCode}]: ranh giới ngoài không đủ 4 điểm.`)
          localIssues.push("Không đủ điểm ranh giới")
          continue
        }

        const first = exterior[0]
        const last = exterior[exterior.length - 1]
        if (first[0] !== last[0] || first[1] !== last[1]) {
          isClosed = false
          push("warning", "RING_NOT_CLOSED", plotCode, `Lô [${plotCode}]: ranh giới chưa khép kín.`)
          localIssues.push("Ranh giới chưa khép kín")
        }

        // ── Mức 3: toạ độ ngoài phạm vi Campuchia ────────────────────────────────
        for (const pt of exterior) {
          if (pt[0] < LON_MIN || pt[0] > LON_MAX || pt[1] < LAT_MIN || pt[1] > LAT_MAX) {
            coordsValid = false
            push(
              "blocking",
              "COORDS_OUT_OF_RANGE",
              plotCode,
              `Lô [${plotCode}]: toạ độ ngoài phạm vi cho phép [lon=${pt[0]}, lat=${pt[1]}].`,
              [pt[0], pt[1]],
            )
            localIssues.push(`Toạ độ ngoài phạm vi: ${pt[0]}, ${pt[1]}`)
            break
          }
        }

        // ── Mức 1: tự cắt / tự chạm ──────────────────────────────────────────────
        const topo = analyzeRingTopology(exterior)
        if (!topo.isSimple) {
          hasKinks = true
          const defect = topo.defects[0]
          push(
            "warning",
            "RING_SELF_INTERSECTION",
            plotCode,
            `Lô [${plotCode}]: ${describeRingDefect(defect)} — chưa được làm sạch.`,
            defect.kind === "Degenerate" ? undefined : defect.at,
          )
          localIssues.push("Ranh giới tự cắt")
        }
      }
    }

    // ── Mức 3: lô thuộc đơn nhưng mất sạch hình học ────────────────────────────────
    if (geomArea < MIN_PIECE_AREA_HA) {
      push(
        "blocking",
        "PLOT_AREA_TOO_SMALL",
        plotCode,
        `Lô [${plotCode}]: diện tích hình học chỉ còn ${geomArea.toFixed(6)} ha (dưới ${MIN_PIECE_AREA_HA} ha). ` +
          `Lô này thuộc đơn hàng nên không được loại bỏ — cần sửa ranh giới tại Cài đặt → Lô vườn → ${plotCode}.`,
      )
      localIssues.push("Diện tích quá nhỏ")
    }

    if (plotCode) {
      const acc = byPlot.get(plotCode) || { declared: lotDeclaredArea, geom: 0, areaSum: 0, count: 0 }
      acc.declared = lotDeclaredArea || acc.declared
      acc.geom += geomArea
      acc.areaSum += featureArea
      acc.count += 1
      byPlot.set(plotCode, acc)
    }

    details.push({
      plotCode,
      declaredArea,
      geomArea,
      diffArea: geomArea - declaredArea,
      diffPct: declaredArea > 0 ? (Math.abs(geomArea - declaredArea) / declaredArea) * 100 : 0,
      hasHoles,
      hasKinks,
      isClosed,
      coordsValid,
      issues: localIssues,
    })
  })

  // ── Đối chiếu ở cấp lô (sau khi đã gom mọi mảnh của cùng một mã lô) ──────────────
  for (const [plotCode, acc] of byPlot) {
    // `Area` phải luôn bắt nguồn từ số đo khai báo. Tổng `Area` của mọi mảnh cùng mã lô
    // phải bằng đúng diện tích khai báo CẢ LÔ (`acc.declared`, lấy từ `Dtich_lo_ha` nếu có,
    // fallback `Dtich2026_ha`) — nếu lệch nghĩa là ai đó đã lấy `Area` từ hình học.
    if (acc.declared > 0 && Math.abs(acc.areaSum - acc.declared) > 0.02) {
      push(
        "warning",
        "AREA_SUM_MISMATCH",
        plotCode,
        `Lô [${plotCode}]: tổng 'Area' của ${acc.count} mảnh là ${acc.areaSum.toFixed(2)} ha, ` +
          `khác diện tích khai báo ${acc.declared.toFixed(2)} ha.`,
      )
    }
    if (acc.declared > 0) {
      const diffPct = (Math.abs(acc.geom - acc.declared) / acc.declared) * 100
      if (diffPct > 10) {
        push(
          "warning",
          "AREA_DEVIATION",
          plotCode,
          `Lô [${plotCode}]: diện tích hình học (${acc.geom.toFixed(2)} ha) lệch ${diffPct.toFixed(1)}% ` +
            `so với diện tích khai báo (${acc.declared.toFixed(2)} ha).`,
        )
      }
    }
  }

  return build()
}
