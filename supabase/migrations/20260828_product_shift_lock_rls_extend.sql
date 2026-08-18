-- Mở rộng RLS UPDATE của lot_transactions/lots để chặn cả đường ghi trực tiếp bằng browser
-- client (authenticated, KHÔNG bypass RLS) khi (ngày, ca) đã bị khóa — đây là lớp phòng thủ
-- thật cho luồng "Sửa theo ngày" (handleDateHeaderSave, src/app/dashboard/product/page.tsx),
-- đường ghi DUY NHẤT trong toàn bộ module Thành phẩm không chạy qua service-role/RPC
-- SECURITY DEFINER (xem chú thích đầy đủ trong 20260824_rls_lockdown_lot_transactions.sql).
-- Mọi đường ghi khác (server action service-role, RPC SECURITY DEFINER) đã được chặn ở tầng
-- guard JS/SQL riêng (xem 20260828_product_shift_lock_guards.sql) — RLS ở đây không ảnh hưởng
-- chúng vì chúng bypass RLS hoàn toàn.
--
-- current_profile_role() đã có sẵn từ 20260429_auth_profiles_permissions.sql — không cần viết
-- hàm mới.

DROP POLICY IF EXISTS "lot_transactions_update" ON lot_transactions;
CREATE POLICY "lot_transactions_update" ON lot_transactions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lots l
      WHERE l.id = lot_transactions.lot_id
        AND l.factory_id = public.current_profile_factory_id()
    )
    AND (
      public.current_profile_role() = 'admin'
      OR NOT public.product_shift_is_locked(
        public.current_profile_factory_id(), lot_transactions.ngay_nhap, lot_transactions.ca
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lots l
      WHERE l.id = lot_transactions.lot_id
        AND l.factory_id = public.current_profile_factory_id()
    )
    AND (
      public.current_profile_role() = 'admin'
      OR NOT public.product_shift_is_locked(
        public.current_profile_factory_id(), lot_transactions.ngay_nhap, lot_transactions.ca
      )
    )
  );

DROP POLICY IF EXISTS "lots_update" ON lots;
CREATE POLICY "lots_update" ON lots
  FOR UPDATE TO authenticated
  USING (
    factory_id = public.current_profile_factory_id()
    AND (
      public.current_profile_role() = 'admin'
      OR NOT public.product_shift_is_locked(factory_id, ngay_sx, ca)
    )
  )
  WITH CHECK (
    factory_id = public.current_profile_factory_id()
    AND (
      public.current_profile_role() = 'admin'
      OR NOT public.product_shift_is_locked(factory_id, ngay_sx, ca)
    )
  );
