-- Module KPI — sửa Bug 1: người CHẤM điểm (nguoi_cham_id) không được khiếu nại về chính lần
-- chấm do họ tạo ra — chỉ người BỊ chấm (nguoi_don_id) mới hợp lý khiếu nại. Trước đó
-- 20260731_kpi_appeals.sql cho phép cả 2 vai trò insert. Nhánh task_id giữ nguyên, không đụng.
-- Xem đầy đủ .claude/rules/27-kpi-module.md.

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
        WHERE e.id = zone_evaluation_id AND e.nguoi_don_id = auth.uid()
      ))
    )
  );
