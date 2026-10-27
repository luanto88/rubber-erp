-- U8a (2026-10-28) — RLS ghi theo QUYỀN cho module Kiểm soát quá trình.
--
-- Trước đây 3 bảng process_params / quick_measurements / quick_measurement_rows chỉ có 1 policy
-- `*_write` FOR ALL lọc theo factory_id ⇒ BẤT KỲ ai đăng nhập cùng nhà máy cũng thêm/sửa/xoá được
-- qua API (giao diện chỉ ẩn nút). Mirror 20260721_production_records_permission_rls.sql: dùng
-- current_profile_has_permission() (admin luôn true) + current_profile_factory_id().
--
-- Chạy TAY trong Supabase SQL Editor. Kiểm tra trước:
--   select tablename, policyname, cmd from pg_policies
--   where tablename in ('process_params','quick_measurements','quick_measurement_rows');
-- Bắt buộc DROP policy *_write FOR ALL cũ: policy PERMISSIVE cộng dồn bằng OR, quên drop thì
-- phần siết bên dưới chỉ là trang trí. Policy SELECT (*_read) giữ nguyên.
-- Idempotent — chạy lại an toàn. Chạy TRƯỚC khi deploy code cũng an toàn.

create or replace function public.current_profile_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role = 'admin'
  );
$$;

-- ── process_params ──────────────────────────────────────────────────────────
drop policy if exists "process_params_write" on public.process_params;

drop policy if exists "process_params_insert_by_permission" on public.process_params;
create policy "process_params_insert_by_permission"
  on public.process_params for insert to authenticated
  with check (
    public.current_profile_factory_id() = factory_id
    and public.current_profile_has_permission('process.create')
  );

drop policy if exists "process_params_update_by_permission" on public.process_params;
create policy "process_params_update_by_permission"
  on public.process_params for update to authenticated
  using (
    public.current_profile_factory_id() = factory_id
    and public.current_profile_has_permission('process.edit')
  )
  with check (
    public.current_profile_factory_id() = factory_id
    and public.current_profile_has_permission('process.edit')
  );

drop policy if exists "process_params_delete_by_permission" on public.process_params;
create policy "process_params_delete_by_permission"
  on public.process_params for delete to authenticated
  using (
    public.current_profile_factory_id() = factory_id
    and public.current_profile_has_permission('process.delete')
  );

-- ── quick_measurements (header phiếu) ───────────────────────────────────────
drop policy if exists "quick_measurements_write" on public.quick_measurements;

drop policy if exists "quick_measurements_insert_by_permission" on public.quick_measurements;
create policy "quick_measurements_insert_by_permission"
  on public.quick_measurements for insert to authenticated
  with check (
    public.current_profile_factory_id() = factory_id
    and public.current_profile_has_permission('process.create')
  );

-- Người tạo (process.create) cần UPDATE phiếu của chính mình ngay sau khi chèn để đổi mã phiếu
-- khi phát hiện trùng mã do 2 người lưu cùng lúc.
drop policy if exists "quick_measurements_update_by_permission" on public.quick_measurements;
create policy "quick_measurements_update_by_permission"
  on public.quick_measurements for update to authenticated
  using (
    public.current_profile_factory_id() = factory_id
    and (
      public.current_profile_has_permission('process.edit')
      or (public.current_profile_has_permission('process.create') and created_by = auth.uid())
    )
  )
  with check (
    public.current_profile_factory_id() = factory_id
    and (
      public.current_profile_has_permission('process.edit')
      or (public.current_profile_has_permission('process.create') and created_by = auth.uid())
    )
  );

-- Xoá phiếu: admin mọi phiếu; người có process.delete chỉ phiếu do chính mình tạo.
-- Dòng đo đi theo FK ON DELETE CASCADE (không qua RLS của quick_measurement_rows).
drop policy if exists "quick_measurements_delete_by_permission" on public.quick_measurements;
create policy "quick_measurements_delete_by_permission"
  on public.quick_measurements for delete to authenticated
  using (
    public.current_profile_factory_id() = factory_id
    and (
      public.current_profile_is_admin()
      or (public.current_profile_has_permission('process.delete') and created_by = auth.uid())
    )
  );

-- ── quick_measurement_rows (dòng đo) ────────────────────────────────────────
drop policy if exists "quick_measurement_rows_write" on public.quick_measurement_rows;

-- "Thêm mẫu vào phiếu" dùng process.create; "Sửa phiếu" chèn dòng mới bằng process.edit.
drop policy if exists "quick_measurement_rows_insert_by_permission" on public.quick_measurement_rows;
create policy "quick_measurement_rows_insert_by_permission"
  on public.quick_measurement_rows for insert to authenticated
  with check (
    public.current_profile_factory_id() = factory_id
    and (
      public.current_profile_has_permission('process.create')
      or public.current_profile_has_permission('process.edit')
    )
  );

drop policy if exists "quick_measurement_rows_update_by_permission" on public.quick_measurement_rows;
create policy "quick_measurement_rows_update_by_permission"
  on public.quick_measurement_rows for update to authenticated
  using (
    public.current_profile_factory_id() = factory_id
    and public.current_profile_has_permission('process.edit')
  )
  with check (
    public.current_profile_factory_id() = factory_id
    and public.current_profile_has_permission('process.edit')
  );

drop policy if exists "quick_measurement_rows_delete_by_permission" on public.quick_measurement_rows;
create policy "quick_measurement_rows_delete_by_permission"
  on public.quick_measurement_rows for delete to authenticated
  using (
    public.current_profile_factory_id() = factory_id
    and (
      public.current_profile_has_permission('process.edit')
      or public.current_profile_has_permission('process.delete')
    )
  );
