-- Phase 1a — Module "Quản lý công việc & Đánh giá KPI nhân viên": Giao việc (A + B)
-- Xem đầy đủ kiến trúc/roadmap tại .claude/rules/27-kpi-module.md
--
-- Lệch nhỏ so với schema phác thảo ban đầu trong rule (đã ghi lại khi cập nhật rule):
-- thêm cột `factory_id` vào kpi_task_logs (rule gốc không liệt kê cột này) để tuân thủ
-- invariant bắt buộc "mọi bảng đều có factory_id, mọi query đều filter theo factory_id"
-- (CLAUDE.md mục "Invariant bắt buộc" #1) — tránh phải JOIN qua kpi_tasks mỗi lần lọc theo
-- nhà máy, đồng thời cho phép RLS SELECT của kpi_task_logs tự lọc factory mà không cần gọi
-- thêm 1 lượt tra cứu chéo bảng.

-- ── 1. kpi_tasks — chứng từ giao việc ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kpi_tasks (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id        UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  ma_cong_viec      TEXT,
  tieu_de           TEXT NOT NULL,
  mo_ta             TEXT,
  nguoi_giao_id     UUID NOT NULL REFERENCES auth.users(id),
  ngay_giao         DATE NOT NULL DEFAULT CURRENT_DATE,
  han_hoan_thanh    TIMESTAMPTZ NOT NULL,
  yeu_cau_bao_cao   TEXT[] NOT NULL DEFAULT '{}',
  da_chuyen_giao    BOOLEAN NOT NULL DEFAULT false,
  trang_thai        TEXT NOT NULL DEFAULT 'moi_giao'
    CHECK (trang_thai IN ('moi_giao','dang_thuc_hien','cho_nghiem_thu','hoan_thanh','tra_ve','huy')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_tasks_factory_han ON public.kpi_tasks(factory_id, han_hoan_thanh);
CREATE INDEX IF NOT EXISTS idx_kpi_tasks_nguoi_giao ON public.kpi_tasks(nguoi_giao_id);
CREATE INDEX IF NOT EXISTS idx_kpi_tasks_factory_trang_thai ON public.kpi_tasks(factory_id, trang_thai);

-- ── 2. kpi_task_members — mỗi dòng = 1 người phụ trách (hiện tại hoặc lịch sử) ──
CREATE TABLE IF NOT EXISTS public.kpi_task_members (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id             UUID NOT NULL REFERENCES public.kpi_tasks(id) ON DELETE CASCADE,
  factory_id          UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id),
  tien_do             INTEGER NOT NULL DEFAULT 0 CHECK (tien_do >= 0 AND tien_do <= 100),
  tien_do_nghiem_thu  INTEGER CHECK (tien_do_nghiem_thu IS NULL OR (tien_do_nghiem_thu >= 0 AND tien_do_nghiem_thu <= 100)),
  da_nop_luc          TIMESTAMPTZ,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_task_members_user ON public.kpi_task_members(user_id);
CREATE INDEX IF NOT EXISTS idx_kpi_task_members_task ON public.kpi_task_members(task_id);
CREATE INDEX IF NOT EXISTS idx_kpi_task_members_factory ON public.kpi_task_members(factory_id);

-- ── 3. kpi_task_logs — audit trail BẤT BIẾN, chỉ insert qua 2 RPC bên dưới ──────
CREATE TABLE IF NOT EXISTS public.kpi_task_logs (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id             UUID NOT NULL REFERENCES public.kpi_tasks(id) ON DELETE CASCADE,
  factory_id          UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  member_user_id      UUID NOT NULL REFERENCES auth.users(id),
  nguoi_thuc_hien_id  UUID NOT NULL REFERENCES auth.users(id),
  hanh_dong           TEXT NOT NULL
    CHECK (hanh_dong IN ('cap_nhat_tien_do','nop','nghiem_thu','dieu_chinh','tra_ve','yeu_cau_bo_sung')),
  tien_do_truoc       INTEGER,
  tien_do_sau         INTEGER,
  noi_dung            TEXT,
  image_urls          TEXT[] NOT NULL DEFAULT '{}',
  file_urls           TEXT[] NOT NULL DEFAULT '{}',
  vi_do               NUMERIC,
  kinh_do             NUMERIC,
  dia_diem_text       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_task_logs_task_created ON public.kpi_task_logs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_task_logs_member ON public.kpi_task_logs(member_user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.kpi_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_task_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_task_logs ENABLE ROW LEVEL SECURITY;

-- kpi_tasks (SELECT) cần tra kpi_task_members (đang là active member không) và
-- kpi_task_members (SELECT) cần tra kpi_tasks (có phải người giao không) — 2 chiều tham
-- chiếu chéo giữa 2 bảng đều bật RLS sẽ gây "infinite recursion detected in policy" của
-- Postgres. Mirror đúng cách sửa đã dùng ở operation_notes/operation_note_shares
-- (.claude/rules/26-operation-notes-module.md): đưa phần tra cứu chéo vào hàm
-- SECURITY DEFINER, chạy với quyền chủ hàm nên không kích hoạt lại RLS của bảng kia.
CREATE OR REPLACE FUNCTION public.kpi_is_task_owner(p_task_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.kpi_tasks WHERE id = p_task_id AND nguoi_giao_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.kpi_is_task_active_member(p_task_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.kpi_task_members
    WHERE task_id = p_task_id AND user_id = p_user_id AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.kpi_is_task_owner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_is_task_owner(UUID, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.kpi_is_task_active_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_is_task_active_member(UUID, UUID) TO authenticated;

-- kpi_tasks: thấy được nếu là người giao, là thành viên đang phụ trách, admin, hoặc có
-- quyền kpi.view_all (tái dùng current_profile_has_permission từ
-- 20260721_production_records_permission_rls.sql).
DROP POLICY IF EXISTS "kpi_tasks_select" ON public.kpi_tasks;
CREATE POLICY "kpi_tasks_select" ON public.kpi_tasks
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      nguoi_giao_id = auth.uid()
      OR public.kpi_is_task_active_member(id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR public.current_profile_has_permission('kpi.view_all')
    )
  );

-- Chỉ người có quyền kpi.assign (hoặc admin) mới tạo được task, và luôn đứng tên chính
-- mình làm người giao (không được giả mạo nguoi_giao_id của người khác).
DROP POLICY IF EXISTS "kpi_tasks_insert" ON public.kpi_tasks;
CREATE POLICY "kpi_tasks_insert" ON public.kpi_tasks
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND nguoi_giao_id = auth.uid()
    AND (
      public.current_profile_has_permission('kpi.assign')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- Sửa thông tin/hủy task: chỉ người giao hoặc admin. Các transition trạng thái theo luồng
-- nghiệp vụ (nộp/nghiệm thu/điều chỉnh/trả về/yêu cầu bổ sung) đi qua 2 RPC SECURITY DEFINER
-- bên dưới (bỏ qua RLS này) — policy này chỉ phục vụ sửa metadata/hủy task trực tiếp.
DROP POLICY IF EXISTS "kpi_tasks_update" ON public.kpi_tasks;
CREATE POLICY "kpi_tasks_update" ON public.kpi_tasks
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      nguoi_giao_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- kpi_task_members: thấy được nếu là chính mình, là người giao của task đó, admin, hoặc
-- kpi.view_all.
DROP POLICY IF EXISTS "kpi_task_members_select" ON public.kpi_task_members;
CREATE POLICY "kpi_task_members_select" ON public.kpi_task_members
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      user_id = auth.uid()
      OR public.kpi_is_task_owner(task_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR public.current_profile_has_permission('kpi.view_all')
    )
  );

-- Chỉ người giao (đã tạo task trước đó, id đã tồn tại thật) hoặc admin được thêm thành
-- viên vào task.
DROP POLICY IF EXISTS "kpi_task_members_insert" ON public.kpi_task_members;
CREATE POLICY "kpi_task_members_insert" ON public.kpi_task_members
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.kpi_is_task_owner(task_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- Không có policy UPDATE/DELETE trực tiếp cho kpi_task_members — mọi thay đổi tien_do/
-- tien_do_nghiem_thu/da_nop_luc/is_active đều đi qua 2 RPC SECURITY DEFINER bên dưới, đảm
-- bảo mỗi lần đổi số liệu luôn kèm đúng 1 dòng kpi_task_logs bất biến tương ứng (không có
-- đường nào âm thầm sửa tiến độ mà không để lại vết).

-- kpi_task_logs: đọc được nếu liên quan tới task (owner/active member/chính người trong
-- log/admin/kpi.view_all). KHÔNG có policy INSERT/UPDATE/DELETE cho client — chỉ 2 RPC
-- SECURITY DEFINER (chạy với quyền chủ hàm, bỏ qua RLS) mới ghi được, đúng tinh thần
-- "audit trail bất biến, insert-only".
DROP POLICY IF EXISTS "kpi_task_logs_select" ON public.kpi_task_logs;
CREATE POLICY "kpi_task_logs_select" ON public.kpi_task_logs
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      member_user_id = auth.uid()
      OR nguoi_thuc_hien_id = auth.uid()
      OR public.kpi_is_task_owner(task_id, auth.uid())
      OR public.kpi_is_task_active_member(task_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR public.current_profile_has_permission('kpi.view_all')
    )
  );

-- ── updated_at tự động ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kpi_tasks_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kpi_tasks_updated_at ON public.kpi_tasks;
CREATE TRIGGER trg_kpi_tasks_updated_at
  BEFORE UPDATE ON public.kpi_tasks
  FOR EACH ROW EXECUTE FUNCTION public.kpi_tasks_set_updated_at();

DROP TRIGGER IF EXISTS trg_kpi_task_members_updated_at ON public.kpi_task_members;
CREATE TRIGGER trg_kpi_task_members_updated_at
  BEFORE UPDATE ON public.kpi_task_members
  FOR EACH ROW EXECUTE FUNCTION public.kpi_tasks_set_updated_at();

-- ── RPC 1: thành viên tự cập nhật tiến độ / nộp ─────────────────────────────
-- Chỉ chính người đang là thành viên ĐANG HOẠT ĐỘNG (is_active=true) của task mới gọi
-- được cho chính mình — auth.uid() được dùng trực tiếp làm định danh actor, KHÔNG nhận
-- qua tham số (tránh giả mạo danh tính vì hàm chạy SECURITY DEFINER, bỏ qua RLS).
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

-- ── RPC 2: người giao (hoặc admin) xử lý bản nộp ────────────────────────────
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

REVOKE ALL ON FUNCTION public.kpi_task_evaluate(UUID, UUID, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_task_evaluate(UUID, UUID, TEXT, INTEGER, TEXT) TO authenticated;
