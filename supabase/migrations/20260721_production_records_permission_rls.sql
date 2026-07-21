-- Fix: production_records RLS ghi cứng role in ('admin','manager'), bỏ qua hệ thống phân
-- quyền chi tiết (user_permissions/role_permissions) vốn đã được seed sẵn cho module output
-- trong 20260521_production_permissions.sql. Hệ quả: tài khoản role='user' được cấp quyền
-- output.create/output.import/output.edit riêng qua Cài đặt → Phân quyền vẫn bị chặn ở tầng
-- DB với lỗi "new row violates row-level security policy for table production_records", dù
-- UI (hasPermission()) đã cho phép thao tác. Admin luôn qua được vì role thật là 'admin'.

create or replace function public.current_profile_has_permission(p_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_has_explicit boolean;
  v_granted boolean;
begin
  select role into v_role from public.profiles where id = v_uid and status = 'active';
  if v_role is null then
    return false;
  end if;

  if v_role = 'admin' then
    return true;
  end if;

  -- Nếu user có ít nhất 1 dòng cấp quyền tường minh (granted=true), chỉ dùng đúng tập đó,
  -- bỏ qua role_permissions mặc định — mirror đúng logic fetchPermissionCodesForUser()
  -- (src/lib/auth.ts): user_permissions không rỗng thì KHÔNG cộng thêm role_permissions.
  select exists(
    select 1 from public.user_permissions
    where user_id = v_uid and granted = true
  ) into v_has_explicit;

  if v_has_explicit then
    select exists(
      select 1 from public.user_permissions
      where user_id = v_uid and granted = true and permission_code = p_code
    ) into v_granted;
    return v_granted;
  end if;

  select exists(
    select 1 from public.role_permissions
    where role = v_role and permission_code = p_code
  ) into v_granted;

  return v_granted;
end;
$$;

-- Thay policy ghi cứng-role bằng 3 policy insert/update/delete theo đúng permission code.
-- output.import được OR vào cả 3 vì luồng Import file (output-import.tsx) vừa insert dòng
-- mới, vừa update dòng khớp trùng khóa, vừa delete các dòng trùng lịch sử (dedupe) trong
-- cùng 1 lượt import — tài khoản chỉ được cấp output.import (không có edit/delete riêng)
-- vẫn phải import trọn vẹn được.

drop policy if exists "production_records_write_manager" on public.production_records;

drop policy if exists "production_records_insert_by_permission" on public.production_records;
create policy "production_records_insert_by_permission"
  on public.production_records for insert to authenticated
  with check (
    public.current_profile_factory_id() = factory_id
    and (
      public.current_profile_has_permission('output.create')
      or public.current_profile_has_permission('output.import')
    )
  );

drop policy if exists "production_records_update_by_permission" on public.production_records;
create policy "production_records_update_by_permission"
  on public.production_records for update to authenticated
  using (
    public.current_profile_factory_id() = factory_id
    and (
      public.current_profile_has_permission('output.edit')
      or public.current_profile_has_permission('output.import')
    )
  )
  with check (
    public.current_profile_factory_id() = factory_id
    and (
      public.current_profile_has_permission('output.edit')
      or public.current_profile_has_permission('output.import')
    )
  );

drop policy if exists "production_records_delete_by_permission" on public.production_records;
create policy "production_records_delete_by_permission"
  on public.production_records for delete to authenticated
  using (
    public.current_profile_factory_id() = factory_id
    and (
      public.current_profile_has_permission('output.delete')
      or public.current_profile_has_permission('output.import')
    )
  );
