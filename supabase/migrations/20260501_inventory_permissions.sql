-- ============================================
-- INVENTORY PERMISSIONS
-- ============================================

insert into public.permissions (code, module_name, action_name) values
  ('inventory.view', 'inventory', 'view'),
  ('inventory.create', 'inventory', 'create'),
  ('inventory.edit', 'inventory', 'edit'),
  ('inventory.delete', 'inventory', 'delete'),
  ('inventory.post', 'inventory', 'post'),
  ('inventory.analytics', 'inventory', 'analytics'),
  ('inventory.settings', 'inventory', 'settings')
on conflict (code) do nothing;

insert into public.role_permissions (role, permission_code)
select 'admin', code
from public.permissions
where code like 'inventory.%'
on conflict do nothing;

insert into public.role_permissions (role, permission_code) values
  ('manager', 'inventory.view'),
  ('manager', 'inventory.create'),
  ('manager', 'inventory.edit'),
  ('manager', 'inventory.post'),
  ('manager', 'inventory.analytics'),
  ('manager', 'inventory.settings'),
  ('user', 'inventory.view'),
  ('user', 'inventory.analytics')
on conflict do nothing;
