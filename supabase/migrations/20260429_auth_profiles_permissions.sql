-- ============================================
-- AUTH + PROFILES + PERMISSIONS
-- ============================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  auth_email text not null unique,
  full_name text not null,
  factory_id uuid references public.factories(id),
  department text,
  role text not null default 'user' check (role in ('admin', 'manager', 'user', 'customer')),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  disabled_by uuid references auth.users(id),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
  code text primary key,
  module_name text not null,
  action_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role text not null check (role in ('admin', 'manager', 'user', 'customer')),
  permission_code text not null references public.permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role, permission_code)
);

create table if not exists public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  granted boolean not null default true,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, permission_code)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

insert into public.permissions (code, module_name, action_name) values
  ('dispatch.view', 'dispatch', 'view'),
  ('dispatch.create', 'dispatch', 'create'),
  ('dispatch.edit', 'dispatch', 'edit'),
  ('dispatch.delete', 'dispatch', 'delete'),
  ('dispatch.import', 'dispatch', 'import'),
  ('storage.view', 'storage', 'view'),
  ('storage.create', 'storage', 'create'),
  ('storage.edit', 'storage', 'edit'),
  ('storage.delete', 'storage', 'delete'),
  ('product.view', 'product', 'view'),
  ('product.create', 'product', 'create'),
  ('product.edit', 'product', 'edit'),
  ('product.delete', 'product', 'delete'),
  ('product.mark_completed', 'product', 'mark_completed'),
  ('quality.view', 'quality', 'view'),
  ('quality.create', 'quality', 'create'),
  ('quality.edit', 'quality', 'edit'),
  ('quality.delete', 'quality', 'delete'),
  ('quality.print', 'quality', 'print'),
  ('quality.import', 'quality', 'import'),
  ('export.view', 'export', 'view'),
  ('export.create', 'export', 'create'),
  ('export.edit', 'export', 'edit'),
  ('export.delete', 'export', 'delete'),
  ('export.delete_order', 'export', 'delete_order'),
  ('export.quick_add_customer', 'export', 'quick_add_customer'),
  ('settings.view', 'settings', 'view'),
  ('settings.manage_config', 'settings', 'manage_config'),
  ('users.view', 'users', 'view'),
  ('users.approve', 'users', 'approve'),
  ('users.edit_permission', 'users', 'edit_permission'),
  ('suffixes.quick_add', 'suffixes', 'quick_add')
on conflict (code) do nothing;

insert into public.role_permissions (role, permission_code)
select 'admin', code from public.permissions
on conflict do nothing;

insert into public.role_permissions (role, permission_code) values
  ('manager', 'dispatch.view'),
  ('manager', 'dispatch.create'),
  ('manager', 'dispatch.edit'),
  ('manager', 'storage.view'),
  ('manager', 'storage.create'),
  ('manager', 'storage.edit'),
  ('manager', 'product.view'),
  ('manager', 'product.create'),
  ('manager', 'product.edit'),
  ('manager', 'product.mark_completed'),
  ('manager', 'quality.view'),
  ('manager', 'quality.create'),
  ('manager', 'quality.edit'),
  ('manager', 'quality.print'),
  ('manager', 'export.view'),
  ('manager', 'export.create'),
  ('manager', 'export.edit'),
  ('manager', 'settings.view'),
  ('manager', 'users.view'),
  ('user', 'dispatch.view'),
  ('user', 'storage.view'),
  ('user', 'product.view'),
  ('user', 'quality.view'),
  ('user', 'export.view')
on conflict do nothing;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid() and status = 'active'
  limit 1;
$$;

create or replace function public.current_profile_factory_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select factory_id
  from public.profiles
  where id = auth.uid() and status = 'active'
  limit 1;
$$;

alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;

drop policy if exists "profiles insert self" on public.profiles;
create policy "profiles insert self"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles read own or admin same factory" on public.profiles;
create policy "profiles read own or admin same factory"
on public.profiles
for select
to authenticated
using (
  auth.uid() = id
  or (
    public.current_profile_role() = 'admin'
    and public.current_profile_role() is not null
    and public.current_profile_factory_id() = factory_id
  )
);

drop policy if exists "profiles update own or admin same factory" on public.profiles;
create policy "profiles update admin same factory"
on public.profiles
for update
to authenticated
using (
  public.current_profile_role() = 'admin'
  and public.current_profile_role() is not null
  and public.current_profile_factory_id() = factory_id
)
with check (
  public.current_profile_role() = 'admin'
  and public.current_profile_role() is not null
  and public.current_profile_factory_id() = factory_id
);

drop policy if exists "permissions readable by authenticated" on public.permissions;
create policy "permissions readable by authenticated"
on public.permissions
for select
to authenticated
using (true);

drop policy if exists "role permissions readable by authenticated" on public.role_permissions;
create policy "role permissions readable by authenticated"
on public.role_permissions
for select
to authenticated
using (true);

drop policy if exists "user permissions read own or admin same factory" on public.user_permissions;
create policy "user permissions read own or admin same factory"
on public.user_permissions
for select
to authenticated
using (
  user_id = auth.uid()
  or (
    public.current_profile_role() = 'admin'
    and public.current_profile_role() is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = user_permissions.user_id
        and p.factory_id = public.current_profile_factory_id()
    )
  )
);

drop policy if exists "user permissions manage admin same factory" on public.user_permissions;
create policy "user permissions manage admin same factory"
on public.user_permissions
for all
to authenticated
using (
  public.current_profile_role() = 'admin'
  and public.current_profile_role() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = user_permissions.user_id
      and p.factory_id = public.current_profile_factory_id()
  )
)
with check (
  public.current_profile_role() = 'admin'
  and public.current_profile_role() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = user_permissions.user_id
      and p.factory_id = public.current_profile_factory_id()
  )
);
