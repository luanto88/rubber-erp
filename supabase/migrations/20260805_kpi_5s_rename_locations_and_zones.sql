-- Module KPI — sửa nhầm lẫn tầng khái niệm: bảng `kpi_5s_zones` cũ (PGĐ, PH01... mỗi dòng
-- có 1 QR riêng để chấm điểm hàng tuần) thực chất là tầng NHỎ — đổi tên đúng nghĩa thành
-- "Vị trí" (`kpi_5s_locations`). "Khu vực" (Văn phòng, Kho 1, Kho 2, Ca SX mủ tạp, Ca SX
-- mủ nước...) mới đúng là tầng LỚN chứa nhiều vị trí bên trong — bảng MỚI, tái dùng đúng
-- tên `kpi_5s_zones` vừa được giải phóng sau khi rename tầng nhỏ.
-- Xem đầy đủ .claude/rules/27-kpi-module.md.
--
-- Cần chạy SAU 4 migration đã chạy: 20260801, 20260802, 20260803, 20260804.
--
-- QUAN TRỌNG: RPC `kpi_5s_evaluation_correct` (20260802) có RAW SQL TEXT tham chiếu trực
-- tiếp cột `kpi_appeals.zone_evaluation_id` — khác với RLS POLICY (tự cascade theo rename
-- vì lưu dạng parsed expression tree gắn OID), function body PL/pgSQL KHÔNG tự cập nhật
-- theo rename — migration này BẮT BUỘC phải CREATE OR REPLACE lại hàm đó, nếu bỏ sót sẽ
-- lỗi "column zone_evaluation_id does not exist" ngay lần đầu gọi sau migration.

-- ══════════════════════ PHẦN 1 — RENAME TẦNG NHỎ: zones → locations ══════════════════════

ALTER TABLE public.kpi_5s_zones RENAME TO kpi_5s_locations;
ALTER TABLE public.kpi_5s_locations RENAME COLUMN ma_khu_vuc TO ma_vi_tri;
ALTER TABLE public.kpi_5s_locations RENAME COLUMN ten_khu_vuc TO ten_vi_tri;
ALTER TABLE public.kpi_5s_locations RENAME COLUMN vi_tri_mo_ta TO mo_ta;
-- Cột thêm ở 20260804 (thiết kế "tái dùng personnel_groups" đã huỷ) — xác nhận cả 2 vị
-- trí test (PGĐ, PH01) vẫn NULL, xoá an toàn không mất dữ liệu.
ALTER TABLE public.kpi_5s_locations DROP COLUMN IF EXISTS eligible_group_id;

ALTER TABLE public.kpi_5s_evaluations RENAME COLUMN zone_id TO location_id;
ALTER TABLE public.kpi_appeals RENAME COLUMN zone_evaluation_id TO location_evaluation_id;

ALTER INDEX IF EXISTS idx_kpi_5s_zones_factory_active RENAME TO idx_kpi_5s_locations_factory_active;
ALTER INDEX IF EXISTS idx_kpi_5s_evaluations_zone RENAME TO idx_kpi_5s_evaluations_location;

-- Recreate tường minh mọi RLS policy/trigger có thể chạm tên bảng/cột vừa đổi — không tin
-- tưởng tuyệt đối vào auto-cascade, đúng convention đã dùng xuyên suốt module này.
DROP POLICY IF EXISTS "kpi_5s_zones_select" ON public.kpi_5s_locations;
CREATE POLICY "kpi_5s_locations_select" ON public.kpi_5s_locations
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "kpi_5s_zones_insert" ON public.kpi_5s_locations;
CREATE POLICY "kpi_5s_locations_insert" ON public.kpi_5s_locations
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP POLICY IF EXISTS "kpi_5s_zones_update" ON public.kpi_5s_locations;
CREATE POLICY "kpi_5s_locations_update" ON public.kpi_5s_locations
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP POLICY IF EXISTS "kpi_5s_zones_delete" ON public.kpi_5s_locations;
CREATE POLICY "kpi_5s_locations_delete" ON public.kpi_5s_locations
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP TRIGGER IF EXISTS trg_kpi_5s_zones_updated_at ON public.kpi_5s_locations;
CREATE TRIGGER trg_kpi_5s_locations_updated_at
  BEFORE UPDATE ON public.kpi_5s_locations
  FOR EACH ROW EXECUTE FUNCTION public.kpi_tasks_set_updated_at();

-- kpi_5s_evaluations_select không tham chiếu bảng/cột đổi tên — không cần recreate.
-- kpi_5s_evaluations_insert tham chiếu CẢ bảng kpi_5s_zones (đã đổi tên) LẪN cột location_id
-- (đã đổi tên trên chính bảng kpi_5s_evaluations) — recreate tường minh.
DROP POLICY IF EXISTS "kpi_5s_evaluations_insert" ON public.kpi_5s_evaluations;
CREATE POLICY "kpi_5s_evaluations_insert" ON public.kpi_5s_evaluations
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND nguoi_cham_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.kpi_5s_locations loc
      WHERE loc.id = location_id
        AND loc.factory_id = kpi_5s_evaluations.factory_id
        AND loc.nguoi_cham_id = auth.uid()
        AND loc.is_active = true
    )
  );

-- kpi_appeals_select/_update không tham chiếu cột đổi tên — không cần recreate.
-- kpi_appeals_insert tham chiếu cột location_evaluation_id (same-table rename — RLS trên
-- chính bảng này tự cascade, nhưng recreate tường minh cho nhất quán + rõ ràng khi đọc lại).
DROP POLICY IF EXISTS "kpi_appeals_insert" ON public.kpi_appeals;
CREATE POLICY "kpi_appeals_insert" ON public.kpi_appeals
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND nguoi_khieu_nai_id = auth.uid()
    AND (
      (task_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.kpi_tasks t
        WHERE t.id = task_id AND (
          t.nguoi_giao_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.kpi_task_members m WHERE m.task_id = t.id AND m.user_id = auth.uid())
        )
      ))
      OR (location_evaluation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.kpi_5s_evaluations e
        WHERE e.id = location_evaluation_id AND e.nguoi_don_id = auth.uid()
      ))
    )
  );

-- RPC kpi_5s_evaluation_correct — CREATE OR REPLACE bắt buộc (xem giải thích ở đầu file).
-- Đổi luôn tên tham số p_zone_evaluation_id → p_location_evaluation_id cho nhất quán.
-- QUAN TRỌNG: dù cùng danh sách KIỂU tham số (UUID,TEXT,TEXT,TEXT,UUID) — đủ để CREATE OR
-- REPLACE thay đúng hàm cũ theo identity, không tạo overload mới — Postgres vẫn CHẶN đổi
-- TÊN tham số qua CREATE OR REPLACE (khác khả năng đổi return type/body), bắt buộc DROP
-- FUNCTION trước nếu muốn đổi tên tham số.
DROP FUNCTION IF EXISTS public.kpi_5s_evaluation_correct(UUID, TEXT, TEXT, TEXT, UUID);

CREATE FUNCTION public.kpi_5s_evaluation_correct(
  p_location_evaluation_id UUID,
  p_new_ket_qua TEXT,
  p_new_ly_do TEXT,
  p_ghi_chu TEXT,
  p_appeal_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_eval RECORD;
  v_is_admin BOOLEAN;
  v_has_perm BOOLEAN;
  v_old_label TEXT;
  v_new_label TEXT;
  v_audit_text TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;

  SELECT (role = 'admin') INTO v_is_admin FROM public.profiles WHERE id = v_uid;
  v_has_perm := public.current_profile_has_permission('kpi.manage_config');
  IF NOT (COALESCE(v_is_admin, false) OR v_has_perm) THEN
    RAISE EXCEPTION 'Chỉ admin hoặc người quản trị KPI mới được sửa kết quả 5S.';
  END IF;

  SELECT * INTO v_eval FROM public.kpi_5s_evaluations WHERE id = p_location_evaluation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy lần chấm điểm này.';
  END IF;

  IF p_new_ket_qua IS NULL OR trim(p_new_ket_qua) = '' THEN
    RAISE EXCEPTION 'Vui lòng chọn kết quả.';
  END IF;
  IF p_new_ket_qua <> 'dat' AND (p_new_ly_do IS NULL OR trim(p_new_ly_do) = '') THEN
    RAISE EXCEPTION 'Vui lòng nhập lý do khi kết quả không phải Đạt.';
  END IF;

  v_old_label := CASE v_eval.ket_qua
    WHEN 'dat' THEN 'Đạt' WHEN 'tuong_doi' THEN 'Tương đối' WHEN 'khong_dat' THEN 'Không đạt'
    ELSE v_eval.ket_qua END;
  v_new_label := CASE p_new_ket_qua
    WHEN 'dat' THEN 'Đạt' WHEN 'tuong_doi' THEN 'Tương đối' WHEN 'khong_dat' THEN 'Không đạt'
    ELSE p_new_ket_qua END;
  v_audit_text := CASE WHEN v_eval.ket_qua = p_new_ket_qua
    THEN 'Giữ nguyên kết quả gốc: ' || v_old_label || '.'
    ELSE 'Đã đổi kết quả từ "' || v_old_label || '" sang "' || v_new_label || '".' END;

  UPDATE public.kpi_5s_evaluations
  SET ket_qua = p_new_ket_qua, ly_do = NULLIF(trim(p_new_ly_do), '')
  WHERE id = p_location_evaluation_id;

  IF p_appeal_id IS NOT NULL THEN
    UPDATE public.kpi_appeals
    SET trang_thai = 'da_giai_quyet',
        phan_hoi = trim(COALESCE(p_ghi_chu, '') || E'\n' || v_audit_text),
        nguoi_xu_ly_id = v_uid,
        updated_at = now()
    WHERE id = p_appeal_id
      AND location_evaluation_id = p_location_evaluation_id
      AND trang_thai = 'cho_xu_ly';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khiếu nại này không còn ở trạng thái chờ xử lý (có thể đã được xử lý bởi người khác).';
    END IF;
  ELSE
    INSERT INTO public.kpi_appeals (factory_id, location_evaluation_id, nguoi_khieu_nai_id, noi_dung, trang_thai, phan_hoi, nguoi_xu_ly_id)
    VALUES (
      v_eval.factory_id, p_location_evaluation_id, v_uid,
      'Admin tự sửa kết quả (không qua khiếu nại).',
      'da_giai_quyet',
      trim(COALESCE(p_ghi_chu, '') || E'\n' || v_audit_text),
      v_uid
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_5s_evaluation_correct(UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_5s_evaluation_correct(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ══════════════ PHẦN 2 — TẠO "KHU VỰC" (tầng lớn), tái dùng tên vừa giải phóng ══════════════

CREATE TABLE public.kpi_5s_zones (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id  UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  ten         TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table-level UNIQUE(...) chỉ nhận tên cột thô, không nhận biểu thức như lower(ten) —
-- phải dùng unique index riêng (mirror required_notes/personnel_groups/lots).
CREATE UNIQUE INDEX uniq_kpi_5s_zones_factory_ten_lower ON public.kpi_5s_zones(factory_id, lower(ten));
CREATE INDEX idx_kpi_5s_zones_factory_active ON public.kpi_5s_zones(factory_id, is_active);

ALTER TABLE public.kpi_5s_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kpi_5s_zones_select" ON public.kpi_5s_zones
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "kpi_5s_zones_insert" ON public.kpi_5s_zones
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

CREATE POLICY "kpi_5s_zones_update" ON public.kpi_5s_zones
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

CREATE POLICY "kpi_5s_zones_delete" ON public.kpi_5s_zones
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

CREATE TRIGGER trg_kpi_5s_zones_updated_at
  BEFORE UPDATE ON public.kpi_5s_zones
  FOR EACH ROW EXECUTE FUNCTION public.kpi_tasks_set_updated_at();

-- Thành viên đủ điều kiện random trong nội bộ 1 khu vực — dùng user_id (auth.users) trực
-- tiếp, KHÔNG dùng staff_id (maintenance_staff) như personnel_group_members, để nhất quán
-- với toàn bộ model candidate của KPI (kpi_5s_locations.nguoi_don_id, kpi_task_members.user_id).
CREATE TABLE public.kpi_5s_zone_members (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id  UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  zone_id     UUID NOT NULL REFERENCES public.kpi_5s_zones(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(zone_id, user_id)
);

CREATE INDEX idx_kpi_5s_zone_members_zone ON public.kpi_5s_zone_members(zone_id);
CREATE INDEX idx_kpi_5s_zone_members_factory ON public.kpi_5s_zone_members(factory_id);

ALTER TABLE public.kpi_5s_zone_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kpi_5s_zone_members_select" ON public.kpi_5s_zone_members
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "kpi_5s_zone_members_insert" ON public.kpi_5s_zone_members
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

CREATE POLICY "kpi_5s_zone_members_delete" ON public.kpi_5s_zone_members
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.current_profile_has_permission('kpi.manage_config')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- 1 vị trí (PGĐ, PH01...) thuộc 0 hoặc 1 khu vực — dùng để giới hạn pool "Phân công thông
-- minh" chỉ random trong nội bộ khu vực đó. NULL = không giới hạn (pool toàn nhà máy).
ALTER TABLE public.kpi_5s_locations
  ADD COLUMN zone_id UUID REFERENCES public.kpi_5s_zones(id) ON DELETE SET NULL;
