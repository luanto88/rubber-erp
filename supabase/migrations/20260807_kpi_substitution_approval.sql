-- Module KPI & 5S — Phase C: "Người thay thế" cần được duyệt (trước đây insert là có hiệu lực
-- ngay, không ai phải đồng ý). Xem đầy đủ .claude/rules/27-kpi-module.md.
--
-- Cần chạy SAU 20260807_kpi_department_scoping.sql (dùng hàm kpi_is_department_leader).
--
-- Quy tắc duyệt đã chốt với người dùng: AI ĐĂNG KÝ THÌ PHÍA CÒN LẠI DUYỆT.
-- - Nếu chính người đi vắng tự đăng ký (created_by = original_user_id) → lãnh đạo phòng ban của
--   người đó (hoặc admin) phải duyệt.
-- - Nếu lãnh đạo/kpi.assign đăng ký HỘ người khác (created_by <> original_user_id) → chính người
--   đi vắng (original_user_id) phải tự xác nhận đồng ý (hoặc admin).
--
-- Lưu ý: các dòng kpi_user_substitutions đã có TRƯỚC migration này sẽ mang trang_thai mặc định
-- 'cho_duyet' (không backfill 'da_duyet') — cố ý, để buộc mọi đăng ký cũ (kể cả đã "có hiệu lực"
-- theo hành vi cũ) phải qua lại đúng cổng duyệt mới trước khi tiếp tục ảnh hưởng việc định kỳ
-- sinh ra sau ngày migration này chạy. Đây là hướng an toàn hơn (thắt chặt), không phải hành vi
-- mở rộng.

ALTER TABLE public.kpi_user_substitutions
  ADD COLUMN IF NOT EXISTS trang_thai TEXT NOT NULL DEFAULT 'cho_duyet',
  ADD COLUMN IF NOT EXISTS nguoi_duyet_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS duyet_luc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ly_do_tu_choi TEXT;

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.kpi_user_substitutions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%trang_thai%'
  LOOP
    EXECUTE format('ALTER TABLE public.kpi_user_substitutions DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.kpi_user_substitutions
  ADD CONSTRAINT chk_kpi_user_substitutions_trang_thai
  CHECK (trang_thai IN ('cho_duyet', 'da_duyet', 'tu_choi'));

-- ── Mở rộng SELECT để lãnh đạo phòng ban THẤY được đăng ký cần mình duyệt ────────────────────
-- Trước đây chỉ original_user_id/substitute_user_id/created_by/admin/kpi.view_all mới đọc
-- được — 1 "Trưởng phòng" tự phát hiện qua chức vụ (không hẳn có permission kpi.view_all riêng)
-- sẽ không thấy được yêu cầu cần chính mình duyệt nếu không mở rộng policy này.
DROP POLICY IF EXISTS "kpi_user_substitutions_select" ON public.kpi_user_substitutions;
CREATE POLICY "kpi_user_substitutions_select" ON public.kpi_user_substitutions
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      original_user_id = auth.uid()
      OR substitute_user_id = auth.uid()
      OR created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR public.current_profile_has_permission('kpi.view_all')
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = kpi_user_substitutions.original_user_id
          AND (
            (p.department_id IS NOT NULL AND public.kpi_is_department_leader(auth.uid(), p.department_id))
            OR EXISTS (
              SELECT 1 FROM public.departments d
              WHERE (d.name = p.department OR upper(p.department) = upper(d.code))
                AND public.kpi_is_department_leader(auth.uid(), d.id)
            )
          )
      )
    )
  );

-- ── Ai được duyệt/từ chối 1 đăng ký cụ thể — dùng chung cho cả 2 RPC dưới ────────────────────
CREATE OR REPLACE FUNCTION public.kpi_can_approve_substitution(p_user_id UUID, p_substitution_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row RECORD;
  v_is_admin BOOLEAN;
  v_dept_id UUID;
BEGIN
  SELECT * INTO v_row FROM public.kpi_user_substitutions WHERE id = p_substitution_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT (role = 'admin') INTO v_is_admin FROM public.profiles WHERE id = p_user_id;
  IF COALESCE(v_is_admin, false) THEN
    RETURN true;
  END IF;

  IF v_row.created_by = v_row.original_user_id THEN
    -- Tự đăng ký → cần lãnh đạo phòng ban của CHÍNH NGƯỜI ĐI VẮNG duyệt.
    SELECT COALESCE(
      p.department_id,
      (SELECT d.id FROM public.departments d
       WHERE d.name = p.department OR upper(p.department) = upper(d.code) LIMIT 1)
    ) INTO v_dept_id
    FROM public.profiles p WHERE p.id = v_row.original_user_id;
    RETURN v_dept_id IS NOT NULL AND public.kpi_is_department_leader(p_user_id, v_dept_id);
  ELSE
    -- Lãnh đạo/kpi.assign đăng ký hộ → chính người đi vắng phải tự xác nhận đồng ý.
    RETURN p_user_id = v_row.original_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_can_approve_substitution(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_can_approve_substitution(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.kpi_substitution_approve(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_trang_thai TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;

  SELECT trang_thai INTO v_trang_thai FROM public.kpi_user_substitutions WHERE id = p_id FOR UPDATE;
  IF v_trang_thai IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy đăng ký người thay thế này.';
  END IF;
  IF v_trang_thai <> 'cho_duyet' THEN
    RAISE EXCEPTION 'Đăng ký này không còn ở trạng thái chờ duyệt.';
  END IF;
  IF NOT public.kpi_can_approve_substitution(v_uid, p_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền duyệt đăng ký này.';
  END IF;

  UPDATE public.kpi_user_substitutions
  SET trang_thai = 'da_duyet', nguoi_duyet_id = v_uid, duyet_luc = now()
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_substitution_approve(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_substitution_approve(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.kpi_substitution_reject(p_id UUID, p_ly_do TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_trang_thai TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;

  SELECT trang_thai INTO v_trang_thai FROM public.kpi_user_substitutions WHERE id = p_id FOR UPDATE;
  IF v_trang_thai IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy đăng ký người thay thế này.';
  END IF;
  IF v_trang_thai <> 'cho_duyet' THEN
    RAISE EXCEPTION 'Đăng ký này không còn ở trạng thái chờ duyệt.';
  END IF;
  IF NOT public.kpi_can_approve_substitution(v_uid, p_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền từ chối đăng ký này.';
  END IF;

  UPDATE public.kpi_user_substitutions
  SET trang_thai = 'tu_choi', nguoi_duyet_id = v_uid, duyet_luc = now(), ly_do_tu_choi = p_ly_do
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_substitution_reject(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_substitution_reject(UUID, TEXT) TO authenticated;

-- ── kpi_ensure_today_task_instances — chỉ tôn trọng đăng ký ĐÃ DUYỆT ────────────────────────
-- Đăng ký 'cho_duyet'/'tu_choi' không được phép sinh việc thay người. Đồng thời set luôn
-- phong_ban_id của task sinh ra = phong_ban_id của template (cột đã thêm ở migration
-- 20260807_kpi_department_scoping.sql).
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
