import type { Feature, FeatureCollection, Geometry, Polygon } from "geojson"
import {
  mergePlotProperties,
  parseFiniteNumber,
  type EudrPlotProperties,
  type ForestPlotRow,
} from "./eudr-plot-merge"
import { calculateRingAreaHa, sanitizeEudrGeometryDetailed, sortFeaturesByPlotCode } from "./eudr-geometry-cleaner"

/**
 * Builder dùng chung để dựng FeatureCollection EUDR — thay code lặp gần y hệt ở
 * `EudrClient.tsx:697-724` và `eudr-trace.ts:290-321`.
 *
 * Vấn đề đang trị (GĐ 2b): sau khi gộp mảnh lúc ghi (Việc 1), 26 lô trong `forest_plots.geometry`
 * là MultiPolygon — nhiều mảnh dùng chung một mã lô vì bị đường/suối cắt ngang. Hai pipeline cũ
 * giữ nguyên MultiPolygon thành MỘT feature khi xuất, khác định dạng khách hàng đã chấp nhận
 * (nhiều feature Polygon dùng chung mã lô). Hàm `expandPlotFeatures()` ở đây nở đúng mỗi mảnh
 * ≥ 0,01 ha thành 1 Feature Polygon riêng.
 *
 * Nguyên tắc bắt buộc — xem `.claude/plans/...snuggly-pond.md` mục "GĐ 2b":
 *   - 1 mảnh  → giữ nguyên props từ `mergePlotProperties()`, KHÔNG đụng `Area`/`Dtich2026_ha`
 *     (byte-identical với hành vi cũ cho mọi lô chỉ có 1 mảnh).
 *   - N mảnh  → `Area` và `Dtich2026_ha` của MỖI feature đều chia theo tỷ lệ diện tích hình học,
 *     tổng khớp TUYỆT ĐỐI số đo khai báo (`splitDeclaredArea`). Không bao giờ lấy `Area` từ
 *     `@turf/area`/diện tích hình học trực tiếp.
 *   - 0 mảnh  → trả về mảng rỗng, NHƯNG ghi `lostAllGeometry: true` vào nhật ký — không còn
 *     im lặng loại bỏ như dòng `if (area < 0.001) return acc` ở 2 pipeline cũ.
 */

/** Làm tròn 2 chữ số thập phân bằng chuỗi thập phân — tránh sai số nhị phân của phép nhân/chia. */
function round2(value: number): number {
  return Number(value.toFixed(2))
}

/**
 * Chia một số đo diện tích đã khai báo (`declared`) cho N mảnh theo tỷ lệ diện tích hình học
 * (`geoAreas`), sao cho tổng các phần chia **khớp tuyệt đối** `declared`.
 *
 * - 0 mảnh → mảng rỗng.
 * - 1 mảnh → trả thẳng `declared`, KHÔNG làm tròn (giữ đúng số gốc, không tạo sai số mới).
 * - ≥2 mảnh → chia theo tỷ lệ `geoAreas[i] / Σ geoAreas`, làm tròn 2 số, phần dư do làm tròn
 *   (luôn ≤ 0,01 vì chỉ có N-1 lần làm tròn độc lập) được dồn hết vào mảnh có `geoAreas` lớn
 *   nhất — mảnh đó đại diện đúng cho phần chính của lô nên hợp lý nhất để nhận phần dư.
 *
 * ⚠️ `geoAreas` chỉ dùng để TÍNH TỶ LỆ, không bao giờ được gán trực tiếp làm kết quả — kết quả
 * luôn bắt nguồn từ `declared`.
 */
export function splitDeclaredArea(declared: number, geoAreas: number[]): number[] {
  const n = geoAreas.length
  if (n === 0) return []
  if (n === 1) return [declared]

  const totalGeo = geoAreas.reduce((sum, area) => sum + area, 0)
  let maxIdx = 0
  for (let i = 1; i < n; i++) {
    if (geoAreas[i] > geoAreas[maxIdx]) maxIdx = i
  }

  // totalGeo <= 0 không xảy ra trong thực tế (mọi mảnh truyền vào đây đã qua ngưỡng
  // MIN_PIECE_AREA_HA >= 0,01 ha), nhưng vẫn xử lý an toàn: chia đều rồi dồn dư vào mảnh đầu.
  if (!(totalGeo > 0)) {
    const even = round2(declared / n)
    const shares = new Array(n).fill(even)
    const sum = shares.reduce((s, v) => s + v, 0)
    shares[0] = round2(shares[0] + (declared - sum))
    return shares
  }

  const shares = geoAreas.map((area) => round2((declared * area) / totalGeo))
  const sum = shares.reduce((s, v) => s + v, 0)
  const diff = round2(declared - sum)
  if (diff !== 0) shares[maxIdx] = round2(shares[maxIdx] + diff)
  return shares
}

/** Nhật ký làm sạch/nở mảnh của một lô — dùng cho panel admin (GĐ 4) và nhật ký kèm ZIP. */
export type PlotCleanEntry = {
  plotCode: string
  /** Số Feature Polygon thực tế được xuất cho lô này (0 nếu mất sạch hình học). */
  featureCount: number
  /** Tổng diện tích mảnh vụn (< MIN_PIECE_AREA_HA) đã bị loại — luôn ghi rõ, không bỏ âm thầm. */
  droppedHa: number
  /** Mô tả các phép sửa hình học đã áp dụng (tiếng Việt), rút từ `GeometryFixLog.detail`. */
  fixes: string[]
  /**
   * Lô không còn hình học nào sau khi làm sạch (không có geometry nguồn, hoặc mọi mảnh đều
   * là mảnh vụn bị loại). GĐ 2b giữ hành vi cũ là bỏ qua khỏi file xuất, nhưng không còn im
   * lặng — GĐ 4 sẽ nâng mức này lên chặn xuất (Mức 3) vì lô này chắc chắn thuộc một đơn hàng.
   */
  lostAllGeometry: boolean
}

function buildCleanEntry(
  plotCode: string,
  featureCount: number,
  droppedHa: number,
  fixes: string[],
): PlotCleanEntry {
  return { plotCode, featureCount, droppedHa, fixes, lostAllGeometry: featureCount === 0 }
}

/**
 * Nở hình học của MỘT lô thành 1..N Feature Polygon dùng chung mã lô.
 *
 * `dbRow` (nếu có) luôn được ưu tiên hơn `staticFeature` — đúng thứ tự ưu tiên nguồn hình học
 * đã dùng ở 2 pipeline cũ (`dbPlot?.geometry || staticPlot?.geometry`).
 */
export function expandPlotFeatures(args: {
  plotCode: string
  dbRow?: ForestPlotRow | null
  staticFeature?: Feature | null
  /** Ngày xuất — BẮT BUỘC, không có mặc định "hôm nay" (chặn tái diễn lỗi export_date). */
  exportDate: string
}): { features: Feature[]; entry: PlotCleanEntry } {
  const { plotCode, dbRow, staticFeature, exportDate } = args

  const rawGeometry =
    (dbRow?.geometry as Geometry | undefined) ?? (staticFeature?.geometry as Geometry | undefined) ?? null

  if (!rawGeometry) {
    return { features: [], entry: buildCleanEntry(plotCode, 0, 0, []) }
  }

  const cleaned = sanitizeEudrGeometryDetailed(rawGeometry)
  const fixes = cleaned.fixes.map((f) => f.detail)
  const droppedHa = cleaned.droppedPieces.reduce((sum, d) => sum + d.areaHa, 0)

  if (cleaned.pieces.length === 0) {
    return { features: [], entry: buildCleanEntry(plotCode, 0, droppedHa, fixes) }
  }

  // Sắp xếp mảnh theo diện tích giảm dần để kết quả tái lập được (không phụ thuộc thứ tự
  // ring trong geometry nguồn) — mảnh đầu tiên sau khi sắp xếp luôn là mảnh nhận phần dư
  // làm tròn trong trường hợp có nhiều mảnh cùng diện tích tối đa (hiếm, nhưng xác định được).
  const piecesWithArea = cleaned.pieces
    .map((ring) => ({ ring, areaHa: calculateRingAreaHa(ring) }))
    .sort((a, b) => b.areaHa - a.areaHa)

  // 1 mảnh: giữ NGUYÊN props từ mergePlotProperties(), không đụng Area/Dtich2026_ha — đúng
  // byte-identical với hành vi cũ của mọi lô chỉ có 1 mảnh (348/415 lô sau khi Việc 1 chạy xong).
  if (piecesWithArea.length === 1) {
    const geometry: Polygon = { type: "Polygon", coordinates: [piecesWithArea[0].ring] }
    const properties = mergePlotProperties(plotCode, dbRow, staticFeature, exportDate)
    const feature: Feature = { type: "Feature", properties, geometry }
    return { features: [feature], entry: buildCleanEntry(plotCode, 1, droppedHa, fixes) }
  }

  // N mảnh: chia Area/Dtich2026_ha theo tỷ lệ diện tích hình học, tổng khớp tuyệt đối số khai báo.
  const refProps = (staticFeature?.properties as EudrPlotProperties | undefined) || {}
  const declaredHa = parseFiniteNumber(dbRow?.dien_tich_ha ?? refProps.Dtich2026_ha ?? null) ?? 0
  const geoAreas = piecesWithArea.map((p) => p.areaHa)
  const splitAreas = splitDeclaredArea(declaredHa, geoAreas)

  const features: Feature[] = piecesWithArea.map((piece, i) => {
    const baseProperties = mergePlotProperties(plotCode, dbRow, staticFeature, exportDate)
    const properties: EudrPlotProperties = {
      ...baseProperties,
      Area: splitAreas[i],
      Dtich2026_ha: splitAreas[i],
    }
    const geometry: Polygon = { type: "Polygon", coordinates: [piece.ring] }
    return { type: "Feature", properties, geometry }
  })

  return { features, entry: buildCleanEntry(plotCode, features.length, droppedHa, fixes) }
}

/**
 * Builder đầy đủ (GĐ 3a) — dựng cả FeatureCollection cho một danh sách mã lô, thay trọn khối
 * lặp ở `EudrClient.tsx:697-724` và `eudr-trace.ts:290-321` (gồm cả `sortFeaturesByPlotCode`).
 *
 * Nguyên tắc: KHÔNG I/O trong lõi — caller tự lấy dữ liệu (client `fetch` file tĩnh, server
 * `fs.readFile`) rồi truyền vào dưới dạng Map, để hàm này chạy được cả trình duyệt lẫn Node.
 */
export function buildEudrFeatureCollection(input: {
  plotCodes: string[]
  dbPlots: Map<string, ForestPlotRow>
  staticPlots: Map<string, Feature>
  /** Ngày xuất — BẮT BUỘC, chặn tái diễn lỗi export_date ngay ở kiểu dữ liệu. */
  exportDate: string
}): { collection: FeatureCollection; cleanLog: PlotCleanEntry[]; lostPlots: string[] } {
  const { plotCodes, dbPlots, staticPlots, exportDate } = input
  const allFeatures: Feature[] = []
  const cleanLog: PlotCleanEntry[] = []
  const lostPlots: string[] = []

  for (const plotCode of plotCodes) {
    const { features, entry } = expandPlotFeatures({
      plotCode,
      dbRow: dbPlots.get(plotCode) ?? null,
      staticFeature: staticPlots.get(plotCode) ?? null,
      exportDate,
    })
    allFeatures.push(...features)
    cleanLog.push(entry)
    if (entry.lostAllGeometry) lostPlots.push(plotCode)
  }

  return {
    collection: { type: "FeatureCollection", features: sortFeaturesByPlotCode(allFeatures) },
    cleanLog,
    lostPlots,
  }
}
