-- Module Customer Portal (/dashboard/customer-portal)
-- Cho phép admin cấp quyền xem TỪNG đơn xuất hàng cụ thể (không phải toàn bộ theo customer_id)
-- cho 1 tài khoản role="customer", kèm toàn bộ chuỗi truy xuất EUDR của đơn đó.
--
-- Gồm 2 phần bắt buộc đi cùng nhau:
--   1) Bảng gán quyền export_order_customer_grants (mirror operation_note_shares).
--   2) RESTRICTIVE policy chặn role "customer" đọc thẳng 8 bảng thuộc chuỗi truy xuất
--      qua Supabase JS trực tiếp — mọi dữ liệu customer xem đều phải đi qua API route
--      server-side (service role) tự kiểm tra bảng gán quyền trước khi trả dữ liệu.
--
-- LƯU Ý PHẠM VI: các bảng khác ngoài 8 bảng dưới đây vẫn đang ở policy "Allow all"
-- (lỗ hổng RLS có sẵn của toàn app, không phải do migration này gây ra) — KHÔNG sửa
-- trong migration này, cần 1 task bảo mật riêng để rà soát toàn bộ schema.

-- ── 1) Bảng gán quyền theo đơn xuất hàng ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS export_order_customer_grants (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  export_order_id     UUID NOT NULL REFERENCES export_orders ON DELETE CASCADE,
  factory_id          UUID NOT NULL,
  granted_to_user_id  UUID NOT NULL REFERENCES auth.users,
  granted_by          UUID REFERENCES auth.users,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (export_order_id, granted_to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_export_order_customer_grants_order
  ON export_order_customer_grants (export_order_id);

CREATE INDEX IF NOT EXISTS idx_export_order_customer_grants_user
  ON export_order_customer_grants (granted_to_user_id);

ALTER TABLE export_order_customer_grants ENABLE ROW LEVEL SECURITY;

-- SELECT: người được cấp xem dòng của mình, người cấp xem danh sách đã cấp, admin xem hết
DROP POLICY IF EXISTS "export_order_customer_grants_select" ON export_order_customer_grants;
CREATE POLICY "export_order_customer_grants_select" ON export_order_customer_grants
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      granted_to_user_id = auth.uid()
      OR granted_by = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- INSERT: chỉ admin cùng factory được cấp quyền, bắt buộc granted_by = auth.uid(),
-- và đơn xuất hàng phải thuộc đúng factory (không cấp nhầm đơn nhà máy khác).
DROP POLICY IF EXISTS "export_order_customer_grants_insert" ON export_order_customer_grants;
CREATE POLICY "export_order_customer_grants_insert" ON export_order_customer_grants
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND granted_by = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    AND EXISTS (
      SELECT 1 FROM export_orders o
      WHERE o.id = export_order_id AND o.factory_id = export_order_customer_grants.factory_id
    )
  );

-- DELETE: admin cùng factory hoặc chính người đã cấp quyền đó
DROP POLICY IF EXISTS "export_order_customer_grants_delete" ON export_order_customer_grants;
CREATE POLICY "export_order_customer_grants_delete" ON export_order_customer_grants
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      granted_by = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- Không tạo policy UPDATE — grant record bất biến, thu hồi thì xóa, không sửa.

-- ── 2) RESTRICTIVE policy chặn role "customer" đọc thẳng 8 bảng chuỗi trace ───
-- Postgres kết hợp nhiều policy PERMISSIVE bằng OR, nhưng có RESTRICTIVE thì bắt buộc AND
-- thêm. Nghĩa là các policy "Allow all"/factory-scope hiện tại của admin/manager/user
-- KHÔNG bị ảnh hưởng gì — chỉ riêng session role='customer' bị chặn truy vấn trực tiếp.
-- public.current_profile_role() trả NULL cho anon/inactive (xem 20260429_auth_profiles_permissions.sql),
-- nên "IS DISTINCT FROM 'customer'" chỉ chặn đúng role customer, không ảnh hưởng anon/role khác.
DROP POLICY IF EXISTS "deny_customer_direct_access" ON export_orders;
CREATE POLICY "deny_customer_direct_access" ON export_orders
  AS RESTRICTIVE FOR ALL
  USING (public.current_profile_role() IS DISTINCT FROM 'customer');

DROP POLICY IF EXISTS "deny_customer_direct_access" ON customers;
CREATE POLICY "deny_customer_direct_access" ON customers
  AS RESTRICTIVE FOR ALL
  USING (public.current_profile_role() IS DISTINCT FROM 'customer');

DROP POLICY IF EXISTS "deny_customer_direct_access" ON lots;
CREATE POLICY "deny_customer_direct_access" ON lots
  AS RESTRICTIVE FOR ALL
  USING (public.current_profile_role() IS DISTINCT FROM 'customer');

DROP POLICY IF EXISTS "deny_customer_direct_access" ON ngans;
CREATE POLICY "deny_customer_direct_access" ON ngans
  AS RESTRICTIVE FOR ALL
  USING (public.current_profile_role() IS DISTINCT FROM 'customer');

DROP POLICY IF EXISTS "deny_customer_direct_access" ON dispatch_entries;
CREATE POLICY "deny_customer_direct_access" ON dispatch_entries
  AS RESTRICTIVE FOR ALL
  USING (public.current_profile_role() IS DISTINCT FROM 'customer');

DROP POLICY IF EXISTS "deny_customer_direct_access" ON qc_results;
CREATE POLICY "deny_customer_direct_access" ON qc_results
  AS RESTRICTIVE FOR ALL
  USING (public.current_profile_role() IS DISTINCT FROM 'customer');

DROP POLICY IF EXISTS "deny_customer_direct_access" ON forest_plots;
CREATE POLICY "deny_customer_direct_access" ON forest_plots
  AS RESTRICTIVE FOR ALL
  USING (public.current_profile_role() IS DISTINCT FROM 'customer');

DROP POLICY IF EXISTS "deny_customer_direct_access" ON dispatch_delivery_points;
CREATE POLICY "deny_customer_direct_access" ON dispatch_delivery_points
  AS RESTRICTIVE FOR ALL
  USING (public.current_profile_role() IS DISTINCT FROM 'customer');

-- ── 3) Permission mới cho customer portal ─────────────────────────────────────
INSERT INTO permissions (code, module_name, action_name)
VALUES ('export.view_own', 'export', 'view_own')
ON CONFLICT (code) DO NOTHING;

-- Chỉ role customer dùng permission này — admin/manager/user dùng export.view sẵn có,
-- không liên quan route customer-portal.
INSERT INTO role_permissions (role, permission_code)
VALUES ('customer', 'export.view_own')
ON CONFLICT DO NOTHING;
