// Helper dùng chung cho việc chuẩn hóa ảnh trước khi upload lên Supabase Storage.
// Xem .claude/rules/14-maintenance-module.md — nguyên nhân/khắc phục bug "ảnh hàng loạt bị lỗi
// thumbnail + lỗi khi in" (2026-08). Bucket "order-files" giới hạn 10MB, chỉ nhận
// PNG/JPEG/WebP (supabase/migrations/20260506_product_order_images.sql) — validate + nén ảnh
// phía client trước khi upload để giảm rủi ro vượt trần và giảm thời gian phơi nhiễm với mạng
// chập chờn tại hiện trường.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // khớp file_size_limit của bucket order-files
export const ALLOWED_UPLOAD_MIME = ["image/png", "image/jpeg", "image/webp"]

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

/**
 * Resize + re-encode ảnh về kích thước hợp lý trước khi upload, để giảm thời gian upload trên
 * mạng di động chập chờn và giảm khả năng vượt trần dung lượng bucket. Fail-open: nếu nén lỗi
 * (định dạng lạ, trình duyệt không hỗ trợ canvas...) thì trả lại file gốc, không chặn upload.
 */
export async function compressImageForUpload(
  file: File,
  opts?: { maxDimension?: number; quality?: number },
): Promise<File> {
  const maxDimension = opts?.maxDimension ?? 1600
  const quality = opts?.quality ?? 0.82

  if (!ALLOWED_UPLOAD_MIME.includes(file.type)) return file

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
    if (!ctx) return file
    ctx.drawImage(source, 0, 0, targetW, targetH)

    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg"
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, outputType, quality),
    )
    if (!blob) return file

    // Nếu ảnh gốc đã nhỏ hơn kết quả nén (ảnh nhỏ sẵn), giữ nguyên bản gốc
    if (blob.size >= file.size) return file

    const ext = outputType === "image/png" ? "png" : "jpg"
    const newName = file.name.replace(/\.[^.]+$/, "") + `.${ext}`
    return new File([blob], newName, { type: outputType, lastModified: Date.now() })
  } catch {
    return file
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
