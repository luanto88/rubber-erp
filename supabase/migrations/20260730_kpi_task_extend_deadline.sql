-- Module KPI — "Gia hạn" (đổi hạn hoàn thành công việc). Xem đầy đủ
-- .claude/rules/27-kpi-module.md, mục "Cập nhật — Phân công thông minh + Gia hạn + Khiếu nại".

ALTER TABLE public.kpi_task_logs DROP CONSTRAINT IF EXISTS kpi_task_logs_hanh_dong_check;
ALTER TABLE public.kpi_task_logs ADD CONSTRAINT kpi_task_logs_hanh_dong_check
  CHECK (hanh_dong IN ('cap_nhat_tien_do', 'nop', 'nghiem_thu', 'dieu_chinh', 'tra_ve', 'yeu_cau_bo_sung', 'gan_ban_ghi', 'chuyen_giao', 'gia_han'));

-- Chỉ người giao việc (nguoi_giao_id) hoặc admin mới đổi được hạn hoàn thành. Ghi 1 dòng log cho
-- MỖI thành viên active (không chỉ 1 dòng chung) vì hạn đổi ảnh hưởng trực tiếp tới toàn bộ
-- người đang thực hiện — mỗi người cần thấy sự kiện này trong dòng thời gian của chính họ.
CREATE OR REPLACE FUNCTION public.kpi_task_extend_deadline(
  p_task_id UUID,
  p_new_han_hoan_thanh TIMESTAMPTZ,
  p_ly_do TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_task RECORD;
  v_is_admin BOOLEAN;
  v_old TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;

  SELECT * INTO v_task FROM public.kpi_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy công việc.';
  END IF;
  IF v_task.trang_thai IN ('hoan_thanh', 'huy') THEN
    RAISE EXCEPTION 'Công việc đã kết thúc, không thể đổi hạn.';
  END IF;

  SELECT (role = 'admin') INTO v_is_admin FROM public.profiles WHERE id = v_uid;
  IF NOT (COALESCE(v_is_admin, false) OR v_task.nguoi_giao_id = v_uid) THEN
    RAISE EXCEPTION 'Chỉ người giao việc mới được đổi hạn hoàn thành.';
  END IF;

  IF p_ly_do IS NULL OR trim(p_ly_do) = '' THEN
    RAISE EXCEPTION 'Vui lòng nhập lý do đổi hạn.';
  END IF;
  IF p_new_han_hoan_thanh IS NULL THEN
    RAISE EXCEPTION 'Vui lòng chọn hạn hoàn thành mới.';
  END IF;

  v_old := v_task.han_hoan_thanh;
  UPDATE public.kpi_tasks SET han_hoan_thanh = p_new_han_hoan_thanh, updated_at = now() WHERE id = p_task_id;

  INSERT INTO public.kpi_task_logs (task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong, noi_dung)
  SELECT
    p_task_id, v_task.factory_id, m.user_id, v_uid, 'gia_han',
    'Hạn cũ: ' || to_char(v_old, 'DD/MM/YYYY HH24:MI') ||
    ' → Hạn mới: ' || to_char(p_new_han_hoan_thanh, 'DD/MM/YYYY HH24:MI') ||
    '. Lý do: ' || p_ly_do
  FROM public.kpi_task_members m
  WHERE m.task_id = p_task_id AND m.is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_task_extend_deadline(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_task_extend_deadline(UUID, TIMESTAMPTZ, TEXT) TO authenticated;
