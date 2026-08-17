-- Module KPI & 5S — Bắt buộc bằng chứng theo yêu cầu báo cáo (kpi_tasks.yeu_cau_bao_cao) khi
-- thành viên bấm "Nộp" (p_hanh_dong = 'nop'). Xem đầy đủ .claude/rules/27-kpi-module.md, mục
-- "Kế hoạch phiên sau (2026-08-XX) — 3 cải tiến sau khi dùng thử thực tế" → mục B.
--
-- Trước đây RPC kpi_task_member_update hoàn toàn không đọc yeu_cau_bao_cao — thành viên bấm
-- "Nộp" dù thiếu ảnh/file/định vị/nội dung văn bản đã yêu cầu vẫn thành công bình thường.
--
-- Quyết định đã chốt:
-- 1. "Văn bản" (van_ban) dùng field p_noi_dung có sẵn (không thêm field mới).
-- 2. Chặn cứng CHỈ áp dụng khi p_hanh_dong='nop' — "Cập nhật tiến độ" (cap_nhat_tien_do) vẫn cho
--    lưu dù thiếu bằng chứng (để thành viên lưu nháp giữa chừng).
--
-- Giữ nguyên chữ ký hàm (9 tham số) — không cần DROP FUNCTION.

CREATE OR REPLACE FUNCTION public.kpi_task_member_update(
  p_task_id UUID,
  p_hanh_dong TEXT,
  p_tien_do INTEGER,
  p_noi_dung TEXT DEFAULT NULL,
  p_image_urls TEXT[] DEFAULT '{}',
  p_file_urls TEXT[] DEFAULT '{}',
  p_vi_do NUMERIC DEFAULT NULL,
  p_kinh_do NUMERIC DEFAULT NULL,
  p_dia_diem_text TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_task RECORD;
  v_member RECORD;
  v_prev INTEGER;
  v_missing TEXT[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
  END IF;
  IF p_hanh_dong NOT IN ('cap_nhat_tien_do', 'nop') THEN
    RAISE EXCEPTION 'Hành động không hợp lệ: %', p_hanh_dong;
  END IF;
  IF p_tien_do IS NULL OR p_tien_do < 0 OR p_tien_do > 100 THEN
    RAISE EXCEPTION 'Tiến độ phải trong khoảng 0-100.';
  END IF;
  IF p_hanh_dong = 'cap_nhat_tien_do' AND (p_noi_dung IS NULL OR trim(p_noi_dung) = '') THEN
    RAISE EXCEPTION 'Vui lòng mô tả nội dung đã thực hiện.';
  END IF;

  SELECT * INTO v_task FROM public.kpi_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy công việc.';
  END IF;
  IF v_task.trang_thai IN ('hoan_thanh', 'huy') THEN
    RAISE EXCEPTION 'Công việc đã kết thúc, không thể cập nhật.';
  END IF;

  IF p_hanh_dong = 'nop' THEN
    IF 'anh' = ANY(v_task.yeu_cau_bao_cao) AND COALESCE(array_length(p_image_urls, 1), 0) = 0 THEN
      v_missing := array_append(v_missing, 'Ảnh');
    END IF;
    IF 'file' = ANY(v_task.yeu_cau_bao_cao) AND COALESCE(array_length(p_file_urls, 1), 0) = 0 THEN
      v_missing := array_append(v_missing, 'File');
    END IF;
    IF 'dinh_vi' = ANY(v_task.yeu_cau_bao_cao) AND p_vi_do IS NULL THEN
      v_missing := array_append(v_missing, 'Định vị');
    END IF;
    IF 'van_ban' = ANY(v_task.yeu_cau_bao_cao) AND (p_noi_dung IS NULL OR trim(p_noi_dung) = '') THEN
      v_missing := array_append(v_missing, 'Văn bản');
    END IF;
    IF array_length(v_missing, 1) > 0 THEN
      RAISE EXCEPTION 'Công việc yêu cầu kèm theo: % — vui lòng bổ sung trước khi nộp.', array_to_string(v_missing, ', ');
    END IF;
  END IF;

  SELECT * INTO v_member FROM public.kpi_task_members
    WHERE task_id = p_task_id AND user_id = v_uid AND is_active = true
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bạn không phải người đang phụ trách công việc này.';
  END IF;

  v_prev := v_member.tien_do;

  UPDATE public.kpi_task_members
    SET tien_do = p_tien_do,
        da_nop_luc = CASE WHEN p_hanh_dong = 'nop' AND da_nop_luc IS NULL THEN now() ELSE da_nop_luc END,
        updated_at = now()
    WHERE id = v_member.id;

  INSERT INTO public.kpi_task_logs (
    task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong,
    tien_do_truoc, tien_do_sau, noi_dung, image_urls, file_urls, vi_do, kinh_do, dia_diem_text
  ) VALUES (
    p_task_id, v_task.factory_id, v_uid, v_uid, p_hanh_dong,
    v_prev, p_tien_do, p_noi_dung, COALESCE(p_image_urls, '{}'), COALESCE(p_file_urls, '{}'),
    p_vi_do, p_kinh_do, p_dia_diem_text
  );

  UPDATE public.kpi_tasks
    SET trang_thai = CASE
          WHEN p_hanh_dong = 'nop' THEN 'cho_nghiem_thu'
          WHEN trang_thai IN ('moi_giao', 'tra_ve') THEN 'dang_thuc_hien'
          ELSE trang_thai
        END,
        updated_at = now()
    WHERE id = p_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_task_member_update(UUID, TEXT, INTEGER, TEXT, TEXT[], TEXT[], NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_task_member_update(UUID, TEXT, INTEGER, TEXT, TEXT[], TEXT[], NUMERIC, NUMERIC, TEXT) TO authenticated;
