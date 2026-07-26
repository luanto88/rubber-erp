-- Module KPI — Khiếu nại (kpi_appeals), tối giản đủ dùng: khiếu nại gắn với 1 công việc HOẶC 1
-- lần chấm điểm 5S. Không phụ thuộc kpi_monthly_scores (Phase 3/4 chưa build) — cột
-- monthly_score_id giữ trong schema cho tương lai nhưng KHÔNG dùng ở phiên bản này.
-- Xem .claude/rules/27-kpi-module.md, mục "Cập nhật — Phân công thông minh + Gia hạn + Khiếu nại".

CREATE TABLE IF NOT EXISTS public.kpi_appeals (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id          UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  monthly_score_id    UUID,  -- dự phòng Phase 5, chưa dùng
  task_id             UUID REFERENCES public.kpi_tasks(id) ON DELETE CASCADE,
  zone_evaluation_id  UUID REFERENCES public.kpi_5s_evaluations(id) ON DELETE CASCADE,
  nguoi_khieu_nai_id  UUID NOT NULL REFERENCES auth.users(id),
  noi_dung            TEXT NOT NULL,
  trang_thai          TEXT NOT NULL DEFAULT 'cho_xu_ly' CHECK (trang_thai IN ('cho_xu_ly', 'da_giai_quyet', 'tu_choi')),
  phan_hoi            TEXT,
  nguoi_xu_ly_id      UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (task_id IS NOT NULL OR zone_evaluation_id IS NOT NULL OR monthly_score_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_kpi_appeals_factory_status ON public.kpi_appeals(factory_id, trang_thai);
CREATE INDEX IF NOT EXISTS idx_kpi_appeals_nguoi_khieu_nai ON public.kpi_appeals(nguoi_khieu_nai_id);

ALTER TABLE public.kpi_appeals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kpi_appeals_select" ON public.kpi_appeals;
CREATE POLICY "kpi_appeals_select" ON public.kpi_appeals
  FOR SELECT USING (
    nguoi_khieu_nai_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR public.current_profile_has_permission('kpi.manage_config')
  );

-- Chỉ người THỰC SỰ liên quan mới khiếu nại được — thành viên/người giao của task, hoặc
-- người dọn/người chấm của ĐÚNG lần chấm 5S đó — tránh spam khiếu nại không liên quan.
DROP POLICY IF EXISTS "kpi_appeals_insert" ON public.kpi_appeals;
CREATE POLICY "kpi_appeals_insert" ON public.kpi_appeals
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND nguoi_khieu_nai_id = auth.uid()
    AND (
      (task_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.kpi_tasks t
        WHERE t.id = task_id AND (
          t.nguoi_giao_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.kpi_task_members m WHERE m.task_id = t.id AND m.user_id = auth.uid())
        )
      ))
      OR (zone_evaluation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.kpi_5s_evaluations e
        WHERE e.id = zone_evaluation_id AND (e.nguoi_don_id = auth.uid() OR e.nguoi_cham_id = auth.uid())
      ))
    )
  );

-- Chỉ admin/kpi.manage_config được xử lý (đổi trạng thái + phản hồi) — người khiếu nại không
-- tự sửa lại nội dung sau khi đã gửi (giữ đúng bản chất "log", tránh sửa đổi sau khi tranh chấp).
DROP POLICY IF EXISTS "kpi_appeals_update" ON public.kpi_appeals;
CREATE POLICY "kpi_appeals_update" ON public.kpi_appeals
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR public.current_profile_has_permission('kpi.manage_config')
  );

DROP TRIGGER IF EXISTS trg_kpi_appeals_updated_at ON public.kpi_appeals;
CREATE TRIGGER trg_kpi_appeals_updated_at
  BEFORE UPDATE ON public.kpi_appeals
  FOR EACH ROW EXECUTE FUNCTION public.kpi_tasks_set_updated_at();
