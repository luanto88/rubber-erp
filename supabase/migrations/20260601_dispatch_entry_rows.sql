-- Physical detail rows for dispatch_entries.
-- Keeps dispatch_entries as the document header while each trip is queryable.

alter table public.dispatch_entries
  add column if not exists day_chuyen text;

create table if not exists public.dispatch_entry_rows (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  dispatch_entry_id uuid not null references public.dispatch_entries(id) on delete cascade,
  uid_legacy text,
  ngay date not null,
  day_chuyen text,
  so_xe text not null default '',
  chuyen integer not null default 1 check (chuyen > 0),
  tai_xe text,
  diem_gn text[] not null default '{}',
  phien text[] not null default '{}',
  lo_thu_hoach text[] not null default '{}',
  xu_ly text,
  lo_trinh text[] not null default '{}',
  doi integer[] not null default '{}',
  so_km numeric(10,2) not null default 0,

  kl_ct numeric(12,2) not null default 0,
  drc_c numeric(6,2) not null default 0,
  kl_ck numeric(12,2) not null default 0,
  kl_dct numeric(12,2) not null default 0,
  drc_dc numeric(6,2) not null default 0,
  kl_dck numeric(12,2) not null default 0,
  kl_dkt numeric(12,2) not null default 0,
  drc_dk numeric(6,2) not null default 0,
  kl_dkk numeric(12,2) not null default 0,
  kl_dt numeric(12,2) not null default 0,
  drc_d numeric(6,2) not null default 0,
  kl_dk numeric(12,2) not null default 0,
  kl_mn numeric(12,2) not null default 0,
  drc_mn numeric(6,2) not null default 0,
  kl_mnk numeric(12,2) not null default 0,

  ngan_ref text[] not null default '{}',
  ghi_chu text,
  locked boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dispatch_entry_id, uid_legacy)
);

create index if not exists idx_dispatch_entry_rows_factory_ngay
  on public.dispatch_entry_rows(factory_id, ngay desc);

create index if not exists idx_dispatch_entry_rows_dispatch
  on public.dispatch_entry_rows(dispatch_entry_id, sort_order);

create index if not exists idx_dispatch_entry_rows_vehicle
  on public.dispatch_entry_rows(factory_id, so_xe, chuyen, ngay desc);

create index if not exists idx_dispatch_entry_rows_doi
  on public.dispatch_entry_rows using gin (doi);

drop trigger if exists trg_dispatch_entry_rows_updated_at on public.dispatch_entry_rows;
create trigger trg_dispatch_entry_rows_updated_at
before update on public.dispatch_entry_rows
for each row execute function public.set_updated_at();

alter table public.dispatch_entry_rows enable row level security;

drop policy if exists "dispatch entry rows read same factory" on public.dispatch_entry_rows;
create policy "dispatch entry rows read same factory"
on public.dispatch_entry_rows
for select
to authenticated
using (
  public.current_profile_factory_id() = factory_id
);

drop policy if exists "dispatch entry rows write same factory" on public.dispatch_entry_rows;
create policy "dispatch entry rows write same factory"
on public.dispatch_entry_rows
for all
to authenticated
using (
  public.current_profile_factory_id() = factory_id
)
with check (
  public.current_profile_factory_id() = factory_id
);

with expanded as (
  select
    e.id as dispatch_entry_id,
    e.factory_id,
    case
      when e.ngay ~ '^\d{4}-\d{2}-\d{2}$' then e.ngay::date
      when e.ngay ~ '^\d{1,2}/\d{1,2}/\d{4}$' then to_date(e.ngay, 'DD/MM/YYYY')
      else e.created_at::date
    end as ngay,
    coalesce(e.day_chuyen, row_data.row->>'day_chuyen') as day_chuyen,
    row_data.row,
    row_data.ordinality::integer as sort_order
  from public.dispatch_entries e
  cross join lateral jsonb_array_elements(coalesce(e.rows, '[]'::jsonb)) with ordinality as row_data(row, ordinality)
),
normalized as (
  select
    expanded.*,
    coalesce(expanded.row->>'uid', 'legacy-' || expanded.dispatch_entry_id || '-' || expanded.sort_order) as uid_legacy,
    array(
      select value
      from jsonb_array_elements_text(
        case when jsonb_typeof(expanded.row->'diem_gn') = 'array' then expanded.row->'diem_gn' else '[]'::jsonb end
      )
    ) as diem_gn_arr,
    array(
      select value
      from jsonb_array_elements_text(
        case when jsonb_typeof(expanded.row->'phien') = 'array' then expanded.row->'phien' else '[]'::jsonb end
      )
    ) as phien_arr,
    array(
      select value
      from jsonb_array_elements_text(
        case when jsonb_typeof(expanded.row->'lo_thu_hoach') = 'array' then expanded.row->'lo_thu_hoach' else '[]'::jsonb end
      )
    ) as lo_thu_hoach_arr,
    array(
      select value
      from jsonb_array_elements_text(
        case when jsonb_typeof(expanded.row->'lo_trinh') = 'array' then expanded.row->'lo_trinh' else '[]'::jsonb end
      )
    ) as lo_trinh_arr,
    array(
      select value
      from jsonb_array_elements_text(
        case when jsonb_typeof(expanded.row->'ngan_ref') = 'array' then expanded.row->'ngan_ref' else '[]'::jsonb end
      )
    ) as ngan_ref_arr
  from expanded
)
insert into public.dispatch_entry_rows (
  factory_id,
  dispatch_entry_id,
  uid_legacy,
  ngay,
  day_chuyen,
  so_xe,
  chuyen,
  tai_xe,
  diem_gn,
  phien,
  lo_thu_hoach,
  xu_ly,
  lo_trinh,
  doi,
  so_km,
  kl_ct, drc_c, kl_ck,
  kl_dct, drc_dc, kl_dck,
  kl_dkt, drc_dk, kl_dkk,
  kl_dt, drc_d, kl_dk,
  kl_mn, drc_mn, kl_mnk,
  ngan_ref,
  ghi_chu,
  locked,
  sort_order
)
select
  n.factory_id,
  n.dispatch_entry_id,
  n.uid_legacy,
  n.ngay,
  n.day_chuyen,
  coalesce(n.row->>'so_xe', ''),
  greatest(
    coalesce(
      case when coalesce(n.row->>'chuyen', '') ~ '^\d+$' then (n.row->>'chuyen')::integer else null end,
      1
    ),
    1
  ),
  n.row->>'tai_xe',
  n.diem_gn_arr,
  n.phien_arr,
  n.lo_thu_hoach_arr,
  n.row->>'xu_ly',
  n.lo_trinh_arr,
  coalesce(dp.dois, '{}'::integer[]),
  case when coalesce(n.row->>'so_km', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'so_km')::numeric else 0 end,
  case when coalesce(n.row->>'kl_ct', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'kl_ct')::numeric else 0 end,
  case when coalesce(n.row->>'drc_c', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'drc_c')::numeric else 0 end,
  case when coalesce(n.row->>'kl_ck', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'kl_ck')::numeric else 0 end,
  case when coalesce(n.row->>'kl_dct', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'kl_dct')::numeric else 0 end,
  case when coalesce(n.row->>'drc_dc', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'drc_dc')::numeric else 0 end,
  case when coalesce(n.row->>'kl_dck', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'kl_dck')::numeric else 0 end,
  case when coalesce(n.row->>'kl_dkt', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'kl_dkt')::numeric else 0 end,
  case when coalesce(n.row->>'drc_dk', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'drc_dk')::numeric else 0 end,
  case when coalesce(n.row->>'kl_dkk', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'kl_dkk')::numeric else 0 end,
  case when coalesce(n.row->>'kl_dt', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'kl_dt')::numeric else 0 end,
  case when coalesce(n.row->>'drc_d', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'drc_d')::numeric else 0 end,
  case when coalesce(n.row->>'kl_dk', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'kl_dk')::numeric else 0 end,
  case when coalesce(n.row->>'kl_mn', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'kl_mn')::numeric else 0 end,
  case when coalesce(n.row->>'drc_mn', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'drc_mn')::numeric else 0 end,
  case when coalesce(n.row->>'kl_mnk', '') ~ '^-?\d+(\.\d+)?$' then (n.row->>'kl_mnk')::numeric else 0 end,
  n.ngan_ref_arr,
  n.row->>'ghi_chu',
  case when coalesce(n.row->>'locked', '') in ('true', 'false') then (n.row->>'locked')::boolean else false end,
  n.sort_order
from normalized n
left join lateral (
  select array_agg(distinct p.doi order by p.doi) as dois
  from public.dispatch_delivery_points p
  where p.factory_id = n.factory_id
    and p.ma_lo = any(n.diem_gn_arr)
) dp on true
on conflict (dispatch_entry_id, uid_legacy) do nothing;
