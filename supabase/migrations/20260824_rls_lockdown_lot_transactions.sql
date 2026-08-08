-- Bật RLS cho `lot_transactions` — bảng DUY NHẤT trong toàn hệ thống chưa từng có
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` ở bất kỳ migration nào (grep toàn bộ
-- supabase/migrations/ xác nhận). Trước migration này, bảng hoàn toàn không có RLS —
-- không chỉ đọc mà cả INSERT/UPDATE/DELETE trực tiếp bằng anon key (chưa đăng nhập)
-- cũng không bị chặn. Xem memory `security_rls_allow_all_gap` mục "Việc CÒN LẠI" để
-- biết bối cảnh đầy đủ.
--
-- Audit trước khi viết migration này (đã rà toàn bộ 28+ file tham chiếu `lot_transactions`):
--   - MỌI đường ghi (INSERT/UPDATE/DELETE) qua RPC (`sync_lot_master_snapshot`,
--     `delete_lot_transaction`, `delete_orphan_lot`, `submit_confirm_draft_batch`,
--     `sync_ngan_production_status`) hoặc qua Next.js Server Action ("use server" +
--     `getSupabaseAdmin()` trong `product/actions.ts`, `product/confirm/actions.ts`,
--     `product/predict/actions.ts`) — TẤT CẢ đều chạy bằng service_role (bypass RLS
--     hoàn toàn, không phụ thuộc policy nào ở đây) hoặc bằng RPC SECURITY DEFINER (owner
--     bypass RLS, không có FORCE ROW LEVEL SECURITY nào áp trong repo).
--   - CHỈ ĐÚNG 1 nơi ghi trực tiếp bằng browser client (`authenticated` role, KHÔNG
--     bypass RLS): `src/app/dashboard/product/page.tsx` (luồng "Sửa theo ngày" của
--     Thành phẩm) — `supabase.from("lot_transactions").update({ ngay_nhap })
--     .eq("lot_id", ...).eq("ngay_nhap", ...)`. Policy UPDATE bên dưới phải cho phép
--     đúng luồng này tiếp tục hoạt động.
--   - Trigger `trigger_update_lot_master` (hàm `update_lot_master_totals()`, SECURITY
--     INVOKER — xem 20260708_fix_lot_status_trigger.sql) fire AFTER INSERT/UPDATE/DELETE
--     trên `lot_transactions`, tự SELECT lại `lot_transactions`/`lots` rồi UPDATE `lots`.
--     Vì SECURITY INVOKER, trigger này chạy với đúng role đang thực hiện câu lệnh gốc —
--     khi role đó là `authenticated` (như luồng "Sửa theo ngày" ở trên), policy SELECT
--     bên dưới + policy `lots_update` (đã có sẵn từ 20260822) phải cho phép trigger hoàn
--     tất, nếu không luồng "Sửa theo ngày" sẽ báo lỗi ngay khi bật RLS.
--   - Các trang đọc factory-scoped hiện có (`process/measurements/page.tsx`,
--     `_components/widgets/finished-goods-widget.tsx`, `src/lib/storage-detail.ts`,
--     `src/lib/product-label.ts`) đều đã filter theo `lots.factory_id`/`ngan_id` qua
--     join — không đổi hành vi khi RLS chặn thêm ở tầng DB (RLS chỉ lọc lại đúng những
--     hàng client đã tự lọc, không phải lọc khác).
--
-- `lot_transactions` KHÔNG có cột `factory_id` riêng — chỉ có `lot_id NOT NULL REFERENCES
-- lots(id)`. Suy factory qua EXISTS join `lots` (mirror đúng cách các bảng không có
-- factory_id trực tiếp khác trong repo được xử lý, ví dụ `qc_results` cũ trước khi có
-- cột factory_id riêng).

ALTER TABLE lot_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lot_transactions_select" ON lot_transactions;
CREATE POLICY "lot_transactions_select" ON lot_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lots l
      WHERE l.id = lot_transactions.lot_id
        AND l.factory_id = public.current_profile_factory_id()
    )
  );

DROP POLICY IF EXISTS "lot_transactions_insert" ON lot_transactions;
CREATE POLICY "lot_transactions_insert" ON lot_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lots l
      WHERE l.id = lot_transactions.lot_id
        AND l.factory_id = public.current_profile_factory_id()
    )
  );

DROP POLICY IF EXISTS "lot_transactions_update" ON lot_transactions;
CREATE POLICY "lot_transactions_update" ON lot_transactions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lots l
      WHERE l.id = lot_transactions.lot_id
        AND l.factory_id = public.current_profile_factory_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lots l
      WHERE l.id = lot_transactions.lot_id
        AND l.factory_id = public.current_profile_factory_id()
    )
  );

DROP POLICY IF EXISTS "lot_transactions_delete" ON lot_transactions;
CREATE POLICY "lot_transactions_delete" ON lot_transactions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lots l
      WHERE l.id = lot_transactions.lot_id
        AND l.factory_id = public.current_profile_factory_id()
    )
  );

-- Không cấp quyền nào cho `anon` — 2 trang public duy nhất từng đọc lot_transactions
-- bằng anon key (/storage, /product-label) đã được refactor sang route service-role
-- (/api/storage/public-lookup, /api/storage/geojson, /api/product-label/lookup) từ
-- 2026-08-08, không còn phụ thuộc đọc trực tiếp lot_transactions bằng anon nữa.
