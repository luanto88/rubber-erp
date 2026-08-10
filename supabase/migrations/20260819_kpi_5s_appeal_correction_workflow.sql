-- Khiếu nại 5S — quy trình 3 bước theo đúng yêu cầu người dùng (2026-08-19):
--   (1) người BỊ chấm (nguoi_don_id) nộp khiếu nại — KHÔNG đổi, vẫn như cũ (20260801 fix).
--   (2) NGƯỜI CHẤM (nguoi_cham_id của đúng lần chấm đó) đề xuất kết quả sửa lại — MỚI, trước đây
--       chỉ admin/kpi.manage_config được sửa trực tiếp (kpi_5s_evaluation_correct), người chấm
--       hoàn toàn không có cách nào tự đề xuất sửa lỗi của chính mình.
--   (3) LÃNH ĐẠO PHÒNG BAN của vị trí đó (kpi_is_department_leader, mirror
--       20260807_kpi_department_scoping.sql) HOẶC admin/kpi.manage_config duyệt/từ chối đề xuất —
--       chỉ khi DUYỆT mới thực sự ghi đè kpi_5s_evaluations.ket_qua/ly_do.
-- Không đổi luồng khiếu nại của kpi_tasks (task_id) hay kpi_monthly_scores — chỉ áp dụng riêng
-- cho location_evaluation_id. Cơ chế cũ (kpi_5s_evaluation_correct, admin/kpi.manage_config sửa
-- trực tiếp không qua khiếu nại) GIỮ NGUYÊN không đổi — đây là đường TẮT dành cho admin, độc lập
-- với quy trình 3 bước mới.

ALTER TABLE public.kpi_appeals
  ADD COLUMN IF NOT EXISTS proposed_ket_qua TEXT,
  ADD COLUMN IF NOT EXISTS proposed_ly_do TEXT,
  ADD COLUMN IF NOT EXISTS proposed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ;

ALTER TABLE public.kpi_appeals DROP CONSTRAINT IF EXISTS kpi_appeals_trang_thai_check;
ALTER TABLE public.kpi_appeals ADD CONSTRAINT kpi_appeals_trang_thai_check
  CHECK (trang_thai IN ('cho_xu_ly', 'cho_duyet_sua', 'da_giai_quyet', 'tu_choi'));

ALTER TABLE public.kpi_appeals DROP CONSTRAINT IF EXISTS kpi_appeals_proposed_ket_qua_check;
ALTER TABLE public.kpi_appeals ADD CONSTRAINT kpi_appeals_proposed_ket_qua_check
  CHECK (proposed_ket_qua IS NULL OR proposed_ket_qua IN ('dat', 'tuong_doi', 'khong_dat'));

-- Mở rộng SELECT: người CHẤM (nguoi_cham_id) của đúng lần chấm phải thấy được khiếu nại để biết
-- cần đề xuất sửa; lãnh đạo phòng ban của vị trí đó phải thấy được để duyệt — trước đây chỉ chủ
-- khiếu nại (nguoi_don_id)/admin/kpi.manage_config mới đọc được.
DROP POLICY IF EXISTS "kpi_appeals_select" ON public.kpi_appeals;
CREATE POLICY "kpi_appeals_select" ON public.kpi_appeals
  FOR SELECT USING (
    nguoi_khieu_nai_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR public.current_profile_has_permission('kpi.manage_config')
    OR (
      location_evaluation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.kpi_5s_evaluations e
        WHERE e.id = location_evaluation_id AND e.nguoi_cham_id = auth.uid()
      )
    )
    OR (
      location_evaluation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.kpi_5s_evaluations e
        JOIN public.kpi_5s_locations l ON l.id = e.location_id
        WHERE e.id = location_evaluation_id
          AND l.phong_ban_id IS NOT NULL
          AND public.kpi_is_department_leader(auth.uid(), l.phong_ban_id)
      )
    )
  );

-- Bước 2 — người chấm đề xuất sửa kết quả (chỉ khi khiếu nại đang 'cho_xu_ly').
CREATE OR REPLACE FUNCTION public.kpi_appeal_propose_correction(
  p_appeal_id UUID, p_new_ket_qua TEXT, p_new_ly_do TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_appeal RECORD;
  v_eval RECORD;
BEGIN
  SELECT * INTO v_appeal FROM public.kpi_appeals WHERE id = p_appeal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy khiếu nại.';
  END IF;
  IF v_appeal.location_evaluation_id IS NULL THEN
    RAISE EXCEPTION 'Chỉ áp dụng cho khiếu nại về lần chấm điểm 5S.';
  END IF;
  IF v_appeal.trang_thai <> 'cho_xu_ly' THEN
    RAISE EXCEPTION 'Khiếu nại này không còn ở trạng thái chờ xử lý.';
  END IF;

  SELECT * INTO v_eval FROM public.kpi_5s_evaluations WHERE id = v_appeal.location_evaluation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy lần chấm điểm liên quan.';
  END IF;
  IF v_eval.nguoi_cham_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ người đã chấm lần này mới được đề xuất sửa kết quả.';
  END IF;
  IF p_new_ket_qua NOT IN ('dat', 'tuong_doi', 'khong_dat') THEN
    RAISE EXCEPTION 'Kết quả không hợp lệ.';
  END IF;
  IF p_new_ket_qua <> 'dat' AND coalesce(trim(p_new_ly_do), '') = '' THEN
    RAISE EXCEPTION 'Vui lòng nhập lý do khi kết quả khác Đạt.';
  END IF;

  UPDATE public.kpi_appeals
  SET proposed_ket_qua = p_new_ket_qua,
      proposed_ly_do = NULLIF(trim(p_new_ly_do), ''),
      proposed_by = auth.uid(),
      proposed_at = now(),
      trang_thai = 'cho_duyet_sua'
  WHERE id = p_appeal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_appeal_propose_correction(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_appeal_propose_correction(UUID, TEXT, TEXT) TO authenticated;

-- Bước 3 — lãnh đạo phòng ban của vị trí (hoặc admin/kpi.manage_config) duyệt/từ chối đề xuất.
-- Chỉ khi p_approve=true mới thực sự ghi đè kpi_5s_evaluations; từ chối chỉ đóng khiếu nại,
-- không đụng gì tới kết quả gốc.
CREATE OR REPLACE FUNCTION public.kpi_appeal_decide_correction(
  p_appeal_id UUID, p_approve BOOLEAN, p_ghi_chu TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_appeal RECORD;
  v_eval RECORD;
  v_location RECORD;
  v_can_decide BOOLEAN;
BEGIN
  SELECT * INTO v_appeal FROM public.kpi_appeals WHERE id = p_appeal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy khiếu nại.';
  END IF;
  IF v_appeal.trang_thai <> 'cho_duyet_sua' THEN
    RAISE EXCEPTION 'Khiếu nại này chưa có đề xuất sửa kết quả để duyệt.';
  END IF;

  SELECT * INTO v_eval FROM public.kpi_5s_evaluations WHERE id = v_appeal.location_evaluation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy lần chấm điểm liên quan.';
  END IF;
  SELECT * INTO v_location FROM public.kpi_5s_locations WHERE id = v_eval.location_id;

  v_can_decide := EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR public.current_profile_has_permission('kpi.manage_config')
    OR (v_location.phong_ban_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), v_location.phong_ban_id));
  IF NOT v_can_decide THEN
    RAISE EXCEPTION 'Bạn không có quyền duyệt đề xuất sửa kết quả này.';
  END IF;

  IF p_approve THEN
    UPDATE public.kpi_5s_evaluations
    SET ket_qua = v_appeal.proposed_ket_qua, ly_do = v_appeal.proposed_ly_do
    WHERE id = v_appeal.location_evaluation_id;
    UPDATE public.kpi_appeals
    SET trang_thai = 'da_giai_quyet', phan_hoi = NULLIF(trim(p_ghi_chu), ''), nguoi_xu_ly_id = auth.uid()
    WHERE id = p_appeal_id;
  ELSE
    UPDATE public.kpi_appeals
    SET trang_thai = 'tu_choi', phan_hoi = NULLIF(trim(p_ghi_chu), ''), nguoi_xu_ly_id = auth.uid()
    WHERE id = p_appeal_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_appeal_decide_correction(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_appeal_decide_correction(UUID, BOOLEAN, TEXT) TO authenticated;
