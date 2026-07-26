-- Module KPI — Phase 2: Đánh giá 5S theo khu vực (kpi_5s_zones + kpi_5s_evaluations).
-- Xem đầy đủ kiến trúc/roadmap tại .claude/rules/27-kpi-module.md, mục "Database Schema" (5S).

-- ── 1. kpi_5s_zones — danh mục khu vực + người phụ trách HIỆN TẠI (standing) ────────────────
CREATE TABLE IF NOT EXISTS public.kpi_5s_zones (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id     UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  ma_khu_vuc     TEXT NOT NULL,
  ten_khu_vuc    TEXT NOT NULL,
  vi_tri_mo_ta   TEXT,
  nguoi_don_id   UUID REFERENCES auth.users(id),
  nguoi_cham_id  UUID REFERENCES auth.users(id),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(factory_id, ma_khu_vuc),
  CHECK (nguoi_don_id IS NULL OR nguoi_cham_id IS NULL OR nguoi_don_id <> nguoi_cham_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_5s_zones_factory_active ON public.kpi_5s_zones(factory_id, is_active);

ALTER TABLE public.kpi_5s_zones ENABLE ROW LEVEL SECURITY;

-- Đọc rộng trong factory — danh sách khu vực + ai đang phụ trách là thông tin minh bạch cho
-- mọi người (mirror kpi_task_templates_select).
DROP POLICY IF EXISTS "kpi_5s_zones_select" ON public.kpi_5s_zones;
CREATE POLICY "kpi_5s_zones_select" ON public.kpi_5s_zones
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "kpi_5s_zones_insert" ON public.kpi_5s_zones;
CREATE POLICY "kpi_5s_zones_insert" ON public.kpi_5s_zones
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP POLICY IF EXISTS "kpi_5s_zones_update" ON public.kpi_5s_zones;
CREATE POLICY "kpi_5s_zones_update" ON public.kpi_5s_zones
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP POLICY IF EXISTS "kpi_5s_zones_delete" ON public.kpi_5s_zones;
CREATE POLICY "kpi_5s_zones_delete" ON public.kpi_5s_zones
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP TRIGGER IF EXISTS trg_kpi_5s_zones_updated_at ON public.kpi_5s_zones;
CREATE TRIGGER trg_kpi_5s_zones_updated_at
  BEFORE UPDATE ON public.kpi_5s_zones
  FOR EACH ROW EXECUTE FUNCTION public.kpi_tasks_set_updated_at();

-- ── 2. kpi_5s_evaluations — 1 bản chấm/khu vực/tuần, bất biến (không UPDATE/DELETE cho client) ──
CREATE TABLE IF NOT EXISTS public.kpi_5s_evaluations (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id     UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  zone_id        UUID NOT NULL REFERENCES public.kpi_5s_zones(id),
  tuan_bat_dau   DATE NOT NULL,
  -- SNAPSHOT người chịu trách nhiệm ĐÚNG TUẦN ĐÓ — mặc định lấy từ zones.nguoi_don_id lúc chấm,
  -- người chấm được sửa lại nếu có người dọn thay trong tuần đó.
  nguoi_don_id   UUID NOT NULL REFERENCES auth.users(id),
  nguoi_cham_id  UUID NOT NULL REFERENCES auth.users(id),
  ket_qua        TEXT NOT NULL CHECK (ket_qua IN ('dat', 'khong_dat')),
  ly_do          TEXT,
  image_urls     TEXT[] NOT NULL DEFAULT '{}',
  danh_gia_luc   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(zone_id, tuan_bat_dau),
  CHECK (ket_qua <> 'khong_dat' OR (ly_do IS NOT NULL AND length(trim(ly_do)) > 0))
);

CREATE INDEX IF NOT EXISTS idx_kpi_5s_evaluations_zone ON public.kpi_5s_evaluations(zone_id, tuan_bat_dau DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_5s_evaluations_factory ON public.kpi_5s_evaluations(factory_id);

ALTER TABLE public.kpi_5s_evaluations ENABLE ROW LEVEL SECURITY;

-- Lịch sử Đạt/Không đạt công khai trong factory (mục tiêu minh bạch của cả module).
DROP POLICY IF EXISTS "kpi_5s_evaluations_select" ON public.kpi_5s_evaluations;
CREATE POLICY "kpi_5s_evaluations_select" ON public.kpi_5s_evaluations
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

-- Chỉ ĐÚNG người đang là nguoi_cham_id HIỆN TẠI của khu vực đó mới được chấm — không có
-- ngoại lệ admin (đúng tinh thần "công bằng, minh bạch" — nếu admin muốn chấm, tự gán mình
-- làm nguoi_cham_id của khu vực trong Cài đặt).
DROP POLICY IF EXISTS "kpi_5s_evaluations_insert" ON public.kpi_5s_evaluations;
CREATE POLICY "kpi_5s_evaluations_insert" ON public.kpi_5s_evaluations
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND nguoi_cham_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.kpi_5s_zones z
      WHERE z.id = zone_id
        AND z.factory_id = kpi_5s_evaluations.factory_id
        AND z.nguoi_cham_id = auth.uid()
        AND z.is_active = true
    )
  );
