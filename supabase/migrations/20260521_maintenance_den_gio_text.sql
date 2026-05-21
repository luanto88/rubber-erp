-- Allow den_gio to store full datetime strings (e.g. "2026-05-21T14:30")
-- Old TIME values cast to TEXT fine (e.g. "14:30:00")
ALTER TABLE maintenance_records ALTER COLUMN den_gio TYPE TEXT;
