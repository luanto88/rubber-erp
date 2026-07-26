-- Module KPI — Việc định kỳ theo nhóm (kpi_task_templates) + Người thay thế tạm thời
-- (kpi_user_substitutions). Xem đầy đủ kiến trúc/roadmap tại .claude/rules/27-kpi-module.md.
--
-- Lệch có chủ đích so với thiết kế phác thảo ban đầu (đã ghi lại trong plan cũ):
-- KHÔNG có cột `auto_action_type` — mục "Tự động hoàn thành khi có thao tác nghiệp vụ khớp"
-- đã bị loại bỏ hoàn toàn khỏi thiết kế module (thay bằng "Gắn bản ghi tại chỗ", Phase 1a.1,
-- xem 20260725_kpi_task_evidence_links.sql). Task sinh từ template hoạt động HỆT như task tạo
-- tay một-lần — người phụ trách tự thao tác ở đúng module nghiệp vụ rồi bấm "Gắn & hoàn
-- thành" ở banner xuất hiện sau khi lưu (KpiLinkPrompt đã tự động tìm mọi task đang mở của họ,
-- không phân biệt có phải sinh từ template hay không) — không cần thêm cơ chế tự động riêng.

-- ── 1. kpi_task_templates ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kpi_task_templates (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id        UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  group_id          UUID NOT NULL REFERENCES public.personnel_groups(id),
  assigned_user_id  UUID NOT NULL REFERENCES auth.users(id),
  tieu_de           TEXT NOT NULL,
  mo_ta             TEXT,
  apply_weekdays    INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  gio_han           TIME NOT NULL DEFAULT '17:00',
  yeu_cau_bao_cao   TEXT[] NOT NULL DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID NOT NULL REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_task_templates_factory_active ON public.kpi_task_templates(factory_id, is_active);

ALTER TABLE public.kpi_task_templates ENABLE ROW LEVEL SECURITY;

-- Đọc rộng trong factory (danh sách "việc định kỳ" là thông tin minh bạch cho mọi người, mirror
-- cách kpi_score_weights/kpi_criteria_templates dự kiến sẽ đọc rộng ở Phase 3/4).
DROP POLICY IF EXISTS "kpi_task_templates_select" ON public.kpi_task_templates;
CREATE POLICY "kpi_task_templates_select" ON public.kpi_task_templates
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "kpi_task_templates_insert" ON public.kpi_task_templates;
CREATE POLICY "kpi_task_templates_insert" ON public.kpi_task_templates
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP POLICY IF EXISTS "kpi_task_templates_update" ON public.kpi_task_templates;
CREATE POLICY "kpi_task_templates_update" ON public.kpi_task_templates
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP POLICY IF EXISTS "kpi_task_templates_delete" ON public.kpi_task_templates;
CREATE POLICY "kpi_task_templates_delete" ON public.kpi_task_templates
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP TRIGGER IF EXISTS trg_kpi_task_templates_updated_at ON public.kpi_task_templates;
CREATE TRIGGER trg_kpi_task_templates_updated_at
  BEFORE UPDATE ON public.kpi_task_templates
  FOR EACH ROW EXECUTE FUNCTION public.kpi_tasks_set_updated_at();

-- ── 2. kpi_user_substitutions — người thay thế tạm thời (trả lời "về tua thì sao") ──────────
CREATE TABLE IF NOT EXISTS public.kpi_user_substitutions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id          UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  original_user_id    UUID NOT NULL REFERENCES auth.users(id),
  substitute_user_id  UUID NOT NULL REFERENCES auth.users(id),
  -- NULL = áp dụng cho TẤT CẢ việc định kỳ đang giao cho original_user_id trong khoảng ngày
  -- này; có giá trị = chỉ áp dụng cho đúng 1 việc định kỳ đó.
  template_id         UUID REFERENCES public.kpi_task_templates(id) ON DELETE CASCADE,
  tu_ngay             DATE NOT NULL,
  den_ngay            DATE NOT NULL,
  ly_do               TEXT,
  created_by          UUID NOT NULL REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (den_ngay >= tu_ngay),
  CHECK (original_user_id <> substitute_user_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_user_substitutions_lookup
  ON public.kpi_user_substitutions(factory_id, original_user_id, tu_ngay, den_ngay);

ALTER TABLE public.kpi_user_substitutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kpi_user_substitutions_select" ON public.kpi_user_substitutions;
CREATE POLICY "kpi_user_substitutions_select" ON public.kpi_user_substitutions
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      original_user_id = auth.uid()
      OR substitute_user_id = auth.uid()
      OR created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR public.current_profile_has_permission('kpi.view_all')
    )
  );

-- Tự đăng ký nghỉ (original_user_id = chính mình) hoặc admin/kpi.assign đăng ký hộ.
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

-- Hủy đăng ký (về sớm hơn dự kiến): người đi vắng, người đã tạo hộ, hoặc admin.
DROP POLICY IF EXISTS "kpi_user_substitutions_delete" ON public.kpi_user_substitutions;
CREATE POLICY "kpi_user_substitutions_delete" ON public.kpi_user_substitutions
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      original_user_id = auth.uid()
      OR created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- ── 3. kpi_tasks.template_id — liên kết ngược tới template đã sinh ra task này ──────────────
ALTER TABLE public.kpi_tasks
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.kpi_task_templates(id) ON DELETE SET NULL;

-- Chặn sinh trùng: mỗi template chỉ được sinh đúng 1 task/ngày. ON DELETE SET NULL ở trên (thay
-- vì CASCADE) để xóa template không xóa mất lịch sử task/log đã phát sinh từ nó.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_kpi_tasks_template_day
  ON public.kpi_tasks(template_id, ngay_giao) WHERE template_id IS NOT NULL;

-- ── 4. RPC "sinh lười" — gọi 1 lần/phiên/ngày từ bootstrap, không cần Vercel Cron thật ──────
-- Bất kỳ profile active nào của đúng nhà máy cũng gọi được (không cần quyền đặc biệt — đây là
-- thao tác "hộ hệ thống", không phải giao việc thật do người gọi tự quyết định nội dung).
CREATE OR REPLACE FUNCTION public.kpi_ensure_today_task_instances(p_factory_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_today DATE := CURRENT_DATE;
  v_dow INTEGER := EXTRACT(ISODOW FROM CURRENT_DATE)::INTEGER;
  v_tpl RECORD;
  v_final_user UUID;
  v_group_of_final UUID;
  v_phan_loai TEXT;
  v_prefix TEXT;
  v_seq INTEGER;
  v_ma TEXT;
  v_task_id UUID;
  v_created INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_uid AND factory_id = p_factory_id AND status = 'active'
  ) THEN
    RETURN 0;
  END IF;

  v_prefix := 'CV-' || to_char(v_today, 'DDMMYY');

  FOR v_tpl IN
    SELECT * FROM public.kpi_task_templates
    WHERE factory_id = p_factory_id AND is_active = true AND v_dow = ANY(apply_weekdays)
  LOOP
    IF EXISTS (SELECT 1 FROM public.kpi_tasks WHERE template_id = v_tpl.id AND ngay_giao = v_today) THEN
      CONTINUE;
    END IF;

    -- Resolve người thay thế tạm thời — ưu tiên dòng khớp đúng template_id cụ thể hơn dòng
    -- NULL (áp dụng chung mọi việc định kỳ của người đó).
    SELECT substitute_user_id INTO v_final_user
    FROM public.kpi_user_substitutions
    WHERE original_user_id = v_tpl.assigned_user_id
      AND factory_id = p_factory_id
      AND tu_ngay <= v_today AND den_ngay >= v_today
      AND (template_id IS NULL OR template_id = v_tpl.id)
    ORDER BY (template_id IS NOT NULL) DESC
    LIMIT 1;

    IF v_final_user IS NULL THEN
      v_final_user := v_tpl.assigned_user_id;
    END IF;

    -- phan_loai (chính/choàng) theo nhóm CHÍNH hiện tại của người CUỐI CÙNG nhận việc (người
    -- thay thế nếu có — đúng người thực sự làm việc hôm nay).
    SELECT pgm.group_id INTO v_group_of_final
    FROM public.maintenance_staff ms
    JOIN public.personnel_group_members pgm ON pgm.staff_id = ms.id AND pgm.is_primary = true
    WHERE ms.profile_id = v_final_user AND ms.factory_id = p_factory_id
    LIMIT 1;

    v_phan_loai := CASE WHEN v_group_of_final IS NOT NULL AND v_group_of_final = v_tpl.group_id THEN 'chinh' ELSE 'choang' END;

    SELECT count(*) INTO v_seq FROM public.kpi_tasks
      WHERE factory_id = p_factory_id AND ma_cong_viec LIKE v_prefix || '/%';
    v_ma := v_prefix || '/' || lpad((v_seq + 1)::text, 3, '0');

    INSERT INTO public.kpi_tasks (
      factory_id, ma_cong_viec, tieu_de, mo_ta, nguoi_giao_id, ngay_giao, han_hoan_thanh,
      yeu_cau_bao_cao, template_id
    ) VALUES (
      p_factory_id, v_ma, v_tpl.tieu_de, v_tpl.mo_ta, v_tpl.created_by, v_today,
      (v_today + v_tpl.gio_han)::timestamptz, v_tpl.yeu_cau_bao_cao, v_tpl.id
    )
    RETURNING id INTO v_task_id;

    INSERT INTO public.kpi_task_members (task_id, factory_id, user_id, phan_loai)
      VALUES (v_task_id, p_factory_id, v_final_user, v_phan_loai);

    v_created := v_created + 1;
  END LOOP;

  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_ensure_today_task_instances(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_ensure_today_task_instances(UUID) TO authenticated;
