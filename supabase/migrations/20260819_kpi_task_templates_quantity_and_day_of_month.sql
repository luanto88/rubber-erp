-- Việc định kỳ (kpi_task_templates) — 2 bổ sung theo phản hồi người dùng (2026-08-19):
--   #7: thêm cadence_type='day_of_month' (chọn cụ thể các ngày 1-31 trong tháng, vd "Dọn dẹp căn
--       tin" vào ngày 15 và 30 hàng tháng) — KHÔNG gộp 5S và Việc định kỳ làm một, đây là cách
--       diễn đạt đúng nhu cầu mà không cần đổi kiến trúc.
--   #8: thêm muc_tieu_so_luong — khi có giá trị, mỗi task sinh ra từ template này mang theo đúng
--       mục tiêu số lượng đó, và người được giao (hoặc người thay thế) tự động là 'chinh' — task
--       chỉ thực sự "Hoàn thành" khi đã gắn đủ N bằng chứng qua kpi_task_link_and_complete (cùng
--       cơ chế mục tiêu số lượng đã có sẵn cho việc giao tay, xem 20260725_kpi_task_quantity_target).

ALTER TABLE kpi_task_templates
  ADD COLUMN IF NOT EXISTS days_of_month INTEGER[],
  ADD COLUMN IF NOT EXISTS muc_tieu_so_luong INTEGER;

ALTER TABLE kpi_task_templates DROP CONSTRAINT IF EXISTS kpi_task_templates_cadence_type_check;
ALTER TABLE kpi_task_templates ADD CONSTRAINT kpi_task_templates_cadence_type_check
  CHECK (cadence_type IN ('weekday', 'interval', 'day_of_month'));

ALTER TABLE kpi_task_templates DROP CONSTRAINT IF EXISTS kpi_task_templates_cadence_fields_check;
ALTER TABLE kpi_task_templates ADD CONSTRAINT kpi_task_templates_cadence_fields_check
  CHECK (
    (cadence_type = 'weekday')
    OR (cadence_type = 'interval' AND interval_days IS NOT NULL AND anchor_date IS NOT NULL)
    OR (cadence_type = 'day_of_month' AND days_of_month IS NOT NULL AND array_length(days_of_month, 1) > 0)
  );

-- Postgres KHÔNG cho phép subquery trong CHECK constraint (kể cả SELECT...FROM unnest(...)) —
-- dùng array containment (<@) với 1 literal ARRAY[1..31] tường minh thay vì SELECT/unnest.
ALTER TABLE kpi_task_templates DROP CONSTRAINT IF EXISTS kpi_task_templates_days_of_month_check;
ALTER TABLE kpi_task_templates ADD CONSTRAINT kpi_task_templates_days_of_month_check
  CHECK (
    days_of_month IS NULL
    OR days_of_month <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]
  );

ALTER TABLE kpi_task_templates DROP CONSTRAINT IF EXISTS kpi_task_templates_muc_tieu_so_luong_check;
ALTER TABLE kpi_task_templates ADD CONSTRAINT kpi_task_templates_muc_tieu_so_luong_check
  CHECK (muc_tieu_so_luong IS NULL OR muc_tieu_so_luong > 0);

-- Thân hàm giữ nguyên 100% so với 20260818 (skip-if-stuck, substitution da_duyet, module_code) —
-- chỉ thêm nhánh day_of_month vào điều kiện chọn template, và copy muc_tieu_so_luong xuống task +
-- ép phan_loai='chinh' khi template có mục tiêu số lượng.
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
  v_dom INTEGER := EXTRACT(DAY FROM CURRENT_DATE)::INTEGER;
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
        OR (
          cadence_type = 'day_of_month'
          AND days_of_month IS NOT NULL
          AND v_dom = ANY(days_of_month)
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

    IF v_tpl.muc_tieu_so_luong IS NOT NULL THEN
      -- Việc mục tiêu số lượng: người được giao luôn là 'chinh' — mirror đúng quy tắc
      -- createKpiTask() (kpi-tasks.ts) khi giao tay 1 người kèm mục tiêu số lượng.
      v_phan_loai := 'chinh';
    ELSE
      -- phan_loai (chính/choàng) theo nhóm CHÍNH hiện tại của người CUỐI CÙNG nhận việc (người
      -- thay thế nếu có — đúng người thực sự làm việc hôm nay).
      SELECT pgm.group_id INTO v_group_of_final
      FROM public.maintenance_staff ms
      JOIN public.personnel_group_members pgm ON pgm.staff_id = ms.id AND pgm.is_primary = true
      WHERE ms.profile_id = v_final_user AND ms.factory_id = p_factory_id
      LIMIT 1;

      v_phan_loai := CASE WHEN v_group_of_final IS NOT NULL AND v_group_of_final = v_tpl.group_id THEN 'chinh' ELSE 'choang' END;
    END IF;

    SELECT count(*) INTO v_seq FROM public.kpi_tasks
      WHERE factory_id = p_factory_id AND ma_cong_viec LIKE v_prefix || '/%';
    v_ma := v_prefix || '/' || lpad((v_seq + 1)::text, 3, '0');

    INSERT INTO public.kpi_tasks (
      factory_id, ma_cong_viec, tieu_de, mo_ta, nguoi_giao_id, ngay_giao, han_hoan_thanh,
      yeu_cau_bao_cao, template_id, phong_ban_id, module_code, muc_tieu_so_luong
    ) VALUES (
      p_factory_id, v_ma, v_tpl.tieu_de, v_tpl.mo_ta, v_tpl.created_by, v_today,
      (v_today + v_tpl.gio_han)::timestamptz, v_tpl.yeu_cau_bao_cao, v_tpl.id, v_tpl.phong_ban_id,
      v_tpl.module_code, v_tpl.muc_tieu_so_luong
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
