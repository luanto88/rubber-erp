import type { FeatureCollection } from "geojson"
import { validateEudrCollection, type EudrIssue, type EudrValidationResult } from "./eudr-validator"
import type { PlotCleanEntry } from "./eudr-feature-collection"

/**
 * Cổng serialize DUY NHẤT được phép `JSON.stringify` một FeatureCollection EUDR trước khi
 * giao cho khách (ZIP, download đơn lẻ, hoặc trả trong response API) — thay cho việc mỗi nơi
 * tải file tự gọi `JSON.stringify(geoData, null, 2)` rải rác (6 đường ghi file trước GĐ 3).
 *
 * GĐ 4: `block` do caller truyền vào — dùng `EUDR_EXPORT_BLOCK_ENABLED` bên dưới làm nguồn duy
 * nhất cho mọi điểm gọi thật (đừng hard-code `true`/`false` riêng lẻ ở từng nơi).
 */

// GĐ4: bật/tắt chặn thật cho cả 6 điểm gọi serializeEudrGeoJson. MẶC ĐỊNH FAIL-CLOSED (chặn)
// khi biến môi trường KHÔNG được set — chỉ tắt khi set rõ ràng "false". Lý do chọn fail-closed:
// rủi ro compliance (gửi file thiếu dữ liệu cho khách EU) nặng hơn rủi ro vận hành (1 đơn bị
// chặn tạm, admin sửa lô rồi thử lại).
//
// ⚠️ BẮT BUỘC dùng tiền tố NEXT_PUBLIC_: cả 6 điểm gọi serializeEudrGeoJson đều chạy Ở TRÌNH
// DUYỆT (EudrClient.tsx, order-client.tsx, eudr-order-public-client.tsx, dds-generator.ts đều
// là client component/được gọi từ client). `process.env.EUDR_EXPORT_BLOCK` (không tiền tố) sẽ
// luôn đọc ra `undefined` ở phía client — Next.js chỉ inline biến `NEXT_PUBLIC_*` vào bundle
// lúc BUILD. Hệ quả: đổi biến trên Vercel vẫn cần bấm "Redeploy" (rebuild lại, KHÔNG cần sửa
// code/git push mới) để có hiệu lực thật — không phải tức thời như biến server thường.
//
// ⚠️ TRƯỚC KHI DEPLOY CODE NÀY: bắt buộc set `NEXT_PUBLIC_EUDR_EXPORT_BLOCK=false` trên Vercel
// TRƯỚC (hoặc chắc chắn `scripts/verify-eudr-export-chain.mjs` đã chạy sạch 100% trên toàn bộ
// đơn đã duyệt) — nếu không, mọi export sẽ BỊ CHẶN THẬT ngay khi deploy vì mặc định fail-closed.
export const EUDR_EXPORT_BLOCK_ENABLED: boolean =
  process.env.NEXT_PUBLIC_EUDR_EXPORT_BLOCK !== "false"

/** Ném ra khi có lỗi Mức 3 (blocking) và cổng được gọi với `block: true`. */
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

/**
 * Gộp các lô "mất sạch hình học" (0 feature sau khi làm sạch, ghi trong `cleanLog`) thành
 * `EudrIssue` mức "blocking". `validateEudrCollection()` chỉ lặp qua `collection.features` nên
 * KHÔNG BAO GIỜ tự phát hiện được trường hợp này (lô 0 feature không xuất hiện trong vòng lặp
 * đó) — phải gộp thủ công ở đây. Áp dụng VÔ ĐIỀU KIỆN (không phụ thuộc `block`) để nhánh shadow
 * (đọc `validation.errors[0]`) cũng thấy cảnh báo này ngay, không phải đợi bật chặn thật.
 */
function mergeLostPlotsIntoValidation(
  validation: EudrValidationResult,
  cleanLog: PlotCleanEntry[],
): EudrValidationResult {
  const lostIssues: EudrIssue[] = cleanLog
    .filter((entry) => entry.lostAllGeometry)
    .map((entry) => ({
      severity: "blocking" as const,
      code: "PLOT_LOST_ALL_GEOMETRY",
      plotCode: entry.plotCode,
      message:
        `Lô [${entry.plotCode}]: mất sạch hình học sau khi làm sạch (0 mảnh còn lại)` +
        (entry.droppedHa > 0 ? `, đã loại ${entry.droppedHa.toFixed(6)} ha mảnh vụn` : "") +
        `. Lô này thuộc đơn hàng nên không được loại bỏ — cần sửa ranh giới tại ` +
        `Cài đặt → Cấu hình nhà máy → Lô vườn → ${entry.plotCode}.`,
    }))
  if (lostIssues.length === 0) return validation
  const issues = [...validation.issues, ...lostIssues]
  const blocking = [...validation.blocking, ...lostIssues]
  return {
    ...validation,
    issues,
    blocking,
    isValid: false,
    errors: blocking.map((i) => i.message),
  }
}

export function serializeEudrGeoJson(
  collection: FeatureCollection | null | undefined,
  opts?: { block?: boolean; cleanLog?: PlotCleanEntry[] },
): { json: string; validation: EudrValidationResult } {
  const validation = mergeLostPlotsIntoValidation(
    validateEudrCollection(collection),
    opts?.cleanLog || [],
  )

  if (opts?.block) {
    if (!validation.isValid) throw new EudrExportBlockedError(validation.blocking)
  } else if (!validation.isValid || validation.warnings.length > 0) {
    // Chế độ shadow: không chặn gì, chỉ ghi lại để có thể quan sát trước khi bật chặn thật.
    // Không dùng console.error để không bị nhầm là lỗi ứng dụng.
    console.warn(
      `[eudr-export-gate] File GeoJSON có ${validation.blocking.length} lỗi Mức 3, ` +
        `${validation.warnings.length} cảnh báo Mức 2 (block=${String(!!opts?.block)}).`,
    )
  }

  return { json: JSON.stringify(collection, null, 2), validation }
}

/** SHA-256 hex qua Web Crypto API — chạy được cả trình duyệt lẫn Node (≥19). Nhận thẳng chuỗi
 *  JSON đã có sẵn (từ `serializeEudrGeoJson`), KHÔNG stringify lại collection ở nơi khác. */
export async function computeEudrGeometryHash(json: string): Promise<string> {
  const bytes = new TextEncoder().encode(json)
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Nhật ký làm sạch hình học lưu vào `export_orders.eudr_clean_log` — snapshot tại lần tính
 *  lại gần nhất (view-time, không phải lúc tải file). */
export type EudrCleanLogPayload = {
  entries: PlotCleanEntry[]
  /** Số lỗi Mức 3 TẠI THỜI ĐIỂM tính (kể cả khi block đang tắt). 0 = file xuất được sạch;
   *  >0 = hash này đại diện cho 1 file SẼ bị chặn nếu bật block — đừng trích dẫn hash này
   *  trong hồ sơ Whisp/IMPACT làm bằng chứng "đã xuất sạch". */
  blockingIssueCount: number
  computedAt: string
}

/** Build payload ghi vào `export_orders.eudr_clean_log`/`eudr_geometry_hash` — dùng chung cho
 *  cả 3 điểm ghi (2 route API + trang admin). Luôn gọi `serializeEudrGeoJson` với `block:false`
 *  — ghi log là quan sát, không được phép ném lỗi. */
export async function buildEudrCleanLogUpdatePayload(
  collection: FeatureCollection | null | undefined,
  cleanLog: PlotCleanEntry[],
): Promise<{ eudr_clean_log: EudrCleanLogPayload; eudr_geometry_hash: string }> {
  const { json, validation } = serializeEudrGeoJson(collection, { cleanLog })
  const geometryHash = await computeEudrGeometryHash(json)
  return {
    eudr_clean_log: {
      entries: cleanLog,
      blockingIssueCount: validation.blocking.length,
      computedAt: new Date().toISOString(),
    },
    eudr_geometry_hash: geometryHash,
  }
}

/** Thông điệp thân thiện cho lỗi Mức 3 — CHỈ dùng ở ngữ cảnh NỘI BỘ (trang admin
 *  `/dashboard/eudr`). KHÔNG dùng ở Customer Portal / trang public — hướng dẫn "Cài đặt → Lô
 *  vườn" vô nghĩa và lộ điều hướng nội bộ cho khách hàng bên ngoài. */
export function describeEudrExportBlockedError(err: EudrExportBlockedError): string {
  const codes = [...new Set(err.issues.map((i) => i.plotCode))]
  const shown = codes.slice(0, 3).join(", ")
  const more = codes.length > 3 ? ` +${codes.length - 3} lô khác` : ""
  return `Không xuất được file: ${err.issues.length} lỗi ở ${codes.length} lô (${shown}${more}). Sửa tại: Cài đặt → Cấu hình nhà máy → Lô vườn.`
}
