import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { safeDownloadFileName, extFromStorageUrl } from "@/lib/storage-download"

// Hạ tầng dùng chung cho việc phát URL file an toàn sau khi bucket `iso-documents` chuyển
// private (xem 2 migration `20260921_iso_documents_bucket_write_lockdown.sql` +
// `20260921_iso_documents_bucket_private.sql`). Trước đây mọi nơi dùng `getPublicUrl()` —
// URL đó tồn tại vĩnh viễn, không cần đăng nhập, một khi đã lộ ra (devtools, route không xác
// thực...). Giờ mọi nơi cần mở/tải file phải mint 1 Signed URL sống NGẮN HẠN qua service role,
// SAU KHI đã xác thực người gọi + kiểm tra đúng quyền xem bản ghi đó (mỗi module tự viết route
// riêng gọi `mintSignedFileUrl`, tự áp luật quyền của module mình — file này không biết gì về
// business rule, chỉ lo phần Storage thuần túy).
//
// Các cột DB (`iso_documents.file_*_url`, `iso_form_instances.*_url`,
// `van_ban_documents.*_url`) KHÔNG cần migrate — vẫn lưu nguyên chuỗi dạng cũ
// `.../object/public/iso-documents/{path}`, giờ chỉ dùng làm NGUỒN để trích ra `path`, không
// bao giờ fetch trực tiếp từ trình duyệt nữa.

const DEFAULT_TTL_SECONDS = 120

/**
 * Trích phần path bên trong bucket từ 1 URL public kiểu Supabase Storage đã lưu trong DB
 * (`https://.../storage/v1/object/public/{bucket}/{path}`). Trả `null` nếu chuỗi không đúng
 * định dạng hoặc không thuộc đúng `bucket` mong đợi — không suy đoán, không throw.
 */
export function parseStorageObjectPath(storedUrl: string | null | undefined, bucket: string): string | null {
  if (!storedUrl) return null
  const marker = `/object/public/${bucket}/`
  const idx = storedUrl.indexOf(marker)
  if (idx === -1) return null
  const rest = storedUrl.slice(idx + marker.length).split("?")[0].split("#")[0]
  if (!rest) return null
  try {
    return decodeURIComponent(rest)
  } catch {
    return rest
  }
}

export type MintSignedUrlOptions = {
  /** Tên bucket — luôn truyền tường minh, không suy đoán từ URL để tránh mint nhầm bucket khác. */
  bucket: string
  /** Thời gian sống của URL, mặc định 120 giây — đủ 1 lượt mở tab/tải, không dài hơn cần thiết. */
  ttlSeconds?: number
  /**
   * Có truyền -> Supabase trả kèm `Content-Disposition: attachment`, trình duyệt TẢI VỀ thay vì
   * mở tab xem. Không truyền -> mở/xem inline theo content-type (dùng cho nút "Xem").
   */
  downloadName?: string
}

/**
 * Tạo Signed URL ngắn hạn cho 1 path đã biết chính xác bên trong bucket (path convention cố
 * định, không cần trích từ URL cũ — vd `signatures/{factory_id}/{user_id}/chu_ky.png`). Dùng
 * service role (bypass RLS + cờ public/private của bucket hoàn toàn) — hàm này KHÔNG tự kiểm
 * tra quyền, caller (route API) phải tự xác thực người gọi + đúng quyền xem TRƯỚC khi gọi.
 *
 * Trả `null` khi Supabase Storage báo lỗi (object không tồn tại...) — không throw.
 */
export async function mintSignedUrlForPath(
  path: string,
  { bucket, ttlSeconds = DEFAULT_TTL_SECONDS, downloadName }: MintSignedUrlOptions,
): Promise<string | null> {
  const finalName = downloadName ? safeDownloadFileName(downloadName, extFromStorageUrl(path)) : undefined

  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(path, ttlSeconds, finalName ? { download: finalName } : undefined)

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

/**
 * Tạo Signed URL ngắn hạn từ 1 URL public đã lưu trong DB (chuỗi cũ `.../object/public/...`,
 * chỉ dùng làm nguồn trích `path`). Xem `mintSignedUrlForPath` cho phần thực thi + ràng buộc.
 *
 * Trả `null` thêm khi URL nguồn rỗng/sai định dạng (không trích được path).
 */
export async function mintSignedFileUrl(
  storedUrl: string | null | undefined,
  opts: MintSignedUrlOptions,
): Promise<string | null> {
  const path = parseStorageObjectPath(storedUrl, opts.bucket)
  if (!path) return null
  return mintSignedUrlForPath(path, opts)
}
