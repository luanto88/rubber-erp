-- Module KPI & 5S — Phase B: hạ tầng "Phòng ban" + tự phát hiện "lãnh đạo" (thay thế
-- kpi_department_managers, cấu hình tay đã sai hướng). Xem đầy đủ .claude/rules/27-kpi-module.md.
--
-- Cần chạy SAU 20260806_kpi_management_upgrades.sql.
--
-- Tóm tắt:
-- 1. Thêm cột phong_ban_id cho 4 đối tượng: kpi_5s_locations, kpi_5s_zones, kpi_task_templates,
--    kpi_tasks.
-- 2. Thêm assigned_by/assigned_at ("Người giao") cho kpi_5s_locations.
-- 3. Gỡ CHECK cũ (nguoi_don_id <> nguoi_cham_id) trên kpi_5s_locations — "Người dọn hiện tại"
--    chuyển hẳn sang multi-select (kpi_5s_location_cleaners), cột nguoi_don_id đơn từ nay là
--    legacy nên CHECK dựa trên nó không còn đúng thực tế.
-- 4. Thay bằng 2 trigger thực thi đúng ràng buộc "người chấm phải khác MỌI người dọn" so với
--    tập nhiều người (không thể viết CHECK constraint tham chiếu bảng khác trong Postgres).
-- 5. Hàm kpi_is_department_leader(user, department) — EXACT MATCH chuc_vu/chuc_vu_chinh_quyen
--    (không phải substring như dept-leader của Documents module) để tách đúng "Giám đốc/Phó
--    giám đốc" (nhà máy) khỏi "Tổng giám đốc/Phó tổng giám đốc" (công ty) — cả 2 nhóm đều là
--    lãnh đạo hợp lệ nhưng không được lẫn vào nhau.
-- 6. Viết lại RLS: kpi_tasks_insert, kpi_appeals_update, kpi_user_substitutions_insert (bỏ phụ
--    thuộc kpi_department_managers) + mở rộng kpi_task_templates/kpi_5s_locations/kpi_5s_zones
--    (insert/update/delete) để lãnh đạo phòng ban tự quản lý được đúng phạm vi của mình mà
--    không cần cấp riêng kpi.manage_config — hệ quả tất yếu của việc tab "Việc định kỳ" giờ
--    cũng hiện cho lãnh đạo phòng ban (nếu không mở RLS này, họ thấy tab nhưng lưu sẽ bị chặn).
--
-- KHÔNG DROP bảng kpi_department_managers (còn dữ liệu cấu hình thật, không tự ý xoá) — chỉ
-- ngừng tham chiếu nó trong RLS/UI.

-- ══════════════════ 1-2. Thêm cột phong_ban_id + assigned_by/assigned_at ══════════════════
ALTER TABLE public.kpi_5s_locations ADD COLUMN IF NOT EXISTS phong_ban_id UUID REFERENCES public.departments(id);
ALTER TABLE public.kpi_5s_zones ADD COLUMN IF NOT EXISTS phong_ban_id UUID REFERENCES public.departments(id);
ALTER TABLE public.kpi_task_templates ADD COLUMN IF NOT EXISTS phong_ban_id UUID REFERENCES public.departments(id);
ALTER TABLE public.kpi_tasks ADD COLUMN IF NOT EXISTS phong_ban_id UUID REFERENCES public.departments(id);

ALTER TABLE public.kpi_5s_locations ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES auth.users(id);
ALTER TABLE public.kpi_5s_locations ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- ══════════════════ 3. Gỡ CHECK cũ nguoi_don_id <> nguoi_cham_id ══════════════════
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.kpi_5s_locations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%nguoi_don_id%'
      AND pg_get_constraintdef(oid) ILIKE '%nguoi_cham_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.kpi_5s_locations DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

-- ══════════════════ 4. Trigger: người chấm phải khác MỌI người dọn ══════════════════
CREATE OR REPLACE FUNCTION public.kpi_5s_check_cleaner_not_scorer()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.kpi_5s_locations l
    WHERE l.id = NEW.location_id AND l.nguoi_cham_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Người này đang là Người chấm hiện tại của vị trí — không thể thêm làm người dọn.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kpi_5s_location_cleaners_not_scorer ON public.kpi_5s_location_cleaners;
CREATE TRIGGER trg_kpi_5s_location_cleaners_not_scorer
  BEFORE INSERT ON public.kpi_5s_location_cleaners
  FOR EACH ROW EXECUTE FUNCTION public.kpi_5s_check_cleaner_not_scorer();

CREATE OR REPLACE FUNCTION public.kpi_5s_check_scorer_not_cleaner()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nguoi_cham_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.kpi_5s_location_cleaners c
    WHERE c.location_id = NEW.id AND c.user_id = NEW.nguoi_cham_id
  ) THEN
    RAISE EXCEPTION 'Người chấm hiện tại không được nằm trong danh sách Người dọn hiện tại.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kpi_5s_locations_scorer_not_cleaner ON public.kpi_5s_locations;
CREATE TRIGGER trg_kpi_5s_locations_scorer_not_cleaner
  BEFORE INSERT OR UPDATE OF nguoi_cham_id ON public.kpi_5s_locations
  FOR EACH ROW EXECUTE FUNCTION public.kpi_5s_check_scorer_not_cleaner();

-- ══════════════════ 5. Tự phát hiện "lãnh đạo phòng ban" (exact-match) ══════════════════
CREATE OR REPLACE FUNCTION public.kpi_is_department_leader(p_user_id UUID, p_department_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.departments d ON d.id = p_department_id
    JOIN public.maintenance_staff ms ON ms.profile_id = p.id AND ms.active = true
    WHERE p.id = p_user_id
      AND (
        p.department_id = d.id
        OR p.department = d.name
        OR upper(p.department) = upper(d.code)
      )
      AND (
        lower(trim(coalesce(ms.chuc_vu_chinh_quyen, ''))) IN
          ('giám đốc', 'phó giám đốc', 'trưởng phòng', 'phó phòng', 'tổng giám đốc', 'phó tổng giám đốc')
        OR lower(trim(coalesce(ms.chuc_vu, ''))) IN
          ('giám đốc', 'phó giám đốc', 'trưởng phòng', 'phó phòng', 'tổng giám đốc', 'phó tổng giám đốc')
      )
  );
$$;

REVOKE ALL ON FUNCTION public.kpi_is_department_leader(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_is_department_leader(UUID, UUID) TO authenticated;

-- ══════════════════ 6a. kpi_tasks_insert — bỏ phụ thuộc kpi_department_managers ══════════════
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
      phong_ban_id IS NULL
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR public.kpi_is_department_leader(auth.uid(), phong_ban_id)
    )
  );

-- ══════════════════ 6b. kpi_appeals_update — quay lại đơn giản (admin/kpi.manage_config) ═════
DROP POLICY IF EXISTS "kpi_appeals_update" ON public.kpi_appeals;
CREATE POLICY "kpi_appeals_update" ON public.kpi_appeals
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR public.current_profile_has_permission('kpi.manage_config')
  );

-- ══════════════ 6c. kpi_user_substitutions_insert — quay lại bản gốc đơn giản ══════════════
-- Thẩm quyền thật sự giờ nằm ở bước DUYỆT (Phase C), không phải ở bước tạo yêu cầu.
DROP POLICY IF EXISTS "kpi_user_substitutions_insert" ON public.kpi_user_substitutions;
CREATE POLICY "kpi_user_substitutions_insert" ON public.kpi_user_substitutions
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
    AND (
      original_user_id = auth.uid()
      OR public.current_profile_has_permission('kpi.assign')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- ══════════════ 6d. Mở rộng CRUD kpi_task_templates cho lãnh đạo phòng ban ══════════════
-- Hệ quả tất yếu của việc tab "Việc định kỳ" giờ hiện cho lãnh đạo phòng ban (Phase D) — nếu
-- không mở RLS này, họ thấy tab nhưng thao tác lưu sẽ bị RLS chặn.
DROP POLICY IF EXISTS "kpi_task_templates_insert" ON public.kpi_task_templates;
CREATE POLICY "kpi_task_templates_insert" ON public.kpi_task_templates
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (phong_ban_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), phong_ban_id))
    )
  );

DROP POLICY IF EXISTS "kpi_task_templates_update" ON public.kpi_task_templates;
CREATE POLICY "kpi_task_templates_update" ON public.kpi_task_templates
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (phong_ban_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), phong_ban_id))
    )
  );

DROP POLICY IF EXISTS "kpi_task_templates_delete" ON public.kpi_task_templates;
CREATE POLICY "kpi_task_templates_delete" ON public.kpi_task_templates
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (phong_ban_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), phong_ban_id))
    )
  );

-- ══════════════ 6e. Mở rộng CRUD kpi_5s_locations cho lãnh đạo phòng ban ══════════════
DROP POLICY IF EXISTS "kpi_5s_locations_insert" ON public.kpi_5s_locations;
CREATE POLICY "kpi_5s_locations_insert" ON public.kpi_5s_locations
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (phong_ban_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), phong_ban_id))
    )
  );

DROP POLICY IF EXISTS "kpi_5s_locations_update" ON public.kpi_5s_locations;
CREATE POLICY "kpi_5s_locations_update" ON public.kpi_5s_locations
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (phong_ban_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), phong_ban_id))
    )
  );

DROP POLICY IF EXISTS "kpi_5s_locations_delete" ON public.kpi_5s_locations;
CREATE POLICY "kpi_5s_locations_delete" ON public.kpi_5s_locations
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (phong_ban_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), phong_ban_id))
    )
  );

-- ══════════════ 6f. Mở rộng CRUD kpi_5s_zones cho lãnh đạo phòng ban ══════════════
DROP POLICY IF EXISTS "kpi_5s_zones_insert" ON public.kpi_5s_zones;
CREATE POLICY "kpi_5s_zones_insert" ON public.kpi_5s_zones
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (phong_ban_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), phong_ban_id))
    )
  );

DROP POLICY IF EXISTS "kpi_5s_zones_update" ON public.kpi_5s_zones;
CREATE POLICY "kpi_5s_zones_update" ON public.kpi_5s_zones
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (phong_ban_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), phong_ban_id))
    )
  );

DROP POLICY IF EXISTS "kpi_5s_zones_delete" ON public.kpi_5s_zones;
CREATE POLICY "kpi_5s_zones_delete" ON public.kpi_5s_zones
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (phong_ban_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), phong_ban_id))
    )
  );
