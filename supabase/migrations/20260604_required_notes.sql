create table if not exists required_notes (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references factories(id) on delete cascade,
  content text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists required_notes_factory_content_key
  on required_notes(factory_id, lower(content));

create index if not exists required_notes_factory_sort_idx
  on required_notes(factory_id, is_active, sort_order, content);

alter table ngans
  add column if not exists ghi_chu text;
