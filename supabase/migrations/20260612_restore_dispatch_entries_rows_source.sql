alter table public.dispatch_entries
  add column if not exists rows jsonb not null default '[]'::jsonb;

comment on column public.dispatch_entries.rows is
  'SOURCE OF TRUTH for dispatch trip rows. Application runtime must read/write this column only.';

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'dispatch_entry_rows'
  ) then
    update public.dispatch_entries as e
    set rows = coalesce(src.rows, '[]'::jsonb)
    from (
      select
        r.dispatch_entry_id,
        jsonb_agg(
          jsonb_build_object(
            'row_id', r.id,
            'dispatch_entry_id', r.dispatch_entry_id,
            'uid', coalesce(r.uid_legacy, r.id::text),
            '_date', to_char(r.ngay, 'YYYY-MM-DD'),
            'day_chuyen', r.day_chuyen,
            'so_xe', r.so_xe,
            'chuyen', r.chuyen,
            'tai_xe', r.tai_xe,
            'diem_gn', coalesce(to_jsonb(r.diem_gn), '[]'::jsonb),
            'phien', coalesce(to_jsonb(r.phien), '[]'::jsonb),
            'lo_thu_hoach', coalesce(to_jsonb(r.lo_thu_hoach), '[]'::jsonb),
            'xu_ly', r.xu_ly,
            'lo_trinh', coalesce(to_jsonb(r.lo_trinh), '[]'::jsonb),
            'doi', coalesce(to_jsonb(r.doi), '[]'::jsonb),
            'so_km', r.so_km,
            'kl_ct', coalesce(r.kl_ct, 0),
            'drc_c', coalesce(r.drc_c, 0),
            'kl_ck', coalesce(r.kl_ck, 0),
            'kl_dct', coalesce(r.kl_dct, 0),
            'drc_dc', coalesce(r.drc_dc, 0),
            'kl_dck', coalesce(r.kl_dck, 0),
            'kl_dkt', coalesce(r.kl_dkt, 0),
            'drc_dk', coalesce(r.drc_dk, 0),
            'kl_dkk', coalesce(r.kl_dkk, 0),
            'kl_dt', coalesce(r.kl_dt, 0),
            'drc_d', coalesce(r.drc_d, 0),
            'kl_dk', coalesce(r.kl_dk, 0),
            'kl_mn', coalesce(r.kl_mn, 0),
            'drc_mn', coalesce(r.drc_mn, 0),
            'kl_mnk', coalesce(r.kl_mnk, 0),
            'ngan_ref', coalesce(to_jsonb(r.ngan_ref), '[]'::jsonb),
            'ghi_chu', r.ghi_chu,
            'locked', coalesce(r.locked, false)
          )
          order by coalesce(r.sort_order, 0), r.created_at, r.id
        ) as rows
      from public.dispatch_entry_rows r
      group by r.dispatch_entry_id
    ) as src
    where e.id = src.dispatch_entry_id
      and (
        e.rows is null
        or jsonb_typeof(e.rows) <> 'array'
        or jsonb_array_length(e.rows) = 0
      );
  end if;
end $$;
