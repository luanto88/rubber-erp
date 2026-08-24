import { supabaseAdmin } from "../_lib/security"

// Dùng chung cho cả 2 bước công khai (chưa có phiên đăng nhập) của luồng Quên mật khẩu —
// check-username (Bước 1) và request (Bước 2). Không thể dùng lại
// security_sensitive_action_attempts (user_id NOT NULL REFERENCES profiles) vì tại các route
// này chưa chắc chắn username có khớp tài khoản thật hay không.

export const RATE_LIMIT_WINDOW_MINUTES = 15
// Đồng bộ với MAX_OTP_ATTEMPTS/MAX_VERIFY_ATTEMPTS (= 5) đã dùng cho luồng OTP đổi PIN/chữ
// ký/mật khẩu trong _lib/security.ts — 3 quá thấp, dễ chặn nhầm người dùng thật gõ sai vài lần.
export const MAX_ATTEMPTS_PER_IDENTIFIER = 5

// Đếm TRƯỚC rồi luôn ghi nhận lượt gọi này NGAY SAU (bất kể tài khoản có tồn tại hay không) —
// nếu chỉ ghi nhận khi tài khoản tồn tại, kẻ tấn công có thể suy ra tài khoản có tồn tại hay
// không qua việc rate-limit có tăng hay không.
//
// Bug thật đã phát hiện + fix khi test tay (2026-08-24): bản đầu không check lỗi INSERT — nếu
// bảng `security_public_action_attempts` không tồn tại (vd migration chưa chạy), INSERT lỗi bị
// nuốt âm thầm, không có dòng nào được ghi, nên COUNT ở lần gọi sau luôn thấy 0 → rate-limit
// không bao giờ kích hoạt (fail OPEN thay vì fail CLOSED — sai hướng cho 1 cơ chế chống lạm
// dụng). Phải throw nếu INSERT lỗi, để route trả 429 (khoá an toàn) thay vì âm thầm cho phép gọi
// vô hạn. Không được bỏ check này khi sửa lại hàm.
export async function assertNotPubliclyRateLimited(identifier: string) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString()
  const { count, error } = await supabaseAdmin
    .from("security_public_action_attempts")
    .select("id", { count: "exact", head: true })
    .eq("identifier", identifier)
    .gte("created_at", since)

  if (error) throw new Error(error.message)

  if ((count || 0) >= MAX_ATTEMPTS_PER_IDENTIFIER) {
    throw new Error(`Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau ${RATE_LIMIT_WINDOW_MINUTES} phút.`)
  }

  const { error: insertError } = await supabaseAdmin
    .from("security_public_action_attempts")
    .insert({ identifier })
  if (insertError) throw new Error(insertError.message)
}

// Bug thật đã phát hiện (2026-08-24, người dùng test tay bị chặn ngay ở lần đầu tiên): trên
// `npm run dev` (local), Next.js tự điền `x-forwarded-for` bằng địa chỉ loopback `::1` (đã xác
// nhận trực tiếp qua dữ liệu thật trong bảng `security_public_action_attempts`) cho MỌI kết nối
// tới localhost — không phải rỗng/thiếu như dự đoán ban đầu. Hệ quả: MỌI request test (của tôi
// lẫn của người dùng) trên cùng máy đều rơi vào CHUNG 1 "địa chỉ IP" `::1`, chia sẻ chung 1 ngân
// sách rate-limit — người dùng bị chặn oan ngay ở lần thử ĐẦU TIÊN vì kế thừa số lượt tôi đã
// dùng khi test trước đó. Fix lần 1 (chỉ coi rỗng/"unknown" là fallback) KHÔNG đủ vì `::1` là
// giá trị "có thật", không rơi vào nhánh fallback đó — phải coi cả loopback (`::1`, `127.0.0.1`)
// là "không xác định được IP thật" và bỏ qua hẳn bước kiểm tra theo IP trong các trường hợp này
// (vẫn còn kiểm tra theo username). Trên production (Vercel) client thật không bao giờ có IP
// loopback nên không bị ảnh hưởng gì.
const NON_DISTINGUISHING_IPS = new Set(["::1", "127.0.0.1"])

export function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0].trim()
  const candidate = first || req.headers.get("x-real-ip")?.trim() || null
  if (!candidate || NON_DISTINGUISHING_IPS.has(candidate)) return null
  return candidate
}
