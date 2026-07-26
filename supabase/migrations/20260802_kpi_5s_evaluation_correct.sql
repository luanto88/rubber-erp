-- Module KPI — sửa Bug 2: "Đã giải quyết" khiếu nại không sửa lại kết quả 5S gốc.
-- kpi_5s_evaluations vẫn giữ nguyên tắc bất biến cho luồng bình thường (không có RLS UPDATE
-- cho client) — RPC này là NGOẠI LỆ DUY NHẤT, chỉ cho admin/kpi.manage_config, luôn ghi audit
-- vào kpi_appeals (không thêm cột mới). Xem đầy đủ .claude/rules/27-kpi-module.md.
--
-- Chạy SAU 20260803_kpi_5s_result_tuong_doi.sql — RPC không hard-code danh sách giá trị hợp lệ,
-- CHECK constraint của bảng tự validate p_new_ket_qua theo đúng 3 mức hiện hành.
--
-- p_appeal_id có giá trị: đang xử lý 1 khiếu nại có sẵn (trang_thai='cho_xu_ly') → đóng luôn
--   khiếu nại đó thành 'da_giai_quyet' trong cùng transaction.
-- p_appeal_id là NULL: admin tự sửa trực tiếp, không qua khiếu nại có sẵn (case "người chấm tự
--   phát hiện chấm sai") → tự tạo 1 dòng kpi_appeals mới, đã 'da_giai_quyet' ngay, làm audit
--   trail duy nhất cho thao tác này.

CREATE OR REPLACE FUNCTION public.kpi_5s_evaluation_correct(
  p_zone_evaluation_id UUID,
  p_new_ket_qua TEXT,
  p_new_ly_do TEXT,
  p_ghi_chu TEXT,
  p_appeal_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_eval RECORD;
  v_is_admin BOOLEAN;
  v_has_perm BOOLEAN;
  v_old_label TEXT;
  v_new_label TEXT;
  v_audit_text TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;

  SELECT (role = 'admin') INTO v_is_admin FROM public.profiles WHERE id = v_uid;
  v_has_perm := public.current_profile_has_permission('kpi.manage_config');
  IF NOT (COALESCE(v_is_admin, false) OR v_has_perm) THEN
    RAISE EXCEPTION 'Chỉ admin hoặc người quản trị KPI mới được sửa kết quả 5S.';
  END IF;

  SELECT * INTO v_eval FROM public.kpi_5s_evaluations WHERE id = p_zone_evaluation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy lần chấm điểm này.';
  END IF;

  IF p_new_ket_qua IS NULL OR trim(p_new_ket_qua) = '' THEN
    RAISE EXCEPTION 'Vui lòng chọn kết quả.';
  END IF;
  IF p_new_ket_qua <> 'dat' AND (p_new_ly_do IS NULL OR trim(p_new_ly_do) = '') THEN
    RAISE EXCEPTION 'Vui lòng nhập lý do khi kết quả không phải Đạt.';
  END IF;

  v_old_label := CASE v_eval.ket_qua
    WHEN 'dat' THEN 'Đạt' WHEN 'tuong_doi' THEN 'Tương đối' WHEN 'khong_dat' THEN 'Không đạt'
    ELSE v_eval.ket_qua END;
  v_new_label := CASE p_new_ket_qua
    WHEN 'dat' THEN 'Đạt' WHEN 'tuong_doi' THEN 'Tương đối' WHEN 'khong_dat' THEN 'Không đạt'
    ELSE p_new_ket_qua END;
  v_audit_text := CASE WHEN v_eval.ket_qua = p_new_ket_qua
    THEN 'Giữ nguyên kết quả gốc: ' || v_old_label || '.'
    ELSE 'Đã đổi kết quả từ "' || v_old_label || '" sang "' || v_new_label || '".' END;

  UPDATE public.kpi_5s_evaluations
  SET ket_qua = p_new_ket_qua, ly_do = NULLIF(trim(p_new_ly_do), '')
  WHERE id = p_zone_evaluation_id;

  IF p_appeal_id IS NOT NULL THEN
    UPDATE public.kpi_appeals
    SET trang_thai = 'da_giai_quyet',
        phan_hoi = trim(COALESCE(p_ghi_chu, '') || E'\n' || v_audit_text),
        nguoi_xu_ly_id = v_uid,
        updated_at = now()
    WHERE id = p_appeal_id
      AND zone_evaluation_id = p_zone_evaluation_id
      AND trang_thai = 'cho_xu_ly';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khiếu nại này không còn ở trạng thái chờ xử lý (có thể đã được xử lý bởi người khác).';
    END IF;
  ELSE
    INSERT INTO public.kpi_appeals (factory_id, zone_evaluation_id, nguoi_khieu_nai_id, noi_dung, trang_thai, phan_hoi, nguoi_xu_ly_id)
    VALUES (
      v_eval.factory_id, p_zone_evaluation_id, v_uid,
      'Admin tự sửa kết quả (không qua khiếu nại).',
      'da_giai_quyet',
      trim(COALESCE(p_ghi_chu, '') || E'\n' || v_audit_text),
      v_uid
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_5s_evaluation_correct(UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_5s_evaluation_correct(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated;
