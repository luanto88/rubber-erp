-- Module KPI — đợt fix sau test tay đầu tiên trên "Vị trí"/"Khu vực" (2026-08-06). Xem đầy đủ
-- .claude/rules/27-kpi-module.md, mục "Cập nhật 2026-08-06 — 7 fix sau test tay đầu tiên".
--
-- Gồm 3 bảng mới + 1 CHECK constraint + mở rộng 3 policy hiện có:
-- 1. kpi_5s_location_cleaners — nhiều người dọn/1 vị trí (thay cho open dropdown sai logic khi
--    chấm điểm — Fix 4/5a).
-- 2. kpi_5s_self_reports — tự báo cáo của người dọn giữa các tuần (Fix 5b).
-- 3. kpi_department_managers — cấu hình "ai được quản lý KPI" theo phòng ban, dùng để thắt chặt
--    kpi_tasks_insert / kpi_appeals_update / kpi_user_substitutions_insert (Fix 7).
-- 4. CHECK ảnh bắt buộc trên kpi_5s_evaluations (Fix 2), NOT VALID để không phá dữ liệu cũ.

-- ── 1. kpi_5s_location_cleaners — đội ngũ dọn dẹp nhiều người/1 vị trí ──────────────────────
CREATE TABLE IF NOT EXISTS public.kpi_5s_location_cleaners (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id   UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  location_id  UUID NOT NULL REFERENCES public.kpi_5s_locations(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_5s_location_cleaners_location ON public.kpi_5s_location_cleaners(location_id);
CREATE INDEX IF NOT EXISTS idx_kpi_5s_location_cleaners_user ON public.kpi_5s_location_cleaners(user_id);

-- Backfill 1 lần từ cột nguoi_don_id cũ (giữ nguyên cột đó — vẫn dùng làm fallback hiển thị/gán
-- nhanh cho "Phân công thông minh", chỉ không còn là nguồn DUY NHẤT quyết định ai được chấm).
INSERT INTO public.kpi_5s_location_cleaners (factory_id, location_id, user_id)
SELECT l.factory_id, l.id, l.nguoi_don_id
FROM public.kpi_5s_locations l
WHERE l.nguoi_don_id IS NOT NULL
ON CONFLICT (location_id, user_id) DO NOTHING;

ALTER TABLE public.kpi_5s_location_cleaners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kpi_5s_location_cleaners_select" ON public.kpi_5s_location_cleaners;
CREATE POLICY "kpi_5s_location_cleaners_select" ON public.kpi_5s_location_cleaners
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "kpi_5s_location_cleaners_write" ON public.kpi_5s_location_cleaners;
CREATE POLICY "kpi_5s_location_cleaners_write" ON public.kpi_5s_location_cleaners
  FOR ALL USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  ) WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- ── 2. kpi_5s_self_reports — người dọn tự báo cáo (ảnh/văn bản/vị trí) giữa các tuần ────────
CREATE TABLE IF NOT EXISTS public.kpi_5s_self_reports (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id     UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  location_id    UUID NOT NULL REFERENCES public.kpi_5s_locations(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id),
  noi_dung       TEXT,
  image_urls     TEXT[] NOT NULL DEFAULT '{}',
  vi_do          NUMERIC,
  kinh_do        NUMERIC,
  dia_diem_text  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (coalesce(trim(noi_dung), '') <> '' OR coalesce(array_length(image_urls, 1), 0) > 0)
);

CREATE INDEX IF NOT EXISTS idx_kpi_5s_self_reports_location ON public.kpi_5s_self_reports(location_id, created_at DESC);

ALTER TABLE public.kpi_5s_self_reports ENABLE ROW LEVEL SECURITY;

-- Đọc rộng trong factory — minh bạch, mirror kpi_5s_evaluations (lịch sử chấm điểm công khai).
DROP POLICY IF EXISTS "kpi_5s_self_reports_select" ON public.kpi_5s_self_reports;
CREATE POLICY "kpi_5s_self_reports_select" ON public.kpi_5s_self_reports
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

-- Chỉ chính người đang thực sự nằm trong đội ngũ dọn dẹp (bảng mới) HOẶC là nguoi_don_id cũ
-- (locations chưa được gán multi) mới tự báo cáo được cho đúng vị trí đó.
DROP POLICY IF EXISTS "kpi_5s_self_reports_insert" ON public.kpi_5s_self_reports;
CREATE POLICY "kpi_5s_self_reports_insert" ON public.kpi_5s_self_reports
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.kpi_5s_location_cleaners c
        WHERE c.location_id = kpi_5s_self_reports.location_id AND c.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.kpi_5s_locations l
        WHERE l.id = kpi_5s_self_reports.location_id AND l.nguoi_don_id = auth.uid()
      )
    )
  );

-- Không có UPDATE/DELETE — log bất biến, mirror kpi_task_logs/kpi_5s_evaluations.

-- ── 3. kpi_department_managers — cấu hình "ai được quản lý KPI" theo phòng ban ──────────────
-- Dùng để thắt chặt (không chỉ cộng thêm): mặc định role=manager được cấp sẵn kpi.assign/
-- kpi.view_all rộng rãi (xem ROLE_DEFAULTS trong src/lib/auth.ts) — quá rộng so với yêu cầu
-- "chỉ Admin + Giám đốc/Phó giám đốc đơn vị". Khi bảng này CÒN RỖNG (chưa cấu hình gì), hành vi
-- giữ nguyên như cũ (chỉ cần permission kpi.assign/kpi.manage_config, không breaking thay đổi
-- ngay khi migration chạy). Ngay khi admin thêm >=1 dòng, các policy bên dưới tự động thắt chặt:
-- chỉ admin hoặc đúng những user_id được liệt kê ở đây mới còn được thực hiện các hành động quản
-- trị KPI (giao việc, giải quyết khiếu nại, phê duyệt người thay thế) — dù họ vẫn giữ nguyên
-- permission kpi.assign/kpi.manage_config trong Cài đặt → Phân quyền.
CREATE TABLE IF NOT EXISTS public.kpi_department_managers (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id     UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  department_id  UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(factory_id, department_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_department_managers_factory ON public.kpi_department_managers(factory_id);
CREATE INDEX IF NOT EXISTS idx_kpi_department_managers_user ON public.kpi_department_managers(user_id);

ALTER TABLE public.kpi_department_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kpi_department_managers_select" ON public.kpi_department_managers;
CREATE POLICY "kpi_department_managers_select" ON public.kpi_department_managers
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "kpi_department_managers_write" ON public.kpi_department_managers;
CREATE POLICY "kpi_department_managers_write" ON public.kpi_department_managers
  FOR ALL USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  ) WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- ── 3b. Thắt chặt kpi_tasks_insert (giao việc), kpi_appeals_update (giải quyết khiếu nại),
--        kpi_user_substitutions_insert (phê duyệt người thay thế đăng ký hộ người khác) ───────
DROP POLICY IF EXISTS "kpi_tasks_insert" ON public.kpi_tasks;
CREATE POLICY "kpi_tasks_insert" ON public.kpi_tasks
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND nguoi_giao_id = auth.uid()
    AND (
      public.current_profile_has_permission('kpi.assign')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
    AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR NOT EXISTS (SELECT 1 FROM public.kpi_department_managers dm WHERE dm.factory_id = kpi_tasks.factory_id)
      OR EXISTS (
        SELECT 1 FROM public.kpi_department_managers dm
        WHERE dm.factory_id = kpi_tasks.factory_id AND dm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "kpi_appeals_update" ON public.kpi_appeals;
CREATE POLICY "kpi_appeals_update" ON public.kpi_appeals
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR (
      public.current_profile_has_permission('kpi.manage_config')
      AND (
        NOT EXISTS (SELECT 1 FROM public.kpi_department_managers dm WHERE dm.factory_id = kpi_appeals.factory_id)
        OR EXISTS (
          SELECT 1 FROM public.kpi_department_managers dm
          WHERE dm.factory_id = kpi_appeals.factory_id AND dm.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "kpi_user_substitutions_insert" ON public.kpi_user_substitutions;
CREATE POLICY "kpi_user_substitutions_insert" ON public.kpi_user_substitutions
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
    AND (
      original_user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (
        public.current_profile_has_permission('kpi.assign')
        AND (
          NOT EXISTS (SELECT 1 FROM public.kpi_department_managers dm WHERE dm.factory_id = kpi_user_substitutions.factory_id)
          OR EXISTS (
            SELECT 1 FROM public.kpi_department_managers dm
            WHERE dm.factory_id = kpi_user_substitutions.factory_id AND dm.user_id = auth.uid()
          )
        )
      )
    )
  );

-- ── 4. Ảnh bắt buộc khi chấm điểm 5S hàng tuần (Fix 2) — NOT VALID để không phá dữ liệu cũ ──
ALTER TABLE public.kpi_5s_evaluations
  DROP CONSTRAINT IF EXISTS chk_kpi_5s_evaluations_image_required;
ALTER TABLE public.kpi_5s_evaluations
  ADD CONSTRAINT chk_kpi_5s_evaluations_image_required
  CHECK (coalesce(array_length(image_urls, 1), 0) > 0) NOT VALID;
