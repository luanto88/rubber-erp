-- Tính năng "Quên mật khẩu" (đăng nhập bằng Tên đăng nhập + Email thật, xác nhận khớp hồ sơ,
-- sinh mật khẩu mới gửi qua email, bắt buộc đổi lại trước khi vào dashboard).
--
-- Không tái dùng security_otp_challenges/security_sensitive_action_attempts cho luồng này:
-- 1) Luồng này KHÔNG có bước "người dùng tự nhập lại mã OTP" — mật khẩu mới được gửi thẳng qua
--    email, người dùng dùng nó để đăng nhập lại. Vì vậy không cần mở rộng CHECK constraint của
--    security_otp_challenges.action_type (bảng đó gắn liền với luồng verify-otp có bcrypt-hash +
--    RPC chống brute-force, không khớp ngữ nghĩa "gửi thẳng mật khẩu mới").
-- 2) security_sensitive_action_attempts có user_id NOT NULL REFERENCES profiles — không dùng
--    được để rate-limit một request CÔNG KHAI, vì tại thời điểm nhận request ta chưa chắc chắn
--    username có tồn tại hay không (không muốn query/insert theo user_id suy đoán).

-- 1) Cờ bắt buộc đổi mật khẩu ở lần đăng nhập tiếp theo — set = true khi sinh mật khẩu mới qua
--    Quên mật khẩu; set = false ngay sau khi người dùng tự đổi mật khẩu thành công.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- 2) Bảng rate-limit cho endpoint CÔNG KHAI (chưa xác thực) — khoá theo identifier tự do
--    (username đã normalize hoặc IP), không phải FK cứng vào profiles.
CREATE TABLE IF NOT EXISTS public.security_public_action_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  identifier TEXT NOT NULL, -- vd "forgot_password:username:tenkhachhang" hoặc "forgot_password:ip:1.2.3.4"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_public_action_attempts_identifier_time
  ON public.security_public_action_attempts(identifier, created_at DESC);

ALTER TABLE public.security_public_action_attempts ENABLE ROW LEVEL SECURITY;

-- Chỉ service role (supabaseAdmin) đọc/ghi bảng này — mirror đúng policy "deny all" hiện có của
-- security_otp_challenges / security_sensitive_action_attempts.
DROP POLICY IF EXISTS "security_public_action_attempts deny all" ON public.security_public_action_attempts;
CREATE POLICY "security_public_action_attempts deny all"
ON public.security_public_action_attempts
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);
