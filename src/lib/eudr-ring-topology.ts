/**
 * Kernel kiểm tra tô-pô vòng tọa độ (linear ring) theo đúng định nghĩa "simple" của JTS/GEOS.
 *
 * Vì sao phải có file này thay vì dùng thư viện:
 * `@turf/kinks` và phiên bản cũ của `eudr-validator.ts` đều dùng phép thử "giao cắt chéo"
 * (proper crossing) và CHỦ ĐỘNG BỎ QUA cặp đoạn chia sẻ đỉnh chính xác. Hệ quả là chúng
 * MÙ HOÀN TOÀN với "pinch point" — vòng chạm lại chính nó tại một đỉnh xuất hiện hai lần
 * (hình số 8). Đây đúng là loại lỗi mà JTS/GEOS đặt tên "Ring Self-intersection", và cũng
 * đúng là thông báo mà hệ thống khách hàng Hàn Quốc trả về:
 *   [EUDR-GEO-ERROR] 생산지 362: Ring Self-intersection (105.506955, 12.607731)
 *
 * Vì sao phép tính ở đây chính xác tuyệt đối (không epsilon, không dương tính giả):
 * 1. Tọa độ được làm tròn về 6 chữ số thập phân (chuẩn đang xuất) rồi nhân 1e6 → số nguyên.
 * 2. Dời gốc về đỉnh đầu tiên của vòng. Lô lớn nhất trong dữ liệu thật có biên độ 0,00713°
 *    → giá trị tuyệt đối ≤ ~7.200.
 * 3. Tích chéo do đó ≤ ~2,1e8, còn rất xa giới hạn số nguyên an toàn của float64 (2^53 ≈ 9e15).
 * Nên mọi phép thử hướng (orientation) đều cho kết quả ĐÚNG TUYỆT ĐỐI bằng Number thuần,
 * không cần BigInt và không cần ngưỡng sai số.
 *
 * Độ phức tạp: O(n²) cho phép thử giao đoạn. Vòng dài nhất trong dữ liệu thật có 127 đỉnh
 * (≈ 16k cặp), toàn bộ 446 lô chạy dưới 100 ms — không cần thuật toán quét Bentley–Ottmann.
 */

/** Hệ số quy đổi độ → lưới số nguyên: 1e-6 độ ≈ 0,11 m thực địa. */
export const GRID_SCALE = 1_000_000

export type RingDefect =
  /** Một đỉnh xuất hiện hai lần trong vòng → vòng tự chạm. JTS gọi là "Ring Self-intersection". */
  | { kind: "Pinch"; at: [number, number]; vertexIndex: number; repeatOf: number }
  /** Hai đoạn không kề nhau cắt qua nhau hoặc chạm nhau. */
  | { kind: "SelfIntersection"; at: [number, number]; segA: number; segB: number }
  /** Đỉnh gập ngược 180°: đường ranh giới đi tới rồi quay lại đúng trên chính nó. */
  | { kind: "Spike"; at: [number, number]; vertexIndex: number }
  /** Hai đoạn thẳng hàng và đè lên nhau trên một khoảng có độ dài. */
  | { kind: "CollinearOverlap"; at: [number, number]; segA: number; segB: number }
  /** Không đủ đỉnh để tạo thành đa giác (sau khi đã khử đỉnh trùng). */
  | { kind: "Degenerate"; vertexCount: number }

export type RingTopologyResult = {
  /** Vòng hợp lệ theo chuẩn JTS (simple) hay không. */
  isSimple: boolean
  defects: RingDefect[]
  /** Vòng đã chuẩn hóa: làm tròn 6 số, khử đỉnh trùng (kể cả vắt qua điểm đóng vòng), dạng MỞ. */
  normalized: number[][]
}

type GridRing = {
  /** Các đỉnh trên lưới số nguyên, đã dời gốc, dạng MỞ (không lặp lại đỉnh đóng vòng). */
  pts: number[][]
  /** Gốc đã dời, để quy đổi ngược về tọa độ thật khi báo lỗi. */
  ox: number
  oy: number
}

/** Làm tròn một tọa độ về đúng 6 chữ số thập phân. */
function round6(v: number): number {
  return Number(Number(v).toFixed(6))
}

/** Quy đổi đỉnh trên lưới số nguyên ngược về tọa độ thật [lon, lat]. */
function toRealPoint(grid: GridRing, pt: number[]): [number, number] {
  return [(pt[0] + grid.ox) / GRID_SCALE, (pt[1] + grid.oy) / GRID_SCALE]
}

/**
 * Chuẩn hóa vòng về dạng MỞ trên lưới số nguyên.
 *
 * Thứ tự các bước ở đây là BẮT BUỘC và không được đảo:
 * việc khử đỉnh trùng liên tiếp phải chạy TRƯỚC khi dò pinch point. Nếu dò pinch trên vòng thô,
 * 25/446 lô trong dữ liệu thật cho dương tính giả (đỉnh trùng liên tiếp bị hiểu nhầm là vòng tự
 * chạm); chạy sau khi khử thì còn 0/446.
 *
 * Khử đỉnh trùng phải vắt qua điểm đóng vòng (modulo n) — bản cũ trong `eudr-geometry-cleaner.ts`
 * chỉ xét `i > 0 && i < n-1` nên bỏ sót đỉnh trùng nằm ngay tại chỗ nối đầu–cuối.
 */
export function toFixedGrid(ring: number[][]): GridRing {
  const empty: GridRing = { pts: [], ox: 0, oy: 0 }
  if (!Array.isArray(ring) || ring.length === 0) return empty

  // 1. Làm tròn 6 số và bỏ đỉnh dị dạng
  const rounded: number[][] = []
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue
    const lon = round6(pt[0])
    const lat = round6(pt[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    rounded.push([lon, lat])
  }
  if (rounded.length === 0) return empty

  // 2. Bỏ đỉnh đóng vòng để làm việc trên dạng MỞ
  const open = [...rounded]
  while (
    open.length > 1 &&
    open[0][0] === open[open.length - 1][0] &&
    open[0][1] === open[open.length - 1][1]
  ) {
    open.pop()
  }
  if (open.length === 0) return empty

  // 3. Chuyển sang lưới số nguyên, dời gốc về đỉnh đầu
  const ox = Math.round(open[0][0] * GRID_SCALE)
  const oy = Math.round(open[0][1] * GRID_SCALE)
  const scaled = open.map((p) => [Math.round(p[0] * GRID_SCALE) - ox, Math.round(p[1] * GRID_SCALE) - oy])

  // 4. Khử đỉnh trùng liên tiếp, vắt qua cả điểm đóng vòng
  const pts: number[][] = []
  for (const p of scaled) {
    const prev = pts[pts.length - 1]
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue
    pts.push(p)
  }
  while (pts.length > 1) {
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (first[0] === last[0] && first[1] === last[1]) pts.pop()
    else break
  }

  return { pts, ox, oy }
}

/** Tích chéo (q-p) × (r-q). Chính xác tuyệt đối trên lưới số nguyên đã dời gốc. */
function cross(p: number[], q: number[], r: number[]): number {
  return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])
}

/** Dấu của tích chéo: 1 quay trái, -1 quay phải, 0 thẳng hàng. */
function orient(p: number[], q: number[], r: number[]): number {
  const v = cross(p, q, r)
  return v > 0 ? 1 : v < 0 ? -1 : 0
}

/** Điểm q có nằm trong hộp bao của đoạn pr hay không (dùng khi đã biết 3 điểm thẳng hàng). */
function onSegment(p: number[], q: number[], r: number[]): boolean {
  return (
    q[0] >= Math.min(p[0], r[0]) &&
    q[0] <= Math.max(p[0], r[0]) &&
    q[1] >= Math.min(p[1], r[1]) &&
    q[1] <= Math.max(p[1], r[1])
  )
}

/**
 * Diện tích có dấu của vòng trên lưới số nguyên (công thức dây giày).
 * Dương = ngược chiều kim đồng hồ (CCW), âm = theo chiều kim đồng hồ (CW).
 */
export function ringSignedAreaGrid(pts: number[][]): number {
  const n = pts.length
  if (n < 3) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

/** Chiều quay của vòng theo chuẩn RFC 7946 (ring ngoài phải là CCW). */
export function ringOrientation(ring: number[][]): "CW" | "CCW" | "Degenerate" {
  const grid = toFixedGrid(ring)
  if (grid.pts.length < 3) return "Degenerate"
  const area = ringSignedAreaGrid(grid.pts)
  if (area === 0) return "Degenerate"
  return area > 0 ? "CCW" : "CW"
}

/**
 * Phân tích tô-pô của một vòng tọa độ.
 *
 * Ba phép kiểm chạy theo đúng thứ tự dưới đây:
 *
 * 1. Pinch — O(n). Băm tọa độ từng đỉnh; đỉnh nào xuất hiện lần thứ hai nghĩa là vòng chạm
 *    lại chính nó. Đây là phép kiểm mà bản cũ hoàn toàn không có.
 * 2. Spike — O(n), chỉ số modulo n nên bao được cả đỉnh đóng vòng. Điều kiện số nguyên
 *    `cross === 0 && dot < 0` chính xác hơn `cos < -0.9999` và không phụ thuộc độ dài đoạn.
 * 3. Giao đoạn tổng quát — O(n²). Dùng phép thử giao BẤT KỲ (kể cả chạm đỉnh và chồng lấn
 *    thẳng hàng). Cố ý KHÔNG có nhánh "chung đỉnh thì bỏ qua" — chính nhánh đó là điểm mù cũ.
 */
export function analyzeRingTopology(ring: number[][]): RingTopologyResult {
  const grid = toFixedGrid(ring)
  const pts = grid.pts
  const n = pts.length
  const defects: RingDefect[] = []

  // Vòng khép kín trả về ở dạng chuẩn hóa để nơi gọi dùng lại mà không phải tính lần nữa
  const normalized = pts.map((p) => toRealPoint(grid, p) as number[])
  if (normalized.length > 0) normalized.push([normalized[0][0], normalized[0][1]])

  if (n < 3) {
    defects.push({ kind: "Degenerate", vertexCount: n })
    return { isSimple: false, defects, normalized: n === 0 ? [] : normalized }
  }

  // ── 1. Pinch point ────────────────────────────────────────────────────────────────
  const seen = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const key = `${pts[i][0]},${pts[i][1]}`
    const first = seen.get(key)
    if (first !== undefined) {
      defects.push({ kind: "Pinch", at: toRealPoint(grid, pts[i]), vertexIndex: i, repeatOf: first })
    } else {
      seen.set(key, i)
    }
  }

  // ── 2. Spike (đỉnh gập ngược 180°) ────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n]
    const b = pts[i]
    const c = pts[(i + 1) % n]
    if (cross(a, b, c) !== 0) continue
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])
    if (dot < 0) {
      defects.push({ kind: "Spike", at: toRealPoint(grid, b), vertexIndex: i })
    }
  }

  // ── 3. Giao giữa các đoạn không kề nhau ───────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const a1 = pts[i]
    const a2 = pts[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      // Bỏ qua đúng hai cặp kề nhau: (i, i+1) và cặp vắt qua điểm đóng vòng (0, n-1)
      if (j === i + 1) continue
      if (i === 0 && j === n - 1) continue

      const b1 = pts[j]
      const b2 = pts[(j + 1) % n]

      const d1 = orient(a1, a2, b1)
      const d2 = orient(a1, a2, b2)
      const d3 = orient(b1, b2, a1)
      const d4 = orient(b1, b2, a2)

      // Cắt chéo thật sự
      if (d1 !== d2 && d3 !== d4) {
        defects.push({ kind: "SelfIntersection", at: toRealPoint(grid, a1), segA: i, segB: j })
        continue
      }

      // Thẳng hàng hoàn toàn và đè lên nhau trên một khoảng có độ dài
      if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) {
        const overlap =
          (onSegment(a1, b1, a2) && (b1[0] !== a1[0] || b1[1] !== a1[1]) && (b1[0] !== a2[0] || b1[1] !== a2[1])) ||
          (onSegment(a1, b2, a2) && (b2[0] !== a1[0] || b2[1] !== a1[1]) && (b2[0] !== a2[0] || b2[1] !== a2[1])) ||
          (onSegment(b1, a1, b2) && (a1[0] !== b1[0] || a1[1] !== b1[1]) && (a1[0] !== b2[0] || a1[1] !== b2[1])) ||
          (onSegment(b1, a2, b2) && (a2[0] !== b1[0] || a2[1] !== b1[1]) && (a2[0] !== b2[0] || a2[1] !== b2[1]))
        if (overlap) {
          defects.push({ kind: "CollinearOverlap", at: toRealPoint(grid, a1), segA: i, segB: j })
        }
        continue
      }

      // Chạm nhau tại một điểm (đầu mút của đoạn này nằm trên đoạn kia)
      const touch =
        (d1 === 0 && onSegment(a1, b1, a2)) ||
        (d2 === 0 && onSegment(a1, b2, a2)) ||
        (d3 === 0 && onSegment(b1, a1, b2)) ||
        (d4 === 0 && onSegment(b1, a2, b2))
      if (touch) {
        defects.push({ kind: "SelfIntersection", at: toRealPoint(grid, a1), segA: i, segB: j })
      }
    }
  }

  return { isSimple: defects.length === 0, defects, normalized }
}

/** Vòng có hợp lệ theo chuẩn JTS (simple) hay không. */
export function isSimpleRing(ring: number[][]): boolean {
  return analyzeRingTopology(ring).isSimple
}

/** Mô tả lỗi bằng tiếng Việt, dùng cho nhật ký làm sạch và thông báo tới người dùng. */
export function describeRingDefect(defect: RingDefect): string {
  switch (defect.kind) {
    case "Pinch":
      return `Ranh giới tự chạm tại (${defect.at[0]}, ${defect.at[1]}) — đỉnh ${defect.vertexIndex} trùng đỉnh ${defect.repeatOf}`
    case "SelfIntersection":
      return `Ranh giới tự cắt tại (${defect.at[0]}, ${defect.at[1]}) — đoạn ${defect.segA} cắt đoạn ${defect.segB}`
    case "Spike":
      return `Đỉnh gập ngược 180° tại (${defect.at[0]}, ${defect.at[1]})`
    case "CollinearOverlap":
      return `Hai đoạn ranh giới đè lên nhau tại (${defect.at[0]}, ${defect.at[1]})`
    case "Degenerate":
      return `Không đủ đỉnh để tạo đa giác (chỉ còn ${defect.vertexCount} đỉnh sau khi khử đỉnh trùng)`
  }
}
