-- ============================================
-- MAINTENANCE PERMISSIONS
-- ============================================

insert into public.permissions (code, module_name, action_name) values
  ('maintenance.view',        'maintenance', 'view'),
  ('maintenance.create',      'maintenance', 'create'),
  ('maintenance.edit',        'maintenance', 'edit'),
  ('maintenance.delete',      'maintenance', 'delete'),
  ('maintenance.approve',     'maintenance', 'approve'),
  ('maintenance.print',       'maintenance', 'print'),
  ('maintenance.export_file', 'maintenance', 'export_file')
on conflict (code) do nothing;

-- admin: all maintenance permissions
insert into public.role_permissions (role, permission_code)
select 'admin', code
from public.permissions
where code like 'maintenance.%'
on conflict do nothing;

-- manager: view, create, edit, approve, print, export
insert into public.role_permissions (role, permission_code) values
  ('manager', 'maintenance.view'),
  ('manager', 'maintenance.create'),
  ('manager', 'maintenance.edit'),
  ('manager', 'maintenance.approve'),
  ('manager', 'maintenance.print'),
  ('manager', 'maintenance.export_file')
on conflict do nothing;

-- user: view, create
insert into public.role_permissions (role, permission_code) values
  ('user', 'maintenance.view'),
  ('user', 'maintenance.create'),
  ('user', 'maintenance.print')
on conflict do nothing;
