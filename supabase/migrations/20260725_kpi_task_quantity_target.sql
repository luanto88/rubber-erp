-- Module KPI — "Việc mục tiêu số lượng chung" (nhiều người cùng làm 1 việc, cần đạt tổng số
-- lượng, ví dụ "đo 4 mẫu"). Sửa bug thiết kế thật của RPC kpi_task_link_and_complete: trước
-- migration này, BẤT KỲ 1 bằng chứng nào từ 1 thành viên bất kỳ cũng đóng thẳng CẢ TASK
-- "Hoàn thành" ngay lập tức, bất kể còn thiếu người khác hay số lượng chưa đủ (vd giao "Đo 4
-- mẫu" cho 2 người, 1 người đo đúng 1 mẫu là cả việc đã đóng — sai hoàn toàn).
--
-- Nguyên tắc đã chốt với người dùng: tách biệt hoàn toàn "việc chung hoàn thành" khỏi "điểm A
-- cá nhân của từng người":
-- - Việc chung Hoàn thành khi TỔNG số bằng chứng đã gắn (kpi_task_evidence_links) >=
--   muc_tieu_so_luong — không quan tâm AI đóng góp bao nhiêu trong số đó.
-- - Người "choàng" (phan_loai='choang'): đóng góp bao nhiêu cũng được cộng, KHÔNG có ngưỡng
--   riêng, KHÔNG bị phạt — được 100% điểm A ngay khi việc chung xong, bất kể họ đóng góp bao
--   nhiêu (kể cả 0).
-- - Người "chính" (phan_loai='chinh'): có NGƯỠNG TỐI THIỂU riêng = 50% "kỳ vọng" của họ
--   (kỳ vọng = muc_tieu_so_luong / số thành viên đang active). Điểm A cá nhân của chính =
--   MIN(100, đóng góp của chính / ngưỡng * 100) — CÔNG THỨC NÀY LUÔN ĐÚNG với đóng góp thật
--   của chính, không bị "cứu" thành 100% chỉ vì việc chung đã xong nhờ người khác — đây chính
--   là cơ chế phạt nếu chính bỏ bê phần việc của mình.
--
-- Sửa thêm (cùng ngày, sau khi test tay lần 1 phát hiện tiếp bug thanh tiến độ tổng sai lệch):
-- `tien_do` (raw, MỌI thành viên, không phân biệt chính/choàng) đổi công thức từ
-- "đóng góp / kỳ vọng cá nhân" sang "đóng góp / TỔNG muc_tieu_so_luong" — để SUM(tien_do) qua
-- tất cả thành viên active LUÔN bằng đúng % hoàn thành thật của cả việc (dùng cho
-- averageTaskProgress() ở src/lib/kpi-tasks.ts). Xem chi tiết lý do trong thân hàm bên dưới.
-- Đồng thời: task tự chuyển "Mới giao"/"Trả về" → "Đang thực hiện" ngay khi có bằng chứng đầu
-- tiên (trước đây kẹt mãi "Mới giao" cho tới lúc hoàn thành, dù số liệu đã tăng dần).

ALTER TABLE public.kpi_tasks ADD COLUMN IF NOT EXISTS muc_tieu_so_luong INTEGER
  CHECK (muc_tieu_so_luong IS NULL OR muc_tieu_so_luong > 0);

-- `phan_loai` từng được phác thảo cho Phase "Việc định kỳ" (kpi_task_templates, chưa xây) với
-- ý nghĩa khác (so nhóm việc với nhóm chính is_primary của người nhận). Ở đây dùng NGAY cho
-- task một-lần (Phase 1a, giao trực tiếp nhiều người) với ý nghĩa: trong PHẠM VI 1 task mục
-- tiêu số lượng, đúng 1 người được đánh dấu "chinh" (chịu trách nhiệm chính, có ngưỡng riêng),
-- các thành viên còn lại "choang". Khi Phase "Việc định kỳ" triển khai thật, cần đối chiếu lại
-- xem 2 ý nghĩa có xung đột không (nhiều khả năng KHÔNG, vì đó là is_primary theo NHÓM nhân sự
-- còn đây là vai trò trong PHẠM VI 1 task cụ thể — 2 khái niệm độc lập, chỉ trùng tên cột).
ALTER TABLE public.kpi_task_members ADD COLUMN IF NOT EXISTS phan_loai TEXT
  CHECK (phan_loai IS NULL OR phan_loai IN ('chinh', 'choang'));

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
  v_active_count INTEGER;
  v_ky_vong NUMERIC;
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
    -- đóng thẳng cả task. Đúng cho trường hợp phổ biến nhất (task giao 1 người, hoặc nhiều
    -- người nhưng KHÔNG cần gộp số lượng — vd "ai xong trước thì thôi", hiếm gặp hơn).
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

  -- Việc vẫn đang "Mới giao"/"Trả về" mà đã có người gắn bằng chứng thật → phải phản ánh đúng
  -- đang được thực hiện, không được kẹt mãi ở badge "Mới giao" trong lúc số liệu đã tăng dần.
  IF v_task.trang_thai IN ('moi_giao', 'tra_ve') THEN
    UPDATE public.kpi_tasks SET trang_thai = 'dang_thuc_hien', updated_at = now() WHERE id = p_task_id;
  END IF;

  SELECT count(*) INTO v_active_count FROM public.kpi_task_members WHERE task_id = p_task_id AND is_active = true;
  IF v_active_count = 0 THEN v_active_count := 1; END IF; -- an toàn, tránh chia 0 (không thực tế xảy ra)
  v_ky_vong := v_task.muc_tieu_so_luong::numeric / v_active_count;

  -- Tiến độ thô (tien_do) của MỌI thành viên active — SỬA so với bản đầu: chia cho TỔNG mục
  -- tiêu chung (v_task.muc_tieu_so_luong), KHÔNG chia cho kỳ vọng cá nhân (v_ky_vong) như bản
  -- đầu. Lý do: chia theo kỳ vọng cá nhân (mẫu số nhỏ, vd 2/người khi mục tiêu 4 người 2) khiến
  -- từng người chạm 100% rất sớm dù việc chung còn lâu mới xong — cộng dồn qua
  -- averageTaskProgress() (SUM khi có mục tiêu số lượng, xem src/lib/kpi-tasks.ts) sẽ cho thanh
  -- tiến độ tổng bị đẩy lên sai lệch (vd gần đầy) ngay khi việc mới được vài phần trăm thật sự.
  -- Với công thức mới, tien_do của 1 người = đúng phần trăm ĐÓNG GÓP của họ trên TỔNG mục tiêu
  -- chung — cộng dồn qua mọi thành viên active LUÔN RA ĐÚNG % hoàn thành thật của cả việc.
  UPDATE public.kpi_task_members m
    SET tien_do = LEAST(100, ROUND(
          (SELECT count(*) FROM public.kpi_task_evidence_links e WHERE e.task_id = p_task_id AND e.member_user_id = m.user_id)
          / v_task.muc_tieu_so_luong::numeric * 100
        )),
        updated_at = now()
    WHERE m.task_id = p_task_id AND m.is_active = true;

  -- Tính lại điểm A của người CHÍNH (nếu task có chỉ định) — recompute mỗi lần có bằng chứng
  -- mới bất kể ai vừa gắn, vì điểm của chính chỉ phụ thuộc đóng góp của CHÍNH HỌ + kỳ vọng
  -- chung (không phụ thuộc ai vừa thao tác).
  SELECT * INTO v_chinh FROM public.kpi_task_members WHERE task_id = p_task_id AND is_active = true AND phan_loai = 'chinh' LIMIT 1;
  IF FOUND THEN
    SELECT count(*) INTO v_chinh_count FROM public.kpi_task_evidence_links WHERE task_id = p_task_id AND member_user_id = v_chinh.user_id;
    v_nguong_chinh := FLOOR(v_ky_vong * 0.5);
    IF v_ky_vong >= 1 AND v_nguong_chinh < 1 THEN v_nguong_chinh := 1; END IF;
    IF v_nguong_chinh <= 0 THEN
      -- Kỳ vọng bình quân đầu người < 1 (nhiều thành viên hơn mục tiêu) — ngưỡng phạt vô nghĩa,
      -- coi như chính tự động đạt để tránh chia cho 0 và tránh phạt oan trường hợp hiếm gặp này.
      v_chinh_score := 100;
    ELSE
      v_chinh_score := LEAST(100, ROUND(v_chinh_count::numeric / v_nguong_chinh * 100));
    END IF;
    UPDATE public.kpi_task_members SET tien_do_nghiem_thu = v_chinh_score, updated_at = now() WHERE id = v_chinh.id;
  END IF;

  SELECT count(*) INTO v_total_evidence FROM public.kpi_task_evidence_links WHERE task_id = p_task_id;
  IF v_total_evidence >= v_task.muc_tieu_so_luong THEN
    -- Việc chung hoàn thành — chốt Điểm A = 100% cho MỌI thành viên "choàng" (không ngưỡng,
    -- không phạt). KHÔNG đụng tien_do_nghiem_thu của "chinh" (đã tính đúng ở bước trên, giữ
    -- nguyên dù thấp — đây chính là "phạt" mà việc chung hoàn thành không xoá được).
    -- CHÚ Ý: không được ghi đè tien_do=100 ở đây — tien_do đã được UPDATE đúng ngay phía trên
    -- (đóng góp thật / tổng mục tiêu) cho MỌI thành viên active; SUM(tien_do) qua tất cả thành
    -- viên tại đúng thời điểm này luôn bằng 100 (vì total_evidence == muc_tieu_so_luong). Ghi
    -- đè riêng choàng thành 100 sẽ làm SUM vượt quá 100%, sai thanh tiến độ tổng.
    UPDATE public.kpi_task_members
      SET tien_do_nghiem_thu = 100, updated_at = now()
      WHERE task_id = p_task_id AND is_active = true AND phan_loai = 'choang';
    -- Thành viên không gắn phan_loai (dữ liệu cũ trước migration này) coi như choàng, tránh kẹt
    -- tien_do_nghiem_thu NULL vĩnh viễn dù việc chung đã xong.
    UPDATE public.kpi_task_members
      SET tien_do_nghiem_thu = 100, updated_at = now()
      WHERE task_id = p_task_id AND is_active = true AND phan_loai IS NULL;
    UPDATE public.kpi_tasks SET trang_thai = 'hoan_thanh', updated_at = now() WHERE id = p_task_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_task_link_and_complete(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_task_link_and_complete(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
