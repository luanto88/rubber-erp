import type { Geometry, Polygon, MultiPolygon, Feature } from "geojson"
import turfArea from "@turf/area"
// ⚠️ Bản ESM của polygon-clipping CHỈ có default export. Dùng `import * as` sẽ cho
// `union === undefined` và mọi lời gọi make_valid lặng lẽ trả về rỗng.
import polygonClipping from "polygon-clipping"
import { analyzeRingTopology, describeRingDefect, ringSignedAreaGrid, toFixedGrid } from "./eudr-ring-topology"

/**
 * Ngưỡng diện tích tối thiểu của một mảnh đa giác (hecta).
 *
 * Mảnh nhỏ hơn ngưỡng này là mảnh vụn (sliver) do sai số số hoá, không phải vùng trồng thật.
 * Ngưỡng 0,01 ha = 100 m², lấy theo Phần D.2 của tài liệu yêu cầu.
 *
 * ⚠️ Đã kiểm trên dữ liệu thật: với ngưỡng này, tổng diện tích bị bỏ trên toàn bộ 446 lô là
 * 0,0000 ha — tức không mảnh vùng trồng thật nào bị loại.
 */
export const MIN_PIECE_AREA_HA = 0.01

/**
 * Tính diện tích trắc địa (geodesic area) theo hecta cho một vòng tọa độ [lon, lat] khép kín.
 *
 * ⚠️ KHÔNG dùng kết quả của hàm này để ghi vào thuộc tính `Area` của file EUDR.
 * `Area` phải luôn là số đo trắc địa đã khai báo (`Dtich2026_ha`) — con số đã gửi khách trong
 * báo cáo Whisp/IMPACT. Hàm này chỉ dùng để: so sánh cảnh báo lệch, chia tỷ lệ khi tách mảnh,
 * và áp ngưỡng `MIN_PIECE_AREA_HA`.
 */
export function calculateRingAreaHa(ring: number[][]): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0
  // Dùng @turf/area (thuật toán trắc địa chuẩn) thay cho công thức cầu xấp xỉ trước đây.
  // Turf cần vòng khép kín, nên tự khép nếu nguồn chưa khép.
  const closed = [...ring]
  const first = closed[0]
  const last = closed[closed.length - 1]
  if (!first || !last) return 0
  if (first[0] !== last[0] || first[1] !== last[1]) closed.push([first[0], first[1]])
  if (closed.length < 4) return 0
  try {
    return turfArea({ type: "Polygon", coordinates: [closed] }) / 10000
  } catch {
    return 0
  }
}

/**
 * Tính tổng diện tích hình học (hecta) của đối tượng Geometry (Polygon hoặc MultiPolygon).
 * Vòng trong (lỗ) được trừ đi.
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

// ── Nhật ký làm sạch ────────────────────────────────────────────────────────────────

export type GeometryFixKind =
  | "rounded" // Làm tròn tọa độ về 6 chữ số thập phân
  | "deduped" // Khử đỉnh trùng liên tiếp (kể cả vắt qua điểm đóng vòng)
  | "closed" // Khép kín vòng
  | "removed_holes" // Bỏ vòng trong (lỗ) — quy định EUDR không cho phép
  | "removed_spike" // Xoá đỉnh gập ngược 180°
  | "made_valid" // Sửa tự cắt / tự chạm bằng thuật toán make_valid
  | "make_valid_failed" // Không sửa được — giữ nguyên vòng gốc và cảnh báo
  | "split_pieces" // Một vòng bị tách thành nhiều mảnh hợp lệ
  | "dropped_tiny_piece" // Bỏ mảnh vụn dưới ngưỡng MIN_PIECE_AREA_HA

export type GeometryFixLog = {
  kind: GeometryFixKind
  /** Mô tả bằng tiếng Việt để đưa vào nhật ký hiển thị cho admin và kèm hồ sơ giao khách. */
  detail: string
  /** Diện tích liên quan (hecta) — có với `dropped_tiny_piece` và `removed_holes`. */
  areaHa?: number
}

export type SanitizeGeometryResult = {
  /**
   * Danh sách mảnh đa giác hợp lệ. Mỗi phần tử là một vòng ngoài khép kín, đã làm sạch.
   *
   * ⚠️ GIỮ MỌI MẢNH ≥ MIN_PIECE_AREA_HA — tuyệt đối không chỉ giữ mảnh lớn nhất.
   * Chính quy tắc "chỉ giữ một mảnh" là nguyên nhân làm mất 101,62 ha diện tích vùng trồng
   * khi script seed dedupe theo `Ten`. Không lặp lại sai lầm đó ở đây.
   */
  pieces: number[][][]
  fixes: GeometryFixLog[]
  /** Các mảnh đã bị bỏ vì nhỏ hơn ngưỡng — luôn được ghi nhật ký, không bỏ âm thầm. */
  droppedPieces: Array<{ ring: number[][]; areaHa: number }>
  /** Tổng diện tích các mảnh giữ lại (hecta). */
  areaHa: number
}

// ── Làm sạch từng vòng ──────────────────────────────────────────────────────────────

/**
 * Loại bỏ các đỉnh gập ngược 180° (fold-back / spike) dọc theo cùng một đường ranh giới.
 *
 * Khác bản cũ ở hai điểm, đều là lỗi đã được chứng minh:
 * 1. Lặp theo **modulo n** nên bắt được cả đỉnh nằm ngay tại chỗ nối đầu–cuối của vòng.
 *    Bản cũ chỉ xét `i > 0 && i < n-1` nên bỏ sót hoàn toàn đỉnh đóng vòng (lỗ hổng V4).
 * 2. Điều kiện dùng số nguyên chính xác `cross === 0 && dot < 0` thay cho `cos < -0.99`.
 *    Ngưỡng cosin dấu phẩy động vừa bỏ sót spike dài, vừa có nguy cơ xoá nhầm góc ~172°.
 */
export function removeFoldBackSpikes(ring: number[][]): number[][] {
  if (!Array.isArray(ring) || ring.length <= 3) return ring

  let current = [...ring]
  // Bỏ đỉnh đóng vòng để làm việc trên dạng mở
  while (
    current.length > 1 &&
    current[0][0] === current[current.length - 1][0] &&
    current[0][1] === current[current.length - 1][1]
  ) {
    current.pop()
  }

  let changed = true
  while (changed && current.length > 3) {
    changed = false
    const n = current.length
    const keep: boolean[] = new Array(n).fill(true)
    for (let i = 0; i < n; i++) {
      const a = current[(i - 1 + n) % n]
      const b = current[i]
      const c = current[(i + 1) % n]
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
      if (cross !== 0) continue
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])
      if (dot < 0) {
        keep[i] = false
        changed = true
        break // xoá từng đỉnh một rồi tính lại, tránh xoá dây chuyền sai
      }
    }
    if (changed) current = current.filter((_, i) => keep[i])
  }

  // Khép lại vòng
  if (current.length >= 3) {
    const first = current[0]
    current.push([first[0], first[1]])
  }
  return current
}

/**
 * Làm sạch một vòng tọa độ về dạng chuẩn: làm tròn 6 chữ số, khử đỉnh trùng liên tiếp
 * (kể cả vắt qua điểm đóng vòng), khép kín vòng.
 *
 * Việc khử đỉnh trùng dùng chung `toFixedGrid()` của kernel để hai nơi không thể lệch nhau.
 */
export function sanitizeRing(ring: number[][]): number[][] {
  const grid = toFixedGrid(ring)
  if (grid.pts.length < 3) return []
  const out = grid.pts.map((p) => [(p[0] + grid.ox) / 1_000_000, (p[1] + grid.oy) / 1_000_000])
  out.push([out[0][0], out[0][1]])
  return out
}

/** Chuẩn hoá chiều quay của vòng theo RFC 7946. Hiện CHƯA áp dụng khi xuất (xem GĐ 7). */
export function normalizeRingWinding(ring: number[][], target: "CW" | "CCW"): number[][] {
  const grid = toFixedGrid(ring)
  if (grid.pts.length < 3) return ring
  const area = ringSignedAreaGrid(grid.pts)
  const current = area > 0 ? "CCW" : "CW"
  if (current === target) return ring
  return [...ring].reverse()
}

/**
 * Sửa một vòng tự cắt / tự chạm bằng thuật toán make_valid.
 *
 * Dùng `polygon-clipping` (thuật toán Martinez) — đây là tương đương thật trong JavaScript của
 * `shapely.make_valid`. Turf **không có** hàm tương đương: `@turf/kinks` chỉ phát hiện giao cắt
 * chéo và mù với pinch point, còn `@turf/unkink-polygon` không theo đúng ngữ nghĩa make_valid.
 *
 * Trả về **mọi mảnh** thu được, không lọc theo diện tích — việc lọc do nơi gọi quyết định.
 *
 * ⚠️ Tuyệt đối KHÔNG nuốt lỗi rồi trả về mảng rỗng: mảng rỗng đồng nghĩa với việc lô biến mất
 * khỏi hồ sơ khai báo mà không ai biết — đúng lỗ hổng truy xuất mà cả kế hoạch này sinh ra để
 * chặn. Khi không sửa được, hàm báo lỗi để nơi gọi giữ lại vòng gốc và ghi cảnh báo.
 */
function makeValidRing(ring: number[][]): { pieces: number[][][]; error?: string } {
  let result: ReturnType<typeof polygonClipping.union>
  try {
    result = polygonClipping.union([ring as [number, number][]])
  } catch (e) {
    return { pieces: [], error: e instanceof Error ? e.message : String(e) }
  }
  const pieces: number[][][] = []
  for (const poly of result) {
    // Chỉ lấy vòng ngoài của từng mảnh; vòng trong (lỗ) bị bỏ theo quy định EUDR
    const outer = poly[0]
    if (!outer || outer.length < 4) continue
    const closed = outer.map((p) => [p[0], p[1]])
    const first = closed[0]
    const last = closed[closed.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) closed.push([first[0], first[1]])
    pieces.push(closed)
  }
  if (pieces.length === 0) return { pieces: [], error: "make_valid không tạo được mảnh hợp lệ nào" }
  return { pieces }
}

/**
 * Làm sạch hình học theo quy chuẩn EUDR và trả về nhật ký đầy đủ.
 *
 * Trình tự (thứ tự bắt buộc, không đảo):
 * 1. Bỏ toàn bộ vòng trong (lỗ) — EUDR không cho phép đa giác có lỗ.
 * 2. Làm tròn 6 chữ số, khử đỉnh trùng, khép vòng.
 * 3. Xoá đỉnh gập ngược 180°.
 * 4. Nếu vòng vẫn tự cắt/tự chạm → chạy make_valid, nhận về nhiều mảnh.
 * 5. Bỏ mảnh nhỏ hơn `MIN_PIECE_AREA_HA`, **giữ lại tất cả mảnh còn lại**.
 */
export function sanitizeEudrGeometryDetailed(
  geometry: Geometry | null | undefined,
  opts?: { minPieceAreaHa?: number },
): SanitizeGeometryResult {
  const minArea = opts?.minPieceAreaHa ?? MIN_PIECE_AREA_HA
  const fixes: GeometryFixLog[] = []
  const droppedPieces: Array<{ ring: number[][]; areaHa: number }> = []
  const pieces: number[][][] = []

  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
    return { pieces: [], fixes, droppedPieces, areaHa: 0 }
  }

  // Gom mọi vòng ngoài cần xử lý, đồng thời ghi nhận các lỗ bị bỏ
  const outerRings: number[][][] = []
  if (geometry.type === "Polygon") {
    const coords = (geometry as Polygon).coordinates || []
    if (coords[0]) outerRings.push(coords[0])
    if (coords.length > 1) {
      const holeArea = coords.slice(1).reduce((s, r) => s + calculateRingAreaHa(r), 0)
      fixes.push({
        kind: "removed_holes",
        detail: `Đã bỏ ${coords.length - 1} vòng trong (lỗ) theo quy định EUDR`,
        areaHa: holeArea,
      })
    }
  } else {
    const coords = (geometry as MultiPolygon).coordinates || []
    let holeCount = 0
    let holeArea = 0
    for (const poly of coords) {
      if (!poly || !poly.length) continue
      outerRings.push(poly[0])
      if (poly.length > 1) {
        holeCount += poly.length - 1
        holeArea += poly.slice(1).reduce((s, r) => s + calculateRingAreaHa(r), 0)
      }
    }
    if (holeCount > 0) {
      fixes.push({
        kind: "removed_holes",
        detail: `Đã bỏ ${holeCount} vòng trong (lỗ) theo quy định EUDR`,
        areaHa: holeArea,
      })
    }
  }

  for (const raw of outerRings) {
    if (!Array.isArray(raw) || raw.length < 4) continue

    const cleaned = sanitizeRing(raw)
    if (cleaned.length < 4) continue
    if (cleaned.length !== raw.length) {
      fixes.push({ kind: "deduped", detail: `Đã chuẩn hoá vòng: ${raw.length} → ${cleaned.length} đỉnh` })
    }

    const despiked = removeFoldBackSpikes(cleaned)
    if (despiked.length < 4) continue
    if (despiked.length !== cleaned.length) {
      fixes.push({
        kind: "removed_spike",
        detail: `Đã xoá ${cleaned.length - despiked.length} đỉnh gập ngược 180°`,
      })
    }

    const topo = analyzeRingTopology(despiked)
    let candidates: number[][][]
    if (topo.isSimple) {
      candidates = [despiked]
    } else {
      const repaired = makeValidRing(despiked)
      if (repaired.error) {
        // Không sửa được: GIỮ NGUYÊN vòng gốc để lô không biến mất khỏi hồ sơ,
        // và ghi cảnh báo để cổng xuất báo rõ cho người dùng.
        candidates = [despiked]
        fixes.push({
          kind: "make_valid_failed",
          detail: `Không sửa được ranh giới tự cắt (${repaired.error}) — ${describeRingDefect(topo.defects[0])}`,
        })
      } else {
        candidates = repaired.pieces
        fixes.push({
          kind: "made_valid",
          detail: `Đã sửa ranh giới tự cắt bằng make_valid — ${describeRingDefect(topo.defects[0])}`,
        })
        if (candidates.length > 1) {
          fixes.push({
            kind: "split_pieces",
            detail: `Vòng được tách thành ${candidates.length} mảnh hợp lệ, giữ lại mọi mảnh từ ${minArea} ha trở lên`,
          })
        }
      }
    }

    for (const piece of candidates) {
      const normalizedPiece = sanitizeRing(piece)
      if (normalizedPiece.length < 4) continue
      const ha = calculateRingAreaHa(normalizedPiece)
      if (ha < minArea) {
        droppedPieces.push({ ring: normalizedPiece, areaHa: ha })
        fixes.push({
          kind: "dropped_tiny_piece",
          detail: `Đã bỏ 1 mảnh vụn ${ha.toFixed(6)} ha (dưới ngưỡng ${minArea} ha)`,
          areaHa: ha,
        })
        continue
      }
      pieces.push(normalizedPiece)
    }
  }

  const areaHa = pieces.reduce((s, r) => s + calculateRingAreaHa(r), 0)
  return { pieces, fixes, droppedPieces, areaHa }
}

/**
 * Bản tương thích ngược: trả về một `Geometry` duy nhất.
 * Nhiều mảnh → MultiPolygon (KHÔNG chọn mảnh lớn nhất, giữ đủ diện tích).
 */
export function sanitizeEudrGeometry<T extends Geometry>(geometry: T): T {
  const result = sanitizeEudrGeometryDetailed(geometry)
  if (result.pieces.length === 0) {
    return { ...(geometry as unknown as Polygon), coordinates: [] } as unknown as T
  }
  if (result.pieces.length === 1) {
    return { type: "Polygon", coordinates: [result.pieces[0]] } as unknown as T
  }
  return { type: "MultiPolygon", coordinates: result.pieces.map((r) => [r]) } as unknown as T
}

/**
 * Sắp xếp danh sách Feature cố định theo Ma_lo_2026 tăng dần.
 * Đảm bảo tính tái lập và thứ tự gán plotId đồng nhất cho công cụ Whisp / TRACES.
 */
export function sortFeaturesByPlotCode<T extends Feature>(features: T[]): T[] {
  return [...features].sort((a, b) => {
    const codeA = String(a.properties?.Ma_lo_2026 || a.properties?.Ma_lo || a.properties?.Ten || "")
    const codeB = String(b.properties?.Ma_lo_2026 || b.properties?.Ma_lo || b.properties?.Ten || "")
    return codeA.localeCompare(codeB, "vi", { numeric: true })
  })
}
