-- Hardening bổ sung (mục #3 audit bảo mật 2026-08-07): giới hạn số lần thử sai mật khẩu/PIN ở
-- bước "request-otp" (trước khi cả OTP được sinh ra) — trước đây không giới hạn, kẻ tấn công đã
-- có access token hợp lệ của nạn nhân (vd đánh cắp qua XSS) có thể thử vét cạn PIN 4-6 số nếu đã
-- biết trước mật khẩu, hoặc ngược lại.

CREATE TABLE IF NOT EXISTS public.security_sensitive_action_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_sensitive_action_attempts_user_time
  ON public.security_sensitive_action_attempts(user_id, created_at DESC);

ALTER TABLE public.security_sensitive_action_attempts ENABLE ROW LEVEL SECURITY;

-- Chỉ service role (supabaseAdmin trong security.ts) được đọc/ghi bảng này, mirror đúng policy
-- "deny all" hiện có của security_otp_challenges.
DROP POLICY IF EXISTS "security_sensitive_action_attempts deny all" ON public.security_sensitive_action_attempts;
CREATE POLICY "security_sensitive_action_attempts deny all"
ON public.security_sensitive_action_attempts
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);
