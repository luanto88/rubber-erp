-- Module Sản lượng: bảng production_records
-- Lưu sản lượng theo xe / chuyến / đội / ngày, liên kết với dispatch_entries

create table if not exists public.production_records (
  id               uuid primary key default gen_random_uuid(),
  factory_id       uuid not null references public.factories(id) on delete cascade,
  ngay             date not null,
  doi              integer not null check (doi between 1 and 12),
  so_xe            text not null,    -- xe cơ sở đã normalize, e.g. "1A"
  chuyen           integer not null default 1 check (chuyen > 0),
  tai_xe           text,             -- snapshot tài xế từ dispatch_entries.rows[].tai_xe

  -- Mủ nước
  mn_tuoi  numeric(10,2) not null default 0,
  mn_drc   numeric(5,2)  not null default 0,
  mn_kho   numeric(10,2) not null default 0,

  -- Mủ chén
  ct_tuoi  numeric(10,2) not null default 0,
  ct_drc   numeric(5,2)  not null default 0,
  ct_kho   numeric(10,2) not null default 0,

  -- Mủ đông chén
  dct_tuoi numeric(10,2) not null default 0,
  dct_drc  numeric(5,2)  not null default 0,
  dct_kho  numeric(10,2) not null default 0,

  -- Mủ đông khối
  dkt_tuoi numeric(10,2) not null default 0,
  dkt_drc  numeric(5,2)  not null default 0,
  dkt_kho  numeric(10,2) not null default 0,

  -- Mủ dây
  dt_tuoi  numeric(10,2) not null default 0,
  dt_drc   numeric(5,2)  not null default 0,
  dt_kho   numeric(10,2) not null default 0,

  -- Liên kết & metadata
  dispatch_entry_id  uuid references public.dispatch_entries(id) on delete set null,
  warn_codes         text[] not null default '{}',
  import_batch_id    uuid,
  ghi_chu            text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (factory_id, ngay, so_xe, chuyen, doi)
);

create index if not exists idx_production_records_factory_ngay
  on public.production_records(factory_id, ngay desc);

create index if not exists idx_production_records_doi
  on public.production_records(factory_id, doi, ngay desc);

create index if not exists idx_production_records_xe_chuyen
  on public.production_records(factory_id, so_xe, chuyen, ngay desc);

-- auto updated_at
create or replace trigger trg_production_records_updated_at
  before update on public.production_records
  for each row execute function public.set_updated_at();

-- RLS
alter table public.production_records enable row level security;

drop policy if exists "production_records_read_same_factory" on public.production_records;
create policy "production_records_read_same_factory"
  on public.production_records for select to authenticated
  using (public.current_profile_factory_id() = factory_id);

drop policy if exists "production_records_write_manager" on public.production_records;
create policy "production_records_write_manager"
  on public.production_records for all to authenticated
  using (
    public.current_profile_role() in ('admin', 'manager')
    and public.current_profile_factory_id() = factory_id
  )
  with check (
    public.current_profile_role() in ('admin', 'manager')
    and public.current_profile_factory_id() = factory_id
  );
