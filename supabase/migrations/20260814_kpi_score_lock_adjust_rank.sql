-- Module KPI — Phase 5 (khóa sổ, khiếu nại & minh bạch), theo đúng thứ tự đã liệt kê trong
-- .claude/rules/27-kpi-module.md mục "Liệt kê Phase 5":
--   1. Khóa sổ điểm tháng — RPC kpi_monthly_score_lock (nhap → da_khoa). Không có RPC "mở khóa":
--      một khi đã khóa, mọi thay đổi điểm PHẢI đi qua RPC #2 (có audit log) — nếu cho mở khóa tự
--      do rồi tính lại, sẽ lách hoàn toàn cơ chế audit này (kpi_compute_monthly_scores vẫn tự
--      động ghi đè bất kỳ điểm nào không phải 'da_khoa', xem WHERE trang_thai <> 'da_khoa' ở
--      20260813_kpi_score_weights_monthly_scores.sql).
--   2. kpi_score_adjustments — audit log bất biến (khác với kpi_5s_evaluations/kpi_appeals: có
--      thêm factory_id, theo đúng invariant "mọi bảng có factory_id" toàn repo, dù bản phác thảo
--      gốc trong rules file không liệt kê cột này). RPC kpi_monthly_score_adjust chỉ hoạt động
--      trên điểm ĐÃ 'da_khoa', mirror đúng kpi_5s_evaluation_correct (2026-08-02): p_appeal_id
--      có giá trị → đóng luôn khiếu nại đó; NULL → admin tự điều chỉnh trực tiếp, tự tạo 1 khiếu
--      nại "đã giải quyết" làm audit trail.
--   3. Nối kpi_appeals.monthly_score_id (cột đã có sẵn từ 20260731, dự phòng, chưa dùng) — thêm
--      nhánh RLS INSERT: chủ điểm tự khiếu nại được, CHỈ khi điểm đã 'da_khoa'.
--   4. 2 RPC xếp hạng ẩn danh (theo Nhóm chuyên môn / theo Phòng ban) — SECURITY DEFINER, trả về
--      {rank, diem_tong, is_me}, KHÔNG BAO GIỜ trả user_id hay tên — người xem không có
--      kpi.view_all vẫn xem được (RLS kpi_monthly_scores_select chỉ cho đọc điểm của chính mình,
--      nên client thường không tự query chéo được; RPC bypass RLS ở tầng SQL nhưng chỉ lộ đúng
--      rank+điểm, giữ đúng tinh thần "ẩn danh").
--   5. "Điểm tạm tính real-time" — đã làm sớm hơn lịch qua sub-tab "Chi tiết cách tính điểm" (xem
--      MyScoreExplain trong kpi/scores/page.tsx) — không có việc gì thêm ở đây.

-- ══════════════════ 1. Khóa sổ điểm tháng ══════════════════
CREATE OR REPLACE FUNCTION public.kpi_monthly_score_lock(p_monthly_score_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;
  IF NOT public.current_profile_has_permission('kpi.manage_config') THEN
    RAISE EXCEPTION 'Bạn không có quyền khóa sổ điểm KPI.';
  END IF;

  UPDATE public.kpi_monthly_scores
  SET trang_thai = 'da_khoa', khoa_boi = v_uid, khoa_luc = now(), updated_at = now()
  WHERE id = p_monthly_score_id AND trang_thai = 'nhap';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Điểm này không tồn tại hoặc đã được khóa từ trước.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_monthly_score_lock(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_monthly_score_lock(UUID) TO authenticated;

-- ══════════════════ 2. kpi_score_adjustments + RPC điều chỉnh ══════════════════
CREATE TABLE IF NOT EXISTS public.kpi_score_adjustments (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id            UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  monthly_score_id      UUID NOT NULL REFERENCES public.kpi_monthly_scores(id) ON DELETE CASCADE,
  ly_do                 TEXT NOT NULL,
  diem_truoc            NUMERIC,
  diem_sau              NUMERIC,
  nguoi_dieu_chinh_id   UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_score_adjustments_monthly_score ON public.kpi_score_adjustments(monthly_score_id);

ALTER TABLE public.kpi_score_adjustments ENABLE ROW LEVEL SECURITY;

-- Chỉ SELECT — giống hệt phạm vi xem kpi_monthly_scores gốc (chủ điểm/admin/kpi.view_all).
-- Không có INSERT/UPDATE/DELETE cho client — chỉ RPC kpi_monthly_score_adjust (SECURITY
-- DEFINER) mới ghi được, đảm bảo MỌI thay đổi điểm đã khóa đều để lại đúng 1 dòng audit.
DROP POLICY IF EXISTS "kpi_score_adjustments_select" ON public.kpi_score_adjustments;
CREATE POLICY "kpi_score_adjustments_select" ON public.kpi_score_adjustments
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.kpi_monthly_scores ms
      WHERE ms.id = monthly_score_id
        AND (
          ms.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
          OR public.current_profile_has_permission('kpi.view_all')
        )
    )
  );

-- p_appeal_id có giá trị: đang xử lý 1 khiếu nại điểm tháng có sẵn (trang_thai='cho_xu_ly') →
--   đóng luôn khiếu nại đó thành 'da_giai_quyet' trong cùng transaction.
-- p_appeal_id là NULL: admin tự điều chỉnh trực tiếp (không qua khiếu nại có sẵn) → tự tạo 1
--   dòng kpi_appeals mới, đã 'da_giai_quyet' ngay, làm audit trail duy nhất cho thao tác này.
CREATE OR REPLACE FUNCTION public.kpi_monthly_score_adjust(
  p_monthly_score_id UUID,
  p_new_diem_tong NUMERIC,
  p_ly_do TEXT,
  p_ghi_chu TEXT DEFAULT NULL,
  p_appeal_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_score RECORD;
  v_audit_text TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;
  IF NOT public.current_profile_has_permission('kpi.manage_config') THEN
    RAISE EXCEPTION 'Bạn không có quyền điều chỉnh điểm KPI.';
  END IF;
  IF p_ly_do IS NULL OR trim(p_ly_do) = '' THEN
    RAISE EXCEPTION 'Vui lòng nhập lý do điều chỉnh.';
  END IF;
  IF p_new_diem_tong IS NULL THEN
    RAISE EXCEPTION 'Vui lòng nhập điểm mới.';
  END IF;

  SELECT * INTO v_score FROM public.kpi_monthly_scores WHERE id = p_monthly_score_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy điểm tháng này.';
  END IF;
  IF v_score.trang_thai <> 'da_khoa' THEN
    RAISE EXCEPTION 'Chỉ được điều chỉnh điểm đã khóa sổ — hãy khóa sổ trước khi điều chỉnh.';
  END IF;

  v_audit_text := 'Đã điều chỉnh điểm tổng từ ' || COALESCE(v_score.diem_tong::text, '—')
    || ' thành ' || p_new_diem_tong::text || '. Lý do: ' || trim(p_ly_do);

  UPDATE public.kpi_monthly_scores
  SET diem_tong = p_new_diem_tong, updated_at = now()
  WHERE id = p_monthly_score_id;

  INSERT INTO public.kpi_score_adjustments (factory_id, monthly_score_id, ly_do, diem_truoc, diem_sau, nguoi_dieu_chinh_id)
  VALUES (v_score.factory_id, p_monthly_score_id, trim(p_ly_do), v_score.diem_tong, p_new_diem_tong, v_uid);

  IF p_appeal_id IS NOT NULL THEN
    UPDATE public.kpi_appeals
    SET trang_thai = 'da_giai_quyet',
        phan_hoi = trim(COALESCE(p_ghi_chu, '') || E'\n' || v_audit_text),
        nguoi_xu_ly_id = v_uid,
        updated_at = now()
    WHERE id = p_appeal_id
      AND monthly_score_id = p_monthly_score_id
      AND trang_thai = 'cho_xu_ly';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khiếu nại này không còn ở trạng thái chờ xử lý (có thể đã được xử lý bởi người khác).';
    END IF;
  ELSE
    INSERT INTO public.kpi_appeals (factory_id, monthly_score_id, nguoi_khieu_nai_id, noi_dung, trang_thai, phan_hoi, nguoi_xu_ly_id)
    VALUES (
      v_score.factory_id, p_monthly_score_id, v_uid,
      'Admin tự điều chỉnh điểm (không qua khiếu nại).',
      'da_giai_quyet',
      trim(COALESCE(p_ghi_chu, '') || E'\n' || v_audit_text),
      v_uid
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_monthly_score_adjust(UUID, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_monthly_score_adjust(UUID, NUMERIC, TEXT, TEXT, UUID) TO authenticated;

-- ══════════════════ 3. kpi_appeals — cho phép khiếu nại điểm tháng ĐÃ KHÓA ══════════════════
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
      OR (location_evaluation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.kpi_5s_evaluations e
        WHERE e.id = location_evaluation_id AND e.nguoi_don_id = auth.uid()
      ))
      OR (monthly_score_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.kpi_monthly_scores ms
        WHERE ms.id = monthly_score_id AND ms.user_id = auth.uid() AND ms.trang_thai = 'da_khoa'
      ))
    )
  );

-- ══════════════════ 4. Bảng xếp hạng ẩn danh (theo Nhóm chuyên môn / Phòng ban) ══════════════════
-- Cả 2 RPC chỉ trả {rank, diem_tong, is_me} — KHÔNG trả user_id/tên. Mọi user có kpi.view đều
-- gọi được (không cần kpi.view_all) vì mục đích chính là so sánh ẩn danh không lộ danh tính.
CREATE OR REPLACE FUNCTION public.kpi_score_ranking_by_group(
  p_factory_id UUID,
  p_nam INTEGER,
  p_thang INTEGER,
  p_group_id UUID
)
RETURNS TABLE(rank BIGINT, diem_tong NUMERIC, is_me BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;
  IF NOT public.current_profile_has_permission('kpi.view') THEN
    RAISE EXCEPTION 'Bạn không có quyền xem bảng điểm KPI.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.factory_id = p_factory_id) THEN
    RAISE EXCEPTION 'Nhóm không thuộc nhà máy của bạn.';
  END IF;

  RETURN QUERY
  WITH members AS (
    SELECT s.profile_id AS user_id
    FROM public.personnel_group_members m
    JOIN public.maintenance_staff s ON s.id = m.staff_id
    WHERE m.group_id = p_group_id
      AND m.is_primary = true
      AND s.factory_id = p_factory_id
      AND s.active IS DISTINCT FROM false
      AND s.profile_id IS NOT NULL
  ),
  scores AS (
    SELECT ms.user_id, ms.diem_tong
    FROM public.kpi_monthly_scores ms
    JOIN members me ON me.user_id = ms.user_id
    WHERE ms.factory_id = p_factory_id AND ms.nam = p_nam AND ms.thang = p_thang AND ms.diem_tong IS NOT NULL
  )
  SELECT RANK() OVER (ORDER BY sc.diem_tong DESC) AS rank, sc.diem_tong, (sc.user_id = v_uid) AS is_me
  FROM scores sc
  ORDER BY sc.diem_tong DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_score_ranking_by_group(UUID, INTEGER, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_score_ranking_by_group(UUID, INTEGER, INTEGER, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.kpi_score_ranking_by_department(
  p_factory_id UUID,
  p_nam INTEGER,
  p_thang INTEGER,
  p_department_id UUID
)
RETURNS TABLE(rank BIGINT, diem_tong NUMERIC, is_me BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;
  IF NOT public.current_profile_has_permission('kpi.view') THEN
    RAISE EXCEPTION 'Bạn không có quyền xem bảng điểm KPI.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.factory_id = p_factory_id) THEN
    RAISE EXCEPTION 'Phòng ban không thuộc nhà máy của bạn.';
  END IF;

  RETURN QUERY
  WITH dept AS (
    SELECT id, name, code FROM public.departments WHERE id = p_department_id
  ),
  members AS (
    SELECT p.id AS user_id
    FROM public.profiles p, dept d
    WHERE p.factory_id = p_factory_id
      AND p.status = 'active'
      AND (
        p.department_id = d.id
        OR (d.name IS NOT NULL AND p.department = d.name)
        OR (p.department IS NOT NULL AND d.code IS NOT NULL AND upper(p.department) = upper(d.code))
      )
  ),
  scores AS (
    SELECT ms.user_id, ms.diem_tong
    FROM public.kpi_monthly_scores ms
    JOIN members me ON me.user_id = ms.user_id
    WHERE ms.factory_id = p_factory_id AND ms.nam = p_nam AND ms.thang = p_thang AND ms.diem_tong IS NOT NULL
  )
  SELECT RANK() OVER (ORDER BY sc.diem_tong DESC) AS rank, sc.diem_tong, (sc.user_id = v_uid) AS is_me
  FROM scores sc
  ORDER BY sc.diem_tong DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_score_ranking_by_department(UUID, INTEGER, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_score_ranking_by_department(UUID, INTEGER, INTEGER, UUID) TO authenticated;
