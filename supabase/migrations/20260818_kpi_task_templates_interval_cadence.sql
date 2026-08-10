-- Việc định kỳ (kpi_task_templates) trước đây CHỈ hỗ trợ lặp theo tập hợp Thứ trong tuần
-- (apply_weekdays) — không có cách nào diễn đạt "N ngày một lần" (vd 2 ngày/lần) vì apply_weekdays
-- không đếm chu kỳ, chỉ khớp ISODOW của hôm nay. Thêm cadence_type='interval' làm phương án thứ 2
-- song song với 'weekday' (mặc định, giữ nguyên hành vi cũ 100% cho mọi template đã tạo trước
-- migration này).

ALTER TABLE kpi_task_templates
  ADD COLUMN IF NOT EXISTS cadence_type TEXT NOT NULL DEFAULT 'weekday',
  ADD COLUMN IF NOT EXISTS interval_days INTEGER,
  ADD COLUMN IF NOT EXISTS anchor_date DATE;

ALTER TABLE kpi_task_templates DROP CONSTRAINT IF EXISTS kpi_task_templates_cadence_type_check;
ALTER TABLE kpi_task_templates ADD CONSTRAINT kpi_task_templates_cadence_type_check
  CHECK (cadence_type IN ('weekday', 'interval'));

ALTER TABLE kpi_task_templates DROP CONSTRAINT IF EXISTS kpi_task_templates_interval_days_check;
ALTER TABLE kpi_task_templates ADD CONSTRAINT kpi_task_templates_interval_days_check
  CHECK (interval_days IS NULL OR interval_days >= 1);

-- cadence_type='interval' bắt buộc phải có đủ interval_days + anchor_date để tính chu kỳ;
-- cadence_type='weekday' (mặc định) không cần 2 cột này (vẫn dùng apply_weekdays như cũ).
ALTER TABLE kpi_task_templates DROP CONSTRAINT IF EXISTS kpi_task_templates_cadence_fields_check;
ALTER TABLE kpi_task_templates ADD CONSTRAINT kpi_task_templates_cadence_fields_check
  CHECK (cadence_type = 'weekday' OR (interval_days IS NOT NULL AND anchor_date IS NOT NULL));

-- Cập nhật RPC sinh việc định kỳ mỗi ngày — mở rộng điều kiện chọn template đủ điều kiện sinh
-- hôm nay để chấp nhận cả 2 kiểu lịch. THÂN HÀM giữ NGUYÊN VẸN so với bản mới nhất
-- (20260816_kpi_task_module_code.sql) — chỉ đổi khối điều kiện của FOR ... LOOP, không được rơi
-- rớt các fix trước đó (skip-if-stuck từ 20260812, lọc trang_thai='da_duyet' từ 20260807,
-- module_code từ 20260816).
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
    WHERE factory_id = p_factory_id AND is_active = true
      AND (
        (cadence_type = 'weekday' AND v_dow = ANY(apply_weekdays))
        OR (
          cadence_type = 'interval'
          AND anchor_date IS NOT NULL AND interval_days IS NOT NULL
          AND v_today >= anchor_date
          AND MOD((v_today - anchor_date), interval_days) = 0
        )
      )
  LOOP
    IF EXISTS (SELECT 1 FROM public.kpi_tasks WHERE template_id = v_tpl.id AND ngay_giao = v_today) THEN
      CONTINUE;
    END IF;

    -- Nếu template này đang có bất kỳ instance nào còn mở (chưa hoàn thành/chưa hủy, bất kể
    -- sinh ngày nào trước đó) thì không sinh thêm — tránh chồng chất task trùng lặp.
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
      yeu_cau_bao_cao, template_id, phong_ban_id, module_code
    ) VALUES (
      p_factory_id, v_ma, v_tpl.tieu_de, v_tpl.mo_ta, v_tpl.created_by, v_today,
      (v_today + v_tpl.gio_han)::timestamptz, v_tpl.yeu_cau_bao_cao, v_tpl.id, v_tpl.phong_ban_id, v_tpl.module_code
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
