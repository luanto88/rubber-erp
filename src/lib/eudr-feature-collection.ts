import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson"
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
      // Chỉ 2 field này mới cho biết đây là 1 MẢNH của 1 lô lớn hơn, không phải 1 lô độc lập —
      // Area/Dtich2026_ha ở trên chỉ là phần chia riêng của mảnh, dễ bị đọc nhầm là cả lô.
      Dtich_lo_ha: declaredHa, // diện tích CẢ LÔ, giống nhau trên mọi mảnh cùng mã lô
      Manh: `${i + 1}/${piecesWithArea.length}`, // "1/3" = mảnh 1 trong tổng 3 mảnh
    }
    const geometry: Polygon = { type: "Polygon", coordinates: [piece.ring] }
    return { type: "Feature", properties, geometry }
  })

  return { features, entry: buildCleanEntry(plotCode, features.length, droppedHa, fixes) }
}

type AliasSource = { ten: string; dbRow: ForestPlotRow | null; staticFeature: Feature | null }

/**
 * Gộp geometry + diện tích khai báo của 1..N mã "canonical" thành MỘT hàng `ForestPlotRow` ảo,
 * để `expandPlotFeatures()` xử lý y hệt một lô đa mảnh thật (mỗi nguồn đóng góp đúng ring/diện
 * tích của chính nó, `splitDeclaredArea()` tự chia lại theo tỷ lệ hình học nếu tổng >1 mảnh).
 *
 * Dùng khi 1 mã bí danh không có geometry riêng nhưng đã được XÁC NHẬN là hợp của nhiều mã đã
 * digitize (vd "M6" = "M6S" + "M6T", 2 mảnh kề nhau tạo thành 1 thửa liền mạch — xem
 * `forest_plot_code_aliases`). Với đúng 1 nguồn, hành vi tương đương mượn thẳng geometry của
 * nguồn đó (không đổi so với bí danh 1:1 đơn giản).
 *
 * `ma_lo_full` CỐ Ý luôn `null` — không được mượn của bất kỳ nguồn nào, xem lý do ở nơi gọi.
 */
/**
 * Lấy giá trị KHÔNG NULL đầu tiên tìm được cho 1 trường trong danh sách nguồn (ưu tiên
 * `dbRow`, dự phòng `staticFeature.properties` — cùng thứ tự ưu tiên `mergePlotProperties()`
 * đang dùng cho lô thường). Nếu các nguồn có giá trị KHÁC NHAU, cảnh báo ra console (không
 * chặn export) — các mảnh ghép qua `forest_plot_code_aliases` đã được xác nhận là CÙNG MỘT
 * thửa đất thật (JTS `touches()`), nên đáng lẽ phải cùng Đội/Nông trường/Giống; khác nhau là
 * dấu hiệu dữ liệu cần soát lại, không được âm thầm bỏ qua.
 */
function pickAliasField<T>(
  sources: AliasSource[],
  fieldLabel: string,
  fromRow: (row: ForestPlotRow) => T | null,
  fromRef: (props: EudrPlotProperties) => T | null,
): T | null {
  const found: T[] = []
  for (const s of sources) {
    const refProps = (s.staticFeature?.properties as EudrPlotProperties | undefined) || {}
    const value = (s.dbRow ? fromRow(s.dbRow) : null) ?? fromRef(refProps)
    if (value !== null && value !== undefined) found.push(value)
  }
  if (found.length > 1) {
    const distinct = new Set(found.map((v) => JSON.stringify(v)))
    if (distinct.size > 1) {
      console.warn(
        `[eudr-feature-collection] Bí danh "${sources.map((s) => s.ten).join("+")}" có ${fieldLabel} khác nhau giữa các mảnh nguồn (${[...distinct].join(", ")}) — kiểm tra lại đây có đúng là 1 thửa đất không.`,
      )
    }
  }
  return found[0] ?? null
}

/** Diện tích khai báo của 1 nguồn bí danh — dùng để xếp thứ tự đại diện, xem `combineAliasSources()`. */
function aliasSourceDeclaredHa(s: AliasSource): number {
  const refProps = (s.staticFeature?.properties as EudrPlotProperties | undefined) || {}
  return parseFiniteNumber(s.dbRow?.dien_tich_ha ?? refProps.Dtich2026_ha ?? null) ?? 0
}

function combineAliasSources(sources: AliasSource[]): ForestPlotRow | null {
  const polygons: number[][][][] = []
  let totalDeclared = 0
  let anyDeclared = false

  // Sắp theo diện tích khai báo GIẢM DẦN trước khi gộp thuộc tính — khi các mảnh nguồn có
  // Giống/Năm trồng KHÁC NHAU thật sự (vd 2 đợt trồng khác nhau trên cùng 1 thửa đất bị chia
  // khi digitize), mảnh chiếm diện tích LỚN HƠN đại diện hợp lý hơn cho giá trị hiển thị
  // chung, thay vì phụ thuộc thứ tự tình cờ trong bảng `forest_plot_code_aliases`. Không ảnh
  // hưởng geometry/diện tích tổng (không phụ thuộc thứ tự cộng dồn).
  const orderedSources = [...sources].sort((a, b) => aliasSourceDeclaredHa(b) - aliasSourceDeclaredHa(a))

  for (const s of orderedSources) {
    const rawGeometry =
      (s.dbRow?.geometry as Geometry | undefined) ?? (s.staticFeature?.geometry as Geometry | undefined) ?? null
    if (rawGeometry?.type === "Polygon") {
      polygons.push((rawGeometry as Polygon).coordinates as number[][][])
    } else if (rawGeometry?.type === "MultiPolygon") {
      polygons.push(...((rawGeometry as MultiPolygon).coordinates as number[][][][]))
    }

    const declared = aliasSourceDeclaredHa(s)
    if (declared > 0) {
      totalDeclared += declared
      anyDeclared = true
    }
  }

  if (polygons.length === 0) return null

  return {
    ten: orderedSources.map((s) => s.ten).join("+"),
    ma_lo_full: null,
    geometry: { type: "MultiPolygon", coordinates: polygons } as MultiPolygon,
    // Nông trường/Đội/Giống/Năm trồng/Năm mở cạo: các mảnh nguồn là CÙNG MỘT thửa đất bị chia
    // khi digitize (đã xác nhận hình học khi seed `forest_plot_code_aliases`) nên các trường
    // này phải giống nhau — lấy giá trị thật (ưu tiên mảnh diện tích lớn hơn) thay vì hard-code
    // null (khác trước đây, làm bản đồ/GeoJSON/DDS của lô bí danh mất sạch thông tin Đội/Nông
    // trường dù geometry vẫn đúng).
    nong_truong: pickAliasField(
      orderedSources,
      "Nông trường",
      (r) => r.nong_truong,
      (p) => (p.Nong_truong ? String(p.Nong_truong) : null),
    ),
    doi: pickAliasField(
      orderedSources,
      "Đội",
      (r) => r.doi,
      (p) => parseFiniteNumber(p.Doi_2026),
    ),
    giong: pickAliasField(
      orderedSources,
      "Giống",
      (r) => r.giong,
      (p) => (p.Giong ? String(p.Giong) : null),
    ),
    dien_tich_ha: anyDeclared ? totalDeclared : null,
    nam_trong: pickAliasField(
      orderedSources,
      "Năm trồng",
      (r) => r.nam_trong,
      (p) => parseFiniteNumber(p.Nam_trong),
    ),
    nam_cao_up: pickAliasField(
      orderedSources,
      "Năm mở cạo",
      (r) => r.nam_cao_up,
      (p) => parseFiniteNumber(p.Nam_mo_cao),
    ),
  }
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
  /**
   * Bí danh mã lô (`alias_ten` → danh sách `canonical_ten`, từ `forest_plot_code_aliases` — xem
   * `eudr-plot-merge.ts`'s `buildForestPlotAliasMap()`). CHỈ được tra khi mã lô KHÔNG có geometry
   * riêng ở cả `dbPlots` lẫn `staticPlots` — không bao giờ ghi đè lên geometry thật đã có. Nếu
   * bỏ qua tham số này, hành vi giữ nguyên y hệt trước khi có alias (không có mã nào được thay).
   * 1 alias có thể ứng với NHIỀU canonical (vd "M6" = hợp "M6S" + "M6T") — xem `combineAliasSources()`.
   */
  aliasMap?: Map<string, string[]>
}): { collection: FeatureCollection; cleanLog: PlotCleanEntry[]; lostPlots: string[] } {
  const { plotCodes, dbPlots, staticPlots, exportDate, aliasMap } = input
  const allFeatures: Feature[] = []
  const cleanLog: PlotCleanEntry[] = []
  const lostPlots: string[] = []

  for (const plotCode of plotCodes) {
    let dbRow = dbPlots.get(plotCode) ?? null
    let staticFeature = staticPlots.get(plotCode) ?? null
    let aliasNote: string | null = null

    if (!dbRow && !staticFeature && aliasMap) {
      const canonicalTens = aliasMap.get(plotCode)
      if (canonicalTens && canonicalTens.length > 0) {
        const sources: AliasSource[] = canonicalTens.map((ten) => ({
          ten,
          dbRow: dbPlots.get(ten) ?? null,
          staticFeature: staticPlots.get(ten) ?? null,
        }))
        const anySourceFound = sources.some((s) => s.dbRow || s.staticFeature)
        if (anySourceFound) {
          // Mượn geometry/diện tích/metadata của (các) mã gốc, nhưng KHÔNG được mượn
          // `ma_lo_full`/`Ma_lo_2026` — mỗi mã bí danh là một đơn vị lịch cạo RIÊNG trong hệ
          // thống (khác `Ten`), dù cùng một thửa đất thật với mã gốc. Nếu giữ nguyên
          // `ma_lo_full` của mã gốc, 2 mã bí danh cùng mượn 1 mã gốc (vd "G13T" và "G13Đ" cùng
          // mượn "G13") sẽ mang CHUNG `Ma_lo_2026` — và `eudr-validator.ts`'s `byPlot` gộp các
          // feature theo đúng khóa này, khiến 2 lần diện tích khai báo đầy đủ (24,2 + 24,2 ha)
          // bị cộng dồn nhầm vào một nhóm chỉ có 1 diện tích khai báo (24,2 ha) → báo sai lệch
          // ~100% (đã kiểm chứng bằng script, xem lịch sử commit). `combineAliasSources()` luôn
          // trả `ma_lo_full: null`, khiến `mergePlotProperties()` tự fallback dùng đúng
          // `plotCode` (mã bí danh) làm định danh — mỗi bí danh tự đối chiếu diện tích riêng.
          dbRow = combineAliasSources(sources)
          staticFeature = null
          aliasNote = `Bí danh đã xác nhận: dùng geometry của mã "${canonicalTens.join(" + ")}" (xem forest_plot_code_aliases).`
        }
      }
    }

    const { features, entry } = expandPlotFeatures({
      plotCode,
      dbRow,
      staticFeature,
      exportDate,
    })
    allFeatures.push(...features)
    cleanLog.push(aliasNote ? { ...entry, fixes: [...entry.fixes, aliasNote] } : entry)
    if (entry.lostAllGeometry) lostPlots.push(plotCode)
  }

  return {
    collection: { type: "FeatureCollection", features: sortFeaturesByPlotCode(allFeatures) },
    cleanLog,
    lostPlots,
  }
}
