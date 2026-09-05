// Nhận diện định dạng ảnh theo NỘI DUNG THẬT (magic bytes) và chuẩn hóa về định dạng mà trình
// duyệt lẫn jsPDF đều xử lý được.
//
// Lý do tồn tại file này — bug thật đã xảy ra (2026-09, biên bản Bảo trì MT-020926/001):
// điện thoại lưu ảnh ở định dạng HEIC nhưng đặt tên đuôi ".jpg". Hệ điều hành suy `File.type`
// từ ĐUÔI TÊN FILE nên báo "image/jpeg" — mọi lớp kiểm tra dựa vào `file.type` / `blob.type` /
// `Content-Type` đều bị qua mặt. Hệ quả: file HEIC lọt lên Storage, rồi khi dựng PDF thì
// `new Image().src = "data:image/jpeg;base64,<dữ liệu HEIC>"` chọn nhầm bộ giải mã JPEG →
// onerror → PDF in "Không tải được ảnh" (kiểm chứng: PDF gốc chỉ có 1 XObject ảnh là QR, 0
// stream JPEG). Chrome trên Android cũng không tự giải mã được HEIC nên ảnh không hiển thị ở
// bất kỳ đâu. Xem .claude/rules/14-maintenance-module.md.
//
// Nguyên tắc: KHÔNG BAO GIỜ tin đuôi file hay MIME khai báo — chỉ tin magic bytes.

export type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "heic" | "avif"

const IMAGE_MIME: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  avif: "image/avif",
}

/** Brand (4 ký tự tại offset 8) của container ISOBMFF ứng với ảnh HEIC. */
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"])
const AVIF_BRANDS = new Set(["avif", "avis"])

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = ""
  for (let i = from; i < to && i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

/**
 * Nhận diện định dạng ảnh từ vài byte đầu file. Trả `null` nếu không nhận ra (không phải ảnh,
 * hoặc định dạng lạ) — nơi gọi tự quyết định chặn hay bỏ qua.
 */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 12) return null

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png"
  if (ascii(bytes, 0, 4) === "GIF8") return "gif"
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp"

  // ISOBMFF (HEIC/AVIF): [size:4][ 'ftyp' ][ major brand:4 ][ minor:4 ][ compatible brands... ]
  if (ascii(bytes, 4, 8) === "ftyp") {
    const major = ascii(bytes, 8, 12)
    if (AVIF_BRANDS.has(major)) return "avif"
    if (HEIC_BRANDS.has(major)) return "heic"
    // Một số máy ghi major brand lạ nhưng khai brand thật trong danh sách tương thích
    const compatible = ascii(bytes, 16, Math.min(bytes.length, 64))
    for (let i = 0; i + 4 <= compatible.length; i += 4) {
      const brand = compatible.slice(i, i + 4)
      if (AVIF_BRANDS.has(brand)) return "avif"
      if (HEIC_BRANDS.has(brand)) return "heic"
    }
  }
  return null
}

export function mimeOfImageFormat(format: ImageFormat): string {
  return IMAGE_MIME[format]
}

/**
 * Định dạng mà trình duyệt phổ thông (đặc biệt Chrome trên Android — thiết bị chính tại hiện
 * trường) KHÔNG tự giải mã được, buộc phải chuyển đổi bằng thư viện trước khi dùng.
 */
export function needsHeicDecoder(format: ImageFormat | null): boolean {
  return format === "heic"
}

/** Định dạng jsPDF nhận trực tiếp qua `addImage`. Còn lại phải quy về JPEG/PNG qua canvas. */
export function isPdfSafeImageFormat(format: ImageFormat | null): boolean {
  return format === "jpeg" || format === "png"
}

/** Đọc đủ số byte đầu để nhận diện, không tải/đọc toàn bộ file khi chỉ cần biết định dạng. */
export async function sniffImageFormatOfBlob(blob: Blob): Promise<ImageFormat | null> {
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer())
  return sniffImageFormat(head)
}

/**
 * Chuyển ảnh HEIC sang JPEG ngay trên trình duyệt.
 *
 * `heic-to` nặng ~3MB (nhúng sẵn libheif dạng WASM) nên BẮT BUỘC nạp lười — chỉ tải về khi
 * thật sự gặp file HEIC, không đưa vào bundle chính. Dùng entry `heic-to/next` do thư viện
 * cung cấp riêng cho Next.js. Hàm này chỉ chạy được phía trình duyệt.
 */
export async function convertHeicBlobToJpeg(blob: Blob, quality = 0.85): Promise<Blob> {
  const { heicTo } = await import("heic-to/next")
  // Thư viện tự nhận diện qua nội dung; truyền lại blob với MIME đúng để không bị chặn sớm.
  const source = blob.type === IMAGE_MIME.heic ? blob : new Blob([blob], { type: IMAGE_MIME.heic })
  return await heicTo({ blob: source, type: "image/jpeg", quality })
}

/** Đổi phần mở rộng của tên file (giữ nguyên phần còn lại). */
export function replaceFileExtension(name: string, ext: string): string {
  const base = name.replace(/\.[^.\\/]+$/, "")
  return `${base}.${ext}`
}

// ─── Tải ảnh về để nhúng vào PDF (jsPDF) ───────────────────────────────────

/** jsPDF chỉ nhận chắc chắn JPEG/PNG — mọi định dạng khác phải quy về trước khi `addImage`. */
export type PdfImage = { dataUrl: string; format: "PNG" | "JPEG"; width: number; height: number }
export type PdfImageResult = PdfImage | { failed: true; reason: string }

export function isPdfImageFailure(value: PdfImageResult | undefined | null): value is { failed: true; reason: string } {
  return !!value && "failed" in value
}

type DrawableSource = { source: CanvasImageSource; width: number; height: number; cleanup: () => void }

/**
 * Giải mã blob thành thứ vẽ được lên canvas.
 *
 * Dùng `createImageBitmap` / object URL — cả hai nhận diện định dạng theo NỘI DUNG. Tuyệt đối
 * không quay lại cách cũ (`FileReader` → `data:<mime>;base64,...` → `img.src`): data URL khai
 * báo MIME tường minh nên trình duyệt tin lời khai đó thay vì nội dung, và đó chính là điểm
 * làm ảnh HEIC gắn nhãn "image/jpeg" giải mã thất bại.
 */
async function loadDrawableFromBlob(blob: Blob): Promise<DrawableSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() }
    } catch {
      // rơi xuống fallback <img> bên dưới
    }
  }
  return await new Promise<DrawableSource>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const el = new Image()
    el.onload = () => resolve({
      source: el,
      width: el.naturalWidth || 1,
      height: el.naturalHeight || 1,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    })
    el.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Không giải mã được ảnh")) }
    el.src = objectUrl
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Tải một ảnh từ URL công khai và chuẩn hóa về dạng jsPDF nhúng được.
 *
 * Lỗi mềm theo từng ảnh: một ảnh hỏng chỉ làm mất đúng ảnh đó (kèm lý do cụ thể để in lên PDF),
 * không được làm hỏng cả tài liệu.
 *
 * @param maxDimension Nếu có, thu nhỏ cạnh dài nhất về mức này và ép JPEG (dùng cho PDF ký số —
 * bucket `signing-documents` giới hạn 20MB, ảnh gốc từ điện thoại thường 3072×4096).
 */
export async function fetchImageForPdf(
  url: string,
  opts?: { maxDimension?: number; jpegQuality?: number },
): Promise<PdfImageResult> {
  let bytes: Uint8Array
  try {
    const res = await fetch(url)
    if (!res.ok) return { failed: true, reason: `Không tải được ảnh (lỗi ${res.status})` }
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch {
    return { failed: true, reason: "Không tải được ảnh (lỗi mạng)" }
  }

  const sniffed = sniffImageFormat(bytes)
  if (!sniffed) return { failed: true, reason: "Tệp không phải ảnh hợp lệ" }

  let blob: Blob = new Blob([bytes as BlobPart], { type: mimeOfImageFormat(sniffed) })
  let format: ImageFormat = sniffed

  if (needsHeicDecoder(format)) {
    try {
      blob = await convertHeicBlobToJpeg(blob)
      format = "jpeg"
    } catch {
      return { failed: true, reason: "Ảnh HEIC — không giải mã được" }
    }
  }

  let drawable: DrawableSource
  try {
    drawable = await loadDrawableFromBlob(blob)
  } catch {
    return { failed: true, reason: "Không giải mã được ảnh" }
  }

  try {
    const { source, width, height } = drawable
    const maxDimension = opts?.maxDimension
    const needsResize = !!maxDimension && Math.max(width, height) > maxDimension
    const needsTranscode = !isPdfSafeImageFormat(format)

    if (needsResize || needsTranscode) {
      const scale = needsResize && maxDimension ? maxDimension / Math.max(width, height) : 1
      const targetW = Math.max(1, Math.round(width * scale))
      const targetH = Math.max(1, Math.round(height * scale))
      const canvas = document.createElement("canvas")
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.drawImage(source, 0, 0, targetW, targetH)
        return {
          dataUrl: canvas.toDataURL("image/jpeg", opts?.jpegQuality ?? 0.72),
          format: "JPEG",
          width: targetW,
          height: targetH,
        }
      }
      if (needsTranscode) return { failed: true, reason: "Không chuyển đổi được định dạng ảnh" }
    }

    // Đến đây chắc chắn là JPEG/PNG và blob mang MIME đúng với nội dung.
    const dataUrl = await blobToDataUrl(blob)
    return { dataUrl, format: format === "png" ? "PNG" : "JPEG", width, height }
  } catch {
    return { failed: true, reason: "Không xử lý được ảnh" }
  } finally {
    drawable.cleanup()
  }
}
