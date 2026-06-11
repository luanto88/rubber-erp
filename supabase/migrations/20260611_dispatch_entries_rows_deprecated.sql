-- dispatch_entries.rows is now a legacy cache mirrored from dispatch_entry_rows.
-- Application reads should prefer dispatch_entry_rows (via shared helpers),
-- and writes should only touch this column through the sync helper.

comment on column public.dispatch_entries.rows is
  'DEPRECATED legacy cache mirrored from public.dispatch_entry_rows. Do not read or write directly from application code.';
