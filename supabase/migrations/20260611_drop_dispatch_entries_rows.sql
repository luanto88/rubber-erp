-- dispatch_entries.rows used to be a legacy cache mirrored from dispatch_entry_rows.
-- Runtime code now hydrates trip rows directly from dispatch_entry_rows, so the cache
-- column can be removed.

alter table public.dispatch_entries
  drop column if exists rows;
