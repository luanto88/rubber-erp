-- GĐ A — vá RLS "Allow all" (FOR ALL USING (true), roles {public}) của 13 bảng kho vật tư còn lại
-- (3 bảng phiếu đã vá ở 20261106_inventory_documents_rls.sql). Trước migration này: ai cầm anon key —
-- kể cả CHƯA đăng nhập — đọc/ghi được danh mục, tồn kho, phát sinh của MỌI nhà máy.
--
-- Sau migration: mỗi bảng 4 policy TO authenticated, chỉ đúng factory_id của profile
-- (current_profile_factory_id(), SECURITY DEFINER). KHÔNG chặn theo vai trò/quyền — việc đó vẫn do app.
--   Chặn được: chưa đăng nhập; đọc/ghi chéo nhà máy.
--   CHƯA chặn (để GĐ B): người đã đăng nhập sửa thẳng tồn/phát sinh của chính nhà máy mình bằng devtools.
--
-- Không đụng RPC: inventory_post_import/export/transfer_document, inventory_cancel_document vẫn
-- SECURITY INVOKER — ghi balances / lot_balances / movements / oil_stock_pools bằng quyền người gọi,
-- với factory_id = p_factory_id (app luôn truyền nhà máy đang đăng nhập) ⇒ qua đủ USING/WITH CHECK.
-- Trigger giữ nguyên: trg_inventory_items_guard_shared_oil_flag (inventory_items),
-- trg_inventory_prevent_negative_stock (inventory_stock_movements).
-- Luồng service role (Bảo trì tự xuất kho, Đề nghị mua nhập kho, api/maintenance/external-items...)
-- bỏ qua RLS — không ảnh hưởng.
--
-- ⚠️ factory_id các bảng này NULLABLE: dòng có factory_id NULL sẽ KHÔNG ai (trừ service role) thấy
-- nữa. Kiểm trước khi chạy — kỳ vọng mọi cột "null_factory" = 0:
--   select 'warehouses' t, count(*) filter (where factory_id is null) null_factory from inventory_warehouses
--   union all select 'categories', count(*) filter (where factory_id is null) from inventory_item_categories
--   union all select 'items', count(*) filter (where factory_id is null) from inventory_items
--   union all select 'rules', count(*) filter (where factory_id is null) from inventory_item_warehouse_rules
--   union all select 'balances', count(*) filter (where factory_id is null) from inventory_stock_balances
--   union all select 'lot_balances', count(*) filter (where factory_id is null) from inventory_lot_balances
--   union all select 'movements', count(*) filter (where factory_id is null) from inventory_stock_movements
--   union all select 'oil_pools', count(*) filter (where factory_id is null) from inventory_oil_stock_pools
--   union all select 'thresholds', count(*) filter (where factory_id is null) from inventory_alert_thresholds;
--
-- Chạy tay trong Supabase SQL Editor. Idempotent — chạy lại an toàn.

do $$
declare
  t text;
  tables text[] := array[
    'inventory_warehouses',
    'inventory_item_categories',
    'inventory_items',
    'inventory_item_warehouse_rules',
    'inventory_stock_balances',
    'inventory_lot_balances',
    'inventory_stock_movements',
    'inventory_oil_stock_pools',
    'inventory_alert_thresholds',
    'inventory_consumption_norms',
    'inventory_consumption_norm_lines',
    'inventory_monthly_norm_reports',
    'inventory_monthly_norm_report_lines'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Allow all" on public.%I', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (factory_id = public.current_profile_factory_id())',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (factory_id = public.current_profile_factory_id())',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (factory_id = public.current_profile_factory_id())
         with check (factory_id = public.current_profile_factory_id())',
      t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (factory_id = public.current_profile_factory_id())',
      t || '_delete', t);
  end loop;
end $$;

-- Kiểm sau khi chạy (kỳ vọng 52 dòng, không còn "Allow all"):
--   select tablename, policyname, cmd, roles from pg_policies
--   where schemaname = 'public' and tablename like 'inventory_%'
--     and tablename not like 'inventory_document%'
--   order by 1, 2;
