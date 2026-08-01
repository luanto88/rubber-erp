-- Module KPI — Phase 3: Khung tiêu chí KPI (kpi_criteria_templates) + Chấm điểm chuyên môn theo
-- ngày (kpi_daily_evaluations + kpi_daily_evaluation_items). Xem đầy đủ .claude/rules/27-kpi-module.md
-- mục "Database Schema" ("Nhóm & Chuyên môn (D)") và roadmap Phase 3.
--
-- Công thức (đã ghi rõ trong rules — KHÔNG được chia cố định 1 hằng số, đây là bug thiết kế v1
-- đã bị phát hiện và sửa 1 lần):
--   %đạt(1 nhóm, 1 ngày) = Σ(Đạt×1.0 + Tương_đối×0.5 + Chưa_đạt×0) ÷ số tiêu chí đã chấm
--   Điểm ngày = %chính×10 + Σ(%choàng_i×5)
--   Max ngày  = 10 + 5×(số nhóm choàng CÓ BẢN CHẤM ngày đó)
-- Việc TÍNH điểm tháng (D — Điểm chuyên môn, Phase 4) sẽ đọc từ 2 bảng chấm điểm này; migration
-- này chỉ tạo hạ tầng lưu trữ + khung tiêu chí, KHÔNG tính điểm tháng.
--
-- Quyết định thiết kế:
-- 1. `kpi.evaluate` (đã seed sẵn từ Phase 0, cấp mặc định cho admin+manager) — trước đây CHƯA
--    từng được dùng để gate bất kỳ đâu (task Nghiệm thu/Điều chỉnh/Trả về chỉ dùng nguoi_giao_id/
--    admin). Đây là nơi ĐẦU TIÊN permission này thực sự có tác dụng: ai chấm điểm chuyên môn.
-- 2. `kpi_criteria_templates` KHÔNG có phong_ban_id (personnel_groups không mang khái niệm phòng
--    ban) — quản lý (CRUD) chỉ giới hạn admin/kpi.manage_config, KHÔNG mở rộng cho "lãnh đạo phòng
--    ban" như kpi_5s_locations/kpi_5s_zones/kpi_task_templates (không có ranh giới phòng ban rõ
--    ràng để gán quyền tương tự).
-- 3. `kpi_daily_evaluations` cho phép UPSERT theo (factory_id,user_id,ngay,group_id) — mỗi lượt
--    chấm lại trong ngày GHI ĐÈ (không tạo bản ghi trùng), khớp đúng yêu cầu roadmap "gộp nhiều
--    lần chấm/lần" — khác hẳn kpi_5s_evaluations (log bất biến, không cho sửa). Toàn bộ upsert +
--    thay thế items nằm trong 1 RPC atomic (kpi_submit_daily_evaluation) để tránh client tự làm
--    nhiều bước rời rạc (đúng convention toàn bộ migration trong repo này).
-- 4. `loai` ('chinh'/'choang') được RPC tự tính (snapshot is_primary của group_id đó cho đúng
--    user_id, tại đúng thời điểm chấm) — không tin client tự khai báo.

-- ══════════════════ 1. kpi_criteria_templates ══════════════════
CREATE TABLE IF NOT EXISTS public.kpi_criteria_templates (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id   UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  group_id     UUID NOT NULL REFERENCES public.personnel_groups(id) ON DELETE CASCADE,
  ten_tieu_chi TEXT NOT NULL,
  mo_ta        TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_criteria_templates_group
  ON public.kpi_criteria_templates(factory_id, group_id, is_active, sort_order);

ALTER TABLE public.kpi_criteria_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kpi_criteria_templates_select" ON public.kpi_criteria_templates;
CREATE POLICY "kpi_criteria_templates_select" ON public.kpi_criteria_templates
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "kpi_criteria_templates_insert" ON public.kpi_criteria_templates;
CREATE POLICY "kpi_criteria_templates_insert" ON public.kpi_criteria_templates
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND public.current_profile_has_permission('kpi.manage_config')
  );

DROP POLICY IF EXISTS "kpi_criteria_templates_update" ON public.kpi_criteria_templates;
CREATE POLICY "kpi_criteria_templates_update" ON public.kpi_criteria_templates
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND public.current_profile_has_permission('kpi.manage_config')
  );

DROP POLICY IF EXISTS "kpi_criteria_templates_delete" ON public.kpi_criteria_templates;
CREATE POLICY "kpi_criteria_templates_delete" ON public.kpi_criteria_templates
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND public.current_profile_has_permission('kpi.manage_config')
  );

CREATE OR REPLACE FUNCTION public.kpi_criteria_templates_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kpi_criteria_templates_updated_at ON public.kpi_criteria_templates;
CREATE TRIGGER trg_kpi_criteria_templates_updated_at
  BEFORE UPDATE ON public.kpi_criteria_templates
  FOR EACH ROW EXECUTE FUNCTION public.kpi_criteria_templates_set_updated_at();

-- ══════════════════ 2. kpi_daily_evaluations ══════════════════
CREATE TABLE IF NOT EXISTS public.kpi_daily_evaluations (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id    UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id),
  ngay          DATE NOT NULL,
  group_id      UUID NOT NULL REFERENCES public.personnel_groups(id),
  loai          TEXT NOT NULL CHECK (loai IN ('chinh', 'choang')),
  nguoi_cham_id UUID NOT NULL REFERENCES auth.users(id),
  ghi_chu       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(factory_id, user_id, ngay, group_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_daily_evaluations_user_day
  ON public.kpi_daily_evaluations(factory_id, user_id, ngay);

ALTER TABLE public.kpi_daily_evaluations ENABLE ROW LEVEL SECURITY;

-- Đọc rộng trong factory (minh bạch, mirror kpi_5s_evaluations) — không cần RPC riêng để xem.
DROP POLICY IF EXISTS "kpi_daily_evaluations_select" ON public.kpi_daily_evaluations;
CREATE POLICY "kpi_daily_evaluations_select" ON public.kpi_daily_evaluations
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

-- Không cấp INSERT/UPDATE/DELETE trực tiếp cho client — mọi thay đổi bắt buộc qua RPC
-- kpi_submit_daily_evaluation (SECURITY DEFINER) để đảm bảo `loai` luôn được tính đúng server-side
-- và upsert + thay items diễn ra atomic trong 1 transaction.

-- ══════════════════ 3. kpi_daily_evaluation_items ══════════════════
-- Có factory_id riêng (không chỉ suy qua evaluation_id) — tuân thủ invariant "mọi bảng đều có
-- factory_id" (mirror kpi_task_logs, lý do tương tự: tránh JOIN qua bảng cha mỗi lần lọc).
CREATE TABLE IF NOT EXISTS public.kpi_daily_evaluation_items (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id    UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  evaluation_id UUID NOT NULL REFERENCES public.kpi_daily_evaluations(id) ON DELETE CASCADE,
  criteria_id   UUID NOT NULL REFERENCES public.kpi_criteria_templates(id),
  ket_qua       TEXT NOT NULL CHECK (ket_qua IN ('dat', 'tuong_doi', 'chua_dat')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(evaluation_id, criteria_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_daily_evaluation_items_evaluation
  ON public.kpi_daily_evaluation_items(evaluation_id);

ALTER TABLE public.kpi_daily_evaluation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kpi_daily_evaluation_items_select" ON public.kpi_daily_evaluation_items;
CREATE POLICY "kpi_daily_evaluation_items_select" ON public.kpi_daily_evaluation_items
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

-- Cũng không cấp ghi trực tiếp — chỉ RPC kpi_submit_daily_evaluation được ghi (qua SECURITY
-- DEFINER, không đi qua RLS).

-- ══════════════ 4. RPC atomic kpi_submit_daily_evaluation ══════════════
-- p_items: JSONB array dạng [{"criteria_id": "uuid", "ket_qua": "dat"}, ...]
CREATE OR REPLACE FUNCTION public.kpi_submit_daily_evaluation(
  p_user_id UUID,
  p_ngay DATE,
  p_group_id UUID,
  p_ghi_chu TEXT,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_factory_id UUID;
  v_target_factory_id UUID;
  v_group_factory_id UUID;
  v_loai TEXT;
  v_eval_id UUID;
  v_item JSONB;
  v_criteria_id UUID;
  v_ket_qua TEXT;
  v_item_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;
  IF NOT public.current_profile_has_permission('kpi.evaluate') THEN
    RAISE EXCEPTION 'Bạn không có quyền chấm điểm chuyên môn.';
  END IF;

  SELECT factory_id INTO v_factory_id FROM public.profiles WHERE id = v_uid AND status = 'active';
  IF v_factory_id IS NULL THEN
    RAISE EXCEPTION 'Không xác định được nhà máy của tài khoản đang đăng nhập.';
  END IF;

  SELECT factory_id INTO v_target_factory_id FROM public.profiles WHERE id = p_user_id AND status = 'active';
  IF v_target_factory_id IS NULL OR v_target_factory_id <> v_factory_id THEN
    RAISE EXCEPTION 'Người được chấm không hợp lệ hoặc không cùng nhà máy.';
  END IF;

  SELECT factory_id INTO v_group_factory_id FROM public.personnel_groups WHERE id = p_group_id;
  IF v_group_factory_id IS NULL OR v_group_factory_id <> v_factory_id THEN
    RAISE EXCEPTION 'Nhóm chuyên môn không hợp lệ hoặc không cùng nhà máy.';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Vui lòng chấm ít nhất 1 tiêu chí.';
  END IF;

  -- Snapshot loai ('chinh'/'choang') tại đúng thời điểm chấm — không tin client tự khai.
  SELECT CASE WHEN pgm.group_id IS NOT NULL THEN 'chinh' ELSE 'choang' END INTO v_loai
  FROM public.maintenance_staff ms
  LEFT JOIN public.personnel_group_members pgm
    ON pgm.staff_id = ms.id AND pgm.group_id = p_group_id AND pgm.is_primary = true
  WHERE ms.profile_id = p_user_id AND ms.factory_id = v_factory_id
  LIMIT 1;
  IF v_loai IS NULL THEN
    v_loai := 'choang';
  END IF;

  INSERT INTO public.kpi_daily_evaluations (factory_id, user_id, ngay, group_id, loai, nguoi_cham_id, ghi_chu)
  VALUES (v_factory_id, p_user_id, p_ngay, p_group_id, v_loai, v_uid, NULLIF(trim(p_ghi_chu), ''))
  ON CONFLICT (factory_id, user_id, ngay, group_id)
  DO UPDATE SET loai = EXCLUDED.loai, nguoi_cham_id = EXCLUDED.nguoi_cham_id, ghi_chu = EXCLUDED.ghi_chu, updated_at = now()
  RETURNING id INTO v_eval_id;

  DELETE FROM public.kpi_daily_evaluation_items WHERE evaluation_id = v_eval_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_criteria_id := (v_item->>'criteria_id')::UUID;
    v_ket_qua := v_item->>'ket_qua';
    IF v_ket_qua NOT IN ('dat', 'tuong_doi', 'chua_dat') THEN
      RAISE EXCEPTION 'Kết quả chấm không hợp lệ: %', v_ket_qua;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.kpi_criteria_templates
      WHERE id = v_criteria_id AND group_id = p_group_id AND factory_id = v_factory_id
    ) THEN
      RAISE EXCEPTION 'Tiêu chí không thuộc đúng nhóm/nhà máy: %', v_criteria_id;
    END IF;
    INSERT INTO public.kpi_daily_evaluation_items (factory_id, evaluation_id, criteria_id, ket_qua)
    VALUES (v_factory_id, v_eval_id, v_criteria_id, v_ket_qua);
    v_item_count := v_item_count + 1;
  END LOOP;

  RETURN v_eval_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_submit_daily_evaluation(UUID, DATE, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_submit_daily_evaluation(UUID, DATE, UUID, TEXT, JSONB) TO authenticated;

-- ══════════════ 5. RPC xóa 1 lượt chấm (sửa sai hoàn toàn — chọn nhầm người/nhóm) ══════════════
CREATE OR REPLACE FUNCTION public.kpi_delete_daily_evaluation(p_evaluation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_factory_id UUID;
  v_eval_factory_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;
  IF NOT public.current_profile_has_permission('kpi.evaluate') THEN
    RAISE EXCEPTION 'Bạn không có quyền xóa lượt chấm điểm chuyên môn.';
  END IF;

  SELECT factory_id INTO v_factory_id FROM public.profiles WHERE id = v_uid AND status = 'active';
  SELECT factory_id INTO v_eval_factory_id FROM public.kpi_daily_evaluations WHERE id = p_evaluation_id;
  IF v_eval_factory_id IS NULL OR v_factory_id IS NULL OR v_eval_factory_id <> v_factory_id THEN
    RAISE EXCEPTION 'Không tìm thấy lượt chấm điểm này.';
  END IF;

  DELETE FROM public.kpi_daily_evaluations WHERE id = p_evaluation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_delete_daily_evaluation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_delete_daily_evaluation(UUID) TO authenticated;
