// Helper tải file từ Supabase Storage về máy (thay vì mở tab xem).
//
// Vì sao cần: file trên Storage nằm ở domain khác app (cross-origin), mà thuộc tính HTML
// `download` của thẻ <a> CHỈ có tác dụng same-origin — trình duyệt bỏ qua nó khi khác origin,
// nên `<a href={storageUrl} download>` thực chất chỉ mở tab xem PDF. Đây là bug đã tồn tại thật
// ở nút "Tải" của module Văn bản.
//
// Cách xử lý: Supabase Storage hỗ trợ query param `?download=<tên file>` — server sẽ trả header
// `Content-Disposition: attachment; filename*=UTF-8''...`, trình duyệt tải thẳng về máy và giữ
// đúng tên tiếng Việt CÓ DẤU. Đã kiểm chứng bằng HTTP thật trên cả 2 bucket đang dùng
// (`signing-documents` của hệ ký số dùng chung, và `iso-documents` của ISO/Văn bản).
//
// So với cách fetch → blob → URL.createObjectURL (mẫu ở iso/forms/[id]/page.tsx): cách này không
// tốn RAM tải cả file vào bộ nhớ (file đã ký có thể vài MB), không phụ thuộc CORS, và vẫn hoạt
// động khi người dùng chuột phải "Mở trong tab mới" / "Lưu liên kết".

/** Phần mở rộng hợp lệ suy được từ đường dẫn file trên Storage. */
const KNOWN_EXTS = ["pdf", "docx", "xlsx", "doc", "xls", "png", "jpg", "jpeg", "zip"]

/**
 * Làm sạch tên file để đặt vào Content-Disposition.
 *
 * CỐ Ý GIỮ dấu tiếng Việt — khác `sanitizeStorageFileName()` (documents-types.ts) vốn bỏ dấu vì
 * dùng để đặt tên object trên Storage. Ở đây tên chỉ hiển thị cho người dùng khi lưu file.
 *
 * Chỉ thay các ký tự Windows/URL không cho phép trong tên file — đặc biệt dấu `/` rất hay gặp
 * trong mã văn bản ("20/BC-NMCB") và mã biên bản, để nguyên sẽ sinh tên file hỏng.
 */
export function safeDownloadFileName(name: string, ext?: string): string {
  const base = (name || "file")
    .replace(/[\\/:*?"<>|]+/g, "-") // ký tự cấm → gạch ngang
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .trim()
    .replace(/^[.\-]+|[.\-]+$/g, "") // bỏ dấu chấm/gạch thừa ở 2 đầu
    .slice(0, 120)
  const safeBase = base || "file"
  if (!ext) return safeBase
  const cleanExt = ext.replace(/^\./, "").toLowerCase()
  return safeBase.toLowerCase().endsWith(`.${cleanExt}`) ? safeBase : `${safeBase}.${cleanExt}`
}

/** Suy phần mở rộng từ đường dẫn URL (bỏ qua query string). Mặc định "pdf". */
export function extFromStorageUrl(url: string): string {
  const path = url.split("?")[0].split("#")[0]
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return KNOWN_EXTS.includes(ext) ? ext : "pdf"
}

/**
 * Thêm `?download=<tên file>` vào URL Supabase Storage để trình duyệt TẢI VỀ thay vì mở tab.
 *
 * @param url       URL public của file trên Storage.
 * @param fileName  Tên file mong muốn (không cần phần mở rộng — tự suy từ `url`).
 * @returns         URL đã gắn tham số. URL rỗng/không hợp lệ → trả về nguyên bản, không throw.
 */
export function buildStorageDownloadUrl(url: string | null | undefined, fileName: string): string {
  if (!url) return ""
  const finalName = safeDownloadFileName(fileName, extFromStorageUrl(url))
  try {
    // Dùng URL API để tự xử lý trường hợp URL đã có sẵn query string (nối "&" thay vì "?").
    const parsed = new URL(url)
    parsed.searchParams.set("download", finalName)
    return parsed.toString()
  } catch {
    // URL tương đối hoặc dị dạng — nối tay, vẫn tốt hơn là trả về link không tải được.
    const sep = url.includes("?") ? "&" : "?"
    return `${url}${sep}download=${encodeURIComponent(finalName)}`
  }
}
