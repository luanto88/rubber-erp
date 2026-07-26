-- Module KPI — 2 fix theo yêu cầu người dùng (2026-07-26), sau review code Phase 1a/1a.1:
--
-- 1) BUG THẬT: "kpi_task_evaluate" (Nghiệm thu/Điều chỉnh) hoàn toàn không biết
--    `kpi_tasks.muc_tieu_so_luong` tồn tại — người giao có thể bấm "Nghiệm thu" tay cho từng
--    thành viên của 1 việc "mục tiêu số lượng chung" (vd "Đo 4 mẫu") với điểm tùy ý, đóng thẳng
--    cả task "Hoàn thành" ngay cả khi tổng bằng chứng thật CHƯA đạt đủ mục tiêu — vô hiệu hóa
--    hoàn toàn cơ chế công bằng vừa được thêm ở `20260725_kpi_task_quantity_target.sql`. Fix:
--    chặn cứng 2 hành động này ở RPC khi `muc_tieu_so_luong IS NOT NULL` — điểm A/trạng thái
--    hoàn thành của việc mục tiêu số lượng chỉ được phép đi qua đúng 1 đường là
--    `kpi_task_link_and_complete` (gắn bằng chứng). "Trả về"/"Yêu cầu bổ sung" vẫn cho phép vì
--    không đụng `tien_do`/`tien_do_nghiem_thu`, chỉ đổi `trang_thai` của cả task.
--
-- 2) Ngưỡng tối thiểu của người "chính" đổi công thức LẦN 2 (cùng ngày, sau khi test tay lần 1
--    dùng bản FLOOR/kỳ-vọng-cá-nhân cho kết quả vẫn chưa đúng ý người dùng — vd mục tiêu 3, 2
--    thành viên, kỳ vọng mỗi người 1.5 → ngưỡng chỉ ra 1, tức 33% TỔNG mục tiêu, không phải 50%).
--    Bản đầu (đã thay thế hoàn toàn, không còn trong file này) tính "ngưỡng = 50% KỲ VỌNG CÁ
--    NHÂN" (kỳ vọng = mục_tiêu / số thành viên active) — sai ở chỗ khi nhóm càng đông người,
--    "kỳ vọng" của từng người càng nhỏ, kéo ngưỡng thật của người chính so với TỔNG việc xuống
--    rất thấp (vd mục tiêu 4 chia 10 người: kỳ vọng mỗi người 0.4 < 1, chính coi như auto-pass
--    dù chưa đóng góp gì) — không đúng tinh thần "người chính phải tự làm ít nhất một nửa TOÀN
--    BỘ việc, bất kể có bao nhiêu người choàng hỗ trợ".
--
--    Công thức mới, ĐÚNG theo yêu cầu người dùng: ngưỡng = CEIL(muc_tieu_so_luong * 0.5) — tính
--    thẳng trên TỔNG mục tiêu, KHÔNG chia theo số thành viên active nữa. CEIL đảm bảo toán học
--    ngưỡng luôn >= đúng 50% tổng (ceil(x) >= x với mọi x dương), không bao giờ undershoot. Vì
--    `muc_tieu_so_luong` luôn nguyên dương (CHECK > 0), CEIL(x*0.5) luôn >= 1 — không còn cần
--    nhánh đặc biệt "kỳ vọng < 1 → auto-pass" của bản trước (khái niệm "kỳ vọng cá nhân" bị bỏ
--    hẳn khỏi công thức này).

CREATE OR REPLACE FUNCTION public.kpi_task_evaluate(
  p_task_id UUID,
  p_member_user_id UUID,
  p_hanh_dong TEXT,
  p_tien_do INTEGER DEFAULT NULL,
  p_noi_dung TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_task RECORD;
  v_member RECORD;
  v_prev INTEGER;
  v_remaining INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
  END IF;
  IF p_hanh_dong NOT IN ('nghiem_thu', 'dieu_chinh', 'tra_ve', 'yeu_cau_bo_sung') THEN
    RAISE EXCEPTION 'Hành động không hợp lệ: %', p_hanh_dong;
  END IF;

  SELECT * INTO v_task FROM public.kpi_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy công việc.';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'admin') INTO v_is_admin;
  IF NOT v_is_admin AND v_task.nguoi_giao_id <> v_uid THEN
    RAISE EXCEPTION 'Chỉ người giao việc mới được xử lý bước này.';
  END IF;
  IF v_task.trang_thai IN ('hoan_thanh', 'huy') THEN
    RAISE EXCEPTION 'Công việc đã kết thúc.';
  END IF;

  -- (1) Chặn Nghiệm thu/Điều chỉnh tay cho việc mục tiêu số lượng chung — xem giải thích ở
  -- đầu file migration này.
  IF v_task.muc_tieu_so_luong IS NOT NULL AND p_hanh_dong IN ('nghiem_thu', 'dieu_chinh') THEN
    RAISE EXCEPTION 'Việc mục tiêu số lượng chung tự tính điểm qua gắn bằng chứng — không nghiệm thu/điều chỉnh tay từng người.';
  END IF;

  SELECT * INTO v_member FROM public.kpi_task_members
    WHERE task_id = p_task_id AND user_id = p_member_user_id AND is_active = true
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy người phụ trách tương ứng.';
  END IF;

  IF p_hanh_dong IN ('tra_ve', 'yeu_cau_bo_sung') AND (p_noi_dung IS NULL OR trim(p_noi_dung) = '') THEN
    RAISE EXCEPTION 'Vui lòng nhập lý do/nội dung yêu cầu.';
  END IF;
  IF p_hanh_dong IN ('nghiem_thu', 'dieu_chinh') AND (p_tien_do IS NULL OR p_tien_do < 0 OR p_tien_do > 100) THEN
    RAISE EXCEPTION 'Điểm/tiến độ phải trong khoảng 0-100.';
  END IF;

  v_prev := v_member.tien_do;

  IF p_hanh_dong = 'nghiem_thu' THEN
    UPDATE public.kpi_task_members SET tien_do_nghiem_thu = p_tien_do, updated_at = now() WHERE id = v_member.id;
    INSERT INTO public.kpi_task_logs (task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong, tien_do_truoc, tien_do_sau, noi_dung)
      VALUES (p_task_id, v_task.factory_id, p_member_user_id, v_uid, p_hanh_dong, v_prev, p_tien_do, p_noi_dung);

    SELECT count(*) INTO v_remaining FROM public.kpi_task_members
      WHERE task_id = p_task_id AND is_active = true AND tien_do_nghiem_thu IS NULL;
    IF v_remaining = 0 THEN
      UPDATE public.kpi_tasks SET trang_thai = 'hoan_thanh', updated_at = now() WHERE id = p_task_id;
    END IF;

  ELSIF p_hanh_dong = 'dieu_chinh' THEN
    UPDATE public.kpi_task_members SET tien_do = p_tien_do, updated_at = now() WHERE id = v_member.id;
    INSERT INTO public.kpi_task_logs (task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong, tien_do_truoc, tien_do_sau, noi_dung)
      VALUES (p_task_id, v_task.factory_id, p_member_user_id, v_uid, p_hanh_dong, v_prev, p_tien_do, p_noi_dung);

  ELSIF p_hanh_dong = 'tra_ve' THEN
    INSERT INTO public.kpi_task_logs (task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong, tien_do_truoc, tien_do_sau, noi_dung)
      VALUES (p_task_id, v_task.factory_id, p_member_user_id, v_uid, p_hanh_dong, v_prev, v_prev, p_noi_dung);
    UPDATE public.kpi_tasks SET trang_thai = 'tra_ve', updated_at = now() WHERE id = p_task_id;

  ELSIF p_hanh_dong = 'yeu_cau_bo_sung' THEN
    INSERT INTO public.kpi_task_logs (task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong, tien_do_truoc, tien_do_sau, noi_dung)
      VALUES (p_task_id, v_task.factory_id, p_member_user_id, v_uid, p_hanh_dong, v_prev, v_prev, p_noi_dung);
    UPDATE public.kpi_tasks SET trang_thai = 'dang_thuc_hien', updated_at = now() WHERE id = p_task_id;
  END IF;
END;
$$;

-- (2) Ngưỡng "chính" đổi sang CEIL(50% TỔNG mục tiêu), không chia theo số người — xem giải
-- thích đầy đủ ở đầu file.
CREATE OR REPLACE FUNCTION public.kpi_task_link_and_complete(
  p_task_id UUID,
  p_module_code TEXT,
  p_record_id TEXT,
  p_record_label TEXT,
  p_record_url TEXT DEFAULT NULL
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
  v_total_evidence INTEGER;
  v_chinh RECORD;
  v_nguong_chinh NUMERIC;
  v_chinh_count INTEGER;
  v_chinh_score INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
  END IF;
  IF p_module_code IS NULL OR trim(p_module_code) = '' THEN
    RAISE EXCEPTION 'Thiếu module_code.';
  END IF;
  IF p_record_id IS NULL OR trim(p_record_id) = '' THEN
    RAISE EXCEPTION 'Thiếu record_id.';
  END IF;
  IF p_record_label IS NULL OR trim(p_record_label) = '' THEN
    RAISE EXCEPTION 'Thiếu record_label.';
  END IF;

  SELECT * INTO v_task FROM public.kpi_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy công việc.';
  END IF;
  IF v_task.trang_thai IN ('hoan_thanh', 'huy') THEN
    RAISE EXCEPTION 'Công việc đã kết thúc, không thể gắn thêm bằng chứng.';
  END IF;

  SELECT * INTO v_member FROM public.kpi_task_members
    WHERE task_id = p_task_id AND user_id = v_uid AND is_active = true
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bạn không phải người đang phụ trách công việc này.';
  END IF;

  v_prev := v_member.tien_do;

  INSERT INTO public.kpi_task_evidence_links (
    factory_id, task_id, member_user_id, module_code, record_id, record_label, record_url
  ) VALUES (
    v_task.factory_id, p_task_id, v_uid, p_module_code, p_record_id, p_record_label, p_record_url
  )
  ON CONFLICT (task_id, module_code, record_id) DO NOTHING;

  UPDATE public.kpi_task_members SET da_nop_luc = COALESCE(da_nop_luc, now()), updated_at = now()
    WHERE id = v_member.id;

  IF v_task.muc_tieu_so_luong IS NULL THEN
    -- Việc đơn (không đặt mục tiêu số lượng) — hành vi gốc giữ nguyên: 1 bằng chứng là xong,
    -- đóng thẳng cả task.
    UPDATE public.kpi_task_members SET tien_do = 100, tien_do_nghiem_thu = 100, updated_at = now()
      WHERE id = v_member.id;
    INSERT INTO public.kpi_task_logs (task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong, tien_do_truoc, tien_do_sau, noi_dung)
      VALUES (p_task_id, v_task.factory_id, v_uid, v_uid, 'gan_ban_ghi', v_prev, 100,
        'Gắn ' || p_record_label || ' (module: ' || p_module_code || ')');
    UPDATE public.kpi_tasks SET trang_thai = 'hoan_thanh', updated_at = now() WHERE id = p_task_id;
    RETURN;
  END IF;

  -- Việc mục tiêu số lượng chung: chỉ ghi log đóng góp, KHÔNG tự set tien_do=100 cho người gắn.
  INSERT INTO public.kpi_task_logs (task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong, tien_do_truoc, tien_do_sau, noi_dung)
    VALUES (p_task_id, v_task.factory_id, v_uid, v_uid, 'gan_ban_ghi', v_prev, v_prev,
      'Gắn ' || p_record_label || ' (module: ' || p_module_code || ')');

  IF v_task.trang_thai IN ('moi_giao', 'tra_ve') THEN
    UPDATE public.kpi_tasks SET trang_thai = 'dang_thuc_hien', updated_at = now() WHERE id = p_task_id;
  END IF;

  UPDATE public.kpi_task_members m
    SET tien_do = LEAST(100, ROUND(
          (SELECT count(*) FROM public.kpi_task_evidence_links e WHERE e.task_id = p_task_id AND e.member_user_id = m.user_id)
          / v_task.muc_tieu_so_luong::numeric * 100
        )),
        updated_at = now()
    WHERE m.task_id = p_task_id AND m.is_active = true;

  -- Tính lại điểm A của người CHÍNH — ngưỡng = CEIL(50% TỔNG mục tiêu), không chia theo số
  -- thành viên active nữa (xem giải thích đầy đủ ở đầu file migration này).
  SELECT * INTO v_chinh FROM public.kpi_task_members WHERE task_id = p_task_id AND is_active = true AND phan_loai = 'chinh' LIMIT 1;
  IF FOUND THEN
    SELECT count(*) INTO v_chinh_count FROM public.kpi_task_evidence_links WHERE task_id = p_task_id AND member_user_id = v_chinh.user_id;
    v_nguong_chinh := CEIL(v_task.muc_tieu_so_luong::numeric * 0.5);
    v_chinh_score := LEAST(100, ROUND(v_chinh_count::numeric / v_nguong_chinh * 100));
    UPDATE public.kpi_task_members SET tien_do_nghiem_thu = v_chinh_score, updated_at = now() WHERE id = v_chinh.id;
  END IF;

  SELECT count(*) INTO v_total_evidence FROM public.kpi_task_evidence_links WHERE task_id = p_task_id;
  IF v_total_evidence >= v_task.muc_tieu_so_luong THEN
    UPDATE public.kpi_task_members
      SET tien_do_nghiem_thu = 100, updated_at = now()
      WHERE task_id = p_task_id AND is_active = true AND phan_loai = 'choang';
    UPDATE public.kpi_task_members
      SET tien_do_nghiem_thu = 100, updated_at = now()
      WHERE task_id = p_task_id AND is_active = true AND phan_loai IS NULL;
    UPDATE public.kpi_tasks SET trang_thai = 'hoan_thanh', updated_at = now() WHERE id = p_task_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_task_evaluate(UUID, UUID, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_task_evaluate(UUID, UUID, TEXT, INTEGER, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.kpi_task_link_and_complete(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_task_link_and_complete(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
