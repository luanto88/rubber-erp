-- GĐ5 (2026-09-29): Tên ca A/B/C theo ca trưởng, có ngày hiệu lực.
--
-- Trước đây tên ca nằm ở 3 cột cố định factories.ca_a_ten/ca_b_ten/ca_c_ten
-- (20260713) → đổi ca trưởng là sửa đè, in lại báo cáo ngày cũ ra tên mới.
-- Nay mỗi lần đổi ca trưởng = thêm 1 dòng mới với hieu_luc_tu; báo cáo ngày X
-- dùng dòng có hieu_luc_tu <= X mới nhất.
--
-- 3 cột factories.ca_*_ten được GIỮ LẠI làm LEGACY (code chỉ còn đọc làm fallback
-- khi bảng này chưa có dòng cho ca đó). Chạy lại file này an toàn (idempotent).

CREATE TABLE IF NOT EXISTS public.production_shift_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  ca TEXT NOT NULL CHECK (ca IN ('A', 'B', 'C')),
  ca_truong TEXT NOT NULL CHECK (length(btrim(ca_truong)) > 0),
  hieu_luc_tu DATE NOT NULL,
  ghi_chu TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT production_shift_names_unique UNIQUE (factory_id, ca, hieu_luc_tu)
);

CREATE INDEX IF NOT EXISTS idx_production_shift_names_lookup
  ON public.production_shift_names (factory_id, ca, hieu_luc_tu DESC);

-- Seed từ 3 cột cũ (chỉ ca có tên), mốc 2020-01-01 để phủ mọi báo cáo lịch sử.
INSERT INTO public.production_shift_names (factory_id, ca, ca_truong, hieu_luc_tu, ghi_chu)
SELECT f.id, v.ca, btrim(v.ten), DATE '2020-01-01', 'Chuyển từ cấu hình tên ca cũ'
FROM public.factories f
CROSS JOIN LATERAL (VALUES ('A', f.ca_a_ten), ('B', f.ca_b_ten), ('C', f.ca_c_ten)) AS v(ca, ten)
WHERE v.ten IS NOT NULL AND length(btrim(v.ten)) > 0
ON CONFLICT (factory_id, ca, hieu_luc_tu) DO NOTHING;

ALTER TABLE public.production_shift_names ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_shift_names_select ON public.production_shift_names;
CREATE POLICY production_shift_names_select ON public.production_shift_names
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS production_shift_names_insert ON public.production_shift_names;
CREATE POLICY production_shift_names_insert ON public.production_shift_names
  FOR INSERT TO authenticated
  WITH CHECK (
    factory_id = public.current_profile_factory_id()
    AND (public.current_profile_role() = 'admin'
         OR public.current_profile_has_permission('settings.manage_config'))
  );

DROP POLICY IF EXISTS production_shift_names_update ON public.production_shift_names;
CREATE POLICY production_shift_names_update ON public.production_shift_names
  FOR UPDATE TO authenticated
  USING (
    factory_id = public.current_profile_factory_id()
    AND (public.current_profile_role() = 'admin'
         OR public.current_profile_has_permission('settings.manage_config'))
  )
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS production_shift_names_delete ON public.production_shift_names;
CREATE POLICY production_shift_names_delete ON public.production_shift_names
  FOR DELETE TO authenticated
  USING (
    factory_id = public.current_profile_factory_id()
    AND (public.current_profile_role() = 'admin'
         OR public.current_profile_has_permission('settings.manage_config'))
  );

CREATE OR REPLACE FUNCTION public.production_shift_names_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_shift_names_touch ON public.production_shift_names;
CREATE TRIGGER trg_production_shift_names_touch
  BEFORE UPDATE ON public.production_shift_names
  FOR EACH ROW EXECUTE FUNCTION public.production_shift_names_touch();

COMMENT ON COLUMN public.factories.ca_a_ten IS 'LEGACY (2026-09-29): thay bằng production_shift_names; chỉ còn làm fallback.';
COMMENT ON COLUMN public.factories.ca_b_ten IS 'LEGACY (2026-09-29): thay bằng production_shift_names; chỉ còn làm fallback.';
COMMENT ON COLUMN public.factories.ca_c_ten IS 'LEGACY (2026-09-29): thay bằng production_shift_names; chỉ còn làm fallback.';

-- Kiểm chứng:
--   SELECT ca, ca_truong, hieu_luc_tu FROM production_shift_names ORDER BY factory_id, ca, hieu_luc_tu;
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'production_shift_names';  -- 4 dòng
