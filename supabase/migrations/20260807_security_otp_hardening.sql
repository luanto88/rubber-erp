-- Hardening cho luồng OTP xác thực thao tác nhạy cảm (đổi PIN/chữ ký/mật khẩu):
-- 1) Giới hạn 5 lần thử OTP mỗi challenge (trước đây không giới hạn — có thể brute-force 6 số
--    trong 900.000 khả năng qua chính /api/account/verify-otp).
-- 2) actionToken (JWT cấp sau khi verify OTP đúng) giờ chỉ dùng được ĐÚNG 1 LẦN trong 10 phút
--    hiệu lực (trước đây có thể tái sử dụng nhiều lần để lặp lại cùng 1 thao tác nhạy cảm).

ALTER TABLE public.security_otp_challenges
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS action_token_jti TEXT,
  ADD COLUMN IF NOT EXISTS action_token_used_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_otp_challenges_action_token_jti
  ON public.security_otp_challenges(action_token_jti)
  WHERE action_token_jti IS NOT NULL;

-- Atomic: tăng attempt_count và trả về otp_hash MỚI NHẤT CHỈ KHI challenge còn hợp lệ (chưa dùng,
-- chưa hết hạn, chưa đủ 5 lần thử). Mệnh đề WHERE attempt_count < 5 nằm NGAY TRONG câu UPDATE nên
-- dù nhiều request đoán OTP được gửi song song (parallel), Postgres tự serialize theo từng dòng —
-- tối đa đúng 5 lần "claim" thành công, không thể lách qua bằng cách gửi dồn dập để né rate-limit
-- không atomic ở tầng JS.
CREATE OR REPLACE FUNCTION public.security_otp_challenge_claim_attempt(
  p_challenge_id UUID,
  p_user_id UUID,
  p_action_type TEXT
)
RETURNS TABLE (otp_hash TEXT, attempt_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.security_otp_challenges c
  SET attempt_count = c.attempt_count + 1
  WHERE c.id = p_challenge_id
    AND c.user_id = p_user_id
    AND c.action_type = p_action_type
    AND c.consumed_at IS NULL
    AND c.expires_at > now()
    AND c.attempt_count < 5
  RETURNING c.otp_hash, c.attempt_count;
END;
$$;

-- Chỉ server-side (service role, dùng bởi supabaseAdmin trong security.ts) được gọi hàm này —
-- mirror đúng policy "deny all" hiện có của chính bảng security_otp_challenges.
REVOKE ALL ON FUNCTION public.security_otp_challenge_claim_attempt(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_otp_challenge_claim_attempt(UUID, UUID, TEXT) TO service_role;
