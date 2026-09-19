import type { Geometry, MultiPolygon, Polygon } from "geojson"
import {
  MIN_PIECE_AREA_HA,
  calculateRingAreaHa,
  sanitizeEudrGeometryDetailed,
} from "./eudr-geometry-cleaner"

/**
 * Cổng kiểm tra & làm sạch hình học tại ĐƯỜNG GHI dữ liệu lô vườn.
 *
 * Vì sao phải làm sạch lúc ghi chứ không chỉ lúc xuất:
 * báo cáo Whisp và IMPACT gửi cho khách được chạy trên một tập hình học cụ thể. Nếu bộ làm sạch
 * sửa ranh giới ở thời điểm xuất file, hồ sơ bằng chứng sẽ không còn tương ứng với file khai báo.
 * Làm sạch ngay lúc ghi khiến `forest_plots.geometry` trở thành bản chính duy nhất — Whisp và
 * file khai báo chắc chắn dùng chung một hình học.
 *
 * Bộ làm sạch ở cổng xuất vẫn giữ, nhưng chỉ còn vai trò lưới an toàn (cho đường đọc file tĩnh
 * và cho dữ liệu bị sửa thẳng bằng SQL). Ở trạng thái lành mạnh nó phải là no-op.
 */

/** Phạm vi toạ độ hợp lệ cho vùng trồng tại Campuchia / Đông Dương. */
const LON_MIN = 102
const LON_MAX = 110
const LAT_MIN = 8
const LAT_MAX = 24

export type GeometryWriteStatus =
  /** Hình học vốn đã sạch, không phải sửa gì. */
  | "clean"
  /** Đã tự sửa được, ghi vào cơ sở dữ liệu ở dạng đã sạch. */
  | "repaired"
  /** Không dùng được — không ghi hình học vào cơ sở dữ liệu. */
  | "rejected"

export type GeometryWriteReport = {
  status: GeometryWriteStatus
  /** Các phép sửa đã áp dụng, mô tả bằng tiếng Việt để đưa vào nhật ký. */
  applied: string[]
  /** Lý do bị từ chối (chỉ có khi status = "rejected"). */
  problems: string[]
  /** Tổng diện tích các mảnh giữ lại (hecta). */
  areaHa: number
  /** Số mảnh đa giác giữ lại. */
  pieceCount: number
  /** Tổng diện tích các mảnh vụn đã bỏ (hecta) — luôn ghi rõ, không bỏ âm thầm. */
  droppedHa: number
}

function emptyReport(status: GeometryWriteStatus, problems: string[] = []): GeometryWriteReport {
  return { status, applied: [], problems, areaHa: 0, pieceCount: 0, droppedHa: 0 }
}

/** Gói danh sách mảnh thành một Geometry: 1 mảnh → Polygon, nhiều mảnh → MultiPolygon. */
function piecesToGeometry(pieces: number[][][]): Polygon | MultiPolygon | null {
  if (pieces.length === 0) return null
  if (pieces.length === 1) return { type: "Polygon", coordinates: [pieces[0]] }
  return { type: "MultiPolygon", coordinates: pieces.map((ring) => [ring]) }
}

/** Khoá so sánh để loại mảnh trùng lặp hệt nhau. */
function pieceKey(ring: number[][]): string {
  return ring.map((p) => `${p[0]},${p[1]}`).join(";")
}

function isPlainGeometry(value: unknown): value is Geometry {
  if (!value || typeof value !== "object") return false
  const type = (value as { type?: unknown }).type
  return type === "Polygon" || type === "MultiPolygon"
}

/**
 * Làm sạch hình học của một lô vườn trước khi ghi vào cơ sở dữ liệu.
 *
 * Trả về hình học đã sạch cùng nhật ký đầy đủ. Khi không dùng được, trả `geometry: null`
 * kèm lý do — nơi gọi quyết định chặn hẳn (vẽ tay) hay ghi `null` và báo cáo (import/seed).
 */
export function prepareForestPlotGeometry(
  raw: unknown,
  ctx?: { plotCode?: string; declaredAreaHa?: number | null },
): { geometry: Polygon | MultiPolygon | null; report: GeometryWriteReport } {
  if (raw == null) {
    return { geometry: null, report: emptyReport("rejected", ["Lô chưa có hình học."]) }
  }
  if (!isPlainGeometry(raw)) {
    const type = (raw as { type?: unknown })?.type
    return {
      geometry: null,
      report: emptyReport("rejected", [
        `Hình học không hợp lệ (${type ? String(type) : "không rõ kiểu"}). Chỉ chấp nhận Polygon hoặc MultiPolygon.`,
      ]),
    }
  }

  const cleaned = sanitizeEudrGeometryDetailed(raw)
  const applied = cleaned.fixes.map((f) => f.detail)
  const droppedHa = cleaned.droppedPieces.reduce((s, d) => s + d.areaHa, 0)

  if (cleaned.pieces.length === 0) {
    return {
      geometry: null,
      report: {
        status: "rejected",
        applied,
        problems: [
          droppedHa > 0
            ? `Toàn bộ hình học chỉ còn mảnh vụn dưới ${MIN_PIECE_AREA_HA} ha (tổng ${droppedHa.toFixed(6)} ha).`
            : "Hình học không tạo được đa giác hợp lệ nào.",
        ],
        areaHa: 0,
        pieceCount: 0,
        droppedHa,
      },
    }
  }

  // Toạ độ ngoài phạm vi Campuchia = sai hệ toạ độ hoặc nhập nhầm → không tự sửa được
  const outOfRange: string[] = []
  for (const ring of cleaned.pieces) {
    for (const pt of ring) {
      if (pt[0] < LON_MIN || pt[0] > LON_MAX || pt[1] < LAT_MIN || pt[1] > LAT_MAX) {
        outOfRange.push(`(${pt[0]}, ${pt[1]})`)
        break
      }
    }
    if (outOfRange.length) break
  }
  if (outOfRange.length) {
    return {
      geometry: null,
      report: {
        status: "rejected",
        applied,
        problems: [
          `Toạ độ ${outOfRange[0]} nằm ngoài phạm vi Campuchia (kinh độ ${LON_MIN}–${LON_MAX}, vĩ độ ${LAT_MIN}–${LAT_MAX}). ` +
            `Nhiều khả năng file dùng hệ toạ độ khác WGS84.`,
        ],
        areaHa: cleaned.areaHa,
        pieceCount: cleaned.pieces.length,
        droppedHa,
      },
    }
  }

  const report: GeometryWriteReport = {
    status: applied.length > 0 ? "repaired" : "clean",
    applied,
    problems: [],
    areaHa: cleaned.areaHa,
    pieceCount: cleaned.pieces.length,
    droppedHa,
  }

  // Cảnh báo lệch diện tích — không chặn, chỉ ghi để bộ phận bản đồ rà lại
  const declared = ctx?.declaredAreaHa
  if (typeof declared === "number" && declared > 0) {
    const diffPct = (Math.abs(cleaned.areaHa - declared) / declared) * 100
    if (diffPct > 10) {
      report.applied.push(
        `Lưu ý: diện tích hình học ${cleaned.areaHa.toFixed(2)} ha lệch ${diffPct.toFixed(1)}% so với diện tích khai báo ${declared.toFixed(2)} ha.`,
      )
    }
  }

  return { geometry: piecesToGeometry(cleaned.pieces), report }
}

/**
 * Gộp nhiều mảnh hình học của CÙNG MỘT lô thành một đối tượng duy nhất.
 *
 * ⚠️ Đây là phần trị dứt điểm việc mất 101,62 ha diện tích vùng trồng.
 * File GeoJSON nguồn có 29 lô bị đường/suối cắt thành nhiều mảnh, mỗi mảnh là một feature
 * riêng nhưng dùng chung `Ten`. Quy tắc cũ "dedupe theo Ten, giữ dòng đầu tiên" vứt bỏ toàn
 * bộ các mảnh còn lại. Đã xác minh trên dữ liệu thật: 29/29 lô này có cùng `Ma_lo_2026` và
 * cùng `Dtich2026_ha` trên mọi mảnh — tức là một lô bị chia mảnh vật lý, gộp lại là đúng và
 * không mơ hồ.
 *
 * Bảng `forest_plots` có ràng buộc UNIQUE(factory_id, ten) nên không thể lưu nhiều dòng cùng
 * `ten`; vì vậy các mảnh được gộp thành một MultiPolygon trong cùng một dòng, rồi tách trở
 * lại thành nhiều feature Polygon ở thời điểm xuất file EUDR.
 */
export function mergeGeometryPieces(
  geometries: unknown[],
  ctx?: { plotCode?: string; declaredAreaHa?: number | null },
): { geometry: Polygon | MultiPolygon | null; report: GeometryWriteReport } {
  const usable = geometries.filter((g) => g != null)
  if (usable.length === 0) {
    return { geometry: null, report: emptyReport("rejected", ["Lô chưa có hình học."]) }
  }
  if (usable.length === 1) {
    return prepareForestPlotGeometry(usable[0], ctx)
  }

  const applied: string[] = []
  const problems: string[] = []
  const pieces: number[][][] = []
  const seen = new Set<string>()
  let droppedHa = 0

  for (const geom of usable) {
    const single = prepareForestPlotGeometry(geom, { plotCode: ctx?.plotCode })
    applied.push(...single.report.applied)
    droppedHa += single.report.droppedHa
    if (!single.geometry) {
      problems.push(...single.report.problems)
      continue
    }
    const rings =
      single.geometry.type === "Polygon"
        ? [single.geometry.coordinates[0]]
        : single.geometry.coordinates.map((poly) => poly[0])
    for (const ring of rings) {
      const key = pieceKey(ring)
      if (seen.has(key)) {
        applied.push("Đã bỏ 1 mảnh trùng lặp hoàn toàn với mảnh khác của cùng lô.")
        continue
      }
      seen.add(key)
      pieces.push(ring)
    }
  }

  if (pieces.length === 0) {
    return {
      geometry: null,
      report: {
        status: "rejected",
        applied,
        problems: problems.length ? problems : ["Không mảnh nào của lô tạo được đa giác hợp lệ."],
        areaHa: 0,
        pieceCount: 0,
        droppedHa,
      },
    }
  }

  const areaHa = pieces.reduce((s, r) => s + calculateRingAreaHa(r), 0)
  applied.unshift(
    `Đã gộp ${usable.length} mảnh rời của cùng lô thành 1 bản ghi (${pieces.length} mảnh, tổng ${areaHa.toFixed(2)} ha).`,
  )

  const report: GeometryWriteReport = {
    status: "repaired",
    applied,
    problems: [],
    areaHa,
    pieceCount: pieces.length,
    droppedHa,
  }

  const declared = ctx?.declaredAreaHa
  if (typeof declared === "number" && declared > 0) {
    const diffPct = (Math.abs(areaHa - declared) / declared) * 100
    if (diffPct > 10) {
      report.applied.push(
        `Lưu ý: diện tích hình học ${areaHa.toFixed(2)} ha lệch ${diffPct.toFixed(1)}% so với diện tích khai báo ${declared.toFixed(2)} ha.`,
      )
    }
  }

  return { geometry: piecesToGeometry(pieces), report }
}

// ── Kiểm tra dữ liệu nhập liệu cấp lô ───────────────────────────────────────────────

export type ForestPlotInput = {
  ten: string
  ma_lo_full?: string | null
  dien_tich_ha?: number | null
  geometry: unknown
}

export type ForestPlotValidation = {
  ok: boolean
  /** Lỗi chặn — không được ghi vào cơ sở dữ liệu. */
  errors: string[]
  /** Cảnh báo — vẫn ghi được. */
  warnings: string[]
  geometry: Polygon | MultiPolygon | null
  report: GeometryWriteReport
}

/**
 * Kiểm tra một lô vườn trước khi ghi.
 *
 * Lỗi nhập liệu (thiếu mã, trùng mã, diện tích bằng 0) được chặn NGAY tại đây, không để lọt
 * vào cơ sở dữ liệu — vì một khi đã nằm trong kho dữ liệu thì phải tới lúc xuất hồ sơ cho
 * khách mới phát hiện ra.
 */
export function validateForestPlotInput(
  input: ForestPlotInput,
  opts?: { existingCodes?: Set<string> },
): ForestPlotValidation {
  const errors: string[] = []
  const warnings: string[] = []

  const ten = String(input.ten || "").trim()
  if (!ten) {
    errors.push("Mã ngắn (Ten) không được để trống.")
  } else if (opts?.existingCodes?.has(ten.toUpperCase())) {
    errors.push(`Mã ngắn "${ten}" đã tồn tại trong nhà máy này.`)
  }

  const { geometry, report } = prepareForestPlotGeometry(input.geometry, {
    plotCode: ten,
    declaredAreaHa: input.dien_tich_ha ?? null,
  })

  if (report.status === "rejected") {
    errors.push(...report.problems)
  } else {
    warnings.push(...report.applied)
  }

  if (input.dien_tich_ha != null && !(input.dien_tich_ha > 0)) {
    errors.push("Diện tích khai báo phải lớn hơn 0.")
  }

  return { ok: errors.length === 0, errors, warnings, geometry, report }
}
