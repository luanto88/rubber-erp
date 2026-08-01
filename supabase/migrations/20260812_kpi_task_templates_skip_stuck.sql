-- Module KPI & 5S — Fix bug thật: "việc định kỳ chưa hoàn thành bị mắc kẹt".
-- Xem đầy đủ .claude/rules/27-kpi-module.md, mục "Cập nhật (kế hoạch phiên sau) — Fix mắc kẹt".
--
-- Root cause (đã xác nhận qua đọc code, không đoán): kpi_ensure_today_task_instances trước đây
-- (20260807_kpi_substitution_approval.sql) chỉ kiểm tra "đã có task cho ĐÚNG HÔM NAY của template
-- này chưa" (EXISTS ... AND ngay_giao = v_today) — không hề kiểm tra instance của NGÀY TRƯỚC (cùng
-- template) đã đóng (hoan_thanh/huy) hay chưa. Hệ quả: nếu 1 việc định kỳ chưa hoàn thành, mỗi
-- ngày mở app đều sinh thêm 1 task MỚI cho template đó — task cũ vẫn mở, chồng chất dần.
--
-- Fix: thêm 1 điều kiện CONTINUE mới — nếu template đang có BẤT KỲ task nào còn mở
-- (trang_thai NOT IN ('hoan_thanh','huy')), bất kể ngày sinh, thì KHÔNG tạo task mới. Task cũ giữ
-- nguyên han_hoan_thanh gốc — độ trễ hiển thị rõ ràng qua badge "Quá hạn N ngày" (xem
-- src/lib/kpi-tasks.ts's daysOverdue()) thay vì bị nhân bản mỗi ngày.
--
-- Không lọc theo user_id/assignee khi kiểm tra "còn task mở" — 1 template chỉ đại diện 1 nhiệm vụ
-- đang diễn ra, không nên có 2 instance mở song song bất kể ai đang giữ. Trường hợp "Người thay
-- thế tạm thời" bắt đầu hiệu lực trong lúc task cũ (của người gốc) còn mắc kẹt là edge case CHẤP
-- NHẬN ĐƯỢC — người thay thế sẽ không có task mới cho tới khi task cũ đóng; không tự động
-- reassign task cũ sang người thay thế ở đợt này (ghi rõ trong rules file).

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

    -- FIX MỚI: nếu template này đang có bất kỳ instance nào còn mở (chưa hoàn thành/chưa hủy,
    -- bất kể sinh ngày nào trước đó) thì không sinh thêm — tránh chồng chất task trùng lặp cho
    -- cùng 1 nhiệm vụ định kỳ chưa xong.
    IF EXISTS (
      SELECT 1 FROM public.kpi_tasks
      WHERE template_id = v_tpl.id AND trang_thai NOT IN ('hoan_thanh', 'huy')
    ) THEN
      CONTINUE;
    END IF;

    -- Resolve người thay thế tạm thời — ưu tiên dòng khớp đúng template_id cụ thể hơn dòng
    -- NULL (áp dụng chung mọi việc định kỳ của người đó). CHỈ tôn trọng đăng ký ĐÃ DUYỆT.
    SELECT substitute_user_id INTO v_final_user
    FROM public.kpi_user_substitutions
    WHERE original_user_id = v_tpl.assigned_user_id
      AND factory_id = p_factory_id
      AND trang_thai = 'da_duyet'
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
      yeu_cau_bao_cao, template_id, phong_ban_id
    ) VALUES (
      p_factory_id, v_ma, v_tpl.tieu_de, v_tpl.mo_ta, v_tpl.created_by, v_today,
      (v_today + v_tpl.gio_han)::timestamptz, v_tpl.yeu_cau_bao_cao, v_tpl.id, v_tpl.phong_ban_id
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
