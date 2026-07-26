-- Module KPI — Phase 1b: Chuyển giao việc (kpi_task_transfers)
-- Xem đầy đủ kiến trúc/roadmap tại .claude/rules/27-kpi-module.md
--
-- Cho phép 1 thành viên đang phụ trách 1 việc MỘT-LẦN (kpi_tasks, không qua template — chưa
-- có template ở giai đoạn này) chuyển giao cho 1 người khác trước khi hết hạn. Người nhận phải
-- CHỦ ĐỘNG chấp nhận (không tự động) — mirror đúng nguyên tắc "người dùng luôn tự xác nhận
-- bằng 1 cú click" đã áp dụng cho evidence-linking (20260725_kpi_task_evidence_links.sql).
-- Mỗi task chỉ chuyển được ĐÚNG 1 LẦN (kpi_tasks.da_chuyen_giao) — đúng rule đã ghi sẵn trong
-- schema gốc (20260724_kpi_tasks_phase1a.sql). Không có nhắc nhở tự động đi kèm (đã chốt từ
-- trước cho toàn module, giữ nguyên).

-- ── 1. kpi_task_transfers ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kpi_task_transfers (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id          UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  task_id             UUID NOT NULL REFERENCES public.kpi_tasks(id) ON DELETE CASCADE,
  tu_nguoi_id         UUID NOT NULL REFERENCES auth.users(id),
  den_nguoi_id        UUID NOT NULL REFERENCES auth.users(id),
  tien_do_luc_chuyen  INTEGER NOT NULL DEFAULT 0,
  ghi_chu             TEXT,
  trang_thai          TEXT NOT NULL DEFAULT 'cho_duyet'
    CHECK (trang_thai IN ('cho_duyet', 'da_nhan', 'tu_choi')),
  ngay_chuyen         TIMESTAMPTZ NOT NULL DEFAULT now(),
  phan_hoi_luc        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_task_transfers_task ON public.kpi_task_transfers(task_id);
CREATE INDEX IF NOT EXISTS idx_kpi_task_transfers_den_pending ON public.kpi_task_transfers(den_nguoi_id, trang_thai);
CREATE INDEX IF NOT EXISTS idx_kpi_task_transfers_tu_pending ON public.kpi_task_transfers(tu_nguoi_id, trang_thai);

ALTER TABLE public.kpi_task_transfers ENABLE ROW LEVEL SECURITY;

-- Đọc được nếu là người gửi/người nhận của chính yêu cầu đó, người giao của task liên quan,
-- admin, hoặc kpi.view_all.
DROP POLICY IF EXISTS "kpi_task_transfers_select" ON public.kpi_task_transfers;
CREATE POLICY "kpi_task_transfers_select" ON public.kpi_task_transfers
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      tu_nguoi_id = auth.uid()
      OR den_nguoi_id = auth.uid()
      OR public.kpi_is_task_owner(task_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR public.current_profile_has_permission('kpi.view_all')
    )
  );

-- KHÔNG có policy INSERT/UPDATE/DELETE cho client — chỉ 3 RPC SECURITY DEFINER bên dưới (chạy
-- với quyền chủ hàm, bỏ qua RLS) mới ghi được, đúng tinh thần "mọi thay đổi phải kèm validate
-- nghiệp vụ đầy đủ (còn hạn, chưa chuyển lần nào, đúng người...), không có đường ghi tay".

-- ── 2. Cho phép người ĐANG ĐƯỢC MỜI (chưa chấp nhận, chưa phải active member) xem được task ──
-- kpi_tasks_select hiện chỉ cho người giao/active member/admin/kpi.view_all — người nhận lời
-- mời chuyển giao chưa thuộc nhóm nào trong số đó nên sẽ bị chặn xem trang chi tiết (báo
-- "Không tìm thấy công việc") ngay cả khi có lời mời đang chờ họ phản hồi. Thêm 1 helper
-- SECURITY DEFINER (mirror kpi_is_task_owner/kpi_is_task_active_member) để tránh vòng tham
-- chiếu chéo RLS giữa kpi_tasks và kpi_task_transfers.
CREATE OR REPLACE FUNCTION public.kpi_is_task_pending_transfer_target(p_task_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.kpi_task_transfers
    WHERE task_id = p_task_id AND den_nguoi_id = p_user_id AND trang_thai = 'cho_duyet'
  );
$$;

REVOKE ALL ON FUNCTION public.kpi_is_task_pending_transfer_target(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_is_task_pending_transfer_target(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "kpi_tasks_select" ON public.kpi_tasks;
CREATE POLICY "kpi_tasks_select" ON public.kpi_tasks
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      nguoi_giao_id = auth.uid()
      OR public.kpi_is_task_active_member(id, auth.uid())
      OR public.kpi_is_task_pending_transfer_target(id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR public.current_profile_has_permission('kpi.view_all')
    )
  );

-- ── 3. Thêm 'chuyen_giao' vào CHECK constraint kpi_task_logs.hanh_dong ──────────
ALTER TABLE public.kpi_task_logs DROP CONSTRAINT IF EXISTS kpi_task_logs_hanh_dong_check;
ALTER TABLE public.kpi_task_logs ADD CONSTRAINT kpi_task_logs_hanh_dong_check
  CHECK (hanh_dong IN ('cap_nhat_tien_do', 'nop', 'nghiem_thu', 'dieu_chinh', 'tra_ve', 'yeu_cau_bo_sung', 'gan_ban_ghi', 'chuyen_giao'));

-- ── RPC 1: người đang phụ trách gửi yêu cầu chuyển giao ─────────────────────────
-- Chỉ chính người đang là thành viên ĐANG HOẠT ĐỘNG của task mới gọi được cho chính mình
-- (auth.uid() dùng trực tiếp, không tin tham số nào về danh tính).
CREATE OR REPLACE FUNCTION public.kpi_task_transfer_request(
  p_task_id UUID,
  p_den_nguoi_id UUID,
  p_ghi_chu TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_task RECORD;
  v_member RECORD;
  v_den RECORD;
  v_new_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
  END IF;
  IF p_den_nguoi_id IS NULL THEN
    RAISE EXCEPTION 'Vui lòng chọn người nhận.';
  END IF;
  IF p_den_nguoi_id = v_uid THEN
    RAISE EXCEPTION 'Không thể chuyển giao cho chính mình.';
  END IF;

  SELECT * INTO v_task FROM public.kpi_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy công việc.';
  END IF;
  IF v_task.trang_thai IN ('hoan_thanh', 'huy') THEN
    RAISE EXCEPTION 'Công việc đã kết thúc, không thể chuyển giao.';
  END IF;
  IF v_task.han_hoan_thanh < now() THEN
    RAISE EXCEPTION 'Công việc đã quá hạn, không thể chuyển giao.';
  END IF;
  IF v_task.da_chuyen_giao THEN
    RAISE EXCEPTION 'Công việc này đã được chuyển giao trước đó — mỗi việc chỉ chuyển được 1 lần.';
  END IF;

  SELECT * INTO v_member FROM public.kpi_task_members
    WHERE task_id = p_task_id AND user_id = v_uid AND is_active = true
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bạn không phải người đang phụ trách công việc này.';
  END IF;

  SELECT * INTO v_den FROM public.profiles WHERE id = p_den_nguoi_id AND status = 'active';
  IF NOT FOUND OR v_den.factory_id IS DISTINCT FROM v_task.factory_id THEN
    RAISE EXCEPTION 'Người nhận không hợp lệ.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.kpi_task_members
    WHERE task_id = p_task_id AND user_id = p_den_nguoi_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Người này đã đang phụ trách công việc.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.kpi_task_transfers
    WHERE task_id = p_task_id AND tu_nguoi_id = v_uid AND trang_thai = 'cho_duyet'
  ) THEN
    RAISE EXCEPTION 'Đã có 1 yêu cầu chuyển giao đang chờ phản hồi cho công việc này.';
  END IF;

  INSERT INTO public.kpi_task_transfers (
    factory_id, task_id, tu_nguoi_id, den_nguoi_id, tien_do_luc_chuyen, ghi_chu
  ) VALUES (
    v_task.factory_id, p_task_id, v_uid, p_den_nguoi_id, v_member.tien_do, NULLIF(trim(p_ghi_chu), '')
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_task_transfer_request(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_task_transfer_request(UUID, UUID, TEXT) TO authenticated;

-- ── RPC 2: người được mời chấp nhận/từ chối ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kpi_task_transfer_respond(
  p_transfer_id UUID,
  p_chap_nhan BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_transfer RECORD;
  v_task RECORD;
  v_existing_member RECORD;
  v_source_member RECORD;
  v_tu_ten TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
  END IF;

  SELECT * INTO v_transfer FROM public.kpi_task_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy yêu cầu chuyển giao.';
  END IF;
  IF v_transfer.den_nguoi_id <> v_uid THEN
    RAISE EXCEPTION 'Bạn không phải người được mời trong yêu cầu này.';
  END IF;
  IF v_transfer.trang_thai <> 'cho_duyet' THEN
    RAISE EXCEPTION 'Yêu cầu này đã được xử lý trước đó.';
  END IF;

  IF NOT p_chap_nhan THEN
    UPDATE public.kpi_task_transfers SET trang_thai = 'tu_choi', phan_hoi_luc = now() WHERE id = p_transfer_id;
    RETURN;
  END IF;

  SELECT * INTO v_task FROM public.kpi_tasks WHERE id = v_transfer.task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy công việc.';
  END IF;
  IF v_task.trang_thai IN ('hoan_thanh', 'huy') THEN
    RAISE EXCEPTION 'Công việc đã kết thúc, không thể nhận chuyển giao.';
  END IF;
  IF v_task.da_chuyen_giao THEN
    RAISE EXCEPTION 'Công việc này đã được chuyển giao trước đó.';
  END IF;

  SELECT * INTO v_source_member FROM public.kpi_task_members
    WHERE task_id = v_transfer.task_id AND user_id = v_transfer.tu_nguoi_id AND is_active = true
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Người chuyển giao không còn phụ trách công việc này.';
  END IF;

  UPDATE public.kpi_task_members SET is_active = false, updated_at = now() WHERE id = v_source_member.id;

  -- Nếu người nhận từng có 1 dòng thành viên cũ (vd đã bị chuyển đi trước đó ở lần khác — hiếm
  -- vì mỗi task chỉ chuyển 1 lần, nhưng UNIQUE(task_id, user_id) buộc phải xử lý an toàn cả 2
  -- nhánh): cập nhật lại thay vì insert trùng khóa.
  SELECT * INTO v_existing_member FROM public.kpi_task_members
    WHERE task_id = v_transfer.task_id AND user_id = v_uid
    FOR UPDATE;
  IF FOUND THEN
    UPDATE public.kpi_task_members
      SET is_active = true, tien_do = v_transfer.tien_do_luc_chuyen, phan_loai = v_source_member.phan_loai, updated_at = now()
      WHERE id = v_existing_member.id;
  ELSE
    INSERT INTO public.kpi_task_members (task_id, factory_id, user_id, tien_do, phan_loai, is_active)
      VALUES (v_transfer.task_id, v_task.factory_id, v_uid, v_transfer.tien_do_luc_chuyen, v_source_member.phan_loai, true);
  END IF;

  UPDATE public.kpi_tasks SET da_chuyen_giao = true, updated_at = now() WHERE id = v_transfer.task_id;
  UPDATE public.kpi_task_transfers SET trang_thai = 'da_nhan', phan_hoi_luc = now() WHERE id = p_transfer_id;

  SELECT COALESCE(full_name, username, id::text) INTO v_tu_ten FROM public.profiles WHERE id = v_transfer.tu_nguoi_id;

  INSERT INTO public.kpi_task_logs (
    task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong, tien_do_truoc, tien_do_sau, noi_dung
  ) VALUES (
    v_transfer.task_id, v_task.factory_id, v_uid, v_uid, 'chuyen_giao', NULL, v_transfer.tien_do_luc_chuyen,
    'Đã nhận chuyển giao từ ' || COALESCE(v_tu_ten, 'người dùng khác')
      || CASE WHEN v_transfer.ghi_chu IS NOT NULL THEN ' — Ghi chú: ' || v_transfer.ghi_chu ELSE '' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_task_transfer_respond(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_task_transfer_respond(UUID, BOOLEAN) TO authenticated;

-- ── RPC 3: người gửi tự hủy yêu cầu đang chờ (chưa được phản hồi) ───────────────
CREATE OR REPLACE FUNCTION public.kpi_task_transfer_cancel(p_transfer_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_transfer RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
  END IF;
  SELECT * INTO v_transfer FROM public.kpi_task_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy yêu cầu chuyển giao.';
  END IF;
  IF v_transfer.tu_nguoi_id <> v_uid THEN
    RAISE EXCEPTION 'Bạn không phải người đã gửi yêu cầu này.';
  END IF;
  IF v_transfer.trang_thai <> 'cho_duyet' THEN
    RAISE EXCEPTION 'Yêu cầu này đã được xử lý, không thể hủy.';
  END IF;
  UPDATE public.kpi_task_transfers SET trang_thai = 'tu_choi', phan_hoi_luc = now() WHERE id = p_transfer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_task_transfer_cancel(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_task_transfer_cancel(UUID) TO authenticated;
