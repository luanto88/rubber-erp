-- Module KPI — Lọc "Gắn bản ghi tại chỗ" (KpiLinkPrompt) theo đúng module ERP đang thao tác.
-- Trước migration này, kpi_tasks/kpi_task_templates không lưu bất kỳ khái niệm "module" nào —
-- KpiLinkPrompt gợi ý TẤT CẢ việc đang mở của người dùng, bất kể module nào, gây gợi ý sai (vd
-- gán nhầm việc "Điều xe" vào bản ghi Kho nguyên liệu). Cột module_code cho phép admin/lãnh đạo
-- gắn rõ 1 việc/1 việc định kỳ thuộc đúng module ERP nào — KpiLinkPrompt chỉ hiện khi có việc
-- khớp đúng module đang thao tác. Việc không gắn module (NULL) sẽ không bao giờ được gợi ý ở bất
-- kỳ module nào — vẫn hoàn thành bình thường qua trang chi tiết việc (Nộp/Nghiệm thu).
--
-- 6 giá trị hợp lệ khớp đúng 6 nơi đã có <KpiLinkPrompt> trong app (xem KPI_MODULE_OPTIONS,
-- src/lib/kpi-tasks.ts): dispatch (Điều xe), output (Sản lượng), quality (Kiểm nghiệm),
-- storage (Kho nguyên liệu), product (Thành phẩm), process (Kiểm soát quá trình — Đo nhanh).
--
-- Không backfill dữ liệu cũ — mọi việc/việc định kỳ đã tạo trước migration này sẽ có
-- module_code = NULL, đúng chủ đích (không đoán mò module từ tiêu đề).

ALTER TABLE public.kpi_tasks ADD COLUMN IF NOT EXISTS module_code TEXT;
ALTER TABLE public.kpi_task_templates ADD COLUMN IF NOT EXISTS module_code TEXT;

ALTER TABLE public.kpi_tasks DROP CONSTRAINT IF EXISTS kpi_tasks_module_code_check;
ALTER TABLE public.kpi_tasks ADD CONSTRAINT kpi_tasks_module_code_check
  CHECK (module_code IS NULL OR module_code IN ('dispatch','output','quality','storage','product','process'));

ALTER TABLE public.kpi_task_templates DROP CONSTRAINT IF EXISTS kpi_task_templates_module_code_check;
ALTER TABLE public.kpi_task_templates ADD CONSTRAINT kpi_task_templates_module_code_check
  CHECK (module_code IS NULL OR module_code IN ('dispatch','output','quality','storage','product','process'));

CREATE INDEX IF NOT EXISTS idx_kpi_tasks_module_code
  ON public.kpi_tasks(module_code) WHERE module_code IS NOT NULL;

-- Cập nhật RPC sinh việc định kỳ mỗi ngày — copy module_code từ template sang instance sinh ra,
-- để instance tự động thừa hưởng đúng module của template gốc. Chữ ký hàm (p_factory_id UUID)
-- không đổi nên CREATE OR REPLACE là đủ, không cần DROP FUNCTION trước.
--
-- Thân hàm lấy nguyên trạng từ bản mới nhất (20260812_kpi_task_templates_skip_stuck.sql — đã có
-- sẵn check "còn task mở thì không sinh thêm" + lọc trang_thai='da_duyet' cho người thay thế),
-- CHỈ thêm module_code vào câu INSERT — không được rơi rớt 2 fix đó khi REPLACE.
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
