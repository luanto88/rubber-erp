 
create table if not exists public.dispatch_drivers (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  code text,
  name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (factory_id, name)
);

create table if not exists public.dispatch_vehicles (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  code text not null,
  name text not null,
  vehicle_type text,
  plate_number text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (factory_id, code)
);

create table if not exists public.dispatch_vehicle_driver_assignments (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  vehicle_id uuid not null references public.dispatch_vehicles(id) on delete cascade,
  driver_id uuid not null references public.dispatch_drivers(id),
  effective_from date not null,
  effective_to date,
  is_current boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dispatch_drivers_factory
  on public.dispatch_drivers(factory_id, is_active, name);

create index if not exists idx_dispatch_vehicles_factory
  on public.dispatch_vehicles(factory_id, is_active, sort_order, code);

create index if not exists idx_dispatch_assignments_vehicle
  on public.dispatch_vehicle_driver_assignments(factory_id, vehicle_id, effective_from desc);

drop trigger if exists trg_dispatch_drivers_updated_at on public.dispatch_drivers;
create trigger trg_dispatch_drivers_updated_at
before update on public.dispatch_drivers
for each row execute function public.set_updated_at();

drop trigger if exists trg_dispatch_vehicles_updated_at on public.dispatch_vehicles;
create trigger trg_dispatch_vehicles_updated_at
before update on public.dispatch_vehicles
for each row execute function public.set_updated_at();

drop trigger if exists trg_dispatch_vehicle_driver_assignments_updated_at on public.dispatch_vehicle_driver_assignments;
create trigger trg_dispatch_vehicle_driver_assignments_updated_at
before update on public.dispatch_vehicle_driver_assignments
for each row execute function public.set_updated_at();

alter table public.dispatch_drivers enable row level security;
alter table public.dispatch_vehicles enable row level security;
alter table public.dispatch_vehicle_driver_assignments enable row level security;

drop policy if exists "dispatch drivers read same factory" on public.dispatch_drivers;
create policy "dispatch drivers read same factory"
on public.dispatch_drivers
for select
to authenticated
using (
  public.current_profile_factory_id() = factory_id
);

drop policy if exists "dispatch drivers manage admin same factory" on public.dispatch_drivers;
create policy "dispatch drivers manage admin same factory"
on public.dispatch_drivers
for all
to authenticated
using (
  public.current_profile_role() = 'admin'
  and public.current_profile_factory_id() = factory_id
)
with check (
  public.current_profile_role() = 'admin'
  and public.current_profile_factory_id() = factory_id
);

drop policy if exists "dispatch vehicles read same factory" on public.dispatch_vehicles;
create policy "dispatch vehicles read same factory"
on public.dispatch_vehicles
for select
to authenticated
using (
  public.current_profile_factory_id() = factory_id
);

drop policy if exists "dispatch vehicles manage admin same factory" on public.dispatch_vehicles;
create policy "dispatch vehicles manage admin same factory"
on public.dispatch_vehicles
for all
to authenticated
using (
  public.current_profile_role() = 'admin'
  and public.current_profile_factory_id() = factory_id
)
with check (
  public.current_profile_role() = 'admin'
  and public.current_profile_factory_id() = factory_id
);

drop policy if exists "dispatch vehicle assignments read same factory" on public.dispatch_vehicle_driver_assignments;
create policy "dispatch vehicle assignments read same factory"
on public.dispatch_vehicle_driver_assignments
for select
to authenticated
using (
  public.current_profile_factory_id() = factory_id
);

drop policy if exists "dispatch vehicle assignments manage admin same factory" on public.dispatch_vehicle_driver_assignments;
create policy "dispatch vehicle assignments manage admin same factory"
on public.dispatch_vehicle_driver_assignments
for all
to authenticated
using (
  public.current_profile_role() = 'admin'
  and public.current_profile_factory_id() = factory_id
)
with check (
  public.current_profile_role() = 'admin'
  and public.current_profile_factory_id() = factory_id
);

with target_factory as (
  select id
  from public.factories
  where code = 'phuochoa_kt'
),
seed as (
  select *
  from jsonb_to_recordset(
    '[
      {"code":"1B","name":"Cozon nội bộ 1B","vehicle_type":"Cozon nội bộ","driver_name":"Sreng Seng Hoang","sort_order":1},
      {"code":"2B","name":"Cozon nội bộ 2B","vehicle_type":"Cozon nội bộ","driver_name":"Young Sok Khum","sort_order":2},
      {"code":"3B","name":"Cozon nội bộ 3B","vehicle_type":"Cozon nội bộ","driver_name":"Uk SaRath","sort_order":3},
      {"code":"4B","name":"Cozon vận chuyển 4B","vehicle_type":"Cozon vận chuyển","driver_name":"Mao Borey","sort_order":4},
      {"code":"5B","name":"Cozon vận chuyển 5B","vehicle_type":"Cozon vận chuyển","driver_name":"Seng Sam Nang","sort_order":5},
      {"code":"6B","name":"Cozon vận chuyển 6B","vehicle_type":"Cozon vận chuyển","driver_name":"Kum Dat","sort_order":6},
      {"code":"7B","name":"Cozon vận chuyển 7B","vehicle_type":"Cozon vận chuyển","driver_name":"Mao Borey","sort_order":7},
      {"code":"8B","name":"Cozon vận chuyển 8B","vehicle_type":"Cozon vận chuyển","driver_name":"Nut An","sort_order":8},
      {"code":"9B","name":"Cozon vận chuyển 9B","vehicle_type":"Cozon vận chuyển","driver_name":"Ren Makara","sort_order":9},
      {"code":"1A","name":"ISUZU 1A","vehicle_type":"Isuzu vận chuyển","driver_name":"Nut An","sort_order":10},
      {"code":"2A","name":"ISUZU 2A","vehicle_type":"Isuzu vận chuyển","driver_name":"Moa Morn","sort_order":11},
      {"code":"3A","name":"ISUZU 3A","vehicle_type":"Isuzu vận chuyển","driver_name":"Men Sam Nang","sort_order":12},
      {"code":"4A","name":"ISUZU 4A","vehicle_type":"Isuzu vận chuyển","driver_name":"Seng Chhun Ly","sort_order":13},
      {"code":"5A","name":"ISUZU 5A","vehicle_type":"Isuzu vận chuyển","driver_name":"Seng Sam Nang","sort_order":14},
      {"code":"6A","name":"ISUZU 6A","vehicle_type":"Isuzu vận chuyển","driver_name":"Yim Kun","sort_order":15},
      {"code":"7A","name":"ISUZU 7A","vehicle_type":"Isuzu vận chuyển","driver_name":"Vorn RoThy","sort_order":16},
      {"code":"8A","name":"ISUZU 8A","vehicle_type":"Isuzu vận chuyển","driver_name":"Vorn Rany","sort_order":17},
      {"code":"9A","name":"ISUZU 9A","vehicle_type":"Isuzu vận chuyển","driver_name":"Yath Ry","sort_order":18},
      {"code":"10A","name":"ISUZU 10A","vehicle_type":"Isuzu vận chuyển","driver_name":"Chhov Sok Khum","sort_order":19},
      {"code":"11A","name":"ISUZU 11A","vehicle_type":"Isuzu vận chuyển","driver_name":"Say Chom Rong","sort_order":20},
      {"code":"12A","name":"ISUZU 12A","vehicle_type":"Isuzu vận chuyển","driver_name":"Sok Thy","sort_order":21},
      {"code":"13A","name":"ISUZU 13A","vehicle_type":"Isuzu vận chuyển","driver_name":"Yim Kun","sort_order":22},
      {"code":"14A","name":"ISUZU 14A","vehicle_type":"Isuzu vận chuyển","driver_name":"Chhoun Khet","sort_order":23},
      {"code":"15A","name":"ISUZU 15A","vehicle_type":"Isuzu vận chuyển","driver_name":"Ren Makara","sort_order":24},
      {"code":"16A","name":"ISUZU 16A","vehicle_type":"Isuzu vận chuyển","driver_name":"Nhorm Pov PaNha","sort_order":25},
      {"code":"17A","name":"ISUZU 17A","vehicle_type":"Isuzu vận chuyển","driver_name":"Phorn Khim","sort_order":26},
      {"code":"18A","name":"ISUZU 18A","vehicle_type":"Isuzu vận chuyển","driver_name":"Choun Khea","sort_order":27},
      {"code":"19A","name":"ISUZU 19A","vehicle_type":"Isuzu vận chuyển","driver_name":"Sun Seng Ly","sort_order":28},
      {"code":"20A","name":"ISUZU 20A","vehicle_type":"Isuzu vận chuyển","driver_name":"Yoeng Nha","sort_order":29},
      {"code":"21A","name":"ISUZU 21A","vehicle_type":"Isuzu vận chuyển","driver_name":"Chhun Khea","sort_order":30},
      {"code":"22A","name":"ISUZU 22A","vehicle_type":"Isuzu vận chuyển","driver_name":"Seng Sam Nang","sort_order":31},
      {"code":"23A","name":"ISUZU 23A","vehicle_type":"Isuzu vận chuyển","driver_name":"Phun Nang","sort_order":32},
      {"code":"X01","name":"Xúc SX 01","vehicle_type":"Xúc sản xuất","driver_name":"Uk SaRath","sort_order":33},
      {"code":"X02","name":"Xúc SX 02","vehicle_type":"Xúc sản xuất","driver_name":"Pheap Phin","sort_order":34},
      {"code":"X03","name":"Xúc Biomass","vehicle_type":"Xúc Biomass","driver_name":"Anh 3 bảo","sort_order":35},
      {"code":"N01","name":"Nâng 01","vehicle_type":"Nâng sản xuất","driver_name":"Ban So Sieng","sort_order":36},
      {"code":"N02","name":"Nâng 02","vehicle_type":"Nâng sản xuất","driver_name":"Keo Sarath","sort_order":37},
      {"code":"XF","name":"Ford","vehicle_type":"Ford bán tải","driver_name":"Bao Thea","sort_order":38}
    ]'::jsonb
  ) as x(
    code text,
    name text,
    vehicle_type text,
    driver_name text,
    sort_order integer
  )
),
insert_drivers as (
  insert into public.dispatch_drivers (factory_id, name, is_active)
  select distinct
    tf.id,
    seed.driver_name,
    true
  from target_factory tf
  cross join seed
  on conflict (factory_id, name) do nothing
  returning id
),
insert_vehicles as (
  insert into public.dispatch_vehicles (factory_id, code, name, vehicle_type, sort_order, is_active)
  select
    tf.id,
    seed.code,
    seed.name,
    seed.vehicle_type,
    seed.sort_order,
    true
  from target_factory tf
  cross join seed
  on conflict (factory_id, code) do update
  set
    name = excluded.name,
    vehicle_type = excluded.vehicle_type,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active
  returning id
)
insert into public.dispatch_vehicle_driver_assignments (
  factory_id,
  vehicle_id,
  driver_id,
  effective_from,
  effective_to,
  is_current,
  note
)
select
  tf.id,
  v.id,
  d.id,
  date '2000-01-01',
  null,
  true,
  'Seed from fallback dispatch vehicle master'
from target_factory tf
join seed on true
join public.dispatch_vehicles v
  on v.factory_id = tf.id
 and v.code = seed.code
join public.dispatch_drivers d
  on d.factory_id = tf.id
 and d.name = seed.driver_name
where not exists (
  select 1
  from public.dispatch_vehicle_driver_assignments a
  where a.factory_id = tf.id
    and a.vehicle_id = v.id
    and a.is_current = true
);
