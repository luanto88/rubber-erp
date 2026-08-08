-- Fix: policy "admin can manage forest_plots" (20260520_forest_plots.sql) cho phép
-- BẤT KỲ admin của BẤT KỲ nhà máy nào thêm/sửa/xóa polygon GPS lô vườn của nhà máy khác —
-- vi phạm invariant multi-tenant ("Không hiển thị hoặc thao tác dữ liệu khác nhà máy đang
-- đăng nhập", CLAUDE.md mục Invariant bắt buộc #1). Policy SELECT ("factory members can
-- read forest_plots") vốn đã scope đúng theo factory_id qua auth.uid() — chỉ riêng policy
-- quản trị (FOR ALL) là thiếu điều kiện này.
--
-- Dùng lại current_profile_factory_id() (SECURITY DEFINER, có sẵn từ
-- 20260429_auth_profiles_permissions.sql) thay vì subquery profiles trực tiếp, cho nhất
-- quán với các policy factory-scope mới hơn trong codebase.

DROP POLICY IF EXISTS "admin can manage forest_plots" ON forest_plots;
CREATE POLICY "admin can manage forest_plots"
  ON forest_plots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
    AND factory_id = public.current_profile_factory_id()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
    AND factory_id = public.current_profile_factory_id()
  );
