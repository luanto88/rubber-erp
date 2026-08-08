-- Vá lỗ hổng RLS "Allow all" (USING (true)) trên các bảng nghiệp vụ cốt lõi — xem
-- .claude/rules (memory security_rls_allow_all_gap) và supabase/schema.sql:301-314.
--
-- Hiện trạng trước migration này: 13 bảng có policy `CREATE POLICY "Allow all" ON <table>
-- FOR ALL USING (true)` — bất kỳ ai cầm được anon key (kể cả CHƯA đăng nhập, không cần JWT
-- hợp lệ) đọc/ghi trực tiếp được các bảng này của MỌI nhà máy qua supabase-js.
--
-- Migration này xử lý 8/13 bảng — nhóm "an toàn tuyệt đối để khóa toàn bộ" (đã audit kỹ
-- toàn bộ src/ để xác nhận KHÔNG có trang public/không đăng nhập nào query các bảng này
-- trực tiếp bằng anon client; mọi truy cập từ trình duyệt đều nằm dưới /dashboard/** đã
-- được dashboard/layout.tsx gate bằng Supabase Auth session, hoặc đi qua API route dùng
-- service role — cả 2 trường hợp đều không bị ảnh hưởng bởi RLS chặt hơn):
--
--   dispatch_drivers, dispatch_vehicles, dispatch_vehicle_driver_assignments,
--   customers, export_orders, suffixes, sk_history, users
--
-- 4 bảng còn lại (lots, ngans, qc_results, dispatch_entries) và `factories` được xử lý ở
-- migration riêng `20260822_rls_lockdown_factories_and_write_protect.sql` vì chúng có
-- trang public thật sự phụ thuộc đọc trực tiếp (/storage, /product-label, /login) — không
-- gộp chung để tránh rủi ro lẫn lộn giữa 2 nhóm khác chiến lược.
--
-- Pattern dùng: factory_id = current_profile_factory_id() (hàm SECURITY DEFINER có sẵn từ
-- 20260429_auth_profiles_permissions.sql) cho cả SELECT/INSERT/UPDATE/DELETE, `TO
-- authenticated` tường minh — mirror đúng idiom đã dùng cho quality_targets
-- (20260705_quality_targets.sql), dispatch_delivery_points (20260519), forest_plots
-- (20260520 + fix 20260819). Không thêm current_profile_has_permission() theo permission
-- code cụ thể cho từng bảng — cố ý giữ đúng mức độ chặt hiện có của toàn bộ các bảng
-- factory-scope khác trong hệ thống (chỉ chặn CHÉO NHÀ MÁY + CHƯA ĐĂNG NHẬP, không chặn
-- giữa các role trong cùng nhà máy — việc đó vẫn do app-layer hasPermission() đảm nhiệm,
-- đúng mô hình bảo mật đã áp dụng nhất quán ở mọi bảng factory-scope khác từ trước tới nay).
--
-- `users`: bảng chết hoàn toàn — đã grep toàn bộ src/, không còn nơi nào trong app dùng
-- (chỉ scripts/migrate-legacy-users.mjs, chạy bằng SUPABASE_SERVICE_ROLE_KEY, bypass RLS).
-- Khóa hẳn (không tạo policy nào) — RLS enabled + 0 policy = deny-all cho anon/authenticated,
-- chỉ service role còn truy cập được.

-- ── dispatch_drivers ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all" ON dispatch_drivers;

DROP POLICY IF EXISTS "dispatch_drivers_select" ON dispatch_drivers;
CREATE POLICY "dispatch_drivers_select" ON dispatch_drivers
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_drivers_insert" ON dispatch_drivers;
CREATE POLICY "dispatch_drivers_insert" ON dispatch_drivers
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_drivers_update" ON dispatch_drivers;
CREATE POLICY "dispatch_drivers_update" ON dispatch_drivers
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_drivers_delete" ON dispatch_drivers;
CREATE POLICY "dispatch_drivers_delete" ON dispatch_drivers
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── dispatch_vehicles ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all" ON dispatch_vehicles;

DROP POLICY IF EXISTS "dispatch_vehicles_select" ON dispatch_vehicles;
CREATE POLICY "dispatch_vehicles_select" ON dispatch_vehicles
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_vehicles_insert" ON dispatch_vehicles;
CREATE POLICY "dispatch_vehicles_insert" ON dispatch_vehicles
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_vehicles_update" ON dispatch_vehicles;
CREATE POLICY "dispatch_vehicles_update" ON dispatch_vehicles
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_vehicles_delete" ON dispatch_vehicles;
CREATE POLICY "dispatch_vehicles_delete" ON dispatch_vehicles
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── dispatch_vehicle_driver_assignments ─────────────────────────────────────
DROP POLICY IF EXISTS "Allow all" ON dispatch_vehicle_driver_assignments;

DROP POLICY IF EXISTS "dispatch_vda_select" ON dispatch_vehicle_driver_assignments;
CREATE POLICY "dispatch_vda_select" ON dispatch_vehicle_driver_assignments
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_vda_insert" ON dispatch_vehicle_driver_assignments;
CREATE POLICY "dispatch_vda_insert" ON dispatch_vehicle_driver_assignments
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_vda_update" ON dispatch_vehicle_driver_assignments;
CREATE POLICY "dispatch_vda_update" ON dispatch_vehicle_driver_assignments
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_vda_delete" ON dispatch_vehicle_driver_assignments;
CREATE POLICY "dispatch_vda_delete" ON dispatch_vehicle_driver_assignments
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── customers ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all" ON customers;

DROP POLICY IF EXISTS "customers_select" ON customers;
CREATE POLICY "customers_select" ON customers
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert" ON customers
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update" ON customers
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "customers_delete" ON customers;
CREATE POLICY "customers_delete" ON customers
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── export_orders ────────────────────────────────────────────────────────
-- Lưu ý: cột public_token (20260818_export_orders_public_token.sql) chỉ được đọc qua
-- /api/eudr/public-order (service role) — route đó không bị ảnh hưởng bởi RLS. Policy
-- RESTRICTIVE "deny_customer_direct_access" (20260708_customer_portal_export_grants.sql)
-- vẫn áp dụng song song, tiếp tục chặn role 'customer' truy cập trực tiếp bảng này.
DROP POLICY IF EXISTS "Allow all" ON export_orders;

DROP POLICY IF EXISTS "export_orders_select" ON export_orders;
CREATE POLICY "export_orders_select" ON export_orders
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "export_orders_insert" ON export_orders;
CREATE POLICY "export_orders_insert" ON export_orders
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "export_orders_update" ON export_orders;
CREATE POLICY "export_orders_update" ON export_orders
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "export_orders_delete" ON export_orders;
CREATE POLICY "export_orders_delete" ON export_orders
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── suffixes ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all" ON suffixes;

DROP POLICY IF EXISTS "suffixes_select" ON suffixes;
CREATE POLICY "suffixes_select" ON suffixes
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "suffixes_insert" ON suffixes;
CREATE POLICY "suffixes_insert" ON suffixes
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "suffixes_update" ON suffixes;
CREATE POLICY "suffixes_update" ON suffixes
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "suffixes_delete" ON suffixes;
CREATE POLICY "suffixes_delete" ON suffixes
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── sk_history ───────────────────────────────────────────────────────────
-- Log lịch sử Sang kiện/Thay bọc — ghi qua RPC perform_sang_kien_thay_boc (SECURITY
-- DEFINER, 20260619_sk_atomic_rpc.sql), không bị ảnh hưởng bởi RLS. Policy dưới đây chỉ
-- còn phục vụ SELECT (xem lịch sử) từ client — vẫn giữ đủ CRUD để không phá vỡ nếu có nơi
-- nào khác từng insert/update trực tiếp ngoài RPC.
DROP POLICY IF EXISTS "Allow all" ON sk_history;

DROP POLICY IF EXISTS "sk_history_select" ON sk_history;
CREATE POLICY "sk_history_select" ON sk_history
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "sk_history_insert" ON sk_history;
CREATE POLICY "sk_history_insert" ON sk_history
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "sk_history_update" ON sk_history;
CREATE POLICY "sk_history_update" ON sk_history
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "sk_history_delete" ON sk_history;
CREATE POLICY "sk_history_delete" ON sk_history
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── users (bảng cũ, chết hoàn toàn — không còn code nào trong app dùng) ─────
-- Khóa hẳn: không tạo policy nào. RLS đã ENABLE sẵn (schema.sql:288) + 0 policy = deny-all
-- cho anon/authenticated. scripts/migrate-legacy-users.mjs dùng service role, không bị ảnh
-- hưởng.
DROP POLICY IF EXISTS "Allow all" ON users;
