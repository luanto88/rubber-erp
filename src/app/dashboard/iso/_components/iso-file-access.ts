import { hasPermission, type SessionUser } from "@/lib/auth"

// File RIÊNG, không gộp vào iso-types.ts: file đó đang được `api/iso/forms/[id]/finalize/route.ts`
// import, mà `@/lib/auth` kéo theo Supabase browser client — không nên nạp vào runtime server.
// Chỉ các trang client của module ISO import file này.

/**
 * Được phép MỞ/TẢI file của một bản ghi ISO hay không.
 *
 * Bản đã hết hiệu lực không dùng cho công việc được nữa, nên chỉ người được cấp quyền
 * `iso.view_het_hieu_luc` (migration 20260915) mới mở được nội dung; người chỉ có `iso.view`
 * vẫn xem đầy đủ THÔNG TIN chi tiết, chỉ mất nút mở/tải file.
 *
 * Gate theo trạng thái của CHÍNH bản ghi đang render — hồ sơ con có `trang_thai` riêng, không
 * suy từ tài liệu cha. `hasPermission` đã tự cho role admin đi qua.
 *
 * ⚠️ Đây là rào ở tầng GIAO DIỆN. Bucket `iso-documents` là public và trang chi tiết query
 * thẳng Supabase nên URL file vẫn nằm trong payload — người biết dùng devtools vẫn lấy được.
 * Muốn chặn thật phải chuyển sang signed URL (ảnh hưởng cả QR đã in), ngoài phạm vi hiện tại.
 */
export function canOpenIsoFile(
  trangThai: string | null | undefined,
  user: Pick<SessionUser, "role" | "permissions"> | null | undefined,
): boolean {
  if (trangThai !== "het_hieu_luc") return true
  return hasPermission(user, "iso.view_het_hieu_luc")
}

/** Tooltip/nhãn dùng chung cho nút bị khoá vì tài liệu đã hết hiệu lực. */
export const EXPIRED_FILE_HINT =
  'Tài liệu đã hết hiệu lực — cần quyền "Xem file bản hết hiệu lực" mới mở/tải được'
