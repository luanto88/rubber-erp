-- Module KPI — "Gắn bản ghi tại chỗ" (in-context evidence linking), THAY THẾ hoàn toàn ý
-- tưởng "auto-complete ngầm" (code tự dò hành động nghiệp vụ) đã bị loại bỏ khỏi thiết kế.
-- Xem đầy đủ .claude/rules/27-kpi-module.md.
--
-- Nguyên lý: sau khi người dùng lưu thành công 1 bản ghi nghiệp vụ (phiếu điều xe, phiếu sản
-- lượng, phiếu KN, ngăn lưu, giao dịch thành phẩm...), UI hỏi họ có muốn GẮN bản ghi đó vào 1
-- công việc KPI đang mở của chính họ hôm nay không — người dùng TỰ XÁC NHẬN bằng 1 cú click,
-- không có gì tự động ngầm. Bằng chứng lưu lại là con trỏ tới bản ghi thật (module_code +
-- record_id + record_url), không phải suy luận/ảnh chụp màn hình.
--
-- Phạm vi migration này CHƯA đụng tới `kpi_task_templates` (Việc định kỳ) — bảng đó chưa tồn
-- tại, sẽ xây ở phiên sau. Component chọn việc hiện tại luôn cho người dùng TỰ CHỌN từ danh
-- sách việc đang mở hôm nay (không có "gợi ý khớp sẵn" — nhánh đó cần `auto_action_type` từ
-- `kpi_task_templates`, sẽ nối thêm khi bảng đó ra đời).

-- ── 1. kpi_task_evidence_links ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kpi_task_evidence_links (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id      UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  task_id         UUID NOT NULL REFERENCES public.kpi_tasks(id) ON DELETE CASCADE,
  member_user_id  UUID NOT NULL REFERENCES auth.users(id),       -- ai gắn (auth.uid lúc gắn)
  module_code     TEXT NOT NULL,   -- "dispatch:create" | "output:save" | "quality:create" | ...
  record_id       TEXT NOT NULL,   -- id bản ghi nghiệp vụ thật (UUID dạng text hoặc mã khác)
  record_label    TEXT NOT NULL,   -- mã hiển thị, vd "XH-240724/007"
  record_url      TEXT,            -- đường dẫn nhảy tới bản ghi
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, module_code, record_id)   -- 1 bản ghi chỉ gắn 1 lần vào 1 việc
);

CREATE INDEX IF NOT EXISTS idx_kpi_task_evidence_links_task ON public.kpi_task_evidence_links(task_id);
CREATE INDEX IF NOT EXISTS idx_kpi_task_evidence_links_member ON public.kpi_task_evidence_links(member_user_id, created_at DESC);

ALTER TABLE public.kpi_task_evidence_links ENABLE ROW LEVEL SECURITY;

-- Đọc theo người liên quan (chính người gắn, người giao task, thành viên đang phụ trách),
-- admin, hoặc kpi.view_all — mirror đúng policy kpi_task_logs_select đã có.
DROP POLICY IF EXISTS "kpi_task_evidence_links_select" ON public.kpi_task_evidence_links;
CREATE POLICY "kpi_task_evidence_links_select" ON public.kpi_task_evidence_links
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      member_user_id = auth.uid()
      OR public.kpi_is_task_owner(task_id, auth.uid())
      OR public.kpi_is_task_active_member(task_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR public.current_profile_has_permission('kpi.view_all')
    )
  );

-- KHÔNG có policy INSERT/UPDATE/DELETE cho client — chỉ RPC SECURITY DEFINER bên dưới (chạy
-- với quyền chủ hàm, bỏ qua RLS) mới ghi được, đúng tinh thần "bằng chứng gắn qua xác nhận
-- của chính người phụ trách, không ai chèn tay được".

-- ── 2. Thêm 'gan_ban_ghi' vào CHECK constraint kpi_task_logs.hanh_dong ──────────
ALTER TABLE public.kpi_task_logs DROP CONSTRAINT IF EXISTS kpi_task_logs_hanh_dong_check;
ALTER TABLE public.kpi_task_logs ADD CONSTRAINT kpi_task_logs_hanh_dong_check
  CHECK (hanh_dong IN ('cap_nhat_tien_do','nop','nghiem_thu','dieu_chinh','tra_ve','yeu_cau_bo_sung','gan_ban_ghi'));

-- ── 3. RPC kpi_task_link_and_complete — gắn bằng chứng + hoàn thành ngay ────────
-- Chỉ chính người đang là thành viên ĐANG HOẠT ĐỘNG (is_active=true) của task mới gọi được
-- cho chính mình (auth.uid() dùng trực tiếp, không tin tham số nào về danh tính). Không qua
-- bước "chờ nghiệm thu" — bản ghi nghiệp vụ thật (con trỏ tới DB) đã là bằng chứng đủ mạnh,
-- đúng nguyên tắc đã chốt khi thiết kế (khác hẳn "nộp" bình thường vẫn cần người giao duyệt).
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

  UPDATE public.kpi_task_members
    SET tien_do = 100,
        tien_do_nghiem_thu = 100,
        da_nop_luc = COALESCE(da_nop_luc, now()),
        updated_at = now()
    WHERE id = v_member.id;

  INSERT INTO public.kpi_task_logs (
    task_id, factory_id, member_user_id, nguoi_thuc_hien_id, hanh_dong,
    tien_do_truoc, tien_do_sau, noi_dung
  ) VALUES (
    p_task_id, v_task.factory_id, v_uid, v_uid, 'gan_ban_ghi',
    v_prev, 100, 'Gắn ' || p_record_label || ' (module: ' || p_module_code || ')'
  );

  UPDATE public.kpi_tasks SET trang_thai = 'hoan_thanh', updated_at = now() WHERE id = p_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_task_link_and_complete(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_task_link_and_complete(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
