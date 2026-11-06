-- ============================================================================
-- Tra cứu thiết bị bằng QR — GĐ1 (2026-11-06). CHẠY TAY trên Supabase SQL Editor TRƯỚC khi deploy.
-- Kế hoạch: docs/qr-equipment-plan.md
--
-- 1. equipment_qr_tokens: bảng ánh xạ token QR → thiết bị (máy móc hoặc xe). QR in trên tem trỏ
--    `/tb/<token>`. Token ngẫu nhiên 128 bit (base64url 22 ký tự) ⇒ không dò được; thu hồi = đặt
--    revoked_at rồi tạo token mới (token cũ vẫn giữ dòng để trả 404 giống hệt token không tồn tại).
-- 2. public_rate_limits: bộ đếm lượt truy cập trang công khai theo cửa sổ 1 phút (1 dòng/khoá/phút).
--
-- Cả 2 bảng bật RLS và KHÔNG có policy ⇒ chỉ service role (API route) đọc/ghi được.
-- Idempotent: chạy lại an toàn.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.equipment_qr_new_token()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=')
$$;

CREATE TABLE IF NOT EXISTS public.equipment_qr_tokens (
  token               TEXT PRIMARY KEY DEFAULT public.equipment_qr_new_token(),
  factory_id          UUID NOT NULL REFERENCES public.factories(id),
  asset_id            UUID REFERENCES public.maintenance_assets(id) ON DELETE CASCADE,
  dispatch_vehicle_id UUID REFERENCES public.dispatch_vehicles(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES auth.users(id),
  revoked_at          TIMESTAMPTZ,
  revoked_by          UUID REFERENCES auth.users(id),
  CONSTRAINT equipment_qr_tokens_one_target CHECK (
    (asset_id IS NOT NULL AND dispatch_vehicle_id IS NULL)
    OR (asset_id IS NULL AND dispatch_vehicle_id IS NOT NULL)
  ),
  CONSTRAINT equipment_qr_tokens_token_format CHECK (token ~ '^[A-Za-z0-9_-]{22}$')
);

-- Mỗi thiết bị chỉ có 1 token còn hiệu lực.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_equipment_qr_tokens_active_asset
  ON public.equipment_qr_tokens(asset_id) WHERE revoked_at IS NULL AND asset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_equipment_qr_tokens_active_vehicle
  ON public.equipment_qr_tokens(dispatch_vehicle_id) WHERE revoked_at IS NULL AND dispatch_vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_qr_tokens_factory ON public.equipment_qr_tokens(factory_id);

ALTER TABLE public.equipment_qr_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.equipment_qr_tokens FROM anon, authenticated;

-- Backfill: mọi máy móc chưa có token còn hiệu lực (GĐ1 chưa làm xe).
INSERT INTO public.equipment_qr_tokens (factory_id, asset_id)
SELECT a.factory_id, a.id
FROM public.maintenance_assets a
WHERE a.factory_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.equipment_qr_tokens t
    WHERE t.asset_id = a.id AND t.revoked_at IS NULL
  );

-- ── Rate limit trang công khai ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.public_rate_limits (
  key_hash     TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_hash, bucket_start)
);
CREATE INDEX IF NOT EXISTS idx_public_rate_limits_bucket ON public.public_rate_limits(bucket_start);

ALTER TABLE public.public_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_rate_limits FROM anon, authenticated;

-- Cộng 1 lượt vào cửa sổ phút hiện tại của khoá, trả về số lượt trong cửa sổ đó.
-- Dọn tại chỗ các cửa sổ cũ hơn 1 giờ (không cần cron) ⇒ bảng không phình.
CREATE OR REPLACE FUNCTION public.public_rate_limit_hit(p_key_hash TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_bucket TIMESTAMPTZ := date_trunc('minute', now());
  v_hits   INTEGER;
BEGIN
  INSERT INTO public.public_rate_limits AS r (key_hash, bucket_start, hits)
  VALUES (p_key_hash, v_bucket, 1)
  ON CONFLICT (key_hash, bucket_start) DO UPDATE SET hits = r.hits + 1
  RETURNING r.hits INTO v_hits;

  DELETE FROM public.public_rate_limits WHERE bucket_start < now() - interval '1 hour';

  RETURN v_hits;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.public_rate_limit_hit(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.equipment_qr_new_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_rate_limit_hit(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.equipment_qr_new_token() TO service_role;

-- Kiểm tra sau khi chạy:
-- SELECT a.ma_tb, t.token FROM equipment_qr_tokens t JOIN maintenance_assets a ON a.id = t.asset_id
--  WHERE a.ma_tb IN ('MCC-1','MCC-2') AND t.revoked_at IS NULL;
