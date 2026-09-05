// Helper dùng chung cho việc chuẩn hóa ảnh trước khi upload lên Supabase Storage.
// Xem .claude/rules/14-maintenance-module.md — nguyên nhân/khắc phục bug "ảnh hàng loạt bị lỗi
// thumbnail + lỗi khi in" (2026-08) và bug "ảnh HEIC đội lốt .jpg" (2026-09). Bucket
// "order-files" giới hạn 10MB, chỉ nhận PNG/JPEG/WebP
// (supabase/migrations/20260506_product_order_images.sql) — validate + nén ảnh phía client
// trước khi upload để giảm rủi ro vượt trần và giảm thời gian phơi nhiễm với mạng chập chờn
// tại hiện trường.

import {
  convertHeicBlobToJpeg,
  isPdfSafeImageFormat,
  mimeOfImageFormat,
  needsHeicDecoder,
  replaceFileExtension,
  sniffImageFormatOfBlob,
  type ImageFormat,
} from "./image-format"

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // khớp file_size_limit của bucket order-files
export const ALLOWED_UPLOAD_MIME = ["image/png", "image/jpeg", "image/webp"]

/** Định dạng bucket chấp nhận trực tiếp; còn lại phải chuyển mã trước khi upload. */
const BUCKET_SAFE_FORMATS: ImageFormat[] = ["jpeg", "png", "webp"]

export type ImageValidationResult = { ok: true } | { ok: false; reason: string }

export function validateImageFile(file: File, maxBytes: number = MAX_UPLOAD_BYTES): ImageValidationResult {
  if (!ALLOWED_UPLOAD_MIME.includes(file.type)) {
    return { ok: false, reason: `định dạng "${file.type || "không xác định"}" không được hỗ trợ (chỉ nhận PNG/JPEG/WebP)` }
  }
  if (file.size > maxBytes) {
    return { ok: false, reason: `quá dung lượng cho phép (tối đa ${(maxBytes / 1024 / 1024).toFixed(0)}MB, ảnh này ${(file.size / 1024 / 1024).toFixed(1)}MB)` }
  }
  return { ok: true }
}

export type PreparedImage = { ok: true; file: File } | { ok: false; reason: string }

type PrepareOptions = { maxBytes?: number; maxDimension?: number; quality?: number }

/**
 * Chuẩn bị một ảnh để upload: nhận diện định dạng theo NỘI DUNG THẬT, chuyển HEIC sang JPEG,
 * sửa lại MIME/đuôi file nếu khai báo sai, rồi nén.
 *
 * Đây là thay thế cho cặp `validateImageFile` + `compressImageForUpload` — gộp lại để chỉ đọc
 * nội dung file MỘT LẦN và để việc kiểm tra dung lượng diễn ra SAU khi chuyển đổi/nén (ảnh HEIC
 * nở ra khi giải mã sang JPEG, kiểm tra trước sẽ ra kết quả sai).
 *
 * Khác biệt hành vi có chủ đích so với bản cũ: với định dạng trình duyệt không tự giải mã được
 * (HEIC) thì FAIL-CLOSED — thà từ chối kèm lý do rõ ràng còn hơn âm thầm đẩy một file mà không
 * nơi nào trong hệ thống đọc được lên Storage (đúng lỗi đã xảy ra). Với JPEG/PNG/WebP thật thì
 * vẫn FAIL-OPEN như cũ: nén lỗi vẫn cho upload bản gốc.
 */
export async function prepareImageForUpload(file: File, opts?: PrepareOptions): Promise<PreparedImage> {
  const maxBytes = opts?.maxBytes ?? MAX_UPLOAD_BYTES

  let format: ImageFormat | null = null
  try {
    format = await sniffImageFormatOfBlob(file)
  } catch {
    return { ok: false, reason: "không đọc được nội dung tệp" }
  }
  if (!format) {
    return { ok: false, reason: "không nhận ra định dạng ảnh (tệp hỏng hoặc không phải ảnh)" }
  }

  let working = file

  if (needsHeicDecoder(format)) {
    try {
      const jpeg = await convertHeicBlobToJpeg(working)
      working = new File([jpeg], replaceFileExtension(working.name, "jpg"), {
        type: mimeOfImageFormat("jpeg"),
        lastModified: Date.now(),
      })
      format = "jpeg"
    } catch {
      return {
        ok: false,
        reason: "ảnh định dạng HEIC (ảnh chụp iPhone/điện thoại đời mới) không chuyển đổi được trên thiết bị này — vui lòng đổi cài đặt camera sang JPEG rồi chụp lại, hoặc gửi ảnh qua Zalo rồi tải lên lại",
      }
    }
  }

  if (!BUCKET_SAFE_FORMATS.includes(format)) {
    // Định dạng trình duyệt đọc được nhưng bucket/jsPDF không nhận (AVIF, GIF...) — quy về JPEG.
    const transcoded = await transcodeImage(working, { ...opts, forceType: "image/jpeg" })
    if (!transcoded) {
      return { ok: false, reason: `định dạng ảnh "${format}" không được hỗ trợ và không chuyển đổi được` }
    }
    working = transcoded
    format = "jpeg"
  } else if (working.type !== mimeOfImageFormat(format)) {
    // Nội dung là ảnh hợp lệ nhưng MIME/đuôi khai báo sai (vd tên .jpg mà thật ra là PNG).
    // Sửa lại cho khớp để Storage không lưu sai content-type như trước.
    working = new File([working], replaceFileExtension(working.name, extensionOfFormat(format)), {
      type: mimeOfImageFormat(format),
      lastModified: working.lastModified,
    })
  }

  const compressed = (await transcodeImage(working, opts)) ?? working

  if (compressed.size > maxBytes) {
    return {
      ok: false,
      reason: `quá dung lượng cho phép (tối đa ${(maxBytes / 1024 / 1024).toFixed(0)}MB, ảnh này ${(compressed.size / 1024 / 1024).toFixed(1)}MB)`,
    }
  }
  return { ok: true, file: compressed }
}

/**
 * Bản dùng cho ô upload nhận CẢ ảnh lẫn tài liệu (PDF, Excel...): nếu nội dung là ảnh thì xử lý
 * y như `prepareImageForUpload`, còn không phải ảnh thì trả nguyên file, không đụng tới.
 */
export async function prepareUploadFileIfImage(file: File, opts?: PrepareOptions): Promise<PreparedImage> {
  let format: ImageFormat | null = null
  try {
    format = await sniffImageFormatOfBlob(file)
  } catch {
    return { ok: true, file }
  }
  if (!format) return { ok: true, file }
  return await prepareImageForUpload(file, opts)
}

/**
 * Chuẩn bị ảnh rồi ném lỗi nếu không hợp lệ — tiện cho các hàm upload trả `Promise<string>`
 * (kpi, ghi chú nhanh...) vốn đã báo lỗi bằng try/catch ở nơi gọi.
 */
export async function prepareImageForUploadOrThrow(file: File, opts?: PrepareOptions): Promise<File> {
  const prepared = await prepareImageForUpload(file, opts)
  if (!prepared.ok) throw new Error(`${file.name}: ${prepared.reason}`)
  return prepared.file
}

/**
 * Resize + re-encode ảnh về kích thước hợp lý trước khi upload, để giảm thời gian upload trên
 * mạng di động chập chờn và giảm khả năng vượt trần dung lượng bucket. Fail-open: nếu nén lỗi
 * (định dạng lạ, trình duyệt không hỗ trợ canvas...) thì trả lại file gốc, không chặn upload.
 *
 * Giữ nguyên hành vi cũ (bao gồm cả việc bỏ qua khi `file.type` không nằm trong danh sách cho
 * phép) để các nơi gọi trực tiếp không đổi kết quả. Luồng mới nên dùng `prepareImageForUpload`.
 */
export async function compressImageForUpload(
  file: File,
  opts?: { maxDimension?: number; quality?: number },
): Promise<File> {
  if (!ALLOWED_UPLOAD_MIME.includes(file.type)) return file
  return (await transcodeImage(file, opts)) ?? file
}

function extensionOfFormat(format: ImageFormat): string {
  return format === "jpeg" ? "jpg" : format
}

/**
 * Vẽ lại ảnh qua canvas để resize/đổi định dạng. Trả `null` nếu không xử lý được (nơi gọi tự
 * quyết định fail-open hay fail-closed).
 */
async function transcodeImage(
  file: File,
  opts?: PrepareOptions & { forceType?: "image/jpeg" | "image/png" },
): Promise<File | null> {
  const maxDimension = opts?.maxDimension ?? 1600
  const quality = opts?.quality ?? 0.82

  let cleanup: (() => void) | null = null
  try {
    const { source, width, height, cleanup: c } = await loadDrawableImage(file)
    cleanup = c
    const scale = Math.min(1, maxDimension / Math.max(width, height))
    const targetW = Math.max(1, Math.round(width * scale))
    const targetH = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(source, 0, 0, targetW, targetH)

    const outputType = opts?.forceType ?? (file.type === "image/png" ? "image/png" : "image/jpeg")
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, outputType, quality))
    if (!blob) return null

    // Nếu ảnh gốc đã nhỏ hơn kết quả nén (ảnh nhỏ sẵn) thì giữ nguyên bản gốc — trừ khi đang
    // buộc đổi định dạng, lúc đó bắt buộc phải lấy bản mới.
    if (!opts?.forceType && blob.size >= file.size) return null

    const ext = outputType === "image/png" ? "png" : "jpg"
    return new File([blob], replaceFileExtension(file.name, ext), { type: outputType, lastModified: Date.now() })
  } catch {
    return null
  } finally {
    cleanup?.()
  }
}

type DrawableImage = { source: CanvasImageSource; width: number; height: number; cleanup: () => void }

async function loadDrawableImage(file: File): Promise<DrawableImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() }
    } catch {
      // rơi xuống fallback bằng <img> (một số trình duyệt/định dạng không hỗ trợ createImageBitmap)
    }
  }
  return await loadDrawableImageViaImgTag(file)
}

function loadDrawableImageViaImgTag(file: File): Promise<DrawableImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        cleanup: () => URL.revokeObjectURL(url),
      })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Không đọc được ảnh")) }
    img.src = url
  })
}

/** Retry nhẹ cho lỗi mạng tạm thời — không retry lỗi rõ ràng (vượt size/mime, do Storage từ chối). */
export async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 700): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (retries <= 0) throw err
    await new Promise((r) => setTimeout(r, delayMs))
    return withRetry(fn, retries - 1, delayMs)
  }
}

/** Re-export để nơi gọi không phải import từ 2 file khác nhau. */
export { isPdfSafeImageFormat }
