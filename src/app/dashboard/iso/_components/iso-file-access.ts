import { hasPermission, type SessionUser } from "@/lib/auth"

// File RIÊNG, không gộp vào iso-types.ts: file đó đang được `api/iso/forms/[id]/finalize/route.ts`
// import, mà `@/lib/auth` kéo theo Supabase browser client — không nên nạp vào runtime server.
// Chỉ các trang client của module ISO import file này.

export type DocParticipantContext = {
  created_by?: string | null
  soan_thao_user_id?: string | null
  xem_xet_user_id?: string | null
  phe_duyet_user_id?: string | null
  nguoi_tao?: string | null
  [key: string]: unknown
}

/**
 * Được phép MỞ/TẢI file của một bản ghi ISO hay không.
 *
 * Bản đã hết hiệu lực không dùng cho công việc được nữa, nên chỉ người được cấp quyền
 * `iso.view_het_hieu_luc` (migration 20260915) hoặc người trực tiếp tham gia tạo/soạn thảo/soát xét/phê duyệt
 * mới mở được nội dung; người chỉ nhận phân phối thông thường mà không có quyền sẽ bị khóa nút mở/tải file.
 *
 * Gate theo trạng thái của CHÍNH bản ghi đang render — hồ sơ có `trang_thai` riêng, không
 * suy từ tài liệu. `hasPermission` đã tự cho role admin đi qua.
 *
 * ⚠️ Đây là rào ở tầng GIAO DIỆN. Bucket `iso-documents` là public và trang chi tiết query
 * thẳng Supabase nên URL file vẫn nằm trong payload — người biết dùng devtools vẫn lấy được.
 * Muốn chặn thật phải chuyển sang signed URL (ảnh hưởng cả QR đã in), ngoài phạm vi hiện tại.
 */
export function canOpenIsoFile(
  trangThai: string | null | undefined,
  user: Pick<SessionUser, "role" | "permissions"> | null | undefined,
  docContext?: DocParticipantContext | null,
  currentUserId?: string | null,
): boolean {
  if (trangThai !== "het_hieu_luc") return true
  if (hasPermission(user, "iso.view_het_hieu_luc")) return true

  // Người trực tiếp tham gia hồ sơ (tạo, soạn thảo, soát xét, phê duyệt) được mở xem lại file của mình
  if (currentUserId && docContext) {
    const isParticipant =
      docContext.created_by === currentUserId ||
      docContext.soan_thao_user_id === currentUserId ||
      docContext.xem_xet_user_id === currentUserId ||
      docContext.phe_duyet_user_id === currentUserId ||
      docContext.nguoi_tao === currentUserId
    if (isParticipant) return true
  }

  return false
}

/** Tooltip/nhãn dùng chung cho nút bị khoá vì tài liệu đã hết hiệu lực. */
export const EXPIRED_FILE_HINT =
  'Tài liệu đã hết hiệu lực — cần quyền "Xem file bản hết hiệu lực" mới mở/tải được'

