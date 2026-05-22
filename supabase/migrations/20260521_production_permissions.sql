-- Permissions cho module Sản lượng

insert into public.permissions (code, module_name, action_name) values
  ('output.view',   'output', 'view'),
  ('output.create', 'output', 'create'),
  ('output.edit',   'output', 'edit'),
  ('output.delete', 'output', 'delete'),
  ('output.import', 'output', 'import')
on conflict (code) do nothing;

-- admin: toàn quyền
insert into public.role_permissions (role, permission_code)
  select 'admin', code from public.permissions where code like 'output.%'
on conflict do nothing;

-- manager: tất cả trừ delete
insert into public.role_permissions (role, permission_code) values
  ('manager', 'output.view'),
  ('manager', 'output.create'),
  ('manager', 'output.edit'),
  ('manager', 'output.import')
on conflict do nothing;

-- user: chỉ xem
insert into public.role_permissions (role, permission_code) values
  ('user', 'output.view')
on conflict do nothing;
