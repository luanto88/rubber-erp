import type { FeatureCollection } from "geojson"
import { validateEudrCollection, type EudrIssue, type EudrValidationResult } from "./eudr-validator"
import type { PlotCleanEntry } from "./eudr-feature-collection"

/**
 * Cổng serialize DUY NHẤT được phép `JSON.stringify` một FeatureCollection EUDR trước khi
 * giao cho khách (ZIP, download đơn lẻ, hoặc trả trong response API) — thay cho việc mỗi nơi
 * tải file tự gọi `JSON.stringify(geoData, null, 2)` rải rác (6 đường ghi file trước GĐ 3).
 *
 * GĐ 3 (hiện tại) — "shadow mode": `block` mặc định `false`. Hàm chỉ chạy
 * `validateEudrCollection()` và ghi cảnh báo ra console để quan sát, KHÔNG đổi hành vi tải
 * file (không throw, không loại bỏ gì). GĐ 4 sẽ bật `block: true` để thực sự áp Mức 3
 * (`EudrExportBlockedError`) theo đúng chính sách 3 mức đã chốt.
 */

/** Ném ra khi có lỗi Mức 3 (blocking) và cổng được gọi với `block: true` (chỉ từ GĐ 4). */
export class EudrExportBlockedError extends Error {
  issues: EudrIssue[]
  constructor(issues: EudrIssue[]) {
    super(
      issues.length
        ? `Không xuất được file GeoJSON: ${issues.map((i) => i.message).join(" | ")}`
        : "Không xuất được file GeoJSON — có lỗi Mức 3 chưa xác định.",
    )
    this.name = "EudrExportBlockedError"
    this.issues = issues
  }
}

export function serializeEudrGeoJson(
  collection: FeatureCollection | null | undefined,
  opts?: { block?: boolean; cleanLog?: PlotCleanEntry[] },
): { json: string; validation: EudrValidationResult } {
  const validation = validateEudrCollection(collection)

  if (opts?.block) {
    if (!validation.isValid) throw new EudrExportBlockedError(validation.blocking)
  } else if (!validation.isValid || validation.warnings.length > 0) {
    // Chế độ shadow (GĐ 3): không chặn gì, chỉ ghi lại để có thể quan sát trước khi GĐ 4 bật
    // chặn thật. Không dùng console.error để không bị nhầm là lỗi ứng dụng.
    console.warn(
      `[eudr-export-gate] File GeoJSON có ${validation.blocking.length} lỗi Mức 3, ` +
        `${validation.warnings.length} cảnh báo Mức 2 (shadow mode — chưa chặn xuất).`,
    )
  }

  const lostPlots = (opts?.cleanLog || []).filter((entry) => entry.lostAllGeometry)
  if (lostPlots.length > 0) {
    console.warn(
      `[eudr-export-gate] ${lostPlots.length} lô mất sạch hình học (shadow mode — chưa chặn): ` +
        lostPlots.map((entry) => entry.plotCode).join(", "),
    )
  }

  return { json: JSON.stringify(collection, null, 2), validation }
}
